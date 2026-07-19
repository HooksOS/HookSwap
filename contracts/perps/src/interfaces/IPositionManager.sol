// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPositionManager {
    // H-017: Margin mode enum
    enum MarginMode {
        ISOLATED,   // 逐仓模式 - 每个仓位独立保证金
        CROSS       // 全仓模式 - 所有仓位共享保证金
    }

    // Legacy Position struct (single token, backward compatible)
    struct Position {
        bool isLong;
        uint256 size;
        uint256 collateral;
        uint256 entryPrice;
        uint256 leverage;
        uint256 lastFundingTime;
        int256 accFundingFee;
    }

    // H-016: Extended Position struct with token support
    struct PositionEx {
        address token;          // 代币地址
        bool isLong;            // 方向
        uint256 size;           // 仓位大小
        uint256 collateral;     // 保证金
        uint256 entryPrice;     // 开仓价格
        uint256 leverage;       // 杠杆倍数
        uint256 lastFundingTime;// 上次资金费结算时间
        int256 accFundingFee;   // 累计资金费
        MarginMode marginMode;  // H-017: 保证金模式
    }

    // Legacy single-token functions (backward compatible)
    function getPosition(address user) external view returns (Position memory);
    function getTotalLongSize() external view returns (uint256);
    function getTotalShortSize() external view returns (uint256);
    function canLiquidate(address user) external view returns (bool);
    function forceClose(address user) external;
    function forceReduce(address user, uint256 percentage) external;
    function openLong(uint256 size, uint256 leverage) external;
    function openShort(uint256 size, uint256 leverage) external;
    function closePosition() external;
    function closePositionPartial(uint256 percentage) external;
    function addCollateral(uint256 amount) external;
    function removeCollateral(uint256 amount) external;

    // H-016: Multi-token functions
    function getPositionByToken(address user, address token) external view returns (PositionEx memory);
    function getUserTokens(address user) external view returns (address[] memory);
    function getTokenTotalLongSize(address token) external view returns (uint256);
    function getTokenTotalShortSize(address token) external view returns (uint256);
    function canLiquidateToken(address user, address token) external view returns (bool);
    function forceCloseToken(address user, address token) external;
    function forceReduceToken(address user, address token, uint256 percentage) external;
    function openLongToken(address token, uint256 size, uint256 leverage, MarginMode mode) external;
    function openShortToken(address token, uint256 size, uint256 leverage, MarginMode mode) external;
    function closePositionToken(address token) external;
    function closePositionPartialToken(address token, uint256 percentage) external;
    function addCollateralToken(address token, uint256 amount) external;
    function removeCollateralToken(address token, uint256 amount) external;

    // C-06: Reader 合约所需的 view 函数
    function getTokenUnrealizedPnL(address user, address token) external view returns (int256);
    function getTokenLiquidationPrice(address user, address token) external view returns (uint256);
    function getTokenMarginRatio(address user, address token) external view returns (uint256);

    // H-017: Cross margin functions
    function getCrossMarginBalance(address user) external view returns (uint256);
    function getCrossMarginEquity(address user) external view returns (int256);
    function setDefaultMarginMode(MarginMode mode) external;
}
