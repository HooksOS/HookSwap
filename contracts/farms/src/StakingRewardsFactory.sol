// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { IERC20 } from "../library/IERC20.sol";
import { SafeERC20 } from "../library/SafeERC20.sol";
import { Ownable } from "../library/Ownable.sol";
import { ReentrancyGuard } from "../library/ReentrancyGuard.sol";
import { StakingRewards } from "./StakingRewards.sol";

/**
 * @title StakingRewardsFactory
 *
 * Self-service deployer for HookSwap {StakingRewards} farms. Anyone can spin up a
 * fully-funded farm in a single transaction: the factory deploys a fresh
 * {StakingRewards}, pulls the reward budget from the creator (who pre-approves the
 * factory), funds the farm, and starts the reward stream.
 *
 * Trust model per farm:
 *   - `owner`               = the creator (`msg.sender`) — controls duration /
 *     recovery / reassigning distribution.
 *   - `rewardsDistribution` = this factory — the only caller able to run the
 *     initial {StakingRewards.notifyRewardAmount}. The owner may later take over
 *     distribution via {StakingRewards.setRewardsDistribution} for top-ups.
 *
 * Protocol fees (owner-configurable, default 0 → fully backward-compatible):
 *   - `createFee`      — a flat NATIVE fee charged per farm creation, forwarded to
 *                        `feeReceiver`.
 *   - `protocolFeeBps` — a basis-point cut of the reward-token budget, skimmed to
 *                        `feeReceiver`; the REMAINDER funds the farm. Hard-capped at
 *                        {MAX_PROTOCOL_FEE_BPS}.
 * When both fees are 0 the flow is byte-for-byte the original (no native required,
 * full `rewardAmount` funded into the farm).
 *
 * SECURITY: Not audited. See StakingRewards.sol.
 */
