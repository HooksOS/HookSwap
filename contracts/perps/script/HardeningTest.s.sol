// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/factory/PerpMarket.sol";
import "../src/factory/PerpMarketFactory.sol";
import "../src/factory/FeeRouter.sol";
import "../src/factory/MarketRegistry.sol";
import "../src/factory/OracleGuard.sol";
import "../src/factory/ParamGuard.sol";

interface IAgg {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/**
 * @title HardeningTest
 * @notice Deploys the hardened HookSwapPerps factory stack (OracleGuard + ParamGuard +
 *         PerpMarket-v2 with on-chain per-market leverage) to Sepolia, reusing the EXISTING
 *         FeeRouter + MarketRegistry, and runs on-chain proofs:
 *           - oracle deviation PASS (mark == Chainlink ref), asserted in-simulation;
 *           - leverage PASS @ 10x (real settle tx opens a position).
 *         The REVERT branches (deviation, staleness, venue-allowlist, leverage at 20x) are
 *         proven by cast call / cast send against the deployed contracts + live feed
 *         (see the bash wrapper); this script logs the 20x settleBatch calldata for that.
 *         Oracle deviation PASS asserts mark == ref; leverage PASS opens a 10x position.
 */
contract HardeningTest is Script {
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306; // live Chainlink ETH/USD (Sepolia)
    address constant FEE_ROUTER = 0x493A120cB92d7834dA98A8F1aE1ECF762a9d1A2f; // existing
    address constant MARKET_REGISTRY = 0xEDE278469694e951676973B7b9e193a98463DAC2; // existing

    uint256 constant TRADER_A_PK = uint256(keccak256("hookswap.perps.hardening.traderA.v1"));
    uint256 constant TRADER_B_PK = uint256(keccak256("hookswap.perps.hardening.traderB.v1"));
    address constant INSURANCE_HUB = 0x000000000000000000000000000000000000dEaD; // used only for FeeRouter reuse

    uint256 constant DEPOSIT = 0.003 ether;
    uint256 constant SIZE = 1e16;
    uint256 constant LEV_10X = 10 * 1e4; // 1e5
    uint256 constant LEV_20X = 20 * 1e4; // 2e5
    uint256 constant FEE_RATE = 10;
    uint256 constant MARKET_MAX_LEV = 10 * 1e4; // per-market cap requested = 10x

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerPk);
        address traderA = vm.addr(TRADER_A_PK);
        address traderB = vm.addr(TRADER_B_PK);

        bytes32 CHAINLINK = keccak256("chainlink");

        // Read the live reference price up front (to size the deviation test inputs).
        (, int256 ans,, uint256 upd,) = IAgg(ETH_USD).latestRoundData();
        uint8 fdec = IAgg(ETH_USD).decimals();
        uint256 ref = (uint256(ans) * 1e18) / (10 ** fdec);
        console.log("feed answer", uint256(ans));
        console.log("feed decimals", fdec);
        console.log("feed updatedAt", upd);
        console.log("ref (1e18)", ref);

        vm.startBroadcast(deployerPk);

        // ---- Deploy hardening layers ----
        ParamGuard paramGuard = new ParamGuard(20 * 1e4 /*maxLev 20x*/, 50 /*minMM bps*/, 2 /*minFee*/, 15 /*maxFee*/);
        OracleGuard oracleGuard = new OracleGuard();

        // ---- New PerpMarket impl (with on-chain marketMaxLeverage) + new factory ----
        PerpMarket impl = new PerpMarket();
        PerpMarketFactory factory = new PerpMarketFactory(
            address(impl),
            WETH,
            deployer, // platformMatcher
            deployer, // platformAdmin
            FEE_ROUTER,
            MARKET_REGISTRY,
            deployer, // treasury
            0, // listingFee
            address(oracleGuard),
            address(paramGuard)
        );

        // Repoint existing shared core at the new factory (deployer owns both).
        FeeRouter(FEE_ROUTER).setFactory(address(factory));
        MarketRegistry(MARKET_REGISTRY).setFactory(address(factory));

        // Oracle allowlist: permit the live Chainlink ETH/USD feed as a "chainlink" venue.
        oracleGuard.setFactory(address(factory));
        oracleGuard.setVenue(CHAINLINK, ETH_USD, true);

        // Valid oracle config (permissionless tier => dualSourceRequired + refFeed).
        OracleGuard.OracleConfig memory cfg = OracleGuard.OracleConfig({
            sourceType: CHAINLINK,
            venue: ETH_USD,
            refFeed: ETH_USD,
            maxDeviationBps: 500, // 5%
            maxStaleness: 1 days, // Sepolia feeds can be slow
            minLiquidity: 0,
            dualSourceRequired: true
        });

        // Leverage-test market: requested cap 10x, PERMISSIONLESS tier.
        address levMarket = factory.createMarket(
            WETH, 18, deployer, FEE_RATE, MARKET_MAX_LEV, keccak256("ETH-PERP-LEV10"), 1, cfg
        );

