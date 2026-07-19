# HookSwapPerps — perpetuals contracts

Self-hosted perpetuals for HookSwap, sourced (and rebranded) from the upstream
`meme-perp-dex` Foundry contracts. **P2P model first** (`Settlement.sol`): off-chain
EIP-712 order matching + on-chain settlement, dYdX-v3 / GMX-style. No hooks, no v4.

> ⛔ **Sepolia-first (HookSwap rule).** Every contract here must be deployed AND
> smoke-tested on **Sepolia (11155111)** before any HookSwap production chain. The
> deploy kit targets Sepolia first (`script/DeployPerps.s.sol` + `config/sepolia.json`).

---

## Architecture — the P2P model

```
        off-chain (perps-engine)                     on-chain (this repo)
  ┌───────────────────────────────┐          ┌──────────────────────────────┐
  trader signs EIP-712 Order ───▶ matching engine ──settleBatch(MatchedPair[])──▶ Settlement.sol
  (domain "HookSwapPerps",v1)      pairs long+short           │  custody + paired positions
        ▲                          picks matchPrice           │  fees, funding, PnL, liquidation
        │                          + mark price               ▼
  multi-DEX oracle adapter ◀── getMarkPrice(market) ──── ContractRegistry (per-market specs)
  (v2 reserves / v3 TWAP)                                 InsuranceFund (shortfall backstop)
                                                          SessionKeyManager (delegated signing)
```

- **`Settlement.sol`** — the core. Users deposit WETH (or ETH via `depositETH()` auto-wrap).
  An authorized matcher submits matched long/short pairs; the contract locks collateral,
  charges fees, tracks paired positions, settles PnL/funding, and liquidates. **ETH-denominated**
  (1e18). Price is a scalar the matcher supplies (`updatePrice` / `matchPrice` / exit prices) —
  it is **produced off-chain by the oracle adapter**, so pricing is DEX-agnostic with no
  contract change.
- **`SettlementV2.sol`** — alternative "Mode 2": off-chain execution + on-chain Merkle-root
  attestation + proof-gated withdrawals (dYdX/Hyperliquid notary style). USDT-denominated (1e6).
- **`ContractRegistry.sol`** — per-market contract specs (min/max order size, active flag).
- **`InsuranceFund.sol`** — absorbs shortfalls before ADL / socialized loss.
- **`SessionKeyManager.sol`** — delegated session-key signing (split out of Settlement for size).
- **`PositionManager` / `Liquidation` / `FundingRate` / `RiskManager` / `PerpVault` / `ContractSpec`**
  — the fuller on-chain-position engine + the GLP-house vault. Copied for completeness; **not**
  part of the P2P deploy (see "What is NOT deployed").

### What is NOT deployed (and why)
- **`PerpVault.sol`** (GLP/house model) — audit-flagged with **3 criticals** (`getPoolValue()`
  excludes unrealized PnL; no ADL; no per-token-liquidity OI cap — see `PERPVAULT_AUDIT_REPORT.md`
  in the source repo). Ship P2P first; harden the vault separately before any deploy.
- `PositionManager/Liquidation/FundingRate/RiskManager` — the on-chain-position variant; the P2P
  `Settlement.sol` path supersedes them for launch. Retained as source for a later iteration.

---

## Rebrand — HookSwapPerps (EIP-712 domain sync points)

The EIP-712 **domain name is a hard cross-system contract**: the domain used to *sign* an order
must match, byte-for-byte, the domain the contract uses to *recover* it — across contract, backend
matching engine, and frontend — or **every order signature fails**. Rebrand `MemePerp → HookSwapPerps`
**atomically** across all sync points:

| # | Where | Upstream | Now | Status |
|---|-------|----------|-----|--------|
| 1 | `contracts/perps/src/perpetual/Settlement.sol` (constructor `EIP712(...)`) | `"MemePerp"` | `"HookSwapPerps"` | ✅ **changed here** |
| 2 | `contracts/perps/src/perpetual/SettlementV2.sol` (constructor `EIP712(...)`) | `"SettlementV2"` ⚠️ | `"HookSwapPerpsV2"` | ✅ **changed here** |
| 3 | Backend matching engine — `backend/src/matching/config.ts` (`name:"MemePerp"`) + `server.ts`, `counter.ts`, test files | `"MemePerp"` | `"HookSwapPerps"` | 🚩 **backend agent** |
| 4 | Frontend — `frontend/src/utils/orderSigning.ts` (`name:"MemePerp"`) + `.env.local.template` `NEXT_PUBLIC_EIP712_DOMAIN_NAME` | `"MemePerp"` | `"HookSwapPerps"` | 🚩 **frontend agent** |
| +1 | `contracts/perps/src/common/SessionKeyManager.sol` (constructor `EIP712(...)`) | `"MemePerp"` | `"HookSwapPerps"` | ✅ **changed here** (5th point, discovered) |

**Two factual notes for the atomic change:**
- **SettlementV2's upstream domain was `"SettlementV2"`, NOT `"MemePerp"`** — the task listed it as a
  `MemePerp` point but on inspection it never was. Its signatures are the platform-signer withdrawal
  auths (backend), so its domain (`"HookSwapPerpsV2"`) syncs with the backend's *SettlementV2* signer
  config **independently** of the primary order domain. Keep them distinct.
- **SessionKeyManager also used `"MemePerp"`** (a 5th sync point not in the original list). It's changed
  here; whatever backend/frontend code signs session-key grants must move to `"HookSwapPerps"` too.

The `"1"` version field is unchanged everywhere.

### Security purge (done)
- Only the perpetual/common/interfaces/libraries **source** set was copied. Scanned — **no private
  keys, mnemonics, or 64-hex secrets** were copied. The upstream repo's committed plaintext relayer
  key + `SKIP_SIGNATURE_VERIFY` bypass live in `backend/` (NOT copied). **Before any live use:**
  rotate that relayer key and ensure `SKIP_SIGNATURE_VERIFY` is **disabled** in the deployed matcher.

---

## Multi-DEX oracle adapter (off-chain)

Lives in **`perps-engine/oracle/`** (TypeScript / viem). The P2P engine consumes a **scalar mark
price** off-chain, so the DEX-integration requirement (HookSwap v2/v3, Uniswap v2/v3/v4, Pancake
v2/v3/v4) is satisfied entirely in the adapter — **`Settlement.sol` is untouched**.

- `ISpotOracleAdapter { getMarkPrice(market): { price1e18, ok } }` — one scalar, decimal-normalized to 1e18.
- **v2** sub-adapter — `getReserves()` → quote/base, decimal-normalized.
- **v3** sub-adapter — `observe([window,0])` arithmetic-mean-tick TWAP → `1.0001^tick` via a canonical
  `TickMath.getSqrtRatioAtTick` port (falls back to `slot0` spot if no observation window).
- **v4** sub-adapter — documented **stub** (HookSwap is `supportsV4:false`; Uni-v4/Pancake-v4 are
  singleton PoolManagers read via `StateView.getSlot0(poolId)` — wiring plan in `v4Adapter.ts`).
- Per-market route config `{ chainId, protocol, poolAddress, quoteToken, twapWindow }`.
- Reads HookSwap pools/factories from **`contracts/deployments/*.json`** (`deployments.ts`), incl. a
  CREATE2 `computeHookSwapV2Pair()` that reproduces on-chain pair addresses for the custom chains.

See `perps-engine/README.md`. Validated end-to-end against the live XLayer seeded pool.

---

## Sepolia-first deploy

