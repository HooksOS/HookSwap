// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script, console2 } from "forge-std/Script.sol";
import { HookSwapAggregator } from "../src/HookSwapAggregator.sol";

/// @title DeployAggregator
/// @notice SEPOLIA-FIRST deploy script for HookSwapAggregator.
///
/// ⛔ MANDATORY PROJECT RULE: deploy AND test on Sepolia (11155111) FIRST,
///    before any other chain. Sepolia carries the canonical Uniswap v2+v3
///    stack, so the aggregator can be validated against real pools there.
///
/// Usage (Sepolia, dry run — NO broadcast):
///   forge script script/DeployAggregator.s.sol:DeployAggregator \
///     --rpc-url $SEPOLIA_RPC_URL
///
/// Usage (Sepolia, real deploy — owner runs, with a funded key):
///   forge script script/DeployAggregator.s.sol:DeployAggregator \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast --verify
///
/// Env vars:
///   PRIVATE_KEY   — deployer key (the OWNER runs this; Claude never broadcasts).
///   TREASURY      — optional; defaults to the HookSwap treasury constant.
///   ALLOWLIST_ROUTERS — optional comma-less; see README for the per-chain
///                       router table to allowlist post-deploy.
contract DeployAggregator is Script {
    // HookSwap treasury / fee-receiver (matches contract DEFAULT_TREASURY).
    address internal constant DEFAULT_TREASURY = 0x011d438E3eb3fce848950859591ec037C6529E13;

    function run() external returns (HookSwapAggregator agg) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        // Owner defaults to the deployer; treasury to the HookSwap treasury
        // constant unless overridden.
        address owner = vm.envOr("OWNER", deployer);
        address treasury = vm.envOr("TREASURY", DEFAULT_TREASURY);

        console2.log("Chain id      :", block.chainid);
        console2.log("Deployer      :", deployer);
        console2.log("Owner         :", owner);
        console2.log("Treasury      :", treasury);

        vm.startBroadcast(pk);
        agg = new HookSwapAggregator(owner, treasury);
        vm.stopBroadcast();

        console2.log("HookSwapAggregator deployed at:", address(agg));
        console2.log("Fee (bps)     :", agg.feeBps());
        console2.log("");
        console2.log("NEXT: allowlist the DEX routers for THIS chain via");
        console2.log("  agg.setRouterAllowed(router, true)  (owner only)");
        console2.log("See README.md for the per-chain router table.");
    }
}
