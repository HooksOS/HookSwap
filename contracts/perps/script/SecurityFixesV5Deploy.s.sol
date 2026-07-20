// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/factory/PerpMarket.sol";
import "../src/factory/PerpMarketFactory.sol";
import "../src/factory/BondManager.sol";

/**
 * @title SecurityFixesV5Deploy
 * @notice Ships the SECURITY_REVIEW.md M-3 / L-2 / L-3 (PerpMarket) + M-4 (BondManager) fixes to
 *         Sepolia as impl v5 + BondManager v2. The factory CODE is unchanged, so we keep canonical
 *         factory v4 (0xa1A8…) and merely repoint it at the new impl + new BondManager:
 *           1. deploy new PerpMarket impl (v5)                → factory.setImplementation
 *           2. deploy new BondManager (v2, M-4)               → bondV2.setFactory + factory.setBondManager
 *         Existing v4-created markets keep the v4 impl; NEW markets minted by the factory clone v5.
 *
 *         Run (needs the funded owner key that owns factory v4 + shared stack):
 *           DEPLOYER_PK=0x... forge script script/SecurityFixesV5Deploy.s.sol \
 *             --rpc-url $SEPOLIA_RPC_URL --broadcast --legacy --gas-price 2000000000 --slow \
 *             --skip-simulation --skip script/HardeningTest.s.sol
 */
contract SecurityFixesV5Deploy is Script {
    address constant FACTORY_V4 = 0xa1A8C5A2D5527abfD2E46F4FaCebC6BC00C1a79a;
    address constant REGISTRY   = 0xEDE278469694e951676973B7b9e193a98463DAC2;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        // 1. New PerpMarket implementation (v5 — M-3 partial liquidation reward, L-2 penalty routing,
        //    L-3 zero-normalized deposit guard). Guard/insurance/limit-price wiring from v4 preserved.
        PerpMarket implV5 = new PerpMarket();
        PerpMarketFactory(FACTORY_V4).setImplementation(address(implV5));

        // 2. New BondManager (v2 — M-4: a PAUSED-but-not-slashed market no longer traps the bond;
        //    only DELISTED / slashed blocks reclaim). treasury = deployer (throwaway Sepolia wiring).
        BondManager bondV2 = new BondManager(deployer, REGISTRY);
        bondV2.setFactory(FACTORY_V4);
        PerpMarketFactory(FACTORY_V4).setBondManager(address(bondV2));
        // Match the live min-bond config so createMarket cost is unchanged.
        bondV2; // (min bonds live in the factory; nothing to set on BondManager)

        vm.stopBroadcast();

        console.log("perpMarketImplementation_v5", address(implV5));
        console.log("bondManager_v2", address(bondV2));
        console.log("factory.implementation ->", PerpMarketFactory(FACTORY_V4).implementation());
        console.log("factory.bondManager    ->", PerpMarketFactory(FACTORY_V4).bondManager());
        console.log("bondV2.factory         ->", bondV2.factory());
    }
}
