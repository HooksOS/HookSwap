// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/perpetual/Settlement.sol";
import "../src/perpetual/InsuranceFund.sol";
import "../src/common/ContractRegistry.sol";
import "../src/common/SessionKeyManager.sol";
import "../src/common/IContractRegistry.sol";

/// @dev Minimal WETH9 interface (deposit + approve) for the operator to mint
///      collateral it then credits to the two test traders via depositTo().
interface IWETH9 {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/**
 * @title SepoliaLiveSmoke
 * @notice HookSwapPerps LIVE end-to-end smoke test — a SINGLE operator key (the deployer,
 *         who is ALSO the matcher AND the feeReceiver) broadcasts the entire core perps flow
 *         in ONE transaction batch, proving on-chain that:
 *           1. the base stack deploys + wires (mirrors DeployPerps.s.sol);
 *           2. a market spec registers in ContractRegistry;
 *           3. two traders receive WETH collateral (operator funds BOTH via depositTo — no
 *              per-trader broadcast needed → clean single-operator flow);
 *           4. a matched LONG/SHORT EIP-712 order pair is signed ("HookSwapPerps","1") and
 *           5. settled via settleBatch() by the matcher (= deployer);
 *           6. a PairedPosition (pairId=1) is created AND the feeReceiver accrues
 *              perSideFee * 2 — asserted on-chain (require + console.log proof lines).
 *
 * @dev WHY a single operator key suffices (no multi-broadcast):
 *      - Collateral: Settlement.depositTo(recipient, token, amount) lets ANYONE (the operator)
 *        transferFrom its OWN WETH and credit it to `recipient`'s internal balance. So the
 *        operator wraps ETH → WETH → approve → depositTo(long) + depositTo(short). The traders
 *        NEVER need to send a tx. (depositETH()/deposit() are msg.sender-only and would each
 *        require the trader's own broadcast — depositTo sidesteps that.)
 *      - Signatures: orders are signed OFF-CHAIN with vm.sign(pk, digest) — no tx, no key on
 *        chain. The digest is read from the live contract via settlement.getOrderHash(order),
 *        so the EIP-712 domain separator (name/version/chainId/verifyingContract) is guaranteed
 *        byte-correct without re-deriving it here.
 *      - settleBatch is called by the matcher, which we set to the deployer.
 *      Net: everything is one vm.startBroadcast() as the deployer. Live-settle by a single
 *      operator IS possible for this contract.
 *
 * Dry run (NO broadcast — proves it compiles + simulates; this is what ships):
 *   forge script script/SepoliaLiveSmoke.s.sol \
 *     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
 *     --sender 0xDD680933a37b2014a77482Ae51b22B68eD1c2996
 *
 * Real broadcast (Reggie, funded key — deployer = matcher = feeReceiver):
 *   forge script script/SepoliaLiveSmoke.s.sol \
 *     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
 *     --broadcast --private-key <DEPLOYER_PK>
 */
contract SepoliaLiveSmoke is Script {
    // Sepolia canonical WETH9 (reused across the HookSwap stack — matches DeployPerps).
    address internal constant SEPOLIA_WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    // Deterministic throwaway trader keys (NOT funded, NOT used to sign any tx — they only
    // sign EIP-712 order digests off-chain; the operator funds their collateral via depositTo).
    uint256 internal constant PK_LONG = 0xA11CE;
    uint256 internal constant PK_SHORT = 0xB0B;

    // Trade economics (all ETH-denominated, 1e18 precision).
    uint256 internal constant MATCH_SIZE = 1e16; // 0.01 ETH notional per side
    uint256 internal constant LEVERAGE = 5 * 1e4; // 5x (LEVERAGE_PRECISION = 1e4)
    uint256 internal constant MATCH_PRICE = 2000e18; // arbitrary mark price (stored as entryPrice)
    uint256 internal constant FEE_RATE = 10; // 0.10% per side (feeRate/10000)

    Settlement public settlement;
    SessionKeyManager public sessionKeyManager;
    ContractRegistry public registry;
    InsuranceFund public insuranceFund;

    function run() external {
        address deployer = msg.sender; // = matcher = feeReceiver
        address weth = SEPOLIA_WETH;
        address long = vm.addr(PK_LONG);
        address short = vm.addr(PK_SHORT);

        console.log("=== HookSwapPerps LIVE smoke (Sepolia-first) ===");
        console.log("chainId :", block.chainid);
        console.log("deployer/matcher/feeReceiver:", deployer);
        console.log("WETH    :", weth);
        console.log("longTrader :", long);
        console.log("shortTrader:", short);
        if (block.chainid != 11155111) {
            console.log("!! WARNING: not Sepolia (11155111). HookSwap rule: prove on Sepolia FIRST.");
        }

        // Collateral & fee math (mirrors _processFeesAndLock).
        uint256 collateralPerSide = (MATCH_SIZE * 1e4) / LEVERAGE; // matchSize * LEVERAGE_PRECISION / leverage
        uint256 perSideFee = (MATCH_SIZE * FEE_RATE) / 10000;
        uint256 depositPerTrader = collateralPerSide + perSideFee + 1e15; // + headroom
        uint256 totalWeth = depositPerTrader * 2;
        console.log("collateralPerSide :", collateralPerSide);
        console.log("perSideFee        :", perSideFee);
        console.log("depositPerTrader  :", depositPerTrader);

        vm.startBroadcast();

        // ---------------------------------------------------------------
        // 1. Deploy + wire the base stack (identical to DeployPerps.s.sol)
        // ---------------------------------------------------------------
        registry = new ContractRegistry();
        console.log("ContractRegistry :", address(registry));

        insuranceFund = new InsuranceFund();
        console.log("InsuranceFund    :", address(insuranceFund));

        settlement = new Settlement();
        console.log("Settlement       :", address(settlement));

        sessionKeyManager = new SessionKeyManager();
        console.log("SessionKeyManager:", address(sessionKeyManager));

        settlement.setContractRegistry(address(registry));
        settlement.addSupportedToken(weth, 18);
        settlement.setWETH(weth);
        settlement.setAuthorizedMatcher(deployer, true);
        settlement.setInsuranceFund(address(insuranceFund));
        settlement.setFeeReceiver(deployer);
        settlement.setFeeRate(FEE_RATE);

        insuranceFund.setSettlement(address(settlement));
        insuranceFund.setAuthorizedContract(deployer, true);

        // ---------------------------------------------------------------
        // 2. Register the market spec (order.token = WETH here) in the registry.
        //    minOrderSize/maxOrderSize bracket MATCH_SIZE; isActive = true.
        // ---------------------------------------------------------------
        IContractRegistry.ContractSpec memory spec = IContractRegistry.ContractSpec({
            contractSize: 1, // must be != 0
            tickSize: 1,
            priceDecimals: 18,
            quantityDecimals: 0,
            minOrderSize: 1, // <= MATCH_SIZE
            maxOrderSize: 1e24, // >= MATCH_SIZE
            maxPositionSize: 1e24, // >= maxOrderSize
            maxLeverage: 100 * 1e4, // 100x cap (== MAX_LEVERAGE)
            imRate: 500,
            mmRate: 250, // in (0, 5000]
            maxPriceDeviation: 10000,
            isActive: true,
            createdAt: block.timestamp
        });
        registry.setContractSpec(weth, spec);
        console.log("market spec registered for token:", weth);

        // ---------------------------------------------------------------
        // 3. Fund BOTH traders' collateral in a single operator batch:
        //    wrap ETH -> WETH, approve Settlement, depositTo(long)/depositTo(short).
        // ---------------------------------------------------------------
        IWETH9(weth).deposit{value: totalWeth}();
        IWETH9(weth).approve(address(settlement), totalWeth);
        settlement.depositTo(long, weth, depositPerTrader);
        settlement.depositTo(short, weth, depositPerTrader);
        (uint256 longAvail,) = settlement.getUserBalance(long);
        (uint256 shortAvail,) = settlement.getUserBalance(short);
        console.log("long available (post-deposit) :", longAvail);
        console.log("short available (post-deposit):", shortAvail);

        // ---------------------------------------------------------------
        // 4. Build + EIP-712 sign the matched LONG / SHORT order pair.
        //    nonce = nonces[trader] = 0 (fresh). Digest read from the live
        //    contract so the domain separator is guaranteed correct.
        // ---------------------------------------------------------------
        uint256 deadline = block.timestamp + 1 days;

        Settlement.Order memory longOrder = Settlement.Order({
            trader: long,
            token: weth,
            isLong: true,
            size: MATCH_SIZE,
            leverage: LEVERAGE,
            price: MATCH_PRICE,
            deadline: deadline,
            nonce: 0,
            orderType: Settlement.OrderType.MARKET
        });
        Settlement.Order memory shortOrder = Settlement.Order({
            trader: short,
            token: weth,
            isLong: false,
            size: MATCH_SIZE,
            leverage: LEVERAGE,
            price: MATCH_PRICE,
            deadline: deadline,
            nonce: 0,
            orderType: Settlement.OrderType.MARKET
        });

        bytes memory longSig = _sign(PK_LONG, longOrder);
        bytes memory shortSig = _sign(PK_SHORT, shortOrder);
        require(settlement.verifyOrder(longOrder, longSig), "long sig invalid");
        require(settlement.verifyOrder(shortOrder, shortSig), "short sig invalid");
        console.log("EIP-712 order signatures verified on-chain (domain HookSwapPerps/1)");

        // ---------------------------------------------------------------
        // 5. Matcher (= deployer) settles the matched pair.
        // ---------------------------------------------------------------
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

        // ---------------------------------------------------------------
        // 6. ASSERT on-chain: PairedPosition created + fee accrued.
        // ---------------------------------------------------------------
        Settlement.PairedPosition memory pos = settlement.getPairedPosition(1);
        require(pos.pairId == 1, "pairId != 1");
        require(pos.longTrader == long, "longTrader mismatch");
        require(pos.shortTrader == short, "shortTrader mismatch");
        require(pos.token == weth, "token mismatch");
        require(pos.size == MATCH_SIZE, "size mismatch");
        require(pos.entryPrice == MATCH_PRICE, "entryPrice mismatch");
        require(pos.status == Settlement.PositionStatus.ACTIVE, "position not ACTIVE");

        uint256 feeAfter = _avail(deployer);
        uint256 feeGained = feeAfter - feeBefore;
        require(feeGained == perSideFee * 2, "fee accrual != perSideFee*2");

        (, uint256 longLocked) = settlement.getUserBalance(long);
        (, uint256 shortLocked) = settlement.getUserBalance(short);
        require(longLocked == collateralPerSide, "long collateral not locked");
        require(shortLocked == collateralPerSide, "short collateral not locked");

        vm.stopBroadcast();

        console.log("--- PROOF ---------------------------------------------");
        console.log("PairedPosition pairId    :", pos.pairId);
        console.log("  longTrader             :", pos.longTrader);
        console.log("  shortTrader            :", pos.shortTrader);
        console.log("  size                   :", pos.size);
        console.log("  entryPrice             :", pos.entryPrice);
        console.log("  longCollateral (locked):", pos.longCollateral);
        console.log("  shortCollateral(locked):", pos.shortCollateral);
        console.log("  status (0=ACTIVE)      :", uint256(pos.status));
        console.log("feeReceiver accrued      :", feeGained);
        console.log("expected (perSideFee*2)  :", perSideFee * 2);
        console.log("nextPairId               :", settlement.nextPairId());
        console.log("=== SMOKE PASSED: settleBatch created a live paired position + accrued fees ===");
    }

    /// @dev EIP-712 sign an order using the LIVE contract's getOrderHash (domain-correct).
    function _sign(uint256 pk, Settlement.Order memory order) internal view returns (bytes memory) {
        bytes32 digest = settlement.getOrderHash(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _avail(address user) internal view returns (uint256 available) {
        (available,) = settlement.getUserBalance(user);
    }
}
