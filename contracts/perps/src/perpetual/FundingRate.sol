// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/IVault.sol";
import "../interfaces/IPriceFeed.sol";

/**
 * @title FundingRate
 * @notice 资金费率合约 - 简化版
 * @dev 每5分钟收取固定 0.01% 资金费率，双边收取进保险基金
 *      保险基金上限为 OI 的 10%，超出后 65% 保险 + 35% 平台
 */
contract FundingRate is Ownable {
    using Address for address payable;

    // ============================================================
    // Constants
    // ============================================================

    uint256 public constant PRECISION = 1e18;
    uint256 public constant FUNDING_INTERVAL = 5 minutes;
    uint256 public constant FUNDING_RATE_BPS = 1; // 0.01% = 1 基点
    uint256 public constant BPS_PRECISION = 10000;

    // 保险基金上限 = OI 的 10%
    uint256 public constant INSURANCE_CAP_RATIO = 1000; // 10% = 1000 基点

    // 溢出分配比例
    uint256 public constant OVERFLOW_TO_INSURANCE = 6500; // 65%
    uint256 public constant OVERFLOW_TO_PLATFORM = 3500;  // 35%

    // ============================================================
    // State Variables
    // ============================================================

    IPositionManager public positionManager;
    IVault public vault;
    IPriceFeed public priceFeed;

    // 上次收取时间
    uint256 public lastFundingTime;

    // 保险基金余额 (合约内管理)
    uint256 public insuranceFundBalance;

    // 平台风险准备金余额
    uint256 public riskReserveBalance;

    // 超级管理员 (可紧急提取保险基金)
    address public superAdmin;

    // 累计收取的资金费
    uint256 public totalFundingCollected;

    // ============================================================
    // Events
    // ============================================================

    event FundingCollected(
        uint256 timestamp,
        uint256 totalOI,
        uint256 fundingAmount,
        uint256 toInsurance,
        uint256 toPlatform
    );
    event InsuranceFundInjected(address indexed from, uint256 amount);
    event InsuranceFundWithdrawn(address indexed to, uint256 amount);
    event RiskReserveWithdrawn(address indexed to, uint256 amount);
    event SuperAdminUpdated(address indexed oldAdmin, address indexed newAdmin);

    // ============================================================
    // Errors
    // ============================================================

    error TooEarlyToCollect();
    error ZeroAddress();
    error Unauthorized();
    error InsufficientBalance();
    error ZeroAmount();

    // ============================================================
    // Modifiers
    // ============================================================

    modifier onlySuperAdmin() {
        if (msg.sender != superAdmin && msg.sender != owner()) revert Unauthorized();
        _;
    }

    // ============================================================
    // Constructor
    // ============================================================

    constructor(address _positionManager, address _vault, address _priceFeed) Ownable(msg.sender) {
        if (_positionManager == address(0) || _vault == address(0) || _priceFeed == address(0)) {
            revert ZeroAddress();
        }
        positionManager = IPositionManager(_positionManager);
        vault = IVault(_vault);
        priceFeed = IPriceFeed(_priceFeed);
        lastFundingTime = block.timestamp;
        superAdmin = msg.sender;
    }

    // ============================================================
    // Core Functions
    // ============================================================

    /**
     * @notice 收取资金费（每5分钟，任何人可调用）
     * @dev 固定 0.01% 费率，双边收取
     */
    function collectFunding() external {
        if (block.timestamp < lastFundingTime + FUNDING_INTERVAL) {
            revert TooEarlyToCollect();
        }

        // 获取总持仓量 (OI)
        uint256 totalLong = positionManager.getTotalLongSize();
        uint256 totalShort = positionManager.getTotalShortSize();
        uint256 totalOI = totalLong + totalShort;

        if (totalOI == 0) {
            lastFundingTime = block.timestamp;
            return;
        }

        // 计算资金费 = OI × 0.01%
        uint256 fundingAmount = (totalOI * FUNDING_RATE_BPS) / BPS_PRECISION;

        // 计算保险基金上限
        uint256 insuranceCap = (totalOI * INSURANCE_CAP_RATIO) / BPS_PRECISION;

        uint256 toInsurance;
        uint256 toPlatform;

        if (insuranceFundBalance < insuranceCap) {
            // 未达上限，全部进保险基金
            toInsurance = fundingAmount;
            toPlatform = 0;
        } else {
            // 超过上限，分流
            toInsurance = (fundingAmount * OVERFLOW_TO_INSURANCE) / BPS_PRECISION;
            toPlatform = fundingAmount - toInsurance;
        }

        // 更新余额
        insuranceFundBalance += toInsurance;
        riskReserveBalance += toPlatform;
        totalFundingCollected += fundingAmount;

        lastFundingTime = block.timestamp;

        emit FundingCollected(block.timestamp, totalOI, fundingAmount, toInsurance, toPlatform);
    }

    // ============================================================
    // Insurance Fund Management
    // ============================================================

    /**
     * @notice 向保险基金注资
     */
    function injectInsuranceFund() external payable {
        if (msg.value == 0) revert ZeroAmount();
        insuranceFundBalance += msg.value;
        emit InsuranceFundInjected(msg.sender, msg.value);
    }

    /**
     * @notice 紧急提取保险基金 (仅超级管理员)
     * @param amount 提取金额
     * @param recipient 接收地址
     */
    function emergencyWithdrawInsurance(uint256 amount, address recipient) external onlySuperAdmin {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount > insuranceFundBalance) revert InsufficientBalance();

        insuranceFundBalance -= amount;
        payable(recipient).sendValue(amount);

        emit InsuranceFundWithdrawn(recipient, amount);
    }

    /**
     * @notice 提取风险准备金 (仅管理员)
     * @param recipient 接收地址
     */
    function withdrawRiskReserve(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 amount = riskReserveBalance;
        if (amount == 0) revert ZeroAmount();

        riskReserveBalance = 0;
        payable(recipient).sendValue(amount);

        emit RiskReserveWithdrawn(recipient, amount);
    }

    /**
     * @notice 从保险基金覆盖亏损 (供 Vault 调用)
     * @param amount 需要覆盖的金额
     * @return covered 实际覆盖金额
     */
    function coverDeficit(uint256 amount) external returns (uint256 covered) {
        // 只允许 Vault 调用
        require(msg.sender == address(vault), "Only Vault");

        covered = amount > insuranceFundBalance ? insuranceFundBalance : amount;
        if (covered > 0) {
            insuranceFundBalance -= covered;
            payable(msg.sender).sendValue(covered);
        }
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    /**
     * @notice 设置超级管理员
     */
    function setSuperAdmin(address newAdmin) external onlyOwner {
        if (newAdmin == address(0)) revert ZeroAddress();
        address oldAdmin = superAdmin;
        superAdmin = newAdmin;
        emit SuperAdminUpdated(oldAdmin, newAdmin);
    }

    // ============================================================
    // View Functions
    // ============================================================

    /**
     * @notice 获取当前资金费率 (固定 0.01%)
     */
    function getCurrentFundingRate() external pure returns (uint256) {
        return FUNDING_RATE_BPS;
    }

    /**
     * @notice 获取下次收取时间
     */
    function getNextFundingTime() external view returns (uint256) {
        return lastFundingTime + FUNDING_INTERVAL;
    }

    /**
     * @notice 获取保险基金余额
     */
    function getInsuranceFundBalance() external view returns (uint256) {
        return insuranceFundBalance;
    }

    /**
     * @notice 获取保险基金上限 (基于当前 OI)
     */
    function getInsuranceCap() external view returns (uint256) {
        uint256 totalLong = positionManager.getTotalLongSize();
        uint256 totalShort = positionManager.getTotalShortSize();
        uint256 totalOI = totalLong + totalShort;
        return (totalOI * INSURANCE_CAP_RATIO) / BPS_PRECISION;
    }

    /**
     * @notice 检查保险基金是否超过上限
     */
    function isInsuranceOverCap() external view returns (bool) {
        uint256 totalLong = positionManager.getTotalLongSize();
        uint256 totalShort = positionManager.getTotalShortSize();
        uint256 totalOI = totalLong + totalShort;
        uint256 insuranceCap = (totalOI * INSURANCE_CAP_RATIO) / BPS_PRECISION;
        return insuranceFundBalance >= insuranceCap;
    }

    /**
     * @notice 获取风险准备金余额
     */
    function getRiskReserveBalance() external view returns (uint256) {
        return riskReserveBalance;
    }

    /**
     * @notice 年化资金费率 (0.01% × 12 × 24 × 365 = 1051.2%)
     */
    function getAnnualizedRate() external pure returns (uint256) {
        // 每5分钟 0.01%，每天 288次，每年 365天
        // 0.01% × 288 × 365 = 1051.2%
        return FUNDING_RATE_BPS * 288 * 365;
    }

    /**
     * @notice 获取上次收取时间
     */
    function getLastFundingTime() external view returns (uint256) {
        return lastFundingTime;
    }

    /**
     * @notice 检查是否可以收取资金费
     */
    function canCollectFunding() external view returns (bool) {
        return block.timestamp >= lastFundingTime + FUNDING_INTERVAL;
    }

    // ============================================================
    // Legacy Interface (兼容旧代码)
    // ============================================================

    /**
     * @notice 结算资金费 (Legacy 别名)
     */
    function settleFunding() external {
        this.collectFunding();
    }

    /**
     * @notice 获取预估资金费率 (Legacy, 返回固定值)
     */
    function getEstimatedFundingRate() external pure returns (int256) {
        return int256(FUNDING_RATE_BPS);
    }

    /**
     * @notice 结算用户资金费 (Legacy, no-op)
     * @dev 新版本中资金费是全局收取的，不再针对单个用户
     */
    function settleUserFunding(address) external pure returns (int256) {
        return 0;
    }

    /**
     * @notice 获取用户待结算资金费 (Legacy, 返回0)
     */
    function getPendingFunding(address) external pure returns (int256) {
        return 0;
    }

    // ============================================================
    // Receive ETH
    // ============================================================

    receive() external payable {
        // 接收注入的资金
        insuranceFundBalance += msg.value;
        emit InsuranceFundInjected(msg.sender, msg.value);
    }
}
