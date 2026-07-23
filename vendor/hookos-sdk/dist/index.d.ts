import { Address, Hash, Hex, PublicClient, WalletClient } from 'viem';

/**
 * Supported HookOS chain IDs.
 * The protocol is LIVE on all seven:
 *   8453 Base · 4663 Robinhood · 4326 MegaETH · 999 HyperEVM · 56 BNB Chain · 1 Ethereum ·
 *   988 Stable (V3-only).
 */
type ChainId = 8453 | 4663 | 4326 | 999 | 56 | 1 | 988;
interface ContractAddresses {
    tokenFactory: Address;
    hookRegistry: Address;
    hookManager: Address;
    feeRouter: Address;
    arena: Address;
    events: Address;
    bondingCurve: Address;
    swapRouter: Address;
    poolFactory: Address;
    hookRevenueVault: Address;
    hookOsNft: Address;
    hookLicenseNft: Address;
    battlePass: Address;
    questSystem: Address;
    clanSystem: Address;
    launchWars: Address;
    reputationSystem: Address;
    arenaV2: Address;
    analyticsEmitter: Address;
    launchController: Address;
    donationRouter: Address;
    extensionRegistry: Address;
    /** FeedBoostAuction — on-chain feed boost slot auction (v2). */
    feedBoostAuction: Address;
}
/**
 * Canonical per-chain contract addresses, sourced from
 * `contracts/deployments/addresses.json` (the single source of truth,
 * keyed by chainId). The 0x000…000 zero address means NOT DEPLOYED on
 * that chain. Base (8453) is the primary chain.
 */
declare const ADDRESSES: Record<ChainId, ContractAddresses>;
/**
 * HookOS V3 — direct-to-Uniswap-v3 (and HookSwap / PancakeSwap V3) fair launches + the
 * buyback-and-burn flywheel. This alternate launch mode is now LIVE on ALL SEVEN HookOS chains
 * (Base, BNB, Ethereum, MegaETH, HyperEVM, Robinhood, Stable) — see {@link HOOKOS_V3_ADDRESSES_BY_CHAIN}
 * and {@link getHookOSV3Addresses}. `buyback`/`hook` are Robinhood-only ($HOOK lives on RH); on
 * the other chains they are the zero address. See V3-LAUNCH-BUYBACK-FLYWHEEL.md.
 */
interface HookOSV3Addresses {
    /** HookOSV3Launcher — deploys a token and single-sided-seeds 100% of supply into a v3 pool. */
    launcher: Address;
    /** HookOSV3FeeVault — permanent LP custodian + creator/protocol fee splitter. */
    feeVault: Address;
    /** HookOSV3Buyback — WETH -> buy $HOOK -> burn (the flywheel sink). */
    buyback: Address;
    /** WETH9 — the default pair currency (always token1) on Robinhood. */
    weth: Address;
    /** $HOOK — the alternate pair currency (gated OFF at v1) and the buyback's burn target. */
    hook: Address;
}
/** The origin chain HookOS V3 shipped on first (still a convenience reference — V3 is now
 *  live on all six chains; see {@link HOOKOS_V3_ADDRESSES_BY_CHAIN}). */
declare const HOOKOS_V3_CHAIN_ID: 4663;
/**
 * Canonical per-chain HookOS V3 addresses, sourced from `contracts/deployments/addresses.json`.
 * The `launcher` (HookOSV3Launcher) + `feeVault` (HookOSV3FeeVault) are live on every chain; the
 * `buyback` flywheel + `hook` ($HOOK) exist only on Robinhood (4663). `weth` is the canonical
 * wrapped-native pair currency per chain (WHYPE on HyperEVM, WBNB on BNB). A zero `launcher`
 * means V3 is NOT deployed on that chain.
 */
declare const HOOKOS_V3_ADDRESSES_BY_CHAIN: Record<number, HookOSV3Addresses>;
/**
 * Canonical HookOS V3 addresses on Robinhood Chain (4663) — kept for backward compatibility.
 * Prefer {@link getHookOSV3Addresses} for multi-chain resolution.
 */
declare const HOOKOS_V3_ADDRESSES: HookOSV3Addresses;
/** Chain IDs where a HookOS V3 direct-to-DEX launch is live, in preferred order. */
declare const HOOKOS_V3_SUPPORTED_CHAIN_IDS: number[];
/**
 * Resolve HookOS V3 addresses for a chain. Returns `null` when V3 is not deployed there
 * (so callers can throw a clear error instead of pointing at a dead address).
 */
declare function getHookOSV3Addresses(chainId: number): HookOSV3Addresses | null;
/**
 * Addresses for the stock-reward launch mechanic — a taxed fair launch whose 2–5% buy/sell tax
 * is converted to REAL tokenized stocks (NVDA / AAPL / TSLA / a basket) and dripped to holders.
 * Robinhood-only. `launcherV4` is the WETH-paired, hook-taxed, direct-to-v4 launcher (preferred);
 * `launcherV2` is the legacy direct-to-v3 path. `bondingCurve` is the live native/USD keeper the
 * seed price is read from. Zero addresses mean the suite is not deployed on that chain.
 */
interface StockRewardAddresses {
    /** StockRewardLauncherV4 — WETH-paired, hook-taxed, direct-to-Uniswap-v4 (preferred). */
    launcherV4: Address;
    /** StockRewardLauncherV2 — legacy token-taxed, direct-to-Uniswap-v3 path. */
    launcherV2: Address;
    /** StockRewardVault — tax sink; buys stock, funds epoch payouts, holds the reward basket. */
    vault: Address;
    /** MerkleStockDistributor — per-epoch, Merkle-proof-gated stock payouts to holders. */
    distributor: Address;
    /** StockTaxHook — the v4 beforeSwap/afterSwap hook that charges the tax in WETH (V4 path). */
    taxHook: Address;
    /** WethUsdAggregatorAdapter — Chainlink-shaped WETH/USD feed the vault prices stock buys against. */
    wethUsdAdapter: Address;
    /** WETH — the pool pair currency. */
    weth: Address;
    /** BondingCurve — the live native/USD keeper the seed price is read from (fail-closed on stale). */
    bondingCurve: Address;
}
/** The chain the stock-reward mechanic ships on (USDG-settled tokenized stocks). */
declare const STOCK_REWARD_CHAIN_ID: 4663;
/** Canonical stock-reward suite addresses on Robinhood Chain (4663). LIVE. */
declare const STOCK_REWARD_ADDRESSES: StockRewardAddresses;
/**
 * Resolve stock-reward addresses for a chain. Returns `null` where the suite is not deployed
 * (only Robinhood 4663 today).
 */
declare function getStockRewardAddresses(chainId: number): StockRewardAddresses | null;
/**
 * Addresses for the RHLaunchpad direct-to-v4 "quick launch" — the fair, straight-to-Uniswap-v4,
 * no-bonding-curve memecoin path. Robinhood-only. Zero addresses mean it is not deployed there.
 */
interface QuickLaunchAddresses {
    /** RHLaunchpad — the orchestrator that deploys token + v4 pool + concentrated liquidity in one tx. */
    launchpad: Address;
    /** LaunchHook — the shared, permissionless v4 hook attached to every RHLaunchpad pool. */
    launchHook: Address;
    /** WETH — the pool pair currency. */
    weth: Address;
    /** BondingCurve — the live native/USD keeper the seed price + USD-pegged launch fee derive from. */
    bondingCurve: Address;
}
/** The chain quick launch (RHLaunchpad) ships on. */
declare const QUICK_LAUNCH_CHAIN_ID: 4663;
/** Canonical RHLaunchpad quick-launch addresses on Robinhood Chain (4663). LIVE. */
declare const QUICK_LAUNCH_ADDRESSES: QuickLaunchAddresses;
/**
 * Resolve quick-launch (RHLaunchpad) addresses for a chain. Returns `null` where RHLaunchpad
 * is not deployed (only Robinhood 4663 today).
 */
declare function getQuickLaunchAddresses(chainId: number): QuickLaunchAddresses | null;
/**
 * Get contract addresses for a specific chain.
 * Defaults to Base (8453) if the chain is not supported.
 */
declare function getAddresses(chainId?: number): ContractAddresses;

/**
 * All TypeScript types for the HookOS SDK.
 */

interface TxResult {
    hash: Hash;
    blockNumber: bigint;
    gasUsed: bigint;
}
interface CreateTokenParams {
    name: string;
    symbol: string;
    initialSupply: bigint;
    metadataURI: string;
    /** Override the launch fee (in wei). If omitted, on-chain launchFee is queried. */
    value?: bigint;
    /**
     * Graduation target for the atomic curve seed. `true` (default) graduates to external
     * Uniswap v4 (matches the app's launch wizard); `false` uses the internal HookPool.
     * The token is seeded on the bonding curve either way — this only sets where it graduates.
     */
    useExternalDex?: boolean;
}
interface TokenInfo {
    tokenAddress: Address;
    creator: Address;
    name: string;
    symbol: string;
    initialSupply: bigint;
    launchFee: bigint;
    createdAt: number;
}
interface TokenCreateResult {
    tokenAddress: Address;
    txResult: TxResult;
}
interface CurveState {
    token: Address;
    creator: Address;
    virtualTokenReserve: bigint;
    virtualEthReserve: bigint;
    tokensSold: bigint;
    ethCollected: bigint;
    totalSupply: bigint;
    graduated: boolean;
    pool: Address;
    createdAt: number;
    useExternal: boolean;
    /** v2: per-curve virtual ETH seed used for USD-pegged pricing. */
    virtualEthSeed: bigint;
    /** v2: native-currency graduation threshold derived from the USD target. */
    graduationEth: bigint;
}
interface BuyQuote {
    tokensOut: bigint;
}
interface SellQuote {
    ethOut: bigint;
}
interface TradeResult {
    txResult: TxResult;
}
declare enum HookPoint {
    BeforeSwap = 0,
    AfterSwap = 1,
    BeforeAddLiquidity = 2,
    AfterAddLiquidity = 3,
    BeforeRemoveLiquidity = 4,
    AfterRemoveLiquidity = 5
}
interface RegisterHookParams {
    name: string;
    category: string;
    metadataURI: string;
    implementation: Address;
    /** Override the registration fee (in wei). If omitted, on-chain fee is queried. */
    value?: bigint;
}
interface HookInfo {
    hookId: Hash;
    author: Address;
    implementation: Address;
    name: string;
    category: string;
    metadataURI: string;
    installs: bigint;
    totalRating: bigint;
    ratingCount: bigint;
    revenue: bigint;
    verified: boolean;
    active: boolean;
    createdAt: number;
    averageRating: number;
}
interface HookBinding {
    hookId: Hash;
    hookImpl: Address;
    hookPoint: HookPoint;
    active: boolean;
    gasLimit: bigint;
    attachedAt: number;
}
interface AttachHookParams {
    token: Address;
    hookId: Hash;
    hookImpl: Address;
    hookPoint: HookPoint;
    gasLimit?: bigint;
}
interface DetachHookParams {
    token: Address;
    hookId: Hash;
}
interface HookBrowseFilters {
    category?: string;
    verified?: boolean;
    active?: boolean;
    author?: Address;
}
declare enum BattleStatus {
    Open = 0,
    Active = 1,
    Settled = 2,
    Cancelled = 3
}
declare enum Side {
    TeamA = 0,
    TeamB = 1
}
interface CreateBattleParams {
    tokenA: Address;
    tokenB: Address;
    minWager: bigint;
    maxWager: bigint;
    startTime: number;
    endTime: number;
}
interface BattleInfo {
    tokenA: Address;
    tokenB: Address;
    pot: bigint;
    teamAPot: bigint;
    teamBPot: bigint;
    minWager: bigint;
    maxWager: bigint;
    startTime: number;
    endTime: number;
    round: number;
    status: BattleStatus;
    winner: Side;
}
interface WagerParams {
    battleId: number;
    side: Side;
    value: bigint;
}
interface FeeShare {
    wallet: Address;
    shareBps: bigint;
    label: string;
}
declare enum EventStatus {
    Upcoming = 0,
    Live = 1,
    Ended = 2,
    Cancelled = 3
}
interface EventInfo {
    name: string;
    category: string;
    metadataURI: string;
    prizePool: bigint;
    entryFee: bigint;
    maxPlayers: bigint;
    playerCount: bigint;
    startTime: number;
    endTime: number;
    season: number;
    status: EventStatus;
}
/** A feed-boost auction slot, as returned by `getSlot`. */
interface SlotInfo {
    slotType: number;
    name: string;
    active: boolean;
    /** Configured (native) minimum bid, before USD pegging. */
    minBid: bigint;
    /** Current top token holding the slot (zero address if none). */
    topToken: Address;
    /** Current winning bid (in wei). */
    currentBid: bigint;
    /** Unix timestamp at which the current boost expires. */
    expiry: number;
}
/** Static config for a slot, as returned by `getSlotConfig`. */
interface SlotConfig {
    minBid: bigint;
    minIncrement: bigint;
    duration: bigint;
}
/** Live boost occupying a slot, as returned by `getActiveBoosts`. */
interface ActiveBoost {
    token: Address;
    bidder: Address;
    bid: bigint;
    startTime: number;
    expiry: number;
}
/** Params for placing a single feed-boost bid. */
interface PlaceBidParams {
    token: Address;
    slotType: number;
    /** Bid value in wei (sent as msg.value). */
    value: bigint;
}
/** Params for placing à la carte bids across multiple slots in one tx. */
interface PlaceBidBatchParams {
    token: Address;
    slots: number[];
    /** Per-slot bid amounts (in wei). Their sum should equal the tx value. */
    amounts: bigint[];
    /** Total value in wei (sent as msg.value). Defaults to sum(amounts). */
    value?: bigint;
}
/** Which Uniswap-v3-style DEX a HookOS V3 launch's pool lives on. Immutable per launch. */
declare enum V3Dex {
    /** Official Uniswap v3 on Robinhood. Creator/protocol LP-fee split = 50/50. */
    UniswapV3 = 0,
    /** HookSwap (a v3 fork). Creator/protocol LP-fee split = 70/30 (launch incentive). */
    HookSwap = 1
}
/** The currency a HookOS V3 launch pool is denominated in. WETH is the only value at v1. */
declare enum V3PairToken {
    /** WETH — the default (and, at v1, only enabled) pair currency. */
    WETH = 0,
    /** $HOOK — gated OFF at v1 (reverts until an admin enables it + depth gate passes). */
    HOOK = 1
}
/**
 * The on-chain `HookOSV3Launcher.LaunchParams` tuple. Prefer {@link V3BuildLaunchOptions} +
 * `v3.buildLaunchParams(...)` (which mines the CREATE2 salt for you) over hand-building this.
 */
