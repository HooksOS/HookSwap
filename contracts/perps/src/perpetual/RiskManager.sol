// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/IVault.sol";

/**
 * @title RiskManager
 * @notice 风控参数管理合约
 * @dev 管理杠杆、保证金率、持仓限额、多空平衡等风控参数
 */
contract RiskManager is Ownable {
    // ============================================================
    // Constants
    // ============================================================

    uint256 public constant PRECISION = 1e18;
    uint256 public constant LEVERAGE_PRECISION = 1e4;

    // ============================================================
    // State Variables
    // ============================================================

    IPositionManager public positionManager;
    IVault public vault;
    address public insuranceFund; // Liquidation 合约地址（保险基金）

    // 杠杆配置
    uint256 public maxLeverage = 100 * LEVERAGE_PRECISION; // 100x
    uint256 public minLeverage = 1 * LEVERAGE_PRECISION; // 1x

    // 维持保证金率（根据杠杆调整）
    mapping(uint256 => uint256) public maintenanceMarginRates;

    // 持仓限额
    uint256 public maxPositionSize = 1000 ether; // 单仓位最大 1000 BNB
    uint256 public maxOpenInterest = 10000 ether; // 总持仓最大 10000 BNB

    // 价格影响限制
    uint256 public maxPriceImpact = 100; // 1% (100/10000)

    // 最小保证金
    uint256 public minMargin = 0.01 ether; // 最小保证金 0.01 BNB

    // ========== 新增：多空平衡风控参数 ==========

    // 最大价格波动假设（用于计算潜在亏损）
    uint256 public maxPriceMove = 50e16; // 50% 最大价格波动假设

    // 保险基金覆盖率要求（潜在亏损的多少倍）
    uint256 public insuranceCoverageRatio = 100; // 100% 覆盖

    // 交易暂停状态
    bool public tradingPaused;

    // 暂停原因
    string public pauseReason;

    // ============================================================
    // Events
    // ============================================================

    event MaxLeverageUpdated(uint256 oldValue, uint256 newValue);
    event MaintenanceMarginRateUpdated(uint256 leverage, uint256 rate);
    event MaxPositionSizeUpdated(uint256 oldValue, uint256 newValue);
    event MaxOpenInterestUpdated(uint256 oldValue, uint256 newValue);
    event MaxPriceImpactUpdated(uint256 oldValue, uint256 newValue);
    event TradingPaused(string reason);
    event TradingResumed();
    event InsuranceFundSet(address indexed fund);

    // ============================================================
    // Errors
    // ============================================================

    error ZeroAddress();
    error InvalidParameter();
    error TradingIsPaused();

    // ============================================================
    // Constructor
    // ============================================================

    constructor() Ownable(msg.sender) {
        _setDefaultMaintenanceMarginRates();
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    function setPositionManager(address _positionManager) external onlyOwner {
        if (_positionManager == address(0)) revert ZeroAddress();
        positionManager = IPositionManager(_positionManager);
    }

    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        vault = IVault(_vault);
    }

    function setInsuranceFund(address _insuranceFund) external onlyOwner {
        if (_insuranceFund == address(0)) revert ZeroAddress();
        insuranceFund = _insuranceFund;
        emit InsuranceFundSet(_insuranceFund);
    }

    function setMaxLeverage(uint256 value) external onlyOwner {
        if (value < minLeverage || value > 200 * LEVERAGE_PRECISION) revert InvalidParameter();
        emit MaxLeverageUpdated(maxLeverage, value);
        maxLeverage = value;
    }

    function setMaintenanceMarginRate(uint256 leverage, uint256 rate) external onlyOwner {
        if (rate > PRECISION) revert InvalidParameter();
        maintenanceMarginRates[leverage] = rate;
        emit MaintenanceMarginRateUpdated(leverage, rate);
    }

    function setMaxPositionSize(uint256 value) external onlyOwner {
        emit MaxPositionSizeUpdated(maxPositionSize, value);
        maxPositionSize = value;
    }

    function setMaxOpenInterest(uint256 value) external onlyOwner {
        emit MaxOpenInterestUpdated(maxOpenInterest, value);
        maxOpenInterest = value;
    }

    function setMaxPriceImpact(uint256 value) external onlyOwner {
        if (value > 1000) revert InvalidParameter();
        emit MaxPriceImpactUpdated(maxPriceImpact, value);
        maxPriceImpact = value;
    }

    function setMaxPriceMove(uint256 value) external onlyOwner {
        if (value > PRECISION) revert InvalidParameter();
        maxPriceMove = value;
    }

    function setInsuranceCoverageRatio(uint256 value) external onlyOwner {
        insuranceCoverageRatio = value;
    }

    /**
     * @notice 暂停交易
     * @param reason 暂停原因
     */
    function pauseTrading(string calldata reason) external onlyOwner {
        tradingPaused = true;
        pauseReason = reason;
        emit TradingPaused(reason);
    }

    /**
     * @notice 恢复交易
     */
    function resumeTrading() external onlyOwner {
        tradingPaused = false;
        pauseReason = "";
        emit TradingResumed();
    }

    // ============================================================
    // View Functions
    // ============================================================

    function getMaxLeverage() external view returns (uint256) {
        return maxLeverage;
    }

    function getMaintenanceMarginRate(uint256 leverage) external view returns (uint256) {
        return _getMaintenanceMarginRate(leverage);
    }

    function getMaxPositionSize() external view returns (uint256) {
        return maxPositionSize;
    }

    function getMaxOpenInterest() external view returns (uint256) {
        return maxOpenInterest;
    }

    function getMaxPriceImpact() external view returns (uint256) {
        return maxPriceImpact;
    }

    /**
     * @notice 计算多空不平衡导致的潜在最大亏损
     * @return longExposure 多头净敞口（多头比空头多的部分）
     * @return shortExposure 空头净敞口（空头比多头多的部分）
     * @return maxPotentialLoss 潜在最大亏损
     */
    function getImbalanceRisk() public view returns (
        uint256 longExposure,
        uint256 shortExposure,
        uint256 maxPotentialLoss
    ) {
        if (address(positionManager) == address(0)) {
            return (0, 0, 0);
        }

        uint256 totalLong = positionManager.getTotalLongSize();
        uint256 totalShort = positionManager.getTotalShortSize();

        if (totalLong > totalShort) {
            // 多头更多，如果价格上涨，空头亏损
            // 但空头有自己的保证金，真正的风险是净敞口
            longExposure = totalLong - totalShort;
            // 潜在亏损 = 净敞口 * 最大价格波动
            maxPotentialLoss = (longExposure * maxPriceMove) / PRECISION;
        } else if (totalShort > totalLong) {
            // 空头更多，如果价格下跌，多头亏损
            shortExposure = totalShort - totalLong;
            maxPotentialLoss = (shortExposure * maxPriceMove) / PRECISION;
        }
    }

    /**
     * @notice 获取保险基金余额
     */
    function getInsuranceFundBalance() public view returns (uint256) {
        if (insuranceFund == address(0)) return 0;
        return insuranceFund.balance;
    }

    /**
     * @notice 检查保险基金是否足够覆盖潜在亏损
     * @return isSufficient 是否足够
     * @return fundBalance 保险基金余额
     * @return requiredAmount 需要的金额
     */
    function checkInsuranceCoverage() public view returns (
        bool isSufficient,
        uint256 fundBalance,
        uint256 requiredAmount
    ) {
        (, , uint256 maxPotentialLoss) = getImbalanceRisk();
        fundBalance = getInsuranceFundBalance();
        requiredAmount = (maxPotentialLoss * insuranceCoverageRatio) / 100;
        isSufficient = fundBalance >= requiredAmount;
    }

    /**
     * @notice 验证开仓参数
     * @dev 核心风控逻辑：多空不平衡 + 保险基金不够 = 限制开仓
     */
    function validateOpenPosition(
        address user,
        bool isLong,
        uint256 size,
        uint256 leverage
    ) external view returns (bool isValid, string memory reason) {
        // 0. 检查交易是否暂停
        if (tradingPaused) {
            return (false, pauseReason);
        }

        // 1. 检查杠杆范围
        if (leverage < minLeverage) {
            return (false, "Leverage too low");
        }
        if (leverage > maxLeverage) {
            return (false, "Leverage too high");
        }

        // 2. 检查仓位大小
        if (size == 0) {
            return (false, "Size cannot be zero");
        }
        if (size > maxPositionSize) {
            return (false, "Position size exceeds limit");
        }

        // 3. 检查保证金
        uint256 requiredMargin = (size * LEVERAGE_PRECISION) / leverage;
        if (requiredMargin < minMargin) {
            return (false, "Margin too small");
        }

        // 4. 检查用户余额
        if (address(vault) != address(0)) {
            uint256 balance = vault.getBalance(user);
            uint256 fee = size / 1000; // 0.1% 手续费
            if (balance < requiredMargin + fee) {
                return (false, "Insufficient balance");
            }
        }

        // 5. 检查总持仓限额
        if (address(positionManager) != address(0)) {
            uint256 totalLong = positionManager.getTotalLongSize();
            uint256 totalShort = positionManager.getTotalShortSize();
            uint256 newTotal = totalLong + totalShort + size;

            if (newTotal > maxOpenInterest) {
                return (false, "Max open interest exceeded");
            }

            // 6. 核心风控：多空不平衡 + 保险基金不够 = 限制开仓
            (bool canOpen, string memory riskReason) = _checkImbalanceRisk(
                isLong,
                size,
                totalLong,
                totalShort
            );
            if (!canOpen) {
                return (false, riskReason);
            }
        }

        return (true, "");
    }

    /**
     * @notice 检查是否需要触发 ADL（自动减仓）
     * @return needADL 是否需要 ADL
     * @return targetSide 需要减仓的方向 (true=多头, false=空头)
     * @return reduceAmount 需要减少的仓位量
     */
    function checkADLRequired() external view returns (
        bool needADL,
        bool targetSide,
        uint256 reduceAmount
    ) {
        (bool isSufficient, uint256 fundBalance, uint256 requiredAmount) = checkInsuranceCoverage();

        if (isSufficient) {
            return (false, false, 0);
        }

        // 保险基金不足，需要 ADL
        needADL = true;

        uint256 totalLong = positionManager.getTotalLongSize();
        uint256 totalShort = positionManager.getTotalShortSize();

        if (totalLong > totalShort) {
            // 多头更多，需要减少多头
            targetSide = true;
            uint256 excess = totalLong - totalShort;
            // 计算需要减少多少才能让保险基金覆盖
            uint256 deficit = requiredAmount - fundBalance;
            reduceAmount = (deficit * PRECISION) / maxPriceMove;
            if (reduceAmount > excess) reduceAmount = excess;
        } else {
            // 空头更多，需要减少空头
            targetSide = false;
            uint256 excess = totalShort - totalLong;
            uint256 deficit = requiredAmount - fundBalance;
            reduceAmount = (deficit * PRECISION) / maxPriceMove;
            if (reduceAmount > excess) reduceAmount = excess;
        }
    }

    /**
     * @notice 获取建议杠杆
     */
    function getSuggestedLeverage(uint256 balance, uint256 size) external view returns (uint256) {
        if (balance == 0 || size == 0) return minLeverage;

        uint256 maxLev = (size * LEVERAGE_PRECISION) / balance;
        if (maxLev > maxLeverage) {
            return maxLeverage;
        }
        if (maxLev < minLeverage) {
            return minLeverage;
        }
        return maxLev;
    }

    /**
     * @notice 获取杠杆档位的维持保证金率表
     */
    function getMarginRateTable() external pure returns (uint256[] memory leverages, uint256[] memory rates) {
        leverages = new uint256[](4);
        rates = new uint256[](4);

        leverages[0] = 10 * 1e4;
        rates[0] = 5e15; // 0.5%

        leverages[1] = 25 * 1e4;
        rates[1] = 1e16; // 1%

        leverages[2] = 50 * 1e4;
        rates[2] = 2e16; // 2%

        leverages[3] = 100 * 1e4;
        rates[3] = 5e16; // 5%
    }

    // ============================================================
    // Internal Functions
    // ============================================================

    function _setDefaultMaintenanceMarginRates() internal {
        maintenanceMarginRates[10 * LEVERAGE_PRECISION] = 5e15;  // 0.5%
        maintenanceMarginRates[25 * LEVERAGE_PRECISION] = 1e16;  // 1%
        maintenanceMarginRates[50 * LEVERAGE_PRECISION] = 2e16;  // 2%
        maintenanceMarginRates[100 * LEVERAGE_PRECISION] = 5e16; // 5%
    }

    function _getMaintenanceMarginRate(uint256 leverage) internal view returns (uint256) {
        if (leverage <= 10 * LEVERAGE_PRECISION) {
            return maintenanceMarginRates[10 * LEVERAGE_PRECISION];
        } else if (leverage <= 25 * LEVERAGE_PRECISION) {
            return maintenanceMarginRates[25 * LEVERAGE_PRECISION];
        } else if (leverage <= 50 * LEVERAGE_PRECISION) {
            return maintenanceMarginRates[50 * LEVERAGE_PRECISION];
        } else {
            return maintenanceMarginRates[100 * LEVERAGE_PRECISION];
        }
    }

    /**
     * @notice 检查多空不平衡风险
     * @dev 只有当不平衡 AND 保险基金不够时才限制
     */
    function _checkImbalanceRisk(
        bool isLong,
        uint256 size,
        uint256 totalLong,
        uint256 totalShort
    ) internal view returns (bool canOpen, string memory reason) {
        // 计算开仓后的新持仓量
        uint256 newLong = isLong ? totalLong + size : totalLong;
        uint256 newShort = isLong ? totalShort : totalShort + size;

        // 计算新的潜在最大亏损
        uint256 maxPotentialLoss;
        if (newLong > newShort) {
            uint256 exposure = newLong - newShort;
            maxPotentialLoss = (exposure * maxPriceMove) / PRECISION;
        } else if (newShort > newLong) {
            uint256 exposure = newShort - newLong;
            maxPotentialLoss = (exposure * maxPriceMove) / PRECISION;
        }

        // 获取保险基金余额
        uint256 fundBalance = getInsuranceFundBalance();
        uint256 requiredAmount = (maxPotentialLoss * insuranceCoverageRatio) / 100;

        // 核心逻辑：保险基金够就允许开仓
        if (fundBalance >= requiredAmount) {
            return (true, "");
        }

        // 保险基金不够，检查这笔开仓是否会加剧不平衡
        if (isLong && newLong > newShort) {
            // 开多且多头已经更多 → 拒绝
            return (false, "Long side imbalanced, insurance insufficient");
        }
        if (!isLong && newShort > newLong) {
            // 开空且空头已经更多 → 拒绝
            return (false, "Short side imbalanced, insurance insufficient");
        }

        // 开仓方向有助于平衡，允许
        return (true, "");
    }
}
