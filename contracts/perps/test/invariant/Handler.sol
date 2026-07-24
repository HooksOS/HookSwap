// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/factory/PerpMarket.sol";
import "./Mocks.sol";

/**
 * @title Handler
 * @notice Bounded, stateful fuzz driver for the PerpMarket invariant suite. It operates on
 *         ONE market (market A) with a fixed, enumerable set of actors, exercising the full
 *         lifecycle — deposit / withdraw / open (settleBatch) / close (trader + matcher) /
 *         liquidate / funding / fee-collect — with adversarial-but-valid inputs. Every action
 *         is wrapped so a legitimate revert (insufficient balance, not liquidatable, order
 *         already used) is skipped rather than aborting the run, so the fuzzer explores deep,
 *         realistic states while the invariants are checked after each call.
 *
 *         The market is a CURATED clone whose runtime OracleGuard was DISABLED by the owner after
 *         creation (setOracleGuard(0)) → PerpMarket._guardPrice is a no-op, so the handler may drive
 *         any matcher price (mirrors the matcher-trusted production posture). MED-1 still requires a
 *         reference feed at CREATION; the deviation breaker itself is exercised separately in
 *         PerpFuzz.t.sol with a controllable MockAggregator.
 */
contract Handler is Test {
    PerpMarket public market;
    MockERC20 public col;
    address public feeRouter;
    address public insuranceHub;

    uint256 internal constant N = 4;
    uint256[N] internal pks;
    address[N] public actors;

    uint256 internal constant ENTRY = 2000e18;
    uint256 internal salt; // makes every signed order hash unique → no OrderAlreadyUsed churn

    uint256[] public openPairs; // active pair ids the handler has opened

    // ---- ghost accounting (independent cross-check of conservation) ----
    uint256 public ghostDeposited; // total tokens pulled in via deposit
    uint256 public ghostWithdrawn; // total tokens pushed out via withdraw
    uint256 public ghostFeesCollected; // total tokens pulled out by FeeRouter.collect

    constructor(PerpMarket _market, MockERC20 _col, address _feeRouter, address _insuranceHub) {
        market = _market;
        col = _col;
        feeRouter = _feeRouter;
        insuranceHub = _insuranceHub;
        for (uint256 i = 0; i < N; i++) {
            pks[i] = uint256(keccak256(abi.encode("hookswap.perps.invariant.actor", i)));
            actors[i] = vm.addr(pks[i]);
        }
    }

    function actorCount() external pure returns (uint256) {
        return N;
    }

    function openPairsLength() external view returns (uint256) {
        return openPairs.length;
    }

    // ============================================================
    // Actions
    // ============================================================

    function deposit(uint256 actorSeed, uint256 amt) public {
        address who = actors[actorSeed % N];
        amt = bound(amt, 1, 1e20);
        col.mint(who, amt);
        vm.prank(who);
        col.approve(address(market), amt);
        vm.prank(who);
        try market.deposit(address(col), amt) {
            ghostDeposited += amt;
        } catch {
            // undo the mint's effect on nothing — tokens stay in `who`, harmless
        }
    }

    function withdraw(uint256 actorSeed, uint256 amt) public {
        address who = actors[actorSeed % N];
        (uint256 avail,) = market.balances(who);
        if (avail == 0) return;
        amt = bound(amt, 1, avail);
        vm.prank(who);
        try market.withdraw(address(col), amt) {
            ghostWithdrawn += amt;
        } catch {}
    }

    function openPair(uint256 longSeed, uint256 shortSeed, uint256 sizeSeed, uint256 levSeed) public {
        uint256 li = longSeed % N;
        uint256 si = shortSeed % N;
        if (li == si) si = (si + 1) % N;
        address longT = actors[li];
        address shortT = actors[si];

        uint256 size = bound(sizeSeed, 1e14, 1e16);
        uint256 lev = bound(levSeed, 1e4, 10 * 1e4); // 1x..10x (market cap is 10x)

        // Solvency-preserving gate: both sides must be able to fund collateral + fee, else skip.
        uint256 collat = (size * 1e4) / lev;
        uint256 fee = (size * market.feeRate()) / 10000;
        (uint256 la,) = market.balances(longT);
        (uint256 sa,) = market.balances(shortT);
        if (la < collat + fee || sa < collat + fee) return;

        uint256 s = ++salt;
        PerpMarket.Order memory lo = _order(longT, true, size, lev, ENTRY + s);
        PerpMarket.Order memory so = _order(shortT, false, size, lev, ENTRY + s);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(pks[li], market.getOrderHash(lo));
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(pks[si], market.getOrderHash(so));

        PerpMarket.MatchedPair[] memory pairs = new PerpMarket.MatchedPair[](1);
        pairs[0] = PerpMarket.MatchedPair({
            longOrder: lo, longSignature: abi.encodePacked(r1, s1, v1),
            shortOrder: so, shortSignature: abi.encodePacked(r2, s2, v2),
            matchPrice: ENTRY, matchSize: size
        });

        uint256 pid = market.nextPairId();
        try market.settleBatch(pairs) {
            openPairs.push(pid);
        } catch {}
    }

    function closeByTrader(uint256 pairSeed, uint256 priceSeed) public {
        if (openPairs.length == 0) return;
        uint256 idx = pairSeed % openPairs.length;
        uint256 pid = openPairs[idx];
        PerpMarket.PairedPosition memory pos = market.getPairedPosition(pid);
        if (uint256(pos.status) != uint256(PerpMarket.PositionStatus.ACTIVE)) {
            _removePair(idx);
            return;
        }
        uint256 price = bound(priceSeed, 1000e18, 4000e18);
        // The user-callable closePair uses the last on-chain mark → set it first (matcher role).
        try market.updatePrice(address(col), price) {} catch {}
        vm.prank(pos.longTrader);
        try market.closePair(pid) {
            _removePair(idx);
        } catch {}
    }

    function closeByMatcher(uint256 pairSeed, uint256 priceSeed) public {
        if (openPairs.length == 0) return;
        uint256 idx = pairSeed % openPairs.length;
        uint256 pid = openPairs[idx];
        PerpMarket.PairedPosition memory pos = market.getPairedPosition(pid);
        if (uint256(pos.status) != uint256(PerpMarket.PositionStatus.ACTIVE)) {
            _removePair(idx);
            return;
        }
        uint256 price = bound(priceSeed, 1000e18, 4000e18);
        uint256[] memory ids = new uint256[](1);
        uint256[] memory px = new uint256[](1);
        ids[0] = pid;
        px[0] = price;
        try market.closePairsBatch(ids, px) {
            _removePair(idx);
        } catch {}
    }

    function liquidatePair(uint256 pairSeed, uint256 priceSeed, uint256 liqSeed) public {
        if (openPairs.length == 0) return;
        uint256 idx = pairSeed % openPairs.length;
        uint256 pid = openPairs[idx];
        PerpMarket.PairedPosition memory pos = market.getPairedPosition(pid);
        if (uint256(pos.status) != uint256(PerpMarket.PositionStatus.ACTIVE)) {
            _removePair(idx);
            return;
        }
        // Drive the mark far enough to make one side liquidatable.
        uint256 price = bound(priceSeed, 500e18, 6000e18);
        try market.updatePrice(address(col), price) {} catch {}
        (bool ll, bool ls) = market.canLiquidate(pid);
        if (!ll && !ls) return;
        address liq = actors[liqSeed % N];
        vm.prank(liq);
        try market.liquidate(pid) {
            _removePair(idx);
        } catch {}
    }

    function accrueFunding(uint256 pairSeed, uint256 dt) public {
        if (openPairs.length == 0) return;
        dt = bound(dt, 0, 3 days);
        vm.warp(block.timestamp + dt);
        uint256 idx = pairSeed % openPairs.length;
        uint256[] memory ids = new uint256[](1);
        ids[0] = openPairs[idx];
        try market.settleFundingBatch(ids) {} catch {}
    }

    function collectFees() public {
        // Pull the router's accrued fees out of the market (reduces the market's internal
        // feeReceiver balance AND its token holdings by the same amount → stays solvent),
        // and splits them platform/creator/insurance. Exercises the fee path inside the run.
        uint256 marketBalBefore = col.balanceOf(address(market));
        try IFeeRouterCollect(feeRouter).collect(address(market)) {
            uint256 after_ = col.balanceOf(address(market));
            if (marketBalBefore > after_) ghostFeesCollected += (marketBalBefore - after_);
        } catch {}
    }

    // ============================================================
    // Helpers
    // ============================================================

    function _order(address trader, bool isLong, uint256 size, uint256 lev, uint256 price)
        internal
        view
        returns (PerpMarket.Order memory)
    {
        return PerpMarket.Order({
            trader: trader,
            token: address(col),
            isLong: isLong,
            size: size,
            leverage: lev,
            price: price,
            deadline: block.timestamp + 1_000_000,
            nonce: 0,
            orderType: PerpMarket.OrderType.MARKET
        });
    }

    function _removePair(uint256 idx) internal {
        uint256 last = openPairs.length - 1;
        if (idx != last) openPairs[idx] = openPairs[last];
        openPairs.pop();
    }
}

interface IFeeRouterCollect {
    function collect(address market) external returns (uint256);
}
