// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { StakingRewardsFactory } from "../src/StakingRewardsFactory.sol";

/**
 * Deploys the HookSwap {StakingRewardsFactory} on the target chain. Individual
 * farms are NOT deployed here — they are created client-side by anyone via
 * `factory.createAndFund(...)`.
 *
 * Fee config is read from the environment with safe defaults:
 *   - FEE_RECEIVER     (address) recipient of protocol fees. Default: the broadcaster
 *                      (falls back to owner inside the constructor when zero).
 *   - CREATE_FEE       (uint, wei) flat native creation fee.        Default: 0.
 *   - PROTOCOL_FEE_BPS (uint, bps) reward-budget cut, <= 500 (5%).  Default: 0.
 * The factory owner is the broadcaster (msg.sender).
 *
 * After deploy, record the factory address in
 * `contracts/deployments/<chain>-farms.json` → "stakingRewardsFactory".
 *
 * Run:
 *   FEE_RECEIVER=0x... CREATE_FEE=0 PROTOCOL_FEE_BPS=0 \
 *   forge script script/DeployFarmsFactory.s.sol \
 *     --rpc-url <rpc> --private-key <key> --broadcast
 */
contract DeployFarmsFactory is Script {
  function run() external {
    address feeReceiver = vm.envOr("FEE_RECEIVER", address(0));
    uint256 createFee = vm.envOr("CREATE_FEE", uint256(0));
    uint256 protocolFeeBps = vm.envOr("PROTOCOL_FEE_BPS", uint256(0));

    vm.startBroadcast();
    // owner = broadcaster (address(0) → constructor uses msg.sender).
    StakingRewardsFactory factory = new StakingRewardsFactory(
      address(0),
      feeReceiver,
      createFee,
      protocolFeeBps
    );
    vm.stopBroadcast();

    // Address is in the broadcast/ receipts; kept minimal (mirrors DeployLockers).
    _log("StakingRewardsFactory", address(factory));
  }

  function _log(string memory name, address addr) internal pure {
    name;
    addr;
  }
}
