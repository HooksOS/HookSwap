# Stable Mainnet (chainId 988) — HookSwap full-stack deploy runbook

> PREP DOCUMENT. No txs have been broadcast. Every deployed address in the
> `stable*.json` files is `TBD` until the deployer is funded with USDT0 and this
> runbook is executed. Fill the real addresses back in after each step.

## Chain facts (verified)

| Field | Value |
|---|---|
| chainId | **988** (0x3dc) |
| RPC | `https://rpc.stable.xyz` (WS `wss://rpc.stable.xyz`) |
| Explorer | `https://stablescan.xyz` |
| Native gas token | **USDT0** — 18-decimal **native** balance |
| USDT0 ERC-20 (routing/balances) | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` — symbol `USDT0`, **decimals 6**, NOT wrapped-native (no deposit/withdraw) |
| Wrapped-native | **NONE** → deploy our own WETH9 as router/periphery WETH9 arg ONLY (interface `wrappedNativeCurrency` stays `null`, Tempo/Arc model) |
| Gas price | ~**1.13 gwei** |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` (present, reuse) |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` (canonical, present, reuse) |
| CREATE2 deployer (Arachnid) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` (present → deterministic deploys possible) |
| Canonical DEX deployer | `0xc14C897c6bff88a5Eeac31F795693b9230205125` (holds **0 USDT0** on 988 — funding is the blocker) |
| v2 pair init-code hash | `0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f` (canonical, unchanged) |
| v3 pool init-code hash | `0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54` (canonical, unchanged) |

## Why this is a proven-stack deployment (Sepolia-first rule satisfied)

The **⛔ MANDATORY rule** is: deploy + test on Sepolia (11155111) before any
other chain. Both halves of what ships to 988 are already Sepolia-proven:

- **DEX (v2 + v3 + SwapRouter02 + Universal Router):** canonical Uniswap bytecode
  → canonical init-code hashes (above). The identical bytecode is live on Sepolia
  and 6 HookSwap production chains; only factory *addresses* change per chain.
- **HookSwapPerps:** Sepolia-deployed + full on-chain smoke test PASSED
  (see `contracts/perps/config/sepolia.json` / `factory-sepolia.json`).

So 988 is a **new-mainnet rollout of an already-Sepolia-validated stack**, not a
new/unproven contract. No new Sepolia round is required for the DEX/perps bytecode
itself; only the per-chain wiring (own WETH9 + factory addresses) is new.

## Prereqs (one-time)

1. `cd contracts && cp .env.example .env` → set `DEPLOYER_PRIVATE_KEY` and
   `STABLE_RPC_URL=https://rpc.stable.xyz`.
2. Clone + build the HooksOS forks; `export FORKS_DIR=...` (see header of
   `contracts/scripts/deploy.sh`).
3. `forge`, `cast`, `node 18+`, `npx` on PATH.
4. **Fund** `0xc14C897c6bff88a5Eeac31F795693b9230205125` with USDT0 gas on 988
   (amount below).
5. Sanity: `cast chain-id --rpc-url https://rpc.stable.xyz` → must print `988`.

---

## STEP 0 — reuse Permit2 + Multicall3 (skip deploy)

Both are already on 988. Verify and move on:

```bash
RPC=https://rpc.stable.xyz
cast code 0x000000000022D473030F116dDEE9F6B43aC78BA3 --rpc-url $RPC   # Permit2 — non-empty
cast code 0xcA11bde05977b3631167028862bE2a173976CA11 --rpc-url $RPC   # Multicall3 — non-empty
cast code 0x4e59b44847b379578588920cA78FbF26c0B4956C --rpc-url $RPC   # CREATE2 deployer — non-empty
```

`stable.json` already records these. Do NOT redeploy.

