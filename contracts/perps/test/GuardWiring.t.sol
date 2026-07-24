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

interface IWETH9 {
    function deposit() external payable;
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
    function decimals() external view returns (uint8);
}

/**
 * @title GuardWiringTest
 * @notice FORK test (live Sepolia) proving SECURITY_REVIEW.md H-1 / H-2 / M-1 are now wired into
 *         PerpMarket's settlement hot path — AND that the normal settle/close path still works.
 *
 *         It reads the REAL Sepolia Chainlink ETH/USD feed (0x694AA176…) and REAL WETH
 *         (0xfFf99767…), and deploys a fresh copy of the whole self-service stack (the v4 impl +
 *         factory + shared guards) owned by this test contract. No funded key / no broadcast:
 *         the guard behaviour is asserted against live chain state via forge cheatcodes.
 *
 *         Run: forge test --match-path test/GuardWiring.t.sol --fork-url $SEPOLIA_RPC_URL -vv
 */
contract GuardWiringTest is Test {
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    bytes32 constant CHAINLINK = keccak256("chainlink");

    uint256 constant TRADER_A_PK = uint256(keccak256("hookswap.perps.guardwiring.traderA"));
    uint256 constant TRADER_B_PK = uint256(keccak256("hookswap.perps.guardwiring.traderB"));

    PerpMarket impl;
    PerpMarketFactory factory;
    FeeRouter feeRouter;
    MarketRegistry registry;
    OracleGuard oracleGuard;
    ParamGuard paramGuard;
    BondManager bondManager;
    InsuranceHub insuranceHub;

    address traderA;
    address traderB;
    uint256 ref; // live Chainlink ETH/USD normalized to 1e18

    function setUp() public {
        vm.createSelectFork(vm.envString("SEPOLIA_RPC_URL"));

        traderA = vm.addr(TRADER_A_PK);
        traderB = vm.addr(TRADER_B_PK);

        // Fresh self-service stack, this test contract is owner of every shared piece.
        impl = new PerpMarket();
        registry = new MarketRegistry();
        oracleGuard = new OracleGuard();
        paramGuard = new ParamGuard(20 * 1e4, 50, 2, 15); // 20x ceiling, 0.5% mm, [2,15] bps
        insuranceHub = new InsuranceHub();
        bondManager = new BondManager(address(this), address(registry));
        feeRouter = new FeeRouter(address(this), address(insuranceHub));

        factory = new PerpMarketFactory(
            address(impl),
            WETH,
            address(this), // platformMatcher (this test settles)
            address(this), // platformAdmin (this test owns markets post-handoff)
            address(feeRouter),
            address(registry),
            address(this), // listing-fee treasury
            0, // listingFee
            address(oracleGuard),
            address(paramGuard),
            address(bondManager)
        );

        feeRouter.setFactory(address(factory));
        bondManager.setFactory(address(factory));
        registry.setFactory(address(factory));
        oracleGuard.setFactory(address(factory));
        oracleGuard.setVenue(CHAINLINK, ETH_USD, true);
        factory.setMinBonds(0, 0); // no bond needed for the test flow

        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(ETH_USD).latestRoundData();
        require(answer > 0, "bad live feed");
        uint8 dec = IAggregatorV3(ETH_USD).decimals();
        ref = (uint256(answer) * 1e18) / (10 ** dec);
        emit log_named_uint("live Chainlink ETH/USD (1e18)", ref);
        emit log_named_uint("feed updatedAt", updatedAt);
    }

    // --------------------------------------------------------------------
    // helpers
    // --------------------------------------------------------------------

    function _cfg(uint256 maxDevBps) internal pure returns (OracleGuard.OracleConfig memory) {
        return OracleGuard.OracleConfig({
            sourceType: CHAINLINK,
            venue: ETH_USD,
            refFeed: ETH_USD,
            maxDeviationBps: maxDevBps,
            maxStaleness: 30 days, // generous → the deviation band, not staleness, is what we test
            minLiquidity: 0,
            dualSourceRequired: true
        });
    }

    function _createMarket(uint256 maxDevBps, uint256 lev, bytes32 id) internal returns (address market) {
        market = factory.createMarket(WETH, 18, address(this), 10, lev, id, 1 /*PERMISSIONLESS*/, _cfg(maxDevBps));
    }

    function _fund(address market, uint256 amt) internal {
        vm.deal(traderA, amt);
        vm.deal(traderB, amt);
        vm.prank(traderA);
        PerpMarket(payable(market)).depositETH{value: amt}();
        vm.prank(traderB);
        PerpMarket(payable(market)).depositETH{value: amt}();
    }

    function _order(address trader, bool isLong, uint256 size, uint256 lev, uint256 price, PerpMarket.OrderType ot)
        internal
        view
        returns (PerpMarket.Order memory)
    {
        return PerpMarket.Order({
            trader: trader,
            token: WETH,
            isLong: isLong,
            size: size,
            leverage: lev,
            price: price,
            deadline: block.timestamp + 1_000_000,
            nonce: 0,
            orderType: ot
        });
    }

    function _pair(
        address market,
        uint256 size,
        uint256 lev,
        uint256 matchPrice,
        uint256 longLimit,
        uint256 shortLimit,
        PerpMarket.OrderType longOt,
        PerpMarket.OrderType shortOt
    ) internal view returns (PerpMarket.MatchedPair[] memory pairs) {
        PerpMarket.Order memory lo = _order(traderA, true, size, lev, longLimit, longOt);
        PerpMarket.Order memory so = _order(traderB, false, size, lev, shortLimit, shortOt);
        bytes32 lh = PerpMarket(payable(market)).getOrderHash(lo);
        bytes32 sh = PerpMarket(payable(market)).getOrderHash(so);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(TRADER_A_PK, lh);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(TRADER_B_PK, sh);
        pairs = new PerpMarket.MatchedPair[](1);
        pairs[0] = PerpMarket.MatchedPair({
            longOrder: lo,
            longSignature: abi.encodePacked(r1, s1, v1),
            shortOrder: so,
            shortSignature: abi.encodePacked(r2, s2, v2),
            matchPrice: matchPrice,
            matchSize: size
        });
    }

    // --------------------------------------------------------------------
    // 0. WIRING — the review's "0 call sites" must now be non-zero
    // --------------------------------------------------------------------
    function test_0_Wiring_CloneReferencesGuards() public {
        address m = _createMarket(500, 10 * 1e4, "WIRE");
        assertEq(PerpMarket(payable(m)).oracleGuard(), address(oracleGuard), "oracleGuard not wired");
        assertEq(PerpMarket(payable(m)).insuranceFund(), address(insuranceHub), "insuranceFund not wired");
        assertEq(PerpMarket(payable(m)).collateralToken(), WETH, "collateralToken not captured");
    }

    // --------------------------------------------------------------------
    // 1. REGRESSION — normal settle + close still works with guards active
    // --------------------------------------------------------------------
    function test_1_Regression_SettleAndClose() public {
        address m = _createMarket(500 /*5%*/, 10 * 1e4, "REG");
        _fund(m, 0.003 ether);

        // Settle at the LIVE reference price (0% deviation → passes H-1); MARKET orders.
        PerpMarket.MatchedPair[] memory pairs =
            _pair(m, 1e16, 10 * 1e4, ref, ref, ref, PerpMarket.OrderType.MARKET, PerpMarket.OrderType.MARKET);
        PerpMarket(payable(m)).settleBatch(pairs);

        PerpMarket.PairedPosition memory pos = PerpMarket(payable(m)).getPairedPosition(1);
        assertEq(uint256(pos.status), uint256(PerpMarket.PositionStatus.ACTIVE), "pair did not open");
        assertEq(pos.entryPrice, ref, "entry != ref");
        emit log_named_uint("REGRESSION: pair opened at entry", pos.entryPrice);

        // Close at the same in-band price (user path uses tokenPrices → set it first, also guarded).
        PerpMarket(payable(m)).updatePrice(WETH, ref);
        vm.prank(traderA);
        PerpMarket(payable(m)).closePair(1);
        pos = PerpMarket(payable(m)).getPairedPosition(1);
        assertEq(uint256(pos.status), uint256(PerpMarket.PositionStatus.CLOSED), "pair did not close");
        emit log_string("REGRESSION OK: settle + close succeed with guards active");
    }

    // --------------------------------------------------------------------
    // 2. H-1 — settle at >1.5x live Chainlink price REVERTS on the settle path
    // --------------------------------------------------------------------
    function test_2_H1_DeviationBlocksSettle() public {
        address m = _createMarket(500 /*5% band*/, 10 * 1e4, "H1");
        _fund(m, 0.001 ether);

        uint256 badPrice = (ref * 160) / 100; // +60% vs live feed, far outside 5%
        PerpMarket.MatchedPair[] memory pairs =
            _pair(m, 1e16, 10 * 1e4, badPrice, badPrice, badPrice, PerpMarket.OrderType.MARKET, PerpMarket.OrderType.MARKET);

        vm.expectRevert(OracleGuard.PriceDeviationTooLarge.selector);
        PerpMarket(payable(m)).settleBatch(pairs);
        emit log_string("H-1 OK: settleBatch at 1.6x live price reverts PriceDeviationTooLarge");

        // And the matcher can't even write the bad mark via updatePrice.
        vm.expectRevert(OracleGuard.PriceDeviationTooLarge.selector);
        PerpMarket(payable(m)).updatePrice(WETH, badPrice);
        emit log_string("H-1 OK: updatePrice at 1.6x live price reverts PriceDeviationTooLarge");
    }

    // --------------------------------------------------------------------
    // 3. H-2 — signed LIMIT price enforced on the settle path
    // --------------------------------------------------------------------
    function test_3_H2_LimitPriceEnforced() public {
        address m = _createMarket(1000 /*10% band*/, 10 * 1e4, "H2");
        _fund(m, 0.003 ether);

        // Long LIMIT signed at ref; matcher tries to fill 1% ABOVE it (in H-1 band, but > limit).
        uint256 over = (ref * 101) / 100;
        PerpMarket.MatchedPair[] memory bad =
            _pair(m, 1e16, 10 * 1e4, over, ref /*long limit*/, 0, PerpMarket.OrderType.LIMIT, PerpMarket.OrderType.MARKET);
        vm.expectRevert(PerpMarket.LimitPriceViolated.selector);
        PerpMarket(payable(m)).settleBatch(bad);
        emit log_string("H-2 OK: LIMIT long filled above signed price reverts LimitPriceViolated");

        // Same limit, matcher fills AT the limit (<= price) → passes.
        PerpMarket.MatchedPair[] memory ok =
            _pair(m, 1e16, 10 * 1e4, ref, ref /*long limit*/, 0, PerpMarket.OrderType.LIMIT, PerpMarket.OrderType.MARKET);
        PerpMarket(payable(m)).settleBatch(ok);
        PerpMarket.PairedPosition memory pos = PerpMarket(payable(m)).getPairedPosition(1);
        assertEq(uint256(pos.status), uint256(PerpMarket.PositionStatus.ACTIVE), "compliant LIMIT fill failed");
        emit log_string("H-2 OK: LIMIT long filled at signed price settles");
    }

    // --------------------------------------------------------------------
    // 4. Winner is CAPPED at counterparty collateral — insurance is NEVER drawn by a trade winner.
    //    (Supersedes the old M-1 "insurance covers the winner deficit", which was harvestable by a
    //    delta-neutral self/colluding pair. Winner-cap decision, 2026-07-24.)
    // --------------------------------------------------------------------
    function test_4_WinnerCappedNoInsuranceDraw() public {
        address m = _createMarket(2000 /*20% band*/, 20 * 1e4, "M1");
        _fund(m, 0.001 ether);

        // Seed THIS market's InsuranceHub sub-account — it must remain UNTOUCHED by the trade winner.
        uint256 seed = 1e15;
        vm.deal(address(this), seed);
        IWETH9(WETH).deposit{value: seed}();
        IWETH9(WETH).approve(address(insuranceHub), seed);
        insuranceHub.notifyFee(m, WETH, seed);
        assertEq(insuranceHub.balanceOf(m, WETH), seed, "hub sub-account not seeded");

        uint256 size = 1e16; // @20x → collateral 5e14 each side
        PerpMarket.MatchedPair[] memory pairs =
            _pair(m, size, 20 * 1e4, ref, ref, ref, PerpMarket.OrderType.MARKET, PerpMarket.OrderType.MARKET);
        PerpMarket(payable(m)).settleBatch(pairs);

        // Close at +10% (in-band): long "profit" 1e15 exceeds the short's 5e14 collateral by 5e14.
        // Old behaviour paid that 5e14 from insurance to the winner; now the winner is CAPPED.
        uint256 exit = (ref * 110) / 100;
        uint256 hubBefore = insuranceHub.balanceOf(m, WETH);
        uint256 winnerWethBefore = IWETH9(WETH).balanceOf(traderA);
        (uint256 aAvailBefore,) = PerpMarket(payable(m)).getUserBalance(traderA);

        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        uint256[] memory exits = new uint256[](1);
        exits[0] = exit;
        PerpMarket(payable(m)).closePairsBatch(ids, exits);

        (uint256 aAvailAfter,) = PerpMarket(payable(m)).getUserBalance(traderA);

        // The anti-harvest guarantee: insurance is NOT drawn by a trade winner.
        assertEq(insuranceHub.balanceOf(m, WETH), hubBefore, "insurance drawn by a trade winner (must be capped)");
        // No direct wallet payout from insurance to the winner.
        assertEq(IWETH9(WETH).balanceOf(traderA), winnerWethBefore, "winner wrongly paid from insurance");
        // Winner capped at counterparty collateral: gets own 5e14 back + loser's 5e14 = 1e15, NOT 1.5e15.
        assertEq(aAvailAfter - aAvailBefore, 1e15, "winner not capped at own+counterparty collateral");
        emit log_string("WINNER-CAP OK: insurance untouched by winner; capped at counterparty collateral");
    }
}
