// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
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
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
    function decimals() external view returns (uint8);
}

/// @dev A >18-decimal ERC20 to exercise the L-3 zero-normalization guard.
contract Mock20Dec is ERC20 {
    constructor() ERC20("Mock20", "M20") {}
    function decimals() public pure override returns (uint8) { return 20; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/**
 * @title SecurityFixesV5Test
 * @notice FORK test (live Sepolia) proving SECURITY_REVIEW.md M-3 / L-2 / L-3 / M-4 are fixed in
 *         the v5 PerpMarket + BondManager, AND that the normal settle / close / liquidation path
 *         (and the H-1/H-2/M-1 v4 wiring) still works. Deploys a fresh copy of the whole
 *         self-service stack (v5 sources) owned by this test contract; asserts against the REAL
 *         Sepolia Chainlink ETH/USD feed + REAL WETH via forge cheatcodes. No key / no broadcast.
 *
 *         Run: forge test --match-path test/SecurityFixesV5.t.sol --fork-url $SEPOLIA_RPC_URL -vv
 */
contract SecurityFixesV5Test is Test {
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    bytes32 constant CHAINLINK = keccak256("chainlink");

    uint256 constant TRADER_A_PK = uint256(keccak256("hookswap.perps.v5.traderA"));
    uint256 constant TRADER_B_PK = uint256(keccak256("hookswap.perps.v5.traderB"));

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
    address liquidator = address(0xA11);
    uint256 ref;

    receive() external payable {} // M-4: reclaimed bond ETH is sent back to the creator (this).

    function setUp() public {
        vm.createSelectFork(vm.envString("SEPOLIA_RPC_URL"));
        traderA = vm.addr(TRADER_A_PK);
        traderB = vm.addr(TRADER_B_PK);

        impl = new PerpMarket();
        registry = new MarketRegistry();
        oracleGuard = new OracleGuard();
        paramGuard = new ParamGuard(20 * 1e4, 50, 2, 15);
        insuranceHub = new InsuranceHub();
        bondManager = new BondManager(address(this), address(registry));
        feeRouter = new FeeRouter(address(this), address(insuranceHub));

        factory = new PerpMarketFactory(
            address(impl), WETH, address(this), address(this), address(feeRouter),
            address(registry), address(this), 0, address(oracleGuard), address(paramGuard), address(bondManager)
        );

        feeRouter.setFactory(address(factory));
        bondManager.setFactory(address(factory));
        registry.setFactory(address(factory));
        oracleGuard.setFactory(address(factory));
        oracleGuard.setVenue(CHAINLINK, ETH_USD, true);
        factory.setMinBonds(0, 0);

        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(ETH_USD).latestRoundData();
        require(answer > 0, "bad live feed");
        ref = (uint256(answer) * 1e18) / (10 ** IAggregatorV3(ETH_USD).decimals());
        emit log_named_uint("live Chainlink ETH/USD (1e18)", ref);
        emit log_named_uint("feed updatedAt", updatedAt);
    }

    // ---------------- helpers ----------------

    function _cfg(uint256 maxDevBps) internal pure returns (OracleGuard.OracleConfig memory) {
        return OracleGuard.OracleConfig({
            sourceType: CHAINLINK, venue: ETH_USD, refFeed: ETH_USD,
            maxDeviationBps: maxDevBps, maxStaleness: 30 days, minLiquidity: 0, dualSourceRequired: true
        });
    }

    function _createMarket(uint256 maxDevBps, uint256 lev, bytes32 id) internal returns (address market) {
        market = factory.createMarket(WETH, 18, address(this), 10, lev, id, 1, _cfg(maxDevBps));
    }

    function _order(address trader, bool isLong, uint256 size, uint256 lev, uint256 price, PerpMarket.OrderType ot)
        internal view returns (PerpMarket.Order memory)
    {
        return PerpMarket.Order({
            trader: trader, token: WETH, isLong: isLong, size: size, leverage: lev, price: price,
            deadline: block.timestamp + 1_000_000, nonce: 0, orderType: ot
        });
    }

    function _pair(address market, uint256 size, uint256 lev, uint256 matchPrice)
        internal view returns (PerpMarket.MatchedPair[] memory pairs)
    {
        PerpMarket.Order memory lo = _order(traderA, true, size, lev, matchPrice, PerpMarket.OrderType.MARKET);
        PerpMarket.Order memory so = _order(traderB, false, size, lev, matchPrice, PerpMarket.OrderType.MARKET);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(TRADER_A_PK, PerpMarket(payable(market)).getOrderHash(lo));
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(TRADER_B_PK, PerpMarket(payable(market)).getOrderHash(so));
        pairs = new PerpMarket.MatchedPair[](1);
        pairs[0] = PerpMarket.MatchedPair({
            longOrder: lo, longSignature: abi.encodePacked(r1, s1, v1),
            shortOrder: so, shortSignature: abi.encodePacked(r2, s2, v2),
            matchPrice: matchPrice, matchSize: size
        });
    }

    function _fundExact(address market, address who, uint256 pk, uint256 amt) internal {
        vm.deal(who, amt);
        vm.prank(who);
        PerpMarket(payable(market)).depositETH{value: amt}();
        pk; // silence
    }

    // ---------------- 0. regression ----------------
    function test_0_Regression_SettleAndClose() public {
        address m = _createMarket(500, 10 * 1e4, "REG");
        vm.deal(traderA, 0.003 ether); vm.deal(traderB, 0.003 ether);
        vm.prank(traderA); PerpMarket(payable(m)).depositETH{value: 0.003 ether}();
        vm.prank(traderB); PerpMarket(payable(m)).depositETH{value: 0.003 ether}();

        PerpMarket(payable(m)).settleBatch(_pair(m, 1e16, 10 * 1e4, ref));
        PerpMarket.PairedPosition memory pos = PerpMarket(payable(m)).getPairedPosition(1);
        assertEq(uint256(pos.status), uint256(PerpMarket.PositionStatus.ACTIVE), "pair did not open");

        PerpMarket(payable(m)).updatePrice(WETH, ref);
        vm.prank(traderA); PerpMarket(payable(m)).closePair(1);
        pos = PerpMarket(payable(m)).getPairedPosition(1);
        assertEq(uint256(pos.status), uint256(PerpMarket.PositionStatus.CLOSED), "pair did not close");
        emit log_string("REGRESSION OK: settle + close still work in v5");
    }

    // ---------------- F-1 / F-2: both-negative funding close must conserve value (no insurance drain) ----------------
    function test_F2_BothNegativePnL_FundingBacked_NoDrain() public {
        address m = _createMarket(500, 10 * 1e4, "F2");
        uint256 dep = 0.003 ether;
        vm.deal(traderA, dep); vm.deal(traderB, dep);
        vm.prank(traderA); PerpMarket(payable(m)).depositETH{value: dep}();
        vm.prank(traderB); PerpMarket(payable(m)).depositETH{value: dep}();

        uint256 size = 1e16;
        PerpMarket(payable(m)).settleBatch(_pair(m, size, 10 * 1e4, ref));
        PerpMarket(payable(m)).updatePrice(WETH, ref); // mark == entry → price PnL is ZERO both sides

        // Accrue funding over 3 intervals with NO price move → BOTH sides' funding-adjusted PnL is
        // negative. Pre-fix this hit `uint256(negativeShortPnL)` (~2^256) → wrong pay-out + insurance drain.
        uint256 periods = 3;
        vm.warp(block.timestamp + periods * 5 minutes);

        address hub = PerpMarket(payable(m)).insuranceFund();
        (uint256 insBefore,) = PerpMarket(payable(m)).getUserBalance(hub);
        assertEq(insBefore, 0, "insurance should start empty");

        vm.prank(traderA);
        PerpMarket(payable(m)).closePair(1); // must NOT revert or drain

        PerpMarket.PairedPosition memory p = PerpMarket(payable(m)).getPairedPosition(1);
        assertEq(uint256(p.status), uint256(PerpMarket.PositionStatus.CLOSED), "did not close");

        uint256 fundingPerSide = (size * 1 * periods) / 10000; // FIXED_FUNDING_RATE=1 / PRECISION=10000
        uint256 feePerSide = (size * 10) / 10000;              // feeRate=10 bps charged at settleBatch open
        (uint256 insAfter,) = PerpMarket(payable(m)).getUserBalance(hub);
        (uint256 aAvail,) = PerpMarket(payable(m)).getUserBalance(traderA);
        (uint256 bAvail,) = PerpMarket(payable(m)).getUserBalance(traderB);

        // F-1: insurance receives EXACTLY the backed funding (2× per-side), nothing invented / drained.
        assertEq(insAfter, fundingPerSide * 2, "insurance must equal the backed funding (F-1)");
        // F-2: value conserved — traders back + insurance + the open fee == total deposited. No drain, no mint.
        assertEq(aAvail + bAvail + insAfter + feePerSide * 2, dep * 2, "value not conserved (F-2 drain/mint)");
        // Symmetric: both sides lost EXACTLY (fee + funding). Pre-fix the negative-cast paid the "short"
        // both collaterals (asymmetric) and drained insurance via a bogus winner deficit.
        assertEq(aAvail, bAvail, "asymmetric settlement - F-2 mis-pay");
        assertEq(aAvail, dep - fundingPerSide - feePerSide, "trader out by != fee+funding");
        emit log_string("F-1/F-2 OK: both-negative funding close conserves value; insurance backed; no drain");
    }

    // ---------------- 1. M-3 + L-2: partial liquidation reward, penalty routed to insurance ----------------
    function test_1_M3L2_PartialLiquidationRewardAndRouting() public {
        // 20% deviation band so a 5% adverse mark (vs live ref) is in-band; 20x leverage.
        address m = _createMarket(2000, 20 * 1e4, "M3");

        // size 0.01 @20x: collateral 5e14/side, fee 1e13/side, penalty = 5% of collateral = 2.5e13.
        uint256 size = 1e16;
        // Fund the long with collateral+fee (5.1e14) + a residual (1e13) that is < penalty (2.5e13),
        // so after a full-loss settlement his available (1e13) is below the 2.5e13 penalty. Old code
        // (all-or-nothing `available >= penalty`) would pay the liquidator NOTHING; v5 pays partial.
        vm.deal(traderA, 5.2e14); vm.prank(traderA); PerpMarket(payable(m)).depositETH{value: 5.2e14}();
        vm.deal(traderB, 6e14);   vm.prank(traderB); PerpMarket(payable(m)).depositETH{value: 6e14}();

        PerpMarket(payable(m)).settleBatch(_pair(m, size, 20 * 1e4, ref));

        // Move the mark 5% against the long (in the 20% band → passes the H-1 guard).
        uint256 mark = (ref * 95) / 100;
        PerpMarket(payable(m)).updatePrice(WETH, mark);

        (bool liqLong,) = PerpMarket(payable(m)).canLiquidate(1);
        assertTrue(liqLong, "long should be liquidatable at -5%");

        (uint256 longAvailBefore,) = PerpMarket(payable(m)).getUserBalance(traderA);
        (uint256 liqRewardBefore,) = PerpMarket(payable(m)).getUserBalance(liquidator);
        (uint256 hubAcctBefore,)  = PerpMarket(payable(m)).getUserBalance(address(insuranceHub));
        assertLt(longAvailBefore, 25e12, "test setup: residual must be < full penalty (2.5e13)");

        vm.prank(liquidator);
        PerpMarket(payable(m)).liquidate(1);

        (uint256 liqRewardAfter,) = PerpMarket(payable(m)).getUserBalance(liquidator);
        (uint256 hubAcctAfter,)   = PerpMarket(payable(m)).getUserBalance(address(insuranceHub));
        (uint256 longAvailAfter,) = PerpMarket(payable(m)).getUserBalance(traderA);

        uint256 actualPenalty = longAvailBefore;          // residual < penalty → whole residual taken
        uint256 reward = actualPenalty / 2;
        uint256 toInsurance = actualPenalty - reward;

        // M-3: liquidator PAID a (partial) reward — the old code would have paid 0 here.
        assertGt(liqRewardAfter - liqRewardBefore, 0, "M-3: liquidator got no reward");
        assertEq(liqRewardAfter - liqRewardBefore, reward, "M-3: reward != residual/2");
        // L-2: the insurance slice landed in the WIRED insurance sub-account, not a dead counter.
        assertEq(hubAcctAfter - hubAcctBefore, toInsurance, "L-2: penalty not routed to insurance sub-account");
        assertEq(longAvailAfter, 0, "residual not fully consumed by partial penalty");

        (, uint256 pendingPenalty) = PerpMarket(payable(m)).getPendingInsuranceAmount();
        assertEq(pendingPenalty, 0, "L-2: pendingLiquidationPenalty counter should stay 0 when insuranceFund set");

        PerpMarket.PairedPosition memory pos = PerpMarket(payable(m)).getPairedPosition(1);
        assertEq(uint256(pos.status), uint256(PerpMarket.PositionStatus.LIQUIDATED), "not liquidated");
        emit log_named_uint("M-3 OK: liquidator reward (was 0 pre-fix)", reward);
        emit log_named_uint("L-2 OK: routed to insurance sub-account", toInsurance);
    }

    // ---------------- 2. L-3: dust that normalizes to 0 reverts instead of silently pulling ----------------
    function test_2_L3_ZeroNormalizedDepositReverts() public {
        address m = _createMarket(500, 10 * 1e4, "L3");
        Mock20Dec tok = new Mock20Dec();
        PerpMarket(payable(m)).addSupportedToken(address(tok), 20); // owner == this post-handoff

        tok.mint(address(this), 1000);
        tok.approve(m, 1000);

        // 99 units of a 20-dec token → 99 / 1e2 = 0 standardized. Must revert (v5), not credit 0.
        vm.expectRevert(PerpMarket.InvalidAmount.selector);
        PerpMarket(payable(m)).deposit(address(tok), 99);
        emit log_string("L-3 OK: zero-normalized deposit reverts InvalidAmount");

        // Control: 100 units → 1 standardized → succeeds.
        PerpMarket(payable(m)).deposit(address(tok), 100);
        (uint256 avail,) = PerpMarket(payable(m)).getUserBalance(address(this));
        assertEq(avail, 1, "control deposit should credit 1");
        emit log_string("L-3 OK: 100 units credits 1 (control)");
    }

    // ---------------- 3. M-4: PAUSED market's bond is reclaimable; only DELISTED/slashed blocks ----------------
    function test_3_M4_PausedBondReclaimable() public {
        uint256 bond = 1e15;
        factory.setMinBonds(bond, bond); // permissionless tier bond

        // Create BOTH markets up front (both postedAt = now), then warp ONCE past the cool-down.
        vm.deal(address(this), 2 * bond);
        address m  = factory.createMarket{value: bond}(WETH, 18, address(this), 10, 10 * 1e4, "M4A", 1, _cfg(500));
        address m2 = factory.createMarket{value: bond}(WETH, 18, address(this), 10, 10 * 1e4, "M4B", 1, _cfg(500));
        vm.warp(block.timestamp + 8 days); // withdrawDelay is 7 days

        // Ordinary operational PAUSE must NOT trap the bond (the M-4 fix).
        registry.setStatus(m, MarketRegistry.Status.PAUSED);
        uint256 balBefore = address(this).balance;
        bondManager.withdrawBond(m); // creator == this
        assertEq(address(this).balance - balBefore, bond, "M-4: paused-market bond not reclaimed");
        emit log_string("M-4 OK: bond reclaimable while PAUSED");

        // A DELISTED market still blocks reclaim (abuse takedown terminal state).
        registry.setStatus(m2, MarketRegistry.Status.DELISTED);
        vm.expectRevert(BondManager.MarketNotActive.selector);
        bondManager.withdrawBond(m2);
        emit log_string("M-4 OK: DELISTED market still blocks reclaim");
    }
}
