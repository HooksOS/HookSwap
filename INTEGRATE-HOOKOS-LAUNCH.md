# Integrate HookOS Launch into HookSwap — Claude Prompt

> Paste the block below into a Claude Code session that can see **both** repos.
> It assumes `@hookos/sdk` has been updated with the stock / multi-chain-V3 / quick-launch
> modules (done in HooksOS/protocol). HookSwap consumes the SDK as its launch engine and
> builds the UI in its own Tamagui/React-Native system.

---

```
ROLE: You are adding HookOS's full token-launch capability to HookSwap, using @hookos/sdk
as the launch engine. HookSwap owns the wallet + UI; the SDK owns all on-chain launch logic.

REPOS
- HookSwap (target): /Users/admin/Desktop/HookDev/HookSwap
  nx/bun monorepo — apps/web (primary), apps/mobile, apps/extension; Tamagui + React Native;
  wallet/signer already wired.
- HookOS (source of truth + the SDK): /Users/admin/Desktop/HookDev/protocol
  The SDK lives at sdk/ (package @hookos/sdk). Read sdk/src/index.ts for the exposed modules.

GOAL
Add a "Launch" surface to HookSwap that lets a user launch a token through EVERY HookOS
mechanism, multi-chain, by calling @hookos/sdk — never re-deriving ABIs/addresses/params.

THE SDK IS THE DEPENDENCY (do not copy HookOS's web components)
Instantiate the client with HookSwap's own wallet:
    import { HookOS } from "@hookos/sdk";
    const hookos = new HookOS({ chainId, walletClient });   // HookSwap's viem walletClient
Then call the launch modules:
    hookos.tokens.createTokenAndCurve({...})   // standard bonding-curve → v4 graduation (6 chains)
    hookos.v3Launch.launch({...})              // direct-to-v3 fair launch (multi-chain; creator picks DEX)
    hookos.quickLaunch.launch({...})           // RHLaunchpad direct-to-v4 memecoin (Robinhood)
    hookos.stock.launch({...})                 // v4 WETH stock-reward (Robinhood); + .getBasket / .claim
    // fees: read hookos.fees / effectiveLaunchFee() live and include in msg.value
(Confirm the exact method names/signatures against sdk/src/index.ts + the module files —
they are the contract of record.)

MECHANISMS TO SURFACE (each as a route/tab in HookSwap's launch UI)
1. Standard bonding-curve launch — all 6 chains (Base 8453, BNB 56, Ethereum 1, MegaETH 4326,
   HyperEVM 999, Robinhood 4663).
2. Direct-to-v3 fair launch — multi-chain; creator picks Uniswap V3 or HookSwap V3.
3. Quick Launch (RHLaunchpad direct-to-v4 memecoin) — Robinhood.
4. Stock-Reward v4 — Robinhood; WETH-paired, in-hook tax buys tokenized stocks for holders
   (clean untaxed token, sells work). Includes reward-basket selection + the fee-split preview.
5. Optional dev-buy (founder's first candle) on the paths that support it.

WHAT THE SDK DOES vs WHAT HOOKSWAP BUILDS
- SDK: per-chain address resolution, param building, the launch tx, fee reads, stock basket +
  claim. Headless — no UI.
- HookSwap: the launch UI (Tamagui/RN), the chain selector, the wallet/signer, and the
  success/trade UX. A mechanism unavailable on the selected chain shows an honest disabled/
  "soon" state — never a dead or fake control (mirror HookOS's isDeployed gating).
- OFF-CHAIN (not in the SDK — call the HookOS API/indexer directly, optional):
  • socials/site-config save after launch → POST /api/site-config (wallet-signed; see the
    HookOS siteConfigMessage + fetchSignNonce helpers).
  • stock-reward Merkle claim proofs → from the keeper's off-chain state / the HookOS indexer.

REFERENCE FLOWS IN HOOKOS (port the LOGIC/UX, not the styling)
- src/components/pages/quicklaunch.tsx, src/app/atlas/launch/page.tsx,
  src/components/launch/StockRewardFlow.tsx, src/components/launch/social-links-section.tsx.

LIVE LAUNCH-CONTRACT ADDRESSES (reference/fallback — prefer the SDK's resolver; do NOT hardcode
in HookSwap, read from the SDK):
- TokenFactory: Base 0x9B3d636C27AD4CDEBFbE1F182B2b63F66Be7adE5 · BNB 0x60DfFA6940696e8f2dF997b570D9FEACC5eb1Ef7 ·
  Ethereum 0xa7d00760693CEc4F8c622EeD44C786a190FbA342 · MegaETH 0x9Bb58abC4A41eaC5692F42Dc59e15b0efb92af81 ·
  HyperEVM 0x96c5E38362f86E52389E15a86247fB7326503c8d · Robinhood 0x3E9E09C4759553e38a10AdED3E0f3f46b3CdF162
- HookOSV3Launcher: Base 0x094E2b0b5B750441Fc36A72B4754F6833231D76e · BNB 0xaB058c222baae520cc83440F941628abF2F876fD ·
  Ethereum 0xCdC35BED68bE2aD6245D93F8D310408d4aB93167 · MegaETH 0x528Bcecff5DA16cE65C198fBe42dA55A0088d4c2 ·
  HyperEVM 0x2dB1b1e2123c3d61B0cAfE4aF5864E4FAB3a5F74 · Robinhood 0x9B8d992704ddf38729535A641502bcc55734e0B8
- Robinhood-only: RHLaunchpad 0x316022a060284b84D6711a203e2578eE452c7858 · LaunchHook 0xA71B7482439C4f147abFe23cBa5312770f31C0c4 ·
  StockRewardLauncherV4 0x11B223C5a979267b10aE61761CB5b0bD00448Dda · StockTaxHook 0x45F983076500a670EB12B2F3Aa6863d53dC880CC ·
  StockRewardVault 0x45720b33e8A54F2A8e3B7Cf7a54c23081DbBF948 · MerkleStockDistributor 0xf344e52182B02125338448B3a89DcD83A3aEc013

DELIVERABLES
1. A launch module in apps/web (with a plan for mobile/extension parity) — one entry routing to
   each mechanism, all calls via @hookos/sdk.
2. Chain selector + per-chain availability gating (from the SDK's address resolver).
3. Live fee display (native + USD) included in msg.value.
4. Success screen: token address + a "Trade it in HookSwap" link + optional signed site-config save.
5. Typecheck clean; every button wired to a real SDK call or honestly disabled.
6. A short README: which mechanisms are wired, per-chain availability, and how to bump the SDK
   version when HookOS redeploys.

PROCESS
- First READ sdk/src (the real module API) + HookSwap's apps/web + its wallet/Tamagui entry
  points, and REPORT a concrete integration plan before writing code. Then implement
  mechanism-by-mechanism, typechecking as you go.
- Add @hookos/sdk as a dependency (workspace link or published version — match how HookSwap
  pulls shared deps). Do NOT hardcode addresses. Do NOT deploy or move funds. Ask before any
  irreversible action.
```

---

## Notes for the human
- **This depends on the updated `@hookos/sdk`** (stock + multi-chain V3 + quick-launch modules).
  If the SDK isn't published to npm yet, link it as a workspace/file dependency or publish it first.
- **Surfaces:** the prompt targets `apps/web` first with a mobile/extension parity plan — adjust if
  you want native mobile launch in the same pass.
- **Re-sync rule:** when HookOS redeploys a launch contract, bump the SDK and HookSwap picks it up —
  HookSwap should never carry its own launch addresses.