interface V3LaunchParams {
    name: string;
    symbol: string;
    metadataURI: string;
    /** 18-dec whole supply — ALL of it is single-sided-seeded (fair launch, zero creator alloc). */
    totalSupply: bigint;
    /** CREATE2 salt, mined off-chain so the token address sorts below the pair (token == token0). */
    salt: Hex;
    /** ADVISORY ONLY — ignored on-chain; price derives from `tickLower`. */
    sqrtPriceX96: bigint;
    tickLower: number;
    tickUpper: number;
    /** Optional dev buy funded from msg.value (0 = none). */
    initialBuyEth: bigint;
    /** REQUIRED (> 0) whenever `initialBuyEth` > 0 — never 0-slippage. */
    initialBuyMinOut: bigint;
    /** 0 => block.timestamp. */
    initialBuyDeadline: bigint;
    dex: V3Dex;
    pair: V3PairToken;
    /** Opt into HookSwap's public Position Locker (pays its flat lockFee on top of the launch fee). */
    lockOnHookSwap: boolean;
}
/** High-level options for {@link V3LaunchModule.buildLaunchParams} — the salt is mined for you. */
interface V3BuildLaunchOptions {
    name: string;
    symbol: string;
    metadataURI?: string;
    totalSupply: bigint;
    tickLower: number;
    tickUpper: number;
    /**
     * The launch creator — a constructor arg of the deployed token, so it is part of the
     * CREATE2 init code and MUST match the wallet that will send `launch()`.
     */
    creator: Address;
    initialBuyEth?: bigint;
    initialBuyMinOut?: bigint;
    initialBuyDeadline?: bigint;
    dex?: V3Dex;
    pair?: V3PairToken;
    lockOnHookSwap?: boolean;
    /** Advisory only — the launcher ignores it. Defaults to 1<<96. */
    sqrtPriceX96?: bigint;
    /** Max salt candidates to try while mining token0-ness. Default 500_000. */
    saltLimit?: number;
}
/** Result of {@link V3LaunchModule.buildLaunchParams}. */
interface V3BuildLaunchResult {
    /** The ready-to-send `launch()` tuple. */
    params: V3LaunchParams;
    /** The CREATE2 address the launch will deploy (== token0). */
    predictedToken: Address;
    /** The mined salt (also inside `params`). */
    salt: Hex;
}
/** Result of {@link V3LaunchModule.mineSalt}. */
interface V3MineSaltResult {
    salt: Hex;
    token: Address;
}
/** Result of a completed {@link V3LaunchModule.launch}, parsed from the `PoolSeeded` event. */
interface V3LaunchResult {
    token: Address;
    pool: Address;
    tokenId: bigint;
    txResult: TxResult;
}
/** A single HookOS V3 launch record, as returned by `getLaunch` / `getLaunchByToken`. */
interface V3LaunchInfo {
    token: Address;
    pool: Address;
    creator: Address;
    tokenId: bigint;
    feeTier: number;
    dex: V3Dex;
    /** Zero address = the LP position is held directly by the fee vault (no locker upsell). */
    locker: Address;
    pair: V3PairToken;
    pairToken: Address;
    metadataURI: string;
    createdAt: number;
}
interface IndexerToken {
    address: Address;
    name: string;
    symbol: string;
    creator: Address;
    totalSupply: string;
    createdAt: number;
    graduated: boolean;
    price?: string;
    marketCap?: string;
    volume24h?: string;
    holders?: number;
    curveProgress?: number;
}
interface IndexerHook {
    hookId: string;
    name: string;
    category: string;
    author: Address;
    installs: number;
    averageRating: number;
    verified: boolean;
}
interface IndexerStats {
    totalTokens: number;
    totalVolume: string;
    totalHooks: number;
    totalFees: string;
    totalBattles: number;
    activeUsers24h: number;
}
interface TokenListParams {
    sort?: "volume" | "price" | "newest" | "holders" | "marketCap";
    filter?: "all" | "trending" | "graduated" | "onCurve" | "new";
    limit?: number;
    offset?: number;
}
interface PriceUpdate {
    token: Address;
    price: string;
    timestamp: number;
}
interface Candle {
    timestamp: number;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
}
type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
/** Output of `computeV3FairLaunchParams` (fee-tier-aware; HookOSV3Launcher + StockRewardLauncherV4). */
interface V3FairLaunchParams {
    sqrtPriceX96: bigint;
    tickLower: number;
    tickUpper: number;
    feeTier: number;
    tickSpacing: number;
    seedTick: number;
    /** MCap implied by the tick the pool actually opens at (not the requested target). */
    derivedMcapUsd: number;
}
/** Output of `computeFairLaunchParams` (spacing 60; RHLaunchpad direct-to-v4 quick launch). */
interface FairLaunchParams {
    sqrtPriceX96: bigint;
    tickLower: number;
    tickUpper: number;
    /** Single-sided liquidity holding the full supply (RHLaunchpad.launch takes this explicitly). */
    liquidityDelta: bigint;
    seedTick: number;
    derivedMcapUsd: number;
}
/** How the creator picks which tokenized stock(s) holders earn. */
declare enum RewardMode {
    /** Single stock — 100% of the holder pool buys one stock. */
    Single = "single",
    /** Custom weighted basket — the creator sets each stock's % (must sum to 100). */
    Basket = "basket",
    /** Index — every picked stock gets an equal weight (auto-balanced). */
    Index = "index"
}
/** A selectable reward stock (tokenized ERC-8056 stock + its Chainlink USD feed). */
interface StockRef {
    symbol: string;
    name: string;
    /** Tokenized-stock ERC-20 address on Robinhood. */
    token: Address;
    /** Chainlink USD feed (8dp) bound to this stock. */
    feed: Address;
    /** True when a live on-chain Uniswap-V3 pool exists (buyable today; else RFQ-only for now). */
    liquidity: boolean;
}
/** Preview of how one side's tax (bps of volume) splits between the flat cuts + holders. */
interface FeeSplitPreview {
    taxBps: number;
    creatorBps: number;
    flywheelBps: number;
    platformBps: number;
    holdersBps: number;
}
/** An on-chain reward-basket entry — stock + weight in bps (all entries MUST sum to 10000). */
interface StockBasketEntry {
    stock: Address;
    weightBps: number;
}
/** The REAL 17-field `StockRewardLauncherV4.LaunchParams` tuple (WETH-paired, hook-taxed v4). */
interface StockLaunchParamsV4 {
    name: string;
    symbol: string;
    supply: bigint;
    creatorAmount: bigint;
    sqrtPriceX96: bigint;
    tickLower: number;
    tickUpper: number;
    fee: number;
    tickSpacing: number;
    admin: Address;
    creator: Address;
    buyBps: number;
    sellBps: number;
    guardWindowSecs: bigint;
    initialBuyEth: bigint;
    initialBuyMinOut: bigint;
    initialBuyLimitSqrtPriceX96: bigint;
}
/** The REAL 15-field `StockRewardLauncherV2.LaunchParams` tuple (legacy token-taxed v3). */
interface StockLaunchParamsV2 {
    name: string;
    symbol: string;
    supply: bigint;
    creatorAmount: bigint;
    tickLower: number;
    tickUpper: number;
    admin: Address;
    creator: Address;
    vault: Address;
    buyBps: number;
    sellBps: number;
    dex: number;
    initialBuyEth: bigint;
    initialBuyMinOut: bigint;
    initialBuyDeadline: bigint;
}
/** High-level options for `StockRewardModule.launch` — the module computes ticks/sqrtPrice + sends. */
interface StockLaunchOptions {
    name: string;
    symbol: string;
    /** Plain token count (not wei) — the FULL supply, all of which seeds the pool. */
    supplyTokens: bigint;
    /** Final token DEFAULT_ADMIN (rescue authority). Defaults to `creator`. */
    admin?: Address;
    /** Pool creator / hook tax authority. Defaults to the wallet account. */
    creator?: Address;
    /** Buy tax in bps (200–500). Default 400. */
    buyBps?: number;
    /** Sell tax in bps (200–500). Default 400. */
    sellBps?: number;
    /** Target opening market cap in USD (whole dollars). Default STOCK_TARGET_MCAP_USD. */
    targetMcapUsd?: bigint;
    /** Optional atomic dev buy (in ether). Requires a safe min-out — derived if omitted. */
    devBuyEth?: number;
    /** Sniper-guard window (seconds, ≤ 1h on-chain). Default STOCK_V4_GUARD_WINDOW_SECS. */
    guardWindowSecs?: bigint;
    /** DEX for the legacy V2 path (0 = UniswapV3, 1 = HookSwap). Ignored on V4. */
    dex?: number;
    /** Force the legacy V2 (token-taxed v3) path. Default: V4 when deployed. */
    useV2?: boolean;
}
/** Result of a completed stock-reward launch (parsed from the `Launched` event). */
interface StockLaunchResult {
    token: Address;
    /** v4 poolId (bytes32) on the V4 path, or the v3 pool address on the V2 path. */
    pool: Hash | Address;
    /** V4 only — the seeded LP position id. */
    positionId?: bigint;
    seededToPool: bigint;
    toCreator: bigint;
    txResult: TxResult;
}
/** A published MerkleStockDistributor epoch. */
interface StockEpoch {
    epoch: number;
    stock: Address;
    root: Hash;
    totalAmount: bigint;
    claimedAmount: bigint;
    createdAt: number;
    claimDeadline: number;
    closed: boolean;
}
/** Params for a Merkle-proof-gated stock reward claim. The `proof` comes from the keeper/indexer. */
interface StockClaimParams {
    epoch: bigint;
    stock: Address;
    amount: bigint;
    proof: Hash[];
    /** Claim on behalf of `account` (uses `claimFor`); defaults to the wallet account (`claim`). */
    account?: Address;
}
/** High-level options for `QuickLaunchModule.launch`. */
interface QuickLaunchOptions {
    name: string;
    symbol: string;
    /** Plain token count (not wei) — the FULL supply, all of which seeds the pool. */
    supplyTokens: bigint;
    /** Target opening market cap in USD (whole dollars). Default QUICK_LAUNCH_TARGET_MCAP_USD. */
    targetMcapUsd?: bigint;
}
/** Result of a completed quick launch (parsed from the `TokenCreated` event). */
interface QuickLaunchResult {
    token: Address;
    /** MCap implied by the tick the pool actually opened at. */
    derivedMcapUsd: number;
    txResult: TxResult;
}
/** The computed, ready-to-send RHLaunchpad `launch()` args (before sending). */
interface QuickLaunchBuildResult {
    /** The CREATE address the launch will deploy the token at. */
    predictedToken: Address;
    /** Whether the predicted token sorts below WETH (token == currency0). */
    tokenIsZero: boolean;
    /** The USD-pegged native launch fee (msg.value) at the live keeper price. */
    launchFee: bigint;
    /** The computed seed geometry. */
    params: FairLaunchParams;
}
/** Result of a `QuickLaunchModule.devBuy` swap. */
interface DevBuyResult {
    txResult: TxResult;
    boughtAmount: bigint;
}

