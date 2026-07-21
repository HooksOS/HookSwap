// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Plain 18-decimal collateral used across the local (non-fork) invariant + fuzz suite.
contract MockERC20 is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// @dev Controllable Chainlink-style aggregator so the OracleGuard deviation/staleness
///      circuit-breaker (SECURITY_REVIEW.md H-1) can be exercised WITHOUT a mainnet/Sepolia
///      fork. `set(answer, updatedAt)` moves the reference price + round age at will.
contract MockAggregator {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public immutable decimals;
    uint80 public roundId;

    constructor(uint8 _decimals, int256 _answer) {
        decimals = _decimals;
        answer = _answer;
        updatedAt = block.timestamp;
        roundId = 1;
    }

    function set(int256 _answer, uint256 _updatedAt) external {
        answer = _answer;
        updatedAt = _updatedAt;
        roundId++;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}
