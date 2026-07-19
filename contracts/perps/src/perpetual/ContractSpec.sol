// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ContractSpec
 * @notice MEME币永续合约交易规则规格
 * @dev 集中管理所有交易规则参数
 *
 * ============================================================
 * 代币经济学 (Tokenomics)
 * ============================================================
 *
 * 总供应量: 1,000,000,000 (10亿) tokens
 * Bonding Curve: 800,000,000 (8亿) tokens - 用于内盘交易
 * DEX 流动性: 200,000,000 (2亿) tokens - 毕业后注入
 *
 * 毕业条件: 累计买入 50 BNB
 *
 * ============================================================
 * 价格计算 (基于 Bonding Curve)
 * ============================================================
 *
 * 采用 Pump.fun 模型，使用虚拟储备的恒定乘积公式:
 *
 * 初始虚拟储备:
 *   - 虚拟 BNB: 18 BNB
 *   - 虚拟 Token: 1,073,000,191
 *   - k = 18 × 1,073,000,191 = 19,314,003,438
 *
 * 价格公式: price = virtualBNB / virtualToken
 *
 * 初始价格:
 *   = 18 / 1,073,000,191
 *   = 0.0000000168 BNB per token
 *   ≈ $0.00001 per token (假设 BNB = $600)
 *
 * 初始市值:
 *   = $0.00001 × 1,000,000,000
 *   = $10,000
 *
 * 毕业时 (累计买入 50 BNB):
 *   - 虚拟 BNB = 18 + 50 = 68 BNB
 *   - 虚拟 Token = k / 68 = 284,029,462
 *   - 毕业价格 = 68 / 284,029,462 = 0.000000239 BNB
 *   ≈ $0.000144 per token
 *
 * 毕业市值:
 *   = $0.000144 × 1,000,000,000
 *   = $144,000
 *
 * 价格涨幅: ~14.3倍 (与 Pump.fun 一致)
 *
 * ============================================================
 * 永续合约规格 (参考 Hyperliquid/dYdX)
 * ============================================================
 *
 * 由于单个 token 价格极小 (~$0.00001)，采用合约单位:
 *
 * 1 合约 = 1,000,000 tokens (1M)
 * 合约价格 = token价格 × 1,000,000
 *          = $0.00001 × 1,000,000
 *          = $10 (初始)
 *          = $144 (毕业后)
 *
 * 这使得价格在合理范围内便于交易
 */
