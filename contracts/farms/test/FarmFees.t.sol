// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { StakingRewardsFactory } from "../src/StakingRewardsFactory.sol";
import { StakingRewards } from "../src/StakingRewards.sol";
import { IERC20 } from "../library/IERC20.sol";

/// @dev Minimal standard ERC-20 for tests (returns bool, full name/symbol/decimals).
contract MockERC20 is IERC20 {
  string public name = "Mock";
  string public symbol = "MOCK";
  uint8 public decimals = 18;
  uint256 public totalSupply;
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  function mint(address to, uint256 amount) external {
    totalSupply += amount;
    balanceOf[to] += amount;
    emit Transfer(address(0), to, amount);
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
    return true;
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    _transfer(msg.sender, to, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    uint256 a = allowance[from][msg.sender];
    require(a >= amount, "MockERC20: allowance");
    if (a != type(uint256).max) {
      allowance[from][msg.sender] = a - amount;
    }
    _transfer(from, to, amount);
    return true;
  }

  function _transfer(address from, address to, uint256 amount) internal {
    require(balanceOf[from] >= amount, "MockERC20: balance");
    balanceOf[from] -= amount;
    balanceOf[to] += amount;
    emit Transfer(from, to, amount);
  }
}

contract FarmFeesTest is Test {
  StakingRewardsFactory factory;
  MockERC20 stakeTok;
  MockERC20 rewardTok;

  address owner = address(0xA11CE);
  address feeReceiver = address(0xFEE);
  address creator = address(0xC0FFEE);

  uint256 constant REWARD = 1_000e18;
  uint256 constant DURATION = 7 days;
  uint256 constant BPS = 10_000;

  function setUp() public {
    stakeTok = new MockERC20();
    rewardTok = new MockERC20();
    rewardTok.mint(creator, 1_000_000e18);
    vm.deal(creator, 100 ether);
  }

  function _deploy(uint256 createFee, uint256 protocolFeeBps) internal {
    vm.prank(owner);
    factory = new StakingRewardsFactory(owner, feeReceiver, createFee, protocolFeeBps);
  }

  function _create(uint256 nativeValue) internal returns (address farm) {
    vm.startPrank(creator);
    rewardTok.approve(address(factory), REWARD);
    farm = factory.createAndFund{ value: nativeValue }(
      address(stakeTok),
      address(rewardTok),
      REWARD,
      DURATION
    );
    vm.stopPrank();
  }

  // (a) createFee: reverts under, succeeds paying feeReceiver at >=.
  function test_createFee_revertsWhenUnderpaid() public {
    _deploy(0.01 ether, 0);
    vm.startPrank(creator);
    rewardTok.approve(address(factory), REWARD);
    vm.expectRevert("Factory: insufficient createFee");
    factory.createAndFund{ value: 0.009 ether }(
      address(stakeTok),
      address(rewardTok),
      REWARD,
      DURATION
    );
    vm.stopPrank();
  }

  function test_createFee_paidToFeeReceiver() public {
    _deploy(0.01 ether, 0);
    uint256 frBefore = feeReceiver.balance;
    uint256 creatorBefore = creator.balance;
    _create(0.01 ether);
    assertEq(feeReceiver.balance - frBefore, 0.01 ether, "feeReceiver got createFee");
    assertEq(creatorBefore - creator.balance, 0.01 ether, "creator paid exactly createFee");
  }

  function test_createFee_excessRefunded() public {
    _deploy(0.01 ether, 0);
    uint256 frBefore = feeReceiver.balance;
    uint256 creatorBefore = creator.balance;
    _create(0.05 ether); // overpay by 0.04
    assertEq(feeReceiver.balance - frBefore, 0.01 ether, "feeReceiver got only createFee");
    assertEq(creatorBefore - creator.balance, 0.01 ether, "excess refunded to creator");
  }

  // (b) protocolFeeBps slice → feeReceiver; farm funded with remainder.
  function test_protocolFeeBps_split() public {
    uint256 bps = 300; // 3%
    _deploy(0, bps);
    uint256 frBefore = rewardTok.balanceOf(feeReceiver);
    address farm = _create(0);

    uint256 expectedFee = (REWARD * bps) / BPS;
    uint256 expectedFund = REWARD - expectedFee;

    assertEq(rewardTok.balanceOf(feeReceiver) - frBefore, expectedFee, "fee slice to feeReceiver");
    assertEq(rewardTok.balanceOf(farm), expectedFund, "farm funded with remainder");

    // Reward stream sized off the funded remainder, not the gross amount.
    assertEq(StakingRewards(farm).getRewardForDuration(), (expectedFund / DURATION) * DURATION, "stream on remainder");
  }

  // (c) both-zero → no fees, full backward-compatible behavior.
  function test_bothZero_backwardCompatible() public {
    _deploy(0, 0);
    uint256 frNativeBefore = feeReceiver.balance;
    uint256 frRewardBefore = rewardTok.balanceOf(feeReceiver);
    address farm = _create(0);

    assertEq(feeReceiver.balance, frNativeBefore, "no native fee taken");
    assertEq(rewardTok.balanceOf(feeReceiver), frRewardBefore, "no reward fee taken");
    assertEq(rewardTok.balanceOf(farm), REWARD, "farm gets full reward");
  }

  // (d) setters are onlyOwner + bps cap enforced.
  function test_setters_onlyOwner() public {
    _deploy(0, 0);

    vm.prank(creator);
    vm.expectRevert("Only the owner can execute this function");
    factory.setCreateFee(1 ether);

    vm.prank(creator);
    vm.expectRevert("Only the owner can execute this function");
    factory.setProtocolFeeBps(100);

    vm.prank(creator);
    vm.expectRevert("Only the owner can execute this function");
    factory.setFeeReceiver(address(0x1234));

    // Owner succeeds.
    vm.startPrank(owner);
    factory.setCreateFee(1 ether);
    factory.setProtocolFeeBps(100);
    factory.setFeeReceiver(address(0x1234));
    vm.stopPrank();

    assertEq(factory.createFee(), 1 ether);
    assertEq(factory.protocolFeeBps(), 100);
    assertEq(factory.feeReceiver(), address(0x1234));
  }

  function test_setProtocolFeeBps_capEnforced() public {
    _deploy(0, 0);
    vm.prank(owner);
    vm.expectRevert("Factory: fee bps over cap");
    factory.setProtocolFeeBps(501); // cap is 500

    // Exactly at cap is allowed.
    vm.prank(owner);
    factory.setProtocolFeeBps(500);
    assertEq(factory.protocolFeeBps(), 500);
  }

  function test_constructor_capEnforced() public {
    vm.expectRevert("Factory: fee bps over cap");
    new StakingRewardsFactory(owner, feeReceiver, 0, 501);
  }

  function test_setFeeReceiver_nonZero() public {
    _deploy(0, 0);
    vm.prank(owner);
    vm.expectRevert("Factory: feeReceiver zero");
    factory.setFeeReceiver(address(0));
  }

  function test_feeReceiver_defaultsToOwner() public {
    vm.prank(owner);
    StakingRewardsFactory f = new StakingRewardsFactory(owner, address(0), 0, 0);
    assertEq(f.feeReceiver(), owner, "feeReceiver defaults to owner when zero");
  }
}
