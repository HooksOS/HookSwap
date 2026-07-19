// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPriceFeed.sol";

/**
 * @title PriceFeed
 * @notice 简化版价格合约 - 100%硬锚Bonding Curve现货价格
 * @dev 内盘合约价格直接使用TokenFactory的Bonding Curve价格，不做任何偏离
 */
contract PriceFeed is Ownable, IPriceFeed {
    // ============================================================
    // Constants
    // ============================================================

    uint256 public constant PRICE_PRECISION = 1e18;

    // ============================================================
    // State Variables
    // ============================================================

    // TokenFactory 合约地址
    address public tokenFactory;

    // 多代币支持
    mapping(address => bool) public supportedTokens;
    mapping(address => uint256) public tokenLastPrice;
    mapping(address => uint256) public tokenLastUpdateTime;
    address[] public tokenList;

    // ============================================================
    // Events
    // ============================================================

    event TokenPriceUpdated(address indexed token, uint256 price, uint256 timestamp);
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event TokenFactorySet(address indexed tokenFactory);

    // ============================================================
    // Errors
    // ============================================================

    error Unauthorized();
    error InvalidPrice();
    error ZeroAddress();
    error TokenNotSupported();
    error TokenAlreadySupported();

    // ============================================================
    // Modifiers
    // ============================================================

    modifier onlyTokenFactory() {
        if (msg.sender != tokenFactory) revert Unauthorized();
        _;
    }

    // ============================================================
    // Constructor
    // ============================================================

    constructor() Ownable(msg.sender) {}

    // ============================================================
    // Admin Functions
    // ============================================================

    /**
     * @notice 设置 TokenFactory 合约地址
     * @param _tokenFactory TokenFactory 地址
     */
    function setTokenFactory(address _tokenFactory) external onlyOwner {
        if (_tokenFactory == address(0)) revert ZeroAddress();
        tokenFactory = _tokenFactory;
        emit TokenFactorySet(_tokenFactory);
    }

    /**
     * @notice 添加支持的代币
     * @param token 代币地址
     * @param initialPrice 初始价格
     */
    function addSupportedToken(address token, uint256 initialPrice) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (supportedTokens[token]) revert TokenAlreadySupported();
        if (initialPrice == 0) revert InvalidPrice();

        supportedTokens[token] = true;
        tokenList.push(token);
        tokenLastPrice[token] = initialPrice;
        tokenLastUpdateTime[token] = block.timestamp;

        emit TokenAdded(token);
        emit TokenPriceUpdated(token, initialPrice, block.timestamp);
    }

    /**
     * @notice TokenFactory 自动添加代币支持
     * @param token 代币地址
     * @param initialPrice 初始价格
     */
    function addSupportedTokenFromFactory(address token, uint256 initialPrice) external onlyTokenFactory {
        if (token == address(0)) revert ZeroAddress();
        if (supportedTokens[token]) return; // 已支持则跳过
        if (initialPrice == 0) revert InvalidPrice();

        supportedTokens[token] = true;
        tokenList.push(token);
        tokenLastPrice[token] = initialPrice;
        tokenLastUpdateTime[token] = block.timestamp;

        emit TokenAdded(token);
        emit TokenPriceUpdated(token, initialPrice, block.timestamp);
    }

    /**
     * @notice 移除支持的代币
     * @param token 代币地址
     */
    function removeSupportedToken(address token) external onlyOwner {
        if (!supportedTokens[token]) revert TokenNotSupported();

        supportedTokens[token] = false;

        // 从列表中移除
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokenList[i] == token) {
                tokenList[i] = tokenList[tokenList.length - 1];
                tokenList.pop();
                break;
            }
        }

        emit TokenRemoved(token);
    }

    // ============================================================
    // Price Update Functions
    // ============================================================

    /**
     * @notice 由 TokenFactory 在每次交易后调用更新价格
     * @param token 代币地址
     * @param newPrice 新价格
     */
    function updateTokenPriceFromFactory(address token, uint256 newPrice) external onlyTokenFactory {
        // 如果代币未支持，静默跳过
        if (!supportedTokens[token]) return;
        if (newPrice == 0) return;

        tokenLastPrice[token] = newPrice;
        tokenLastUpdateTime[token] = block.timestamp;

        emit TokenPriceUpdated(token, newPrice, block.timestamp);
    }

    // ============================================================
    // View Functions
    // ============================================================

    /**
     * @notice 检查代币是否支持
     */
    function isTokenSupported(address token) external view returns (bool) {
        return supportedTokens[token];
    }

    /**
     * @notice 获取代币现货价格
     */
    function getTokenSpotPrice(address token) external view returns (uint256) {
        if (!supportedTokens[token]) revert TokenNotSupported();
        return tokenLastPrice[token];
    }

    /**
     * @notice 获取代币标记价格（直接返回现货价格，100%硬锚）
     * @dev 内盘合约不做任何价格偏离，直接使用Bonding Curve价格
     */
    function getTokenMarkPrice(address token) external view returns (uint256) {
        if (!supportedTokens[token]) revert TokenNotSupported();
        return tokenLastPrice[token];
    }

    /**
     * @notice 获取代币最后更新时间
     */
    function getTokenLastUpdateTime(address token) external view returns (uint256) {
        if (!supportedTokens[token]) revert TokenNotSupported();
        return tokenLastUpdateTime[token];
    }

    /**
     * @notice 获取所有支持的代币列表
     */
    function getSupportedTokens() external view returns (address[] memory) {
        return tokenList;
    }

    /**
     * @notice 获取支持的代币数量
     */
    function getSupportedTokenCount() external view returns (uint256) {
        return tokenList.length;
    }

    // ============================================================
    // Legacy Interface Compatibility (为了兼容旧代码)
    // ============================================================

    /**
     * @notice 获取标记价格（Legacy接口，返回第一个代币的价格）
     * @dev 向后兼容：返回 tokenList[0] 的价格
     */
    function getMarkPrice() external view returns (uint256) {
        if (tokenList.length == 0) return 0;
        return tokenLastPrice[tokenList[0]];
    }

    /**
     * @notice 获取现货价格（Legacy接口，返回第一个代币的价格）
     * @dev 向后兼容：返回 tokenList[0] 的价格
     */
    function getSpotPrice() external view returns (uint256) {
        if (tokenList.length == 0) return 0;
        return tokenLastPrice[tokenList[0]];
    }

    /**
     * @notice 获取最后更新时间（Legacy接口）
     * @dev 向后兼容：返回 tokenList[0] 的最后更新时间
     */
    function getLastUpdateTime() external view returns (uint256) {
        if (tokenList.length == 0) return 0;
        return tokenLastUpdateTime[tokenList[0]];
    }

    /**
     * @notice 更新价格（Legacy接口，no-op，保持AMM兼容性）
     * @dev 价格更新现在只通过 updateTokenPriceFromFactory 进行
     */
    function updatePrice(uint256) external {
        // No-op: 旧接口保持兼容，但不做任何操作
    }

    /**
     * @notice 更新代币价格（Legacy接口，no-op）
     */
    function updateTokenPrice(address, uint256) external {
        // No-op: 旧接口保持兼容，但不做任何操作
    }
}
