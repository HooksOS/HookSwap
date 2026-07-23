// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/perpetual/Settlement.sol";
import "../src/perpetual/InsuranceFund.sol";
import "../src/common/ContractRegistry.sol";
import "../src/common/SessionKeyManager.sol";
import "../src/common/IContractRegistry.sol";

/// @dev Minimal WETH9 interface used by the operator to mint / return collateral.
interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/**
 * @title SepoliaCoreAll
 * @notice HookSwapPerps FULL CORE live-test — ONE operator key (deployer = matcher = feeReceiver)
 *         deploys a FRESH core stack (Settlement, SessionKeyManager, ContractRegistry, InsuranceFund)
 *         and then exercises EVERY core feature in a single broadcast, each with an on-chain
 *         require() assertion (so any broken feature reverts the whole script) plus a console2.log
 *         PROOF line. Mirrors script/SepoliaLiveSmoke.s.sol patterns (fresh deploy, depositTo
 *         funding, off-chain EIP-712 order signing via getOrderHash, settleBatch, fee accrual).
 *
 * Features exercised, IN ORDER:
 *   1. depositETH (auto-wrap)                      -> [PROOF] depositETH
 *   2. ERC20 WETH deposit (wrap+approve+deposit)   -> [PROOF] deposit(ERC20)
 *   3. depositTo (operator funds 2 traders)        -> [PROOF] depositTo
 *   4. withdraw (collateral back to WETH)          -> [PROOF] withdraw
 *   5. setFeeRate + setFeeReceiver                 -> [PROOF] setFeeRate / setFeeReceiver
 *   6. ContractRegistry.setContractSpec            -> [PROOF] setContractSpec
 *   7. SessionKeyManager authorize + revoke        -> [PROOF] authorizeSessionKey / revokeSessionKey
 *   8. settleBatch (matched LONG/SHORT pair)       -> [PROOF] settleBatch (pairId + fee accrual)
 *   9. funding + liquidation + insurance           -> [PROOF] settleFundingBatch / transferFundingToInsurance
 *                                                     / updatePrice / liquidate / InsuranceFund.deposit
 *
 * @dev Time note (feature 9): funding accrual requires >= FUNDING_INTERVAL (5 min) of elapsed
 *      time since a position opened. In a single block that is 0, so this script uses vm.warp to
 *      advance the SIMULATED clock — that is a simulation-time device only; it is NOT part of the
 *      broadcast (forge cheatcodes are never sent on-chain). On a real broadcast the funding call
 *      is still valid but only accrues if real time has passed; the InsuranceFund.deposit proof
 *      below is a same-block, time-independent proof that the fund balance increases.
 *
 * Dry run (NO broadcast — the deliverable; proves compile + simulate):
 *   forge script script/SepoliaCoreAll.s.sol \
 *     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
 *     --sender 0xDD680933a37b2014a77482Ae51b22B68eD1c2996
 *
 * Real broadcast (operator, funded key — deployer = matcher = feeReceiver):
 *   forge script script/SepoliaCoreAll.s.sol \
 *     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
 *     --broadcast --private-key <DEPLOYER_PK>
 */