declare class TokenModule {
    private readonly address;
    private readonly publicClient;
    private readonly walletClient?;
    constructor(address: Address, publicClient: PublicClient, walletClient?: WalletClient | undefined);
    /**
     * Get the total number of tokens created via the factory.
     */
    getCount(): Promise<bigint>;
    /**
     * Get the current launch fee (in wei).
     */
    getLaunchFee(): Promise<bigint>;
    /**
     * Get the configured launch fee in USD (1e18-scaled). v2 USD-pegging.
     * On non-ETH chains the effective native fee tracks this USD value at the live price.
     */
    getLaunchFeeUsd(): Promise<bigint>;
    /**
     * Get the effective launch fee in native currency (wei), derived from the USD
     * target at the live native/USD price. This is the amount `create()` must send.
     * v2 — prefer this over the legacy fixed `launchFee`.
     */
    getEffectiveLaunchFee(): Promise<bigint>;
    /**
     * Get the number of tokens created by a specific address.
     */
    getCreatorCount(creator: Address): Promise<bigint>;
    /**
     * Get the token address at a specific index in the factory.
     */
    getTokenAddress(index: bigint): Promise<Address>;
    /**
     * Fetch token info by its deployed address.
     */
    get(tokenAddress: Address): Promise<TokenInfo>;
    /**
     * Fetch all tokens registered in the factory.
     * Optionally limit the number of tokens to fetch.
     */
    list(limit?: number): Promise<TokenInfo[]>;
    /**
     * Check if the factory contract is paused.
     */
    isPaused(): Promise<boolean>;
    /**
     * Create a new HookOS token via the TokenFactory.
     * Requires a wallet client. If `params.value` is not set, the on-chain `launchFee` is queried.
     */
    create(params: CreateTokenParams): Promise<TokenCreateResult>;
}

declare class HookModule {
    private readonly registryAddress;
    private readonly managerAddress;
    private readonly publicClient;
    private readonly walletClient?;
    constructor(registryAddress: Address, managerAddress: Address, publicClient: PublicClient, walletClient?: WalletClient | undefined);
    /**
     * Get the total number of registered hooks.
     */
    getCount(): Promise<bigint>;
    /**
     * Get the current registration fee (in wei).
     */
    getRegistrationFee(): Promise<bigint>;
    /**
     * Get the configured hook registration fee in USD (1e18-scaled). v2 USD-pegging.
     */
    getRegistrationFeeUsd(): Promise<bigint>;
    /**
     * Get the effective registration fee in native currency (wei), derived from the
     * USD target at the live native/USD price. This is the amount `register()` must send.
     * v2 — prefer this over the legacy fixed `registrationFee`.
     */
    getEffectiveRegistrationFee(): Promise<bigint>;
    /**
     * Get detailed info for a specific hook by its hookId.
     */
    get(hookId: Hash): Promise<HookInfo>;
    /**
     * Get the hookId at a specific index.
     */
    getHookId(index: bigint): Promise<Hash>;
    /**
     * Browse all registered hooks with optional filters.
     */
    browse(filters?: HookBrowseFilters): Promise<HookInfo[]>;
    /**
     * List all active hook bindings for a given token.
     */
    listBindings(token: Address): Promise<HookBinding[]>;
    /**
     * Check if a token has a specific hook attached.
     */
    hasHook(token: Address, hookId: Hash): Promise<boolean>;
    /**
     * Register a new hook in the HookRegistry.
     * Requires a wallet client. Returns the generated hookId.
     */
    register(params: RegisterHookParams): Promise<Hash>;
    /**
     * Attach a hook to a token via the HookManager.
     */
    attach(params: AttachHookParams): Promise<TxResult>;
    /**
     * Detach a hook from a token.
     */
    detach(params: DetachHookParams): Promise<TxResult>;
}

declare class ArenaModule {
    private readonly address;
    private readonly publicClient;
    private readonly walletClient?;
    constructor(address: Address, publicClient: PublicClient, walletClient?: WalletClient | undefined);
    /**
     * Get the total number of battles created.
     */
    getCount(): Promise<bigint>;
    /**
     * Get the protocol fee in basis points.
     */
    getProtocolFeeBps(): Promise<bigint>;
    /**
     * Get detailed info for a battle by ID.
     */
    getBattle(battleId: number): Promise<BattleInfo>;
    /**
     * Check if a player has wagered on a specific battle.
     */
    hasWagered(battleId: number, player: Address): Promise<boolean>;
    /**
     * Get the number of wagers on a specific battle.
     */
    getWagerCount(battleId: number): Promise<bigint>;
    /**
     * Check if the arena contract is paused.
     */
    isPaused(): Promise<boolean>;
    /**
     * Create a new battle. Requires OPERATOR_ROLE.
     */
    create(params: CreateBattleParams): Promise<{
        battleId: bigint;
        txResult: TxResult;
    }>;
    /**
     * Place a wager on a battle side. Sends ETH as the wager amount.
     */
    wager(params: WagerParams): Promise<TxResult>;
    /**
     * Claim winnings from a settled battle. Returns the claimed amount.
     */
    claim(battleId: number): Promise<bigint>;
}

declare class EventsModule {
    private readonly address;
    private readonly publicClient;
    private readonly walletClient?;
    constructor(address: Address, publicClient: PublicClient, walletClient?: WalletClient | undefined);
    /**
     * Get the total number of events created.
     */
    getCount(): Promise<bigint>;
    /**
     * Get the current season number.
     */
    getCurrentSeason(): Promise<number>;
    /**
     * Get detailed info for an event by ID.
     */
    getEvent(eventId: number): Promise<EventInfo>;
    /**
     * Check if a player is registered for an event.
     */
    isRegistered(eventId: number, player: Address): Promise<boolean>;
    /**
     * Check if the events contract is paused.
     */
    isPaused(): Promise<boolean>;
    /**
     * Register for an event. Sends the entry fee as ETH value.
     */
    register(eventId: number, opts?: {
        value?: bigint;
    }): Promise<TxResult>;
    /**
     * Claim prize from a completed event.
     */
    claimPrize(eventId: number): Promise<TxResult>;
}

declare class FeeModule {
    private readonly address;
    private readonly publicClient;
    private readonly walletClient?;
    constructor(address: Address, publicClient: PublicClient, walletClient?: WalletClient | undefined);
    /**
     * Get the total amount of fees distributed (in wei).
     */
    getTotalDistributed(): Promise<bigint>;
    /**
     * Get the number of fee recipients.
     */
    getRecipientCount(): Promise<bigint>;
    /**
     * Get the total configured share in basis points.
     */
    getTotalShareBps(): Promise<bigint>;
    /**
     * Get the fee recipient at a specific index.
     */
    getRecipient(index: bigint): Promise<FeeShare>;
    /**
     * Get all current fee recipients and their share configuration.
     */
    getShares(): Promise<FeeShare[]>;
    /**
     * Get the total pending earnings for a specific recipient address.
     */
    getEarnings(wallet: Address): Promise<bigint>;
    /**
     * Distribute accumulated fees to all recipients according to their share.
     */
    distribute(): Promise<TxResult>;
}

declare class TradingModule {
    private readonly address;
    private readonly publicClient;
    private readonly walletClient?;
    constructor(address: Address, publicClient: PublicClient, walletClient?: WalletClient | undefined);
    /**
     * Get the total number of bonding curves.
     */
    getCurveCount(): Promise<bigint>;
    /**
     * Get the graduation threshold in ETH (in wei).
     */
    getGraduationThreshold(): Promise<bigint>;
    /**
     * Get the bonding-curve start market cap target, in USD (1e18-scaled).
     * v2 USD-pegging: the curve anchors its seed to this USD value at the live native/USD price.
     */
    getStartMcapUsd(): Promise<bigint>;
    /**
     * Get the graduation market cap target, in USD (1e18-scaled). v2 USD-pegging.
     */
    getGraduationUsd(): Promise<bigint>;
    /**
     * Get the live native/USD price the curve is using (1e18-scaled USD per native token).
     */
    getPriceUsd(): Promise<bigint>;
    /**
     * Get the full bonding curve state for a token.
     * Returns null if the token has no bonding curve.
     */
    getCurve(token: Address): Promise<CurveState | null>;
    /**
     * Get the current price of a token on its bonding curve (in wei per token).
     */
    getPrice(token: Address): Promise<bigint>;
    /**
     * Get a buy quote: how many tokens you receive for a given ETH amount.
     */
    getBuyQuote(token: Address, ethAmount: bigint): Promise<bigint>;
    /**
     * Get a sell quote: how much ETH you receive for a given token amount.
     */
    getSellQuote(token: Address, tokenAmount: bigint): Promise<bigint>;
    /**
     * Get the bonding curve progress (0-10000, representing 0-100.00%).
     */
    getProgress(token: Address): Promise<number>;
    /**
     * Get the market cap of a token (in wei).
     */
    getMarketCap(token: Address): Promise<bigint>;
    /**
     * Check if the bonding curve contract is paused.
     */
    isPaused(): Promise<boolean>;
    /**
     * Buy tokens on the bonding curve by sending ETH.
     */
    buy(token: Address, ethAmount: bigint): Promise<TxResult>;
    /**
     * Sell tokens on the bonding curve to receive ETH.
     * NOTE: Caller must approve the BondingCurve contract to spend tokens first.
     */
    sell(token: Address, tokenAmount: bigint): Promise<TxResult>;
}

/**
 * Read and bid on the FeedBoostAuction — the on-chain feed-boost slot auction
 * that powers promoted placement on the Atlas feed. v2 contract with USD-pegged
 * minimum bids (native fee tracks a USD target at the live native/USD price).
 */
declare class FeedBoostModule {
    private readonly address;
    private readonly publicClient;
    private readonly walletClient?;
    constructor(address: Address, publicClient: PublicClient, walletClient?: WalletClient | undefined);
    /** Get the number of configured auction slots. */
    getSlotCount(): Promise<number>;
    /** Get a slot's live state (name, active, current top token + bid, expiry). */
    getSlot(slotType: number): Promise<SlotInfo>;
    /** List every slot's live state. */
    listSlots(): Promise<SlotInfo[]>;
    /** Get a slot's static config (minBid, minIncrement, duration). */
    getSlotConfig(slotType: number): Promise<SlotConfig>;
    /** Get the live boost currently occupying a slot. */
    getActiveBoost(slotType: number): Promise<ActiveBoost>;
    /**
     * Get the effective minimum bid for a slot, in native currency (wei), derived
     * from the USD target at the live native/USD price. v2 — the amount to beat
     * when the slot is empty.
     */
    getEffectiveMinBid(slotType: number): Promise<bigint>;
    /** Get the minimum next bid required to take a slot (accounts for the current bid + increment). */
    getMinNextBid(slotType: number): Promise<bigint>;
    /** The FeeRouter that the auction routes its protocol fee to. */
    getFeeRouter(): Promise<Address>;
    /** The protocol fee in basis points taken from each winning bid. */
    getProtocolFeeBps(): Promise<number>;
    /** Check if the auction is paused. */
    isPaused(): Promise<boolean>;
    /**
     * Place a bid on a single feed-boost slot for a token.
     * `params.value` is the bid amount in wei (sent as msg.value).
     */
    placeBid(params: PlaceBidParams): Promise<TxResult>;
    /**
     * Place à la carte bids across multiple slots in a single transaction.
     * `amounts` are per-slot bid amounts; the tx value defaults to their sum.
     */
    placeBidBatch(params: PlaceBidBatchParams): Promise<TxResult>;
    /** Withdraw any pending refund owed to the caller (outbid funds). */
    withdrawRefund(): Promise<TxResult>;
}

