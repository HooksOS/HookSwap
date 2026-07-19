// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title SessionKeyManager
 * @notice HookSwapPerps session-key manager — split out of Settlement to reduce contract size.
 * @dev EIP-712 DOMAIN: ("HookSwapPerps","1") — MUST match Settlement.sol and every off-chain signer
 *      of session-key grants. Rebranded from "MemePerp" (upstream meme-perp-dex). See README.md.
 */
contract SessionKeyManager is Ownable, EIP712 {
    using ECDSA for bytes32;

    // ============================================================
    // Structs
    // ============================================================

    struct SessionKeyAuth {
        uint256 maxAmount;
        uint256 dailyLimit;
        uint256 usedToday;
        uint256 lastResetDay;
        uint256 expiry;
        bool canDeposit;
        bool canTrade;
        bool canWithdraw;
        bool isActive;
    }

    struct SessionKeyParams {
        address sessionKey;
        uint256 maxAmount;
        uint256 dailyLimit;
        uint256 expiry;
        bool canDeposit;
        bool canTrade;
        bool canWithdraw;
    }

    // ============================================================
    // State Variables
    // ============================================================

    mapping(address => mapping(address => SessionKeyAuth)) public sessionKeys;
    mapping(address => address[]) public userSessionKeys;
    mapping(address => uint256) public nonces;

    bytes32 public constant SESSION_KEY_TYPEHASH = keccak256(
        "SessionKeyAuth(address sessionKey,uint256 maxAmount,uint256 dailyLimit,uint256 expiry,bool canDeposit,bool canTrade,bool canWithdraw,uint256 nonce)"
    );

    // ============================================================
    // Events
    // ============================================================

    event SessionKeyAuthorized(address indexed user, address indexed sessionKey, uint256 maxAmount, uint256 dailyLimit, uint256 expiry);
    event SessionKeyRevoked(address indexed user, address indexed sessionKey);
    event SessionKeyUsed(address indexed user, address indexed sessionKey, uint256 amount, string action);

    // ============================================================
    // Errors
    // ============================================================

    error InvalidSignature();
    error SessionKeyExpired();
    error SessionKeyNotActive();
    error SessionKeyDailyLimitExceeded();
    error SessionKeyAmountExceeded();
    error SessionKeyPermissionDenied();

    // ============================================================
    // Constructor
    // ============================================================

    constructor() Ownable(msg.sender) EIP712("HookSwapPerps", "1") {}

    // ============================================================
    // External Functions
    // ============================================================

    function authorizeSessionKey(
        address sessionKey,
        uint256 maxAmount,
        uint256 dailyLimit,
        uint256 expiry,
        bool canDeposit,
        bool canTrade,
        bool canWithdraw
    ) external {
        require(sessionKey != address(0), "Invalid session key");
        require(expiry > block.timestamp, "Expiry must be in future");

        if (!sessionKeys[msg.sender][sessionKey].isActive) {
            userSessionKeys[msg.sender].push(sessionKey);
        }

        sessionKeys[msg.sender][sessionKey] = SessionKeyAuth({
            maxAmount: maxAmount,
            dailyLimit: dailyLimit,
            usedToday: 0,
            lastResetDay: block.timestamp / 1 days,
            expiry: expiry,
            canDeposit: canDeposit,
            canTrade: canTrade,
            canWithdraw: canWithdraw,
            isActive: true
        });

        emit SessionKeyAuthorized(msg.sender, sessionKey, maxAmount, dailyLimit, expiry);
    }

    function authorizeSessionKeyWithSignature(
        address user,
        SessionKeyParams calldata params,
        bytes calldata signature
    ) external {
        require(params.sessionKey != address(0), "Invalid session key");
        require(params.expiry > block.timestamp, "Expiry must be in future");

        bytes32 structHash = keccak256(abi.encode(
            SESSION_KEY_TYPEHASH,
            params.sessionKey,
            params.maxAmount,
            params.dailyLimit,
            params.expiry,
            params.canDeposit,
            params.canTrade,
            params.canWithdraw,
            nonces[user]
        ));

        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, signature);
        if (signer != user) revert InvalidSignature();

        nonces[user]++;

        if (!sessionKeys[user][params.sessionKey].isActive) {
            userSessionKeys[user].push(params.sessionKey);
        }

        sessionKeys[user][params.sessionKey] = SessionKeyAuth({
            maxAmount: params.maxAmount,
            dailyLimit: params.dailyLimit,
            usedToday: 0,
            lastResetDay: block.timestamp / 1 days,
            expiry: params.expiry,
            canDeposit: params.canDeposit,
            canTrade: params.canTrade,
            canWithdraw: params.canWithdraw,
            isActive: true
        });

        emit SessionKeyAuthorized(user, params.sessionKey, params.maxAmount, params.dailyLimit, params.expiry);
    }

    function revokeSessionKey(address sessionKey) external {
        sessionKeys[msg.sender][sessionKey].isActive = false;
        emit SessionKeyRevoked(msg.sender, sessionKey);
    }

    function validateAndUseSessionKey(
        address user,
        address sessionKey,
        uint256 amount,
        bool needDeposit,
        bool needTrade,
        bool needWithdraw
    ) external {
        _validateSessionKey(user, sessionKey, amount, needDeposit, needTrade, needWithdraw);
        _useSessionKeyQuota(user, sessionKey, amount);
    }

    function validateSessionKey(
        address user,
        address sessionKey,
        uint256 amount,
        bool needDeposit,
        bool needTrade,
        bool needWithdraw
    ) external view {
        _validateSessionKey(user, sessionKey, amount, needDeposit, needTrade, needWithdraw);
    }

    // ============================================================
    // View Functions
    // ============================================================

    function getSessionKey(address user, address sessionKey) external view returns (SessionKeyAuth memory) {
        return sessionKeys[user][sessionKey];
    }

    function getUserSessionKeys(address user) external view returns (address[] memory) {
        return userSessionKeys[user];
    }

    function isSessionKeyValid(address user, address sessionKey) external view returns (bool) {
        SessionKeyAuth storage auth = sessionKeys[user][sessionKey];
        return auth.isActive && block.timestamp <= auth.expiry;
    }

    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    // ============================================================
    // Internal Functions
    // ============================================================

    function _validateSessionKey(
        address user,
        address sessionKey,
        uint256 amount,
        bool needDeposit,
        bool needTrade,
        bool needWithdraw
    ) internal view {
        SessionKeyAuth storage auth = sessionKeys[user][sessionKey];
        if (!auth.isActive) revert SessionKeyNotActive();
        if (block.timestamp > auth.expiry) revert SessionKeyExpired();
        if (amount > auth.maxAmount) revert SessionKeyAmountExceeded();
        uint256 currentDay = block.timestamp / 1 days;
        uint256 usedAmount = auth.lastResetDay == currentDay ? auth.usedToday : 0;
        if (usedAmount + amount > auth.dailyLimit) revert SessionKeyDailyLimitExceeded();
        if (needDeposit && !auth.canDeposit) revert SessionKeyPermissionDenied();
        if (needTrade && !auth.canTrade) revert SessionKeyPermissionDenied();
        if (needWithdraw && !auth.canWithdraw) revert SessionKeyPermissionDenied();
    }

    function _useSessionKeyQuota(address user, address sessionKey, uint256 amount) internal {
        SessionKeyAuth storage auth = sessionKeys[user][sessionKey];
        uint256 currentDay = block.timestamp / 1 days;
        if (auth.lastResetDay != currentDay) {
            auth.usedToday = 0;
            auth.lastResetDay = currentDay;
        }
        auth.usedToday += amount;
    }
}
