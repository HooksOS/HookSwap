// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Minimal Chainlink aggregator surface (ETH/USD etc.). 8-dec answer on most feeds.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @dev Minimal UniswapV2-style pair surface for AMM liquidity depth checks.
interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

/**
 * @title OracleGuard
 * @notice Shared, platform-owned on-chain oracle safety layer for HookSwapPerps
 *         self-service markets (SELF_SERVICE_SPEC.md §6). A project picking a thin AMM
 *         pool or an unvetted feed as its price source is the #1 drain vector for
 *         permissionless markets. OracleGuard bounds that blast radius:
 *
 *           - Venue allowlist per source type (curated by governance).
 *           - Per-market oracle config registered by the factory at createMarket.
 *           - validateConfig() — the create-time gate (venue allowlisted, deviation band
 *             sane, permissionless tier forced dual-source + reference feed).
 *           - checkDeviation() — the runtime circuit breaker the matcher/settle path calls:
 *             reverts if the proposed mark price is stale vs, or deviates too far from, the
 *             market's Chainlink reference feed.
 *           - checkLiquidity() — AMM depth guard (v2 reserves >= threshold).
 *
 *         All bounds are owner-set. This is the on-chain trust layer the off-chain
 *         perps-engine oracle registry cannot provide by itself.
 */