contract ContractSpec is Ownable {
    // ============================================================
    // Constants - 精度定义
    // ============================================================

    uint256 public constant PRICE_PRECISION = 1e18;      // 价格精度 (18位小数)
    uint256 public constant SIZE_PRECISION = 1e18;       // 数量精度 (18位小数)
    uint256 public constant LEVERAGE_PRECISION = 1e4;    // 杠杆精度 (10000 = 1x)
    uint256 public constant RATE_PRECISION = 1e6;        // 费率精度 (1000000 = 100%)
    uint256 public constant PERCENT_PRECISION = 1e4;     // 百分比精度 (10000 = 100%)

    // ============================================================
    // 代币经济学参数
    // ============================================================

    /// @notice 总供应量
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18; // 10亿 tokens

    /// @notice Bonding Curve 中的 tokens
    uint256 public constant BONDING_CURVE_SUPPLY = 800_000_000 * 1e18; // 8亿

    /// @notice DEX 流动性保留
    uint256 public constant DEX_LIQUIDITY_RESERVE = 200_000_000 * 1e18; // 2亿

    /// @notice 毕业所需 BNB
    uint256 public constant GRADUATION_BNB = 50 ether; // 50 BNB

    // ============================================================
    // Bonding Curve 参数 (虚拟储备)
    // ============================================================

    /// @notice 初始虚拟 BNB 储备
    uint256 public constant INITIAL_VIRTUAL_BNB = 18 ether;

    /// @notice 初始虚拟 Token 储备
    uint256 public constant INITIAL_VIRTUAL_TOKEN = 1_073_000_191 * 1e18;

    /// @notice 恒定乘积 k = virtualBNB × virtualToken
    uint256 public constant CONSTANT_K = 19_314_003_438 * 1e36; // 18 × 1.073B × 1e36

    // ============================================================
    // 合约基本参数
    // ============================================================

    /// @notice 结算货币符号
    string public constant SETTLEMENT_CURRENCY = "BNB";

    /// @notice 报价货币符号
    string public constant QUOTE_CURRENCY = "USD";

    /// @notice 合约面值 (1张合约 = 1,000,000 tokens)
    /// @dev 参考 Hyperliquid 的 kPEPE (1000 PEPE = 1合约)
    ///      由于我们的 token 价格更小，使用更大的单位
    uint256 public contractSize = 1_000_000 * 1e18; // 100万 tokens per contract

    /// @notice 合约乘数
    uint256 public contractMultiplier = 1;

    // ============================================================
    // 价格规则
    // ============================================================

    /// @notice 最小变动价位 (Tick Size)
    /// @dev 参考 Hyperliquid: MAX_DECIMALS(6) - szDecimals
    ///      合约价格约 $10-$144，tick size 设为 0.0001 BNB (~$0.06)
    uint256 public tickSize = 0.0001 ether; // 0.0001 BNB

    /// @notice 最大价格 (合约单位)
    /// @dev 对应 token 价格 $0.01 (1000倍涨幅)
    uint256 public maxPrice = 10 ether; // 10 BNB per contract

    /// @notice 最小价格 (合约单位)
    /// @dev 对应 token 价格 $0.000001 (跌90%)
    uint256 public minPrice = 0.001 ether; // 0.001 BNB per contract

    // ============================================================
    // 下单数量规则 (以合约张数计)
    // ============================================================

    /// @notice szDecimals - 数量小数位
    /// @dev 参考 Hyperliquid: 0 表示最小单位是 1 张合约
    uint8 public szDecimals = 0;

    /// @notice 最小下单数量
    /// @dev 1 张合约 = 1,000,000 tokens
    uint256 public minOrderSize = 1; // 1 contract = 1M tokens

    /// @notice 最大下单数量
    uint256 public maxOrderSize = 10000; // 10000 contracts = 10B tokens (超过总供应量的限制)

    /// @notice 下单数量步长
    uint256 public sizeStep = 1; // 1 contract

    // ============================================================
    // 杠杆规则 (参考 Hyperliquid MEME 币)
    // ============================================================

    /// @notice 最小杠杆
    uint256 public minLeverage = 1 * LEVERAGE_PRECISION; // 1x

    /// @notice 最大杠杆
    /// @dev 参考 Hyperliquid: MEME币最大10x
    uint256 public maxLeverage = 10 * LEVERAGE_PRECISION; // 10x

    /// @notice 杠杆步长
    uint256 public leverageStep = 1 * LEVERAGE_PRECISION; // 1x

    /// @notice 可选杠杆档位
    uint256[] public leverageTiers;

    // ============================================================
    // 保证金规则 (参考 dYdX)
    // ============================================================

    /// @notice 最小保证金 (以 BNB 计)
    uint256 public minMargin = 0.01 ether; // 0.01 BNB (~$6)

    /// @notice 初始保证金率 (IMR)
    /// @dev 参考 dYdX DOGE: 10%
    uint256 public initialMarginRate = 100000; // 10% (100000/1000000)

    /// @notice 维持保证金率 (MMR)
    /// @dev 参考 dYdX DOGE: 5%
    uint256 public maintenanceMarginRate = 50000; // 5% (50000/1000000)

    // ============================================================
    // 持仓限额规则 (阶梯限仓)
    // ============================================================

    struct PositionTier {
        uint256 maxPosition;        // 该档位最大持仓 (合约张数)
        uint256 maxLeverage;        // 该档位最大杠杆
        uint256 maintenanceMargin;  // 维持保证金率 (RATE_PRECISION)
        uint256 initialMargin;      // 初始保证金率 (RATE_PRECISION)
    }

    /// @notice 持仓档位列表
    /// @dev 参考 Hyperliquid: 仓位越大，杠杆越低
    PositionTier[] public positionTiers;

    /// @notice 单账户最大持仓 (合约张数)
    /// @dev 相当于 1000 contracts × 1M = 10亿 tokens (总供应量)
    uint256 public maxPositionPerAccount = 1000;

    /// @notice 全市场最大未平仓合约
    uint256 public maxOpenInterest = 5000; // 5000 contracts

    /// @notice 单边最大持仓 (防止多空严重失衡)
    uint256 public maxSideExposure = 3000; // 3000 contracts per side

    // ============================================================
    // 手续费规则
    // ============================================================

    /// @notice Taker 手续费率
    uint256 public takerFeeRate = 500; // 0.05% (500/1000000)

    /// @notice Maker 手续费率
    uint256 public makerFeeRate = 200; // 0.02% (200/1000000)

    /// @notice 清算手续费率
    uint256 public liquidationFeeRate = 5000; // 0.5% (5000/1000000)

    // ============================================================
    // 委托规则
    // ============================================================

    /// @notice 支持的订单类型
    enum OrderType {
        MARKET,          // 市价单
        LIMIT,           // 限价单
        STOP_MARKET,     // 止损市价单
        STOP_LIMIT,      // 止损限价单
        TAKE_PROFIT,     // 止盈单
        TRAILING_STOP    // 追踪止损单
    }

    /// @notice 订单有效期类型
    enum TimeInForce {
        GTC,  // Good Till Cancel - 一直有效直到取消
        IOC,  // Immediate Or Cancel - 立即成交否则取消
        FOK,  // Fill Or Kill - 全部成交否则取消
        GTD   // Good Till Date - 指定日期前有效
    }

    /// @notice 是否启用限价单
    bool public limitOrderEnabled = true;

    /// @notice 是否启用止损单
    bool public stopOrderEnabled = true;

    /// @notice 最大挂单数量
    uint256 public maxOrdersPerAccount = 50;

    /// @notice 限价单最大偏离度 (与标记价格)
    /// @dev 50% = 5000 (5000/10000)
    uint256 public maxPriceDeviation = 5000;

    // ============================================================
    // 资金费率规则
    // ============================================================

    /// @notice 资金费率结算间隔 (秒)
    uint256 public fundingInterval = 8 hours;

    /// @notice 最大资金费率
    /// @dev 参考 Hyperliquid: 约 0.05% per hour = 0.4% per 8 hours
    uint256 public maxFundingRate = 4000; // 0.4% (4000/1000000)

    /// @notice 最小资金费率
    int256 public minFundingRate = -4000; // -0.4%

    // ============================================================
    // 自动减仓 (ADL) 规则
    // ============================================================

    /// @notice ADL 触发阈值 (保险基金覆盖率)
    /// @dev 当保险基金 < 所需金额 * threshold 时触发
    uint256 public adlThreshold = 5000; // 50% (5000/10000)

    /// @notice ADL 排序方式
    /// @dev 0 = 按盈利率排序, 1 = 按杠杆率排序, 2 = 综合排序
    uint256 public adlRankingMethod = 2; // 综合排序 (盈利率 × 杠杆率)

    // ============================================================
    // 交易状态
    // ============================================================

    /// @notice 交易暂停状态
    bool public tradingPaused = false;

    /// @notice 暂停原因
    string public pauseReason;

    // ============================================================
    // Events
    // ============================================================

    event ContractSizeUpdated(uint256 oldValue, uint256 newValue);
    event TickSizeUpdated(uint256 oldValue, uint256 newValue);
    event LeverageRangeUpdated(uint256 minLev, uint256 maxLev);
    event MarginRatesUpdated(uint256 imr, uint256 mmr);
    event FeeRatesUpdated(uint256 takerFee, uint256 makerFee);
    event PositionLimitsUpdated(uint256 maxPerAccount, uint256 maxOI);
    event PositionTierAdded(uint256 maxPos, uint256 maxLev, uint256 mmr, uint256 imr);
    event TradingStatusChanged(bool paused, string reason);

    // ============================================================
    // Constructor
    // ============================================================

    constructor() Ownable(msg.sender) {
        _initializePositionTiers();
        _initializeLeverageTiers();
    }

    // ============================================================
    // Initialization
    // ============================================================

    function _initializePositionTiers() internal {
        // 持仓档位：仓位越大，杠杆越低，保证金率越高
        // 参考 Hyperliquid: 0-20M USDC: 10x, >20M: 5x

        // Tier 1: 0-100 contracts (0-1亿 tokens), 10x, MMR 5%, IMR 10%
        positionTiers.push(PositionTier({
            maxPosition: 100,
            maxLeverage: 10 * LEVERAGE_PRECISION,
            maintenanceMargin: 50000,   // 5%
            initialMargin: 100000       // 10%
        }));

        // Tier 2: 100-500 contracts (1-5亿 tokens), 5x, MMR 10%, IMR 20%
        positionTiers.push(PositionTier({
            maxPosition: 500,
            maxLeverage: 5 * LEVERAGE_PRECISION,
            maintenanceMargin: 100000,  // 10%
            initialMargin: 200000       // 20%
        }));

        // Tier 3: 500-1000 contracts (5-10亿 tokens), 3x, MMR 17%, IMR 34%
        positionTiers.push(PositionTier({
            maxPosition: 1000,
            maxLeverage: 3 * LEVERAGE_PRECISION,
            maintenanceMargin: 170000,  // 17%
            initialMargin: 340000       // 34%
        }));
    }

    function _initializeLeverageTiers() internal {
        // 可选杠杆档位 (整数倍)
        leverageTiers.push(1 * LEVERAGE_PRECISION);  // 1x
        leverageTiers.push(2 * LEVERAGE_PRECISION);  // 2x
        leverageTiers.push(3 * LEVERAGE_PRECISION);  // 3x
        leverageTiers.push(5 * LEVERAGE_PRECISION);  // 5x
        leverageTiers.push(10 * LEVERAGE_PRECISION); // 10x
    }

    // ============================================================
    // Admin Functions
    // ============================================================

    function setContractSize(uint256 _size) external onlyOwner {
        emit ContractSizeUpdated(contractSize, _size);
        contractSize = _size;
    }

    function setTickSize(uint256 _tickSize) external onlyOwner {
        emit TickSizeUpdated(tickSize, _tickSize);
        tickSize = _tickSize;
    }

    function setLeverageRange(uint256 _min, uint256 _max) external onlyOwner {
        require(_min > 0 && _min < _max, "Invalid range");
        minLeverage = _min;
        maxLeverage = _max;
        emit LeverageRangeUpdated(_min, _max);
    }

    function setMarginRates(uint256 _imr, uint256 _mmr) external onlyOwner {
        require(_mmr < _imr, "MMR must be less than IMR");
        initialMarginRate = _imr;
        maintenanceMarginRate = _mmr;
        emit MarginRatesUpdated(_imr, _mmr);
    }

    function setFeeRates(uint256 _taker, uint256 _maker) external onlyOwner {
        require(_taker <= 10000 && _maker <= 10000, "Fee too high");
        takerFeeRate = _taker;
        makerFeeRate = _maker;
        emit FeeRatesUpdated(_taker, _maker);
    }

    function setPositionLimits(uint256 _maxPerAccount, uint256 _maxOI) external onlyOwner {
        maxPositionPerAccount = _maxPerAccount;
        maxOpenInterest = _maxOI;
        emit PositionLimitsUpdated(_maxPerAccount, _maxOI);
    }

    function addPositionTier(
        uint256 _maxPos,
        uint256 _maxLev,
        uint256 _mmr,
        uint256 _imr
    ) external onlyOwner {
        positionTiers.push(PositionTier({
            maxPosition: _maxPos,
            maxLeverage: _maxLev,
            maintenanceMargin: _mmr,
            initialMargin: _imr
        }));
        emit PositionTierAdded(_maxPos, _maxLev, _mmr, _imr);
    }

    function pauseTrading(string calldata _reason) external onlyOwner {
        tradingPaused = true;
        pauseReason = _reason;
        emit TradingStatusChanged(true, _reason);
    }

    function resumeTrading() external onlyOwner {
        tradingPaused = false;
        pauseReason = "";
        emit TradingStatusChanged(false, "");
    }

    // ============================================================
    // View Functions
    // ============================================================

    /// @notice 计算 Bonding Curve 价格
    /// @param bnbPurchased 已购买的 BNB 数量
    /// @return tokenPrice 当前 token 价格 (BNB per token, 18 decimals)
    function getBondingCurvePrice(uint256 bnbPurchased) external pure returns (uint256 tokenPrice) {
        uint256 currentVirtualBNB = INITIAL_VIRTUAL_BNB + bnbPurchased;
        uint256 currentVirtualToken = CONSTANT_K / currentVirtualBNB / 1e18; // 调整精度
        tokenPrice = (currentVirtualBNB * 1e18) / currentVirtualToken;
    }

    /// @notice 计算购买指定 BNB 能获得多少 tokens
    /// @param bnbAmount 购买的 BNB 数量
    /// @param bnbPurchased 已购买的 BNB 数量
    /// @return tokensOut 获得的 token 数量
    function getTokensForBNB(
        uint256 bnbAmount,
        uint256 bnbPurchased
    ) external pure returns (uint256 tokensOut) {
        uint256 currentVirtualBNB = INITIAL_VIRTUAL_BNB + bnbPurchased;
        uint256 currentVirtualToken = CONSTANT_K / currentVirtualBNB / 1e18;

        uint256 newVirtualBNB = currentVirtualBNB + bnbAmount;
        uint256 newVirtualToken = CONSTANT_K / newVirtualBNB / 1e18;

        tokensOut = (currentVirtualToken - newVirtualToken) * 1e18;
    }

    /// @notice 获取指定仓位大小的限制参数
    function getPositionTier(uint256 positionSize) external view returns (
        uint256 tierMaxLeverage,
        uint256 tierMaintenanceMargin,
        uint256 tierInitialMargin
    ) {
        for (uint256 i = 0; i < positionTiers.length; i++) {
            if (positionSize <= positionTiers[i].maxPosition) {
                return (
                    positionTiers[i].maxLeverage,
                    positionTiers[i].maintenanceMargin,
                    positionTiers[i].initialMargin
                );
            }
        }
        // 返回最高档位
        PositionTier memory lastTier = positionTiers[positionTiers.length - 1];
        return (lastTier.maxLeverage, lastTier.maintenanceMargin, lastTier.initialMargin);
    }

    /// @notice 验证价格是否符合规则
    function validatePrice(uint256 price) external view returns (bool isValid, string memory reason) {
        if (price < minPrice) {
            return (false, "Price below minimum");
        }
        if (price > maxPrice) {
            return (false, "Price above maximum");
        }
        if (price % tickSize != 0) {
            return (false, "Price not on tick");
        }
        return (true, "");
    }

    /// @notice 验证数量是否符合规则
    function validateSize(uint256 size) external view returns (bool isValid, string memory reason) {
        if (size < minOrderSize) {
            return (false, "Size below minimum");
        }
        if (size > maxOrderSize) {
            return (false, "Size above maximum");
        }
        if (size % sizeStep != 0) {
            return (false, "Size not on step");
        }
        return (true, "");
    }

    /// @notice 验证杠杆是否符合规则
    function validateLeverage(uint256 leverage) external view returns (bool isValid, string memory reason) {
        if (leverage < minLeverage) {
            return (false, "Leverage below minimum");
        }
        if (leverage > maxLeverage) {
            return (false, "Leverage above maximum");
        }
        return (true, "");
    }

    /// @notice 将 token 数量转换为合约张数
    function tokensToContracts(uint256 tokenAmount) external view returns (uint256) {
        return tokenAmount / contractSize;
    }

    /// @notice 将合约张数转换为 token 数量
    function contractsToTokens(uint256 contracts) external view returns (uint256) {
        return contracts * contractSize;
    }

    /// @notice 获取所有杠杆档位
    function getLeverageTiers() external view returns (uint256[] memory) {
        return leverageTiers;
    }

    /// @notice 获取持仓档位数量
    function getPositionTierCount() external view returns (uint256) {
        return positionTiers.length;
    }

    /// @notice 获取完整的合约规格信息
    function getContractInfo() external view returns (
        string memory settlementCurrency,
        string memory quoteCurrency,
        uint256 _contractSize,
        uint256 _tickSize,
        uint256 _minOrderSize,
        uint256 _maxOrderSize,
        uint256 _minLeverage,
        uint256 _maxLeverage
    ) {
        return (
            SETTLEMENT_CURRENCY,
            QUOTE_CURRENCY,
            contractSize,
            tickSize,
            minOrderSize,
            maxOrderSize,
            minLeverage,
            maxLeverage
        );
    }

    /// @notice 获取保证金信息
    function getMarginInfo() external view returns (
        uint256 _initialMarginRate,
        uint256 _maintenanceMarginRate,
        uint256 _minMargin
    ) {
        return (initialMarginRate, maintenanceMarginRate, minMargin);
    }

    /// @notice 获取费率信息
    function getFeeInfo() external view returns (
        uint256 _takerFeeRate,
        uint256 _makerFeeRate,
        uint256 _liquidationFeeRate
    ) {
        return (takerFeeRate, makerFeeRate, liquidationFeeRate);
    }

    /// @notice 获取持仓限额信息
    function getPositionLimits() external view returns (
        uint256 _maxPositionPerAccount,
        uint256 _maxOpenInterest,
        uint256 _maxSideExposure
    ) {
        return (maxPositionPerAccount, maxOpenInterest, maxSideExposure);
    }

    /// @notice 获取 ADL 规则
    function getADLRules() external view returns (
        uint256 _adlThreshold,
        uint256 _adlRankingMethod
    ) {
        return (adlThreshold, adlRankingMethod);
    }

    /// @notice 获取 Bonding Curve 参数
    function getBondingCurveParams() external pure returns (
        uint256 _totalSupply,
        uint256 _bondingCurveSupply,
        uint256 _dexReserve,
        uint256 _graduationBNB,
        uint256 _initialVirtualBNB,
        uint256 _initialVirtualToken,
        uint256 _constantK
    ) {
        return (
            TOTAL_SUPPLY,
            BONDING_CURVE_SUPPLY,
            DEX_LIQUIDITY_RESERVE,
            GRADUATION_BNB,
            INITIAL_VIRTUAL_BNB,
            INITIAL_VIRTUAL_TOKEN,
            CONSTANT_K
        );
    }
}
