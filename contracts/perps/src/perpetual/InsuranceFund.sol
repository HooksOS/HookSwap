// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title InsuranceFund
 * @notice 保险基金合约 - 用于支付交易者盈利和覆盖穿仓损失 (ETH 本位)
 * @dev ETH 本位模式: collateralToken 为零地址，使用原生 ETH
 *      资金来源：
 *      1. 初始注入 ETH
 *      2. 资金费 (每5分钟从所有仓位收取，每日批量转入)
 *      3. 清算罚金 (清算罚金的50%，每日批量转入)
 *      资金用途：
 *      1. 支付交易者盈利
 *      2. 覆盖穿仓亏空
 *      3. 当 Settlement 合约资金不足时注入
 */
contract InsuranceFund is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    // ============================================================
    // State Variables
    // ============================================================

    /// @notice 抵押代币地址 (ETH 本位时为零地址)
    IERC20 public collateralToken;

    /// @notice Settlement 合约地址
    address public settlement;

    /// @notice Vault 合约地址
    address public vault;

    /// @notice PositionManager 合约地址
    address public positionManager;

    /// @notice 授权可以调用的合约
    mapping(address => bool) public authorizedContracts;

    /// @notice 最低保留余额 (防止基金完全耗尽) - 18 decimals for ETH
    uint256 public minReserve = 1 ether; // 1 ETH (约 $2,500)

    /// @notice 单次最大支付比例 (相对于总余额, 以 10000 为基数)
    uint256 public maxPayoutRatio = 5000; // 50%

    // ============================================================
    // Tracking Variables (for statistics)
    // ============================================================

    /// @notice 累计收到的资金费
    uint256 public totalFundingReceived;

    /// @notice 累计收到的清算罚金
    uint256 public totalLiquidationReceived;

    /// @notice 累计注入 Settlement 的金额
    uint256 public totalInjected;

    // ============================================================
    // Events
    // ============================================================

    event Deposit(address indexed from, uint256 amount);
    event ProfitPaid(address indexed user, uint256 requested, uint256 paid);
    event LossCovered(address indexed user, uint256 amount);
    event DeficitCovered(uint256 requested, uint256 covered);
    event AuthorizedContractSet(address indexed contractAddr, bool authorized);
    event MinReserveSet(uint256 oldValue, uint256 newValue);
    event MaxPayoutRatioSet(uint256 oldValue, uint256 newValue);
    event FundingReceived(uint256 amount, uint256 timestamp);
    event LiquidationPenaltyReceived(uint256 amount, uint256 timestamp);
    event InjectedToSettlement(address indexed settlement, uint256 amount, uint256 timestamp);
    event CollateralTokenSet(address indexed token);
    event SettlementSet(address indexed settlement);

    // ============================================================
    // Errors
    // ============================================================

    error Unauthorized();
    error ZeroAddress();
    error InsufficientFunds();
    error TransferFailed();
    error InvalidAmount();

    // ============================================================
    // Modifiers
    // ============================================================

    modifier onlyAuthorized() {
        if (!authorizedContracts[msg.sender] && msg.sender != owner()) {
            revert Unauthorized();
        }
        _;
    }

    // ============================================================
    // Constructor
    // ============================================================

    /// @notice 构造函数（ETH 模式，向后兼容）
    constructor() Ownable(msg.sender) {
        // ETH 模式，collateralToken 保持为零地址
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    function setCollateralToken(address _collateralToken) external onlyOwner {
        if (_collateralToken == address(0)) revert ZeroAddress();
        collateralToken = IERC20(_collateralToken);
        emit CollateralTokenSet(_collateralToken);
    }

    function setSettlement(address _settlement) external onlyOwner {
        if (_settlement == address(0)) revert ZeroAddress();
        settlement = _settlement;
        authorizedContracts[_settlement] = true;
        emit SettlementSet(_settlement);
        emit AuthorizedContractSet(_settlement, true);
    }

    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        vault = _vault;
        authorizedContracts[_vault] = true;
        emit AuthorizedContractSet(_vault, true);
    }

    function setPositionManager(address _positionManager) external onlyOwner {
        if (_positionManager == address(0)) revert ZeroAddress();
        positionManager = _positionManager;
        authorizedContracts[_positionManager] = true;
        emit AuthorizedContractSet(_positionManager, true);
    }

    function setAuthorizedContract(address contractAddr, bool authorized) external onlyOwner {
        authorizedContracts[contractAddr] = authorized;
        emit AuthorizedContractSet(contractAddr, authorized);
    }

    function setMinReserve(uint256 _minReserve) external onlyOwner {
        emit MinReserveSet(minReserve, _minReserve);
        minReserve = _minReserve;
    }

    function setMaxPayoutRatio(uint256 _maxPayoutRatio) external onlyOwner {
        require(_maxPayoutRatio <= 10000, "Ratio too high");
        emit MaxPayoutRatioSet(maxPayoutRatio, _maxPayoutRatio);
        maxPayoutRatio = _maxPayoutRatio;
    }

    // ============================================================
    // Deposit Functions
    // ============================================================

    /// @notice 向保险基金存入 ETH (deprecated, use depositToken instead)
    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice 存入 ETH 资金 (deprecated)
    function deposit() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice 存入 ERC20 代币资金 (仅 ERC20 模式，非 ETH 本位)
    /// @param amount 存入金额
    function depositToken(uint256 amount) external {
        if (isETHMode()) revert InvalidAmount();
        if (amount == 0) revert InvalidAmount();
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(msg.sender, amount);
    }

    // ============================================================
    // Settlement Integration Functions (ERC20 模式)
    // ============================================================

    /**
     * @notice 接收资金费 (由 Settlement 调用, 仅 ERC20 模式)
     * @dev Settlement 合约日结时调用此函数
     * @param amount 资金费金额
     */
    function receiveFunding(uint256 amount) external onlyAuthorized {
        if (amount == 0) return;
        if (isETHMode()) revert InvalidAmount();
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        totalFundingReceived += amount;
        emit FundingReceived(amount, block.timestamp);
    }

    /**
     * @notice 接收清算罚金 (由 Settlement 调用, 仅 ERC20 模式)
     * @dev Settlement 合约日结时调用此函数
     * @param amount 清算罚金金额
     */
    function receiveLiquidationPenalty(uint256 amount) external onlyAuthorized {
        if (amount == 0) return;
        if (isETHMode()) revert InvalidAmount();
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        totalLiquidationReceived += amount;
        emit LiquidationPenaltyReceived(amount, block.timestamp);
    }

    /**
     * @notice 注入资金到 Settlement 合约 (支持 ETH 和 ERC20)
     * @dev 当 Settlement 合约资金不足时调用
     * @param to 目标地址 (应为 Settlement 合约)
     * @param amount 注入金额
     */
    function injectTo(address to, uint256 amount) external onlyAuthorized nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();

        uint256 balance = getBalance();
        uint256 available = balance > minReserve ? balance - minReserve : 0;

        if (amount > available) revert InsufficientFunds();

        if (isETHMode()) {
            (bool success, ) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            collateralToken.safeTransfer(to, amount);
        }
        totalInjected += amount;

        emit InjectedToSettlement(to, amount, block.timestamp);
    }

    // ============================================================
    // Core Functions (Called by Vault/PositionManager)
    // ============================================================

    /**
     * @notice 支付用户盈利 (支持 ETH 和 ERC20)
     * @dev 由 Vault 或 PositionManager 调用
     * @param user 接收盈利的用户地址
     * @param amount 请求支付的金额
     * @return paid 实际支付的金额
     */
    function payProfit(address user, uint256 amount) external onlyAuthorized nonReentrant returns (uint256 paid) {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) return 0;

        uint256 balance = getBalance();

        // 计算可用于支付的金额 (保留最低储备)
        uint256 available = balance > minReserve ? balance - minReserve : 0;

        // 限制单次最大支付
        uint256 maxPayout = (balance * maxPayoutRatio) / 10000;
        available = available > maxPayout ? maxPayout : available;

        // 实际支付金额
        paid = amount > available ? available : amount;

        if (paid > 0) {
            if (isETHMode()) {
                (bool success, ) = user.call{value: paid}("");
                if (!success) revert TransferFailed();
            } else {
                collateralToken.safeTransfer(user, paid);
            }
        }

        emit ProfitPaid(user, amount, paid);
        return paid;
    }

    /**
     * @notice 支付盈利到 Vault (用于 Cross Margin 模式)
     * @dev 将盈利转入 Vault，由 Vault 记账给用户
     * @param user 用户地址 (用于记录)
     * @param amount 请求金额
     * @return paid 实际支付金额
     */
    function payProfitToVault(address user, uint256 amount) external onlyAuthorized nonReentrant returns (uint256 paid) {
        if (vault == address(0)) revert ZeroAddress();
        if (amount == 0) return 0;

        uint256 balance = getBalance();
        uint256 available = balance > minReserve ? balance - minReserve : 0;
        uint256 maxPayout = (balance * maxPayoutRatio) / 10000;
        available = available > maxPayout ? maxPayout : available;

        paid = amount > available ? available : amount;

        if (paid > 0) {
            if (isETHMode()) {
                (bool success, ) = vault.call{value: paid}("");
                if (!success) revert TransferFailed();
            } else {
                collateralToken.safeTransfer(vault, paid);
            }
        }

        emit ProfitPaid(user, amount, paid);
        return paid;
    }

    /**
     * @notice 接收亏损资金 (ETH 版本 - 向后兼容)
     * @dev 由 Vault 调用，将交易者亏损转入保险基金
     */
    function receiveLoss() external payable onlyAuthorized {
        emit LossCovered(msg.sender, msg.value);
    }

    /**
     * @notice 接收亏损资金 (ERC20 版本)
     * @dev 由 Vault 调用，将交易者亏损转入保险基金
     * @param amount 亏损金额
     */
    function receiveLossToken(uint256 amount) external onlyAuthorized {
        if (amount == 0) return;
        if (isETHMode()) revert InvalidAmount();
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        emit LossCovered(msg.sender, amount);
    }

    /**
     * @notice 覆盖穿仓亏空 (支持 ETH 和 ERC20)
     * @dev 当交易者穿仓时，保险基金覆盖亏空
     * @param amount 请求覆盖的金额
     * @return covered 实际覆盖的金额
     */
    function coverDeficit(uint256 amount) external onlyAuthorized nonReentrant returns (uint256 covered) {
        uint256 balance = getBalance();
        uint256 available = balance > minReserve ? balance - minReserve : 0;

        covered = amount > available ? available : amount;

        if (covered > 0) {
            if (isETHMode()) {
                (bool success, ) = msg.sender.call{value: covered}("");
                if (!success) revert TransferFailed();
            } else {
                collateralToken.safeTransfer(msg.sender, covered);
            }
        }

        emit DeficitCovered(amount, covered);
        return covered;
    }

    // ============================================================
    // View Functions
    // ============================================================

    /// @notice 检查是否为 ETH 模式
    function isETHMode() public view returns (bool) {
        return address(collateralToken) == address(0);
    }

    /// @notice 获取保险基金余额 (支持 ETH 和 ERC20)
    function getBalance() public view returns (uint256) {
        if (isETHMode()) {
            return address(this).balance;
        }
        return collateralToken.balanceOf(address(this));
    }

    /// @notice 获取可用于支付的余额
    function getAvailableBalance() external view returns (uint256) {
        uint256 balance = getBalance();
        return balance > minReserve ? balance - minReserve : 0;
    }

    /// @notice 检查是否能支付指定金额
    function canPay(uint256 amount) external view returns (bool, uint256 actualPayable) {
        uint256 balance = getBalance();
        uint256 available = balance > minReserve ? balance - minReserve : 0;
        uint256 maxPayout = (balance * maxPayoutRatio) / 10000;
        available = available > maxPayout ? maxPayout : available;

        actualPayable = amount > available ? available : amount;
        return (actualPayable >= amount, actualPayable);
    }

    /// @notice 获取统计数据
    function getStatistics() external view returns (
        uint256 balance,
        uint256 _totalFundingReceived,
        uint256 _totalLiquidationReceived,
        uint256 _totalInjected,
        int256 netIncome
    ) {
        balance = getBalance();
        _totalFundingReceived = totalFundingReceived;
        _totalLiquidationReceived = totalLiquidationReceived;
        _totalInjected = totalInjected;
        netIncome = int256(totalFundingReceived + totalLiquidationReceived) - int256(totalInjected);
    }

    // ============================================================
    // Emergency Functions
    // ============================================================

    /// @notice 紧急提取 ETH (仅限 owner)
    function emergencyWithdrawETH(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount > address(this).balance) revert InsufficientFunds();

        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /// @notice 紧急提取 ERC20 (仅限 owner)
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = getBalance();
        if (amount > balance) revert InsufficientFunds();

        collateralToken.safeTransfer(to, amount);
    }

    /// @notice 紧急提取任意 ERC20 代币 (仅限 owner)
    function emergencyWithdrawToken(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(0)) revert ZeroAddress();

        IERC20(token).safeTransfer(to, amount);
    }
}
