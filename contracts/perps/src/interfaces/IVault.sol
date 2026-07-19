// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVault {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function getBalance(address user) external view returns (uint256);
    function getLockedBalance(address user) external view returns (uint256);
    function lockMargin(address user, uint256 amount) external;
    function unlockMargin(address user, uint256 amount) external;
    function settlePnL(address winner, address loser, uint256 amount) external;
    function transferFromLocked(address from, address to, uint256 amount) external;
    function distributeLiquidation(
        address liquidatedUser,
        address liquidator,
        uint256 liquidatorReward,
        uint256 remainingToPool
    ) external;

    // 新增：盈亏结算相关
    function settleProfit(address user, uint256 collateral, uint256 profit) external;
    function settleLoss(address user, uint256 collateral, uint256 loss) external returns (uint256 actualLoss);
    function settleBankruptcy(address user, uint256 collateral, uint256 deficit) external returns (uint256 coveredDeficit);

    // 新增：手续费收取
    function collectFee(address user, address feeReceiver, uint256 amount) external;
    function collectFeeFromLocked(address user, address feeReceiver, uint256 amount) external;
}
