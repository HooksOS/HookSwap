// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "../common/IContractRegistry.sol";

// WETH 接口
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
    function balanceOf(address) external view returns (uint256);
}

/**
 * @title Settlement
 * @notice HookSwapPerps on-chain settlement — off-chain (P2P) matching + on-chain settlement (ETH-denominated).
 * @dev ETH-denominated: all amounts are quoted in ETH (1e18 precision).
 *      Session Key functionality lives in the SessionKeyManager contract.
 *
 *      EIP-712 DOMAIN: ("HookSwapPerps","1"). This domain name is a HARD SYNC POINT — it must match,
 *      byte-for-byte, the domain used by the off-chain matching engine (perps-engine) and the
 *      frontend order-signing util, or every order signature will fail to recover. See README.md
 *      "Rebrand sync points". Rebranded from "MemePerp" (upstream meme-perp-dex).
 */
/// @dev MED-3 fix: OracleGuard runtime circuit breaker, ported from the factory PerpMarket. Reverts
///      when a price about to be consumed for value is stale vs / deviates too far from the market's
///      reference feed. Read only `refFeed` (3rd field) to skip gracefully when unconfigured.
interface IOracleGuardCheck {
    function checkDeviation(address market, uint256 proposedPrice) external view;
    /// @dev MED-2: the fresh, normalized (1e18) reference-feed price. Reverts on no-feed / bad / stale.
    function refPrice(address market) external view returns (uint256);
    function marketConfig(address market)
        external
        view
        returns (
            bytes32 sourceType,
            address venue,
            address refFeed,
            uint256 maxDeviationBps,
            uint256 maxStaleness,
            uint256 minLiquidity,
            bool dualSourceRequired
        );
}

