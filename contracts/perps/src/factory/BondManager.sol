// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Minimal surface of MarketRegistry needed to read a market's live status.
///      `markets(index)` is the auto-generated getter over the public MarketInfo[] array;
///      `indexOf(market)` returns the array index + 1 (0 = absent). Status enum: 0=ACTIVE.
interface IMarketRegistryStatus {
    function indexOf(address market) external view returns (uint256);
    function markets(uint256 index)
        external
        view
        returns (
            address market,
            address creator,
            address collateral,
            bytes32 marketId,
            uint8 tier,
            uint8 status,
            uint256 createdAt
        );
}

/**
 * @title BondManager
 * @notice Slashable creation-bond escrow for HookSwapPerps self-service markets
 *         (SELF_SERVICE_SPEC.md §4/§5). Every market posts a native-ETH bond at
 *         createMarket (larger + slashable for the permissionless tier, waivable for
 *         curated). The bond is the abuse deterrent tied to the MarketRegistry
 *         force-pause kill switch:
 *
 *           - postBond(market, creator)  — factory-only, escrows msg.value per market.
 *           - slash(market)              — platform governance seizes a misbehaving
 *                                          market's bond → treasury (abuse deterrent).
 *           - withdrawBond(market)       — the creator reclaims their bond after
 *                                          WITHDRAW_DELAY IF not slashed AND the market's
 *                                          MarketRegistry status is still ACTIVE.
 *
 *         The tier-aware MINIMUMS live in the factory (minBond(tier)); BondManager just
 *         escrows whatever the factory forwards, so it stays a dumb, auditable vault.
 */
contract BondManager is Ownable {
    struct Bond {
        address creator; // who posted the bond / may reclaim it
        uint256 amount; // escrowed native ETH
        uint64 postedAt; // creation timestamp (0 = never posted)
        bool slashed; // seized by governance
        bool withdrawn; // reclaimed by creator
    }

    /// market => bond
    mapping(address => Bond) public bonds;

    address public factory; // the only address allowed to post bonds
    address public treasury; // slash sink
    address public registry; // MarketRegistry (status gate for withdrawals)
    uint256 public withdrawDelay = 7 days; // cool-down before a creator can reclaim

    event FactorySet(address indexed factory);
    event TreasurySet(address indexed treasury);
    event RegistrySet(address indexed registry);
    event WithdrawDelaySet(uint256 delay);
    event BondPosted(address indexed market, address indexed creator, uint256 amount);
    event BondSlashed(address indexed market, address indexed treasury, uint256 amount);
    event BondWithdrawn(address indexed market, address indexed creator, uint256 amount);

    error NotFactory();
    error ZeroAddress();
    error BondExists();
    error NoBond();
    error BondClosed(); // already slashed or withdrawn
    error BondAlreadySlashed();
    error NotCreator();
    error WithdrawTooEarly();
    error MarketNotActive();
    error UnknownMarket();
    error TransferFailed();

    constructor(address _treasury, address _registry) Ownable(msg.sender) {
        if (_treasury == address(0) || _registry == address(0)) revert ZeroAddress();
        treasury = _treasury;
        registry = _registry;
    }

    // ============================================================
    // Admin
    // ============================================================

    function setFactory(address _factory) external onlyOwner {
        if (_factory == address(0)) revert ZeroAddress();
        factory = _factory;
        emit FactorySet(_factory);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    function setRegistry(address _registry) external onlyOwner {
        if (_registry == address(0)) revert ZeroAddress();
        registry = _registry;
        emit RegistrySet(_registry);
    }

    function setWithdrawDelay(uint256 _delay) external onlyOwner {
        withdrawDelay = _delay;
        emit WithdrawDelaySet(_delay);
    }

    // ============================================================
    // Factory hook — escrow
    // ============================================================

    /// @notice Escrow a market's creation bond. Only the factory may post, once per market.
    function postBond(address market, address creator) external payable {
        if (msg.sender != factory) revert NotFactory();
        if (market == address(0) || creator == address(0)) revert ZeroAddress();
        Bond storage b = bonds[market];
        if (b.postedAt != 0) revert BondExists();
        b.creator = creator;
        b.amount = msg.value;
        b.postedAt = uint64(block.timestamp);
        emit BondPosted(market, creator, msg.value);
    }

    // ============================================================
    // Governance — slash
    // ============================================================

    /// @notice Seize a misbehaving market's bond to the treasury (abuse deterrent, spec §5).
    ///         Tied to the MarketRegistry force-pause kill switch (off-chain policy).
    function slash(address market) external onlyOwner {
        Bond storage b = bonds[market];
        if (b.postedAt == 0) revert NoBond();
        if (b.slashed) revert BondAlreadySlashed();
        if (b.withdrawn) revert BondClosed();
        uint256 amt = b.amount;
        b.slashed = true;
        if (amt > 0) {
            (bool ok, ) = payable(treasury).call{value: amt}("");
            if (!ok) revert TransferFailed();
        }
        emit BondSlashed(market, treasury, amt);
    }

    // ============================================================
    // Creator — reclaim
    // ============================================================

    /// @notice Reclaim a bond after the cool-down, IF not slashed and the market is not DELISTED.
    ///         Reverts before the delay, if slashed/withdrawn, if the caller isn't the creator,
    ///         or if the market is DELISTED.
    ///
    ///         M-4 (SECURITY_REVIEW.md): the old gate required registry status == ACTIVE, so an
    ///         ordinary operational PAUSE (a legitimate, temporary state) trapped the creator's
    ///         bond indefinitely — a de-facto seizure with no on-chain `slashed` record. A bond is
    ///         the abuse deterrent: seizing it must go through `slash` (permanent, emits
    ///         BondSlashed → treasury). So only two states may block a post-cool-down reclaim:
    ///         `slashed` (checked above) and DELISTED (the explicit abuse-takedown terminal state).
    ///         PAUSED no longer blocks — a paused-but-not-slashed market's creator can still reclaim.
    function withdrawBond(address market) external {
        Bond storage b = bonds[market];
        if (b.postedAt == 0) revert NoBond();
        if (msg.sender != b.creator) revert NotCreator();
        if (b.slashed) revert BondAlreadySlashed();
        if (b.withdrawn) revert BondClosed();
        if (block.timestamp < uint256(b.postedAt) + withdrawDelay) revert WithdrawTooEarly();

        // Market must not be DELISTED in the registry (Status: 0=ACTIVE, 1=PAUSED, 2=DELISTED).
        // ACTIVE and PAUSED both permit reclaim; only a DELISTED (abuse) market blocks it.
        uint256 idx = IMarketRegistryStatus(registry).indexOf(market);
        if (idx == 0) revert UnknownMarket();
        (, , , , , uint8 status, ) = IMarketRegistryStatus(registry).markets(idx - 1);
        if (status == 2) revert MarketNotActive(); // 2 = DELISTED (abuse takedown)

        uint256 amt = b.amount;
        b.withdrawn = true;
        if (amt > 0) {
            (bool ok, ) = payable(b.creator).call{value: amt}("");
            if (!ok) revert TransferFailed();
        }
        emit BondWithdrawn(market, b.creator, amt);
    }

    /// @notice Convenience view for the frontend/indexer.
    function bondOf(address market) external view returns (Bond memory) {
        return bonds[market];
    }
}
