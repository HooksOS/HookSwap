# HookSwapPerps — Pre-Mainnet Go-Live Checklist

> **Plain statement: HookSwapPerps is NOT mainnet-ready today.** It has **not** had an external
> professional audit; its live footprint runs on **throwaway / single-EOA keys**; and the sole live
> mainnet deployment is a **pilot** that its own config flags as "no external audit yet, owner=deployer
> 1-of-1." This checklist is the honest gate to production. Do not GA any market to real users, and do
> not raise deposit caps, until every item here is satisfied.

Sources: `config/sepolia.json`, `config/factory-sepolia.json`, `config/robinhood.json`,
`SECURITY_REVIEW.md` §5/§6, `SELF_SERVICE_SPEC.md` §11, `FINDINGS-LOG.md`.

---

## Why it is not mainnet-ready (the blocking facts)

1. **No external audit.** Only internal, single-reviewer, static reviews exist (`SECURITY_REVIEW.md`
   explicitly disclaims being an audit). `SELF_SERVICE_SPEC.md §11`: *"Full audit required before mainnet —
   permissionless + shared fees = high-value target."*
2. **Throwaway / single-key ownership everywhere live.**
   - Sepolia factory + core: `platformAdmin` / `matcher` / `treasury` = the throwaway deployer
     `0x46B7fC4978D74c6Eda6b4573E5bE2C9675846adc` (`config/factory-sepolia.json`, `config/sepolia.json`).
   - Robinhood mainnet pilot: `owner = deployer = 0xc14C897c6bff88a5Eeac31F795693b9230205125` (1-of-1 EOA),
     `matcher = 0x46B7fC49…` (`config/robinhood.json`).
   A compromise of any one of these keys is, within the trust model (`SCOPE.md §3`), equivalent to control
   over user collateral within a market (via the matcher price path) or over fees/bonds (shared-core owner).
3. **Two residual open notes** (`FINDINGS-LOG.md §7`): the storage-append comment (N-1) and the compound
   owner-lost + feed-dead unrescuable edge for **locked** collateral (N-2).
4. **The off-chain matcher / oracle engine is untrusted-until-hardened.** The upstream repo shipped a
   committed plaintext relayer key + a `SKIP_SIGNATURE_VERIFY` bypass (not copied here, but the deployed
   matcher must be proven clean). See item (e).
5. **Liquidity + a running perps-engine are external prerequisites** — without them a market quotes and
   settles nothing (item (e)).

---

## (a) External professional audit — the gate this package exists to enable

- [ ] Engage a reputable third-party auditor on the scope in `SCOPE.md` (factory stack `src/factory/*` +
      P2P core `src/perpetual/{Settlement,SettlementV2,InsuranceFund}.sol`, `src/common/*`).
- [ ] Hand them this `audit/` package + `SECURITY_REVIEW.md` + `SELF_SERVICE_SPEC.md` + the test suite.
- [ ] Resolve every audit finding (or formally accept with sign-off). Re-run the full suite after fixes.
- [ ] Add the missing test coverage flagged in `INVARIANTS.md` (S-2 `emergencyWithdraw`, `SettlementV2`,
      deeper invariant `runs`/`depth`, economic simulation of the matcher-trust surface).
- [ ] Consider the recommended residual mitigations from `SECURITY_REVIEW.md §5` not yet coded (e.g. a
      permissionless locked-collateral exit for N-2; ParamGuard re-consulted on post-handoff param changes).

## (b) Migrate every privileged role off throwaway keys → multisig / timelock

Target treasury / owner / fee-receiver = **HookSwap treasury `0x011d438E3eb3fce848950859591ec037C6529E13`**
(a multisig, per project memory — use for owners/fee-receivers, not as an operational signer).

Move ALL of the following off `0x46B7fC49…` / `0xc14C897c…`:

- [ ] **Per-market `platformAdmin`** (clone owner after handoff) → multisig (ideally behind a timelock, since
      it can `setFeeRate`/`setMarketMaxLeverage`/`setFeeReceiver`/`forceSettle` — `SECURITY_REVIEW.md` L-1).
- [ ] **Shared-core owners** — FeeRouter, MarketRegistry, BondManager, InsuranceHub, OracleGuard, ParamGuard
      → multisig/timelock. These control fee shares, registry status, bond `slash`, coverer authorization,
      and the bounded rescues.