contract OracleGuard is Ownable {
    // ---- per-market oracle config (registered by the factory) ----
    struct OracleConfig {
        bytes32 sourceType; // keccak label, e.g. keccak256("chainlink") / keccak256("hookswap-v2")
        address venue; // the feed / AMM pair address (must be allowlisted for its sourceType)
        address refFeed; // Chainlink reference feed for the deviation breaker (0 = none)
        uint256 maxDeviationBps; // allowed |mark - ref| / ref, in bps (bounded to [MIN,MAX])
        uint256 maxStaleness; // max age (seconds) of the reference feed round
        uint256 minLiquidity; // AMM depth requirement (product of reserves), advisory here
        bool dualSourceRequired; // permissionless tier must set true (AMM + reference agree)
    }

    uint256 public constant BPS = 10_000;
    // Sane deviation band a market config must fall within (owner cannot bypass these).
    uint256 public constant MIN_DEVIATION_BPS = 10; // 0.1% floor (too-tight = griefable)
    uint256 public constant MAX_DEVIATION_BPS = 2_000; // 20% ceiling (too-loose = no protection)
    // Matches MarketRegistry.Tier: 0 = CURATED, 1 = PERMISSIONLESS.
    uint8 public constant PERMISSIONLESS_TIER = 1;

    address public factory; // the only address allowed to register market configs
    uint256 public minLiquidity; // global AMM min-depth for checkLiquidity (owner-set)

    // sourceType => venue => allowed
    mapping(bytes32 => mapping(address => bool)) public allowedVenue;
    // sourceType => treated as an AMM (checkLiquidity reads v2 reserves)
    mapping(bytes32 => bool) public isAmmSource;
    // market => its registered oracle config
    mapping(address => OracleConfig) public marketConfig;

    event FactorySet(address indexed factory);
    event VenueSet(bytes32 indexed sourceType, address indexed venue, bool allowed);
    event AmmSourceSet(bytes32 indexed sourceType, bool isAmm);
    event MinLiquiditySet(uint256 minLiquidity);
    event MarketOracleRegistered(
        address indexed market, bytes32 indexed sourceType, address indexed venue, address refFeed
    );

    error NotFactory();
    error ZeroAddress();
    error VenueNotAllowed();
    error DeviationOutOfBand();
    error DualSourceRequired();
    error RefFeedRequired();
    error NoRefFeed();
    error BadRefAnswer();
    error StalePrice();
    error PriceDeviationTooLarge();

    constructor() Ownable(msg.sender) {}

    // ============================================================
    // Admin (all bounds owner-set)
    // ============================================================

    function setFactory(address _factory) external onlyOwner {
        if (_factory == address(0)) revert ZeroAddress();
        factory = _factory;
        emit FactorySet(_factory);
    }

    /// @notice Allow/deny a venue for a source type (the curated allowlist, spec §6).
    function setVenue(bytes32 sourceType, address venue, bool allowed) external onlyOwner {
        if (venue == address(0)) revert ZeroAddress();
        allowedVenue[sourceType][venue] = allowed;
        emit VenueSet(sourceType, venue, allowed);
    }

    /// @notice Mark a source type as an AMM so checkLiquidity reads v2 reserves for it.
    function setAmmSource(bytes32 sourceType, bool isAmm) external onlyOwner {
        isAmmSource[sourceType] = isAmm;
        emit AmmSourceSet(sourceType, isAmm);
    }

    /// @notice Global AMM min-depth (product of reserves) for checkLiquidity.
    function setMinLiquidity(uint256 _minLiquidity) external onlyOwner {
        minLiquidity = _minLiquidity;
        emit MinLiquiditySet(_minLiquidity);
    }

    // ============================================================
    // Create-time gate + registration
    // ============================================================

    /**
     * @notice Create-time validation, called by the factory in createMarket.
     *         - venue must be allowlisted for its source type,
     *         - maxDeviationBps must sit inside the sane band,
     *         - PERMISSIONLESS tier is forced dual-source with a reference feed.
     */
    function validateConfig(OracleConfig calldata cfg, uint8 tier) public view {
        if (!allowedVenue[cfg.sourceType][cfg.venue]) revert VenueNotAllowed();
        if (cfg.maxDeviationBps < MIN_DEVIATION_BPS || cfg.maxDeviationBps > MAX_DEVIATION_BPS) {
            revert DeviationOutOfBand();
        }
        if (tier == PERMISSIONLESS_TIER) {
            if (!cfg.dualSourceRequired) revert DualSourceRequired();
            if (cfg.refFeed == address(0)) revert RefFeedRequired();
        }
    }

    /// @notice Store a market's oracle config. Only the factory may register.
    function registerMarket(address market, OracleConfig calldata cfg) external {
        if (msg.sender != factory) revert NotFactory();
        if (market == address(0)) revert ZeroAddress();
        // Defensive re-check of the tier-independent invariants (venue + band).
        if (!allowedVenue[cfg.sourceType][cfg.venue]) revert VenueNotAllowed();
        if (cfg.maxDeviationBps < MIN_DEVIATION_BPS || cfg.maxDeviationBps > MAX_DEVIATION_BPS) {
            revert DeviationOutOfBand();
        }
        marketConfig[market] = cfg;
        emit MarketOracleRegistered(market, cfg.sourceType, cfg.venue, cfg.refFeed);
    }

    // ============================================================
    // Runtime circuit breaker
    // ============================================================

    /**
     * @notice Revert if `proposedPrice` (1e18) is stale vs, or deviates too far from, the
     *         market's Chainlink reference feed. The matcher/settle path calls this before
     *         accepting a mark price.
     */
    function checkDeviation(address market, uint256 proposedPrice) external view {
        OracleConfig memory cfg = marketConfig[market];
        if (cfg.refFeed == address(0)) revert NoRefFeed();

        (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(cfg.refFeed).latestRoundData();
        if (answer <= 0 || updatedAt == 0) revert BadRefAnswer();
        // Freshness: reject if the round is older than the configured max staleness.
        if (block.timestamp > updatedAt && block.timestamp - updatedAt > cfg.maxStaleness) revert StalePrice();

        // Normalize the feed answer (feed-decimals) to 1e18.
        uint8 dec = AggregatorV3Interface(cfg.refFeed).decimals();
        uint256 ref = (uint256(answer) * 1e18) / (10 ** dec);
        if (ref == 0) revert BadRefAnswer();

        uint256 diff = proposedPrice > ref ? proposedPrice - ref : ref - proposedPrice;
        if ((diff * BPS) / ref > cfg.maxDeviationBps) revert PriceDeviationTooLarge();
    }

    /// @notice AMM depth guard. For AMM source types, require v2 reserve product >= minLiquidity.
    ///         For non-AMM source types (Chainlink/Pyth/API) there is no pool to read → true.
    ///         Defensive: a venue that doesn't implement getReserves() returns false, not revert.
    function checkLiquidity(bytes32 sourceType, address venue) external view returns (bool) {
        if (!isAmmSource[sourceType]) return true;
        try IUniswapV2Pair(venue).getReserves() returns (uint112 r0, uint112 r1, uint32) {
            if (r0 == 0 || r1 == 0) return false;
            return (uint256(r0) * uint256(r1)) >= minLiquidity;
        } catch {
            return false;
        }
    }

    /// @notice Read a market's stored oracle config (frontend/indexer/matcher).
    function getMarketConfig(address market) external view returns (OracleConfig memory) {
        return marketConfig[market];
    }
}
