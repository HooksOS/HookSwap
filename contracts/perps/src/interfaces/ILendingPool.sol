// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ILendingPool
 * @notice Multi-token P2P lending pool interface
 * @dev Manages lending pools for all meme tokens in a single contract
 */
interface ILendingPool {
    // ── Lender Functions ──────────────────────────────────────────────
    function deposit(address token, uint256 amount) external returns (uint256 shares);
    function withdraw(address token, uint256 shares) external returns (uint256 amount);
    function claimInterest(address token) external returns (uint256 interest);

    // ── Borrower Functions (authorized only) ──────────────────────────
    function borrow(address token, address borrower, uint256 amount) external;
    function repay(address token, address borrower, uint256 amount) external;
    function liquidateBorrow(address token, address borrower) external returns (uint256 seized);

    // ── TokenFactory Integration ──────────────────────────────────────
    function enableToken(address token) external;

    // ── View Functions ────────────────────────────────────────────────
    function getUtilization(address token) external view returns (uint256);
    function getBorrowRate(address token) external view returns (uint256);
    function getSupplyRate(address token) external view returns (uint256);
    function getAvailableLiquidity(address token) external view returns (uint256);
    function getUserDeposit(address token, address user) external view returns (uint256);
    function getUserShares(address token, address user) external view returns (uint256);
    function getUserBorrow(address token, address user) external view returns (uint256);
    function getUserPendingInterest(address token, address user) external view returns (uint256);
    function isTokenEnabled(address token) external view returns (bool);
}
