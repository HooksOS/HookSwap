// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ConstantProductAMMMath
/// @notice Pump.fun style Constant Product AMM (x * y = k)
/// @dev Implements Price logic based on Virtual Reserves.
///      x = Virtual ETH Reserve
///      y = Real Token Reserve
///      x * y = k (invariant)
///
///      Buy:
///      Input: dX (ETH in)
///      New Reserves: x' = x + dX
///      New Token Reserve: y' = k / x'
///      Output Tokens: dY = y - y' = y - (k / (x + dX))
///
///      Sell:
///      Input: dY (Tokens in)
///      New Reserves: y' = y + dY
///      New ETH Reserve: x' = k / y'
///      Output ETH: dX = x - x' = x - (k / (y + dY))
library ConstantProductAMMMath {

    uint256 private constant PRECISION = 1e18;

    /// @notice Get amount of tokens out for a given amount of ETH in
    /// @param virtualEthReserve Current virtual ETH reserve (x)
    /// @param realTokenReserve Current token reserve (y)
    /// @param ethIn Amount of ETH to buy with (dX)
    /// @return tokensOut Amount of tokens user receives (dY)
    function getTokensOut(
        uint256 virtualEthReserve,
        uint256 realTokenReserve,
        uint256 ethIn
    ) internal pure returns (uint256 tokensOut) {
        // dy = y - k / (x + dx)
        // k = x * y
        // dy = y - (x * y) / (x + dx)
        // dy = (y(x + dx) - xy) / (x + dx)
        // dy = (yx + ydx - xy) / (x + dx)
        // dy = (y * dx) / (x + dx)

        uint256 numerator = realTokenReserve * ethIn;
        uint256 denominator = virtualEthReserve + ethIn;
        tokensOut = numerator / denominator;
    }

    /// @notice Get amount of ETH out for a given amount of tokens in
    /// @param virtualEthReserve Current virtual ETH reserve (x)
    /// @param realTokenReserve Current token reserve (y)
    /// @param tokensIn Amount of tokens to sell (dY)
    /// @return ethOut Amount of ETH user receives (dX)
    function getETHOut(
        uint256 virtualEthReserve,
        uint256 realTokenReserve,
        uint256 tokensIn
    ) internal pure returns (uint256 ethOut) {
        // dx = x - k / (y + dy)
        // dx = (x(y + dy) - xy) / (y + dy)
        // dx = (x * dy) / (y + dy)

        uint256 numerator = virtualEthReserve * tokensIn;
        uint256 denominator = realTokenReserve + tokensIn;
        ethOut = numerator / denominator;
    }

    /// @notice Get amount of ETH needed to buy a specific amount of tokens
    /// @dev Inverse of getTokensOut: given dY, find dX
    ///      From: dy = (y * dx) / (x + dx)
    ///      Solving for dx: dx = (dy * x) / (y - dy)
    /// @param virtualEthReserve Current virtual ETH reserve (x)
    /// @param realTokenReserve Current token reserve (y)
    /// @param tokensOut Desired amount of tokens to buy (dY)
    /// @return ethIn Amount of ETH needed (dX)
    function getETHIn(
        uint256 virtualEthReserve,
        uint256 realTokenReserve,
        uint256 tokensOut
    ) internal pure returns (uint256 ethIn) {
        // dx = (dy * x) / (y - dy)
        require(tokensOut < realTokenReserve, "Cannot buy more than reserve");

        uint256 numerator = tokensOut * virtualEthReserve;
        uint256 denominator = realTokenReserve - tokensOut;
        ethIn = numerator / denominator;

        // Add 1 wei to ensure we have enough (rounding up)
        ethIn += 1;
    }

    /// @notice Calculate current price (ETH per Token)
    /// @dev Price = dX / dY ≈ x / y (Spot Price)
    /// @return price wei per token (scaled by 1e18 if needed, but standard is just wei)
    ///         Since x is ~1e18 (ETH) and y is ~1e27 (Tokens), price will be small.
    ///         Returns price in wei for 1 full token (1e18 units).
    function getCurrentPrice(
        uint256 virtualEthReserve,
        uint256 realTokenReserve
    ) internal pure returns (uint256) {
        // Spot price P = x / y
        // We want price of 1 token (1e18 wei units)
        // P_1 = (x * 1e18) / y
        if (realTokenReserve == 0) return 0;
        return (virtualEthReserve * PRECISION) / realTokenReserve;
    }
}
