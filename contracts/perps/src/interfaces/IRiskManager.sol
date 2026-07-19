// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRiskManager {
    function getMaxLeverage() external view returns (uint256);
    function getMaintenanceMarginRate(uint256 leverage) external view returns (uint256);
    function getMaxPositionSize() external view returns (uint256);
    function validateOpenPosition(address user, bool isLong, uint256 size, uint256 leverage)
        external
        view
        returns (bool isValid, string memory reason);

    // 新增：多空平衡风控
    function getImbalanceRisk() external view returns (
        uint256 longExposure,
        uint256 shortExposure,
        uint256 maxPotentialLoss
    );
    function checkInsuranceCoverage() external view returns (
        bool isSufficient,
        uint256 fundBalance,
        uint256 requiredAmount
    );
    function checkADLRequired() external view returns (
        bool needADL,
        bool targetSide,
        uint256 reduceAmount
    );
    function pauseTrading(string calldata reason) external;
    function resumeTrading() external;
    function tradingPaused() external view returns (bool);
}
