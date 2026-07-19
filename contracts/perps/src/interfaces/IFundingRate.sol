// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFundingRate {
    function settleUserFunding(address user) external returns (int256);
    function getPendingFunding(address user) external view returns (int256);
    function getCurrentFundingRate() external view returns (int256);
    function getNextFundingTime() external view returns (uint256);
}
