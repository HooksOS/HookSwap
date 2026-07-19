// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./PerpMarket.sol";
import "./FeeRouter.sol";
import "./MarketRegistry.sol";

/**
 * @title PerpMarketFactory
 * @notice Permissionless factory for HookSwapPerps self-service markets. Each call to
 *         `createMarket` deploys an EIP-1167 minimal-proxy clone of a single audited
 *         `PerpMarket` implementation, wires it to shared PlatformCore (FeeRouter +
 *         MarketRegistry), and hands ownership to the platform admin. The market creator
 *         only EARNS fees (via FeeRouter) — the platform keeps operational control
 *         (matcher, pause, params), per SELF_SERVICE_SPEC.md §4/§9.
 *
 *         Fee capture is non-bypassable: every clone's `feeReceiver` is set to the
 *         FeeRouter here, before ownership is transferred out, so all trading fees route
 *         to the platform-floored split by construction.
 */
contract PerpMarketFactory is Ownable {
    using Clones for address;

    // ---- immutable-ish platform wiring (owner-updatable) ----
    address public implementation; // the audited PerpMarket impl to clone
    address public weth;
    address public platformMatcher; // HookSwap shared sequencer/matcher
    address public platformAdmin; // receives ownership of every market
    address public feeRouter;
    address public registry;
    address public treasury; // listing-fee sink
    uint256 public listingFee; // creation fee forwarded to treasury (2nd revenue line)

    // ---- parameter bounds (ParamGuard, spec §8) ----
    // feeRate is per-side, in Settlement `feeRate` units (bps of matchSize / 10_000).
    uint256 public constant MIN_FEE = 2; // 2 bps floor
    uint256 public constant MAX_FEE = 15; // 15 bps ceiling
    // Global leverage ceiling. Stored + emitted; enforced off-chain by the matcher
    // (the PerpMarket core validates leverage <= its own MAX_LEVERAGE constant on settle).
    uint256 public PLATFORM_MAX_LEVERAGE = 20 * 1e4; // 20x (LEVERAGE_PRECISION = 1e4)

    event ImplementationSet(address indexed implementation);
    event PlatformWiringSet(
        address weth,
        address platformMatcher,
        address platformAdmin,
        address feeRouter,
        address registry,
        address treasury,
        uint256 listingFee
    );
    event PlatformMaxLeverageSet(uint256 maxLeverage);
    event MarketCreated(
        address indexed market,
        address indexed creator,
        address indexed collateral,
        bytes32 marketId,
        uint8 tier,
        uint256 feeRate,
        uint256 maxLeverage
    );

    error ZeroAddress();
    error InsufficientListingFee();
    error TreasuryTransferFailed();

    constructor(
        address _implementation,
        address _weth,
        address _platformMatcher,
        address _platformAdmin,
        address _feeRouter,
        address _registry,
        address _treasury,
        uint256 _listingFee
    ) Ownable(msg.sender) {
        if (
            _implementation == address(0) ||
            _weth == address(0) ||
            _platformMatcher == address(0) ||
            _platformAdmin == address(0) ||
            _feeRouter == address(0) ||
            _registry == address(0) ||
            _treasury == address(0)
        ) revert ZeroAddress();
        implementation = _implementation;
        weth = _weth;
        platformMatcher = _platformMatcher;
        platformAdmin = _platformAdmin;
        feeRouter = _feeRouter;
        registry = _registry;
        treasury = _treasury;
        listingFee = _listingFee;
    }

    // ============================================================
    // Admin
    // ============================================================

    function setImplementation(address _implementation) external onlyOwner {
        if (_implementation == address(0)) revert ZeroAddress();
        implementation = _implementation;
        emit ImplementationSet(_implementation);
    }

    function setPlatformWiring(
        address _weth,
        address _platformMatcher,
        address _platformAdmin,
        address _feeRouter,
        address _registry,
        address _treasury,
        uint256 _listingFee
    ) external onlyOwner {
        if (
            _weth == address(0) ||
            _platformMatcher == address(0) ||
            _platformAdmin == address(0) ||
            _feeRouter == address(0) ||
            _registry == address(0) ||
            _treasury == address(0)
        ) revert ZeroAddress();
        weth = _weth;
        platformMatcher = _platformMatcher;
        platformAdmin = _platformAdmin;
        feeRouter = _feeRouter;
        registry = _registry;
        treasury = _treasury;
        listingFee = _listingFee;
        emit PlatformWiringSet(_weth, _platformMatcher, _platformAdmin, _feeRouter, _registry, _treasury, _listingFee);
    }

    function setPlatformMaxLeverage(uint256 _maxLeverage) external onlyOwner {
        PLATFORM_MAX_LEVERAGE = _maxLeverage;
        emit PlatformMaxLeverageSet(_maxLeverage);
    }

    // ============================================================
    // Create
    // ============================================================

    /**
     * @notice Permissionlessly launch a new isolated perp market.
     * @param collateral  the market's collateral token (e.g. WETH)
     * @param decimals    collateral token decimals (0 = auto-detect in the market)
     * @param creator     fee beneficiary / launcher (earns the creator share)
     * @param feeRate     desired per-side fee rate; clamped to [MIN_FEE, MAX_FEE]
     * @param maxLeverage requested market leverage cap; clamped to PLATFORM_MAX_LEVERAGE (advisory/off-chain)
     * @param marketId    human label, e.g. keccak256("BTC-PERP")
     * @param tier        MarketRegistry.Tier (0 = CURATED, 1 = PERMISSIONLESS)
     * @return market     the deployed clone address
     */
    function createMarket(
        address collateral,
        uint8 decimals,
        address creator,
        uint256 feeRate,
        uint256 maxLeverage,
        bytes32 marketId,
        uint8 tier
    ) external payable returns (address market) {
        if (collateral == address(0) || creator == address(0)) revert ZeroAddress();
        if (msg.value < listingFee) revert InsufficientListingFee();

        // Forward the listing fee to the treasury (2nd platform revenue line).
        if (msg.value > 0) {
            (bool ok, ) = payable(treasury).call{value: msg.value}("");
            if (!ok) revert TreasuryTransferFailed();
        }

        // Clamp params to platform bounds (ParamGuard, spec §8).
        uint256 clampedFee = feeRate < MIN_FEE ? MIN_FEE : (feeRate > MAX_FEE ? MAX_FEE : feeRate);
        uint256 clampedLev = maxLeverage > PLATFORM_MAX_LEVERAGE ? PLATFORM_MAX_LEVERAGE : maxLeverage;

        // Deploy an isolated market clone; factory is temporary owner so it can configure.
        market = implementation.clone();
        PerpMarket m = PerpMarket(payable(market));
        m.initialize(address(this));

        // Wire the market. WETH is only needed for native-ETH deposits (collateral == weth).
        if (collateral == weth) {
            m.setWETH(weth);
        }
        m.addSupportedToken(collateral, decimals);
        m.setAuthorizedMatcher(platformMatcher, true);
        m.setFeeRate(clampedFee);
        m.setFeeReceiver(feeRouter); // all fees → platform-floored split, non-bypassable

        // Platform keeps operational control; creator only earns fees.
        m.transferOwnership(platformAdmin);

        // Register with shared PlatformCore.
        FeeRouter(feeRouter).registerMarket(market, creator, collateral);
        MarketRegistry(registry).register(market, creator, collateral, marketId, MarketRegistry.Tier(tier));

        emit MarketCreated(market, creator, collateral, marketId, tier, clampedFee, clampedLev);
    }
}
