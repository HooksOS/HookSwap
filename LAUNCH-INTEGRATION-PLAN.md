# HookSwap ← @hookos/sdk — Launch Integration Plan

> Concrete, facts-based plan to bring HookSwap's token-creation up to the full
> `INTEGRATE-HOOKOS-LAUNCH.md` spec (5 mechanisms via `@hookos/sdk`, multi-chain).
> API below is read from the REAL SDK at `/Users/admin/Desktop/HookDev/protocol/sdk`
> (`@hookos/sdk@0.5.0`) — the contract of record. Written 2026-07-22.

## 1. Current state (audited — facts)
- HookSwap wires **only** `HookOSV3Launcher` via **hand-written ABIs** (`apps/web/src/terminal/launchpad/{abis,addresses,useLaunch}.ts`), **Robinhood-only** (`LAUNCHPAD_ADDRESSES` = { Robinhood } only), even though the contract is live on 6 chains.
- `/token/new` = `HookSwapTokenFactory` plain fixed-supply ERC-20 (`terminal/tokenfactory/*`).
- **`@hookos/sdk` is NOT a dependency and is used nowhere.** Addresses are hardcoded — violates the integration doc's "never hardcode; the SDK is the engine" rule.
- Live surfaces: `/launch` (v3 fair launch), `/token/new` (ERC-20). Missing: bonding-curve, quick-launch, stock-reward, multi-chain, and the SDK-as-engine architecture.

## 2. Real SDK API (verified from src)
`new HookOS({ chainId, walletClient, publicClient?, rpcUrl? })` — `chainId` defaults 8453; `walletClient` = a viem WalletClient (wagmi provides one). Client module properties (confirmed in `client.ts`):
- `hookos.tokens` — **TokenModule** (bonding curve). `create(params: CreateTokenParams): Promise<TokenCreateResult>` + `getEffectiveLaunchFee()`, `list()`, `get(addr)`.
- `hookos.v3` — **V3LaunchModule** (direct-to-v3, 6 chains). `launch(params: V3LaunchParams, value?): Promise<V3LaunchResult>`, `buildLaunchParams(o: V3BuildLaunchOptions)`, `quoteLaunchCost(lockOnHookSwap, initialBuyEth)`, `getEffectiveLaunchFee()`, `mineSalt(...)`, `getLaunch(id)`, `getLaunchByToken(token)`, `getCreatorShareBps(dex)`.
- `hookos.quickLaunch` — **QuickLaunchModule** (RHLaunchpad direct-to-v4, Robinhood). `launch(opts: QuickLaunchOptions): Promise<QuickLaunchResult>`, `buildLaunchParams(opts)`, `devBuy({token, amountInEther, recipient?})`, `getEffectiveLaunchFee()`.
- `hookos.stock` — **StockRewardModule** (Robinhood stock-reward v4). `launch(opts: StockLaunchOptions): Promise<StockLaunchResult>`, `getBasket(rewardToken)`, `getWethUsdPrice()`, `claim(params)`, `getEpoch`, `hasClaimed`, `getUnclaimed`. Constants exported: `STOCK_UNIVERSE`, `stockBySymbol`, `equalWeights`, `draftToBasketEntries`, `buildStockLaunchParamsV4`, tax-bps bounds.
- `hookos.fees` — FeeModule. Param interfaces in `sdk/src/types.ts`: `CreateTokenParams:22`, `V3LaunchParams:306`, `V3BuildLaunchOptions:331`, `StockLaunchOptions:570`, `QuickLaunchOptions:634`. `launch-math.ts` exports `computeV3FairLaunchParams`, `computeFairLaunchParams`, `tickSpacingForFee`, `V3_FEE_TIERS`.

## 3. OPEN DECISION — dependency strategy (needs Reggie)
The SDK is an **external local repo** (`../protocol/sdk`), NOT published to npm, and the **deploy box has no `/Users/admin/...` paths**. So a `file:` link works locally but breaks the box build. Pick one:
- **(A) Publish `@hookos/sdk` to npm** (or a private registry) → HookSwap adds a normal versioned dep. Cleanest; matches the doc's "bump the SDK when HookOS redeploys" re-sync rule. **Recommended.**
- **(B) Vendor the SDK** into HookSwap (`vendor/hookos-sdk`, like `vendor/sdk-core`) + a `resolutions`/`file:` override. Works on the box but manual re-sync.
- Either way: run install so the import resolves before any SDK code can typecheck.

## 4. Build order (mechanism-by-mechanism, each typechecked)
**Phase 0 — foundation:** resolve §3, install the dep, add `apps/web/src/terminal/launchpad/useHookOS.ts` → `useHookOS(chainId)` building `new HookOS({ chainId, walletClient })` from wagmi's `useWalletClient()`. A shared `<LaunchShell>` with a **chain selector** + honest per-chain availability gating (from the SDK address resolver / `getAddresses`).
**Phase 1 — refactor `/launch` to the SDK (reference impl):** replace `useLaunch.ts`'s hand-wired `hookOSV3LauncherAbi`/`quoteLaunchCost` with `hookos.v3.buildLaunchParams` + `hookos.v3.launch` + `hookos.v3.getEffectiveLaunchFee`. Immediately unlocks the other 5 chains (no more RH-only). Keep the existing form UX; swap the engine. Delete `launchpad/abis.ts` launcher ABI + `LAUNCHPAD_ADDRESSES` once nothing reads them (keep FeeVault reads for the LP-lock badge, or move them to the SDK too).
**Phase 2 — Quick Launch (`/launch/quick`, Robinhood):** new screen → `hookos.quickLaunch.launch` + `devBuy`. Fee via `getEffectiveLaunchFee`.
**Phase 3 — Bonding-curve (`/launch/curve`, 6 chains):** new screen → `hookos.tokens.create` (CreateTokenParams). Show the curve→v4 graduation model; per-chain gating.
**Phase 4 — Stock-Reward v4 (`/launch/stock`, Robinhood):** the richest — reward-basket picker (`STOCK_UNIVERSE`/`stockBySymbol`/`equalWeights`), tax-bps slider (MIN/MAX/DEFAULT_TAX_BPS), fee-split preview (CREATOR/FLYWHEEL/PLATFORM bps), `getWethUsdPrice`; submit via `hookos.stock.launch`. Later: `getBasket`/`claim` holder UX.
**Phase 5 — polish:** unified success screen (token addr + "Trade in HookSwap" link + optional signed site-config save to the HookOS API), live fee display (native+USD) in `msg.value`, mobile parity, a short README (wired mechanisms + per-chain availability + SDK-bump steps).

## 5. Constraints (from the doc + repo rules)
- **Never hardcode launch addresses** — the SDK resolves per chain. Off-chain bits (site-config save, stock Merkle claim proofs) call the HookOS API/indexer directly.
- Every control wired to a real SDK call OR honestly disabled/"soon" per `isDeployed` gating — no fake success. Typecheck clean each phase. **Do NOT deploy or move funds; ask before any irreversible action** (per the doc).
- Sepolia-first for anything that touches a contract test.

## 6. Execution note
Large multi-session workstream. Phases are independent screens → ideal to fan out with subagents (one per mechanism) once the session limit resets and Phase 0 (dep + `useHookOS`) is committed. Phase 1 is the highest-value single step (SDK engine + 5 new chains for the launch we already ship).