> The **whole DEX stack** (steps 1–5) is orchestrated by
> `contracts/scripts/deploy.sh stable`, which reads the `stable` entry that was
> added to `contracts/config/chains.json` (chainId 988, `weth:"DEPLOY"`,
> `nativeLabel:"USDT0"`). The manual commands below mirror exactly what that
> script does — run the script for the happy path, or the manual steps to control
> each tx. `deploy.sh` still stops before the Universal Router (step 5) and prints
> the exact RouterParameters to deploy by hand.

## STEP 1 — deploy own WETH9 (routing wrapper only)

No canonical wrapped-native on 988. Deploy a fresh WETH9 used ONLY as the WETH9
constructor arg downstream. It is NEVER surfaced to users; the interface keeps
`stable.ts wrappedNativeCurrency = null`.

```bash
contracts/scripts/deploy-weth.sh https://rpc.stable.xyz "$DEPLOYER_PRIVATE_KEY"
# → prints WETH9 address. Record as stable.json "weth9".
export STABLE_WETH9=0x...   # from above
```

## STEP 2 — Uniswap v2 (factory + router02), canonical bytecode via forge-create

```bash
RPC=https://rpc.stable.xyz
DEPLOYER=0xc14C897c6bff88a5Eeac31F795693b9230205125   # = cast wallet address of your key

# UniswapV2Factory(feeToSetter = deployer)
cd $FORKS_DIR/v2-core && forge create --rpc-url $RPC --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast contracts/UniswapV2Factory.sol:UniswapV2Factory --constructor-args $DEPLOYER
export STABLE_V2FACTORY=0x...   # record as stable.json "v2Factory"

# UniswapV2Router02(factory, weth9)
cd $FORKS_DIR/v2-periphery && forge create --rpc-url $RPC --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast contracts/UniswapV2Router02.sol:UniswapV2Router02 \
  --constructor-args $STABLE_V2FACTORY $STABLE_WETH9
export STABLE_V2ROUTER=0x...    # record as stable.json "v2Router02"
```

> **Determinism:** the shared address `0xD1Cf66..6B45` (Ink/MegaETH/Robinhood)
> only reproduces if the deployer nonce is **0** on 988. If the key has any prior
> nonce on 988, the address shifts (as on Tempo/XLayer). Record whatever forge
> returns — do NOT assume the canonical address.
>
> **Pair init hash** is canonical (`0x96e8ac42..845f`) since bytecode is unchanged;
> confirm with `cd $FORKS_DIR/v2-core && cast keccak $(forge inspect contracts/UniswapV2Pair.sol:UniswapV2Pair bytecode)`.

## STEP 3 — Uniswap v3 via `@uniswap/deploy-v3` CLI

```bash
npx --yes @uniswap/deploy-v3 \
  --private-key 0x$DEPLOYER_PRIVATE_KEY \
  --json-rpc https://rpc.stable.xyz \
  --weth9-address $STABLE_WETH9 \
  --native-currency-label USDT0 \
  --owner-address 0xc14C897c6bff88a5Eeac31F795693b9230205125 \
  --v2-core-factory-address $STABLE_V2FACTORY \
  --gas-price 2 \
  --state deployments/v3-state-stable.json
```

- `--gas-price` is **integer gwei** in the CLI. Network is ~1.13 gwei, so `1` or
  `2` works — 988 does NOT need the fractional-gwei CLI patch the sub-gwei L2s
  needed. `2` gwei gives headroom.
- Private key regex requires `0x`-prefixed 64-hex; prefix if your `.env` key is bare.
- The CLI runs ~10 sequential txs and deploys v3-core + v3-periphery (factory,
  NFT position manager, quoter/QuoterV2, tick lens, migrator, NFT descriptor +
  proxy, **Multicall2**, SwapRouter02, staker). It resumes from the state file if
  interrupted — DO NOT run when a rate-limit could interrupt mid-sequence.
