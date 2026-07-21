# HookSwap — Multi-Chain Uniswap v4 Enablement Plan

> Goal: enable **Uniswap v4 swaps across HookSwap's chains**, config-driven, so a
> token like **HOOK** (a v4-only token on Robinhood) becomes quotable + swappable
> in the HookSwap interface. Draft — `2026-07-21`. Per-chain address matrix (§4) is
> being verified on-chain; sections marked _pending_ finalize as that completes.

## 0. Decision gate (needs Reggie)
This **reverses the LOCKED "v4 excluded" decision** (2026-07-03, CLAUDE.md). Nothing
below ships until that's reversed. The plan is written to honor the other LOCKED
rules: **config-driven venue registry, no `Settlement`/contract redeploy to add a
market or venue** (2026-07-19 extensibility rule), and **multi-DEX / multi-version**
(Hook v2/v3, Uniswap v2/v3/v4, Pancake v2/v3/v4).

## 1. Why the current build cannot swap v4 (verified facts, not assumptions)
- Every HookSwap chain sets **`supportsV4: false`** (`robinhood.ts:104`, etc.).
- HookSwap's **own** deployed Universal Routers were constructed with
  **`v4PoolManager = address(0)`** → they physically **cannot execute `V4_SWAP`**
  (would revert). The UR resolver `apps/web/src/constants/hookswapUniversalRouter.ts`
  returns those own URs for the 6 custom chains.