- [ ] **`treasury` / fee-receiver / bond slash-sink** → `0x011d438E…` (currently the throwaway
      `0x70ccf8FB…` slash-sink + deployer on Sepolia; the Robinhood pilot already points feeReceiver at
      `0x011d438E…` but owner is still the 1-of-1 EOA).
- [ ] **`matcher`** → the real, dedicated perps-engine relayer key (hot but isolated), authorized via
      `setAuthorizedMatcher`; **never** reuse the deployer key. Confirm `SKIP_SIGNATURE_VERIFY` is off in the
      deployed engine and the upstream relayer key was rotated (`README.md` "Security purge").
- [ ] Retire/withdraw funds from the Robinhood 1-of-1 pilot, or transfer its `Settlement` ownership to the
      multisig, before it carries any non-pilot user funds.

## (c) Redeploy the FIXED stack + full on-chain smoke — Sepolia first, then each production chain

Per the **mandatory Sepolia-first rule** (`README.md`, project CLAUDE.md): no contract ships to a production
chain until proven on Sepolia.

- [ ] Redeploy the **final** impl + BondManager + all shared core (do **not** rely on the incrementally-
      repointed Sepolia stack — `SECURITY_REVIEW.md §6` scope note: pre-repoint clones keep older impls; N-1).
      **Mint production markets only after the final impl/BondManager are wired.**
- [ ] Run the full on-chain smoke on Sepolia: create (curated + permissionless) → deposit → EIP-712 match →
      `settleBatch` → fee-split assertions → funding → liquidation → force-pause → bond-slash → close/withdraw
      (`SELF_SERVICE_SPEC.md §11`). Prove the EIP-712 domain sync end-to-end (a signed order `settleBatch`
      accepts).
- [ ] Repeat the smoke on each target production chain **after** Sepolia passes; record deployed addresses
      back into `config/<chain>.json`.
- [ ] Re-verify bytecode on each explorer and confirm the deployed Universal-Router-independent settlement
      path behaves identically to the tested build.

## (d) Capped deposits at launch

- [ ] Launch each production market with a **conservative per-market and/or per-user deposit cap** so the
      blast radius of any residual bug is bounded while the system accrues real-world runtime.
      (There is no on-chain deposit-cap primitive in the current contracts — implement via a wrapper/allowlist
      or add a cap to the impl **before** the final audited redeploy; do not add it post-audit unaudited.)
- [ ] Keep permissionless-tier leverage conservative (spec target ≤10–20x) and the curated gate behind the
      multisig.
- [ ] Monitoring + alerting on: OracleGuard reverts, `WinnerCapped` / `ForceSettled` / `EmergencyWithdrawn`
      events, insurance sub-account depletion, and matcher liveness (mark-refresh cadence vs `PRICE_STALE_GRACE`).

## (e) Off-chain dependencies (a market does nothing without these)

- [ ] **Perps-engine matcher running per market lane** — pointed at the production chain + addresses, signing
      with the dedicated matcher key, `SKIP_SIGNATURE_VERIFY` off. The contracts fully trust it for price/fill.
- [ ] **Oracle adapter** producing the scalar mark price per market (v2 reserves / v3 TWAP / Chainlink for
      RWA), with a **live, monitored reference feed** wired into each market's OracleGuard config (MED-1 makes
      it mandatory; N-2 makes it operationally critical).
- [ ] **Liquidity / real collateral** in each market — an empty market settles nothing. (The DEX-side seeded
      liquidity is a separate workstream; the perps market needs traders depositing collateral.)
- [ ] **Keeper** for funding + liquidations.
- [ ] Domain atomicity: backend + frontend on EIP-712 `("HookSwapPerps","1")` before the settlement contract
      goes live, or every order signature silently fails (`README.md` §Rebrand).

---

## Bottom line

The contracts have a coherent isolation architecture, a documented remediation history (five internal
rounds, `FINDINGS-LOG.md`), and a green test suite (**58 passed / 0 failed**). That is the *floor* for
engaging an auditor — **not** clearance to launch. Production requires, in order: **(a) external audit →
(b) keys off throwaways onto a multisig/timelock → (c) redeploy final stack + full Sepolia-then-production
smoke → (d) capped launch → (e) live matcher + oracle + liquidity.** Until then it stays a Sepolia +
audited-pilot system, and every public statement about it must say "pre-audit," never "audited" or "safe."
