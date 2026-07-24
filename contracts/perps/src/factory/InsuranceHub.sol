// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title InsuranceHub
 * @notice Per-market insurance sub-accounts for HookSwapPerps self-service markets
 *         (SELF_SERVICE_SPEC.md §7). Replaces the single global insurance sink with
 *         isolated accounting: each market's insurance fee slice is credited to that
 *         market's own sub-account, and bad-debt for a market is covered ONLY from its
 *         own balance — a blowup in one market can never drain another's insurance.
 *
 *           - notifyFee(market, token, amount)   — the FeeRouter approves this hub and
 *             calls notifyFee; the hub PULLS the insurance slice in (transferFrom) and
 *             credits `balanceOf[market][token]`. Self-verifying: it credits exactly what
 *             actually arrived, so an unauthenticated call can never over-credit.
 *           - coverLoss(market, token, amount, to) — authorized coverers pay a market's
 *             bad-debt from its OWN sub-account first; reverts InsufficientMarketInsurance
 *             if the sub-account can't cover it. An OPTIONAL owner-funded shared backstop
 *             tranche (off by default, opt-in per market) may top up curated markets after
 *             their own insurance is exhausted.
 *
 *         `authorized` = the market itself (covering its own bad-debt) and/or a platform
 *         keeper on the owner-set allowlist.
 */
contract InsuranceHub is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// market => token => insurance balance held for that market
    mapping(address => mapping(address => uint256)) public balanceOf;

    /// token => shared platform backstop tranche (owner-funded; drawn only for opted-in markets)
    mapping(address => uint256) public backstop;

    /// market => may draw the shared backstop after its own sub-account is exhausted (owner-set)
    mapping(address => bool) public backstopEnabled;

    /// keeper => may call coverLoss for any market (the market itself is always authorized)
    mapping(address => bool) public isAuthorizedCoverer;

    event FeeNotified(address indexed market, address indexed token, uint256 amount, address indexed from);
    event LossCovered(
        address indexed market,
        address indexed token,
        uint256 amount,
        uint256 fromMarket,
        uint256 fromBackstop,
        address to
    );
    event AuthorizedCovererSet(address indexed coverer, bool authorized);
    event BackstopEnabledSet(address indexed market, bool enabled);
    event BackstopFunded(address indexed token, uint256 amount, address indexed from);
    event BackstopWithdrawn(address indexed token, uint256 amount, address indexed to);
    /// Owner recovered a (dead-market) sub-account balance directly, bypassing the coverLoss dance.
    event OwnerSwept(address indexed market, address indexed token, uint256 amount, address indexed to);

    error NotAuthorized();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientMarketInsurance();
    error InsufficientBackstop();

    constructor() Ownable(msg.sender) {}

    modifier onlyCoverer(address market) {
        if (msg.sender != market && !isAuthorizedCoverer[msg.sender]) revert NotAuthorized();
        _;
    }

    // ============================================================
    // Fee intake (per-market)
    // ============================================================

    /**
     * @notice Credit `market`'s insurance sub-account with the fee slice. The caller
     *         (the FeeRouter) must have approved this hub for `amount` of `token`; the hub
     *         pulls it in and credits exactly what arrives (fee-on-transfer safe). Because
     *         it pulls rather than trusts, the call is safe to leave permissionless — you
     *         cannot inflate a sub-account without actually depositing the tokens.
     */
    function notifyFee(address market, address token, uint256 amount) external nonReentrant {
        if (market == address(0) || token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;
        balanceOf[market][token] += received;
        emit FeeNotified(market, token, received, msg.sender);
    }

    // ============================================================
    // Cover bad-debt (per-market, isolated)
    // ============================================================

    /**
     * @notice Pay `amount` of a market's bad-debt in `token` to `to`, drawing from that
     *         market's OWN sub-account first. If (and only if) the market is backstop-enabled,
     *         any shortfall is topped up from the shared backstop tranche. Reverts
     *         InsufficientMarketInsurance if the market (plus any allowed backstop) can't cover it.
     */
    function coverLoss(address market, address token, uint256 amount, address to)
        external
        nonReentrant
        onlyCoverer(market)
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 own = balanceOf[market][token];
        uint256 fromMarket;
        uint256 fromBackstop;

        if (own >= amount) {
            fromMarket = amount;
        } else {
            // Own sub-account can't cover it — only opted-in (curated) markets may draw the backstop.
            if (!backstopEnabled[market]) revert InsufficientMarketInsurance();
            uint256 deficit = amount - own;
            if (backstop[token] < deficit) revert InsufficientMarketInsurance();
            fromMarket = own;
            fromBackstop = deficit;
        }

        balanceOf[market][token] = own - fromMarket;
        if (fromBackstop > 0) backstop[token] -= fromBackstop;

        IERC20(token).safeTransfer(to, amount);
        emit LossCovered(market, token, amount, fromMarket, fromBackstop, to);
    }

    // ============================================================
    // Owner — authorization + backstop tranche
    // ============================================================

    function setAuthorizedCoverer(address coverer, bool authorized) external onlyOwner {
        if (coverer == address(0)) revert ZeroAddress();
        isAuthorizedCoverer[coverer] = authorized;
        emit AuthorizedCovererSet(coverer, authorized);
    }

    function setBackstopEnabled(address market, bool enabled) external onlyOwner {
        if (market == address(0)) revert ZeroAddress();
        backstopEnabled[market] = enabled;
        emit BackstopEnabledSet(market, enabled);
    }

    /// @notice Owner funds the shared backstop tranche (pulls `amount` via transferFrom).
    function fundBackstop(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;
        backstop[token] += received;
        emit BackstopFunded(token, received, msg.sender);
    }

    /// @notice Owner withdraws from the shared backstop tranche (never touches sub-accounts).
    function withdrawBackstop(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (backstop[token] < amount) revert InsufficientBackstop();
        backstop[token] -= amount;
        IERC20(token).safeTransfer(to, amount);
        emit BackstopWithdrawn(token, amount, to);
    }

    // ============================================================
    // Owner — rescue (recover a stranded sub-account)
    // ============================================================

    /**
     * @notice Recover a market's insurance sub-account balance directly to `to`. Fixes the
     *         dead-market trap: if a market is delisted/abandoned, its `balanceOf[market][token]`
     *         is otherwise only reachable via the setAuthorizedCoverer(self) + coverLoss dance.
     *         This lets the owner recover it in one call. Decrements the sub-account (reverts on
     *         overdraw) BEFORE transferring, so it can only ever move funds actually credited to
     *         that market — never another market's balance, the backstop, or more than exists.
     */
    function ownerSweep(address market, address token, uint256 amount, address to)
        external
        onlyOwner
        nonReentrant
    {
        if (market == address(0) || token == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[market][token];
        if (amount > bal) revert InsufficientMarketInsurance();
        balanceOf[market][token] = bal - amount;
        IERC20(token).safeTransfer(to, amount);
        emit OwnerSwept(market, token, amount, to);
    }
}