contract Settlement is Ownable, ReentrancyGuard, Pausable, EIP712 {
    using ECDSA for bytes32;
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    // ============================================================
    // Constants
    // ============================================================

    uint256 public constant PRECISION = 1e18;
    uint256 public constant LEVERAGE_PRECISION = 1e4;
    uint256 public constant MAX_LEVERAGE = 100 * LEVERAGE_PRECISION;
    uint256 public constant MAINTENANCE_MARGIN_RATE = 50;
    uint256 public constant MAX_PNL = uint256(type(int256).max);
    uint256 public constant STANDARD_DECIMALS = 18;  // ETH 本位: 1e18 精度
    uint256 public constant FUNDING_INTERVAL = 5 minutes;

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address trader,address token,bool isLong,uint256 size,uint256 leverage,uint256 price,uint256 deadline,uint256 nonce,uint8 orderType)"
    );

    // EIP-712 签名类型 - 用于代付 gas 的充值/提款
    bytes32 public constant DEPOSIT_TYPEHASH = keccak256(
        "Deposit(address user,address token,uint256 amount,uint256 deadline,uint256 nonce)"
    );

    bytes32 public constant WITHDRAW_TYPEHASH = keccak256(
        "Withdraw(address user,address token,uint256 amount,uint256 deadline,uint256 nonce)"
    );

    // ============================================================
    // Enums & Structs
    // ============================================================

    enum OrderType { MARKET, LIMIT }
    enum PositionStatus { ACTIVE, CLOSED, LIQUIDATED }

    struct Order {
        address trader;
        address token;
        bool isLong;
        uint256 size;
        uint256 leverage;
        uint256 price;
        uint256 deadline;
        uint256 nonce;
        OrderType orderType;
    }

    struct MatchedPair {
        Order longOrder;
        bytes longSignature;
        Order shortOrder;
        bytes shortSignature;
        uint256 matchPrice;
        uint256 matchSize;
    }

    struct PairedPosition {
        uint256 pairId;
        address longTrader;
        address shortTrader;
        address token;
        uint256 size;
        uint256 entryPrice;
        uint256 longCollateral;
        uint256 shortCollateral;
        uint256 longLeverage;
        uint256 shortLeverage;
        uint256 openTime;
        uint256 lastFundingSettled; // C-01 fix: 上次 funding 结算时间，避免双重收费
        int256 accFundingLong;
        int256 accFundingShort;
        PositionStatus status;
    }

    struct UserBalance {
        uint256 available;
        uint256 locked;
    }

    // ============================================================
    // State Variables
    // ============================================================

    IContractRegistry public contractRegistry;

    // WETH 合约地址 (用于 ETH 直接存入)
    address public weth;

    mapping(address => bool) public supportedTokens;
    mapping(address => uint8) public tokenDecimals;
    address[] public supportedTokenList;

    mapping(address => bool) public authorizedMatchers;
    address public legacyPositionManager;

    mapping(address => uint256) public nonces;
    mapping(bytes32 => uint256) public filledAmounts;
    mapping(address => bool) public sequentialNonceMode;

    // 用于代付 gas 操作的 nonce (防重放攻击)
    mapping(address => uint256) public metaTxNonces;

    mapping(address => UserBalance) public balances;
    mapping(uint256 => PairedPosition) public pairedPositions;
    mapping(address => uint256[]) public userPairIds;
    uint256 public nextPairId = 1;

    address public insuranceFund;
    uint256 public feeRate = 10;
    address public feeReceiver;

    mapping(address => int256) public fundingRates;
    uint256 public lastFundingTime;
    mapping(address => uint256) public tokenPrices;
    mapping(address => mapping(address => uint256)) public userPositionSizes;

    // ============================================================
    // 日结与保险基金相关状态变量
    // ============================================================

    // 累计清算罚金 (待转保险基金)
    uint256 public pendingLiquidationPenalty;

    // 总锁定保证金 (用于健康度检查)
    uint256 public totalLockedMargin;

    // ============================================================
    // Events
    // ============================================================

    event Deposited(address indexed user, uint256 amount);
    event DepositedFor(address indexed user, address indexed relayer, address token, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event WithdrawnFor(address indexed user, address indexed relayer, address token, uint256 amount);
    event MatcherAuthorized(address indexed matcher, bool authorized);
    event PairOpened(uint256 indexed pairId, address indexed longTrader, address indexed shortTrader, address token, uint256 size, uint256 entryPrice);
    event PairClosed(uint256 indexed pairId, uint256 exitPrice, int256 longPnL, int256 shortPnL);
    event Liquidated(uint256 indexed pairId, address indexed liquidatedTrader, address indexed liquidator, uint256 reward);
    event FundingSettled(uint256 indexed pairId, int256 longPayment, int256 shortPayment);
    event BatchSettled(uint256 pairCount, uint256 timestamp);
    event PriceUpdated(address indexed token, uint256 price);
    event SequentialNonceModeSet(address indexed user, bool enabled);
    event TokenAdded(address indexed token, uint8 decimals);
    event TokenRemoved(address indexed token);
    event ContractRegistrySet(address indexed registry);
    event ADLTriggered(uint256 indexed targetPairId, uint256 indexed adlPairId, address indexed adlTrader, uint256 adlAmount, uint256 deficit);
    event DailySettlementCompleted(uint256 fundingFee, uint256 liquidationPenalty, uint256 totalTransferred, uint256 timestamp);
    event InsuranceInjected(uint256 amount, uint256 timestamp);
    event EmergencyPaused(address indexed by, string reason);
    event EmergencyUnpaused(address indexed by);
    event ForeignTokenRescued(address indexed token, address indexed to, uint256 amount);
    event EmergencyWithdrawn(address indexed user, address indexed token, uint256 amount);
    /// @notice Winner's profit exceeded the counterparty's collateral and was CAPPED there (insurance
    ///         never tops up a trade winner — removes the self/collusion harvest vector).
    event WinnerCapped(uint256 indexed pairId, address indexed winner, uint256 uncoveredExcess);

    // ============================================================
    // Errors
    // ============================================================

    error Unauthorized();
    error InvalidSignature();
    error OrderExpired();
    error InvalidNonce();
    error OrderAlreadyUsed();
    error InvalidMatch();
    error InsufficientBalance();
    error PositionNotActive();
    error CannotLiquidate();
    error InvalidAmount();
    error HasLegacyPosition();
    error TokenNotSupported();
    error ContractNotActive();
    error OrderSizeTooSmall();
    error OrderSizeTooBig();
    error PositionLimitExceeded();
    error LeverageTooHigh();
    error PriceDeviationTooLarge();
    error LimitPriceViolated(); // MED-3: matchPrice violates a LIMIT order's signed price
    error NotStale(); // MED-2: forceSettle called while the mark is still fresh (within grace)
    error NoReferenceFeed(); // MED-2: forceSettle needs a reference feed to settle against

    /// @notice MED-2: a position was force-settled by the owner at the fresh reference price after
    ///         the matcher mark went stale beyond PRICE_STALE_GRACE.
    event ForceSettled(uint256 indexed pairId, uint256 refPrice, uint256 staleSince);

    // MED-2 (round-4 audit): timestamp of the last matcher `updatePrice` per token. Lets the owner
    // `forceSettle` a position at the fresh reference price if the matcher stops refreshing the mark
    // for longer than PRICE_STALE_GRACE — so a down matcher can never permanently trap positions.
    mapping(address => uint256) public lastPriceUpdate;

    // How long the matcher-maintained mark may go unrefreshed before the owner escape hatch unlocks.
    uint256 public constant PRICE_STALE_GRACE = 1 hours;

    // ============================================================
    // Constructor
    // ============================================================

    constructor() Ownable(msg.sender) EIP712("HookSwapPerps", "1") {
        feeReceiver = msg.sender;
        lastFundingTime = block.timestamp;
    }

    // ============================================================
    // User Functions
    // ============================================================

    function deposit(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (!supportedTokens[token]) revert TokenNotSupported();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 standardAmount = _toStandardDecimals(token, amount);
        balances[msg.sender].available += standardAmount;
        emit Deposited(msg.sender, standardAmount);
    }

    /**
     * @notice 为其他地址充值 (主钱包为派生钱包充值)
     * @dev 调用者支付代币和 gas，余额计入 recipient
     * @param recipient 接收余额的地址 (派生钱包/trading wallet)
     * @param token 代币地址
     * @param amount 充值金额
     */
    function depositTo(address recipient, address token, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidAmount();
        if (!supportedTokens[token]) revert TokenNotSupported();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 standardAmount = _toStandardDecimals(token, amount);
        balances[recipient].available += standardAmount;
        emit DepositedFor(recipient, msg.sender, token, standardAmount);
    }

    /**
     * @notice 直接存入 ETH (自动包装为 WETH)
     * @dev 用户可以直接发送 ETH，合约自动包装为 WETH 并计入余额
     */
    function depositETH() external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert InvalidAmount();
        if (weth == address(0)) revert TokenNotSupported();
        if (!supportedTokens[weth]) revert TokenNotSupported();

        // 包装 ETH 为 WETH
        IWETH(weth).deposit{value: msg.value}();

        // 计算标准化金额并计入余额
        uint256 standardAmount = _toStandardDecimals(weth, msg.value);
        balances[msg.sender].available += standardAmount;
        emit Deposited(msg.sender, standardAmount);
    }

    function depositWithPermit(address token, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (!supportedTokens[token]) revert TokenNotSupported();
        IERC20Permit(token).permit(msg.sender, address(this), amount, deadline, v, r, s);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 standardAmount = _toStandardDecimals(token, amount);
        balances[msg.sender].available += standardAmount;
        emit Deposited(msg.sender, standardAmount);
    }

    function withdraw(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (!supportedTokens[token]) revert TokenNotSupported();
        if (balances[msg.sender].available < amount) revert InsufficientBalance();
        balances[msg.sender].available -= amount;
        uint256 tokenAmount = _fromStandardDecimals(token, amount);
        require(IERC20(token).balanceOf(address(this)) >= tokenAmount, "Insufficient liquidity");
        IERC20(token).safeTransfer(msg.sender, tokenAmount);
        emit Withdrawn(msg.sender, amount);
    }

    // ============================================================
    // Meta Transaction Functions (代付 Gas)
    // ============================================================

    /**
     * @notice 代付 gas 充值 ERC20 代币
     * @dev 用户签名授权，relayer 代为提交交易并支付 gas
     * @param user 用户地址
     * @param token 代币地址
     * @param amount 充值金额
     * @param deadline 签名过期时间
     * @param signature 用户的 EIP-712 签名
     */
    function depositFor(
        address user,
        address token,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (!supportedTokens[token]) revert TokenNotSupported();
        if (block.timestamp > deadline) revert OrderExpired();

        // 验证签名
        uint256 nonce = metaTxNonces[user]++;
        bytes32 structHash = keccak256(abi.encode(
            DEPOSIT_TYPEHASH,
            user,
            token,
            amount,
            deadline,
            nonce
        ));
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);
        if (signer != user) revert InvalidSignature();

        // 从用户账户转入代币（用户需要先 approve）
        IERC20(token).safeTransferFrom(user, address(this), amount);
        uint256 standardAmount = _toStandardDecimals(token, amount);
        balances[user].available += standardAmount;

        emit DepositedFor(user, msg.sender, token, standardAmount);
    }

    /**
     * @notice 代付 gas 充值 ETH（自动包装为 WETH）
     * @dev relayer 发送 ETH，合约自动包装并计入用户余额
     * @param user 用户地址
     * @param deadline 签名过期时间
     * @param signature 用户的 EIP-712 签名
     */
    function depositETHFor(
        address user,
        uint256 deadline,
        bytes calldata signature
    ) external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert InvalidAmount();
        if (weth == address(0)) revert TokenNotSupported();
        if (!supportedTokens[weth]) revert TokenNotSupported();
        if (block.timestamp > deadline) revert OrderExpired();

        // 验证签名
        uint256 nonce = metaTxNonces[user]++;
        bytes32 structHash = keccak256(abi.encode(
            DEPOSIT_TYPEHASH,
            user,
            weth,
            msg.value,
            deadline,
            nonce
        ));
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);
        if (signer != user) revert InvalidSignature();

        // 包装 ETH 为 WETH
        IWETH(weth).deposit{value: msg.value}();

        // 计入用户余额
        uint256 standardAmount = _toStandardDecimals(weth, msg.value);
        balances[user].available += standardAmount;

        emit DepositedFor(user, msg.sender, weth, standardAmount);
    }

    /**
     * @notice 代付 gas 提款
     * @dev 用户签名授权，relayer 代为提交交易并支付 gas
     * @param user 用户地址
     * @param token 代币地址
     * @param amount 提款金额
     * @param deadline 签名过期时间
     * @param signature 用户的 EIP-712 签名
     */
    function withdrawFor(
        address user,
        address token,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (!supportedTokens[token]) revert TokenNotSupported();
        if (block.timestamp > deadline) revert OrderExpired();
        if (balances[user].available < amount) revert InsufficientBalance();

        // 验证签名
        uint256 nonce = metaTxNonces[user]++;
        bytes32 structHash = keccak256(abi.encode(
            WITHDRAW_TYPEHASH,
            user,
            token,
            amount,
            deadline,
            nonce
        ));
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);
        if (signer != user) revert InvalidSignature();

        // 执行提款
        balances[user].available -= amount;
        uint256 tokenAmount = _fromStandardDecimals(token, amount);
        require(IERC20(token).balanceOf(address(this)) >= tokenAmount, "Insufficient liquidity");
        IERC20(token).safeTransfer(user, tokenAmount);

        emit WithdrawnFor(user, msg.sender, token, amount);
    }

    /**
     * @notice 获取用户的 meta transaction nonce
     */
    function getMetaTxNonce(address user) external view returns (uint256) {
        return metaTxNonces[user];
    }

    function incrementNonce() external {
        nonces[msg.sender]++;
    }

    function setSequentialNonceMode(bool enabled) external {
        sequentialNonceMode[msg.sender] = enabled;
        emit SequentialNonceModeSet(msg.sender, enabled);
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    function setContractRegistry(address _registry) external onlyOwner {
        contractRegistry = IContractRegistry(_registry);
        emit ContractRegistrySet(_registry);
    }

    function setWETH(address _weth) external onlyOwner {
        weth = _weth;
    }

    function setAuthorizedMatcher(address matcher, bool authorized) external onlyOwner {
        authorizedMatchers[matcher] = authorized;
        emit MatcherAuthorized(matcher, authorized);
    }

    function setInsuranceFund(address _insuranceFund) external onlyOwner {
        insuranceFund = _insuranceFund;
    }

    /// @notice OracleGuard for the MED-3 price circuit breaker (see _guardPrice). Unset => no-op.
    address public oracleGuard;
    event OracleGuardSet(address indexed oracleGuard);

    function setOracleGuard(address _oracleGuard) external onlyOwner {
        oracleGuard = _oracleGuard;
        emit OracleGuardSet(_oracleGuard);
    }

    /// @dev MED-3: enforce the OracleGuard circuit breaker on any price about to settle value
    ///      (entry / exit / mark). No-op when unset (backward-compat) or when this market has no
    ///      reference feed. Reverts on stale / out-of-band prices, stopping a hostile matcher from
    ///      settling at an arbitrary price.
    function _guardPrice(uint256 price) internal view {
        address og = oracleGuard;
        if (og == address(0)) return;
        (, , address refFeed, , , , ) = IOracleGuardCheck(og).marketConfig(address(this));
        if (refFeed == address(0)) return; // no reference feed → nothing to check (trusted/curated)
        IOracleGuardCheck(og).checkDeviation(address(this), price);
    }

    function setFeeRate(uint256 _feeRate) external onlyOwner {
        require(_feeRate <= 100, "Fee too high");
        feeRate = _feeRate;
    }

    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        feeReceiver = _feeReceiver;
    }

    function setLegacyPositionManager(address _legacy) external onlyOwner {
        legacyPositionManager = _legacy;
    }

    function addSupportedToken(address token, uint8 decimals) external onlyOwner {
        require(token != address(0) && !supportedTokens[token], "Invalid");
        if (decimals == 0) {
            (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
            require(ok && data.length >= 32, "Cannot detect decimals");
            decimals = abi.decode(data, (uint8));
        }
        supportedTokens[token] = true;
        tokenDecimals[token] = decimals;
        supportedTokenList.push(token);
        emit TokenAdded(token, decimals);
    }

    function removeSupportedToken(address token) external onlyOwner {
        require(supportedTokens[token], "Not supported");
        supportedTokens[token] = false;
        for (uint256 i = 0; i < supportedTokenList.length; i++) {
            if (supportedTokenList[i] == token) {
                supportedTokenList[i] = supportedTokenList[supportedTokenList.length - 1];
                supportedTokenList.pop();
                break;
            }
        }
        emit TokenRemoved(token);
    }

    /**
     * @notice 紧急暂停合约
     * @dev 暂停后，所有关键操作（提款、结算、清算）都会被阻止
     * @param reason 暂停原因（用于日志记录）
     */
    /// @notice Timestamp of the most recent emergencyPause (0 when live). Gates emergencyWithdraw.
    uint256 public pausedAt;
    /// @notice A pause lasting this long lets users self-rescue their unlocked balance without the owner.
    uint256 public constant EMERGENCY_WITHDRAW_DELAY = 7 days;

    function emergencyPause(string calldata reason) external onlyOwner {
        _pause();
        pausedAt = block.timestamp;
        emit EmergencyPaused(msg.sender, reason);
    }

    /**
     * @notice 恢复合约运行
     * @dev 只有 owner 可以恢复
     */
    function emergencyUnpause() external onlyOwner {
        _unpause();
        pausedAt = 0;
        emit EmergencyUnpaused(msg.sender);
    }

    /**
     * @notice Sweep a NON-collateral token accidentally sent here. Reverts on any supported collateral,
     *         so it can NEVER move user trading funds — only mistakenly-sent foreign tokens.
     */
    function rescueForeignToken(address token, address to, uint256 amount) external onlyOwner {
        if (supportedTokens[token]) revert TokenNotSupported();
        if (to == address(0)) revert InvalidAmount();
        IERC20(token).safeTransfer(to, amount);
        emit ForeignTokenRescued(token, to, amount);
    }

    /**
     * @notice Owner-INDEPENDENT escape hatch. If the contract stays paused past EMERGENCY_WITHDRAW_DELAY
     *         (operator abandoned / owner key lost), any user may pull their own UNLOCKED (available)
     *         collateral in `token` directly — no owner action required. Mirrors withdraw()'s decimal +
     *         liquidity handling. Fixes the "paused + lost owner freezes funds forever" trap. Locked-in-
     *         position collateral still needs settlement/force-close (a separate, larger mechanism).
     */
    function emergencyWithdraw(address token) external nonReentrant {
        if (!paused()) revert ContractNotActive();
        if (pausedAt == 0 || block.timestamp < pausedAt + EMERGENCY_WITHDRAW_DELAY) revert Unauthorized();
        if (!supportedTokens[token]) revert TokenNotSupported();
        uint256 owed = balances[msg.sender].available;
        if (owed == 0) revert InsufficientBalance();
        balances[msg.sender].available = 0;
        uint256 tokenAmount = _fromStandardDecimals(token, owed);
        require(IERC20(token).balanceOf(address(this)) >= tokenAmount, "Insufficient liquidity");
        IERC20(token).safeTransfer(msg.sender, tokenAmount);
        emit EmergencyWithdrawn(msg.sender, token, tokenAmount);
    }

    // ============================================================
    // Matcher Functions
    // ============================================================

    function updatePrice(address token, uint256 price) external {
        if (!authorizedMatchers[msg.sender]) revert Unauthorized();
        _guardPrice(price); // MED-3: reject stale / out-of-band marks at write time
        tokenPrices[token] = price;
        lastPriceUpdate[token] = block.timestamp; // MED-2: track mark freshness for forceSettle
        emit PriceUpdated(token, price);
    }

    function updateFundingRate(address token, int256 rate) external {
        if (!authorizedMatchers[msg.sender]) revert Unauthorized();
        fundingRates[token] = rate;
    }

    function settleBatch(MatchedPair[] calldata pairs) external nonReentrant whenNotPaused {
        if (!authorizedMatchers[msg.sender]) revert Unauthorized();
        for (uint256 i = 0; i < pairs.length; i++) {
            _settlePair(pairs[i]);
        }
        emit BatchSettled(pairs.length, block.timestamp);
    }

    function _settlePair(MatchedPair calldata pair) internal {
        _validateOrder(pair.longOrder, pair.longSignature, true);
        _validateOrder(pair.shortOrder, pair.shortSignature, false);

        if (_hasLegacyPosition(pair.longOrder.trader)) revert HasLegacyPosition();
        if (_hasLegacyPosition(pair.shortOrder.trader)) revert HasLegacyPosition();
        if (pair.longOrder.token != pair.shortOrder.token) revert InvalidMatch();
        // HIGH-1: forbid self-matching (one wallet on both sides) — a delta-neutral self-pair could
        // otherwise harvest insurance via the winner-deficit branch at zero market risk.
        if (pair.longOrder.trader == pair.shortOrder.trader) revert InvalidMatch();
        if (pair.matchSize == 0) revert InvalidMatch();

        // MED-3: the matcher-supplied entry price must pass the OracleGuard deviation/staleness band
        // BEFORE any collateral is locked (moved up from _createPairedPosition so a bad price reverts
        // before state changes).
        _guardPrice(pair.matchPrice);

        // MED-3 (H-2 port): enforce the SIGNED limit price on-chain, matching PerpMarket. A LIMIT long
        // may only fill at or below its signed price; a LIMIT short only at or above. MARKET orders are
        // unconstrained here (their price protection is the deviation band above). Without this a matcher
        // could fill a LIMIT order anywhere inside the band, worse than the user's signed limit.
        if (pair.longOrder.orderType == OrderType.LIMIT && pair.matchPrice > pair.longOrder.price) {
            revert LimitPriceViolated();
        }
        if (pair.shortOrder.orderType == OrderType.LIMIT && pair.matchPrice < pair.shortOrder.price) {
            revert LimitPriceViolated();
        }

        _validateContractSpec(pair);

        // 验证填充量
        {
            bytes32 longHash = getOrderHash(pair.longOrder);
            bytes32 shortHash = getOrderHash(pair.shortOrder);
            if (pair.matchSize > pair.longOrder.size - filledAmounts[longHash]) revert InvalidMatch();
            if (pair.matchSize > pair.shortOrder.size - filledAmounts[shortHash]) revert InvalidMatch();
        }

        // 计算保证金
        uint256 longCollateral = (pair.matchSize * LEVERAGE_PRECISION) / pair.longOrder.leverage;
        uint256 shortCollateral = (pair.matchSize * LEVERAGE_PRECISION) / pair.shortOrder.leverage;

        // 处理手续费和余额
        _processFeesAndLock(pair.longOrder.trader, pair.shortOrder.trader, longCollateral, shortCollateral, pair.matchSize);

        // 创建配对仓位
        uint256 pairId = _createPairedPosition(pair, longCollateral, shortCollateral);

        // 更新追踪数据
        _updateTrackingData(pair, pairId);

        emit PairOpened(pairId, pair.longOrder.trader, pair.shortOrder.trader, pair.longOrder.token, pair.matchSize, pair.matchPrice);
    }

    /// @dev 处理手续费、锁定保证金
    function _processFeesAndLock(
        address longTrader, address shortTrader,
        uint256 longCollateral, uint256 shortCollateral,
        uint256 matchSize
    ) internal {
        uint256 perSideFee = (matchSize * feeRate) / 10000;

        if (balances[longTrader].available < longCollateral + perSideFee) revert InsufficientBalance();
        if (balances[shortTrader].available < shortCollateral + perSideFee) revert InsufficientBalance();

        balances[longTrader].available -= (longCollateral + perSideFee);
        balances[longTrader].locked += longCollateral;
        balances[shortTrader].available -= (shortCollateral + perSideFee);
        balances[shortTrader].locked += shortCollateral;
        if (perSideFee > 0) balances[feeReceiver].available += perSideFee * 2;

        totalLockedMargin += longCollateral + shortCollateral;
    }

    /// @dev 创建配对仓位
    function _createPairedPosition(
        MatchedPair calldata pair,
        uint256 longCollateral,
        uint256 shortCollateral
    ) internal returns (uint256 pairId) {
        pairId = nextPairId++;
        PairedPosition storage pos = pairedPositions[pairId];
        pos.pairId = pairId;
        pos.longTrader = pair.longOrder.trader;
        pos.shortTrader = pair.shortOrder.trader;
        pos.token = pair.longOrder.token;
        pos.size = pair.matchSize;
        // Entry price already guarded in _settlePair (MED-3, before locking collateral).
        pos.entryPrice = pair.matchPrice;
        pos.longCollateral = longCollateral;
        pos.shortCollateral = shortCollateral;
        pos.longLeverage = pair.longOrder.leverage;
        pos.shortLeverage = pair.shortOrder.leverage;
        pos.openTime = block.timestamp;
        pos.lastFundingSettled = block.timestamp;
        pos.status = PositionStatus.ACTIVE;
    }

    /// @dev 更新追踪数据 (pairIds, positionSizes, filledAmounts, nonces)
    function _updateTrackingData(MatchedPair calldata pair, uint256 pairId) internal {
        address longTrader = pair.longOrder.trader;
        address shortTrader = pair.shortOrder.trader;

        userPairIds[longTrader].push(pairId);
        userPairIds[shortTrader].push(pairId);
        userPositionSizes[longTrader][pair.longOrder.token] += pair.matchSize;
        userPositionSizes[shortTrader][pair.shortOrder.token] += pair.matchSize;

        bytes32 longHash = getOrderHash(pair.longOrder);
        bytes32 shortHash = getOrderHash(pair.shortOrder);
        filledAmounts[longHash] += pair.matchSize;
        filledAmounts[shortHash] += pair.matchSize;

        if (sequentialNonceMode[longTrader] && filledAmounts[longHash] >= pair.longOrder.size) nonces[longTrader]++;
        if (sequentialNonceMode[shortTrader] && filledAmounts[shortHash] >= pair.shortOrder.size) nonces[shortTrader]++;
    }

    // ============================================================
    // Position Functions
    // ============================================================

    function closePair(uint256 pairId) external nonReentrant whenNotPaused {
        PairedPosition storage pos = pairedPositions[pairId];
        if (pos.status != PositionStatus.ACTIVE) revert PositionNotActive();
        if (msg.sender != pos.longTrader && msg.sender != pos.shortTrader) revert Unauthorized();
        // MED-2: with a reference feed, the USER close settles at the FRESH reference price (trivially
        // in-band), not the possibly-stale stored mark — so a down matcher / drifted mark can't trap
        // the user. Falls back to the stored mark when there is no feed (original behavior).
        uint256 rp = _refPrice();
        _closePair(pairId, rp != 0 ? rp : tokenPrices[pos.token]);
    }

    /**
     * @notice MED-2 escape hatch: the owner closes a position at the FRESH reference price when the
     *         matcher-maintained mark has gone stale beyond PRICE_STALE_GRACE. Prevents a down/abandoned
     *         matcher from permanently trapping a position (a drifted stored mark makes both mark-based
     *         close and liquidate revert the guard). Abuse-safe: onlyOwner, only when genuinely stale,
     *         and settles at the oracle-fresh price (0 deviation) — never an off-market price.
     */
    function forceSettle(uint256 pairId) external nonReentrant whenNotPaused onlyOwner {
        PairedPosition storage pos = pairedPositions[pairId];
        if (pos.status != PositionStatus.ACTIVE) revert PositionNotActive();
        uint256 last = lastPriceUpdate[pos.token];
        if (block.timestamp - last <= PRICE_STALE_GRACE) revert NotStale();
        uint256 rp = _refPrice();
        if (rp == 0) revert NoReferenceFeed();
        _closePair(pairId, rp);
        emit ForceSettled(pairId, rp, last);
    }

    /// @dev MED-2: the FRESH normalized (1e18) reference-feed price, or 0 when no OracleGuard /
    ///      reference feed is wired (caller falls back to the stored mark). Reverts (via OracleGuard)
    ///      if the feed is bad or stale — settling against a broken feed is never safe.
    function _refPrice() internal view returns (uint256) {
        address og = oracleGuard;
        if (og == address(0)) return 0;
        (, , address refFeed, , , , ) = IOracleGuardCheck(og).marketConfig(address(this));
        if (refFeed == address(0)) return 0;
        return IOracleGuardCheck(og).refPrice(address(this));
    }

    function closePairsBatch(uint256[] calldata pairIds, uint256[] calldata exitPrices) external nonReentrant whenNotPaused {
        if (!authorizedMatchers[msg.sender]) revert Unauthorized();
        require(pairIds.length == exitPrices.length, "Length mismatch");
        for (uint256 i = 0; i < pairIds.length; i++) {
            if (pairedPositions[pairIds[i]].status == PositionStatus.ACTIVE) _closePair(pairIds[i], exitPrices[i]);
        }
    }

    function executeADL(uint256[] calldata pairIds, uint256[] calldata exitPrices) external nonReentrant whenNotPaused {
        if (!authorizedMatchers[msg.sender]) revert Unauthorized();
        require(pairIds.length == exitPrices.length, "Length mismatch");
        for (uint256 i = 0; i < pairIds.length; i++) {
            if (pairedPositions[pairIds[i]].status == PositionStatus.ACTIVE) _closePair(pairIds[i], exitPrices[i]);
        }
    }

    function _closePair(uint256 pairId, uint256 exitPrice) internal {
        PairedPosition storage pos = pairedPositions[pairId];
        _settleFunding(pairId);
        // Pass ZERO-SUM price PnL; funding is settled inside _settleProfit from pos.accFunding*.
        // Do NOT pre-subtract funding here (that let both PnLs go negative → F-2 negative-cast drain).
        _guardPrice(exitPrice); // MED-3: guard the exit price before settling value
        (int256 longPnL, int256 shortPnL) = _calculatePnL(pos, exitPrice);
        _settleProfit(pos, longPnL, shortPnL);
        _updatePositionSize(pos);
        pos.status = PositionStatus.CLOSED;
        emit PairClosed(pairId, exitPrice, longPnL, shortPnL);
    }

    function _updatePositionSize(PairedPosition storage pos) internal {
        if (userPositionSizes[pos.longTrader][pos.token] >= pos.size) userPositionSizes[pos.longTrader][pos.token] -= pos.size;
        else userPositionSizes[pos.longTrader][pos.token] = 0;
        if (userPositionSizes[pos.shortTrader][pos.token] >= pos.size) userPositionSizes[pos.shortTrader][pos.token] -= pos.size;
        else userPositionSizes[pos.shortTrader][pos.token] = 0;
    }

    /**
     * @dev `longPnL`/`shortPnL` MUST be ZERO-SUM price PnL from `_calculatePnL` (shortPnL == -longPnL);
     *      callers must NOT pre-subtract funding. F-2 fix: zero-sum inputs ⇒ the `else` branch's
     *      `uint256(shortPnL)` is always a positive cast (the old code pre-subtracted funding, letting
     *      BOTH sides go negative → a ~2^256 cast → wrong pay-out + insurance drain). F-1 fix: funding
     *      credited to insurance is capped at each side's realized output, so it is always backed.
     */
    function _settleProfit(PairedPosition storage pos, int256 longPnL, int256 shortPnL) internal {
        balances[pos.longTrader].locked -= pos.longCollateral;
        balances[pos.shortTrader].locked -= pos.shortCollateral;

        // 更新总锁定保证金
        totalLockedMargin -= (pos.longCollateral + pos.shortCollateral);

        // Step 1 — zero-sum price PnL: loser pays winner up to loser's collateral; excess is a deficit.
        uint256 longOut;
        uint256 shortOut;
        address winner;
        uint256 winnerDeficit;
        if (longPnL >= 0) {
            uint256 profit = uint256(longPnL);
            uint256 xfer = profit > pos.shortCollateral ? pos.shortCollateral : profit;
            longOut = pos.longCollateral + xfer;
            shortOut = pos.shortCollateral - xfer;
            if (profit > pos.shortCollateral) { winner = pos.longTrader; winnerDeficit = profit - pos.shortCollateral; }
        } else {
            uint256 profit = uint256(shortPnL); // shortPnL == -longPnL > 0 (safe)
            uint256 xfer = profit > pos.longCollateral ? pos.longCollateral : profit;
            shortOut = pos.shortCollateral + xfer;
            longOut = pos.longCollateral - xfer;
            if (profit > pos.longCollateral) { winner = pos.shortTrader; winnerDeficit = profit - pos.longCollateral; }
        }

        // Step 2 — funding: each side owes accFunding* (>= 0), collected to insurance, capped at that
        // side's realized output so the credit is always backed by tokens actually withheld (F-1).
        uint256 fLong = pos.accFundingLong > 0 ? uint256(pos.accFundingLong) : 0;
        uint256 fShort = pos.accFundingShort > 0 ? uint256(pos.accFundingShort) : 0;
        if (fLong > longOut) fLong = longOut;
        if (fShort > shortOut) fShort = shortOut;
        longOut -= fLong;
        shortOut -= fShort;
        uint256 funding = fLong + fShort;
        if (funding > 0) {
            if (insuranceFund != address(0)) balances[insuranceFund].available += funding;
            else insuranceFundFromFunding += funding;
        }

        balances[pos.longTrader].available += longOut;
        balances[pos.shortTrader].available += shortOut;

        // Step 3 — CAP the winner at the counterparty's collateral. Insurance NEVER tops up a trade
        // winner (that was harvestable by a delta-neutral self/colluding pair). The winner's excess
        // beyond the loser's collateral is simply not paid (isolated-margin guarantee); logged only.
        if (winnerDeficit > 0) emit WinnerCapped(pos.pairId, winner, winnerDeficit);
    }

    // ============================================================
    // Liquidation
    // ============================================================

    function canLiquidate(uint256 pairId) public view returns (bool liquidateLong, bool liquidateShort) {
        PairedPosition storage pos = pairedPositions[pairId];
        if (pos.status != PositionStatus.ACTIVE) return (false, false);
        (int256 longPnL, int256 shortPnL) = _calculatePnL(pos, tokenPrices[pos.token]);
        uint256 mm = (pos.size * MAINTENANCE_MARGIN_RATE) / 10000;
        liquidateLong = int256(pos.longCollateral) + longPnL - pos.accFundingLong < int256(mm);
        liquidateShort = int256(pos.shortCollateral) + shortPnL - pos.accFundingShort < int256(mm);
    }

    function liquidate(uint256 pairId) external nonReentrant whenNotPaused {
        PairedPosition storage pos = pairedPositions[pairId];
        if (pos.status != PositionStatus.ACTIVE) revert PositionNotActive();
        (bool liqLong, bool liqShort) = canLiquidate(pairId);
        if (!liqLong && !liqShort) revert CannotLiquidate();

        _guardPrice(tokenPrices[pos.token]); // MED-3: guard the liquidation mark before settling
        _settleFunding(pairId);
        // Zero-sum price PnL; funding settled inside _settleProfit (no pre-subtraction — F-1/F-2 fix).
        (int256 longPnL, int256 shortPnL) = _calculatePnL(pos, tokenPrices[pos.token]);

        uint256 penalty;
        address liqTrader;
        if (liqLong) {
            liqTrader = pos.longTrader;
            penalty = (pos.longCollateral * 5) / 100;  // 5% 清算罚金
        } else {
            liqTrader = pos.shortTrader;
            penalty = (pos.shortCollateral * 5) / 100;
        }

        _settleProfit(pos, longPnL, shortPnL);

        // 清算罚金：一部分给清算者(激励)，一部分进保险基金
        uint256 liquidatorReward = penalty / 2;  // 50% 给清算者
        uint256 insurancePenalty = penalty - liquidatorReward;  // 50% 进保险基金

        if (penalty > 0 && balances[liqTrader].available >= penalty) {
            balances[liqTrader].available -= penalty;
            balances[msg.sender].available += liquidatorReward;  // 清算者奖励
            pendingLiquidationPenalty += insurancePenalty;  // 累计到待转保险基金
        }

        _updatePositionSize(pos);
        pos.status = PositionStatus.LIQUIDATED;
        emit Liquidated(pairId, liqTrader, msg.sender, liquidatorReward);
    }

    // ============================================================
    // Funding Rate (简化版：固定费率，双方都扣，进保险基金)
    // ============================================================

    // 固定费率：0.01% = 1bp = 1/10000
    uint256 public constant FIXED_FUNDING_RATE = 1;
    uint256 public constant FUNDING_RATE_PRECISION = 10000;

    // 保险基金累计收到的资金费
    uint256 public insuranceFundFromFunding;

    /**
     * @notice 结算资金费（简化版）
     * @dev 固定费率 0.01% per 5 minutes，双方都扣，全部进保险基金
     */
    function _settleFunding(uint256 pairId) internal {
        PairedPosition storage pos = pairedPositions[pairId];
        // C-01 fix: 使用 lastFundingSettled 而非 openTime，避免双重收费
        uint256 elapsed = block.timestamp - pos.lastFundingSettled;
        if (elapsed == 0) return;

        // 计算资金费：仓位大小 × 固定费率 × 经过的周期数 (仅计算增量)
        // funding = size * 0.01% * (elapsed / 5 minutes)
        uint256 periods = elapsed / FUNDING_INTERVAL;
        if (periods == 0) return;

        // 更新上次结算时间 (对齐到周期边界，避免跨期丢失)
        pos.lastFundingSettled += periods * FUNDING_INTERVAL;

        uint256 fundingPerSide = (pos.size * FIXED_FUNDING_RATE * periods) / FUNDING_RATE_PRECISION;
        if (fundingPerSide == 0) return;

        // 双方都扣（累计为正数，表示支出）
        pos.accFundingLong += int256(fundingPerSide);
        pos.accFundingShort += int256(fundingPerSide);

        // F-1 fix: do NOT pre-credit an unbacked amount. Funding is credited to insurance in
        // _settleProfit from what is ACTUALLY withheld from each trader (capped at their output),
        // so the insurance balance is always backed. accFunding* above is the amount owed.

        emit FundingSettled(pairId, pos.accFundingLong, pos.accFundingShort);
    }

    /**
     * @notice 批量结算资金费
     */
    function settleFundingBatch(uint256[] calldata pairIds) external {
        if (!authorizedMatchers[msg.sender]) revert Unauthorized();
        for (uint256 i = 0; i < pairIds.length; i++) {
            if (pairedPositions[pairIds[i]].status == PositionStatus.ACTIVE) _settleFunding(pairIds[i]);
        }
        lastFundingTime = block.timestamp;
    }

    /**
     * @notice 将累计的资金费转移到保险基金 (内部记账)
     * @dev 只有 owner 或授权 matcher 可以调用
     */
    function transferFundingToInsurance() external {
        if (!authorizedMatchers[msg.sender] && msg.sender != owner()) revert Unauthorized();
        if (insuranceFund == address(0)) return;
        if (insuranceFundFromFunding == 0) return;

        uint256 amount = insuranceFundFromFunding;
        insuranceFundFromFunding = 0;

        // 增加保险基金余额（内部记账）
        balances[insuranceFund].available += amount;
    }

    /**
     * @notice 获取待转保险基金金额
     */
    function getPendingInsuranceAmount() external view returns (uint256 funding, uint256 penalty) {
        return (insuranceFundFromFunding, pendingLiquidationPenalty);
    }

    /**
     * @notice 获取总锁定保证金
     */
    function getTotalLockedMargin() external view returns (uint256) {
        return totalLockedMargin;
    }

    // ============================================================
    // View Functions
    // ============================================================

    function getOrderHash(Order calldata order) public view returns (bytes32) {
        return _hashTypedDataV4(_orderStructHash(order));
    }

    /// @dev EIP-712 struct hash — 分两段 abi.encode 拼接后 keccak256
    /// 等效于 keccak256(abi.encode(TYPEHASH, trader, token, isLong, size, leverage, price, deadline, nonce, orderType))
    /// 因为 abi.encode 把每个值 pad 到 32 bytes，两段拼接等价于一段。
    function _orderStructHash(Order calldata order) internal pure returns (bytes32) {
        // 第一段: TYPEHASH + 前 5 个字段 (6 个 slot)
        bytes memory a = abi.encode(
            ORDER_TYPEHASH,
            order.trader,
            order.token,
            order.isLong,
            order.size
        );
        // 第二段: 后 5 个字段 (5 个 slot)
        bytes memory b = abi.encode(
            order.leverage,
            order.price,
            order.deadline,
            order.nonce,
            order.orderType
        );
        return keccak256(bytes.concat(a, b));
    }

    function verifyOrder(Order calldata order, bytes calldata signature) public view returns (bool) {
        return getOrderHash(order).recover(signature) == order.trader;
    }

    function getUserBalance(address user) external view returns (uint256 available, uint256 locked) {
        return (balances[user].available, balances[user].locked);
    }

    function getPairedPosition(uint256 pairId) external view returns (PairedPosition memory) {
        return pairedPositions[pairId];
    }

    function getUserPairIds(address user) external view returns (uint256[] memory) {
        return userPairIds[user];
    }

    function getUnrealizedPnL(uint256 pairId) external view returns (int256 longPnL, int256 shortPnL) {
        PairedPosition storage pos = pairedPositions[pairId];
        if (pos.status != PositionStatus.ACTIVE) return (0, 0);
        (longPnL, shortPnL) = _calculatePnL(pos, tokenPrices[pos.token]);
        longPnL -= pos.accFundingLong;
        shortPnL -= pos.accFundingShort;
    }

    function getFilledAmount(bytes32 orderHash) external view returns (uint256) { return filledAmounts[orderHash]; }
    function getSupportedTokens() external view returns (address[] memory) { return supportedTokenList; }
    function isTokenSupported(address token) external view returns (bool) { return supportedTokens[token]; }
    function getTokenDecimals(address token) external view returns (uint8) { return tokenDecimals[token]; }
    function getUserPositionSize(address user, address token) external view returns (uint256) { return userPositionSizes[user][token]; }
    function getRemainingAmount(Order calldata order) external view returns (uint256) { return order.size - filledAmounts[getOrderHash(order)]; }

    // ============================================================
    // Internal Functions
    // ============================================================

    function _toStandardDecimals(address token, uint256 amount) internal view returns (uint256) {
        uint8 d = tokenDecimals[token];
        if (d == STANDARD_DECIMALS) return amount;
        if (d > STANDARD_DECIMALS) return amount / (10 ** (d - STANDARD_DECIMALS));
        return amount * (10 ** (STANDARD_DECIMALS - d));
    }

    function _fromStandardDecimals(address token, uint256 amount) internal view returns (uint256) {
        uint8 d = tokenDecimals[token];
        if (d == STANDARD_DECIMALS) return amount;
        if (d > STANDARD_DECIMALS) return amount * (10 ** (d - STANDARD_DECIMALS));
        return amount / (10 ** (STANDARD_DECIMALS - d));
    }

    function _hasLegacyPosition(address) internal pure returns (bool) {
        return false; // Legacy check disabled to reduce contract size
    }

    function _validateOrder(Order calldata order, bytes calldata sig, bool expectLong) internal view {
        if (order.isLong != expectLong) revert InvalidMatch();
        if (block.timestamp > order.deadline) revert OrderExpired();
        if (order.nonce != nonces[order.trader]) revert InvalidNonce();
        if (!verifyOrder(order, sig)) revert InvalidSignature();
        if (filledAmounts[getOrderHash(order)] >= order.size) revert OrderAlreadyUsed();
        if (order.leverage == 0 || order.leverage > MAX_LEVERAGE) revert InvalidMatch();
    }

    function _validateContractSpec(MatchedPair calldata pair) internal view {
        if (address(contractRegistry) == address(0)) return;
        IContractRegistry.ContractSpec memory spec = contractRegistry.getContractSpec(pair.longOrder.token);
        if (!spec.isActive) revert ContractNotActive();
        if (pair.matchSize < spec.minOrderSize) revert OrderSizeTooSmall();
        if (pair.matchSize > spec.maxOrderSize) revert OrderSizeTooBig();
        // Simplified: leverage and position limit checks moved to backend
    }

    function _calculatePnL(PairedPosition storage pos, uint256 currentPrice) internal view returns (int256 longPnL, int256 shortPnL) {
        if (pos.entryPrice == 0) return (0, 0);
        if (currentPrice >= pos.entryPrice) {
            uint256 diff = currentPrice - pos.entryPrice;
            uint256 profit = (pos.size > 0 && diff > type(uint256).max / pos.size) ? MAX_PNL : (pos.size * diff) / pos.entryPrice;
            if (profit > MAX_PNL) profit = MAX_PNL;
            longPnL = profit.toInt256();
            shortPnL = -longPnL;
        } else {
            uint256 diff = pos.entryPrice - currentPrice;
            uint256 loss = (pos.size > 0 && diff > type(uint256).max / pos.size) ? MAX_PNL : (pos.size * diff) / pos.entryPrice;
            if (loss > MAX_PNL) loss = MAX_PNL;
            longPnL = -loss.toInt256();
            shortPnL = loss.toInt256();
        }
    }
}
