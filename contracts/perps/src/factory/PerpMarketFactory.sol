// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./PerpMarket.sol";
import "./FeeRouter.sol";
import "./MarketRegistry.sol";
import "./OracleGuard.sol";
import "./ParamGuard.sol";
import "./BondManager.sol";

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
    address public oracleGuard; // on-chain oracle safety layer (spec §6)
    address public paramGuard; // governance param bounds (spec §8)
    address public bondManager; // slashable creation-bond escrow (spec §4/§5)

    // ---- tier-aware creation-bond minimums (spec §5: permissionless > curated) ----
    // Native-ETH, escrowed in BondManager at createMarket. Curated may be waived (0).
    // Tier matches MarketRegistry.Tier: 0 = CURATED, 1 = PERMISSIONLESS.
    uint256 public curatedMinBond;
    uint256 public permissionlessMinBond;

    // ---- parameter bounds (ParamGuard, spec §8) ----
    // feeRate is per-side, in Settlement `feeRate` units (bps of matchSize / 10_000).
    uint256 public constant MIN_FEE = 2; // 2 bps floor
    uint256 public constant MAX_FEE = 15; // 15 bps ceiling
    // Global leverage ceiling. The clamped value is now ALSO written to each market's
    // on-chain `marketMaxLeverage` (PerpMarket enforces leverage <= cap in _validateOrder).
    // When paramGuard is set it governs the clamp; PLATFORM_MAX_LEVERAGE is the fallback.
    uint256 public PLATFORM_MAX_LEVERAGE = 20 * 1e4; // 20x (LEVERAGE_PRECISION = 1e4)

    event ImplementationSet(address indexed implementation);
    event GuardsSet(address indexed oracleGuard, address indexed paramGuard);
    event BondManagerSet(address indexed bondManager);
    event MinBondsSet(uint256 curatedMinBond, uint256 permissionlessMinBond);
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
    error InsufficientBond();
    error TreasuryTransferFailed();

    constructor(
        address _implementation,
        address _weth,
        address _platformMatcher,
        address _platformAdmin,
        address _feeRouter,
        address _registry,
        address _treasury,
        uint256 _listingFee,
        address _oracleGuard,
        address _paramGuard,
        address _bondManager
    ) Ownable(msg.sender) {
        if (
            _implementation == address(0) ||
            _weth == address(0) ||
            _platformMatcher == address(0) ||
            _platformAdmin == address(0) ||
            _feeRouter == address(0) ||
            _registry == address(0) ||
            _treasury == address(0) ||
            _oracleGuard == address(0) ||
            _paramGuard == address(0) ||
            _bondManager == address(0)
        ) revert ZeroAddress();
        implementation = _implementation;
        weth = _weth;
        platformMatcher = _platformMatcher;
        platformAdmin = _platformAdmin;
        feeRouter = _feeRouter;
        registry = _registry;
        treasury = _treasury;
        listingFee = _listingFee;
        oracleGuard = _oracleGuard;
        paramGuard = _paramGuard;
        bondManager = _bondManager;
    }

    /// @notice Tier-aware minimum creation bond (spec §5): permissionless > curated.
    function minBond(uint8 tier) public view returns (uint256) {
        return tier == uint8(MarketRegistry.Tier.PERMISSIONLESS) ? permissionlessMinBond : curatedMinBond;
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

    function setGuards(address _oracleGuard, address _paramGuard) external onlyOwner {
        if (_oracleGuard == address(0) || _paramGuard == address(0)) revert ZeroAddress();
        oracleGuard = _oracleGuard;
        paramGuard = _paramGuard;
        emit GuardsSet(_oracleGuard, _paramGuard);
    }

    function setBondManager(address _bondManager) external onlyOwner {
        if (_bondManager == address(0)) revert ZeroAddress();
        bondManager = _bondManager;
        emit BondManagerSet(_bondManager);
    }

    function setMinBonds(uint256 _curatedMinBond, uint256 _permissionlessMinBond) external onlyOwner {
        curatedMinBond = _curatedMinBond;
        permissionlessMinBond = _permissionlessMinBond;
        emit MinBondsSet(_curatedMinBond, _permissionlessMinBond);
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
     * @param oracleCfg   the market's oracle source config (validated + registered on-chain)
     * @return market     the deployed clone address
     */
    function createMarket(
        address collateral,
        uint8 decimals,
        address creator,
        uint256 feeRate,
        uint256 maxLeverage,
        bytes32 marketId,
        uint8 tier,
        OracleGuard.OracleConfig calldata oracleCfg
    ) external payable returns (address market) {
        if (collateral == address(0) || creator == address(0)) revert ZeroAddress();
        // Creation cost = listing fee (→ treasury) + creation bond (→ BondManager escrow, spec §4/§5).
        uint256 lf = listingFee;
        uint256 bond = minBond(tier);
        if (msg.value < lf + bond) revert InsufficientBond();

        // Oracle safety gate (spec §6): venue allowlisted, deviation band sane, and the
        // PERMISSIONLESS tier forced dual-source + reference feed. Reverts on violation.
        OracleGuard(oracleGuard).validateConfig(oracleCfg, tier);

        // Clamp params to platform bounds (ParamGuard, spec §8). ParamGuard governs the
        // bounds; PLATFORM_MAX_LEVERAGE / MIN_FEE / MAX_FEE remain the fallback.
        uint256 clampedFee = ParamGuard(paramGuard).clampFee(feeRate);
        uint256 clampedLev = maxLeverage > PLATFORM_MAX_LEVERAGE ? PLATFORM_MAX_LEVERAGE : maxLeverage;
        clampedLev = ParamGuard(paramGuard).clampLeverage(clampedLev);

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
        // Enforce the per-market leverage cap ON-CHAIN (spec §8) before handing off control.
        m.setMarketMaxLeverage(clampedLev);

        // SECURITY_REVIEW.md H-1 / M-1: wire the on-chain safety layer into the settle path
        // BEFORE handing off control, so it's active from the market's first trade.
        //  - OracleGuard: runtime deviation/staleness breaker on every settled price.
        //  - InsuranceHub (== the FeeRouter's insurance sink): the market's own per-market
        //    sub-account that the settle path draws to cover winner-shortfall bad-debt. The
        //    market is a self-authorized coverer in the hub (msg.sender == market), so no
        //    extra authorization tx is needed.
        m.setOracleGuard(oracleGuard);
        m.setInsuranceFund(FeeRouter(feeRouter).insuranceHub());

        // Platform keeps operational control; creator only earns fees.
        m.transferOwnership(platformAdmin);

        // Register with shared PlatformCore.
        FeeRouter(feeRouter).registerMarket(market, creator, collateral);
        MarketRegistry(registry).register(market, creator, collateral, marketId, MarketRegistry.Tier(tier));
        OracleGuard(oracleGuard).registerMarket(market, oracleCfg);

        // Settle creation cost: listing fee → treasury (2nd revenue line), bond → escrow.
        // Everything above the listing fee is escrowed as the (>= minBond) creation bond,
        // letting a creator over-bond. Bond is slashable / reclaimable via BondManager.
        if (lf > 0) {
            (bool ok, ) = payable(treasury).call{value: lf}("");
            if (!ok) revert TreasuryTransferFailed();
        }
        uint256 bondAmount = msg.value - lf;
        BondManager(bondManager).postBond{value: bondAmount}(market, creator);

        emit MarketCreated(market, creator, collateral, marketId, tier, clampedFee, clampedLev);
    }
}
