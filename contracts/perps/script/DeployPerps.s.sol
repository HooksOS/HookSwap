// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/perpetual/Settlement.sol";
import "../src/perpetual/InsuranceFund.sol";
import "../src/common/ContractRegistry.sol";
import "../src/common/SessionKeyManager.sol";

/**
 * @title DeployPerps
 * @notice HookSwapPerps P2P deploy — Sepolia FIRST (chainId 11155111).
 *
 * @dev SHIPS THE P2P MODEL ONLY (Settlement.sol = off-chain EIP-712 matching + on-chain
 *      settlement). PerpVault.sol (the GLP/house model) is intentionally NOT deployed here —
 *      it carries 3 audit-flagged criticals (see PERPVAULT_AUDIT_REPORT.md / README.md) and
 *      must be hardened separately before any deploy.
 *
 *      MANDATORY ORDER (HookSwap rule): deploy + smoke-test on Sepolia BEFORE any production
 *      chain. Do NOT broadcast to a HookSwap production chain until the Sepolia run is green.
 *
 *      This script mirrors the HookSwap locker/seed deploy-kit pattern: env-driven, safe
 *      defaults, no hardcoded secrets. Canonical Sepolia inputs live in config/sepolia.json.
 *
 * Env vars (all optional except PRIVATE_KEY at broadcast time):
 *   PRIVATE_KEY            — deployer key (supply at runtime; NEVER commit). Reggie's funded key.
 *   WETH_ADDRESS           — ETH-denominated collateral (default: Sepolia canonical WETH9).
 *   MATCHER_ADDRESS        — off-chain matching-engine relayer, PUBLIC address (default: deployer).
 *   FEE_RECEIVER_ADDRESS   — fee sink (default: deployer).
 *   FEE_RATE               — per-side fee, feeRate/10000 (default: 10 = 0.10%).
 *
 * Dry run (NO broadcast — this is what the kit ships as; proves it compiles + simulates):
 *   forge script script/DeployPerps.s.sol --rpc-url sepolia
 *
 * Real deploy (Reggie, funded key):
 *   forge script script/DeployPerps.s.sol --rpc-url sepolia --private-key $PRIVATE_KEY --broadcast --verify
 */
contract DeployPerps is Script {
    // Sepolia canonical WETH9 (reused across the HookSwap stack).
    address internal constant SEPOLIA_WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    Settlement public settlement;
    SessionKeyManager public sessionKeyManager;
    ContractRegistry public registry;
    InsuranceFund public insuranceFund;

    function run() external {
        address deployer = msg.sender;
        address weth = vm.envOr("WETH_ADDRESS", SEPOLIA_WETH);
        address matcher = vm.envOr("MATCHER_ADDRESS", deployer);
        address feeReceiver = vm.envOr("FEE_RECEIVER_ADDRESS", deployer);
        uint256 feeRate = vm.envOr("FEE_RATE", uint256(10));

        require(weth != address(0), "WETH_ADDRESS required");

        console.log("=== HookSwapPerps deploy (Sepolia-first) ===");
        console.log("chainId :", block.chainid);
        console.log("deployer:", deployer);
        console.log("WETH    :", weth);
        console.log("matcher :", matcher);
        console.log("feeRecv :", feeReceiver);

        if (block.chainid != 11155111) {
            console.log("!! WARNING: not Sepolia. HookSwap rule: prove on Sepolia (11155111) FIRST.");
        }

        vm.startBroadcast();

        // 1. Registry (per-market contract specs: min/max order size, active flag).
        registry = new ContractRegistry();
        console.log("ContractRegistry:", address(registry));

        // 2. Insurance fund (absorbs shortfalls before ADL/socialized loss).
        insuranceFund = new InsuranceFund();
        console.log("InsuranceFund   :", address(insuranceFund));

        // 3. Settlement — EIP-712 domain ("HookSwapPerps","1"). MUST match perps-engine + frontend.
        settlement = new Settlement();
        console.log("Settlement      :", address(settlement));

        // 4. SessionKeyManager — same domain ("HookSwapPerps","1").
        sessionKeyManager = new SessionKeyManager();
        console.log("SessionKeyManager:", address(sessionKeyManager));

        // --- Wire Settlement ---
        settlement.setContractRegistry(address(registry));
        settlement.addSupportedToken(weth, 18); // ETH-denominated collateral
        settlement.setWETH(weth); // enables depositETH() auto-wrap
        settlement.setAuthorizedMatcher(matcher, true);
        settlement.setInsuranceFund(address(insuranceFund));
        settlement.setFeeReceiver(feeReceiver);
        settlement.setFeeRate(feeRate);

        // --- Wire InsuranceFund ---
        insuranceFund.setSettlement(address(settlement));
        insuranceFund.setAuthorizedContract(matcher, true);

        vm.stopBroadcast();

        console.log("=== done. Record addresses into config/sepolia.json 'deployed'. ===");
        console.log("NEXT: authorize the REAL matcher (not deployer) before live use;");
        console.log("      confirm perps-engine + frontend both sign domain ('HookSwapPerps','1').");
    }
}