/**
 * HookOS V3 — direct-to-Uniswap-v3 (and HookSwap) fair launches on Robinhood Chain (4663),
 * plus the buyback-and-burn flywheel reads.
 *
 * This is a Robinhood-only alternate launch mode: 100% of supply is single-sided-seeded into a
 * fresh v3 pool (zero creator pre-alloc), the LP is permanently custodied by the fee vault, and
 * ~0.10% of volume is carved to buy back and burn $HOOK. Instantiate the client with
 * `chainId: 4663` so its RPC points at Robinhood before using this module.
 *
 * @example
 * ```ts
 * const hookos = new HookOS({ chainId: 4663, walletClient });
 *
 * // Reads
 * const fee = await hookos.v3.getEffectiveLaunchFee();
 * const creatorBps = await hookos.v3.getCreatorShareBps(V3Dex.HookSwap); // 7000
 * const burned = await hookos.v3.getTotalBurned();
 *
 * // Launch (salt mined for you)
 * const built = await hookos.v3.buildLaunchParams({
 *   name: "My Token", symbol: "MTK", totalSupply: 1_000_000_000n * 10n ** 18n,
 *   tickLower: -207200, tickUpper: -120000, creator: myAddress, dex: V3Dex.UniswapV3,
 * });
 * const res = await hookos.v3.launch(built.params);
 * ```
 */
declare class V3LaunchModule {
    private readonly addresses;
    private readonly publicClient;
    private readonly walletClient?;
    constructor(addresses: HookOSV3Addresses, publicClient: PublicClient, walletClient?: WalletClient | undefined);
    /** The HookOSV3Launcher address this module targets. */
    get launcherAddress(): Address;
    /**
     * Live native-denominated launch fee (wei), derived from the $8 USD peg at the BondingCurve
     * keeper price. Fails OPEN — returns 0 if the peg is unset or the price is stale.
     */
    getEffectiveLaunchFee(): Promise<bigint>;
    /** The configured USD launch fee target (1e18-scaled). 0 disables the fee. */
    getLaunchFeeUsd(): Promise<bigint>;
    /** Flat one-time native fee HookSwap's Position Locker charges (0 if the upsell is disabled). */
    getHookSwapLockFee(): Promise<bigint>;
    /** Total native (wei) a launch requires: launch fee + optional locker fee + dev buy. */
    quoteLaunchCost(lockOnHookSwap: boolean, initialBuyEth: bigint): Promise<bigint>;
    /** Total number of HookOS V3 launches to date. */
    getLaunchCount(): Promise<bigint>;
    /** Whether the launcher is paused. */
    isPaused(): Promise<boolean>;
    /** Whether `token` was launched via HookOS V3. */
    isHookOSV3Token(token: Address): Promise<boolean>;
    /** The address a {@link V3PairToken} resolves to (WETH by default). */
    getPairAddress(pair?: V3PairToken): Promise<Address>;
    /** Fetch a launch record by index. */
    getLaunch(id: bigint): Promise<V3LaunchInfo>;
    /** Fetch a launch record by token address. */
    getLaunchByToken(token: Address): Promise<V3LaunchInfo>;
    private toLaunchInfo;
    /** Creator share of collected LP fees, in bps, for a DEX (UniswapV3 = 5000, HookSwap = 7000). */
    getCreatorShareBps(dex: V3Dex): Promise<number>;
    /** Share of the PROTOCOL native side of collected LP fees routed to the buyback, in bps. */
    getBuybackShareBps(): Promise<number>;
    /** Total $HOOK bought back and burned (to 0xdEaD) so far, in wei. */
    getTotalBurned(): Promise<bigint>;
    /** Total WETH ever committed to buybacks (gross, tax included), in wei. */
    getTotalWethSpent(): Promise<bigint>;
    /** The launcher's CREATE2 init-code hash for a given token (mine salts against this). */
    getInitCodeHash(name: string, symbol: string, supply: bigint, creator: Address, metadataURI: string): Promise<Hex>;
    /**
     * Mine a CREATE2 salt whose predicted token address sorts BELOW the pair (token == token0) —
     * the invariant `launch()` enforces (`NotToken0()` otherwise). Mirrors the reference
     * `mineToken0Salt` in contracts/test/helpers/hookos-v3.ts: computed locally from the
     * launcher's init-code hash, no RPC round-trip per candidate.
     */
    mineSalt(p: {
        name: string;
        symbol: string;
        supply: bigint;
        creator: Address;
        metadataURI: string;
    }, opts?: {
        pair?: V3PairToken;
        wantToken0?: boolean;
        limit?: number;
    }): Promise<V3MineSaltResult>;
    /**
     * Build a ready-to-send `launch()` tuple, mining the CREATE2 salt so the token sorts as token0.
     * The default `sqrtPriceX96` is advisory-only (the launcher ignores it and derives price from
     * `tickLower`). `creator` MUST match the wallet that will send the launch.
     */
    buildLaunchParams(o: V3BuildLaunchOptions): Promise<V3BuildLaunchResult>;
    /**
     * Deploy a token and single-sided-seed 100% of its supply into a fresh v3 pool.
     * `value` defaults to `quoteLaunchCost(lockOnHookSwap, initialBuyEth)` (launch fee + optional
     * locker fee + dev buy). Requires a wallet client.
     */
    launch(params: V3LaunchParams, value?: bigint): Promise<V3LaunchResult>;
}

/** Target opening market cap (USD) the stock pool is seeded at — $5,500 on a 1B supply. */
declare const STOCK_TARGET_MCAP_USD = 5500n;
/** Tax bounds — enforced ON-CHAIN by the token/hook (MIN_TAX_BPS / MAX_TAX_BPS). */
declare const MIN_TAX_BPS = 200;
declare const MAX_TAX_BPS = 500;
declare const DEFAULT_TAX_BPS = 400;
/** Fixed cuts (of VOLUME) — flat regardless of tax; holders get the remainder (tax − 1.0%). */
declare const CREATOR_FEE_BPS = 50;
declare const FLYWHEEL_BPS = 10;
declare const PLATFORM_NET_BPS = 40;
declare const FIXED_CUT_BPS: number;
/** A basket's weightBps entries MUST total this (100.00%). */
declare const WEIGHT_TOTAL_BPS = 10000;
/** Default v4 pool tier the stock launcher opens at — the 1% memecoin tier (tickSpacing 200). */
declare const STOCK_V4_FEE_TIER = 10000;
declare const STOCK_V4_TICK_SPACING = 200;
/** Default sniper-guard window armed by the launch (seconds; capped ≤ 1h on-chain). */
declare const STOCK_V4_GUARD_WINDOW_SECS = 180n;
/** Selectable reward universe (only stocks with a KNOWN token address; mirrors rh-stocks.ts). */
declare const STOCK_UNIVERSE: StockRef[];
/** The default single-stock reward — the only stock with live on-chain liquidity today. */
declare const DEFAULT_REWARD_SYMBOL = "NVDA";
declare function stockBySymbol(symbol: string): StockRef | undefined;
/** Split one side's tax (bps of volume) into the fixed creator/flywheel/platform cuts + holders. */
declare function splitForTax(taxBps: number): FeeSplitPreview;
/** Equal-weight the picked symbols (index mode). Distributes the rounding remainder to the first. */
declare function equalWeights(symbols: string[]): {
    symbol: string;
    weightPct: number;
}[];
/** Convert a UI draft (whole percent) to on-chain basket entries (bps). Weights MUST sum to 100
 *  (→ 10000 bps) or the vault's setBasket reverts BadWeights. Unknown symbols are dropped. */
declare function draftToBasketEntries(draft: {
    symbol: string;
    weightPct: number;
}[]): StockBasketEntry[];
/**
 * Map launch inputs → the exact `StockRewardLauncherV4.LaunchParams` tuple. The single-sided seed
 * geometry (sqrtPriceX96 / ticks) is computed off-chain for the PREDICTED TOKEN/WETH sort by
 * `computeV3FairLaunchParams`. The WETH→TOKEN dev buy limits at MAX when the token is currency0
 * (price-up buy) and MIN otherwise — the real slippage floor is `initialBuyMinOut`.
 */
declare function buildStockLaunchParamsV4(args: {
    name: string;
    symbol: string;
    supply: bigint;
    admin: Address;
    creator: Address;
    buyBps: number;
    sellBps: number;
    sqrtPriceX96: bigint;
    tickLower: number;
    tickUpper: number;
    tokenIsZero: boolean;
    fee?: number;
    tickSpacing?: number;
    creatorAmount?: bigint;
    guardWindowSecs?: bigint;
    initialBuyEth?: bigint;
    initialBuyMinOut?: bigint;
}): StockLaunchParamsV4;
interface BuiltStockLaunch {
    params: StockLaunchParamsV4;
    predictedToken: Address;
    tokenIsZero: boolean;
}
/**
 * StockRewardModule — the stock-reward launch mechanic (Robinhood Chain 4663 only).
 *
 * A stock-reward token is a fair, direct-to-DEX launch (no bonding curve) with a 2–5% buy/sell tax
 * whose proceeds buy REAL tokenized stocks (NVDA / AAPL / a basket / an index) and drip them to
 * holders every epoch via a Merkle distributor. The preferred venue is StockRewardLauncherV4 — a
 * clean, untaxed token into a Uniswap-v4 TOKEN/WETH pool with StockTaxHook charging the tax in WETH
 * (so sells are never honeypotted). The legacy StockRewardLauncherV2 (token-taxed direct-to-v3)
 * remains available.
 *
 * This is Robinhood-only: every method throws a clear error on chains where the suite isn't
 * deployed. Instantiate the client with `chainId: 4663`.
 *
 * @example
 * ```ts
 * const hookos = new HookOS({ chainId: 4663, walletClient });
 *
 * // Reads
 * const universe = hookos.stock.getRewardUniverse();          // NVDA / AAPL / TSLA
 * const split = hookos.stock.previewFeeSplit(400);            // 4% tax → holdersBps 300
 * const allowed = await hookos.stock.isStockAllowed(nvda);
 *
 * // Launch (V4 by default — ticks/sqrtPrice computed for you)
 * const res = await hookos.stock.launch({
 *   name: "Nvidia Rewards", symbol: "NVDAR", supplyTokens: 1_000_000_000n, buyBps: 400, sellBps: 400,
 * });
 *
 * // Claim (proof supplied by the keeper/indexer)
 * await hookos.stock.claim({ epoch: 3n, stock: nvda, amount, proof });
 * ```
 */
declare class StockRewardModule {
    private readonly addresses;
    private readonly chainId;
    private readonly publicClient;
    private readonly walletClient?;
    constructor(addresses: StockRewardAddresses | null, chainId: number, publicClient: PublicClient, walletClient?: WalletClient | undefined);
    /** Whether the stock-reward suite is deployed on the client's chain. */
    get available(): boolean;
    private requireDeployed;
    private requireWallet;
    /** The selectable reward universe (tokenized stocks + Chainlink feeds). */
    getRewardUniverse(): StockRef[];
    /** Look up a reward stock by symbol (case-insensitive). */
    stockBySymbol(symbol: string): StockRef | undefined;
    /** Preview how a per-side tax (bps) splits between creator/flywheel/platform + holders. */
    previewFeeSplit(taxBps: number): FeeSplitPreview;
    /** The creator's chosen reward basket for a token (weights in bps, summing to 10000). */
    getBasket(rewardToken: Address): Promise<StockBasketEntry[]>;
    /** Whether a stock is on the vault's reward allowlist. */
    isStockAllowed(stock: Address): Promise<boolean>;
    /** The Chainlink USD feed (8dp) the vault has bound to a stock. */
    getStockPriceFeed(stock: Address): Promise<Address>;
    /** The undistributed holder USDG pool accrued for a reward token. */
    getHolderPool(rewardToken: Address): Promise<bigint>;
    /** Total holder USDG the vault is currently holding across all tokens. */
    getTotalHolderUsdg(): Promise<bigint>;
    /** Total of a given stock the vault has bought for holders so far. */
    getTotalStockBought(stock: Address): Promise<bigint>;
    /**
     * The live WETH/USD price floor the vault prices stock buys against, read from the
     * WethUsdAggregatorAdapter (a Chainlink-shaped feed wrapping the keeper price). `answer` is
     * `decimals`-scaled (8dp). Returns zeros when the underlying keeper price is stale/bad
     * (the adapter fails CLOSED).
     */
    getWethUsdPrice(): Promise<{
        answer: bigint;
        decimals: number;
        updatedAt: number;
    }>;
    /** Whether `token` was launched via the V4 stock-reward launcher. */
    isStockRewardToken(token: Address): Promise<boolean>;
    /** Total number of V4 stock-reward launches to date. */
    getLaunchCount(): Promise<bigint>;
    /**
     * Compute the full `StockRewardLauncherV4.LaunchParams` tuple (weth read + token prediction +
     * live keeper price + ticks/sqrtPrice) WITHOUT sending. Useful for previewing or custom flows.
     */
    buildLaunchParamsV4(opts: StockLaunchOptions): Promise<BuiltStockLaunch>;
    /**
     * Launch a stock-reward token. Defaults to the V4 (WETH-paired, hook-taxed) launcher; pass
     * `useV2: true` (or launch on a chain where only V2 is deployed) for the legacy v3 path.
     * Requires a wallet client. Returns the launched token + poolId (decoded from `Launched`).
     */
    launch(opts: StockLaunchOptions): Promise<StockLaunchResult>;
    /** Send a prebuilt V4 launch tuple. `value` funds the atomic dev buy (defaults to initialBuyEth). */
    launchV4(params: StockLaunchParamsV4, value?: bigint): Promise<StockLaunchResult>;
    /** Send a prebuilt legacy V2 launch tuple. `predictedToken` is a receipt-decode fallback. */
    launchV2(params: StockLaunchParamsV2, predictedToken?: Address): Promise<StockLaunchResult>;
    /** Number of published reward epochs. */
    getEpochCount(): Promise<bigint>;
    /** Read a published epoch. */
    getEpoch(epoch: bigint): Promise<StockEpoch>;
    /** Whether `account` has claimed its leaf for an epoch. */
    hasClaimed(epoch: bigint, account: Address): Promise<boolean>;
    /** Amount still unclaimed for an epoch. */
    getUnclaimed(epoch: bigint): Promise<bigint>;
    /**
     * Claim tokenized-stock rewards for an epoch. The Merkle `proof` is NOT computed on-chain — it
     * comes from the keeper's off-chain epoch state (the indexer / claim API); the caller supplies
     * it. Uses `claimFor` when `params.account` is set, otherwise `claim` for the wallet account.
     */
    claim(params: StockClaimParams): Promise<TxResult>;
    /** Read the live native/USD keeper price + fail closed on staleness. */
    private readKeeperPrice;
    private toTx;
}

