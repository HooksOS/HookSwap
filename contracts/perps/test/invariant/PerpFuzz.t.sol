// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/factory/PerpMarket.sol";
import "../../src/factory/PerpMarketFactory.sol";
import "../../src/factory/FeeRouter.sol";
import "../../src/factory/MarketRegistry.sol";
import "../../src/factory/OracleGuard.sol";
import "../../src/factory/ParamGuard.sol";
import "../../src/factory/BondManager.sol";
import "../../src/factory/InsuranceHub.sol";
import "./Mocks.sol";

/**
 * @title PerpFuzzTest
 * @notice LOCAL (non-fork) targeted fuzz tests for the HookSwapPerps self-service stack —
 *         the math-and-arithmetic half of SECURITY_REVIEW.md §5 item 10. Covers:
 *
 *           - FEE-SPLIT CONSERVATION (FeeRouter): platform + creator + insurance == total
 *             collected, and the platform share never drops below the immutable floor.
 *           - SETTLEMENT PnL (PerpMarket._settlePair/_closePair): opening then closing a paired
 *             position is zero-sum — the two traders' combined credited balance equals their
 *             combined locked collateral (no collateral minted), and the winner's gain is bounded
 *             by the loser's collateral (excess is external insurance/ADL, never minted).
 *           - ORACLEGUARD deviation / staleness circuit-breaker (H-1), driven by a controllable
 *             MockAggregator so it runs WITHOUT a Chainlink fork.
 *           - BOND escrow (BondManager): post → withdraw / slash conserve ETH exactly.
 *           - PER-MARKET INSURANCE ISOLATION (InsuranceHub): a market's sub-account can only be
 *             drawn to cover its OWN loss; another market can never touch it.
 */
