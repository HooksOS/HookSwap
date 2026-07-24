# HookSwapAggregator — cross-DEX aggregation executor

A minimal, security-hardened **executor** that lets HookSwap route a single user
swap **across multiple DEX venues** (HookSwap own v2/v3, Uniswap v2/v3,
PancakeSwap v2/v3, …) and skims a **0.2% (20 bps) protocol fee of the OUTPUT
token** to the treasury.

It exists to solve a concrete constraint: HookSwap's deployed **Universal Router
is factory-hardcoded** and cannot execute swaps through foreign pools. This
contract is a 0x-Settler / 1inch-AggregationRouter-style executor — the off-chain
Smart Order Router (SOR) computes a plan of router calls, and this contract
executes it, takes the fee, and delivers output to the user.

> ⚠️ **Not yet audited.** This is a real-money, multi-chain contract with
> arbitrary-external-call surface. It ships with a strict threat model (below)
> and 17 passing tests, but it **needs an external security audit before mainnet
> use.** Sepolia-first per the mandatory project rule.

---

## Files

```
contracts/aggregator/
├── foundry.toml                     # solc 0.8.28, via_ir, cancun; reuses ../perps/lib (OZ 5.0.2 + forge-std)
├── src/
│   ├── HookSwapAggregator.sol       # the executor
│   └── IPermit2.sol                 # minimal Permit2 SignatureTransfer interface
├── script/
│   └── DeployAggregator.s.sol       # Sepolia-first deploy script (no auto-broadcast)
├── test/
│   └── HookSwapAggregator.t.sol     # 14 unit tests + 3 Sepolia fork tests
└── README.md
```

`lib/` is a symlink to `../perps/lib` so the already-installed OpenZeppelin
v5.0.2 + forge-std are reused (no extra network install). For a standalone
checkout, install into `./lib`:

```
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-commit
forge install foundry-rs/forge-std --no-commit
```

---

## How it works

### Entry points

```solidity
function swap(SwapDescription desc, Call[] calls) returns (uint256 amountOut);
function swapWithPermit2(SwapDescription desc, Call[] calls,
                         IPermit2.PermitTransferFrom permit, bytes signature) returns (uint256 amountOut);
```

- **`swap`** pulls input via a standard ERC20 allowance the user granted to the
  aggregator (`srcToken.approve(aggregator, amountIn)`).
- **`swapWithPermit2`** pulls input via canonical **Permit2**
  (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) SignatureTransfer — no prior
  approval to the aggregator required. The permit's token is bound to
  `desc.srcToken` and the requested amount to `desc.amountIn`.

### The swap-plan format

```solidity
struct SwapDescription {
    address srcToken;      // ERC20 pulled from the user
    address dstToken;      // ERC20 delivered to the receiver
    uint256 amountIn;      // total srcToken to pull
    uint256 minAmountOut;  // minimum dstToken AFTER the 0.2% fee (slippage guard)
    address receiver;      // gets the output + any src refund dust
}

struct Call {              // one leg of the execution plan (built by the SOR)
    address target;        // DEX router — MUST be allowlisted; never a token/Permit2/self
    address inputToken;    // token this leg consumes (srcToken or an intermediate)
    uint256 inputAmount;   // exact amount approved to `target` for this leg
    bytes   data;          // calldata to invoke on `target`
}
```

Execution for each leg: `forceApprove(inputToken, target, inputAmount)` →
`target.call(data)` → `forceApprove(inputToken, target, 0)`. After all legs:
output = **measured dstToken balance increase**; skim `feeBps` to treasury;
require `net >= minAmountOut`; send net to `receiver`; refund any unspent src
input above the pre-swap baseline to `receiver`.

**Splitting** = supply multiple legs that each consume part of `amountIn` and all
produce `dstToken` (e.g. leg A through a HookSwap v2 pool, leg B through a
Uniswap v3 pool). **Multi-hop** within one leg is encoded entirely in that
router's own calldata (`path`/commands) — the aggregator only approves the leg's
input token.

---

## Threat model & security invariants

Arbitrary external calls are the core risk: a naive executor lets a crafted call
drain tokens other users approved to it. Mitigations:

| # | Invariant | Enforcement |
|---|-----------|-------------|
| a | **Only owner-allowlisted routers callable.** | `allowedRouter[target]` checked per leg → `RouterNotAllowed`. Adding a DEX = one owner tx, no redeploy. |
| b | **Exact, transient approvals only.** | Each leg approves `target` for precisely `inputAmount` of `inputToken`, then zeroes it immediately. No standing allowances survive; a greedy router cannot over-pull (test: `test_Revert_GreedyRouterCannotOverPull`). |
| c | **No leg may target sensitive addresses.** | `target` can never be `srcToken`, `dstToken`, `PERMIT2`, or the aggregator itself → `ForbiddenTarget`. This blocks `transferFrom(victim,…)`-style draining even if the owner mistakenly allowlists a token (test: `test_Revert_WhenTargetIsSrcToken`). |
| d | **Reentrancy guard.** | `nonReentrant` on `swap` / `swapWithPermit2` / `rescueERC20`. A router callback re-entering `swap` reverts and bubbles as `CallFailed` (test: `test_Revert_OnReentrantRouter`). |
| e | **Balance-delta accounting, no fund-sweeping.** | Output is the measured dstToken **increase**; unspent src input is refunded only down to the pre-swap baseline. The contract never trusts or sweeps a pre-existing balance, and holds **no funds between swaps** (tests assert `balanceOf(agg)==0` after every swap). |
| f | **Fee capped.** | `feeBps` default 20 (0.2%), owner-adjustable but hard-capped at `MAX_FEE_BPS = 100` (1%) → `FeeTooHigh`. |
| g | **Owner-only admin.** | Allowlist, treasury, fee, and rescue are `onlyOwner` (`Ownable2Step`). Treasury defaults to `0x011d438E3eb3fce848950859591ec037C6529E13`. |

**Residual risks / operator responsibilities (read before mainnet):**

