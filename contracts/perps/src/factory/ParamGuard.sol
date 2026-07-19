// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ParamGuard
 * @notice Governance-set global parameter bounds for HookSwapPerps self-service markets
 *         (SELF_SERVICE_SPEC.md §8). Fixes the v1 gap where PerpMarket's `MAX_LEVERAGE`
 *         was a hard 100x `constant` with no per-market cap: the factory now clamps every
 *         market's requested leverage/fee to these owner-adjustable bounds, and the resulting
 *         per-market cap is enforced ON-CHAIN in PerpMarket (see PerpMarket.marketMaxLeverage).
 *
 *         Units: leverage uses PerpMarket.LEVERAGE_PRECISION = 1e4 (so 20x == 20 * 1e4).
 *         Fees/margins are in bps.
 */
contract ParamGuard is Ownable {
    struct Bounds {
        uint256 maxLeverage; // absolute governance ceiling (e.g. 20 * 1e4)
        uint256 minMaintenanceMarginBps; // floor for a market's maintenance margin
        uint256 minFeeBps; // per-side fee floor
        uint256 maxFeeBps; // per-side fee ceiling
    }

    Bounds public bounds;

    event BoundsSet(uint256 maxLeverage, uint256 minMaintenanceMarginBps, uint256 minFeeBps, uint256 maxFeeBps);

    error BadBounds();

    constructor(uint256 _maxLeverage, uint256 _minMaintenanceMarginBps, uint256 _minFeeBps, uint256 _maxFeeBps)
        Ownable(msg.sender)
    {
        _setBounds(_maxLeverage, _minMaintenanceMarginBps, _minFeeBps, _maxFeeBps);
    }

    function setBounds(uint256 _maxLeverage, uint256 _minMaintenanceMarginBps, uint256 _minFeeBps, uint256 _maxFeeBps)
        external
        onlyOwner
    {
        _setBounds(_maxLeverage, _minMaintenanceMarginBps, _minFeeBps, _maxFeeBps);
    }

    function _setBounds(uint256 _maxLeverage, uint256 _minMaintenanceMarginBps, uint256 _minFeeBps, uint256 _maxFeeBps)
        internal
    {
        if (_maxLeverage == 0 || _minFeeBps > _maxFeeBps) revert BadBounds();
        bounds = Bounds({
            maxLeverage: _maxLeverage,
            minMaintenanceMarginBps: _minMaintenanceMarginBps,
            minFeeBps: _minFeeBps,
            maxFeeBps: _maxFeeBps
        });
        emit BoundsSet(_maxLeverage, _minMaintenanceMarginBps, _minFeeBps, _maxFeeBps);
    }

    // ============================================================
    // Clamps (used by the factory at createMarket)
    // ============================================================

    /// @notice Clamp a requested leverage to the governance ceiling. 0 (unset) → ceiling.
    function clampLeverage(uint256 x) external view returns (uint256) {
        if (x == 0 || x > bounds.maxLeverage) return bounds.maxLeverage;
        return x;
    }

    /// @notice Clamp a requested per-side fee into [minFeeBps, maxFeeBps].
    function clampFee(uint256 x) external view returns (uint256) {
        if (x < bounds.minFeeBps) return bounds.minFeeBps;
        if (x > bounds.maxFeeBps) return bounds.maxFeeBps;
        return x;
    }

    // ============================================================
    // Checks (views)
    // ============================================================

    function checkLeverage(uint256 x) external view returns (bool) {
        return x > 0 && x <= bounds.maxLeverage;
    }

    function checkFee(uint256 x) external view returns (bool) {
        return x >= bounds.minFeeBps && x <= bounds.maxFeeBps;
    }

    function checkMaintenanceMargin(uint256 bps) external view returns (bool) {
        return bps >= bounds.minMaintenanceMarginBps;
    }

    function getBounds() external view returns (Bounds memory) {
        return bounds;
    }
}
