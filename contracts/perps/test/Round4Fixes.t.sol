// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/factory/PerpMarket.sol";
import "../src/factory/PerpMarketFactory.sol";
import "../src/factory/FeeRouter.sol";
import "../src/factory/MarketRegistry.sol";
import "../src/factory/OracleGuard.sol";
import "../src/factory/ParamGuard.sol";
import "../src/factory/BondManager.sol";
import "../src/factory/InsuranceHub.sol";
import "./invariant/Mocks.sol";

/**
 * @title Round4FixesTest
 * @notice LOCAL (non-fork) regression suite for the round-4 adversarial-audit MED fixes:
 *
 *   MED-1: every fund-holding market must be created with a reference feed — OracleGuard.validateConfig
 *          now rejects refFeed == 0 for ALL tiers (not just permissionless), closing the "curated market
 *          with a dormant _guardPrice → hostile matcher settles at an arbitrary price" vector.
 *   MED-2: guarded-price liveness lock. The USER close path settles at the FRESH reference price (always
 *          in-band), and the owner `forceSettle` escape hatch closes a position at the reference price once
 *          the matcher mark has been stale beyond PRICE_STALE_GRACE — so a down matcher can never trap funds.
 *
 * Uses a controllable MockAggregator so the whole thing runs without a Chainlink fork.
 * (MED-3 — the Settlement.sol LIMIT-price port — is covered by Round4Settlement.t.sol; it cannot share a
 *  file because PerpMarket.sol and Settlement.sol both declare a top-level IOracleGuardCheck / IWETH.)
 */
