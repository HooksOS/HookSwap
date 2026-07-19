// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FeeRouter
 * @notice Platform-fee capture for HookSwapPerps self-service markets. Every
 *         self-service `PerpMarket` (a per-market Settlement instance) sets its
 *         `feeReceiver` to THIS contract, so all trading fees accrue here as the
 *         router's internal balance in each market. `collect(market)` pulls the
 *         accrued fees out (the router IS the market's feeReceiver, so it can
 *         `withdraw`) and splits them three ways, on-chain, non-bypassably:
 *
 *           PLATFORM  (HookSwap treasury)  — hard floor, creators can't undercut it
 *           CREATOR   (the market's launcher)
 *           INSURANCE (the market's backstop)
 *
 *         Split is claim-based (pull, not push) so a hostile token/recipient can't
 *         grief `collect`. Denominated in each market's collateral token.
 *
 *         v1: shares are global governance params (owner-set) with a platform floor.
 *         Per-market share overrides + slashable bonds are a v2 concern.
 */
contract FeeRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    // ---- config ----
    address public factory; // the only address allowed to register markets
    address public treasury; // platform fee sink
    address public insuranceHub; // InsuranceHub — per-market insurance sub-accounts (spec §7)

    /// Platform share of every fee, in bps. Enforced >= platformFloorBps.
    uint256 public platformShareBps = 5_000; // 50%
    uint256 public creatorShareBps = 4_000; // 40%
    // insurance share = BPS - platform - creator  (>= 0)

    /// The floor the platform share can never drop below (revenue protection).
    uint256 public platformFloorBps = 4_000; // 40%

    // ---- market bookkeeping ----
    mapping(address => address) public creatorOf; // market => creator (fee beneficiary)
    mapping(address => address) public collateralOf; // market => collateral token
    mapping(address => bool) public isMarket;

    // beneficiary => token => claimable amount
    mapping(address => mapping(address => uint256)) public claimable;

    event FactorySet(address indexed factory);
    event SharesSet(uint256 platformBps, uint256 creatorBps, uint256 insuranceBps);
    event SinksSet(address indexed treasury, address indexed insuranceHub);
    event MarketRegistered(address indexed market, address indexed creator, address indexed collateral);
    event FeesCollected(
        address indexed market,
        address indexed token,
        uint256 total,
        uint256 platform,
        uint256 creator,
        uint256 insurance
    );
    event Claimed(address indexed beneficiary, address indexed token, uint256 amount);

    error NotFactory();
    error UnknownMarket();
    error FloorViolated();
    error BadShares();
    error ZeroAddress();

    constructor(address _treasury, address _insuranceHub) Ownable(msg.sender) {
        if (_treasury == address(0) || _insuranceHub == address(0)) revert ZeroAddress();
        treasury = _treasury;
        insuranceHub = _insuranceHub;
    }

    // ============================================================
    // Admin
    // ============================================================

    function setFactory(address _factory) external onlyOwner {
        if (_factory == address(0)) revert ZeroAddress();
        factory = _factory;
        emit FactorySet(_factory);
    }

    function setSinks(address _treasury, address _insuranceHub) external onlyOwner {
        if (_treasury == address(0) || _insuranceHub == address(0)) revert ZeroAddress();
        treasury = _treasury;
        insuranceHub = _insuranceHub;
        emit SinksSet(_treasury, _insuranceHub);
    }

    /**
     * @notice Update the fee split. Platform share can never go below the floor.
     *         platform + creator must be <= BPS; insurance takes the remainder.
     */
    function setShares(uint256 _platformBps, uint256 _creatorBps) external onlyOwner {
        if (_platformBps < platformFloorBps) revert FloorViolated();
        if (_platformBps + _creatorBps > BPS) revert BadShares();
        platformShareBps = _platformBps;
        creatorShareBps = _creatorBps;
        emit SharesSet(_platformBps, _creatorBps, BPS - _platformBps - _creatorBps);
    }

    // ============================================================
    // Factory hook
    // ============================================================

    function registerMarket(address market, address creator, address collateral) external {
        if (msg.sender != factory) revert NotFactory();
        if (market == address(0) || creator == address(0) || collateral == address(0)) revert ZeroAddress();
        creatorOf[market] = creator;
        collateralOf[market] = collateral;
        isMarket[market] = true;
        emit MarketRegistered(market, creator, collateral);
    }

    // ============================================================
    // Collect + split
    // ============================================================

    /**
     * @notice Pull all fees accrued to this router in `market` and split them.
     *         Anyone may call (permissionless keeper); proceeds only ever route to
     *         treasury/creator/insurance, so there's no incentive to withhold.
     */
    function collect(address market) external nonReentrant returns (uint256 total) {
        if (!isMarket[market]) revert UnknownMarket();
        address token = collateralOf[market];

        // The router is this market's feeReceiver → its accrued fees sit as the
        // router's internal `available` balance in the market. Pull them out.
        (uint256 available, ) = IPerpMarketFees(market).balances(address(this));
        if (available == 0) return 0;

        uint256 balBefore = IERC20(token).balanceOf(address(this));
        IPerpMarketFees(market).withdraw(token, available);
        // Credit only what actually arrived (defensive against fee-on-transfer tokens).
        total = IERC20(token).balanceOf(address(this)) - balBefore;
        if (total == 0) return 0;

        uint256 platform = (total * platformShareBps) / BPS;
        uint256 creatorCut = (total * creatorShareBps) / BPS;
        uint256 insurance = total - platform - creatorCut; // remainder, no dust loss

        address creator = creatorOf[market];
        claimable[treasury][token] += platform;
        claimable[creator][token] += creatorCut;

        // Insurance slice → the market's OWN InsuranceHub sub-account (spec §7). Push it in
        // per-market (approve + pull) rather than crediting a single claimable sink, so each
        // market self-insures in isolation. Platform + creator stay claim-based (pull).
        if (insurance > 0) {
            IERC20(token).forceApprove(insuranceHub, insurance);
            IInsuranceHub(insuranceHub).notifyFee(market, token, insurance);
        }

        emit FeesCollected(market, token, total, platform, creatorCut, insurance);
    }

    /// Pull a beneficiary's accumulated fees for a token.
    function claim(address token) external nonReentrant returns (uint256 amount) {
        amount = claimable[msg.sender][token];
        if (amount == 0) return 0;
        claimable[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, token, amount);
    }
}

/// Minimal surface of a PerpMarket (Settlement) the router needs.
interface IPerpMarketFees {
    function balances(address account) external view returns (uint256 available, uint256 locked);
    function withdraw(address token, uint256 amount) external;
}

/// Minimal surface of the InsuranceHub the router credits per-market.
interface IInsuranceHub {
    function notifyFee(address market, address token, uint256 amount) external;
}