/** Default opening market cap (USD) for a quick launch — mirrors the app's V3_TARGET_MCAP_USD. */
declare const QUICK_LAUNCH_TARGET_MCAP_USD = 5500n;
/** The v4 pool fee tier + tick spacing every RHLaunchpad pool uses. */
declare const QUICK_LAUNCH_FEE_TIER = 3000;
declare const QUICK_LAUNCH_TICK_SPACING = 60;
/**
 * QuickLaunchModule — the RHLaunchpad direct-to-v4 "quick launch" memecoin fast path
 * (Robinhood Chain 4663 only).
 *
 * On Robinhood, "Quick Launch" IS the direct-to-DEX fair-launch mechanism: one `launch()` call
 * deploys the token, creates the v4 pool (via the shared, permissionless LaunchHook), and seeds
 * CONCENTRATED liquidity holding 100% of supply single-sided (zero creator pre-allocation, no
 * bonding curve). A USD-anchored seed price is read live from the same keeper feed the curve uses
 * for fees/graduation. `devBuy` is a standing entry point any caller can use once a pool's
 * 3-minute sniper guard has elapsed.
 *
 * Robinhood-only: every method throws a clear error on chains where RHLaunchpad isn't deployed.
 * Instantiate the client with `chainId: 4663`.
 *
 * @example
 * ```ts
 * const hookos = new HookOS({ chainId: 4663, walletClient });
 *
 * const fee = await hookos.quickLaunch.getEffectiveLaunchFee();
 * const res = await hookos.quickLaunch.launch({
 *   name: "Pepe", symbol: "PEPE", supplyTokens: 1_000_000_000n,
 * });
 * ```
 */
declare class QuickLaunchModule {
    private readonly addresses;
    private readonly chainId;
    private readonly publicClient;
    private readonly walletClient?;
    constructor(addresses: QuickLaunchAddresses | null, chainId: number, publicClient: PublicClient, walletClient?: WalletClient | undefined);
    /** Whether RHLaunchpad quick launch is deployed on the client's chain. */
    get available(): boolean;
    /** The RHLaunchpad address this module targets (zero if not deployed on this chain). */
    get launchpadAddress(): Address;
    private requireDeployed;
    private requireWallet;
    /** Live native-denominated launch fee (wei), USD-pegged at the keeper price. `launch()` sends this. */
    getEffectiveLaunchFee(): Promise<bigint>;
    /** The shared LaunchHook attached to every RHLaunchpad pool. */
    getLaunchHook(): Promise<Address>;
    /**
     * Compute the ready-to-send RHLaunchpad `launch()` args (weth read + token prediction + live
     * keeper price + single-sided seed geometry + USD-pegged launch fee) WITHOUT sending.
     */
    buildLaunchParams(opts: QuickLaunchOptions): Promise<QuickLaunchBuildResult>;
    /**
     * Deploy a token and single-sided-seed 100% of its supply into a fresh v4 pool. `msg.value`
     * covers the live USD-pegged launch fee (no WETH needed to seed a single-sided position).
     * Requires a wallet client. Returns the launched token (decoded from `TokenCreated`).
     */
    launch(opts: QuickLaunchOptions): Promise<QuickLaunchResult>;
    /**
     * Buy into any LaunchHook pool once its 3-minute sniper guard has elapsed. The UI owns the
     * countdown; this just sends the swap (WETH-in). Requires a wallet client.
     */
    devBuy(opts: {
        token: Address;
        amountInEther: number;
        recipient?: Address;
    }): Promise<DevBuyResult>;
    private readKeeperPrice;
    private toTx;
}

/**
 * Configuration options for the HookOS SDK client.
 */
interface HookOSOptions {
    /**
     * Chain ID. Defaults to 8453 (Base).
     * Supported: 8453 (Base), 4663 (Robinhood Chain), 4326 (MegaETH), 999 (HyperEVM), 56 (BNB Chain), 1 (Ethereum), 988 (Stable, V3-only).
     */
    chainId?: ChainId;
    /**
     * Custom RPC URL. Defaults to the public RPC for the selected chain.
     */
    rpcUrl?: string;
    /**
     * A viem WalletClient for write operations (token creation, trading, wagering, etc.).
     * If not provided, only read operations will be available.
     */
    walletClient?: WalletClient;
    /**
     * An existing viem PublicClient. If provided, `rpcUrl` and `chainId` are ignored
     * for the public client (but still used for address resolution).
     */
    publicClient?: PublicClient;
}
/**
 * Main entry point for the HookOS SDK.
 *
 * @example
 * ```ts
 * import { HookOS } from "@hookos/sdk";
 *
 * // Read-only client (no wallet needed)
 * const hookos = new HookOS();
 *
 * // Get all tokens
 * const tokens = await hookos.tokens.list();
 *
 * // Get a bonding curve price
 * const price = await hookos.trading.getPrice("0x...");
 *
 * // With wallet client for write operations
 * import { createWalletClient, custom } from "viem";
 * import { base } from "viem/chains";
 *
 * const wallet = createWalletClient({
 *   chain: base,
 *   transport: custom(window.ethereum!),
 * });
 *
 * const hookos = new HookOS({ walletClient: wallet });
 *
 * // Buy tokens on bonding curve
 * const tx = await hookos.trading.buy("0x...", parseEther("0.1"));
 * ```
 */
declare class HookOS {
    /** Token creation and querying. */
    readonly tokens: TokenModule;
    /** Hook registration, attachment, and browsing. */
    readonly hooks: HookModule;
    /** Battle creation, wagering, and settlement. */
    readonly arena: ArenaModule;
    /** Protocol events. */
    readonly events: EventsModule;
    /** Fee distribution management. */
    readonly fees: FeeModule;
    /** Bonding curve trading (buy/sell/quotes). */
    readonly trading: TradingModule;
    /** FeedBoost slot auction (read slots, place à la carte bids). */
    readonly feedBoost: FeedBoostModule;
    /**
     * HookOS V3 — direct-to-Uniswap-v3 (and HookSwap / PancakeSwap V3) fair launches + the buyback
     * flywheel. Live on all six chains; the module resolves the launcher for the client's chainId.
     */
    readonly v3: V3LaunchModule;
    /**
     * Stock-Reward launches — taxed fair launches whose tax buys REAL tokenized stocks for holders.
     * Robinhood Chain (4663) only — methods throw a clear error on other chains.
     */
    readonly stock: StockRewardModule;
    /**
     * Quick Launch — RHLaunchpad direct-to-Uniswap-v4 memecoin fast path. Robinhood Chain (4663)
     * only — methods throw a clear error on other chains.
     */
    readonly quickLaunch: QuickLaunchModule;
    /** The underlying viem PublicClient used for reads. */
    readonly publicClient: PublicClient;
    /** The underlying viem WalletClient used for writes (if provided). */
    readonly walletClient: WalletClient | undefined;
    /** The active chain ID. */
    readonly chainId: ChainId;
    constructor(opts?: HookOSOptions);
}

/** Canonical Uniswap v3 fee tiers → tickSpacing (also the v4 tiers the stock launcher uses). */
declare const V3_TICK_SPACING: Record<number, number>;
/** Fee tiers a creator can pick in the launch UI (bps of the fee, e.g. 10000 = 1%). */
declare const V3_FEE_TIERS: readonly [500, 3000, 10000];
type V3FeeTier = (typeof V3_FEE_TIERS)[number];
/** Default: the 1% tier — the memecoin-standard tier and the one the buyback carve is sized for. */
declare const V3_DEFAULT_FEE_TIER: V3FeeTier;
declare function tickSpacingForFee(feeTier: number): number;
/** RHLaunchpad's single protocol-wide tick spacing (direct-to-v4 memecoin path). */
declare const RH_TICK_SPACING = 60;
declare const MIN_SQRT_RATIO: bigint;
declare const MAX_SQRT_RATIO: bigint;
/** Aliases kept for the v3-launch naming used across the app. */
declare const V3_MIN_SQRT_RATIO: bigint;
declare const V3_MAX_SQRT_RATIO: bigint;
/**
 * Compute a USD-anchored seed price + a SINGLE-SIDED concentrated range holding the ENTIRE
 * supply, for a fee-tier-aware v3/v4 launcher. Returns no `liquidityDelta` — those launchers
 * seed `totalSupply` on-chain and derive liquidity from it.
 *
 * @param targetMcapUsd  Target opening market cap in USD (whole dollars).
 * @param supplyTokens   FULL token supply (plain count, not wei) — ALL of it seeds the pool.
 * @param nativeUsdPrice Fresh native/USD price, 1e18-scaled (BondingCurve.keeperPriceUsd()).
 * @param tokenIsZero    Whether the (predicted) token address sorts below WETH.
 * @param feeTier        v3/v4 fee tier (100/500/3000/10000) — drives tickSpacing alignment.
 * @param bandWidthMultiplier How far price can rise from the seed before the position runs
 *                            out of room (default 25 = 25x).
 */
declare function computeV3FairLaunchParams(opts: {
    targetMcapUsd: bigint;
    supplyTokens: bigint;
    nativeUsdPrice: bigint;
    tokenIsZero: boolean;
    feeTier?: number;
    bandWidthMultiplier?: number;
}): V3FairLaunchParams;
/**
 * Compute a USD-anchored seed price + a SINGLE-SIDED position covering the ENTIRE supply for
 * a RHLaunchpad direct-to-v4 fair launch. Returns a `liquidityDelta` (RHLaunchpad's `launch()`
 * takes it explicitly, unlike the v3 launchers).
 *
 * @param targetMcapUsd       Target opening market cap in USD.
 * @param supplyTokens        FULL token supply (plain count, not wei) — ALL of it seeds the pool.
 * @param nativeUsdPrice      Fresh native/USD price, 1e18-scaled (BondingCurve.keeperPriceUsd()).
 * @param tokenIsZero         Whether the (predicted) token address sorts below WETH.
 * @param bandWidthMultiplier How far the range extends from the seed price (default 25 = 25x).
 */
declare function computeFairLaunchParams(opts: {
    targetMcapUsd: bigint;
    supplyTokens: bigint;
    nativeUsdPrice: bigint;
    tokenIsZero: boolean;
    bandWidthMultiplier?: number;
}): FairLaunchParams;

/**
 * Canonical verified public RPC fallback pools (best-first, no API key required).
 * Mirrors `contracts/deployments/rpc-endpoints.json` — the protocol's single source of
 * truth. Verified 2026-06-25 (stale/dead endpoints excluded). Use these to build an
 * auto-failover provider so a single flaky endpoint never breaks reads.
 *
 * The apps build viem `fallback()` / ethers `FallbackProvider` over these pools.
 */
declare const RPC_ENDPOINTS: Record<ChainId, readonly string[]>;
/**
 * Get the RPC fallback pool for a chain, with optional caller-supplied overrides
 * placed FIRST (e.g. a private/keyed endpoint), then the verified public pool.
 * Returns a deduped, best-first list. Never empty for a supported chain.
 */
declare function getRpcPool(chainId: ChainId, overrides?: string[]): string[];