        // Staleness-test market: identical but maxStaleness = 1s → checkDeviation reverts StalePrice.
        OracleGuard.OracleConfig memory staleCfg = cfg;
        staleCfg.maxStaleness = 1;
        address staleMarket = factory.createMarket(
            WETH, 18, deployer, FEE_RATE, MARKET_MAX_LEV, keccak256("ETH-PERP-STALE"), 1, staleCfg
        );

        // Fund traders for their depositETH tx.
        (bool s1,) = payable(traderA).call{value: 0.0033 ether}("");
        require(s1, "fund A");
        (bool s2,) = payable(traderB).call{value: 0.0033 ether}("");
        require(s2, "fund B");

        vm.stopBroadcast();

        console.log("paramGuard", address(paramGuard));
        console.log("oracleGuard", address(oracleGuard));
        console.log("impl", address(impl));
        console.log("factory", address(factory));
        console.log("levMarket", levMarket);
        console.log("staleMarket", staleMarket);
        console.log("traderA", traderA);
        console.log("traderB", traderB);

        // ---- On-chain per-market cap wired correctly ----
        require(PerpMarket(payable(levMarket)).marketMaxLeverage() == MARKET_MAX_LEV, "cap not set");
        require(paramGuard.clampLeverage(50 * 1e4) == 20 * 1e4, "clamp!=20x");

        // ---- Oracle deviation PASS (mark == ref): must NOT revert ----
        oracleGuard.checkDeviation(levMarket, ref);
        console.log("checkDeviation PASS @ ref OK");

        // ---- Oracle deviation REVERT (ref * 1.5): expect PriceDeviationTooLarge ----
        try oracleGuard.checkDeviation(levMarket, (ref * 3) / 2) {
            revert("deviation should have reverted");
        } catch {
            console.log("checkDeviation REVERT @ 1.5x OK");
        }

        // ---- Staleness REVERT (fresh feed but maxStaleness=1): expect StalePrice ----
        try oracleGuard.checkDeviation(staleMarket, ref) {
            revert("staleness should have reverted");
        } catch {
            console.log("checkDeviation staleness REVERT OK");
        }

        // ---- Traders deposit into levMarket ----
        vm.broadcast(TRADER_A_PK);
        PerpMarket(payable(levMarket)).depositETH{value: DEPOSIT}();
        vm.broadcast(TRADER_B_PK);
        PerpMarket(payable(levMarket)).depositETH{value: DEPOSIT}();

        // ---- Build the 10x matched pair (PASS) ----
        PerpMarket.MatchedPair[] memory pass = _pair(levMarket, traderA, traderB, LEV_10X);

        // ---- Build the 20x matched pair (REVERT) + log its settleBatch calldata ----
        PerpMarket.MatchedPair[] memory bad = _pair(levMarket, traderA, traderB, LEV_20X);
        bytes memory cd20 = abi.encodeCall(PerpMarket.settleBatch, (bad));
        console.log("=== 20x settleBatch calldata (cast send to force the revert tx) ===");
        console.logBytes(cd20);

        // ---- Matcher settles the 10x pair: opens a position on-chain ----
        vm.broadcast(deployerPk);
        PerpMarket(payable(levMarket)).settleBatch(pass);

        uint256 pairId = PerpMarket(payable(levMarket)).nextPairId();
        require(pairId == 2, "position not opened @10x"); // nextPairId 1 -> 2 after one open
        PerpMarket.PairedPosition memory pos = PerpMarket(payable(levMarket)).getPairedPosition(1);
        require(pos.longTrader == traderA && pos.shortTrader == traderB, "pair mismatch");
        require(uint8(pos.status) == 0, "pair not ACTIVE");
        console.log("leverage PASS @10x: pair 1 opened, status ACTIVE");
        console.log("ALL IN-SCRIPT ASSERTIONS PASSED");
    }

    function _pair(address market, address a, address b, uint256 lev)
        internal
        view
        returns (PerpMarket.MatchedPair[] memory pairs)
    {
        PerpMarket.Order memory longOrder = PerpMarket.Order({
            trader: a,
            token: WETH,
            isLong: true,
            size: SIZE,
            leverage: lev,
            price: 2000e18,
            deadline: block.timestamp + 1_000_000,
            nonce: 0,
            orderType: PerpMarket.OrderType.MARKET
        });
        PerpMarket.Order memory shortOrder = PerpMarket.Order({
            trader: b,
            token: WETH,
            isLong: false,
            size: SIZE,
            leverage: lev,
            price: 2000e18,
            deadline: block.timestamp + 1_000_000,
            nonce: 0,
            orderType: PerpMarket.OrderType.MARKET
        });
        bytes32 ld = PerpMarket(payable(market)).getOrderHash(longOrder);
        bytes32 sd = PerpMarket(payable(market)).getOrderHash(shortOrder);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(TRADER_A_PK, ld);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(TRADER_B_PK, sd);
        pairs = new PerpMarket.MatchedPair[](1);
        pairs[0] = PerpMarket.MatchedPair({
            longOrder: longOrder,
            longSignature: abi.encodePacked(r1, s1, v1),
            shortOrder: shortOrder,
            shortSignature: abi.encodePacked(r2, s2, v2),
            matchPrice: 2000e18,
            matchSize: SIZE
        });
    }
}
