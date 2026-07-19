// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IContractRegistry
 * @notice 合约规格注册表接口
 */
interface IContractRegistry {
    /// @notice 合约规格
    struct ContractSpec {
        uint256 contractSize;       // 合约面值：1张合约 = 多少代币
        uint256 tickSize;           // 最小变动价格
        uint8 priceDecimals;        // 价格精度位数
        uint8 quantityDecimals;     // 数量精度位数
        uint256 minOrderSize;       // 最小下单张数
        uint256 maxOrderSize;       // 单笔最大张数
        uint256 maxPositionSize;    // 单用户持仓限额
        uint256 maxLeverage;        // 最大杠杆
        uint256 imRate;             // 初始保证金率
        uint256 mmRate;             // 维持保证金率
        uint256 maxPriceDeviation;  // 限价单最大偏离
        bool isActive;              // 是否可交易
        uint256 createdAt;          // 创建时间
    }

    /// @notice 保证金阶梯
    struct MarginTier {
        uint256 positionSize;       // 仓位阈值
        uint256 mmRate;             // 该档维持保证金率
        uint256 maxLeverage;        // 该档最大杠杆
    }

    /// @notice 获取合约规格
    function getContractSpec(address token) external view returns (ContractSpec memory);

    /// @notice 获取保证金要求
    function getMarginRequirement(address token, uint256 positionSize) external view returns (uint256 mmRate, uint256 maxLev);

    /// @notice 验证合约是否激活
    function isContractActive(address token) external view returns (bool);

    /// @notice 获取默认合约规格
    function getDefaultContractSpec() external view returns (ContractSpec memory);
}