declare const TokenFactoryABI: readonly [{
    readonly name: "launchFee";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "launchFeeUsd";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "effectiveLaunchFee";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "nativeUsdFeed";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "getTokenCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getCreatorTokenCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "creator";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "allTokens";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "tokens";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "tokenAddress";
        readonly type: "address";
    }, {
        readonly name: "creator";
        readonly type: "address";
    }, {
        readonly name: "name";
        readonly type: "string";
    }, {
        readonly name: "symbol";
        readonly type: "string";
    }, {
        readonly name: "initialSupply";
        readonly type: "uint256";
    }, {
        readonly name: "launchFee";
        readonly type: "uint256";
    }, {
        readonly name: "createdAt";
        readonly type: "uint64";
    }];
}, {
    readonly name: "paused";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "createToken";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "name";
        readonly type: "string";
    }, {
        readonly name: "symbol";
        readonly type: "string";
    }, {
        readonly name: "initialSupply";
        readonly type: "uint256";
    }, {
        readonly name: "metadataURI";
        readonly type: "string";
    }];
    readonly outputs: readonly [{
        readonly name: "tokenAddress";
        readonly type: "address";
    }];
}, {
    readonly name: "createTokenAndCurve";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "name";
        readonly type: "string";
    }, {
        readonly name: "symbol";
        readonly type: "string";
    }, {
        readonly name: "initialSupply";
        readonly type: "uint256";
    }, {
        readonly name: "metadataURI";
        readonly type: "string";
    }, {
        readonly name: "useExternalDex";
        readonly type: "bool";
    }];
    readonly outputs: readonly [{
        readonly name: "tokenAddress";
        readonly type: "address";
    }];
}, {
    readonly name: "setLaunchFeeUsd";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "feeUsd";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setLaunchFee";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "fee";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "TokenCreated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "creator";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "name";
        readonly type: "string";
        readonly indexed: false;
    }, {
        readonly name: "symbol";
        readonly type: "string";
        readonly indexed: false;
    }, {
        readonly name: "initialSupply";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}];

declare const HookRegistryABI: readonly [{
    readonly name: "registrationFee";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "registrationFeeUsd";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "effectiveRegistrationFee";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "nativeUsdFeed";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "getHookCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "hooks";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly name: "author";
        readonly type: "address";
    }, {
        readonly name: "implementation";
        readonly type: "address";
    }, {
        readonly name: "name";
        readonly type: "string";
    }, {
        readonly name: "category";
        readonly type: "string";
    }, {
        readonly name: "metadataURI";
        readonly type: "string";
    }, {
        readonly name: "installs";
        readonly type: "uint256";
    }, {
        readonly name: "totalRating";
        readonly type: "uint256";
    }, {
        readonly name: "ratingCount";
        readonly type: "uint256";
    }, {
        readonly name: "revenue";
        readonly type: "uint256";
    }, {
        readonly name: "verified";
        readonly type: "bool";
    }, {
        readonly name: "active";
        readonly type: "bool";
    }, {
        readonly name: "createdAt";
        readonly type: "uint64";
    }];
}, {
    readonly name: "hookIds";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
    }];
}, {
    readonly name: "getAverageRating";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "hookId";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "paused";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "registerHook";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "name";
        readonly type: "string";
    }, {
        readonly name: "category";
        readonly type: "string";
    }, {
        readonly name: "metadataURI";
        readonly type: "string";
    }, {
        readonly name: "implementation";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "hookId";
        readonly type: "bytes32";
    }];
}, {
    readonly name: "rateHook";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "hookId";
        readonly type: "bytes32";
    }, {
        readonly name: "rating";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "recordInstall";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "hookId";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setRegistrationFeeUsd";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "feeUsd";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setRegistrationFee";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "fee";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "HookRegistered";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "hookId";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: "author";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "name";
        readonly type: "string";
        readonly indexed: false;
    }, {
        readonly name: "implementation";
        readonly type: "address";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}];

declare const HookManagerABI: readonly [{
    readonly name: "maxHooksPerToken";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "defaultGasLimit";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getTokenHookCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getActiveHooks";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly name: "hookId";
            readonly type: "bytes32";
        }, {
            readonly name: "hookImpl";
            readonly type: "address";
        }, {
            readonly name: "hookPoint";
            readonly type: "uint8";
        }, {
            readonly name: "active";
            readonly type: "bool";
        }, {
            readonly name: "gasLimit";
            readonly type: "uint256";
        }, {
            readonly name: "attachedAt";
            readonly type: "uint64";
        }];
    }];
}, {
    readonly name: "hasHook";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }, {
        readonly name: "";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "paused";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "attachHook";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "hookId";
        readonly type: "bytes32";
    }, {
        readonly name: "hookImpl";
        readonly type: "address";
    }, {
        readonly name: "hookPoint";
        readonly type: "uint8";
    }, {
        readonly name: "gasLimit";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "detachHook";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "hookId";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "HookAttached";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "hookId";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: "hookPoint";
        readonly type: "uint8";
        readonly indexed: false;
    }];
}, {
    readonly name: "HookDetached";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "hookId";
        readonly type: "bytes32";
        readonly indexed: true;
    }];
}];

declare const ArenaABI: readonly [{
    readonly name: "battleCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "protocolFeeBps";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "battles";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "tokenA";
        readonly type: "address";
    }, {
        readonly name: "tokenB";
        readonly type: "address";
    }, {
        readonly name: "pot";
        readonly type: "uint256";
    }, {
        readonly name: "teamAPot";
        readonly type: "uint256";
    }, {
        readonly name: "teamBPot";
        readonly type: "uint256";
    }, {
        readonly name: "minWager";
        readonly type: "uint256";
    }, {
        readonly name: "maxWager";
        readonly type: "uint256";
    }, {
        readonly name: "startTime";
        readonly type: "uint64";
    }, {
        readonly name: "endTime";
        readonly type: "uint64";
    }, {
        readonly name: "round";
        readonly type: "uint16";
    }, {
        readonly name: "status";
        readonly type: "uint8";
    }, {
        readonly name: "winner";
        readonly type: "uint8";
    }];
}, {
    readonly name: "hasWagered";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }, {
        readonly name: "";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "getBattleWagerCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "battleId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "paused";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "placeWager";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "battleId";
        readonly type: "uint256";
    }, {
        readonly name: "side";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "claimWinnings";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "battleId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "createBattle";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "tokenA";
        readonly type: "address";
    }, {
        readonly name: "tokenB";
        readonly type: "address";
    }, {
        readonly name: "minWager";
        readonly type: "uint256";
    }, {
        readonly name: "maxWager";
        readonly type: "uint256";
    }, {
        readonly name: "startTime";
        readonly type: "uint64";
    }, {
        readonly name: "endTime";
        readonly type: "uint64";
    }];
    readonly outputs: readonly [{
        readonly name: "battleId";
        readonly type: "uint256";
    }];
}, {
    readonly name: "WagerPlaced";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "battleId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "player";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "side";
        readonly type: "uint8";
        readonly indexed: false;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly name: "WinningsClaimed";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "battleId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "player";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}];

declare const EventsABI: readonly [{
    readonly name: "eventCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "currentSeason";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint16";
    }];
}, {
    readonly name: "events";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "name";
        readonly type: "string";
    }, {
        readonly name: "category";
        readonly type: "string";
    }, {
        readonly name: "metadataURI";
        readonly type: "string";
    }, {
        readonly name: "prizePool";
        readonly type: "uint256";
    }, {
        readonly name: "entryFee";
        readonly type: "uint256";
    }, {
        readonly name: "maxPlayers";
        readonly type: "uint256";
    }, {
        readonly name: "playerCount";
        readonly type: "uint256";
    }, {
        readonly name: "startTime";
        readonly type: "uint64";
    }, {
        readonly name: "endTime";
        readonly type: "uint64";
    }, {
        readonly name: "season";
        readonly type: "uint16";
    }, {
        readonly name: "status";
        readonly type: "uint8";
    }];
}, {
    readonly name: "isRegistered";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }, {
        readonly name: "";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "paused";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "createEvent";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "name";
        readonly type: "string";
    }, {
        readonly name: "category";
        readonly type: "string";
    }, {
        readonly name: "metadataURI";
        readonly type: "string";
    }, {
        readonly name: "entryFee";
        readonly type: "uint256";
    }, {
        readonly name: "maxPlayers";
        readonly type: "uint256";
    }, {
        readonly name: "startTime";
        readonly type: "uint64";
    }, {
        readonly name: "endTime";
        readonly type: "uint64";
    }];
    readonly outputs: readonly [{
        readonly name: "eventId";
        readonly type: "uint256";
    }];
}, {
    readonly name: "register";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "eventId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "claimPrize";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "eventId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "PlayerRegistered";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "eventId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "player";
        readonly type: "address";
        readonly indexed: true;
    }];
}, {
    readonly name: "PrizeClaimed";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "eventId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "player";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}];

declare const FeeRouterABI: readonly [{
    readonly name: "totalDistributed";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getRecipientCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "recipients";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "wallet";
        readonly type: "address";
    }, {
        readonly name: "shareBps";
        readonly type: "uint256";
    }, {
        readonly name: "label";
        readonly type: "string";
    }];
}, {
    readonly name: "recipientEarnings";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getTotalShareBps";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "distribute";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [];
    readonly outputs: readonly [];
}, {
    readonly name: "FeeReceived";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "from";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly name: "FeeDistributed";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "recipient";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "label";
        readonly type: "string";
        readonly indexed: false;
    }];
}];

