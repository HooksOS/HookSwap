# HookSwap — DefiLlama adapters

Adapters that list **HookSwap** (a self-hosted Uniswap **v2 + v3** fork, `supportsV4:false` — no v4/hooks
on-chain) on DefiLlama. Two independent DefiLlama systems, so two files:

| File (here) | DefiLlama repo | Goes at | Produces |
|---|---|---|---|
| `hookswap/index.js` | [`DefiLlama/DefiLlama-Adapters`](https://github.com/DefiLlama/DefiLlama-Adapters) | `projects/hookswap/index.js` | **TVL** |
| `dexs/hookswap/index.ts` | [`DefiLlama/dimension-adapters`](https://github.com/DefiLlama/dimension-adapters) | `dexs/hookswap/index.ts` | **Volume + Fees** (one file drives both the /dexs and /fees dashboards) |
| `chainlist/chainid-4326.js` | [`DefiLlama/chainlist`](https://github.com/DefiLlama/chainlist) | `constants/additionalChainRegistry/chainid-4326.js` | **MegaETH chain registration** (needed to unblock MegaETH — see below) |

Everything below is **verified**, not assumed. Every address comes from `contracts/deployments/<chain>.json`
(and `pools-seeded.json`) in this repo, and every DefiLlama-side fact was read live on **2026-07-23**
(providers.json / chains.json / env.ts / the sdk providers file — see "Evidence").

---

## What is wired

HookSwap is an own-deployed Uniswap **v2 + v3** stack per chain. **All real liquidity is in v2 pools**
(confirmed on-chain 2026-07-23, `contracts/deployments/pools-seeded.json`): each pool is the chain's
wrapped-native paired against a **real stablecoin** (dust/proof depth — routing-proven via `getAmountsOut`,
not deep liquidity yet). v3 factories are deployed everywhere but hold **no confirmed liquidity**, so v3 is
intentionally disabled in both adapters.

### Coverage

| Chain (id) | sdk key (providers.json) | v2Factory | Real v2 pool | TVL adapter | Fees adapter | Notes |
|---|---|---|---|---|---|---|
| Robinhood (4663) | `robinhoodchain` | `0xD1Cf664944173140AFc302c169eFD55c24966B45` | WETH/USDG `0xF7ddC383…` (priced) | ✅ enabled | ✅ enabled | slug discrepancy: fees adapter uses `robinhood` (see below) |
| Ink (57073) | `ink` | `0xD1Cf664944173140AFc302c169eFD55c24966B45` | WETH/USD₮0 `0xB738BBaC…` | ✅ enabled | ✅ enabled | |
| XLayer (196) | `xlayer` | `0xD1Cf664944173140AFc302c169eFD55c24966B45` | STT/WOKB (pre-existing seed) | ✅ enabled | ✅ enabled | canonical nonce-0 factory; STT is a test token → priced $0, WOKB priced |
| HyperEVM (999) | `hyperliquid` | `0xB92598Fa464B96FEC394a17A269Ad18060Ec60B2` | WHYPE/USDC `0x8628AfE8…` | ✅ enabled | ✅ enabled | HookSwap "HyperEVM" == sdk `hyperliquid` |
| Stable (988) | `stable` | `0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA` | WgUSDT/USDT0 `0x7F902372…` | ✅ enabled | ✅ enabled | `stable`/988 **is** in providers.json (rpc `https://rpc.stable.xyz`) |
| **MegaETH (4326)** | — (absent) | `0xD1Cf664944173140AFc302c169eFD55c24966B45` | WETH/USDm `0xAD12931B…` | ⛔ blocked | ⛔ blocked | **DefiLlama-side blocker** — see "MegaETH" below |
| Tempo (4217) | — (absent) | `0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4` | none | ⬜ off | ⬜ off | AA-native tokens revert on approve/transfer → no v2 pair exists |

**TVL enabled: Robinhood, Ink, XLayer, HyperEVM, Stable (5).**
**Fees enabled: Robinhood, Ink, XLayer, HyperEVM, Stable (5).**
**Blocked: MegaETH (has a real pool, needs a chain registration).** **Off: Tempo (no pool).**

Fee model (both adapters): HookSwap v2 charges **0.30%** (`feeTier` 3000, verified via data-api /v1/pools +
canonical UniswapV2 constant-product). The fees adapter sets `revenueRatio: 0` → **dailyRevenue = 0**
(protocol fee switch `feeTo` is unset), **dailySupplySideRevenue = 100%** of fees to LPs.

### Selected token references (from deployments)

| Chain | wrapped-native | stablecoin |
|---|---|---|
| Robinhood | WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6-dec) |
| Ink | WETH `0x4200000000000000000000000000000000000006` | USD₮0 `0x0200C29006150606B650577BBE7B6248F58470c1` (6-dec) |
| HyperEVM | WHYPE `0x5555555555555555555555555555555555555555` | USDC `0xb88339cb7199b77e23db6e890353e22632ba630f` (6-dec) |
| Stable | WgUSDT `0x817997ca8394e26cce3de3a076a4889b27dbf9de` (18-dec) | USDT0 `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` (6-dec) |
| MegaETH | WETH `0x4200000000000000000000000000000000000006` | USDm `0xfafddbb3fc7688494971a79cc65dca3ef82079e7` (18-dec) |

---

## Data source chosen (and why)

**On-chain reads**, the idiomatic DefiLlama path — NOT a subgraph, NOT the HookSwap data-api.

- **No public subgraph** exists for HookSwap. HookSwap self-hosts `data.hookswap.org` (returns USD
  TVL/volume) but DefiLlama's frameworks expect DefiLlama-priced, on-chain-derived numbers, so the
  data-api is used only as a cross-check.
- **TVL** = `getUniTVL({ chain, factory, useDefaultCoreAssets:true })` (`helper/unknownTokens`): enumerates
  pairs via `allPairsLength()/allPairs()` and sums reserves; DefiLlama prices the tokens.
- **Volume + Fees** = `uniV2Exports(config, { methodology })` (`helpers/uniswap`): reads UniswapV2 `Swap`
  events per pair; `fees:0.003`, `revenueRatio:0`, per-chain `start` (a conservative log-scan lower bound).
- **Unpriced test tokens → $0.** Only genuinely-priced reserves/volume count. Honest, not fabricated.

---

## ⚠️ Chain-registration / slug facts (verified live 2026-07-23)

### 1. Robinhood slug discrepancy (must be reconciled with maintainers in the PR)
| Where | Robinhood string |
|---|---|
| `@defillama/sdk` providers.json (carries RPC + chainId 4663) | **`robinhoodchain`** |
| DefiLlama-Adapters `projects/helper/chains.json` | `robinhood` |
| dimension-adapters `helpers/chains.ts` `CHAIN.ROBINHOOD` | `robinhood` |
| dimension-adapters `helpers/env.ts` RPC override | `ROBINHOOD_RPC = https://rpc.mainnet.chain.robinhood.com` |

- **TVL adapter** keys Robinhood as **`robinhoodchain`** (the only sdk providers.json slug that carries the
  RPC — `getUniTVL` resolves the RPC via the sdk).
- **Fees adapter** keys Robinhood as **`robinhood`** (`CHAIN.ROBINHOOD`) — dimension-adapters resolves its
  RPC from `helpers/env.ts` `ROBINHOOD_RPC`, not from the sdk providers slug. So each adapter correctly
  uses the string its own harness understands. If DefiLlama's TVL harness attributes the chain off
  `chains.json` (`robinhood`) it must alias `robinhood ⇄ robinhoodchain`. Each adapter isolates this in a
  single key, so aligning is a 1-line change.

### 2. Stable (988) — already registered (good news)
`stable` IS in `@defillama/sdk` providers.json with chainId 988 and rpc `https://rpc.stable.xyz`
(+ sentio), matching this repo's `contracts/deployments/stable.json` / `pools-seeded.json`. No new-chain PR
needed — enabled directly under key `stable` in both adapters.

### 3. Ink / XLayer / HyperEVM — already registered
`ink` (57073), `xlayer` (196), `hyperliquid` (999) are all present in providers.json (and `xlayer`/
`hyperliquid` also have `helpers/env.ts` RPC overrides). Enabled directly. HookSwap's "HyperEVM" == sdk
`hyperliquid` (both chainId 999).

### 4. MegaETH (4326) — the ONE genuine DefiLlama-side blocker
MegaETH has a **real** WETH/USDm v2 pool, but chainId 4326 is **absent** from:
- `@defillama/sdk` providers.json (no `megaeth` key, no key with chainId 4326), **and**
- dimension-adapters `helpers/env.ts` (no `MEGAETH_RPC`).

`CHAIN.MEGAETH="megaeth"` exists in the dimension-adapters enum and `"megaeth"` is listed in
DefiLlama-Adapters `projects/helper/chains.json`, but **neither carries an RPC** — the sdk providers.json is
what resolves on-chain reads, and it lacks 4326. So `getUniTVL('megaeth')` / the fees harness cannot resolve
an RPC. This is **not fixable from the adapter files alone**.

**To unblock (one-file DefiLlama PR):** submit `chainlist/chainid-4326.js` (in this repo, ready-to-go —
verified RPC `https://mainnet.megaeth.com/rpc` returning `eth_chainId` 0x10e6 == 4326, explorer + native
symbol from this repo's own `megaeth.ts`) to `DefiLlama/chainlist` as
`constants/additionalChainRegistry/chainid-4326.js`. Optionally also add
`MEGAETH_RPC=https://mainnet.megaeth.com/rpc` to dimension-adapters `helpers/env.ts` for the fees side.
Once merged, uncomment the two clearly-marked `megaeth` lines (one in each adapter).

### 5. Tempo (4217) — off, two independent reasons
(1) **No usable pool:** Tempo's account-abstraction-native tokens (pathUSD/USDC.e) revert on `approve()` and
on plain EOA `transfer()`, and `v2Factory.createPair` failed → no v2 pair exists
(`pools-seeded.json` → `blocked.tempo_4217`). (2) chainId 4217 / `tempo` is absent from providers.json
anyway. Left off in both adapters with a comment.

---

## v3 handling

**Disabled on every chain.** v3 factories are deployed but hold no confirmed liquidity; enabling
`uniV3Export`/`getUniV3LogAdapter` would run a per-chain `PoolCreated` log scan (needing the exact
v3Factory deploy block) that returns nothing. Both adapter files carry the per-chain v3Factory addresses
and a ready-to-enable snippet for when v3 liquidity is seeded.

v3Factory per chain: robinhood/ink/megaeth `0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3`,
xlayer `0xAB34Bb3767020059A35e71D03f13E9e4fbCD07aC`, hyperevm `0x45DB3eaE624dBcA631A9C6C1406DA0B8F6Fb275A`,
stable `0xf486e625C892C0739A16A3A49B37fD52374B30CB`.

---

## Steps to actually list HookSwap on DefiLlama

1. **DefiLlama-Adapters PR** — add `projects/hookswap/index.js`. (Optional, improves pricing) add HookSwap
   tokens to `projects/helper/tokenMapping.js`.
2. **dimension-adapters PR** — add `dexs/hookswap/index.ts`.
3. **DefiLlama/chainlist PR** (only to unblock MegaETH) — add `constants/additionalChainRegistry/chainid-4326.js`.
4. **Protocol metadata** — register HookSwap (name, logo, url `https://hookswap.org`, category `Dexes`,
   chains) as part of PR review.

### Testable now vs. blocked
- **Testable now:** `node --check hookswap/index.js` passes; `chainlist/chainid-4326.js` passes ESM check;
  `dexs/hookswap/index.ts` transpiles clean under esbuild; all addresses/chainIds/RPCs/slug facts verified
  against providers.json / chains.json / env.ts / on-chain `eth_chainId`.
- **Blocked on the DefiLlama toolchain (not this repo):** actually *running* the adapters needs
  `@defillama/sdk` + each repo's helpers installed; and MegaETH needs the chainlist merge above.

---

## Evidence (verified 2026-07-23)
- `@defillama/sdk` providers.json (`https://unpkg.com/@defillama/sdk/build/providers.json`): keys present —
  `robinhoodchain` (4663), `ink` (57073), `xlayer` (196), `hyperliquid` (999), `stable` (988).
  **Absent:** `robinhood`, `megaeth`, any key with chainId 4326, `tempo`.
- dimension-adapters `helpers/chains.ts`: `ROBINHOOD="robinhood"`, `INK="ink"`, `XLAYER="xlayer"`,
  `HYPERLIQUID="hyperliquid"`, `STABLE="stable"`, `MEGAETH="megaeth"`, `TEMPO="tempo"`.
- dimension-adapters `helpers/env.ts`: `ROBINHOOD_RPC`, `XLAYER_RPC`, `HYPERLIQUID_RPC` set; **no**
  `MEGAETH_RPC`, no `TEMPO_RPC`, no `STABLE_RPC`/`INK_RPC` (latter two resolve via sdk).
- DefiLlama-Adapters `projects/helper/chains.json`: lists `robinhood`, `ink`, `xlayer`, `hyperliquid`,
  `stable`, `megaeth`, `tempo`.
- MegaETH RPC live: `POST https://mainnet.megaeth.com/rpc eth_chainId` → `0x10e6` == 4326.
- `uniV2Exports` signature (helpers/uniswap.ts): `uniV2Exports(config, { ...rootOptions })` spreads root
  options (methodology) into the SimpleAdapter; per-chain `UniV2Config` accepts `{ factory, fees, start,
  revenueRatio }` (`revenueRatio:0` ⇒ dailyRevenue 0, dailySupplySideRevenue = full fees).
- Addresses: all verbatim from `contracts/deployments/<chain>.json` + `pools-seeded.json` in this repo.
