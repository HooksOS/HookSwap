// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAMM {
    function activate(uint256 bnbAmount, uint256 memeAmount) external payable;
    function swapBNBForMeme(uint256 minAmountOut) external payable returns (uint256);
    function swapMemeForBNB(uint256 memeAmount, uint256 minAmountOut) external returns (uint256);
    function addLiquidity() external payable returns (uint256);
    function removeLiquidity(uint256 lpTokens) external returns (uint256, uint256);
    function getSpotPrice() external view returns (uint256);
    function getAmountOut(bool isBuy, uint256 amountIn) external view returns (uint256);
}