declare const BondingCurveABI: readonly [{
    readonly name: "curves";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "creator";
        readonly type: "address";
    }, {
        readonly name: "virtualTokenReserve";
        readonly type: "uint256";
    }, {
        readonly name: "virtualEthReserve";
        readonly type: "uint256";
    }, {
        readonly name: "tokensSold";
        readonly type: "uint256";
    }, {
        readonly name: "ethCollected";
        readonly type: "uint256";
    }, {
        readonly name: "totalSupply";
        readonly type: "uint256";
    }, {
        readonly name: "graduated";
        readonly type: "bool";
    }, {
        readonly name: "pool";
        readonly type: "address";
    }, {
        readonly name: "createdAt";
        readonly type: "uint64";
    }, {
        readonly name: "useExternal";
        readonly type: "bool";
    }, {
        readonly name: "virtualEthSeed";
        readonly type: "uint256";
    }, {
        readonly name: "graduationEth";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getPrice";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getBuyQuote";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "ethAmount";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "tokensOut";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getSellQuote";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "tokenAmount";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "ethOut";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getProgress";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getMarketCap";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getCurveCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "graduationThresholdEth";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "startMcapUsd";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "graduationUsd";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "priceUsd";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "maxPriceStale";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "nativeUsdFeed";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "virtualEthSeed";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "setUsdTargets";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "startMcapUsd_";
        readonly type: "uint256";
    }, {
        readonly name: "graduationUsd_";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setMaxPriceStale";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "secs";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setNativeUsdFeed";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "feed";
        readonly type: "address";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setVirtualEthSeed";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "seed";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "paused";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "buy";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "sell";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "tokenAmount";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "CurveCreated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "creator";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "totalSupply";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "TokenBought";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "buyer";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "ethIn";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "tokensOut";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "newPrice";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "TokenSold";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "seller";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "tokensIn";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "ethOut";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "newPrice";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "Graduated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "pool";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "ethLiquidity";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "tokenLiquidity";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "UsdTargetsUpdated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "startMcapUsd";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "graduationUsd";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "VirtualEthSeedUpdated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "newSeed";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "NativeUsdFeedUpdated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "feed";
        readonly type: "address";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "MaxPriceStaleUpdated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "maxPriceStale";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}];

declare const FeedBoostAuctionABI: readonly [{
    readonly name: "getSlot";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "name";
        readonly type: "string";
    }, {
        readonly name: "active";
        readonly type: "bool";
    }, {
        readonly name: "minBid";
        readonly type: "uint256";
    }, {
        readonly name: "topToken";
        readonly type: "address";
    }, {
        readonly name: "currentBid";
        readonly type: "uint256";
    }, {
        readonly name: "expiry";
        readonly type: "uint40";
    }];
}, {
    readonly name: "getSlotCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
    }];
}, {
    readonly name: "getSlotConfig";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "minBid";
        readonly type: "uint256";
    }, {
        readonly name: "minIncrement";
        readonly type: "uint256";
    }, {
        readonly name: "duration";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getActiveBoosts";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "bidder";
        readonly type: "address";
    }, {
        readonly name: "bid";
        readonly type: "uint256";
    }, {
        readonly name: "startTime";
        readonly type: "uint40";
    }, {
        readonly name: "expiry";
        readonly type: "uint40";
    }];
}, {
    readonly name: "getBidsForToken";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "slotTypes";
        readonly type: "uint8[]";
    }, {
        readonly name: "bids";
        readonly type: "uint256[]";
    }, {
        readonly name: "expiries";
        readonly type: "uint40[]";
    }];
}, {
    readonly name: "getMinNextBid";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getTopBoost";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "effectiveMinBid";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "effectiveMinIncrement";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "priceUsd";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "priceUsdOrZero";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "slotActive";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "slotName";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "string";
    }];
}, {
    readonly name: "boosts";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "bidder";
        readonly type: "address";
    }, {
        readonly name: "bid";
        readonly type: "uint256";
    }, {
        readonly name: "startTime";
        readonly type: "uint40";
    }, {
        readonly name: "expiry";
        readonly type: "uint40";
    }];
}, {
    readonly name: "totalCollected";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "pendingRefunds";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "feeRouter";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "protocolFeeBps";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint16";
    }];
}, {
    readonly name: "nativeUsdFeed";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "maxPriceStale";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "paused";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "placeBid";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "slotType";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "placeBidBatch";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "slots";
        readonly type: "uint8[]";
    }, {
        readonly name: "amounts";
        readonly type: "uint256[]";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "extendBoost";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "slotType";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "withdrawRefund";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [];
    readonly outputs: readonly [];
}, {
    readonly name: "setSlotConfig";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
    }, {
        readonly name: "minBid";
        readonly type: "uint256";
    }, {
        readonly name: "minIncrement";
        readonly type: "uint256";
    }, {
        readonly name: "duration";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setSlotUsd";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
    }, {
        readonly name: "minBidUsd";
        readonly type: "uint256";
    }, {
        readonly name: "minIncrementUsd";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "addSlot";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "name";
        readonly type: "string";
    }, {
        readonly name: "minBid";
        readonly type: "uint256";
    }, {
        readonly name: "minIncrement";
        readonly type: "uint256";
    }, {
        readonly name: "duration";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "id";
        readonly type: "uint8";
    }];
}, {
    readonly name: "setSlotActive";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
    }, {
        readonly name: "active";
        readonly type: "bool";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setSlotName";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
    }, {
        readonly name: "name";
        readonly type: "string";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setFeeRouter";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "router";
        readonly type: "address";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setProtocolFeeBps";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "feeBps";
        readonly type: "uint16";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setNativeUsdFeed";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "feed";
        readonly type: "address";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setMaxPriceStale";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "secs";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "setKeeperPrice";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "priceUsd_";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "BidPlaced";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
        readonly indexed: true;
    }, {
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "bidder";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "expiry";
        readonly type: "uint40";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "BidRefunded";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
        readonly indexed: true;
    }, {
        readonly name: "prevBidder";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "BoostWon";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
        readonly indexed: true;
    }, {
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "bidder";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "startTime";
        readonly type: "uint40";
        readonly indexed: false;
    }, {
        readonly name: "expiry";
        readonly type: "uint40";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "BoostExtended";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
        readonly indexed: true;
    }, {
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "bidder";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "addedAmount";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "newExpiry";
        readonly type: "uint40";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "BoostExpired";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
        readonly indexed: true;
    }, {
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }];
    readonly anonymous: false;
}, {
    readonly name: "SlotAdded";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
        readonly indexed: true;
    }, {
        readonly name: "name";
        readonly type: "string";
        readonly indexed: false;
    }, {
        readonly name: "minBid";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "minIncrement";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "duration";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "SlotConfigUpdated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
        readonly indexed: true;
    }, {
        readonly name: "minBid";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "minIncrement";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "duration";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "SlotConfigUsdUpdated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
        readonly indexed: true;
    }, {
        readonly name: "minBidUsd";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "minIncrementUsd";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "SlotActiveUpdated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
        readonly indexed: true;
    }, {
        readonly name: "active";
        readonly type: "bool";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "FeeRouterUpdated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "feeRouter";
        readonly type: "address";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "ProtocolFeeBpsUpdated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "protocolFeeBps";
        readonly type: "uint16";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "ProtocolFeeRouted";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "slotType";
        readonly type: "uint8";
        readonly indexed: true;
    }, {
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "RefundWithdrawn";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "bidder";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "FeesWithdrawn";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "to";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}];

declare const HookOSV3LauncherABI: readonly [{
    readonly name: "effectiveLaunchFee";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "hookSwapLockFee";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "quoteLaunchCost";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "lockOnHookSwap";
        readonly type: "bool";
    }, {
        readonly name: "initialBuyEth";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "launchCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "launchFeeUsd";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "paused";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "pairAddressOf";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "pair";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "hookPairStatus";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "ok";
        readonly type: "bool";
    }, {
        readonly name: "depth";
        readonly type: "uint256";
    }, {
        readonly name: "fresh";
        readonly type: "bool";
    }];
}, {
    readonly name: "initCodeHash";
    readonly type: "function";
    readonly stateMutability: "pure";
    readonly inputs: readonly [{
        readonly name: "name_";
        readonly type: "string";
    }, {
        readonly name: "symbol_";
        readonly type: "string";
    }, {
        readonly name: "supply_";
        readonly type: "uint256";
    }, {
        readonly name: "creator_";
        readonly type: "address";
    }, {
        readonly name: "metadataURI_";
        readonly type: "string";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
    }];
}, {
    readonly name: "predictToken";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "salt";
        readonly type: "bytes32";
    }, {
        readonly name: "name_";
        readonly type: "string";
    }, {
        readonly name: "symbol_";
        readonly type: "string";
    }, {
        readonly name: "supply_";
        readonly type: "uint256";
    }, {
        readonly name: "creator_";
        readonly type: "address";
    }, {
        readonly name: "metadataURI_";
        readonly type: "string";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "getLaunch";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "id";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "token";
            readonly type: "address";
        }, {
            readonly name: "pool";
            readonly type: "address";
        }, {
            readonly name: "creator";
            readonly type: "address";
        }, {
            readonly name: "tokenId";
            readonly type: "uint256";
        }, {
            readonly name: "feeTier";
            readonly type: "uint24";
        }, {
            readonly name: "dex";
            readonly type: "uint8";
        }, {
            readonly name: "locker";
            readonly type: "address";
        }, {
            readonly name: "pair";
            readonly type: "uint8";
        }, {
            readonly name: "pairToken";
            readonly type: "address";
        }, {
            readonly name: "metadataURI";
            readonly type: "string";
        }, {
            readonly name: "createdAt";
            readonly type: "uint256";
        }];
    }];
}, {
    readonly name: "getLaunchByToken";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "token";
            readonly type: "address";
        }, {
            readonly name: "pool";
            readonly type: "address";
        }, {
            readonly name: "creator";
            readonly type: "address";
        }, {
            readonly name: "tokenId";
            readonly type: "uint256";
        }, {
            readonly name: "feeTier";
            readonly type: "uint24";
        }, {
            readonly name: "dex";
            readonly type: "uint8";
        }, {
            readonly name: "locker";
            readonly type: "address";
        }, {
            readonly name: "pair";
            readonly type: "uint8";
        }, {
            readonly name: "pairToken";
            readonly type: "address";
        }, {
            readonly name: "metadataURI";
            readonly type: "string";
        }, {
            readonly name: "createdAt";
            readonly type: "uint256";
        }];
    }];
}, {
    readonly name: "isHookOSV3Token";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "launch";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "p";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "name";
            readonly type: "string";
        }, {
            readonly name: "symbol";
            readonly type: "string";
        }, {
            readonly name: "metadataURI";
            readonly type: "string";
        }, {
            readonly name: "totalSupply";
            readonly type: "uint256";
        }, {
            readonly name: "salt";
            readonly type: "bytes32";
        }, {
            readonly name: "sqrtPriceX96";
            readonly type: "uint160";
        }, {
            readonly name: "tickLower";
            readonly type: "int24";
        }, {
            readonly name: "tickUpper";
            readonly type: "int24";
        }, {
            readonly name: "initialBuyEth";
            readonly type: "uint256";
        }, {
            readonly name: "initialBuyMinOut";
            readonly type: "uint256";
        }, {
            readonly name: "initialBuyDeadline";
            readonly type: "uint256";
        }, {
            readonly name: "dex";
            readonly type: "uint8";
        }, {
            readonly name: "pair";
            readonly type: "uint8";
        }, {
            readonly name: "lockOnHookSwap";
            readonly type: "bool";
        }];
    }];
    readonly outputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "pool";
        readonly type: "address";
    }, {
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
}, {
    readonly name: "TokenCreated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "creator";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "name";
        readonly type: "string";
        readonly indexed: false;
    }, {
        readonly name: "symbol";
        readonly type: "string";
        readonly indexed: false;
    }, {
        readonly name: "initialSupply";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "LaunchCreated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "creator";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "name";
        readonly type: "string";
        readonly indexed: false;
    }, {
        readonly name: "symbol";
        readonly type: "string";
        readonly indexed: false;
    }, {
        readonly name: "initialSupply";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "PoolSeeded";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "pool";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "feeTier";
        readonly type: "uint24";
        readonly indexed: false;
    }, {
        readonly name: "dex";
        readonly type: "uint8";
        readonly indexed: false;
    }, {
        readonly name: "locker";
        readonly type: "address";
        readonly indexed: false;
    }, {
        readonly name: "pair";
        readonly type: "uint8";
        readonly indexed: false;
    }, {
        readonly name: "pairToken";
        readonly type: "address";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "DevBuyExecuted";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "buyer";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "ethIn";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "minOut";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}, {
    readonly name: "LaunchFeeCollected";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "payer";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}];

declare const HookOSV3FeeVaultABI: readonly [{
    readonly name: "creatorShareBpsByDex";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "dex";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint16";
    }];
}, {
    readonly name: "buybackShareBps";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint16";
    }];
}];

declare const HookOSV3BuybackABI: readonly [{
    readonly name: "totalBurned";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "totalWethSpent";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "BoughtBack";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "caller";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amountIn";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "burned";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "totalBurned";
        readonly type: "uint256";
        readonly indexed: false;
    }];
    readonly anonymous: false;
}];

declare const RHLaunchpadABI: readonly [{
    readonly name: "launch";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "name";
        readonly type: "string";
    }, {
        readonly name: "symbol";
        readonly type: "string";
    }, {
        readonly name: "supply";
        readonly type: "uint256";
    }, {
        readonly name: "liquidityTokenAmount";
        readonly type: "uint256";
    }, {
        readonly name: "sqrtPriceX96";
        readonly type: "uint160";
    }, {
        readonly name: "tickLower";
        readonly type: "int24";
    }, {
        readonly name: "tickUpper";
        readonly type: "int24";
    }, {
        readonly name: "liquidityDelta";
        readonly type: "int256";
    }];
    readonly outputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "poolId";
        readonly type: "bytes32";
    }];
}, {
    readonly name: "devBuy";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "key";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "currency0";
            readonly type: "address";
        }, {
            readonly name: "currency1";
            readonly type: "address";
        }, {
            readonly name: "fee";
            readonly type: "uint24";
        }, {
            readonly name: "tickSpacing";
            readonly type: "int24";
        }, {
            readonly name: "hooks";
            readonly type: "address";
        }];
    }, {
        readonly name: "amountIn";
        readonly type: "uint256";
    }, {
        readonly name: "sqrtPriceLimitX96";
        readonly type: "uint160";
    }, {
        readonly name: "recipient";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "boughtAmount";
        readonly type: "uint256";
    }];
}, {
    readonly name: "launchHook";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "effectiveLaunchFee";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "TokenCreated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "creator";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "name";
        readonly type: "string";
        readonly indexed: false;
    }, {
        readonly name: "symbol";
        readonly type: "string";
        readonly indexed: false;
    }, {
        readonly name: "initialSupply";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly name: "DevBuyExecuted";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "buyer";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "wethIn";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "tokenOut";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}];

