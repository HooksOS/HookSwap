# Task: recognize HookOS-launched LP as "Locked" in the badge

**Context (all facts below are verified on-chain, Robinhood Chain 4663 — reproduce before trusting).**
HookOS launches lock their LP permanently, but two of our launches currently show **"LP Unlocked"**
in your launchpad badge. This is a detection gap in the badge logic, not an unlocked position. This
task adds the missing positive lock-signal. **Keep your "FACTS ONLY / never override a contract that
says unlocked" invariant** (`apps/web/src/terminal/launchpad/useLpLock.ts` header, lines 12–14): the
allowlist below is only an ADDITIONAL positive signal (an immutable custody holder with no withdraw
path), never an override of a real `unlocked` reading.

## The on-chain reality to detect

1. **HookOS V3 launches** — the position NFT is minted to our **`HookOSV3FeeVault`
   `0x2974cE6341067398A5C1E6c0C14F99ED1C3122EF`** (the same FeeVault your badge already reads). That
   contract has **no** `decreaseLiquidity`, `burn`, `withdraw`, `transferFrom`, or
   `transferLockOwnership` — the NFT can never leave; only fees are ever collected. So a position NFT
   **owned by that vault is permanently locked by custody.** Verify on the relevant NFT manager:
   - Uniswap v3 NPM `0x73991a25…DE0D3` and HookSwap NPM `0xbd817036c5bF69Cb27D3A342129e39f9f908577d`.
   - Example (reproduce): `ownerOf(2)` and `ownerOf(3)` on the HookSwap NPM both return
     `0x2974cE…22EF`. Tokens: HKV3 `0x069af2558a70c73d646c2520b4e5c861de0f0621` (tokenId 2),
     HSTT `0x001dbbd40c3804e428b568942c0f9a7e79b0b51e` (tokenId 3). BLOB
     `0x08ab9a53…08dbe8` (UniswapV3 NPM, tokenId 290696) also → the vault.
2. **On the opt-in HookSwap-locker path** we deposit into **your own** `HookSwapV3PositionLocker`
   `0x86426094d82bC1fd40F0901965b23D30837Dc66b` with `unlockTime = type(uint40).max`
   (≈ year 36,812 — effectively permanent). Those already badge correctly; the 5 existing launches
   simply used vault custody instead, which your badge doesn't yet recognize.
3. **Flagship $HOOK (Uniswap v4)** — LP position `tokenId 72774` on v4 PositionManager
   `0x58daec3116aae6D93017bAAea7749052E8a04fA7` is owned by our **immutable, non-upgradeable**
   `LPFeeSplitter` `0xa3df1c2969452ad3F0C3ca041430E2a8EE2ffa80` (liquidity never decreased, fees only).
   $HOOK was NOT launched via `HookOSV3Launcher`, so it never gets a FeeVault `positions` entry and is
   never checked — see the discovery-gap note below.

## The change (additive allowlist + ownerOf check)

1. **New allowlist constant** in `apps/web/src/terminal/launchpad/addresses.ts` (mirror
   `FEEVAULT_ADDRESSES` at lines 20–22 + a getter like lines 33–38):
   ```ts
   // Immutable-custody holders with NO withdraw/transfer/decrease path — an LP position NFT
   // owned by one of these is permanently locked (verified on-chain). Positive signal only.
   export const RECOGNIZED_LP_CUSTODY_ADDRESSES: Record<number, `0x${string}`[]> = {
     4663: [
       "0x2974cE6341067398A5C1E6c0C14F99ED1C3122EF", // HookOSV3FeeVault (v3 launches)
       "0xa3df1c2969452ad3F0C3ca041430E2a8EE2ffa80", // LPFeeSplitter (flagship $HOOK, v4)
     ],
   };
   ```
2. **Detection hook** `apps/web/src/terminal/launchpad/useLpLock.ts`, `deriveStatus` (lines 50–75) +
   the `useReadContracts` batch (lines 85–94, 139–142): add an `ownerOf(tokenId)` read on the position
   NFT and, if the owner is in `RECOGNIZED_LP_CUSTODY_ADDRESSES`, return `'locked-forever'`. Keep the
   existing `positions().locker` seam and the `isPermanentlyLocked` reading as-is; the allowlist is
   checked as an OR of positive signals, and a genuine `unlocked` from a real locker is never overridden.
3. **ABI** `apps/web/src/terminal/launchpad/abis.ts`: add an `ownerOf(uint256) view returns (address)`
   entry (NPM position manager).
4. **Badge components** need no logic change — `LpLockBadge` (`LaunchDetailScreen.tsx` lines 207–245)
   and `LpPill` (`LaunchpadExplore.tsx` lines ~92–145) already render `'locked-forever'` as "🔒 Locked
   Forever" once the hook returns it.
5. **Indexer parity** (so the server-side `lpLocked` boolean + `lpLockedLaunches` stat agree with the
   UI): apply the same allowlist/`ownerOf` recognition in `locker-indexer/src/launchpad/indexer.ts`
   step 4 (lines 309–335) and its `abi.ts` `FEEVAULT_ABI` (lines 63–74).

## Discovery gap to decide on

The launchpad Explore/Detail screens only iterate launches created by `HookOSV3Launcher`
(`launchCount()`/`getLaunch(id)`). The 5 V3 launches ARE in that set, so the allowlist fixes their
badge. But **$HOOK** is external — for it to show a badge it must be reachable via whatever token/pool
page you want the badge on (e.g. wire the same `ownerOf`→allowlist check into the general token page),
not only the launchpad list.

## Conventions (from your CLAUDE.md / AGENTS.md)

- Any contract change: deploy + test on **Sepolia (11155111) first**. (This task is frontend + indexer
  only — no contract change needed.)
- **FACTS ONLY, NEVER GUESS** — every address/owner above is an on-chain read; re-verify with
  `ownerOf` before shipping.
- Runtime: bun 1.3.14 / node 24. `bun install`; dev `bun web dev` (port 3000); build
  `bun web build:production`. **Run all tests, lint, and typecheck after changes** (AGENTS.md line 3).
- Keep the allowlist a POSITIVE signal only — never assert "Locked" over a contract that reads
  "unlocked" (matches how the existing `positions().locker` seam is framed).

## Acceptance

- HKV3 (tokenId 2) and HSTT (tokenId 3) on the launchpad show **🔒 Locked Forever**.
- BLOB (tokenId 290696) shows **🔒 Locked Forever**.
- Server-side `lpLocked` for those tokens flips to `true` and the `lpLockedLaunches` stat matches.
- No token whose position NFT is owned by a plain EOA / a real locker reading `unlocked` is ever
  badged as locked (invariant preserved).
