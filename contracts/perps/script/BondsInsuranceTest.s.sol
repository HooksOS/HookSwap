// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/factory/PerpMarket.sol";
import "../src/factory/PerpMarketFactory.sol";
import "../src/factory/FeeRouter.sol";
import "../src/factory/MarketRegistry.sol";
import "../src/factory/OracleGuard.sol";
import "../src/factory/ParamGuard.sol";
import "../src/factory/BondManager.sol";
import "../src/factory/InsuranceHub.sol";

interface IERC20Bal {
    function balanceOf(address) external view returns (uint256);
}

/**
 * @title BondsInsuranceTest
 * @notice Deploys the production-hardening layer (BondManager + InsuranceHub) plus a NEW
 *         FeeRouter (routes the insurance slice per-market) and a NEW factory (createMarket
 *         escrows a slashable bond), reusing the existing PerpMarket impl + MarketRegistry
 *         + OracleGuard + ParamGuard. Runs on-chain proofs for bonds + per-market insurance.
 *         Successful broadcast == every in-script require/try-catch passed against live state.
 */
contract BondsInsuranceTest is Script {
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    // Reused hardened v2 stack.
    address constant IMPL = 0xCc6605183a70a04f7b0b255A826BbA251E3A5f3e;
    address constant REGISTRY = 0xEDE278469694e951676973B7b9e193a98463DAC2;
    address constant ORACLE_GUARD = 0x3D2ee857AE129688fA43E378dAE85b60803bfFD1;
    address constant PARAM_GUARD = 0xA9bA33018a1238bf3A59f5cF6f25e7538B9A2d33;

    // Throwaway test keys (Sepolia only, no value).
    uint256 constant TRADER_A_PK = uint256(keccak256("hookswap.perps.bonds.traderA.v1"));
    uint256 constant TRADER_B_PK = uint256(keccak256("hookswap.perps.bonds.traderB.v1"));
    uint256 constant CREATOR_A_PK = uint256(keccak256("hookswap.perps.bonds.creatorA.v1"));
    uint256 constant CREATOR_B_PK = uint256(keccak256("hookswap.perps.bonds.creatorB.v1"));
    uint256 constant SLASH_SINK_PK = uint256(keccak256("hookswap.perps.bonds.slashSink.v1")); // addr only
    uint256 constant COVER_TO_PK = uint256(keccak256("hookswap.perps.bonds.coverTo.v1")); // addr only

    uint256 constant DEPOSIT = 0.003 ether;
    uint256 constant SIZE = 1e16;
    uint256 constant LEV = 10 * 1e4; // 10x
    uint256 constant FEE_RATE = 10; // per-side bps units
    uint256 constant BOND = 1e14; // 0.0001 ETH permissionless creation bond
    uint8 constant TIER = 1; // PERMISSIONLESS

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);
        address traderA = vm.addr(TRADER_A_PK);
        address traderB = vm.addr(TRADER_B_PK);
        address creatorA = vm.addr(CREATOR_A_PK);
        address creatorB = vm.addr(CREATOR_B_PK);
        address slashSink = vm.addr(SLASH_SINK_PK);
        address coverTo = vm.addr(COVER_TO_PK);
        bytes32 CHAINLINK = keccak256("chainlink");

        vm.startBroadcast(deployerPk);

        // ---- Deploy hardening contracts + a new FeeRouter (per-market insurance) ----
        InsuranceHub insuranceHub = new InsuranceHub();
        BondManager bondManager = new BondManager(slashSink /*treasury(slash sink)*/, REGISTRY);
        FeeRouter feeRouter = new FeeRouter(deployer /*platform treasury*/, address(insuranceHub));
        PerpMarketFactory factory = new PerpMarketFactory(
            IMPL,
            WETH,
            deployer, // platformMatcher
            deployer, // platformAdmin
            address(feeRouter),
            REGISTRY,
            deployer, // listing-fee treasury
            0, // listingFee
            ORACLE_GUARD,
            PARAM_GUARD,
            address(bondManager)
        );

        // ---- Wire the shared core to the new factory ----
        feeRouter.setFactory(address(factory));
        bondManager.setFactory(address(factory));
        factory.setMinBonds(5e13 /*curated*/, BOND /*permissionless*/);
        MarketRegistry(REGISTRY).setFactory(address(factory));
        OracleGuard(ORACLE_GUARD).setFactory(address(factory));
        OracleGuard(ORACLE_GUARD).setVenue(CHAINLINK, ETH_USD, true); // idempotent

        // Authorize the deployer (keeper) to call coverLoss.
        insuranceHub.setAuthorizedCoverer(deployer, true);

        OracleGuard.OracleConfig memory cfg = OracleGuard.OracleConfig({
            sourceType: CHAINLINK,
            venue: ETH_USD,
            refFeed: ETH_USD,
            maxDeviationBps: 500,
            maxStaleness: 1 days,
            minLiquidity: 0,
            dualSourceRequired: true
        });

        // ---- Create markets (each escrows a BOND in BondManager) ----
        address marketA = factory.createMarket{value: BOND}(
            WETH, 18, creatorA, FEE_RATE, LEV, keccak256("ETH-PERP-A"), TIER, cfg
        );
        address marketB = factory.createMarket{value: BOND}(
            WETH, 18, creatorB, FEE_RATE, LEV, keccak256("ETH-PERP-B"), TIER, cfg
        );
        // Withdraw-gating market: creator = deployer (in-script vm.prank proof + mined cast-send proof).
        address marketWdep = factory.createMarket{value: BOND}(
            WETH, 18, deployer, FEE_RATE, LEV, keccak256("ETH-PERP-WDEP"), TIER, cfg
        );

        // Fund traders for depositETH + gas.
        (bool s1,) = payable(traderA).call{value: 0.0033 ether}("");
        require(s1, "fund A");
        (bool s2,) = payable(traderB).call{value: 0.0033 ether}("");
        require(s2, "fund B");
        vm.stopBroadcast();

        console.log("insuranceHub", address(insuranceHub));
        console.log("bondManager", address(bondManager));
        console.log("feeRouter", address(feeRouter));
        console.log("factory", address(factory));
        console.log("marketA", marketA);
        console.log("marketB", marketB);
        console.log("marketWdep", marketWdep);
        console.log("slashSink", slashSink);
        console.log("coverTo", coverTo);
        console.log("traderA", traderA);
        console.log("traderB", traderB);

        require(marketA != marketB && marketA != marketWdep && marketB != marketWdep, "distinct markets");

        // ========================================================
        // ASSERT 1 — Bond escrowed at createMarket
        // ========================================================
        {
            (, uint256 amtA, uint64 postedA, bool slashedA, bool wdA) = bondManager.bonds(marketA);
            require(amtA == BOND, "ASSERT FAIL: bond A != BOND");
            require(postedA != 0 && !slashedA && !wdA, "ASSERT FAIL: bond A state");
            // 3 markets each escrowed BOND → BondManager holds 3*BOND.
            require(address(bondManager).balance == 3 * BOND, "ASSERT FAIL: bondManager balance");
            console.log("ASSERT 1 OK: bond escrowed, bondManager balance", address(bondManager).balance);
        }

        // ========================================================
        // ASSERT 2 — withdrawBond before delay REVERTS (in-script; prank as creator = deployer)
        // ========================================================
        vm.prank(deployer);
        try bondManager.withdrawBond(marketWdep) {
            revert("ASSERT FAIL: withdrawBond should revert before delay");
        } catch (bytes memory reason) {
            bytes4 sel = bytes4(reason);
            require(sel == BondManager.WithdrawTooEarly.selector, "ASSERT FAIL: wrong revert (expected WithdrawTooEarly)");
            console.log("ASSERT 2 OK: withdrawBond before delay reverts WithdrawTooEarly");
        }

        // ========================================================
        // Trade in marketA only (drives fees → FeeRouter)
        // ========================================================
        vm.broadcast(TRADER_A_PK);
        PerpMarket(payable(marketA)).depositETH{value: DEPOSIT}();
        vm.broadcast(TRADER_B_PK);
        PerpMarket(payable(marketA)).depositETH{value: DEPOSIT}();

        PerpMarket.MatchedPair[] memory pairs = _pair(marketA, traderA, traderB);
        vm.broadcast(deployerPk);
        PerpMarket(payable(marketA)).settleBatch(pairs);

        // Fees accrued to the router inside marketA (feeReceiver == feeRouter).
        (uint256 availA,) = PerpMarket(payable(marketA)).balances(address(feeRouter));
        (uint256 availB,) = PerpMarket(payable(marketB)).balances(address(feeRouter));
        require(availA == 2e13, "ASSERT FAIL: marketA fee accrued != 2e13");
        require(availB == 0, "ASSERT FAIL: marketB must be untouched");

        // ========================================================
        // Collect + split (insurance slice → per-market InsuranceHub sub-account)
        // ========================================================
        vm.broadcast(deployerPk);
        uint256 collected = feeRouter.collect(marketA);
        require(collected == 2e13, "ASSERT FAIL: collected != 2e13");

        // Platform + creator stay claim-based (unchanged).
        require(feeRouter.claimable(deployer, WETH) == 1e13, "ASSERT FAIL: platform 50%");
        require(feeRouter.claimable(deployer, WETH) * 10000 / collected >= 4000, "ASSERT FAIL: below 40% floor");
        require(feeRouter.claimable(creatorA, WETH) == 8e12, "ASSERT FAIL: creatorA 40%");
        require(feeRouter.claimable(creatorB, WETH) == 0, "ASSERT FAIL: creatorB earns nothing from A");

        // ========================================================
        // ASSERT 3 — Per-market insurance ISOLATION
        // ========================================================
        uint256 insA = insuranceHub.balanceOf(marketA, WETH);
        uint256 insB = insuranceHub.balanceOf(marketB, WETH);
        require(insA == 2e12, "ASSERT FAIL: insurance A != 10% slice (2e12)");
        require(insB == 0, "ASSERT FAIL: insurance B must be 0 (isolation)");
        require(IERC20Bal(WETH).balanceOf(address(insuranceHub)) == 2e12, "ASSERT FAIL: hub WETH != 2e12");
        console.log("ASSERT 3 OK: insurance A", insA, "insurance B", insB);

        // ========================================================
        // ASSERT 4 — coverLoss draws ONLY from a market's own sub-account
        // ========================================================
        // 4a: coverLoss(marketA) succeeds from A's own sub-account.
        uint256 coverAmt = 1e12;
        vm.broadcast(deployerPk);
        insuranceHub.coverLoss(marketA, WETH, coverAmt, coverTo);
        require(IERC20Bal(WETH).balanceOf(coverTo) == coverAmt, "ASSERT FAIL: coverTo did not receive");
        require(insuranceHub.balanceOf(marketA, WETH) == 2e12 - coverAmt, "ASSERT FAIL: A sub-account not debited");
        console.log("ASSERT 4a OK: coverLoss(A) paid", coverAmt, "A remaining", insuranceHub.balanceOf(marketA, WETH));

        // 4b: coverLoss(marketB) REVERTS InsufficientMarketInsurance (empty sub-account).
        vm.prank(deployer);
        try insuranceHub.coverLoss(marketB, WETH, coverAmt, coverTo) {
            revert("ASSERT FAIL: coverLoss(B) should revert");
        } catch (bytes memory reason) {
            bytes4 sel = bytes4(reason);
            require(
                sel == InsuranceHub.InsufficientMarketInsurance.selector,
                "ASSERT FAIL: wrong revert (expected InsufficientMarketInsurance)"
            );
            console.log("ASSERT 4b OK: coverLoss(B) reverts InsufficientMarketInsurance");
        }

        // ========================================================
        // ASSERT 5 — Bond slash → treasury(slash sink)
        // ========================================================
        uint256 sinkBefore = slashSink.balance;
        vm.broadcast(deployerPk);
        bondManager.slash(marketB);
        require(slashSink.balance == sinkBefore + BOND, "ASSERT FAIL: slash sink not credited");
        (, , , bool slashedB, ) = bondManager.bonds(marketB);
        require(slashedB, "ASSERT FAIL: bond B not marked slashed");
        console.log("ASSERT 5 OK: slashed marketB bond -> sink delta", slashSink.balance - sinkBefore);

        console.log("ALL IN-SCRIPT ASSERTIONS PASSED");
        console.log("marketWdep(for mined too-early cast-send)", marketWdep);
    }

    function _pair(address market, address a, address b)
        internal
        view
        returns (PerpMarket.MatchedPair[] memory pairs)
    {
        PerpMarket.Order memory longOrder = PerpMarket.Order({
            trader: a,
            token: WETH,
            isLong: true,
            size: SIZE,
            leverage: LEV,
            price: 2000e18,
            deadline: block.timestamp + 1_000_000,
            nonce: 0,
            orderType: PerpMarket.OrderType.MARKET
        });
        PerpMarket.Order memory shortOrder = PerpMarket.Order({
            trader: b,
            token: WETH,
            isLong: false,
            size: SIZE,
            leverage: LEV,
            price: 2000e18,
            deadline: block.timestamp + 1_000_000,
            nonce: 0,
            orderType: PerpMarket.OrderType.MARKET
        });
        bytes32 ld = PerpMarket(payable(market)).getOrderHash(longOrder);
        bytes32 sd = PerpMarket(payable(market)).getOrderHash(shortOrder);
        (uint8 v1, bytes32 r1, bytes32 ss1) = vm.sign(TRADER_A_PK, ld);
        (uint8 v2, bytes32 r2, bytes32 ss2) = vm.sign(TRADER_B_PK, sd);
        pairs = new PerpMarket.MatchedPair[](1);
        pairs[0] = PerpMarket.MatchedPair({
            longOrder: longOrder,
            longSignature: abi.encodePacked(r1, ss1, v1),
            shortOrder: shortOrder,
            shortSignature: abi.encodePacked(r2, ss2, v2),
            matchPrice: 2000e18,
            matchSize: SIZE
        });
    }
}
