// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/factory/PerpMarket.sol";
import "../src/factory/PerpMarketFactory.sol";
import "../src/factory/FeeRouter.sol";
import "../src/factory/MarketRegistry.sol";
import "../src/factory/OracleGuard.sol";
import "../src/factory/ParamGuard.sol";
import "../src/factory/BondManager.sol";
import "../src/factory/InsuranceHub.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Minimal Chainlink aggregator surface for reading the live Sepolia ETH/USD reference.
interface IAgg {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/// @dev Minimal WETH9 surface (operator wraps ETH → WETH → funds trader collateral via depositTo).
interface IWETH9 {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/**
 * @title SepoliaFactoryAll
 * @notice ONE-broadcast, on-chain exercise of EVERY self-service FACTORY feature of
 *         HookSwapPerps, deploying a COMPLETELY FRESH, fully-wired factory-v4 stack so
 *         `msg.sender` (the --sender) owns platformAdmin / owner / treasury on every
 *         contract — no reuse of config/*.json addresses, so no ownership reverts.
 *
 *         Fresh stack: MarketRegistry + OracleGuard + ParamGuard + InsuranceHub +
 *         BondManager + FeeRouter + PerpMarket implementation + PerpMarketFactory (v4:
 *         createMarket wires setOracleGuard + setInsuranceFund into the settle path, and
 *         escrows a slashable bond). Single-operator model (mirrors SepoliaLiveSmoke):
 *         the operator funds trader collateral via depositTo() and signs EIP-712 orders
 *         off-chain with vm.sign — no trader tx / no extra private key needed.
 *
 *         Every feature is proven with a `require` (success paths, all inside ONE
 *         vm.startBroadcast so the on-chain broadcast completes) plus a console2.log PROOF
 *         line. Revert branches are proven AFTER vm.stopBroadcast with view calls +
 *         vm.prank + try/catch (never broadcast as txs → they can't abort the broadcast).
 *
 *         Features covered (PROOF labels):
 *           1  createMarket           — clone registered ACTIVE + bond escrowed
 *           2  Fee split              — platform 50% (>=40% floor) / creator 40% / insurance 10%
 *           3  Market isolation       — untraded marketB fee + insurance balances stay 0
 *           4  BondManager            — escrow + slash→treasury delta + withdrawBond too-early revert
 *           5  InsuranceHub           — per-market credit + coverLoss own + cross-market revert
 *           6  OracleGuard            — deviation PASS + deviation/staleness/venue-allowlist reverts
 *           7  ParamGuard             — leverage + fee bound check/clamp
 *           8  Per-market maxLeverage — cap set + settle revert at 20x / pass at 10x + unset to 100x fallback
 *
 * Dry run (NO broadcast — proves compile + simulate; this is what ships):
 *   forge script script/SepoliaFactoryAll.s.sol \
 *     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
 *     --sender 0xDD680933a37b2014a77482Ae51b22B68eD1c2996
 *
 * Real broadcast (operator, funded key):
 *   forge script script/SepoliaFactoryAll.s.sol \
 *     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
 *     --broadcast --private-key <PK>
 */
contract SepoliaFactoryAll is Script {
    // ---- Sepolia canonical addresses (WETH9 + live Chainlink ETH/USD) ----
    address internal constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address internal constant ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    // ---- deterministic throwaway trader keys (sign EIP-712 order digests only; never send a tx) ----
    uint256 internal constant PK_LONG = 0xA11CE;
    uint256 internal constant PK_SHORT = 0xB0B;

    // ---- economics ----
    uint256 internal constant MATCH_SIZE = 1e16; // 0.01 notional per side
    uint256 internal constant FEE_RATE = 10; // 0.10% per side → perSideFee = 1e13
    uint256 internal constant PER_SIDE_FEE = (MATCH_SIZE * FEE_RATE) / 10000; // 1e13
    uint256 internal constant FEE_ACCRUED = PER_SIDE_FEE * 2; // 2e13 to feeReceiver
    uint256 internal constant DEP = 3e15; // per-trader per-market collateral deposit
    uint256 internal constant COVER_AMT = 1e12; // insurance coverLoss test amount

    uint256 internal constant LEV_10X = 10 * 1e4;
    uint256 internal constant LEV_20X = 20 * 1e4;
    uint256 internal constant LEV_50X = 50 * 1e4;

    // ---- tier-aware creation bonds (listingFee = 0, so full msg.value → bond) ----
    uint256 internal constant CURATED_MIN_BOND = 5e13;
    uint256 internal constant PERMISSIONLESS_MIN_BOND = 1e14;
    uint256 internal constant BOND = PERMISSIONLESS_MIN_BOND; // 1e14 per market
    uint8 internal constant TIER = 1; // PERMISSIONLESS

    uint256 internal constant NUM_MARKETS = 5;

    bytes32 internal constant CHAINLINK = keccak256("chainlink");

    // ---- fresh stack (state vars keep run()'s stack shallow) ----
    MarketRegistry internal registry;
    OracleGuard internal oracleGuard;
    ParamGuard internal paramGuard;
    InsuranceHub internal insuranceHub;
    BondManager internal bondManager;
    FeeRouter internal feeRouter;
    PerpMarket internal impl;
    PerpMarketFactory internal factory;

    // ---- markets ----
    address internal marketA; // fee-split / insurance / coverLoss-success / bond escrow
    address internal marketB; // isolation / slash / cross-market coverLoss revert
    address internal marketLev; // per-market cap: revert@20x + pass@10x + withdrawBond too-early
    address internal marketFallback; // unset cap → 100x fallback (settle @50x)
    address internal staleMarket; // staleness revert (maxStaleness = 1)

    // ---- passive sinks / beneficiaries (receive value only; no tx, clean deltas) ----
    address internal creatorA;
    address internal creatorB;
    address internal coverTo;
    address internal bondTreasury; // BondManager slash sink (measured delta)

    uint256 internal refPrice; // live ETH/USD normalized to 1e18 — used as matchPrice everywhere

    function run() external {
        address deployer = msg.sender; // = platformAdmin = owner = matcher = feeRouter.treasury
        creatorA = vm.addr(uint256(keccak256("hookswap.perps.factoryAll.creatorA")));
        creatorB = vm.addr(uint256(keccak256("hookswap.perps.factoryAll.creatorB")));
        coverTo = vm.addr(uint256(keccak256("hookswap.perps.factoryAll.coverTo")));
        bondTreasury = vm.addr(uint256(keccak256("hookswap.perps.factoryAll.bondTreasury")));

        console2.log("=== HookSwapPerps FACTORY all-feature live test (Sepolia-first) ===");
        console2.log("chainId :", block.chainid);
        console2.log("deployer/owner/platformAdmin/matcher:", deployer);
        if (block.chainid != 11155111) {
            console2.log("!! WARNING: not Sepolia (11155111). HookSwap rule: prove on Sepolia FIRST.");
        }

        // Read the LIVE reference price (view) BEFORE broadcasting. matchPrice == ref so the
        // factory-wired OracleGuard deviation breaker (checkDeviation) passes on every settle.
        (, int256 ans,, uint256 upd,) = IAgg(ETH_USD).latestRoundData();
        uint8 fdec = IAgg(ETH_USD).decimals();
        require(ans > 0 && upd != 0, "bad live feed");
        refPrice = (uint256(ans) * 1e18) / (10 ** fdec);
        console2.log("live ETH/USD ref (1e18):", refPrice);

        vm.startBroadcast();

        _deployStack(deployer);
        _createMarkets();

        // ---- FEATURE 1: createMarket registered ACTIVE + bond escrowed ----
        _assertCreateMarket();

        // ---- FEATURE 4a: bond escrow (from createMarket, before any slash) ----
        _assertBondEscrow();

        // Trade marketA once (drives a per-side fee through the FeeRouter).
        _fundMarket(marketA);
        _settle(marketA, LEV_10X);

        // ---- FEATURE 2 + 5(credit): collect + split + per-market insurance credit ----
        _assertFeeSplitAndInsurance();

        // ---- FEATURE 3: market isolation (marketB untouched) ----
        _assertIsolation();

        // ---- FEATURE 5a: coverLoss draws from marketA's OWN sub-account ----
        _coverLossSuccess(deployer);

        // ---- FEATURE 8: per-market maxLeverage — pass@10x + unset→100x fallback ----
        _assertMaxLeverageSuccessPaths();

        // ---- FEATURE 4b: slash marketB's bond → treasury (measured delta) ----
        _slashBond();

        vm.stopBroadcast();

        // ---- Revert branches (view + prank + try/catch — never broadcast) ----
        _assertOracleGuard(deployer);
        _assertParamGuard();
        _assertBondWithdrawTooEarly(deployer);
        _assertCoverLossCrossMarketRevert(deployer);
        _assertMaxLeverageRevert(deployer);

        console2.log("=== ALL FACTORY FEATURES PROVEN ON-CHAIN ===");
    }

    // ============================================================
    // Deploy + wire a FRESH factory-v4 stack (deployer owns everything)
    // ============================================================
    function _deployStack(address deployer) internal {
        registry = new MarketRegistry();
        oracleGuard = new OracleGuard();
        // ParamGuard: maxLev 20x, minMaintenanceMargin 50bps, fee band [2,15] bps.
        paramGuard = new ParamGuard(20 * 1e4, 50, 2, 15);
        insuranceHub = new InsuranceHub();
        // BondManager slash sink = a dedicated passive treasury (clean delta measurement).
        bondManager = new BondManager(bondTreasury, address(registry));
        // FeeRouter platform treasury = deployer (platform share is claim-based storage → no gas noise).
        feeRouter = new FeeRouter(deployer, address(insuranceHub));
        impl = new PerpMarket();
        factory = new PerpMarketFactory(
            address(impl),
            WETH,
            deployer, // platformMatcher (authorized matcher on every market clone)
            deployer, // platformAdmin (receives ownership of every market clone)
            address(feeRouter),
            address(registry),
            deployer, // listing-fee treasury
            0, // listingFee (all msg.value → bond)
            address(oracleGuard),
            address(paramGuard),
            address(bondManager)
        );

        factory.setMinBonds(CURATED_MIN_BOND, PERMISSIONLESS_MIN_BOND);

        // Wire the shared core's factory hooks → this factory (deployer owns all of them).
        feeRouter.setFactory(address(factory));
        registry.setFactory(address(factory));
        oracleGuard.setFactory(address(factory));
        bondManager.setFactory(address(factory));

        // Allowlist the live Chainlink ETH/USD feed as a "chainlink" venue.
        oracleGuard.setVenue(CHAINLINK, ETH_USD, true);

        // Authorize the operator (keeper) to call InsuranceHub.coverLoss.
        insuranceHub.setAuthorizedCoverer(deployer, true);

        console2.log("registry     :", address(registry));
        console2.log("oracleGuard  :", address(oracleGuard));
        console2.log("paramGuard   :", address(paramGuard));
        console2.log("insuranceHub :", address(insuranceHub));
        console2.log("bondManager  :", address(bondManager));
        console2.log("feeRouter    :", address(feeRouter));
        console2.log("impl         :", address(impl));
        console2.log("factory      :", address(factory));
    }

    function _cfg(uint256 maxStaleness) internal pure returns (OracleGuard.OracleConfig memory) {
        return OracleGuard.OracleConfig({
            sourceType: CHAINLINK,
            venue: ETH_USD,
            refFeed: ETH_USD,
            maxDeviationBps: 500, // 5%
            maxStaleness: maxStaleness,
            minLiquidity: 0,
            dualSourceRequired: true // required for the PERMISSIONLESS tier
        });
    }

    function _createMarkets() internal {
        OracleGuard.OracleConfig memory cfg = _cfg(1 days);
        OracleGuard.OracleConfig memory staleCfg = _cfg(1); // maxStaleness = 1s → checkDeviation stale

        marketA = factory.createMarket{value: BOND}(
            WETH, 18, creatorA, FEE_RATE, LEV_10X, keccak256("ETH-PERP-A"), TIER, cfg
        );
        marketB = factory.createMarket{value: BOND}(
            WETH, 18, creatorB, FEE_RATE, LEV_10X, keccak256("ETH-PERP-B"), TIER, cfg
        );
        // marketLev / marketFallback creator = msg.sender so the deployer-pranked withdrawBond
        // proof passes the NotCreator gate and reaches WithdrawTooEarly.
        marketLev = factory.createMarket{value: BOND}(
            WETH, 18, msg.sender, FEE_RATE, LEV_10X, keccak256("ETH-PERP-LEV"), TIER, cfg
        );
        marketFallback = factory.createMarket{value: BOND}(
            WETH, 18, msg.sender, FEE_RATE, LEV_10X, keccak256("ETH-PERP-FALLBACK"), TIER, cfg
        );
        staleMarket = factory.createMarket{value: BOND}(
            WETH, 18, msg.sender, FEE_RATE, LEV_10X, keccak256("ETH-PERP-STALE"), TIER, staleCfg
        );

        console2.log("marketA        :", marketA);
        console2.log("marketB        :", marketB);
        console2.log("marketLev      :", marketLev);
        console2.log("marketFallback :", marketFallback);
        console2.log("staleMarket    :", staleMarket);
    }

    // ============================================================
    // FEATURE 1 — createMarket
    // ============================================================
    function _assertCreateMarket() internal view {
        uint256 idx = registry.indexOf(marketA);
        require(idx != 0, "F1: marketA not registered");
        (address m,, address collateral,,, MarketRegistry.Status status,) = registry.markets(idx - 1);
        require(m == marketA, "F1: registry market mismatch");
        require(collateral == WETH, "F1: registry collateral mismatch");
        require(status == MarketRegistry.Status.ACTIVE, "F1: market not ACTIVE");
        // The clone must be wired: feeReceiver = FeeRouter, oracleGuard set, cap set on-chain.
        require(PerpMarket(payable(marketA)).feeReceiver() == address(feeRouter), "F1: feeReceiver != feeRouter");
        require(PerpMarket(payable(marketA)).oracleGuard() == address(oracleGuard), "F1: oracleGuard not wired");
        require(PerpMarket(payable(marketA)).marketMaxLeverage() == LEV_10X, "F1: cap not set");
        require(registry.marketCount() == NUM_MARKETS, "F1: market count");
        console2.log("PROOF 1 createMarket: marketA ACTIVE in registry, feeReceiver=FeeRouter, oracleGuard wired, cap=10x; markets =", registry.marketCount());
    }

    // ============================================================
    // FEATURE 4a — bond escrow
    // ============================================================
    function _assertBondEscrow() internal view {
        (, uint256 amt, uint64 postedAt, bool slashed, bool withdrawn) = bondManager.bonds(marketA);
        require(amt == BOND, "F4a: bond amount != BOND");
        require(postedAt != 0 && !slashed && !withdrawn, "F4a: bond state");
        require(address(bondManager).balance == NUM_MARKETS * BOND, "F4a: escrow total");
        console2.log("PROOF 4a bond escrow: marketA bond =", amt, "| BondManager escrow total =", address(bondManager).balance);
    }

    // ============================================================
    // Collateral funding (single-operator: wrap WETH → approve → depositTo both traders)
    // ============================================================
    function _fundMarket(address market) internal {
        address long = vm.addr(PK_LONG);
        address short = vm.addr(PK_SHORT);
        uint256 need = DEP * 2;
        IWETH9(WETH).deposit{value: need}();
        IWETH9(WETH).approve(market, need);
        PerpMarket(payable(market)).depositTo(long, WETH, DEP);
        PerpMarket(payable(market)).depositTo(short, WETH, DEP);
    }

    // ============================================================
    // Build + EIP-712 sign a matched long/short pair for `market` at `lev` (matchPrice = ref)
    // ============================================================
    function _pair(address market, uint256 lev) internal view returns (PerpMarket.MatchedPair[] memory pairs) {
        address long = vm.addr(PK_LONG);
        address short = vm.addr(PK_SHORT);
        PerpMarket.Order memory longOrder = PerpMarket.Order({
            trader: long,
            token: WETH,
            isLong: true,
            size: MATCH_SIZE,
            leverage: lev,
            price: refPrice,
            deadline: block.timestamp + 1_000_000,
            nonce: 0,
            orderType: PerpMarket.OrderType.MARKET
        });
        PerpMarket.Order memory shortOrder = PerpMarket.Order({
            trader: short,
            token: WETH,
            isLong: false,
            size: MATCH_SIZE,
            leverage: lev,
            price: refPrice,
            deadline: block.timestamp + 1_000_000,
            nonce: 0,
            orderType: PerpMarket.OrderType.MARKET
        });
        bytes32 lh = PerpMarket(payable(market)).getOrderHash(longOrder);
        bytes32 sh = PerpMarket(payable(market)).getOrderHash(shortOrder);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(PK_LONG, lh);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(PK_SHORT, sh);
        pairs = new PerpMarket.MatchedPair[](1);
        pairs[0] = PerpMarket.MatchedPair({
            longOrder: longOrder,
            longSignature: abi.encodePacked(r1, s1, v1),
            shortOrder: shortOrder,
            shortSignature: abi.encodePacked(r2, s2, v2),
            matchPrice: refPrice,
            matchSize: MATCH_SIZE
        });
    }

    function _settle(address market, uint256 lev) internal returns (uint256 openedPairId) {
        openedPairId = PerpMarket(payable(market)).nextPairId();
        PerpMarket(payable(market)).settleBatch(_pair(market, lev));
    }

    // ============================================================
    // FEATURE 2 + 5(credit) — fee split + per-market insurance credit
    // ============================================================
    function _assertFeeSplitAndInsurance() internal {
        // Fees accrued to the router (feeReceiver == FeeRouter) inside marketA.
        (uint256 availA,) = PerpMarket(payable(marketA)).balances(address(feeRouter));
        require(availA == FEE_ACCRUED, "F2: marketA fee accrual != 2e13");

        uint256 collected = feeRouter.collect(marketA);
        require(collected == FEE_ACCRUED, "F2: collected != 2e13");

        uint256 platform = feeRouter.claimable(msg.sender, WETH); // treasury == deployer
        uint256 creatorCut = feeRouter.claimable(creatorA, WETH);
        uint256 insurance = insuranceHub.balanceOf(marketA, WETH);
        require(platform == 1e13, "F2: platform != 50%");
        require((platform * 10000) / collected >= 4000, "F2: below 40% floor");
        require(creatorCut == 8e12, "F2: creatorA != 40%");
        require(insurance == 2e12, "F2: insurance != 10%");
        require(feeRouter.claimable(creatorB, WETH) == 0, "F2: creatorB earned from A");
        require(IERC20(WETH).balanceOf(address(insuranceHub)) == 2e12, "F5: hub WETH != 2e12");
        console2.log("PROOF 2 fee split: platform(50%) =", platform, "creator(40%) =", creatorCut);
        console2.log("PROOF 2 fee split: insurance(10%) =", insurance, "| floor honored (>=40%): platform bps =", (platform * 10000) / collected);
        console2.log("PROOF 5 credit: insuranceHub.balanceOf(marketA,WETH) =", insurance);
    }

    // ============================================================
    // FEATURE 3 — market isolation
    // ============================================================
    function _assertIsolation() internal view {
        (uint256 availB,) = PerpMarket(payable(marketB)).balances(address(feeRouter));
        require(availB == 0, "F3: marketB fee balance != 0");
        require(insuranceHub.balanceOf(marketB, WETH) == 0, "F3: marketB insurance != 0");
        console2.log("PROOF 3 isolation: untraded marketB feeRouter balance =", availB, "insurance =", insuranceHub.balanceOf(marketB, WETH));
    }

    // ============================================================
    // FEATURE 5a — coverLoss from the market's OWN sub-account
    // ============================================================
    function _coverLossSuccess(address) internal {
        uint256 beforeBal = IERC20(WETH).balanceOf(coverTo);
        insuranceHub.coverLoss(marketA, WETH, COVER_AMT, coverTo);
        require(IERC20(WETH).balanceOf(coverTo) == beforeBal + COVER_AMT, "F5a: coverTo not paid");
        require(insuranceHub.balanceOf(marketA, WETH) == 2e12 - COVER_AMT, "F5a: A sub-account not debited");
        console2.log("PROOF 5a coverLoss(A): paid =", COVER_AMT, "| marketA insurance remaining =", insuranceHub.balanceOf(marketA, WETH));
    }

    // ============================================================
    // FEATURE 8 (success paths) — per-market cap pass@10x + unset→100x fallback @50x
    // ============================================================
    function _assertMaxLeverageSuccessPaths() internal {
        // pass @ 10x on marketLev (cap == 10x): a position opens.
        _fundMarket(marketLev);
        uint256 pid = _settle(marketLev, LEV_10X);
        PerpMarket.PairedPosition memory pos = PerpMarket(payable(marketLev)).getPairedPosition(pid);
        require(pos.status == PerpMarket.PositionStatus.ACTIVE, "F8: 10x pair not ACTIVE");
        require(PerpMarket(payable(marketLev)).marketMaxLeverage() == LEV_10X, "F8: marketLev cap != 10x");
        console2.log("PROOF 8 pass@10x: marketLev cap =", PerpMarket(payable(marketLev)).marketMaxLeverage(), "| pair opened id =", pid);

        // unset → 100x fallback: reset marketFallback cap to 0, settle @ 50x (only valid under the
        // 100x MAX_LEVERAGE fallback; a 50x order would be rejected by any per-market cap <= 20x).
        require(PerpMarket(payable(marketFallback)).marketMaxLeverage() == LEV_10X, "F8: fallback pre-cap != 10x");
        PerpMarket(payable(marketFallback)).setMarketMaxLeverage(0);
        require(PerpMarket(payable(marketFallback)).marketMaxLeverage() == 0, "F8: fallback cap not unset");
        _fundMarket(marketFallback);
        uint256 fpid = _settle(marketFallback, LEV_50X);
        PerpMarket.PairedPosition memory fpos = PerpMarket(payable(marketFallback)).getPairedPosition(fpid);
        require(fpos.status == PerpMarket.PositionStatus.ACTIVE, "F8: 50x fallback pair not ACTIVE");
        console2.log("PROOF 8 fallback: marketFallback cap unset (0) -> 100x default; 50x pair opened id =", fpid);
    }

    // ============================================================
    // FEATURE 4b — slash marketB's bond → treasury (measured delta)
    // ============================================================
    function _slashBond() internal {
        uint256 sinkBefore = bondTreasury.balance;
        uint256 escrowBefore = address(bondManager).balance;
        bondManager.slash(marketB);
        require(bondTreasury.balance == sinkBefore + BOND, "F4b: treasury not credited");
        require(address(bondManager).balance == escrowBefore - BOND, "F4b: escrow not reduced");
        (,,, bool slashed,) = bondManager.bonds(marketB);
        require(slashed, "F4b: bond not marked slashed");
        console2.log("PROOF 4b slash: marketB bond -> treasury delta =", bondTreasury.balance - sinkBefore, "| escrow now =", address(bondManager).balance);
    }

    // ============================================================
    // FEATURE 6 — OracleGuard: deviation PASS + deviation / staleness / venue-allowlist reverts
    // ============================================================
    function _assertOracleGuard(address) internal {
        // PASS: mark == ref → deviation 0.
        oracleGuard.checkDeviation(marketA, refPrice);
        console2.log("PROOF 6 oracle PASS: checkDeviation(marketA, ref) did not revert");

        // REVERT: mark = ref * 1.5 → PriceDeviationTooLarge.
        try oracleGuard.checkDeviation(marketA, (refPrice * 3) / 2) {
            revert("F6: deviation should revert");
        } catch (bytes memory reason) {
            require(bytes4(reason) == OracleGuard.PriceDeviationTooLarge.selector, "F6: wrong deviation revert");
            console2.log("PROOF 6 oracle deviation REVERT: PriceDeviationTooLarge @ 1.5x ref");
        }

        // REVERT: staleMarket has maxStaleness = 1 → the fresh feed round is older than 1s → StalePrice.
        try oracleGuard.checkDeviation(staleMarket, refPrice) {
            revert("F6: staleness should revert");
        } catch (bytes memory reason) {
            require(bytes4(reason) == OracleGuard.StalePrice.selector, "F6: wrong staleness revert");
            console2.log("PROOF 6 oracle staleness REVERT: StalePrice (maxStaleness=1)");
        }

        // REVERT: a config on a non-allowlisted venue → VenueNotAllowed.
        OracleGuard.OracleConfig memory badCfg = _cfg(1 days);
        badCfg.venue = address(0xBAD);
        try oracleGuard.validateConfig(badCfg, TIER) {
            revert("F6: venue allowlist should revert");
        } catch (bytes memory reason) {
            require(bytes4(reason) == OracleGuard.VenueNotAllowed.selector, "F6: wrong venue revert");
            console2.log("PROOF 6 oracle venue REVERT: VenueNotAllowed for un-allowlisted venue");
        }
    }

    // ============================================================
    // FEATURE 7 — ParamGuard leverage + fee bounds (check/clamp; the guard clamps, the on-chain
    //             *revert* manifests downstream as the per-market cap proven in FEATURE 8)
    // ============================================================
    function _assertParamGuard() internal view {
        // Leverage bound = 20x.
        require(paramGuard.checkLeverage(15 * 1e4), "F7: 15x should pass bound");
        require(!paramGuard.checkLeverage(25 * 1e4), "F7: 25x should fail bound");
        require(paramGuard.clampLeverage(25 * 1e4) == 20 * 1e4, "F7: clampLeverage != 20x");
        // Fee band = [2,15] bps.
        require(paramGuard.checkFee(10), "F7: fee 10 should pass band");
        require(!paramGuard.checkFee(20), "F7: fee 20 should fail band");
        require(paramGuard.clampFee(20) == 15, "F7: clampFee high != 15");
        require(paramGuard.clampFee(1) == 2, "F7: clampFee low != 2");
        console2.log("PROOF 7 paramGuard: leverage bound 20x (15x pass / 25x fail / clamp 25x->20x); fee band [2,15] (10 pass / 20 fail / clamp 20->15,1->2)");
    }

    // ============================================================
    // FEATURE 4c — withdrawBond before the 7-day delay reverts WithdrawTooEarly
    // ============================================================
    function _assertBondWithdrawTooEarly(address deployer) internal {
        // marketLev creator == deployer, so the deployer-pranked call passes NotCreator and hits
        // the WithdrawTooEarly gate (bond posted this run; withdrawDelay = 7 days).
        vm.prank(deployer);
        try bondManager.withdrawBond(marketLev) {
            revert("F4c: withdrawBond should revert");
        } catch (bytes memory reason) {
            require(bytes4(reason) == BondManager.WithdrawTooEarly.selector, "F4c: wrong revert (expected WithdrawTooEarly)");
            console2.log("PROOF 4c withdrawBond: reverts WithdrawTooEarly before 7-day delay");
        }
    }

    // ============================================================
    // FEATURE 5b — cross-market coverLoss reverts InsufficientMarketInsurance
    // ============================================================
    function _assertCoverLossCrossMarketRevert(address deployer) internal {
        // marketB has an empty sub-account (never traded) and no backstop → cannot cover.
        vm.prank(deployer);
        try insuranceHub.coverLoss(marketB, WETH, COVER_AMT, coverTo) {
            revert("F5b: cross-market coverLoss should revert");
        } catch (bytes memory reason) {
            require(
                bytes4(reason) == InsuranceHub.InsufficientMarketInsurance.selector,
                "F5b: wrong revert (expected InsufficientMarketInsurance)"
            );
            console2.log("PROOF 5b coverLoss(B): reverts InsufficientMarketInsurance (per-market isolation)");
        }
    }

    // ============================================================
    // FEATURE 8 (revert path) — settle @20x on marketLev (cap == 10x) reverts LeverageTooHigh
    // ============================================================
    function _assertMaxLeverageRevert(address deployer) internal {
        // deployer is the authorized matcher; the 20x order exceeds marketLev's 10x on-chain cap.
        PerpMarket.MatchedPair[] memory bad = _pair(marketLev, LEV_20X);
        vm.prank(deployer);
        try PerpMarket(payable(marketLev)).settleBatch(bad) {
            revert("F8: 20x settle should revert");
        } catch (bytes memory reason) {
            require(bytes4(reason) == PerpMarket.LeverageTooHigh.selector, "F8: wrong revert (expected LeverageTooHigh)");
            console2.log("PROOF 8 revert@20x: marketLev (cap 10x) settleBatch reverts LeverageTooHigh");
        }
    }
}
