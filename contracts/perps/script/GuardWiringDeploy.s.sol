// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/factory/PerpMarket.sol";
import "../src/factory/PerpMarketFactory.sol";
import "../src/factory/FeeRouter.sol";
import "../src/factory/MarketRegistry.sol";
import "../src/factory/OracleGuard.sol";
import "../src/factory/BondManager.sol";

/**
 * @title GuardWiringDeploy
 * @notice Redeploys the HookSwapPerps self-service factory to FACTORY v4 — a new PerpMarket
 *         implementation (v4, with SECURITY_REVIEW.md H-1/H-2/M-1 wired into the settle path)
 *         plus a new PerpMarketFactory (v4) that calls `setOracleGuard` + `setInsuranceFund`
 *         on every market it creates, before transferring ownership.
 *
 *         Reuses the EXISTING shared Sepolia stack (FeeRouter v2 / MarketRegistry / OracleGuard /
 *         ParamGuard / BondManager / InsuranceHub) and only repoints their `setFactory` → v4.
 *         The InsuranceHub authorizes each market to cover its OWN sub-account by construction
 *         (msg.sender == market in coverLoss), so no per-market setAuthorizedCoverer is needed.
 *
 *         Run (needs the funded platform-owner key that owns the shared contracts):
 *           DEPLOYER_PK=0x... forge script script/GuardWiringDeploy.s.sol \
 *             --rpc-url $SEPOLIA_RPC_URL --broadcast --legacy --gas-price 2000000000 --slow
 */
contract GuardWiringDeploy is Script {
    // ---- existing Sepolia shared stack (config/factory-sepolia.json) ----
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant FEE_ROUTER_V2 = 0xfA91D73B30b719491109Ae1C3993620c813393A4;
    address constant REGISTRY = 0xEDE278469694e951676973B7b9e193a98463DAC2;
    address constant ORACLE_GUARD = 0x3D2ee857AE129688fA43E378dAE85b60803bfFD1;
    address constant PARAM_GUARD = 0xA9bA33018a1238bf3A59f5cF6f25e7538B9A2d33;
    address constant BOND_MANAGER = 0x9146Eb0bcB3CF09bd7924787415595a182F07eE8;

    // Match the v3 min-bond config (config/factory-sepolia.json).
    uint256 constant CURATED_MIN_BOND = 5e13;
    uint256 constant PERMISSIONLESS_MIN_BOND = 1e14;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        // 1. New PerpMarket implementation (v4 — guards wired into settle path).
        PerpMarket implV4 = new PerpMarket();

        // 2. New factory (v4) — createMarket now also wires setOracleGuard + setInsuranceFund.
        //    Constructor signature is UNCHANGED; createMarket signature is UNCHANGED.
        PerpMarketFactory factoryV4 = new PerpMarketFactory(
            address(implV4),
            WETH,
            deployer, // platformMatcher (throwaway Sepolia wiring)
            deployer, // platformAdmin
            FEE_ROUTER_V2,
            REGISTRY,
            deployer, // listing-fee treasury
            0, // listingFee
            ORACLE_GUARD,
            PARAM_GUARD,
            BOND_MANAGER
        );
        factoryV4.setMinBonds(CURATED_MIN_BOND, PERMISSIONLESS_MIN_BOND);

        // 3. Repoint the shared stack's factory hooks → factory v4.
        FeeRouter(FEE_ROUTER_V2).setFactory(address(factoryV4));
        MarketRegistry(REGISTRY).setFactory(address(factoryV4));
        OracleGuard(ORACLE_GUARD).setFactory(address(factoryV4));
        BondManager(BOND_MANAGER).setFactory(address(factoryV4));

        vm.stopBroadcast();

        console.log("perpMarketImplementation_v4", address(implV4));
        console.log("perpMarketFactory_v4", address(factoryV4));
        console.log("feeRouter.factory ->", FeeRouter(FEE_ROUTER_V2).factory());
        console.log("registry.factory   ->", MarketRegistry(REGISTRY).factory());
        console.log("oracleGuard.factory->", OracleGuard(ORACLE_GUARD).factory());
        console.log("bondManager.factory->", BondManager(BOND_MANAGER).factory());
    }
}
