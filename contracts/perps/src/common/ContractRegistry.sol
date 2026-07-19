// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IContractRegistry.sol";

/**
 * @title ContractRegistry
 * @notice 合约规格注册表 - 管理所有交易对的合约规格和保证金阶梯
 * @dev 从 Settlement 合约分离出来以减小合约大小
 */
contract ContractRegistry is Ownable, IContractRegistry {
    // ============================================================
    // Constants
    // ============================================================

    uint256 public constant LEVERAGE_PRECISION = 1e4; // 1x = 10000
    uint256 public constant MAX_LEVERAGE = 100 * LEVERAGE_PRECISION; // 100x

    // ============================================================
    // State Variables
    // ============================================================

    /// @notice 合约规格: token => ContractSpec
    mapping(address => ContractSpec) public contractSpecs;

    /// @notice 保证金阶梯: token => MarginTier[]
    mapping(address => MarginTier[]) internal _marginTiers;

    /// @notice 默认合约规格（新代币使用）
    ContractSpec public defaultContractSpec;

    // ============================================================
    // Events
    // ============================================================

    event ContractSpecSet(
        address indexed token,
        uint256 contractSize,
        uint256 tickSize,
        uint256 maxLeverage,
        uint256 mmRate
    );
    event MarginTiersSet(address indexed token, uint256 tierCount);
    event DefaultContractSpecSet(uint256 contractSize, uint256 maxLeverage);

    // ============================================================
    // Errors
    // ============================================================

    error InvalidContractSpec();

    // ============================================================
    // Constructor
    // ============================================================

    constructor() Ownable(msg.sender) {
        // 设置默认合约规格（适用于 Meme 币）
        // 注意：size 单位是 USDT (6位小数)，1 USDT = 1_000_000
        defaultContractSpec = ContractSpec({
            contractSize: 200_000,          // 1张 = 200,000 代币
            tickSize: 1e11,                 // 0.0000001 (用1e18精度表示)
            priceDecimals: 7,               // 7位小数
            quantityDecimals: 0,            // 整张交易
            minOrderSize: 1_000_000,        // 最小 $1 (1 * 1e6)
            maxOrderSize: 100_000_000_000,  // 单笔最大 $100,000 (100000 * 1e6)
            maxPositionSize: 500_000_000_000, // 持仓限额 $500,000 (500000 * 1e6)
            maxLeverage: MAX_LEVERAGE,      // 最大100x杠杆
            imRate: 500,                    // 初始保证金5%
            mmRate: 250,                    // 维持保证金2.5%
            maxPriceDeviation: 1000,        // 限价单最大偏离10%
            isActive: true,
            createdAt: block.timestamp
        });
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    /// @notice 设置交易对的合约规格
    /// @param token 交易代币地址
    /// @param spec 合约规格参数
    function setContractSpec(address token, ContractSpec calldata spec) external onlyOwner {
        if (spec.contractSize == 0) revert InvalidContractSpec();
        if (spec.minOrderSize == 0) revert InvalidContractSpec();
        if (spec.maxOrderSize < spec.minOrderSize) revert InvalidContractSpec();
        if (spec.maxPositionSize < spec.maxOrderSize) revert InvalidContractSpec();
        if (spec.maxLeverage == 0 || spec.maxLeverage > MAX_LEVERAGE) revert InvalidContractSpec();
        if (spec.mmRate == 0 || spec.mmRate > 5000) revert InvalidContractSpec();

        contractSpecs[token] = spec;

        emit ContractSpecSet(
            token,
            spec.contractSize,
            spec.tickSize,
            spec.maxLeverage,
            spec.mmRate
        );
    }

    /// @notice 设置默认合约规格（新代币使用）
    function setDefaultContractSpec(ContractSpec calldata spec) external onlyOwner {
        if (spec.contractSize == 0) revert InvalidContractSpec();
        defaultContractSpec = spec;
        emit DefaultContractSpecSet(spec.contractSize, spec.maxLeverage);
    }

    /// @notice 设置保证金阶梯
    /// @param token 交易代币地址
    /// @param tiers 保证金阶梯数组（必须按positionSize升序排列）
    function setMarginTiers(address token, MarginTier[] calldata tiers) external onlyOwner {
        // 清空旧的阶梯
        delete _marginTiers[token];

        // 验证并添加新阶梯
        uint256 lastSize = 0;
        for (uint256 i = 0; i < tiers.length; i++) {
            require(tiers[i].positionSize > lastSize, "Tiers must be ascending");
            require(tiers[i].mmRate > 0, "Invalid mmRate");
            require(tiers[i].maxLeverage > 0, "Invalid maxLeverage");

            _marginTiers[token].push(tiers[i]);
            lastSize = tiers[i].positionSize;
        }

        emit MarginTiersSet(token, tiers.length);
    }

    /// @notice 激活/停用交易对
    function setContractActive(address token, bool active) external onlyOwner {
        contractSpecs[token].isActive = active;
    }

    // ============================================================
    // View Functions
    // ============================================================

    /// @notice 获取合约规格（如果没有配置则返回默认值）
    function getContractSpec(address token) external view returns (ContractSpec memory) {
        ContractSpec memory spec = contractSpecs[token];
        if (spec.contractSize == 0) {
            return defaultContractSpec;
        }
        return spec;
    }

    /// @notice 获取默认合约规格
    function getDefaultContractSpec() external view returns (ContractSpec memory) {
        return defaultContractSpec;
    }

    /// @notice 获取保证金阶梯
    function getMarginTiers(address token) external view returns (MarginTier[] memory) {
        return _marginTiers[token];
    }

    /// @notice 验证合约是否激活
    function isContractActive(address token) external view returns (bool) {
        ContractSpec memory spec = contractSpecs[token];
        if (spec.contractSize == 0) {
            return defaultContractSpec.isActive;
        }
        return spec.isActive;
    }

    /// @notice 根据仓位大小计算维持保证金率
    /// @param token 交易代币
    /// @param positionSize 仓位大小（张数）
    /// @return mmRate 维持保证金率 (10000 = 100%)
    /// @return maxLev 该档位最大杠杆
    function getMarginRequirement(address token, uint256 positionSize) external view returns (uint256 mmRate, uint256 maxLev) {
        MarginTier[] storage tiers = _marginTiers[token];

        // 如果没有设置阶梯，使用合约规格的默认值
        if (tiers.length == 0) {
            ContractSpec memory spec = contractSpecs[token];
            if (spec.contractSize == 0) {
                spec = defaultContractSpec;
            }
            return (spec.mmRate, spec.maxLeverage);
        }

        // 找到对应档位
        for (uint256 i = tiers.length; i > 0; i--) {
            if (positionSize >= tiers[i - 1].positionSize) {
                return (tiers[i - 1].mmRate, tiers[i - 1].maxLeverage);
            }
        }

        // 小于最低档，使用第一档
        return (tiers[0].mmRate, tiers[0].maxLeverage);
    }
}
