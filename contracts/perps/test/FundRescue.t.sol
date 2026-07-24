// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/factory/BondManager.sol";
import "../src/factory/InsuranceHub.sol";
import "../src/factory/FeeRouter.sol";
import "../src/factory/MarketRegistry.sol";

/// @dev Mintable ERC20 for the insurance/fee-router rescue tests.
contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// @dev A contract that rejects any native ETH sent to it (no receive/fallback) — used to prove
///      slash() cannot be bricked by a hostile treasury and falls back to pull-based escrow.
contract RejectETH {
    // no receive() / fallback() → any .call{value:} returns ok=false
    function pull(BondManager bm, address to) external returns (uint256) {
        return bm.claimSlashed(to);
    }
}

/// @dev Minimal PerpMarket stand-in implementing the surface FeeRouter.collect() needs
///      (balances + withdraw). Lets the fee-router credit real `claimable` liabilities so the
///      totalClaimable counter and the stranded-bound on rescueToken can be exercised end-to-end.
contract MockMarket {
    mapping(address => uint256) public avail; // account => withdrawable "fees"

    function setAvailable(address who, uint256 amt) external {
        avail[who] = amt;
    }

    function balances(address account) external view returns (uint256, uint256) {
        return (avail[account], 0);
    }

    function withdraw(address token, uint256 amount) external {
        avail[msg.sender] -= amount;
        IERC20(token).transfer(msg.sender, amount);
    }
}

/**
 * @title FundRescueTest
 * @notice Pure-local (NO fork) regression tests for the owner-guarded fund-rescue paths added to
 *         BondManager / InsuranceHub / FeeRouter so no funds can ever be permanently stuck.
 *         Covers each new function's happy path, the trap scenario it fixes, overdraw/underflow
 *         guards, and non-owner rejection.
 *
 *         Run: forge test --match-path test/FundRescue.t.sol -vv   (no RPC needed)
 */