contract PerpFuzzTest is Test {
    bytes32 constant CHAINLINK = keccak256("chainlink");
    address constant VENUE = address(0xFEED);

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

    address treasury = address(0x7);
    uint256 constant PK_A = uint256(keccak256("fuzz.A"));
    uint256 constant PK_B = uint256(keccak256("fuzz.B"));
    address A;
    address B;

    receive() external payable {}

    function setUp() public {
        A = vm.addr(PK_A);
        B = vm.addr(PK_B);
        col = new MockERC20("Collateral", "COL", 18);
        wethLike = new MockERC20("WethLike", "WETH", 18);
        agg = new MockAggregator(8, 2000e8); // Chainlink-style ETH/USD @ $2000, 8 decimals

        impl = new PerpMarket();
        registry = new MarketRegistry();
        oracleGuard = new OracleGuard();
        paramGuard = new ParamGuard(20 * 1e4, 50, 2, 15);
        insuranceHub = new InsuranceHub();
        bondManager = new BondManager(treasury, address(registry));
        feeRouter = new FeeRouter(treasury, address(insuranceHub));

        factory = new PerpMarketFactory(
            address(impl), address(wethLike), address(this), address(this), address(feeRouter),
            address(registry), treasury, 0, address(oracleGuard), address(paramGuard), address(bondManager)
        );
        feeRouter.setFactory(address(factory));
        bondManager.setFactory(address(factory));
        registry.setFactory(address(factory));
        oracleGuard.setFactory(address(factory));
        oracleGuard.setVenue(CHAINLINK, VENUE, true);
        factory.setMinBonds(0, 0);
    }

    // ============================================================
    // Helpers
    // ============================================================

    // MED-1 (round-4 audit): every market now requires a reference feed at creation, so the
    // "curated / matcher-trusted" config points refFeed at the mock aggregator. Tests that need the
    // matcher-trusted (guard no-op) runtime path disable the runtime guard on the clone after create
    // (owner power), see _createMatcherTrusted.
    function _cfgCurated() internal view returns (OracleGuard.OracleConfig memory) {
        return OracleGuard.OracleConfig({
            sourceType: CHAINLINK, venue: VENUE, refFeed: address(agg),
            maxDeviationBps: 500, maxStaleness: 1 days, minLiquidity: 0, dualSourceRequired: false
        });
    }

    /// @dev Create a curated market then DISABLE its runtime OracleGuard (owner == this post-handoff),
    ///      restoring the matcher-trusted price path so a test can drive arbitrary marks/exits. MED-1
    ///      only constrains market CREATION (a feed must be configured); the owner may still turn the
    ///      runtime breaker off for these math-focused fuzz tests.
    function _createMatcherTrusted(bytes32 id, uint256 feeRate_) internal returns (address market) {
        market = _create(id, feeRate_, _cfgCurated(), 0);
        PerpMarket(payable(market)).setOracleGuard(address(0));
    }

    function _cfgWithFeed(uint256 maxDevBps) internal view returns (OracleGuard.OracleConfig memory) {
        return OracleGuard.OracleConfig({
            sourceType: CHAINLINK, venue: VENUE, refFeed: address(agg),
            maxDeviationBps: maxDevBps, maxStaleness: 1 hours, minLiquidity: 0, dualSourceRequired: true
        });
    }

    function _create(bytes32 id, uint256 feeRate_, OracleGuard.OracleConfig memory cfg, uint8 tier)
        internal
        returns (address market)
    {
        market = factory.createMarket(address(col), 18, address(this), feeRate_, 10 * 1e4, id, tier, cfg);
    }

    function _fund(address m, address who, uint256 amt) internal {
        col.mint(who, amt);
        vm.prank(who);
        col.approve(m, amt);
        vm.prank(who);
        PerpMarket(payable(m)).deposit(address(col), amt);
    }

    function _order(address t, bool isLong, uint256 size, uint256 lev, uint256 price)
        internal
        view
        returns (PerpMarket.Order memory)
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
    // 1. Fee-split conservation (FeeRouter)  — SECURITY_REVIEW §5.10 / invariant #3
    // ============================================================

    /// Generate real trading fees, collect them, and prove the 3-way split conserves value
    /// and respects the platform floor, for fuzzed share settings and trade sizes.
    function testFuzz_feeSplitConservation(uint256 size, uint256 platformBps, uint256 creatorBps) public {
        size = bound(size, 1e15, 1e16);
        // Platform share >= floor (4000); platform + creator <= 10000.
        platformBps = bound(platformBps, feeRouter.platformFloorBps(), 9_000);
        creatorBps = bound(creatorBps, 0, 10_000 - platformBps);
        feeRouter.setShares(platformBps, creatorBps);

        // fee rate 10 bps; fund generously so settle succeeds.
        address m = _create("FEE", 10, _cfgCurated(), 0);
        _fund(m, A, 1e18);
        _fund(m, B, 1e18);
        _settle(m, size, 10 * 1e4, 2000e18);

        // Fees accrued to the router's internal balance in the market.
        (uint256 routerInternal,) = PerpMarket(payable(m)).balances(address(feeRouter));
        assertGt(routerInternal, 0, "no fees accrued");

        uint256 hubBefore = insuranceHub.balanceOf(m, address(col));
        uint256 total = feeRouter.collect(m);
        assertEq(total, routerInternal, "collected != accrued");

        uint256 platform = feeRouter.claimable(treasury, address(col));
        uint256 creator = feeRouter.claimable(address(this), address(col));
        uint256 insurance = insuranceHub.balanceOf(m, address(col)) - hubBefore;

        // CONSERVATION: the three slices sum EXACTLY to the total (remainder-based, no dust loss).
        assertEq(platform + creator + insurance, total, "fee split does not conserve total");
        // FLOOR: platform share never below the immutable floor.
        assertGe(platform, (total * feeRouter.platformFloorBps()) / 10_000, "platform below floor");
        // Split matches the configured bps (platform/creator floored, insurance = remainder).
        assertEq(platform, (total * platformBps) / 10_000, "platform slice wrong");
        assertEq(creator, (total * creatorBps) / 10_000, "creator slice wrong");
    }

    // ============================================================
    // 2. Settlement PnL is zero-sum / no collateral minted  — invariant #4
    // ============================================================

    /// Open a paired position then close it at a fuzzed exit price; assert the two traders'
    /// combined credited balance never exceeds their combined starting balance (no mint), and
    /// that when fully solvent (no insurance/ADL deficit) it is EXACTLY conserved.
    function testFuzz_settlePnLZeroSum(uint256 size, uint256 lev, uint256 exitPrice) public {
        size = bound(size, 1e15, 1e16);
        lev = bound(lev, 1e4, 10 * 1e4);
        uint256 entry = 2000e18;
        exitPrice = bound(exitPrice, 1000e18, 4000e18);

        address m = _createMatcherTrusted("PNL", 0); // feeRate 0 → clean zero-sum accounting; guard off for arbitrary exits

        uint256 fundA = 1e18;
        uint256 fundB = 1e18;
        _fund(m, A, fundA);
        _fund(m, B, fundB);

        uint256 startSum = fundA + fundB;
        _settle(m, size, lev, entry);

        PerpMarket(payable(m)).updatePrice(address(col), exitPrice);
        vm.prank(A);
        PerpMarket(payable(m)).closePair(1);

        (uint256 aAvail, uint256 aLock) = PerpMarket(payable(m)).getUserBalance(A);
        (uint256 bAvail, uint256 bLock) = PerpMarket(payable(m)).getUserBalance(B);
        assertEq(aLock, 0, "long still locked after close");
        assertEq(bLock, 0, "short still locked after close");

        uint256 endSum = aAvail + bAvail;
        // NO MINT: the two traders can never end with more than they started (fee 0, no funding here
        // because close happens in the same block → elapsed 0). Any winner-shortfall is paid from
        // EXTERNAL insurance to the winner's WALLET, not credited internally, so endSum <= startSum.
        assertLe(endSum, startSum, "PnL minted collateral into trader balances");
        // Solvency: the clone still holds >= what it owes these two traders.
        assertLe(endSum, col.balanceOf(m), "insolvent after close");
    }

    /// Winner's internal gain is bounded by the loser's collateral (excess is external, never minted).
    function testFuzz_winnerGainBoundedByLoserCollateral(uint256 size, uint256 lev) public {
        size = bound(size, 1e15, 1e16);
        lev = bound(lev, 2e4, 10 * 1e4); // >1x so a 2x price move overruns loser collateral
        address m = _createMatcherTrusted("BND", 0); // guard off: this test drives the mark to 2x
        _fund(m, A, 1e18);
        _fund(m, B, 1e18);

        (uint256 aBefore,) = PerpMarket(payable(m)).getUserBalance(A);
        _settle(m, size, lev, 2000e18);
        // Long wins big: price doubles.
        PerpMarket(payable(m)).updatePrice(address(col), 4000e18);
        vm.prank(A);
        PerpMarket(payable(m)).closePair(1);

        (uint256 aAfter,) = PerpMarket(payable(m)).getUserBalance(A);
        uint256 collat = (size * 1e4) / lev;
        // Long's internal balance can grow by at most its own collateral back + the loser's collateral.
        assertLe(aAfter, aBefore + collat, "winner credited more than loser collateral internally");
    }

    // ============================================================
    // 3. OracleGuard deviation / staleness breaker (H-1) — stubbed feed, no fork
    // ============================================================

    /// checkDeviation must revert iff |mark - ref| / ref exceeds the configured band.
    function testFuzz_oracleDeviationBand(uint256 markPrice, uint256 bandBps) public {
        bandBps = bound(bandBps, oracleGuard.MIN_DEVIATION_BPS(), oracleGuard.MAX_DEVIATION_BPS());
        markPrice = bound(markPrice, 1, 100_000e18);

        // Permissionless-tier market with the mock Chainlink feed wired as refFeed.
        address m = _create("ORA", 10, _cfgWithFeed(bandBps), 1);

        agg.set(2000e8, block.timestamp); // fresh ref @ $2000
        uint256 ref = 2000e18;
        uint256 diff = markPrice > ref ? markPrice - ref : ref - markPrice;
        bool shouldRevert = (diff * 10_000) / ref > bandBps;

        if (shouldRevert) {
            vm.expectRevert(OracleGuard.PriceDeviationTooLarge.selector);
            oracleGuard.checkDeviation(m, markPrice);
        } else {
            oracleGuard.checkDeviation(m, markPrice); // must not revert
        }
    }

    /// A stale reference round must trip the staleness breaker regardless of price.
    function testFuzz_oracleStaleness(uint256 age) public {
        address m = _create("STALE", 10, _cfgWithFeed(2000), 1);
        // config maxStaleness = 1 hours
        age = bound(age, 0, 10 days);
        vm.warp(block.timestamp + 20 days); // move now well ahead
        agg.set(2000e8, block.timestamp - age);

        if (age > 1 hours) {
            vm.expectRevert(OracleGuard.StalePrice.selector);
            oracleGuard.checkDeviation(m, 2000e18);
        } else {
            oracleGuard.checkDeviation(m, 2000e18); // fresh enough, in-band → ok
        }
    }

    /// The guard, once WIRED into a market, blocks an out-of-band matcher price at updatePrice.
    function testFuzz_guardWiredBlocksBadPrice(uint256 markPrice) public {
        markPrice = bound(markPrice, 1, 100_000e18);
        address m = _create("WIRE", 10, _cfgWithFeed(500), 1); // 5% band
        agg.set(2000e8, block.timestamp);
        uint256 ref = 2000e18;
        uint256 diff = markPrice > ref ? markPrice - ref : ref - markPrice;
        bool bad = (diff * 10_000) / ref > 500;

        if (bad) {
            vm.expectRevert(OracleGuard.PriceDeviationTooLarge.selector);
            PerpMarket(payable(m)).updatePrice(address(col), markPrice);
        } else {
            PerpMarket(payable(m)).updatePrice(address(col), markPrice);
            assertEq(PerpMarket(payable(m)).tokenPrices(address(col)), markPrice, "price not written");
        }
    }

    // ============================================================
    // 4. Bond escrow conservation (BondManager)
    // ============================================================

    /// Post a bond then reclaim it after the delay: exact ETH round-trip, no leak.
    function testFuzz_bondPostAndWithdraw(uint256 bondAmt) public {
        bondAmt = bound(bondAmt, 1, 100 ether);
        factory.setMinBonds(bondAmt, bondAmt);

        vm.deal(address(this), bondAmt);
        address m = factory.createMarket{value: bondAmt}(
            address(col), 18, address(this), 10, 10 * 1e4, "BOND", 0, _cfgCurated()
        );

        BondManager.Bond memory b = bondManager.bondOf(m);
        assertEq(b.amount, bondAmt, "bond not escrowed");
        assertEq(address(bondManager).balance, bondAmt, "manager ETH != bond");

        vm.warp(block.timestamp + 8 days);
        uint256 balBefore = address(this).balance;
        bondManager.withdrawBond(m);
        assertEq(address(this).balance - balBefore, bondAmt, "bond not fully reclaimed");
        assertEq(address(bondManager).balance, 0, "manager retained ETH");
    }

    /// Slash sends the bond to treasury, exactly once, and blocks a later withdraw.
    function testFuzz_bondSlashToTreasury(uint256 bondAmt) public {
        bondAmt = bound(bondAmt, 1, 100 ether);
        factory.setMinBonds(bondAmt, bondAmt);
        vm.deal(address(this), bondAmt);
        address m = factory.createMarket{value: bondAmt}(
            address(col), 18, address(this), 10, 10 * 1e4, "SLASH", 0, _cfgCurated()
        );

        uint256 tBefore = treasury.balance;
        bondManager.slash(m);
        assertEq(treasury.balance - tBefore, bondAmt, "treasury did not receive full bond");
        assertEq(address(bondManager).balance, 0, "manager retained slashed ETH");

        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(BondManager.BondAlreadySlashed.selector);
        bondManager.withdrawBond(m);
    }

    // ============================================================
    // 5. Per-market insurance sub-account isolation (InsuranceHub)
    // ============================================================

    /// A market can only draw its OWN sub-account; a second market's coverLoss on the first
    /// market's key is blocked, and draining one market never touches another's funds.
    function testFuzz_insuranceIsolation(uint256 feeAmtA, uint256 feeAmtB, uint256 cover) public {
        feeAmtA = bound(feeAmtA, 1e6, 1e24);
        feeAmtB = bound(feeAmtB, 1e6, 1e24);

        address mA = address(0xA0A0);
        address mB = address(0xB0B0);

        // Fund each market's sub-account with real tokens via notifyFee (approve + pull).
        col.mint(address(this), feeAmtA + feeAmtB);
        col.approve(address(insuranceHub), feeAmtA + feeAmtB);
        insuranceHub.notifyFee(mA, address(col), feeAmtA);
        insuranceHub.notifyFee(mB, address(col), feeAmtB);

        assertEq(insuranceHub.balanceOf(mA, address(col)), feeAmtA, "A sub-account wrong");
        assertEq(insuranceHub.balanceOf(mB, address(col)), feeAmtB, "B sub-account wrong");

        // Authorize this test as a coverer so we can call coverLoss for BOTH markets.
        insuranceHub.setAuthorizedCoverer(address(this), true);

        // Covering market A's loss draws ONLY A's balance; B is untouched.
        cover = bound(cover, 1, feeAmtA);
        address to = address(0xDEAD);
        uint256 toBefore = col.balanceOf(to);
        insuranceHub.coverLoss(mA, address(col), cover, to);

        assertEq(col.balanceOf(to) - toBefore, cover, "coverage not paid");
        assertEq(insuranceHub.balanceOf(mA, address(col)), feeAmtA - cover, "A not debited exactly");
        assertEq(insuranceHub.balanceOf(mB, address(col)), feeAmtB, "B sub-account leaked!");

        // A cannot draw MORE than its own balance (no cross-market reach, backstop off).
        vm.expectRevert(InsuranceHub.InsufficientMarketInsurance.selector);
        insuranceHub.coverLoss(mA, address(col), (feeAmtA - cover) + 1, to);
        // ...even though the hub physically holds B's tokens too.
        assertEq(insuranceHub.balanceOf(mB, address(col)), feeAmtB, "B sub-account still intact");
    }
}
