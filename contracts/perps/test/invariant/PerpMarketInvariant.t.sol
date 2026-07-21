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
import "./Handler.sol";

/**
 * @title PerpMarketInvariantTest
 * @notice LOCAL (non-fork) invariant suite for the HookSwapPerps self-service factory stack —
 *         SECURITY_REVIEW.md §5 item 10 (fuzz + invariant testing). Deploys the FULL stack
 *         (factory + FeeRouter + MarketRegistry + OracleGuard + ParamGuard + BondManager +
 *         InsuranceHub) against mock collateral, mints TWO isolated market clones (A + B) that
 *         SHARE the same collateral token AND the same trader addresses, then fuzzes the entire
 *         trade lifecycle on market A via `Handler` while asserting:
 *
 *           1. COLLATERAL CONSERVATION / SOLVENCY (market A): the sum of every internal balance
 *              (available + locked, across all actors + FeeRouter + InsuranceHub) never exceeds
 *              the real ERC-20 tokens the clone holds — the market can never owe more than it has.
 *           2. CROSS-MARKET ISOLATION: market B (seeded once, then never touched by the handler)
 *              is byte-for-byte unchanged — same token balance, same per-account internal balances
 *              — no matter what happens in market A, even though A and B share actor addresses.
 *              This is the core clone-isolation property (each clone has its own `balances` storage).
 *           3. CONSERVATION LEDGER: A's token balance == ghostDeposited − ghostWithdrawn −
 *              ghostFeesCollected (every token in/out of the clone is accounted for; settlement,
 *              liquidation and funding only move value *between* internal accounts, never in/out).
 *
 *         Fee-split conservation, settlement PnL zero-sum, OracleGuard deviation, bond escrow and
 *         per-market insurance isolation are covered by the targeted `testFuzz_*` unit tests in
 *         PerpFuzz.t.sol.
 */