contract FundRescueTest is Test {
    BondManager bond;
    InsuranceHub hub;
    FeeRouter router;
    MarketRegistry registry;
    MockToken token;

    address treasury = makeAddr("treasury");
    address attacker = makeAddr("attacker");
    address recipient = makeAddr("recipient");
    address market = makeAddr("market");
    address marketB = makeAddr("marketB");
    address creator = makeAddr("creator");

    receive() external payable {} // this test contract is owner + a bond-return destination

    function setUp() public {
        registry = new MarketRegistry();
        bond = new BondManager(treasury, address(registry));
        bond.setFactory(address(this)); // let the test post bonds directly

        hub = new InsuranceHub();
        router = new FeeRouter(treasury, address(hub));
        token = new MockToken();
    }

    // ============================================================
    // BondManager.returnBond
    // ============================================================

    function _post(address m, uint256 amt) internal {
        vm.deal(address(this), amt);
        bond.postBond{value: amt}(m, creator);
    }

    /// Happy path + trap fix: a live bond (even one whose market is DELISTED, the freeze scenario)
    /// is released to a chosen destination and closed.
    function test_returnBond_releasesLiveBond() public {
        uint256 amt = 1 ether;
        _post(market, amt);
        assertEq(address(bond).balance, amt);

        uint256 before = recipient.balance;
        bond.returnBond(market, recipient);

        assertEq(recipient.balance - before, amt, "recipient did not receive bond");
        assertEq(address(bond).balance, 0, "manager retained ETH");
        BondManager.Bond memory b = bond.bondOf(market);
        assertTrue(b.withdrawn, "bond not closed");
    }

    /// After a returnBond the creator can no longer withdraw (no double-release).
    function test_returnBond_thenWithdrawReverts() public {
        _post(market, 1 ether);
        bond.returnBond(market, recipient);
        vm.warp(block.timestamp + 8 days);
        vm.prank(creator);
        vm.expectRevert(BondManager.BondClosed.selector);
        bond.withdrawBond(market);
    }

    function test_returnBond_revertsWhenSlashed() public {
        _post(market, 1 ether);
        bond.slash(market); // treasury (EOA-style) accepts here → pushed
        vm.expectRevert(BondManager.BondAlreadySlashed.selector);
        bond.returnBond(market, recipient);
    }

    function test_returnBond_revertsNoBond() public {
        vm.expectRevert(BondManager.NoBond.selector);
        bond.returnBond(market, recipient);
    }

    function test_returnBond_revertsZeroTo() public {
        _post(market, 1 ether);
        vm.expectRevert(BondManager.ZeroAddress.selector);
        bond.returnBond(market, address(0));
    }

    function test_returnBond_revertsNonOwner() public {
        _post(market, 1 ether);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        bond.returnBond(market, recipient);
    }

    // ============================================================
    // BondManager.rescueETH
    // ============================================================

    function test_rescueETH_sweepsStrandedETH() public {
        // Simulate stranded ETH with no matching bond accounting.
        vm.deal(address(bond), 3 ether);
        uint256 before = recipient.balance;
        bond.rescueETH(recipient, 2 ether);
        assertEq(recipient.balance - before, 2 ether);
        assertEq(address(bond).balance, 1 ether);
    }

    function test_rescueETH_revertsOverdraw() public {
        vm.deal(address(bond), 1 ether);
        vm.expectRevert(BondManager.InsufficientBalance.selector);
        bond.rescueETH(recipient, 2 ether);
    }

    function test_rescueETH_revertsNonOwner() public {
        vm.deal(address(bond), 1 ether);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        bond.rescueETH(recipient, 1 ether);
    }

    // ============================================================
    // BondManager.slash — pull-based fallback when treasury rejects ETH
    // ============================================================

    /// A hostile treasury that rejects ETH must NOT be able to brick slash(); the amount is
    /// escrowed to slashedClaimable and later pullable, so the funds are never trapped.
    function test_slash_rejectingTreasuryEscrowsThenClaim() public {
        RejectETH rej = new RejectETH();
        bond.setTreasury(address(rej));

        _post(market, 1 ether);
        bond.slash(market); // must NOT revert despite rej rejecting the push
        assertEq(bond.slashedClaimable(address(rej)), 1 ether, "not escrowed");
        assertEq(address(bond).balance, 1 ether, "manager should still hold escrowed ETH");

        BondManager.Bond memory b = bond.bondOf(market);
        assertTrue(b.slashed, "bond not marked slashed");

        // The credited beneficiary pulls to a good destination.
        uint256 before = recipient.balance;
        uint256 got = rej.pull(bond, recipient);
        assertEq(got, 1 ether);
        assertEq(recipient.balance - before, 1 ether, "claim did not deliver");
        assertEq(bond.slashedClaimable(address(rej)), 0, "claimable not zeroed");
    }

    /// Normal treasury (accepts ETH) keeps the direct-push behaviour (no escrow).
    function test_slash_normalTreasuryPushes() public {
        _post(market, 1 ether);
        uint256 before = treasury.balance;
        bond.slash(market);
        assertEq(treasury.balance - before, 1 ether, "treasury not paid");
        assertEq(bond.slashedClaimable(treasury), 0, "should not escrow on happy path");
    }

    function test_claimSlashed_revertsNothingToClaim() public {
        vm.prank(treasury);
        vm.expectRevert(BondManager.NothingToClaim.selector);
        bond.claimSlashed(recipient);
    }

    // ============================================================
    // InsuranceHub.ownerSweep
    // ============================================================

    function _fundSubAccount(address m, uint256 amt) internal {
        token.mint(address(this), amt);
        token.approve(address(hub), amt);
        hub.notifyFee(m, address(token), amt);
    }

    /// Happy path + trap fix: a dead market's sub-account is recoverable in ONE call, without the
    /// setAuthorizedCoverer(self)+coverLoss dance.
    function test_ownerSweep_recoversSubAccount() public {
        _fundSubAccount(market, 1_000e18);
        assertEq(hub.balanceOf(market, address(token)), 1_000e18);

        uint256 before = token.balanceOf(recipient);
        hub.ownerSweep(market, address(token), 400e18, recipient);

        assertEq(token.balanceOf(recipient) - before, 400e18, "recipient not paid");
        assertEq(hub.balanceOf(market, address(token)), 600e18, "sub-account not decremented");
    }

    /// Isolation invariant: sweeping market A never touches market B's sub-account.
    function test_ownerSweep_isolationPreserved() public {
        _fundSubAccount(market, 1_000e18);
        _fundSubAccount(marketB, 500e18);

        hub.ownerSweep(market, address(token), 1_000e18, recipient);
        assertEq(hub.balanceOf(market, address(token)), 0, "A not drained");
        assertEq(hub.balanceOf(marketB, address(token)), 500e18, "B was touched");
    }

    function test_ownerSweep_revertsOverdraw() public {
        _fundSubAccount(market, 100e18);
        vm.expectRevert(InsuranceHub.InsufficientMarketInsurance.selector);
        hub.ownerSweep(market, address(token), 101e18, recipient);
    }

    function test_ownerSweep_revertsZeroAmount() public {
        _fundSubAccount(market, 100e18);
        vm.expectRevert(InsuranceHub.ZeroAmount.selector);
        hub.ownerSweep(market, address(token), 0, recipient);
    }

    function test_ownerSweep_revertsZeroTo() public {
        _fundSubAccount(market, 100e18);
        vm.expectRevert(InsuranceHub.ZeroAddress.selector);
        hub.ownerSweep(market, address(token), 1e18, address(0));
    }

    function test_ownerSweep_revertsNonOwner() public {
        _fundSubAccount(market, 100e18);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        hub.ownerSweep(market, address(token), 1e18, recipient);
    }

    // ============================================================
    // FeeRouter.rescueToken
    // ============================================================

    /// Happy path + trap fix: tokens sitting in the router (directly-sent or a dead creator's
    /// unclaimable slice) are recoverable, bounded by the actual balance.
    function test_rescueToken_sweepsOrphanedBalance() public {
        token.mint(address(router), 1_000e18);
        uint256 before = token.balanceOf(recipient);
        router.rescueToken(address(token), recipient, 700e18);
        assertEq(token.balanceOf(recipient) - before, 700e18, "not swept");
        assertEq(token.balanceOf(address(router)), 300e18, "router balance wrong");
    }

    function test_rescueToken_revertsOverdraw() public {
        token.mint(address(router), 100e18);
        vm.expectRevert(FeeRouter.InsufficientBalance.selector);
        router.rescueToken(address(token), recipient, 101e18);
    }

    function test_rescueToken_revertsZeroAddress() public {
        token.mint(address(router), 100e18);
        vm.expectRevert(FeeRouter.ZeroAddress.selector);
        router.rescueToken(address(token), address(0), 1e18);
    }

    function test_rescueToken_revertsNonOwner() public {
        token.mint(address(router), 100e18);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        router.rescueToken(address(token), recipient, 1e18);
    }

    // ============================================================
    // MED regression: rescue bounded to TRULY-STRANDED surplus
    // (raw balance minus tracked liabilities) — BondManager
    // ============================================================

    /// A live bond is a liability, NOT stranded → rescueETH cannot touch it even to the last wei.
    function test_rescueETH_cannotSweepLiveBond() public {
        _post(market, 1 ether);
        assertEq(bond.totalBondsHeld(), 1 ether, "counter not tracking live bond");
        assertEq(address(bond).balance, 1 ether);
        // stranded = 1 - 1 - 0 = 0 → any positive amount reverts.
        vm.expectRevert(BondManager.InsufficientBalance.selector);
        bond.rescueETH(recipient, 1);
    }

    /// Only the surplus ABOVE the live bond is rescuable; the bond amount stays locked.
    function test_rescueETH_sweepsOnlySurplusOverBond() public {
        _post(market, 1 ether); // 1 ETH liability
        vm.deal(address(bond), 1.5 ether); // +0.5 ETH force-sent stranded
        // stranded = 1.5 - 1 - 0 = 0.5
        vm.expectRevert(BondManager.InsufficientBalance.selector);
        bond.rescueETH(recipient, 0.5 ether + 1);

        uint256 before = recipient.balance;
        bond.rescueETH(recipient, 0.5 ether); // exactly the surplus
        assertEq(recipient.balance - before, 0.5 ether, "surplus not swept");
        assertEq(address(bond).balance, 1 ether, "live bond not preserved");
        assertEq(bond.totalBondsHeld(), 1 ether, "bond counter changed by rescue");
    }

    /// An escrowed slash (push to a rejecting treasury) is a liability → rescueETH cannot take it.
    function test_rescueETH_cannotSweepEscrowedSlash() public {
        RejectETH rej = new RejectETH();
        bond.setTreasury(address(rej));
        _post(market, 1 ether);
        bond.slash(market); // push fails → escrowed
        assertEq(bond.totalBondsHeld(), 0, "bond should have left live escrow");
        assertEq(bond.totalSlashedEscrow(), 1 ether, "escrow counter not tracking");
        assertEq(address(bond).balance, 1 ether, "escrowed ETH not retained");
        // stranded = 1 - 0 - 1 = 0
        vm.expectRevert(BondManager.InsufficientBalance.selector);
        bond.rescueETH(recipient, 1);
    }

    /// Full lifecycle: postBond -> slash (escrow) -> claimSlashed keeps both counters exact,
    /// and once the escrow is claimed the residual balance becomes rescuable again.
    function test_bondCounters_postSlashClaim() public {
        RejectETH rej = new RejectETH();
        bond.setTreasury(address(rej));

        _post(market, 1 ether);
        assertEq(bond.totalBondsHeld(), 1 ether);
        assertEq(bond.totalSlashedEscrow(), 0);

        bond.slash(market);
        assertEq(bond.totalBondsHeld(), 0, "bond counter not decremented on slash");
        assertEq(bond.totalSlashedEscrow(), 1 ether, "escrow counter not incremented");

        rej.pull(bond, recipient); // claimSlashed → pays out escrow
        assertEq(bond.totalSlashedEscrow(), 0, "escrow counter not decremented on claim");
        assertEq(bond.totalBondsHeld(), 0);
        assertEq(address(bond).balance, 0, "no ETH should remain");
    }

    /// withdrawBond decrements the live-bond counter exactly, freeing the balance as stranded=0.
    function test_bondCounter_afterWithdraw() public {
        // Register the market ACTIVE so withdrawBond's registry gate passes.
        registry.setFactory(address(this));
        registry.register(market, creator, address(token), keccak256("M"), MarketRegistry.Tier.PERMISSIONLESS);

        _post(market, 1 ether);
        assertEq(bond.totalBondsHeld(), 1 ether);

        vm.warp(block.timestamp + 8 days);
        vm.prank(creator);
        bond.withdrawBond(market);

        assertEq(bond.totalBondsHeld(), 0, "counter not decremented on withdraw");
        assertEq(address(bond).balance, 0);
    }

    /// returnBond (owner rescue of a live bond) also decrements the counter exactly.
    function test_bondCounter_afterReturnBond() public {
        _post(market, 1 ether);
        assertEq(bond.totalBondsHeld(), 1 ether);
        bond.returnBond(market, recipient);
        assertEq(bond.totalBondsHeld(), 0, "counter not decremented on returnBond");
    }

    // ============================================================
    // MED regression: rescue bounded to TRULY-STRANDED surplus — FeeRouter
    // ============================================================

    /// Drive a real collect() so the router holds unclaimed creator/treasury fees, then prove
    /// rescueToken can't touch that liability and totalClaimable stays exact through claim.
    function _collectFees(uint256 amt) internal returns (MockMarket m) {
        m = new MockMarket();
        token.mint(address(m), amt);
        m.setAvailable(address(router), amt);
        router.setFactory(address(this));
        router.registerMarket(address(m), creator, address(token));
        router.collect(address(m));
    }

    function test_feeRouter_totalClaimableTracksCollectAndClaim() public {
        _collectFees(1_000e18);
        // platform 50% = 500, creator 40% = 400 → 900 claimable liability; insurance 100 pushed to hub.
        assertEq(router.totalClaimable(address(token)), 900e18, "counter wrong after collect");
        assertEq(router.claimable(treasury, address(token)), 500e18);
        assertEq(router.claimable(creator, address(token)), 400e18);
        assertEq(token.balanceOf(address(router)), 900e18, "router should hold only platform+creator");

        vm.prank(treasury);
        router.claim(address(token));
        assertEq(router.totalClaimable(address(token)), 400e18, "counter not decremented on treasury claim");

        vm.prank(creator);
        router.claim(address(token));
        assertEq(router.totalClaimable(address(token)), 0, "counter not zeroed after all claims");
    }

    /// rescueToken cannot sweep an unclaimed fee: with balance == claimable liability, stranded = 0.
    function test_rescueToken_cannotSweepUnclaimedFee() public {
        _collectFees(1_000e18);
        // balance 900 == totalClaimable 900 → stranded 0.
        vm.expectRevert(FeeRouter.InsufficientBalance.selector);
        router.rescueToken(address(token), recipient, 1);
    }

    /// Only the surplus above outstanding claimable is rescuable; the fee liability stays put.
    function test_rescueToken_sweepsOnlySurplusOverClaimable() public {
        _collectFees(1_000e18); // 900 liability, 900 balance
        token.mint(address(router), 200e18); // +200 orphaned/stranded
        // stranded = 1100 - 900 = 200
        vm.expectRevert(FeeRouter.InsufficientBalance.selector);
        router.rescueToken(address(token), recipient, 200e18 + 1);

        uint256 before = token.balanceOf(recipient);
        router.rescueToken(address(token), recipient, 200e18);
        assertEq(token.balanceOf(recipient) - before, 200e18, "surplus not swept");
        assertEq(token.balanceOf(address(router)), 900e18, "fee liability not preserved");
        assertEq(router.totalClaimable(address(token)), 900e18, "counter changed by rescue");
        // Fees remain claimable in full afterwards.
        vm.prank(treasury);
        uint256 got = router.claim(address(token));
        assertEq(got, 500e18, "treasury fee not fully claimable after rescue");
    }
}