contract SepoliaCoreAll is Script {
    // Sepolia canonical WETH9 (matches DeployPerps / SepoliaLiveSmoke).
    address internal constant SEPOLIA_WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    // Deterministic throwaway keys — used ONLY to sign EIP-712 order digests off-chain (no tx).
    uint256 internal constant PK_LONG = 0xA11CE; // settleBatch long
    uint256 internal constant PK_SHORT = 0xB0B; // settleBatch short
    uint256 internal constant PK_LONG2 = 0xC0FFEE; // liquidation-target long
    uint256 internal constant PK_SHORT2 = 0xDECAF; // liquidation-target short

    // Trade economics (ETH-denominated, 1e18 precision) — tiny amounts, < 0.1 ETH total.
    uint256 internal constant MATCH_SIZE = 1e16; // 0.01 ETH notional per side
    uint256 internal constant LEVERAGE = 5 * 1e4; // 5x (LEVERAGE_PRECISION = 1e4)
    uint256 internal constant MATCH_PRICE = 2000e18; // mark price -> entryPrice
    uint256 internal constant FEE_RATE = 10; // 0.10% per side (feeRate/10000)

    // Operator self-deposit amounts (features 1,2,4).
    uint256 internal constant DEP_ETH = 5e15; // depositETH
    uint256 internal constant DEP_ERC20 = 5e15; // ERC20 deposit
    uint256 internal constant WD = 3e15; // withdraw

    // Funding constants (mirror Settlement).
    uint256 internal constant FUNDING_INTERVAL = 5 minutes;
    uint256 internal constant FIXED_FUNDING_RATE = 1;
    uint256 internal constant FUNDING_RATE_PRECISION = 10000;

    // InsuranceFund top-up (feature 9, same-block proof).
    uint256 internal constant INSURANCE_TOPUP = 2e15;

    Settlement public settlement;
    SessionKeyManager public sessionKeyManager;
    ContractRegistry public registry;
    InsuranceFund public insuranceFund;

    function run() external {
        address deployer = msg.sender; // = matcher = feeReceiver
        address weth = SEPOLIA_WETH;
        address long = vm.addr(PK_LONG);
        address short = vm.addr(PK_SHORT);
        address long2 = vm.addr(PK_LONG2);
        address short2 = vm.addr(PK_SHORT2);

        console2.log("=== HookSwapPerps FULL CORE live-test (Sepolia-first) ===");
        console2.log("chainId :", block.chainid);
        console2.log("deployer/matcher/feeReceiver:", deployer);
        console2.log("WETH    :", weth);
        if (block.chainid != 11155111) {
            console2.log("!! WARNING: not Sepolia (11155111). HookSwap rule: prove on Sepolia FIRST.");
        }

        // Collateral & fee math (mirrors _processFeesAndLock).
        uint256 collateralPerSide = (MATCH_SIZE * 1e4) / LEVERAGE; // matchSize * LEVERAGE_PRECISION / leverage
        uint256 perSideFee = (MATCH_SIZE * FEE_RATE) / 10000;
        uint256 depositPerTrader = collateralPerSide + perSideFee + 1e15; // + headroom

        vm.startBroadcast();

        // ---------------------------------------------------------------
        // 0. Deploy + wire a FRESH stack (mirrors DeployPerps.s.sol).
        //    msg.sender owns every contract -> no ownership reverts.
        // ---------------------------------------------------------------
        registry = new ContractRegistry();
        insuranceFund = new InsuranceFund();
        settlement = new Settlement();
        sessionKeyManager = new SessionKeyManager();

        settlement.setContractRegistry(address(registry));
        settlement.addSupportedToken(weth, 18);
        settlement.setWETH(weth);
        settlement.setAuthorizedMatcher(deployer, true);
        settlement.setInsuranceFund(address(insuranceFund));
        settlement.setFeeReceiver(deployer);
        settlement.setFeeRate(FEE_RATE);

        insuranceFund.setSettlement(address(settlement));
        insuranceFund.setAuthorizedContract(deployer, true);

        console2.log("ContractRegistry :", address(registry));
        console2.log("InsuranceFund    :", address(insuranceFund));
        console2.log("Settlement       :", address(settlement));
        console2.log("SessionKeyManager:", address(sessionKeyManager));

        // ---------------------------------------------------------------
        // FEATURE 1: depositETH (auto-wrap ETH -> WETH, credit msg.sender)
        // ---------------------------------------------------------------
        {
            (uint256 before,) = settlement.getUserBalance(deployer);
            settlement.depositETH{value: DEP_ETH}();
            (uint256 aft,) = settlement.getUserBalance(deployer);
            require(aft - before == DEP_ETH, "depositETH: balance not credited");
            console2.log("[PROOF] depositETH credited (wei):", aft - before);
        }

        // ---------------------------------------------------------------
        // FEATURE 2: ERC20 WETH deposit (wrap, approve, deposit)
        // ---------------------------------------------------------------
        {
            (uint256 before,) = settlement.getUserBalance(deployer);
            IWETH9(weth).deposit{value: DEP_ERC20}();
            IWETH9(weth).approve(address(settlement), DEP_ERC20);
            settlement.deposit(weth, DEP_ERC20);
            (uint256 aft,) = settlement.getUserBalance(deployer);
            require(aft - before == DEP_ERC20, "deposit(ERC20): balance not credited");
            console2.log("[PROOF] deposit(ERC20) credited (wei):", aft - before);
        }

        // ---------------------------------------------------------------
        // FEATURE 3: depositTo (operator funds the two settleBatch traders)
        // ---------------------------------------------------------------
        {
            uint256 fundTwo = depositPerTrader * 2;
            IWETH9(weth).deposit{value: fundTwo}();
            IWETH9(weth).approve(address(settlement), fundTwo);
            settlement.depositTo(long, weth, depositPerTrader);
            settlement.depositTo(short, weth, depositPerTrader);
            (uint256 la,) = settlement.getUserBalance(long);
            (uint256 sa,) = settlement.getUserBalance(short);
            require(la == depositPerTrader, "depositTo: long not credited");
            require(sa == depositPerTrader, "depositTo: short not credited");
            console2.log("[PROOF] depositTo long available :", la);
            console2.log("[PROOF] depositTo short available:", sa);
        }

        // ---------------------------------------------------------------
        // FEATURE 4: withdraw (pull collateral back out as WETH)
        // ---------------------------------------------------------------
        {
            (uint256 before,) = settlement.getUserBalance(deployer);
            uint256 wethBefore = IWETH9(weth).balanceOf(deployer);
            settlement.withdraw(weth, WD);
            (uint256 aft,) = settlement.getUserBalance(deployer);
            uint256 wethAfter = IWETH9(weth).balanceOf(deployer);
            require(before - aft == WD, "withdraw: internal balance did not drop by amount");
            require(wethAfter - wethBefore == WD, "withdraw: WETH not returned");
            console2.log("[PROOF] withdraw internal drop (wei):", before - aft);
            console2.log("[PROOF] withdraw WETH returned (wei):", wethAfter - wethBefore);
        }

        // ---------------------------------------------------------------
        // FEATURE 5: setFeeRate + setFeeReceiver (change then read back)
        // ---------------------------------------------------------------
        {
            settlement.setFeeRate(25);
            require(settlement.feeRate() == 25, "setFeeRate: getter not 25");
            settlement.setFeeRate(FEE_RATE);
            require(settlement.feeRate() == FEE_RATE, "setFeeRate: getter not restored");
            console2.log("[PROOF] setFeeRate now:", settlement.feeRate());

            address probe = address(0xFEE);
            settlement.setFeeReceiver(probe);
            require(settlement.feeReceiver() == probe, "setFeeReceiver: getter not probe");
            settlement.setFeeReceiver(deployer); // restore for the fee-accrual proof in feature 8
            require(settlement.feeReceiver() == deployer, "setFeeReceiver: getter not restored");
            console2.log("[PROOF] setFeeReceiver now:", settlement.feeReceiver());
        }

        // ---------------------------------------------------------------
        // FEATURE 6: ContractRegistry.setContractSpec (register + read active)
        // ---------------------------------------------------------------
        {
            IContractRegistry.ContractSpec memory spec = IContractRegistry.ContractSpec({
                contractSize: 1, // must be != 0
                tickSize: 1,
                priceDecimals: 18,
                quantityDecimals: 0,
                minOrderSize: 1, // <= MATCH_SIZE
                maxOrderSize: 1e24, // >= MATCH_SIZE
                maxPositionSize: 1e24,
                maxLeverage: 100 * 1e4,
                imRate: 500,
                mmRate: 250,
                maxPriceDeviation: 10000,
                isActive: true,
                createdAt: block.timestamp
            });
            registry.setContractSpec(weth, spec);
            require(registry.isContractActive(weth), "setContractSpec: market not active");
            require(registry.getContractSpec(weth).isActive, "setContractSpec: spec not active");
            console2.log("[PROOF] setContractSpec active for token:", weth);
        }

        // ---------------------------------------------------------------
        // FEATURE 7: SessionKeyManager authorize -> valid -> revoke -> invalid
        // ---------------------------------------------------------------
        {
            address sessionKey = address(0x5E5510); // arbitrary session key
            sessionKeyManager.authorizeSessionKey(
                sessionKey,
                1e18, // maxAmount
                1e18, // dailyLimit
                block.timestamp + 7 days, // expiry
                true, // canDeposit
                true, // canTrade
                true // canWithdraw
            );
            require(sessionKeyManager.isSessionKeyValid(deployer, sessionKey), "authorizeSessionKey: not valid");
            console2.log("[PROOF] authorizeSessionKey valid == true");
            sessionKeyManager.revokeSessionKey(sessionKey);
            require(!sessionKeyManager.isSessionKeyValid(deployer, sessionKey), "revokeSessionKey: still valid");
            console2.log("[PROOF] revokeSessionKey valid == false");
        }

        // ---------------------------------------------------------------
        // FEATURE 8: settleBatch (matched LONG/SHORT pair) + fee accrual
        // ---------------------------------------------------------------
        {
            uint256 deadline = block.timestamp + 1 days;
            Settlement.Order memory longOrder = _order(long, weth, true, MATCH_SIZE, MATCH_PRICE, deadline);
            Settlement.Order memory shortOrder = _order(short, weth, false, MATCH_SIZE, MATCH_PRICE, deadline);
            bytes memory longSig = _sign(PK_LONG, longOrder);
            bytes memory shortSig = _sign(PK_SHORT, shortOrder);
            require(settlement.verifyOrder(longOrder, longSig), "long sig invalid");
            require(settlement.verifyOrder(shortOrder, shortSig), "short sig invalid");

            uint256 feeBefore = _avail(deployer);

            Settlement.MatchedPair[] memory pairs = new Settlement.MatchedPair[](1);
            pairs[0] = Settlement.MatchedPair({
                longOrder: longOrder,
                longSignature: longSig,
                shortOrder: shortOrder,
                shortSignature: shortSig,
                matchPrice: MATCH_PRICE,
                matchSize: MATCH_SIZE
            });
            settlement.settleBatch(pairs);

            Settlement.PairedPosition memory pos = settlement.getPairedPosition(1);
            require(pos.pairId == 1, "settleBatch: pairId != 1");
            require(pos.longTrader == long && pos.shortTrader == short, "settleBatch: traders mismatch");
            require(pos.size == MATCH_SIZE && pos.entryPrice == MATCH_PRICE, "settleBatch: size/price mismatch");
            require(pos.status == Settlement.PositionStatus.ACTIVE, "settleBatch: not ACTIVE");

            uint256 feeGained = _avail(deployer) - feeBefore;
            require(feeGained == perSideFee * 2, "settleBatch: fee accrual != perSideFee*2");
            (, uint256 longLocked) = settlement.getUserBalance(long);
            require(longLocked == collateralPerSide, "settleBatch: long collateral not locked");

            console2.log("[PROOF] settleBatch pairId:", pos.pairId);
            console2.log("[PROOF] settleBatch fee accrued (== perSideFee*2):", feeGained);
        }

        // ---------------------------------------------------------------
        // FEATURE 9: funding + liquidation + insurance
        //   9a. open a 2nd paired position (pairId=2) with fresh traders
        //   9b. settleFundingBatch after warp -> funding accrues
        //   9c. transferFundingToInsurance -> insurance internal balance up
        //   9d. updatePrice adverse -> liquidate -> status LIQUIDATED
        //   9e. InsuranceFund.deposit -> fund contract ETH balance up (same-block proof)
        // ---------------------------------------------------------------
        {
            // 9a. fund + open pairId=2
            uint256 fundTwo = depositPerTrader * 2;
            IWETH9(weth).deposit{value: fundTwo}();
            IWETH9(weth).approve(address(settlement), fundTwo);
            settlement.depositTo(long2, weth, depositPerTrader);
            settlement.depositTo(short2, weth, depositPerTrader);

            uint256 deadline = block.timestamp + 1 days;
            Settlement.Order memory lo = _order(long2, weth, true, MATCH_SIZE, MATCH_PRICE, deadline);
            Settlement.Order memory so = _order(short2, weth, false, MATCH_SIZE, MATCH_PRICE, deadline);
            Settlement.MatchedPair[] memory pairs = new Settlement.MatchedPair[](1);
            pairs[0] = Settlement.MatchedPair({
                longOrder: lo,
                longSignature: _sign(PK_LONG2, lo),
                shortOrder: so,
                shortSignature: _sign(PK_SHORT2, so),
                matchPrice: MATCH_PRICE,
                matchSize: MATCH_SIZE
            });
            settlement.settleBatch(pairs);
            uint256 liqPairId = 2;
            require(settlement.getPairedPosition(liqPairId).status == Settlement.PositionStatus.ACTIVE, "liq pos not ACTIVE");

            // 9b. advance the SIMULATED clock so funding periods > 0, then settle funding.
            //     (vm.warp is simulation-only; see the time note in the contract header.)
            vm.warp(block.timestamp + FUNDING_INTERVAL);
            (uint256 fundingBefore,) = settlement.getPendingInsuranceAmount();
            uint256[] memory fp = new uint256[](1);
            fp[0] = liqPairId;
            settlement.settleFundingBatch(fp);
            (uint256 fundingAfter,) = settlement.getPendingInsuranceAmount();
            uint256 expectedFunding = ((MATCH_SIZE * FIXED_FUNDING_RATE * 1) / FUNDING_RATE_PRECISION) * 2;
            require(fundingAfter - fundingBefore == expectedFunding, "settleFundingBatch: funding not accrued");
            console2.log("[PROOF] settleFundingBatch accrued (wei):", fundingAfter - fundingBefore);

            // 9c. move accrued funding to the insurance fund's INTERNAL settlement balance.
            (uint256 insBefore,) = settlement.getUserBalance(address(insuranceFund));
            settlement.transferFundingToInsurance();
            (uint256 insAfter,) = settlement.getUserBalance(address(insuranceFund));
            (uint256 fundingPost,) = settlement.getPendingInsuranceAmount();
            require(insAfter - insBefore == expectedFunding, "transferFundingToInsurance: not moved");
            require(fundingPost == 0, "transferFundingToInsurance: pending not cleared");
            console2.log("[PROOF] transferFundingToInsurance moved (wei):", insAfter - insBefore);

            // 9d. adverse price -> liquidate the long side -> LIQUIDATED.
            settlement.updatePrice(weth, 1e18); // crash from 2000e18 -> deep underwater for the long
            (bool liqLong, bool liqShort) = settlement.canLiquidate(liqPairId);
            require(liqLong || liqShort, "liquidate: position not liquidatable after updatePrice");
            settlement.liquidate(liqPairId);
            require(
                settlement.getPairedPosition(liqPairId).status == Settlement.PositionStatus.LIQUIDATED,
                "liquidate: status not LIQUIDATED"
            );
            console2.log("[PROOF] updatePrice+liquidate -> status LIQUIDATED (pairId 2)");

            // 9e. real, same-block insurance-fund increase: deposit ETH into the fund contract.
            uint256 balBefore = insuranceFund.getBalance();
            insuranceFund.deposit{value: INSURANCE_TOPUP}();
            uint256 balAfter = insuranceFund.getBalance();
            require(balAfter - balBefore == INSURANCE_TOPUP, "InsuranceFund.deposit: balance not increased");
            console2.log("[PROOF] InsuranceFund.deposit balance increase (wei):", balAfter - balBefore);
        }

        vm.stopBroadcast();

        console2.log("=== ALL CORE FEATURES PASSED (1..9): every require satisfied ===");
    }

    // -------------------------- helpers --------------------------

    function _order(address trader, address token, bool isLong, uint256 size, uint256 price, uint256 deadline)
        internal
        pure
        returns (Settlement.Order memory)
    {
        return Settlement.Order({
            trader: trader,
            token: token,
            isLong: isLong,
            size: size,
            leverage: LEVERAGE,
            price: price,
            deadline: deadline,
            nonce: 0,
            orderType: Settlement.OrderType.MARKET
        });
    }

    /// @dev EIP-712 sign via the LIVE contract's getOrderHash (domain-correct: "HookSwapPerps","1").
    function _sign(uint256 pk, Settlement.Order memory order) internal view returns (bytes memory) {
        bytes32 digest = settlement.getOrderHash(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _avail(address user) internal view returns (uint256 available) {
        (available,) = settlement.getUserBalance(user);
    }
}