declare const StockRewardLauncherV4ABI: readonly [{
    readonly name: "launch";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "p";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "name";
            readonly type: "string";
        }, {
            readonly name: "symbol";
            readonly type: "string";
        }, {
            readonly name: "supply";
            readonly type: "uint256";
        }, {
            readonly name: "creatorAmount";
            readonly type: "uint256";
        }, {
            readonly name: "sqrtPriceX96";
            readonly type: "uint160";
        }, {
            readonly name: "tickLower";
            readonly type: "int24";
        }, {
            readonly name: "tickUpper";
            readonly type: "int24";
        }, {
            readonly name: "fee";
            readonly type: "uint24";
        }, {
            readonly name: "tickSpacing";
            readonly type: "int24";
        }, {
            readonly name: "admin";
            readonly type: "address";
        }, {
            readonly name: "creator";
            readonly type: "address";
        }, {
            readonly name: "buyBps";
            readonly type: "uint16";
        }, {
            readonly name: "sellBps";
            readonly type: "uint16";
        }, {
            readonly name: "guardWindowSecs";
            readonly type: "uint256";
        }, {
            readonly name: "initialBuyEth";
            readonly type: "uint256";
        }, {
            readonly name: "initialBuyMinOut";
            readonly type: "uint256";
        }, {
            readonly name: "initialBuyLimitSqrtPriceX96";
            readonly type: "uint160";
        }];
    }];
    readonly outputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "poolId";
        readonly type: "bytes32";
    }, {
        readonly name: "positionId";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getLaunch";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "id";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "token";
            readonly type: "address";
        }, {
            readonly name: "poolId";
            readonly type: "bytes32";
        }, {
            readonly name: "creator";
            readonly type: "address";
        }, {
            readonly name: "positionId";
            readonly type: "uint256";
        }, {
            readonly name: "fee";
            readonly type: "uint24";
        }, {
            readonly name: "seededToPool";
            readonly type: "uint256";
        }, {
            readonly name: "toCreator";
            readonly type: "uint256";
        }, {
            readonly name: "createdAt";
            readonly type: "uint256";
        }];
    }];
}, {
    readonly name: "getLaunchByToken";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "token";
            readonly type: "address";
        }, {
            readonly name: "poolId";
            readonly type: "bytes32";
        }, {
            readonly name: "creator";
            readonly type: "address";
        }, {
            readonly name: "positionId";
            readonly type: "uint256";
        }, {
            readonly name: "fee";
            readonly type: "uint24";
        }, {
            readonly name: "seededToPool";
            readonly type: "uint256";
        }, {
            readonly name: "toCreator";
            readonly type: "uint256";
        }, {
            readonly name: "createdAt";
            readonly type: "uint256";
        }];
    }];
}, {
    readonly name: "Launched";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "poolId";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: "creator";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "seededToPool";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "toCreator";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly name: "DevBuyExecuted";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "creator";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "ethIn";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "tokenOut";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly name: "weth";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "stockTaxHook";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "launchCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "isStockRewardToken";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}];

declare const StockRewardLauncherV2ABI: readonly [{
    readonly name: "launch";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "p";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "name";
            readonly type: "string";
        }, {
            readonly name: "symbol";
            readonly type: "string";
        }, {
            readonly name: "supply";
            readonly type: "uint256";
        }, {
            readonly name: "creatorAmount";
            readonly type: "uint256";
        }, {
            readonly name: "tickLower";
            readonly type: "int24";
        }, {
            readonly name: "tickUpper";
            readonly type: "int24";
        }, {
            readonly name: "admin";
            readonly type: "address";
        }, {
            readonly name: "creator";
            readonly type: "address";
        }, {
            readonly name: "vault";
            readonly type: "address";
        }, {
            readonly name: "buyBps";
            readonly type: "uint16";
        }, {
            readonly name: "sellBps";
            readonly type: "uint16";
        }, {
            readonly name: "dex";
            readonly type: "uint8";
        }, {
            readonly name: "initialBuyEth";
            readonly type: "uint256";
        }, {
            readonly name: "initialBuyMinOut";
            readonly type: "uint256";
        }, {
            readonly name: "initialBuyDeadline";
            readonly type: "uint256";
        }];
    }];
    readonly outputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "pool";
        readonly type: "address";
    }, {
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
}, {
    readonly name: "swapRouterOf";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "dex";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "getLaunchByToken";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "token";
            readonly type: "address";
        }, {
            readonly name: "pool";
            readonly type: "address";
        }, {
            readonly name: "creator";
            readonly type: "address";
        }, {
            readonly name: "tokenId";
            readonly type: "uint256";
        }, {
            readonly name: "feeTier";
            readonly type: "uint24";
        }, {
            readonly name: "dex";
            readonly type: "uint8";
        }, {
            readonly name: "seededToPool";
            readonly type: "uint256";
        }, {
            readonly name: "toCreator";
            readonly type: "uint256";
        }, {
            readonly name: "createdAt";
            readonly type: "uint256";
        }];
    }];
}, {
    readonly name: "DevBuyExecuted";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "creator";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "ethIn";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "minOut";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly name: "Launched";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "pool";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "creator";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "seededToPool";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "toCreator";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly name: "dexConfig";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "dex";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "factory";
        readonly type: "address";
    }, {
        readonly name: "positionManager";
        readonly type: "address";
    }, {
        readonly name: "feeTier";
        readonly type: "uint24";
    }, {
        readonly name: "tickSpacing";
        readonly type: "int24";
    }];
}, {
    readonly name: "weth";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "launchCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "isStockRewardToken";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}];
/** Keeper price feed (native/USD) the stock pool is seeded against — read live off the chain's
 *  BondingCurve keeper (the same feed the Fair-V3 path uses). Fail-closed on staleness. */
declare const StockKeeperABI: readonly [{
    readonly name: "keeperPriceUsd";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "keeperPriceUpdatedAt";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "maxPriceStale";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}];

declare const StockRewardVaultABI: readonly [{
    readonly name: "getBasket";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "rewardToken";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly name: "stock";
            readonly type: "address";
        }, {
            readonly name: "weightBps";
            readonly type: "uint16";
        }];
    }];
}, {
    readonly name: "stockAllowed";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "stock";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "priceFeed";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "stock";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly name: "holderUsdgPool";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "rewardToken";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "totalHolderUsdg";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "totalStockBought";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "stock";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "usdgFloorForAsset";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "asset";
        readonly type: "address";
    }, {
        readonly name: "amountIn";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "floor";
        readonly type: "uint256";
    }];
}];
declare const WethUsdAggregatorABI: readonly [{
    readonly name: "latestRoundData";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "roundId";
        readonly type: "uint80";
    }, {
        readonly name: "answer";
        readonly type: "int256";
    }, {
        readonly name: "startedAt";
        readonly type: "uint256";
    }, {
        readonly name: "updatedAt";
        readonly type: "uint256";
    }, {
        readonly name: "answeredInRound";
        readonly type: "uint80";
    }];
}, {
    readonly name: "decimals";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
    }];
}, {
    readonly name: "description";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "string";
    }];
}];

declare const MerkleStockDistributorABI: readonly [{
    readonly name: "epochCount";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "epochs";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "epoch";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "stock";
        readonly type: "address";
    }, {
        readonly name: "root";
        readonly type: "bytes32";
    }, {
        readonly name: "totalAmount";
        readonly type: "uint256";
    }, {
        readonly name: "claimedAmount";
        readonly type: "uint256";
    }, {
        readonly name: "createdAt";
        readonly type: "uint40";
    }, {
        readonly name: "claimDeadline";
        readonly type: "uint40";
    }, {
        readonly name: "closed";
        readonly type: "bool";
    }];
}, {
    readonly name: "hasClaimed";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "epoch";
        readonly type: "uint256";
    }, {
        readonly name: "account";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "unclaimed";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "epoch";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "claim";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "epoch";
        readonly type: "uint256";
    }, {
        readonly name: "stock";
        readonly type: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }, {
        readonly name: "proof";
        readonly type: "bytes32[]";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "claimFor";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "epoch";
        readonly type: "uint256";
    }, {
        readonly name: "account";
        readonly type: "address";
    }, {
        readonly name: "stock";
        readonly type: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }, {
        readonly name: "proof";
        readonly type: "bytes32[]";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "claimForMany";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "epochIds";
        readonly type: "uint256[]";
    }, {
        readonly name: "accounts";
        readonly type: "address[]";
    }, {
        readonly name: "stocks";
        readonly type: "address[]";
    }, {
        readonly name: "amounts";
        readonly type: "uint256[]";
    }, {
        readonly name: "proofs";
        readonly type: "bytes32[][]";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}];

/**
 * Error classes for the HookOS SDK.
 */
declare class HookOSError extends Error {
    constructor(message: string);
}
declare class WalletRequiredError extends HookOSError {
    constructor(operation: string);
}
declare class TransactionError extends HookOSError {
    readonly txHash?: string;
    readonly reason?: string;
    constructor(message: string, opts?: {
        txHash?: string;
        reason?: string;
    });
}
declare class ChainError extends HookOSError {
    constructor(chainId: number);
}
declare class ContractCallError extends HookOSError {
    readonly contractName: string;
    readonly method: string;
    constructor(contractName: string, method: string, message: string);
}
declare class ValidationError extends HookOSError {
    readonly field: string;
    constructor(field: string, message: string);
}
declare class IndexerError extends HookOSError {
    readonly statusCode?: number;
    constructor(message: string, statusCode?: number);
}

export { ADDRESSES, type ActiveBoost, ArenaABI, ArenaModule, type AttachHookParams, type BattleInfo, BattleStatus, BondingCurveABI, type BuyQuote, CREATOR_FEE_BPS, type Candle, ChainError, type ChainId, type ContractAddresses, ContractCallError, type CreateBattleParams, type CreateTokenParams, type CurveState, DEFAULT_REWARD_SYMBOL, DEFAULT_TAX_BPS, type DetachHookParams, type DevBuyResult, type EventInfo, EventStatus, EventsABI, EventsModule, FIXED_CUT_BPS, FLYWHEEL_BPS, type FairLaunchParams, FeeModule, FeeRouterABI, type FeeShare, type FeeSplitPreview, FeedBoostAuctionABI, FeedBoostModule, HOOKOS_V3_ADDRESSES, HOOKOS_V3_ADDRESSES_BY_CHAIN, HOOKOS_V3_CHAIN_ID, HOOKOS_V3_SUPPORTED_CHAIN_IDS, type HookBinding, type HookBrowseFilters, type HookInfo, HookManagerABI, HookModule, HookOS, HookOSError, type HookOSOptions, type HookOSV3Addresses, HookOSV3BuybackABI, HookOSV3FeeVaultABI, HookOSV3LauncherABI, HookPoint, HookRegistryABI, IndexerError, type IndexerHook, type IndexerStats, type IndexerToken, MAX_SQRT_RATIO, MAX_TAX_BPS, MIN_SQRT_RATIO, MIN_TAX_BPS, MerkleStockDistributorABI, PLATFORM_NET_BPS, type PlaceBidBatchParams, type PlaceBidParams, type PriceUpdate, QUICK_LAUNCH_ADDRESSES, QUICK_LAUNCH_CHAIN_ID, QUICK_LAUNCH_FEE_TIER, QUICK_LAUNCH_TARGET_MCAP_USD, QUICK_LAUNCH_TICK_SPACING, type QuickLaunchAddresses, type QuickLaunchBuildResult, QuickLaunchModule, type QuickLaunchOptions, type QuickLaunchResult, RHLaunchpadABI, RH_TICK_SPACING, RPC_ENDPOINTS, type RegisterHookParams, RewardMode, STOCK_REWARD_ADDRESSES, STOCK_REWARD_CHAIN_ID, STOCK_TARGET_MCAP_USD, STOCK_UNIVERSE, STOCK_V4_FEE_TIER, STOCK_V4_GUARD_WINDOW_SECS, STOCK_V4_TICK_SPACING, type SellQuote, Side, type SlotConfig, type SlotInfo, type StockBasketEntry, type StockClaimParams, type StockEpoch, StockKeeperABI, type StockLaunchOptions, type StockLaunchParamsV2, type StockLaunchParamsV4, type StockLaunchResult, type StockRef, type StockRewardAddresses, StockRewardLauncherV2ABI, StockRewardLauncherV4ABI, StockRewardModule, StockRewardVaultABI, type Timeframe, type TokenCreateResult, TokenFactoryABI, type TokenInfo, type TokenListParams, TokenModule, type TradeResult, TradingModule, TransactionError, type TxResult, type V3BuildLaunchOptions, type V3BuildLaunchResult, V3Dex, type V3FairLaunchParams, type V3FeeTier, type V3LaunchInfo, V3LaunchModule, type V3LaunchParams, type V3LaunchResult, type V3MineSaltResult, V3PairToken, V3_DEFAULT_FEE_TIER, V3_FEE_TIERS, V3_MAX_SQRT_RATIO, V3_MIN_SQRT_RATIO, V3_TICK_SPACING, ValidationError, WEIGHT_TOTAL_BPS, type WagerParams, WalletRequiredError, WethUsdAggregatorABI, buildStockLaunchParamsV4, computeFairLaunchParams, computeV3FairLaunchParams, draftToBasketEntries, equalWeights, getAddresses, getHookOSV3Addresses, getQuickLaunchAddresses, getRpcPool, getStockRewardAddresses, splitForTax, stockBySymbol, tickSpacingForFee };