- The embed adapter / SOR discovers **only v2/v3** pools; it emits no v4 route.
- **Result:** HOOK (`0x85d4…5f97`, Robinhood 4663) — liquidity confirmed in the
  canonical **Uniswap v4 PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951`**
  (verified: responds to `extsload(bytes32)` + `owner()`), with **zero** HookSwap
  v2/v3 pools — is unquotable and unswappable today.

## 2. Design principle — config-driven venue registry
No redeploy to add a venue. A per-chain, per-protocol registry is the backbone:

```
VENUES[chainId] = {
  v2: { factory },                                   // HookSwap own (existing)
  v3: { factory, quoter },                           // HookSwap own (existing)
  v4: { poolManager, positionManager, stateView,     // canonical Uniswap v4
        quoter, universalRouter },                   //   (per §4, where it exists)
}
```

AMM adapters (v2 constant-product · v3 concentrated · **v4 singleton + hooks**) sit
behind ONE interface; the router consumes price/liquidity through adapters. Adding a
chain or venue = a registry entry, never a `Settlement`/router redeploy. Extends
cleanly to Pancake v2/v3/v4 (BSC) and Uniswap v4 on every chain.

## 3. Execution model — reuse canonical v4 infra, avoid redeploys
Uniswap v4 exists only where Uniswap (or a partner, e.g. Robinhood) deployed it — and
**those deployments ship a v4-capable canonical Universal Router + PositionManager +
StateView + Quoter alongside the PoolManager.** Therefore:

- **Path B (preferred — no funded key, no redeploy):** for a **v4 leg** on a chain
  that HAS canonical Uniswap v4, route through the **canonical Uniswap Universal
  Router** (from §4), not HookSwap's own UR. HookSwap's own UR keeps handling v2/v3.
- **Path A (only for v4 on a chain with NO canonical Uniswap v4):** HookSwap must
  **deploy its own v4 stack** (PoolManager + periphery + v4-capable UR) and seed
  liquidity — large lift, funded key required. Deferred unless a specific v4-less
  target chain needs it.

**Decision:** adopt **Path B per chain**; invoke Path A only where a business case
demands v4 on a chain the matrix shows has none.

## 4. Per-chain Uniswap v4 availability matrix (on-chain verified)
`YES` = canonical Uniswap v4 confirmed on-chain. Addresses only listed once
`eth_getCode`-confirmed. _pending_ = discovery agent still running.

| Chain | id | Uniswap v4? | PoolManager | Periphery (PM / StateView / V4Quoter) | v4-capable UR |
|---|---|---|---|---|---|
| Robinhood | 4663 | **YES** | `0x8366a39cc670b4001a1121b8f6a443a643e40951` ✓ | PM `0x58daec3116aae6D93017bAAea7749052E8a04fA7` · SV `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b` · Q `0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94` ✓ | `0x8876789976dEcBfCbBbe364623C63652db8C0904` ✓ ⚠ min-hop fork |
| Sepolia | 11155111 | **YES** | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` ✓ | PM `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` · SV `0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c` · Q `0x61b3f2011a92d183c7dbadbda940a7555ccf9227` ✓ | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` ✓ |
| Ink | 57073 | **YES** | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` ✓ | PM `0x1b35d13a2e2528f192637f14b05f0dc0e7deb566` · SV `0x76fd297e2d437cd7f76d50f01afe6160f86e9990` · Q `0x3972c00f7ed4885e145823eb7c655375d275a1c5` ✓ | `0x112908dac86e20e7241b0927479ea3bf935d1fa0` ✓ |
| MegaETH | 4326 | **YES** | `0xacb7e78fa05d562e0a5d3089ec896d57d057d38e` ✓ | PM `0x9ae0921e981aaa7308f176f8d4f9129b9247c89d` · SV `0x726f84e1dfb8d375a365e0808282f40d52d3e4e8` · Q `0x94bdc671f0c35f44a1daa53143fd1f868d1623b9` ✓ | `0x47837eb80db5908eabba9105626d9b348bea7b02` ✓ |
| XLayer | 196 | **YES** | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` ✓ | PM `0xcf1eafc6928dc385a342e7c6491d371d2871458b` · SV `0x76fd297e2d437cd7f76d50f01afe6160f86e9990` · Q `0x8928074ca1b241d8ec02815881c1af11e8bc5219` ✓ | `0xda00ae15d3a71466517129255255db7c0c0956d3` ✓ |
| Tempo | 4217 | **YES** | `0x33620f62c5b9b2086dd6b62f4a297a9f30347029` ✓ | PM `0x3fc79444f8eacc1894775493ff3fa41f1e35ce11` · SV `0x21b954fba3f5ddebe77ef2d47a3100c066908b2a` · Q `0x20e6487c371a2086f841ef453f85378223df4f4e` ✓ | `0xa2dc7d0266f0cc50b3eeaf36c9bfcecff1beea91` ✓ |
| HyperEVM | 999 | **NO** | none — checked v4 docs + deterministic `0x0000…8A90` + CREATE2 addr, all no-code | — | **Path A** (deploy own) if wanted |

**Verdict: 6 / 7 chains have canonical Uniswap v4 → Path B (config-only, no redeploy).**
Only **HyperEVM (999)** lacks it → Path A (own v4 deploy) only if v4 is wanted there.
Notes: Ink & XLayer share the CREATE2 PoolManager address `0x360e…fb32` (distinct
owners — separate legit deploys); Tempo's v4 UR `0xa2dc7d02…` is the same address
CLAUDE.md already records as Tempo's "reference" UR; Robinhood's v4 UR
`0x8876…C0904` is a `minHopPriceX36` fork (see §5.3).

## 5. Code changes (chain-agnostic)

### 5.1 SDK addresses (`vendor/sdk-core` + v4-sdk)
- Add v4 fields to `CHAIN_TO_ADDRESSES_MAP` per **capable** chain: `v4PoolManager`,
  `v4PositionManager`, `v4StateView`, `v4Quoter`. `@uniswap/v4-sdk@1.29.1` is **already
  installed** (`apps/web/package.json:216`) — no new dep.

### 5.2 Chain flags + addresses
- Flip **`supportsV4: true`** ONLY for chains with a verified §4 deployment.
- Add the v4 addresses to each capable chain's `evm/info/<chain>.ts`.

### 5.3 Universal Router resolution — make it v4-aware
- `hookswapUniversalRouter.ts` today returns HookSwap's own UR for custom chains
  (v4-incapable). Change it to be **protocol/route-aware**: for a **v4** route on a
  capable chain, return the **canonical v4 UR** (§4); keep the own UR for v2/v3.
- **`minHopPriceX36` calldata shim gating is per-UR-fork, NOT own-vs-canonical.**
  Confirmed on-chain: Robinhood's *canonical v4 UR* `0x8876…C0904` is **itself a
  min-hop fork** (6-field V2/V3 swap inputs), so v4 swaps on RH **still need the
  shim**. Sepolia/Ink/MegaETH/XLayer/Tempo canonical URs are standard 5-field → **no
  shim**. So gate the shim by a per-chain `urIsMinHopFork` flag (true for Robinhood's
  URs — both the `0x3D3013…` v2/v3 one and the `0x8876…` v4 one), not by "is it ours".

### 5.4 Quoting / routing (the adapter) — the real work
The interface speaks the Trading API schema; the embed adapter must return v4 routes.
- **(i) Full:** extend the SOR fork with v4 pool discovery (`StateView.getSlot0` + tick
  data) + v4 quoting + UR-v4 calldata → multi-hop v4 routing. Larger effort.
- **(ii) Lightweight (recommended Phase 1):** adapter calls the on-chain **`V4Quoter`
  `quoteExactInputSingle`** for configured v4 pools and assembles UR-v4 calldata via
  `@uniswap/v4-sdk`. Ships **single-hop v4 fast** — enough to swap HOOK.
- Either way, emit the Trading API **`V4Pool`** route shape (adapter
  `tradingApiTypes.ts` already carries v4 refs) so the interface renders it.

### 5.5 Client calldata
- `useUniversalRouter.ts` uses `universal-router-sdk@4.33.0` (V4_SWAP-capable) + v4-sdk
  actions. Ensure the v4 route's UR = the canonical v4 UR (via §5.3).

## 6. Rollout phases
- **Phase 0 — decision:** Reggie reverses v4-exclusion (§4 addresses already verified).
- **Phase 1 — Sepolia + Robinhood (proof):** wire v4 addresses + `supportsV4:true` +
  canonical-UR v4 path + adapter single-hop v4 quoting. Validate on **Sepolia first**
  (mandatory-validation-chain rule) then **swap HOOK end-to-end on Robinhood** on a
  small amount — the proof the whole path works. RH also exercises the min-hop shim on
  v4 (§5.3); Sepolia exercises the standard path. Two forks proven in one phase.
- **Phase 2 — Ink, MegaETH, XLayer, Tempo:** all Path B — same wiring, **config-only**
  (addresses in §4). No redeploy, no funded key.
- **Phase 3 — HyperEVM (999), only if v4 wanted there:** Path A — deploy own v4 stack +
  seed liquidity (funded key). Deferred; no canonical Uniswap v4 exists on 999.
- **Multi-DEX:** Pancake v4 (BSC) + Uniswap v4 (all chains) via the same registry —
  adapter modules + config, no `Settlement` change.

## 7. What needs Reggie
- Reverse the locked v4-exclusion decision (Phase 0).
- Path A chains only: funded key for v4 deploy + liquidity. Path B chains: nothing.
- Confirm the §4 discovered addresses before GA.

## 8. Risk / validation gates
- **One real v4 swap on RH (HOOK)** proves the client calldata ↔ canonical v4 UR
  compat byte-for-byte — cannot be proven by static reading.
- **v4 hooks:** some v4 pools attach hooks that alter swap math; the quoter must
  simulate against the pool's actual hook. Routing THROUGH a hooked pool is fine (the
  hook is the pool's, not HookSwap's) — surface hook presence honestly in the UI.
- **Liquidity:** HOOK is near-illiquid on RH (6 transfers / 90k blocks) — even after
  wiring, quotes depend on the pool having real depth.