- From `deployments/v3-state-stable.json`, record into `stable.json`:
  `v3Factory`, `nonfungiblePositionManager`, `quoterV2`, `v3Migrator`, `tickLens`,
  `nftDescriptorLibrary`, `nftPositionDescriptor`, `descriptorProxy`, `proxyAdmin`,
  `v3Staker`, and the **deploy-v3 Multicall2** → `multicall2` (this is the v3
  CLI's own Multicall2, distinct from the canonical Multicall3 already recorded).
- Pool init hash stays canonical (`0xe34f199b..8b54`) — bytecode unchanged.

## STEP 4 — SwapRouter02

The deploy-v3 CLI above already deploys SwapRouter02 (record it as
`swapRouter02`). If deploying standalone from the swap-router-contracts fork:

```bash
cd $FORKS_DIR/swap-router-contracts && forge create --rpc-url $RPC \
  --private-key $DEPLOYER_PRIVATE_KEY --broadcast \
  contracts/SwapRouter02.sol:SwapRouter02 \
  --constructor-args $STABLE_V2FACTORY $STABLE_V3FACTORY $STABLE_NPM $STABLE_WETH9
export STABLE_SWAPROUTER02=0x...   # record as stable.json "swapRouter02"
```

## STEP 5 — Universal Router (11-field RouterParameters)

HooksOS universal-router fork (the v4+Across generation). v4/adapter/spoke fields
zeroed since HookSwap is v2/v3-only. Build a `DeployUniversalRouter.s.sol` in the
fork that constructs this struct, then broadcast:

```
RouterParameters {
  permit2                  = 0x000000000022D473030F116dDEE9F6B43aC78BA3
  weth9                    = $STABLE_WETH9
  v2Factory                = $STABLE_V2FACTORY
  v3Factory                = $STABLE_V3FACTORY
  pairInitCodeHash         = 0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f
  poolInitCodeHash         = 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54
  v4PoolManager            = 0x0000000000000000000000000000000000000000
  permissionsAdapterFactory= 0x0000000000000000000000000000000000000000
  v3NFTPositionManager     = $STABLE_NPM   (or 0x0 if your fork's field is unused)
  v4PositionManager        = 0x0000000000000000000000000000000000000000
  spokePool                = 0x0000000000000000000000000000000000000000
}
```

```bash
cd $FORKS_DIR/universal-router && forge script script/DeployUniversalRouter.s.sol \
  --rpc-url https://rpc.stable.xyz --private-key $DEPLOYER_PRIVATE_KEY --broadcast
# record as stable.json "universalRouter". Verify supportedURVersions == _2_0 for interface wire-up.
```

> Confirm the exact `RouterParameters` field order/count of YOUR universal-router
> fork commit before broadcasting (older commits have a larger marketplace struct).

## STEP 6 — self-service suite + lockers + referral

All are env-driven `forge script`s. Run each from its own package dir with
`--rpc-url https://rpc.stable.xyz --private-key $DEPLOYER_PRIVATE_KEY --broadcast`.
`FEE_RECEIVER` defaults to the deployer.

```bash
RPC=https://rpc.stable.xyz ; PK=$DEPLOYER_PRIVATE_KEY

# token-factory  (constructor: feeReceiver, createFee)
cd contracts/token-factory && CREATE_FEE=0 forge script script/DeployTokenFactory.s.sol --rpc-url $RPC --private-key $PK --broadcast

# vesting        (constructor: vestingFee, feeReceiver)
cd contracts/vesting && VESTING_FEE=0 forge script script/DeployVesting.s.sol --rpc-url $RPC --private-key $PK --broadcast

# farms          (StakingRewardsFactory, no args)
cd contracts/farms && forge script script/DeployFarmsFactory.s.sol --rpc-url $RPC --private-key $PK --broadcast

# airdrop        (MerkleDistributorFactory, no args)
cd contracts/airdrop && forge script script/DeployAirdropFactory.s.sol --rpc-url $RPC --private-key $PK --broadcast

# multisender    (Disperse, no args, no owner/fees)
cd contracts/multisender && forge script script/DeployMultisender.s.sol --rpc-url $RPC --private-key $PK --broadcast
# → record all five into deployments/stable-suite.json (contracts + deployTx)

# lockers        (LOCK_FEE wei = 0.04 native USDT0; deploys TokenLockerManager + V3PositionLocker + Util lib)
cd contracts/locker && LOCK_FEE=40000000000000000 forge script script/DeployLockers.s.sol --rpc-url $RPC --private-key $PK --broadcast
# → record into deployments/stable-lockers.json (tokenLockerManager, v3PositionLocker)

# referral       (constructor: swapRouter02, defaultFeeBps=30, feeAdmin) — HAS NO forge script; deploy with forge create
cd contracts/referral && forge build && forge create --rpc-url $RPC --private-key $PK --broadcast \
  HookSwapReferralRouter.sol:HookSwapReferralRouter \
  --constructor-args $STABLE_SWAPROUTER02 30 0xc14C897c6bff88a5Eeac31F795693b9230205125
# → record into deployments/stable-referral.json (referralRouter; set swapRouter02Wired=true)
```

> Note: `contracts/referral/` ships NO `script/Deploy*.s.sol` (unlike the other
> suites) — deploy it with `forge create` as shown. Constructor is
> `(address swapRouter02, uint256 defaultFeeBps, address feeAdmin)`; `MAX_FEE_BPS`
> caps `defaultFeeBps` at 100 (1%); 30 = 0.30%. It is **downstream of live swaps**
> and not wired into the app until routing/liquidity land.

## STEP 7 — HookSwapPerps (reference; do NOT edit the perps scripts)

Perps is Sepolia-proven. Reference `contracts/perps/script/DeployPerps.s.sol`
(P2P model: Settlement + SessionKeyManager + ContractRegistry + InsuranceFund) and
the factory scripts. Deploy to 988 by overriding env:

```bash
cd contracts/perps
WETH_ADDRESS=$STABLE_WETH9 \
MATCHER_ADDRESS=<real matching-engine relayer pubkey> \
FEE_RECEIVER_ADDRESS=<fee sink> \
FEE_RATE=10 \
forge script script/DeployPerps.s.sol --rpc-url https://rpc.stable.xyz --private-key $PK --broadcast
```

- `WETH_ADDRESS` here is just the ERC-20 collateral token; on 988 use the deployed
  WETH9 wrapper (step 1) or the USDT0 ERC-20 (6-dec) — decide per product. Perps
  is chain- and DEX-agnostic (price is an off-chain scalar; no on-chain DEX call),
  so no 988-specific contract change is needed.
- Do NOT modify anything under `contracts/perps/script/` — another agent owns it.
- After the P2P core, the factory (`SepoliaFactoryAll.s.sol` analog) + hardening
  wiring follow the same env-driven pattern; record addresses in a
  `contracts/perps/config/stable.json` (mirror `sepolia.json`).

## STEP 8 — post-deploy wiring + liquidity

1. **Write real addresses back** into `deployments/stable.json`,
   `stable-suite.json`, `stable-lockers.json`, `stable-referral.json` (replace
   every `TBD`; flip each `_status` from PENDING to COMPLETE).
2. **SDK / SOR wiring** (init hashes stay canonical — swap ADDRESSES only):
   - `vendor/sdk-core` `CHAIN_TO_ADDRESSES_MAP` → add chainId 988 with
     v2Factory/v2Router, v3CoreFactory, NFT position manager, QuoterV2, tickLens,
     multicall(2), swapRouter02. (Also add 988 to `SUPPORTED_CHAINS` /
     `ChainId` enum + WETH9 map entry pointing at the deployed WETH9.)
   - smart-order-router `addresses.ts` → same factory addresses; register 988 in
     the static v2/v3 subgraph providers + the `HOOKSWAP_V2_FACTORY_ADDRESSES`
     map used by `computePairAddress` (the XLayer-class fix).
   - `apps/web/src/constants/hookswapUniversalRouter.ts` → add 988 → deployed UR.
   - Interface chain def `stable.ts` MUST keep `wrappedNativeCurrency: null` and
     use the USDT0 ERC-20 (0x779Ded…, 6-dec) as the gas-token-override / balances
     token (Arc-USDC / Tempo model).
3. **Seed liquidity** (the real launch gate — empty pools quote nothing). Use the
   prepared config (MINT/MINT, because native auto-wrap does NOT work on a
   routing-wrapper-WETH chain — same as Tempo):
   ```bash
   cd contracts/seed && SEED_POOLS=config/stable.json ./scripts/seed.sh stable --broadcast
   ```
   For production depth, add a real USDT0-ERC-20-paired pool config once tokens
   are held.
4. Restart / repoint the trading adapter + confirm one real 988 quote end-to-end
   (final gate, cannot be proven by static reading).

---

## Estimated USDT0 funding

Rough gas budget for the full stack on 988 at ~1.13 gwei (native gas = USDT0,
18-dec):

| Component | ~gas |
|---|---|
| WETH9 | ~0.6M |
| v2 factory + router02 | ~5.5M |
| v3 (deploy-v3, ~10 txs: core+periphery+router02+staker+multicall2+descriptor) | ~22M |
| Universal Router | ~4M |
| suite (token-factory, vesting, farms, airdrop, multisender) | ~9M |
| lockers (2 contracts + Util lib) | ~5M |
| referral | ~2M |
| perps (P2P core: 4 contracts) | ~8M |
| **subtotal** | **~56M** |
| +40% buffer (retries, nonce shifts, factory clones) | **~78M** |

- Face-value cost: `78M × 1.13 gwei = ~0.088` native USDT0.
- **⚠️ caveat:** Tempo (the analog stablecoin-gas chain) charges a **~5–6×
  contract-creation multiplier**. If Stable applies a similar multiplier (NOT yet
  verified for 988), the real cost is **~0.5 USDT0**. Verify with a single
  `cast estimate` / dry-run tx on 988 before trusting the face-value number.
- **Recommended funding: ~1 USDT0** (native, 18-dec) into
  `0xc14C897c6bff88a5Eeac31F795693b9230205125` — comfortably covers the full DEX
  + suite + perps deploy under either gas model, with margin for retries. This
  does NOT include liquidity seed capital (separate — needs real tokens/USDT0
  ERC-20 for pool reserves).

## Known chain-assumption gaps to patch before the real deploy

1. **`config/chains.json` IS deploy-consumed** by `contracts/scripts/deploy.sh`
   (jq-parsed for chainId/rpcEnvVar/weth/nativeLabel). A `stable` (988) entry was
   ADDED in the exact shape. `deploy.sh` STEP 2 handles `weth:"DEPLOY"` → deploys
   own WETH9. `nativeLabel:"USDT0"` flows to `--native-currency-label`. No
   USDT0-specific code path breaks in `deploy.sh` — it is native-decimals-agnostic
   (only passes labels + addresses).
2. **Seeder auto-wrap won't work** (routing-wrapper WETH9, like Tempo): the
   seed config uses MINT/MINT. Do NOT configure a WETH-side seed pool until the
   deployed WETH9 wrapper token is actually held.
3. **USDT0 6-dec vs 18-dec native**: any tooling that assumes native decimals ==
   token decimals for USDT0 must use 18 for native gas and 6 for the ERC-20.
   Confirmed no deploy script hardcodes this. Interface `stable.ts` must set the
   gas-token-override to the 6-dec ERC-20 (Arc-USDC model), NOT a WETH wrapper.
4. **deploy-v3 `--gas-price` integer-gwei**: fine on 988 (~1.13 gwei → use 1–2);
   this is the one place the sub-gwei L2s needed a CLI patch — 988 does not.
5. **Determinism**: shared canonical addresses reproduce ONLY at deployer nonce 0
   on 988. Check the nonce first (`cast nonce $DEPLOYER --rpc-url $RPC`); if != 0,
   expect Tempo/XLayer-style shifted addresses and record actuals.