### Order (P2P stack)
`DeployPerps.s.sol` performs this in one broadcast:
1. `ContractRegistry` — per-market specs.
2. `InsuranceFund` — shortfall backstop.
3. `Settlement` — domain `("HookSwapPerps","1")`.
4. `SessionKeyManager` — domain `("HookSwapPerps","1")`.
5. Wire Settlement: `setContractRegistry` → `addSupportedToken(WETH,18)` → `setWETH(WETH)` →
   `setAuthorizedMatcher(matcher)` → `setInsuranceFund` → `setFeeReceiver` → `setFeeRate`.
6. Wire InsuranceFund: `setSettlement(settlement)` → `setAuthorizedContract(matcher,true)`.

Config inputs (Sepolia canonical) are in **`config/sepolia.json`**; WETH defaults to Sepolia
canonical `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`.

### Dependencies (not vendored)
```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-commit
forge install foundry-rs/forge-std --no-commit
```
(`foundry.toml` remaps `@openzeppelin/contracts/` and `forge-std/` to `lib/`. Upstream pinned
OZ v5 — `Ownable(msg.sender)` ctor, `utils/ReentrancyGuard.sol`, `utils/Pausable.sol` paths.)

### Dry run (ships as this — no broadcast, no key)
```bash
forge script script/DeployPerps.s.sol --rpc-url sepolia          # simulate only
```

### Real deploy — **needs Reggie's funded key**
```bash
PRIVATE_KEY=<funded> MATCHER_ADDRESS=<real matcher pubkey> \
forge script script/DeployPerps.s.sol --rpc-url sepolia --private-key $PRIVATE_KEY --broadcast --verify
```
Then record the deployed addresses into `config/sepolia.json` → `deployed`.

### What needs Reggie's funded key (cannot be done from here)
1. **Broadcast on Sepolia** — I do not broadcast on-chain (no funded key). The kit is dry-run-ready.
2. **Real matcher address** — `config/sepolia.json.matcher` is `0x0` (defaults to deployer for a
   smoke test). Set the **real** off-chain matching-engine relayer pubkey before live use, and
   authorize it (`setAuthorizedMatcher` / InsuranceFund `setAuthorizedContract`).
3. **Rotate the upstream relayer key** and confirm `SKIP_SIGNATURE_VERIFY` is off in the deployed matcher.
4. **Test collateral + a matched trade** on Sepolia to prove the domain sync (a signed order that
   `settleBatch` accepts) end-to-end before any production chain.

---

## Security notes
- **Purge/rotate keys** — never reintroduce the upstream committed relayer key. This kit contains none.
- **`SKIP_SIGNATURE_VERIFY` must be disabled** before any live matcher run.
- **PerpVault is undeployed** — 3 open criticals (see above). P2P only for launch.
- **Domain atomicity** — do not deploy `Settlement.sol` until backend (#3) + frontend (#4) are on
  `"HookSwapPerps"`; a domain mismatch silently rejects every order signature.
- **Matcher trust** — the matcher is authorized to settle batches and set prices; treat its key as
  hot-but-critical. Prices flow from the oracle adapter, not user input.

## File tree
```
contracts/perps/
├── foundry.toml            solc 0.8.28, via_ir, OZ/forge-std remappings, Sepolia rpc first
├── remappings.txt
├── .env.example            PLACEHOLDERS only — no secrets
├── README.md               (this file)
├── config/
│   └── sepolia.json        Sepolia (11155111) deploy inputs
├── script/
│   └── DeployPerps.s.sol    P2P stack, Sepolia-first, no broadcast
└── src/
    ├── perpetual/  Settlement, SettlementV2, PositionManager, Liquidation, FundingRate,
    │               InsuranceFund, RiskManager, ContractSpec, PerpVault, IPerpVault
    ├── common/     Settlement's ContractRegistry, IContractRegistry, PriceFeed, Vault, SessionKeyManager
    ├── interfaces/ I{PositionManager,PriceFeed,Vault,RiskManager,Liquidation,FundingRate,...}
    └── libraries/  ConstantProductAMMMath
```