contract Round4FixesTest is Test {
    bytes32 constant CHAINLINK = keccak256("chainlink");
    address constant VENUE = address(0xFEED);

    uint256 constant PK_A = uint256(keccak256("round4.A"));
    uint256 constant PK_B = uint256(keccak256("round4.B"));

    PerpMarket impl;
    PerpMarketFactory factory;
    FeeRouter feeRouter;
    MarketRegistry registry;
    OracleGuard oracleGuard;
    ParamGuard paramGuard;
    BondManager bondManager;
    InsuranceHub insuranceHub;
    MockERC20 col;
    MockERC20 wethLike;
    MockAggregator agg;

    address A;
    address B;

    // Mirror the market event so we can expectEmit against forceSettle.
    event ForceSettled(uint256 indexed pairId, uint256 refPrice, uint256 staleSince);

    function setUp() public {
        A = vm.addr(PK_A);
        B = vm.addr(PK_B);
        col = new MockERC20("Collateral", "COL", 18);
        wethLike = new MockERC20("WethLike", "WETH", 18);
        agg = new MockAggregator(8, 2000e8); // ETH/USD-style @ $2000

        impl = new PerpMarket();
        registry = new MarketRegistry();
        oracleGuard = new OracleGuard();
        paramGuard = new ParamGuard(20 * 1e4, 50, 2, 15);
        insuranceHub = new InsuranceHub();
        bondManager = new BondManager(address(this), address(registry));
        feeRouter = new FeeRouter(address(this), address(insuranceHub));

        factory = new PerpMarketFactory(
            address(impl), address(wethLike), address(this), address(this), address(feeRouter),
            address(registry), address(this), 0, address(oracleGuard), address(paramGuard), address(bondManager)
        );
        feeRouter.setFactory(address(factory));
        bondManager.setFactory(address(factory));
        registry.setFactory(address(factory));
        oracleGuard.setFactory(address(factory));
        oracleGuard.setVenue(CHAINLINK, VENUE, true);
        factory.setMinBonds(0, 0);
    }

    // ---------------- helpers ----------------

    function _cfg(address refFeed, uint256 maxDevBps) internal pure returns (OracleGuard.OracleConfig memory) {
        return OracleGuard.OracleConfig({
            sourceType: CHAINLINK, venue: VENUE, refFeed: refFeed,
            maxDeviationBps: maxDevBps, maxStaleness: 30 days, minLiquidity: 0, dualSourceRequired: false
        });
    }

    function _create(bytes32 id, uint256 maxDevBps) internal returns (address market) {
        market = factory.createMarket(address(col), 18, address(this), 10, 10 * 1e4, id, 0, _cfg(address(agg), maxDevBps));
    }

    function _fund(address m, address who, uint256 pk, uint256 amt) internal {
        pk;
        col.mint(who, amt);
        vm.prank(who);
        col.approve(m, amt);
        vm.prank(who);
        PerpMarket(payable(m)).deposit(address(col), amt);
    }

    function _order(address t, bool isLong, uint256 size, uint256 lev, uint256 price)
        internal view returns (PerpMarket.Order memory)
    {
        return PerpMarket.Order({
            trader: t, token: address(col), isLong: isLong, size: size, leverage: lev, price: price,
            deadline: block.timestamp + 1_000_000, nonce: 0, orderType: PerpMarket.OrderType.MARKET
        });
    }

    function _settle(address m, uint256 size, uint256 lev, uint256 matchPrice) internal {
        PerpMarket.Order memory lo = _order(A, true, size, lev, matchPrice);
        PerpMarket.Order memory so = _order(B, false, size, lev, matchPrice);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(PK_A, PerpMarket(payable(m)).getOrderHash(lo));
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(PK_B, PerpMarket(payable(m)).getOrderHash(so));
        PerpMarket.MatchedPair[] memory pairs = new PerpMarket.MatchedPair[](1);
        pairs[0] = PerpMarket.MatchedPair({
            longOrder: lo, longSignature: abi.encodePacked(r1, s1, v1),
            shortOrder: so, shortSignature: abi.encodePacked(r2, s2, v2),
            matchPrice: matchPrice, matchSize: size
        });
        PerpMarket(payable(m)).settleBatch(pairs);
    }

    // ============================================================
    // MED-1 — a market may NOT be created without a reference feed
    // ============================================================

    function test_MED1_ZeroRefFeedRejectedAtCreation() public {
        // refFeed == 0 must revert at createMarket (validateConfig gate) — curated tier included.
        vm.expectRevert(OracleGuard.RefFeedRequired.selector);
        factory.createMarket(address(col), 18, address(this), 10, 10 * 1e4, "NOFEED", 0, _cfg(address(0), 500));
        emit log_string("MED-1 OK: curated createMarket with refFeed == 0 reverts RefFeedRequired");

        // A real reference feed succeeds.
        address m = _create("FEED", 500);
        assertEq(PerpMarket(payable(m)).oracleGuard(), address(oracleGuard), "guard not wired");
        (, , address refFeed, , , , ) = oracleGuard.marketConfig(m);
        assertEq(refFeed, address(agg), "refFeed not registered");
        emit log_string("MED-1 OK: createMarket with a real reference feed succeeds");
    }

    // ============================================================
    // MED-2a — closePair settles at the FRESH ref price even when the stored mark is out of band
    // ============================================================

    function test_MED2_CloseAtRefPriceWhenStoredMarkStaleOutOfBand() public {
        address m = _create("LIVENESS", 500 /*5% band*/);
        _fund(m, A, PK_A, 1e18);
        _fund(m, B, PK_B, 1e18);

        _settle(m, 1e16, 10 * 1e4, 2000e18);
        PerpMarket(payable(m)).updatePrice(address(col), 2000e18); // in-band mark written at $2000

        // Matcher goes dark; the reference feed drifts to $2200 (+10%). The last stored mark ($2000)
        // is now 9.09% off the fresh feed → OUTSIDE the 5% band. A mark-based close would revert.
        agg.set(2200e8, block.timestamp);
        vm.expectRevert(OracleGuard.PriceDeviationTooLarge.selector);
        oracleGuard.checkDeviation(m, 2000e18); // documents: stored mark is genuinely out of band now

        // The user can STILL close — closePair settles at the fresh reference price ($2200, 0 deviation).
        // Success here is itself the proof it used the ref price: a stored-mark close would have reverted.
        vm.prank(A);
        PerpMarket(payable(m)).closePair(1);

        PerpMarket.PairedPosition memory pos = PerpMarket(payable(m)).getPairedPosition(1);
        assertEq(uint256(pos.status), uint256(PerpMarket.PositionStatus.CLOSED), "position not closed at ref price");
        emit log_string("MED-2a OK: closePair succeeds at fresh ref price despite an out-of-band stored mark");
    }

    // ============================================================
    // MED-2b — owner forceSettle unlocks a trapped position after the grace window (and not before)
    // ============================================================

    function test_MED2_ForceSettleAfterGraceOnlyWhenStale() public {
        address m = _create("TRAP", 500);
        _fund(m, A, PK_A, 1e18);
        _fund(m, B, PK_B, 1e18);

        _settle(m, 1e16, 10 * 1e4, 2000e18);
        PerpMarket(payable(m)).updatePrice(address(col), 2000e18); // lastPriceUpdate = now

        // BEFORE the grace window elapses, forceSettle must revert NotStale (no premature owner close).
        vm.expectRevert(PerpMarket.NotStale.selector);
        PerpMarket(payable(m)).forceSettle(1);
        emit log_string("MED-2b OK: forceSettle reverts NotStale while the mark is still fresh");

        // Matcher stays down past the grace window; refresh the feed round so it is still fresh.
        vm.warp(block.timestamp + PerpMarket(payable(m)).PRICE_STALE_GRACE() + 1);
        agg.set(2000e8, block.timestamp);

        // Non-owner cannot force-settle.
        vm.prank(A);
        vm.expectRevert();
        PerpMarket(payable(m)).forceSettle(1);

        // Owner force-settles at the fresh reference price.
        vm.expectEmit(true, false, false, true, m);
        emit ForceSettled(1, 2000e18, block.timestamp - PerpMarket(payable(m)).PRICE_STALE_GRACE() - 1);
        PerpMarket(payable(m)).forceSettle(1);

        PerpMarket.PairedPosition memory pos = PerpMarket(payable(m)).getPairedPosition(1);
        assertEq(uint256(pos.status), uint256(PerpMarket.PositionStatus.CLOSED), "position not force-closed");
        emit log_string("MED-2b OK: owner forceSettle closes the trapped position after the grace window");
    }
}