contract StakingRewardsFactory is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  /// @dev Basis-point denominator (100% = 10_000).
  uint256 public constant BPS_DENOMINATOR = 10_000;

  /// @dev Hard cap on `protocolFeeBps` (5%). Setter reverts above this.
  uint256 public constant MAX_PROTOCOL_FEE_BPS = 500;

  /// @dev Every farm ever created by this factory, in creation order.
  address[] private _farms;

  /// @notice Recipient of both protocol fees (native `createFee` + `protocolFeeBps`).
  address public feeReceiver;

  /// @notice Flat native fee charged per {createAndFund}. Default 0.
  uint256 public createFee;

  /// @notice Basis-point cut of the reward budget skimmed to `feeReceiver`. Default 0.
  uint256 public protocolFeeBps;

  event FarmCreated(
    address indexed farm,
    address indexed stakingToken,
    address indexed rewardToken
  );

  event FeeReceiverUpdated(address indexed newFeeReceiver);
  event CreateFeeUpdated(uint256 newCreateFee);
  event ProtocolFeeBpsUpdated(uint256 newProtocolFeeBps);

  /// @notice Emitted per farm creation with the fees actually collected.
  event ProtocolFeesCollected(
    address indexed farm,
    address indexed feeReceiver,
    uint256 nativeCreateFee,
    address rewardToken,
    uint256 protocolFeeAmount
  );

  /**
   * @param owner_       Factory admin (fee setters). Also the default `feeReceiver`
   *                     if `feeReceiver_` is zero.
   * @param feeReceiver_ Recipient of protocol fees (falls back to `owner_` if zero).
   * @param createFee_   Initial flat native fee (may be 0).
   * @param protocolFeeBps_ Initial reward-budget cut in bps (must be <= cap).
   */
  constructor(
    address owner_,
    address feeReceiver_,
    uint256 createFee_,
    uint256 protocolFeeBps_
  ) Ownable(owner_ == address(0) ? msg.sender : owner_) {
    require(protocolFeeBps_ <= MAX_PROTOCOL_FEE_BPS, "Factory: fee bps over cap");
    address fr = feeReceiver_ == address(0) ? _owner() : feeReceiver_;
    feeReceiver = fr;
    createFee = createFee_;
    protocolFeeBps = protocolFeeBps_;
    emit FeeReceiverUpdated(fr);
    emit CreateFeeUpdated(createFee_);
    emit ProtocolFeeBpsUpdated(protocolFeeBps_);
  }

  /**
   * @notice Deploy a new farm and fund it in one call.
   *
   * The caller MUST have approved this factory to spend at least `rewardAmount` of
   * `rewardToken` beforehand, and MUST send at least `createFee` native value. The
   * factory forwards `createFee` to `feeReceiver`, skims `protocolFeeBps` of the
   * reward budget to `feeReceiver`, pulls the remainder straight into the new farm,
   * sets the reward duration, and starts the stream.
   *
   * @param stakingToken ERC-20 users will stake (plain token or a v2 LP token).
   * @param rewardToken  ERC-20 paid out as rewards.
   * @param rewardAmount Total reward budget (a `protocolFeeBps` slice is skimmed;
   *                     the remainder is streamed over `duration`).
   * @param duration     Reward period length, in seconds (must be > 0).
   * @return farm        Address of the newly deployed {StakingRewards}.
   */
  function createAndFund(
    address stakingToken,
    address rewardToken,
    uint256 rewardAmount,
    uint256 duration
  ) external payable nonReentrant returns (address farm) {
    require(stakingToken != address(0), "Factory: stakingToken zero");
    require(rewardToken != address(0), "Factory: rewardToken zero");
    require(stakingToken != rewardToken, "StakingRewardsFactory: staking==reward");
    require(rewardAmount > 0, "Factory: rewardAmount zero");
    require(duration > 0, "Factory: duration zero");

    uint256 _createFee = createFee;
    require(msg.value >= _createFee, "Factory: insufficient createFee");

    // owner = creator; rewardsDistribution = this factory (so we can notify below).
    StakingRewards newFarm = new StakingRewards(
      msg.sender,
      address(this),
      rewardToken,
      stakingToken
    );
    farm = address(newFarm);

    // Split the reward budget: skim the protocol cut, fund the remainder.
    uint256 protocolFeeAmount = (rewardAmount * protocolFeeBps) / BPS_DENOMINATOR;
    uint256 fundAmount = rewardAmount - protocolFeeAmount;

    if (protocolFeeAmount > 0) {
      IERC20(rewardToken).safeTransferFrom(msg.sender, feeReceiver, protocolFeeAmount);
    }

    // Pull the fundable reward budget from the creator directly into the farm, so
    // the farm holds the funds before notifyRewardAmount's balance check runs.
    IERC20(rewardToken).safeTransferFrom(msg.sender, farm, fundAmount);

    // Configure + start the stream (factory is rewardsDistribution → authorized).
    newFarm.setRewardsDuration(duration);
    newFarm.notifyRewardAmount(fundAmount);

    // Native createFee → feeReceiver; refund any excess to the caller.
    if (_createFee > 0) {
      (bool feeOk, ) = payable(feeReceiver).call{ value: _createFee }("");
      require(feeOk, "Factory: createFee transfer failed");
    }
    uint256 excess = msg.value - _createFee;
    if (excess > 0) {
      (bool refundOk, ) = payable(msg.sender).call{ value: excess }("");
      require(refundOk, "Factory: refund failed");
    }

    _farms.push(farm);
    emit FarmCreated(farm, stakingToken, rewardToken);
    emit ProtocolFeesCollected(farm, feeReceiver, _createFee, rewardToken, protocolFeeAmount);
  }

  // ---------------------------------------------------------------------------
  // Admin (fee configuration)
  // ---------------------------------------------------------------------------

  /// @notice Set the flat native creation fee. Owner only.
  function setCreateFee(uint256 newCreateFee) external onlyOwner {
    createFee = newCreateFee;
    emit CreateFeeUpdated(newCreateFee);
  }

  /// @notice Set the reward-budget protocol cut (bps). Owner only; capped.
  function setProtocolFeeBps(uint256 newProtocolFeeBps) external onlyOwner {
    require(newProtocolFeeBps <= MAX_PROTOCOL_FEE_BPS, "Factory: fee bps over cap");
    protocolFeeBps = newProtocolFeeBps;
    emit ProtocolFeeBpsUpdated(newProtocolFeeBps);
  }

  /// @notice Set the protocol-fee recipient. Owner only; non-zero.
  function setFeeReceiver(address newFeeReceiver) external onlyOwner {
    require(newFeeReceiver != address(0), "Factory: feeReceiver zero");
    feeReceiver = newFeeReceiver;
    emit FeeReceiverUpdated(newFeeReceiver);
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  /// @notice All farms created by this factory.
  function allFarms() external view returns (address[] memory) {
    return _farms;
  }

  /// @notice Number of farms created by this factory.
  function farmsLength() external view returns (uint256) {
    return _farms.length;
  }

  /// @notice Farm at `index` in creation order.
  function farmAt(uint256 index) external view returns (address) {
    require(index < _farms.length, "Factory: index out of range");
    return _farms[index];
  }
}
