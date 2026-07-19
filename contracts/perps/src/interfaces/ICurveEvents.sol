// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ICurveEvents
 * @notice Bonding Curve 标准事件接口
 * @dev 定义代币创建、交易、毕业的完整事件规范，供后端监听和前端展示使用
 */
interface ICurveEvents {

    /**
     * @notice 代币创建事件 (包含完整元数据，后端无需二次查询)
     * @param tokenAddress 代币合约地址 (索引)
     * @param creator 创建者地址 (索引)
     * @param name 代币名称
     * @param symbol 代币符号
     * @param uri Metadata IPFS 链接
     * @param totalSupply 总供应量
     */
    event TokenCreated(
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol,
        string uri,
        uint256 totalSupply
    );

    /**
     * @notice 交易事件 (合并买卖，包含虚拟储备量用于计算 K 线价格)
     * @param tokenAddress 代币地址 (索引)
     * @param trader 交易者地址 (索引)
     * @param isBuy true = 买入, false = 卖出
     * @param ethAmount 交易金额 (ETH)
     * @param tokenAmount 交易数量 (Token)
     * @param virtualEthReserves 虚拟 ETH 储备 (价格 = virtualEthReserves / virtualTokenReserves)
     * @param virtualTokenReserves 虚拟 Token 储备
     * @param timestamp 交易时间戳
     */
    event Trade(
        address indexed tokenAddress,
        address indexed trader,
        bool isBuy,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 virtualEthReserves,
        uint256 virtualTokenReserves,
        uint256 timestamp
    );

    /**
     * @notice 毕业/流动性迁移事件 (包含 DEX 交易对地址)
     * @param tokenAddress 代币地址 (索引)
     * @param pairAddress DEX 交易对地址 (用于前端跳转)
     * @param ethLiquidity 注入 DEX 的 ETH 数量
     * @param tokenLiquidity 注入 DEX 的 Token 数量
     * @param timestamp 上市时间
     */
    event LiquidityMigrated(
        address indexed tokenAddress,
        address indexed pairAddress,
        uint256 ethLiquidity,
        uint256 tokenLiquidity,
        uint256 timestamp
    );
}