- **The allowlist is the trust root.** The owner MUST only allowlist genuine DEX
  router contracts. **Never** allowlist a token, Permit2, a generic
  multicall/permit-forwarder, or any contract that can `transferFrom` arbitrary
  owners — such a target could move tokens other users approved to *it*. (The
  aggregator only protects the funds *it* holds/approves; it cannot police an
  allowlisted target's own separate approvals.)
- **Intermediate-token dust.** Refund accounting guarantees `srcToken` and
  `dstToken` accounting; a malformed plan that leaves an *intermediate* token in
  the contract would strand it (recoverable only via owner `rescueERC20`). SOR
  plans must fully consume intermediates.
- **Native ETH not handled** — this executor is ERC20→ERC20. Wrap to WETH in the
  plan / off-chain. Entry points are non-payable; every leg is called with 0 value.
- **Fee-on-transfer / rebasing tokens** — output is measured by balance delta so
  the fee/min-out math is correct for the amount actually received, but exotic
  tokens should be validated per-market before allowlisting their pools' routers.
- **Not audited.** External audit required before production.

---

## Build & test

```
cd contracts/aggregator
forge build
forge test            # 17 tests: 14 unit (no network) + 3 Sepolia fork
```

- **Unit tests (14)** — no network. Cover the split-fee skim, min-out revert,
  allowlist enforcement, forbidden-target, reentrancy, greedy-router over-pull,
  src-dust refund, no-output revert, fee cap, and owner-only admin.
- **Fork tests (3)** — **network-gated**: fork Sepolia via the public RPC
  `https://ethereum-sepolia-rpc.publicnode.com` (override with `SEPOLIA_RPC_URL`).
  They seed **three real Uniswap-Sepolia v2 pools** (via the canonical v2 router
  `0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3`, factory
  `0xF62c03E08ada871A0bEb309762E260a7a6a880E6`, both verified on-chain), then:
  1. **split** a swap across two real pools (`[TA,TB]` direct + `[TA,TC,TB]` hop),
     assert net matches the real-pool quote, **0.2% landed at treasury**, and
     **no funds left** in the aggregator;
  2. assert **`minAmountOut` reverts** when set above achievable;
  3. exercise the **real Permit2** SignatureTransfer path end-to-end.

  If the RPC is unreachable, the fork tests **self-skip** (emit `SKIP:` and
  return green) — run the unit tests to validate logic offline.

**Result in this environment (2026-07-24):** `forge build` OK; `forge test` =
**17 passed / 0 failed** (unit + fork; RPC was reachable). Fork split test logged
gross 988.13 TB → fee 1.976 TB (exactly 0.2%) → net 986.16 TB to receiver.

---

## Deploy — SEPOLIA FIRST (mandatory)

> ⛔ Project rule: every contract is deployed AND tested on **Sepolia (11155111)
> FIRST**, before any other chain. Only after Sepolia validation do you deploy to
> the production chains. **Claude does not broadcast** — the owner runs these with
> a funded key.

### 1. Sepolia (do this first)

```
export SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com   # or Infura
export PRIVATE_KEY=0x...            # owner/deployer key (funded)
# optional: export TREASURY=0x...   # defaults to the HookSwap treasury constant

# dry run (no broadcast)
forge script script/DeployAggregator.s.sol:DeployAggregator --rpc-url $SEPOLIA_RPC_URL

# real deploy
forge script script/DeployAggregator.s.sol:DeployAggregator \
  --rpc-url $SEPOLIA_RPC_URL --broadcast --verify
```

Then allowlist Sepolia's DEX routers and run a real on-chain split swap to
validate before touching any production chain.

### 2. Allowlist routers (per chain, after deploy)

```
agg.setRouterAllowed(<router>, true)          // one router
agg.setRoutersAllowed([<r1>,<r2>,...], true)  // batch
```

### Per-chain DEX router allowlist table

**HookSwap own routers** are sourced from `contracts/deployments/<chain>.json`
(verified in-repo). **Uniswap / PancakeSwap** canonical routers per chain are
marked **`VERIFY`** — the owner must confirm each address on that chain's
explorer / official docs before allowlisting (facts-only: not fabricated here).

| Chain (id) | HookSwap v2Router02 | HookSwap SwapRouter02 (v3) | Uniswap routers | Pancake routers |
|---|---|---|---|---|
| **Sepolia (11155111)** | *(HookSwap uses canonical Uniswap on Sepolia — none of its own)* | — | **Uni v2 Router02 `0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3`** (verified on-chain); Uni SwapRouter02 v3 `VERIFY` | n/a |
| **Robinhood (4663)** | `0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA` | `0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4` | `VERIFY` (Uni deployment, if any) | `VERIFY` |
| **MegaETH (4326)** | `0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA` | `0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4` | `VERIFY` | `VERIFY` |
| **Ink (57073)** | `0xBe3729d06E3A17F3c7c5ac394c7bCbe138B6EEFA` | `0xE8526A0429aeC9a5253ac854F8b6dC964E677EE4` | `VERIFY` | `VERIFY` |
| **XLayer (196)** | `0xAa1f5Bd529Be345e7FB77934554112E5ecd7D7f3` **`VERIFY`** (this value equals a v3Factory address elsewhere — likely mislabeled in xlayer.json; confirm the real v2 router on-chain) | `0x3D30133F4d4A80684F02d8310faF572E3dc193b3` **`VERIFY`** | `VERIFY` | `VERIFY` |
| **HyperEVM (999)** | `0xbd817036c5bF69Cb27D3A342129e39f9f908577d` | `0xD96fc9629AFaf325fCdd7F98Dc9b8dc2165adcBB` | `VERIFY` | `VERIFY` |
| **Tempo (4217)** | `0x6d8a0783213B3b06648DB3708a89732af3661005` | `0x3D30133F4d4A80684F02d8310faF572E3dc193b3` | `VERIFY` | `VERIFY` |

Notes:
- On **BSC** (if added later) allowlist **PancakeSwap** v2/v3 routers; on chains
  with a canonical **Uniswap** deployment allowlist Uniswap's v2 Router02 /
  SwapRouter02. Every non-in-repo address above is intentionally left `VERIFY` —
  do not allowlist an unverified address.
- The aggregator is **chain-agnostic**: the same bytecode deploys on every chain;
  only the allowlisted router set differs (config, not code) — matching HookSwap's
  config-driven extensibility rule.

### 3. Production chains (only after Sepolia passes)

Repeat step 1 with each chain's `--rpc-url` (endpoints are wired in
`foundry.toml`: `robinhood`, `megaeth`, `ink`, `xlayer`, `hyperevm`, `tempo`),
then allowlist that chain's routers from the table.

---

## What the owner must do (summary)

1. **Sepolia first:** deploy via the script, allowlist the Uniswap-Sepolia v2
   router (`0xeE56…CfE3`, verified) + any v3 router (`VERIFY`), run a real split
   swap, confirm 0.2% at treasury.
2. **Verify every `VERIFY` address** on each production chain before allowlisting
   (Uniswap/Pancake routers; XLayer's own router labels).
3. **Deploy per chain** (Sepolia-validated bytecode) and allowlist that chain's
   routers.
4. **Commission an external audit** before mainnet real-money volume.