contract PerpMarketInvariantTest is Test {
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

    address marketA;
    address marketB;
    Handler handler;

    // Frozen snapshot of market B (isolation baseline).
    uint256 bTokenSnapshot;
    mapping(address => uint256) bBalSnapshot; // account => available+locked in B at freeze

    address[] enumerated; // every account that can ever hold internal balance in a market

    function setUp() public {
        col = new MockERC20("Collateral", "COL", 18);
        wethLike = new MockERC20("WethLike", "WETH", 18);

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

        // Two isolated CURATED clones, same collateral. refFeed==0 → matcher-trusted price path
        // (the deviation breaker is exercised with a MockAggregator in PerpFuzz.t.sol).
        marketA = factory.createMarket(address(col), 18, address(this), 10, 10 * 1e4, "A-PERP", 0, _cfgCurated());
        marketB = factory.createMarket(address(col), 18, address(this), 10, 10 * 1e4, "B-PERP", 0, _cfgCurated());

        handler = new Handler(PerpMarket(payable(marketA)), col, address(feeRouter), address(insuranceHub));

        // platformAdmin (this test) authorizes the handler as matcher on market A so it can
        // settle / update price / batch-close / fund. (Ownership was handed to platformAdmin.)
        PerpMarket(payable(marketA)).setAuthorizedMatcher(address(handler), true);

        // Enumerable set of every account that can hold an internal balance in a market.
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            enumerated.push(handler.actors(i));
        }
        enumerated.push(address(feeRouter));
        enumerated.push(address(insuranceHub));

        // ---- Seed + FREEZE market B (isolation baseline). Give the SHARED actors real B
        //      positions + balances so a leak from A into B would be detected. ----
        _seedMarketB();
        bTokenSnapshot = col.balanceOf(marketB);
        for (uint256 i = 0; i < enumerated.length; i++) {
            (uint256 a, uint256 l) = PerpMarket(payable(marketB)).balances(enumerated[i]);
            bBalSnapshot[enumerated[i]] = a + l;
        }

        // Focus the fuzzer on the handler's lifecycle actions.
        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](8);
        sel[0] = handler.deposit.selector;
        sel[1] = handler.withdraw.selector;
        sel[2] = handler.openPair.selector;
        sel[3] = handler.closeByTrader.selector;
        sel[4] = handler.closeByMatcher.selector;
        sel[5] = handler.liquidatePair.selector;
        sel[6] = handler.accrueFunding.selector;
        sel[7] = handler.collectFees.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
    }

    function _cfgCurated() internal pure returns (OracleGuard.OracleConfig memory) {
        return OracleGuard.OracleConfig({
            sourceType: CHAINLINK, venue: VENUE, refFeed: address(0),
            maxDeviationBps: 500, maxStaleness: 1 days, minLiquidity: 0, dualSourceRequired: false
        });
    }

    /// Open a real position in B between two shared actors + leave loose balances, then leave it.
    function _seedMarketB() internal {
        // authorize this test as matcher on B (owner == this)
        PerpMarket mB = PerpMarket(payable(marketB));
        mB.setAuthorizedMatcher(address(this), true);
        uint256 pkA = uint256(keccak256(abi.encode("hookswap.perps.invariant.actor", uint256(0))));
        uint256 pkB = uint256(keccak256(abi.encode("hookswap.perps.invariant.actor", uint256(1))));
        address aA = vm.addr(pkA);
        address aB = vm.addr(pkB);

        _depositB(aA, 5e18);
        _depositB(aB, 5e18);
        _depositB(handler_actor(2), 3e18); // loose balance, never in a position

        uint256 size = 1e16;
        uint256 lev = 5 * 1e4;
        PerpMarket.Order memory lo = _bOrder(aA, true, size, lev);
        PerpMarket.Order memory so = _bOrder(aB, false, size, lev);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(pkA, mB.getOrderHash(lo));
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(pkB, mB.getOrderHash(so));
        PerpMarket.MatchedPair[] memory pairs = new PerpMarket.MatchedPair[](1);
        pairs[0] = PerpMarket.MatchedPair({
            longOrder: lo, longSignature: abi.encodePacked(r1, s1, v1),
            shortOrder: so, shortSignature: abi.encodePacked(r2, s2, v2),
            matchPrice: 2000e18, matchSize: size
        });
        mB.settleBatch(pairs);
    }

    function handler_actor(uint256 i) internal pure returns (address) {
        uint256 pk = uint256(keccak256(abi.encode("hookswap.perps.invariant.actor", i)));
        return vm.addr(pk);
    }

    function _depositB(address who, uint256 amt) internal {
        col.mint(who, amt);
        vm.prank(who);
        col.approve(marketB, amt);
        vm.prank(who);
        PerpMarket(payable(marketB)).deposit(address(col), amt);
    }

    function _bOrder(address t, bool isLong, uint256 size, uint256 lev)
        internal
        view
        returns (PerpMarket.Order memory)
    {
        return PerpMarket.Order({
            trader: t, token: address(col), isLong: isLong, size: size, leverage: lev,
            price: 2000e18, deadline: block.timestamp + 1_000_000, nonce: 0, orderType: PerpMarket.OrderType.MARKET
        });
    }

    // ============================================================
    // Invariants
    // ============================================================

    function _internalSum(address market) internal view returns (uint256 s) {
        for (uint256 i = 0; i < enumerated.length; i++) {
            (uint256 a, uint256 l) = PerpMarket(payable(market)).balances(enumerated[i]);
            s += a + l;
        }
    }

    /// INV-1: market A can never owe more internally than the tokens it actually holds.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 48
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_A_solvent() public view {
        assertLe(_internalSum(marketA), col.balanceOf(marketA), "INV-1: market A internal sum exceeds token balance");
    }

    /// INV-1b: totalLockedMargin never exceeds the internal sum (locked is a subset of owed).
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 48
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_A_lockedLeSum() public view {
        assertLe(
            PerpMarket(payable(marketA)).getTotalLockedMargin(),
            _internalSum(marketA),
            "INV-1b: totalLockedMargin exceeds internal sum"
        );
    }

    /// INV-2: market B is completely untouched by anything the handler does to market A.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 48
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_B_isolated() public view {
        assertEq(col.balanceOf(marketB), bTokenSnapshot, "INV-2: market B token balance changed");
        for (uint256 i = 0; i < enumerated.length; i++) {
            (uint256 a, uint256 l) = PerpMarket(payable(marketB)).balances(enumerated[i]);
            assertEq(a + l, bBalSnapshot[enumerated[i]], "INV-2: market B account balance changed");
        }
    }

    /// INV-3: every token that entered/left the clone is accounted for by the ghost ledger.
    ///        deposits(+) − withdrawals(−) − collected fees(−) == the clone's token balance.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 48
    /// forge-config: default.invariant.fail-on-revert = false
    function invariant_A_ledgerReconciles() public view {
        uint256 expected = handler.ghostDeposited() - handler.ghostWithdrawn() - handler.ghostFeesCollected();
        assertEq(col.balanceOf(marketA), expected, "INV-3: token balance != deposits - withdrawals - fees");
    }
}
