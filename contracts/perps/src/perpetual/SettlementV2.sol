// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title SettlementV2
 * @notice Mode 2: Off-chain Execution + On-chain Attestation
 *
 * Architecture:
 * - All trading (matching, positions, PnL) happens OFF-CHAIN
 * - This contract handles ONLY:
 *   1. Fund custody (deposits)
 *   2. State root attestation (Merkle root snapshots)
 *   3. Verified withdrawals (with Merkle proof + platform signature)
 *
 * Similar to dYdX, Injective, Hyperliquid approach where blockchain is
 * the "notary" and "final settlement house", not a real-time database.
 *
 * NOTE ON EIP-712 DOMAIN: upstream this contract used the domain ("SettlementV2","1")
 * — it did NOT use "MemePerp" (that was Settlement.sol / SessionKeyManager.sol). It is
 * rebranded here to ("HookSwapPerpsV2","1"). Its withdrawal-authorization signatures are
 * produced by the platform signer (backend), so this domain must sync with the backend's
 * SettlementV2 signer config, independently of the primary ("HookSwapPerps","1") order domain.
 */
contract SettlementV2 is Ownable, ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ============================================================
    // Constants
    // ============================================================

    uint256 public constant PRECISION = 1e6; // USDT has 6 decimals

    // EIP-712 type hash for withdrawal authorization
    bytes32 public constant WITHDRAWAL_TYPEHASH = keccak256(
        "Withdrawal(address user,uint256 amount,uint256 nonce,uint256 deadline,bytes32 merkleRoot)"
    );

    // ============================================================
    // State Variables
    // ============================================================

    // Platform signer for withdrawal authorizations
    address public platformSigner;

    // Supported collateral token (USDT)
    IERC20 public collateralToken;

    // User deposits (total amount deposited, before any withdrawals)
    mapping(address => uint256) public userDeposits;

    // User withdrawal nonces (for replay protection)
    mapping(address => uint256) public withdrawalNonces;

    // Total withdrawn by each user
    mapping(address => uint256) public totalWithdrawn;

    // ============================================================
    // State Root Attestation
    // ============================================================

    struct StateRoot {
        bytes32 root;
        uint256 timestamp;
        uint256 blockNumber;
    }

    // Current state root
    StateRoot public currentStateRoot;

    // Historical state roots (for dispute resolution)
    StateRoot[] public stateRootHistory;

    // Authorized state root updaters
    mapping(address => bool) public authorizedUpdaters;

    // ============================================================
    // Events
    // ============================================================

    event Deposited(address indexed user, uint256 amount, uint256 totalDeposits);
    event DepositedFor(address indexed user, address indexed relayer, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, uint256 nonce);
    event StateRootUpdated(bytes32 indexed root, uint256 timestamp, uint256 snapshotId);
    event PlatformSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event UpdaterAuthorized(address indexed updater, bool authorized);

    // ============================================================
    // Errors
    // ============================================================

    error InvalidAmount();
    error InvalidSignature();
    error InvalidProof();
    error InvalidNonce();
    error DeadlineExpired();
    error InsufficientEquity();
    error UnauthorizedUpdater();
    error ZeroAddress();

    // ============================================================
    // Constructor
    // ============================================================

    constructor(
        address _collateralToken,
        address _platformSigner,
        address _owner
    ) Ownable(_owner) EIP712("HookSwapPerpsV2", "1") {
        if (_collateralToken == address(0)) revert ZeroAddress();
        if (_platformSigner == address(0)) revert ZeroAddress();

        collateralToken = IERC20(_collateralToken);
        platformSigner = _platformSigner;
    }

    // ============================================================
    // Deposit Functions
    // ============================================================

    /**
     * @notice Deposit collateral tokens
     * @param amount Amount to deposit (in token's native decimals)
     */
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        userDeposits[msg.sender] += amount;

        emit Deposited(msg.sender, amount, userDeposits[msg.sender]);
    }

    /**
     * @notice Deposit on behalf of another user (for relayer/gasless deposits)
     * @param user The user to credit
     * @param amount Amount to deposit
     */
    function depositFor(address user, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (user == address(0)) revert ZeroAddress();

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        userDeposits[user] += amount;

        emit DepositedFor(user, msg.sender, amount);
    }

    // ============================================================
    // Withdrawal Functions (with Merkle Proof + Platform Signature)
    // ============================================================

    /**
     * @notice Withdraw with Merkle proof and platform signature
     *
     * Flow:
     * 1. User requests withdrawal from backend
     * 2. Backend verifies user's equity in latest Merkle snapshot
     * 3. Backend generates Merkle proof + EIP-712 signature
     * 4. User submits this transaction with all parameters
     *
     * @param amount Amount to withdraw
     * @param userEquity User's total equity from Merkle leaf
     * @param merkleProof Proof that (user, equity) is in the tree
     * @param deadline Signature expiration timestamp
     * @param signature Platform's EIP-712 signature
     */
    function withdraw(
        uint256 amount,
        uint256 userEquity,
        bytes32[] calldata merkleProof,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (block.timestamp > deadline) revert DeadlineExpired();

        address user = msg.sender;
        uint256 nonce = withdrawalNonces[user];

        // 1. Verify Merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(user, userEquity));
        if (!MerkleProof.verify(merkleProof, currentStateRoot.root, leaf)) {
            revert InvalidProof();
        }

        // 2. Check user has enough equity
        // User can only withdraw up to their equity minus previous withdrawals
        uint256 maxWithdrawable = userEquity > totalWithdrawn[user]
            ? userEquity - totalWithdrawn[user]
            : 0;
        if (amount > maxWithdrawable) revert InsufficientEquity();

        // 3. Verify platform signature (EIP-712)
        bytes32 structHash = keccak256(
            abi.encode(
                WITHDRAWAL_TYPEHASH,
                user,
                amount,
                nonce,
                deadline,
                currentStateRoot.root
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, signature);
        if (recoveredSigner != platformSigner) revert InvalidSignature();

        // 4. Update state
        withdrawalNonces[user] = nonce + 1;
        totalWithdrawn[user] += amount;

        // 5. Transfer tokens
        collateralToken.safeTransfer(user, amount);

        emit Withdrawn(user, amount, nonce);
    }

    /**
     * @notice Get user's withdrawable balance based on current state root
     * @dev This is a view function - actual withdrawal requires proof
     */
    function getWithdrawableBalance(address user, uint256 userEquity) external view returns (uint256) {
        if (userEquity <= totalWithdrawn[user]) return 0;
        return userEquity - totalWithdrawn[user];
    }

    // ============================================================
    // State Root Management
    // ============================================================

    /**
     * @notice Update the state root (Merkle root of all user equities)
     * @dev Can only be called by authorized updaters
     * @param newRoot New Merkle root
     */
    function updateStateRoot(bytes32 newRoot) external {
        if (!authorizedUpdaters[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedUpdater();
        }

        // Store current root in history before updating
        if (currentStateRoot.root != bytes32(0)) {
            stateRootHistory.push(currentStateRoot);
        }

        currentStateRoot = StateRoot({
            root: newRoot,
            timestamp: block.timestamp,
            blockNumber: block.number
        });

        emit StateRootUpdated(newRoot, block.timestamp, stateRootHistory.length);
    }

    /**
     * @notice Get state root history length
     */
    function getStateRootHistoryLength() external view returns (uint256) {
        return stateRootHistory.length;
    }

    /**
     * @notice Get historical state root by index
     */
    function getStateRootByIndex(uint256 index) external view returns (StateRoot memory) {
        return stateRootHistory[index];
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    /**
     * @notice Update platform signer address
     */
    function setPlatformSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        address oldSigner = platformSigner;
        platformSigner = newSigner;
        emit PlatformSignerUpdated(oldSigner, newSigner);
    }

    /**
     * @notice Authorize/deauthorize state root updaters
     */
    function setAuthorizedUpdater(address updater, bool authorized) external onlyOwner {
        if (updater == address(0)) revert ZeroAddress();
        authorizedUpdaters[updater] = authorized;
        emit UpdaterAuthorized(updater, authorized);
    }

    // ============================================================
    // View Functions
    // ============================================================

    /**
     * @notice Get user's total deposits
     */
    function getUserDeposits(address user) external view returns (uint256) {
        return userDeposits[user];
    }

    /**
     * @notice Get user's withdrawal nonce
     */
    function getUserNonce(address user) external view returns (uint256) {
        return withdrawalNonces[user];
    }

    /**
     * @notice Get user's total withdrawn amount
     */
    function getUserTotalWithdrawn(address user) external view returns (uint256) {
        return totalWithdrawn[user];
    }

    /**
     * @notice Verify a Merkle proof (helper for off-chain verification)
     */
    function verifyMerkleProof(
        address user,
        uint256 equity,
        bytes32[] calldata proof
    ) external view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(user, equity));
        return MerkleProof.verify(proof, currentStateRoot.root, leaf);
    }

    /**
     * @notice Get EIP-712 domain separator
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
