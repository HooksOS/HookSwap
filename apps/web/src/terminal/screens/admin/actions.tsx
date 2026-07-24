/**
 * HookSwapPerps admin — owner-only ACTION forms. Each form collects params, validates them,
 * and on "Generate Safe batch" emits a Gnosis Safe Transaction-Builder batch (never sends a tx).
 * Every write below is an `onlyOwner` function on a perps contract; the treasury Safe executes it.
 *
 * Actions (verified signatures — contracts/perps/src/factory/*.sol):
 *   • OracleGuard.setVenue(bytes32 sourceType, address venue, bool allowed)
 *   • MarketRegistry.setStatus(address market, uint8 status)          [0=ACTIVE 1=PAUSED 2=DELISTED]
 *   • BondManager.slash(address market)
 *   • ParamGuard.setBounds(uint256 maxLev, uint256 minMaintMarginBps, uint256 minFeeBps, uint256 maxFeeBps)
 *   • FeeRouter.setShares(uint256 platformBps, uint256 creatorBps) / setSinks(address treasury, address insuranceHub)
 *   • PerpMarket.setFeeRate(uint256) / setFeeReceiver(address) / setInsuranceFund(address)   [per market clone]
 */
import { useMemo, useState } from 'react'
import { isAddress } from 'viem'
import type { Address } from '~/chains'
import { terminalColors } from '~/terminal/theme/tokens'
import type { PerpsFactoryDeployment } from '~/terminal/perps/factory/abis'
import { RegistryStatus, type MarketRow } from '~/terminal/perps/factory/useMarkets'
import type { AdminMarket, ParamBounds } from '~/terminal/screens/admin/useAdminState'
import {
  bondManagerAdminAbi,
  CHAINLINK_SOURCE_TYPE,
  feeRouterAdminAbi,
  marketRegistryAdminAbi,
  oracleGuardAdminAbi,
  paramGuardAdminAbi,
  perpMarketAdminAbi,
} from '~/terminal/screens/admin/abis'
import { buildSafeBatch, type SafeActionSpec, type SafeBatch } from '~/terminal/screens/admin/safeBatch'
import { Button, FieldLabel, MONO, Notice, Panel, SANS, SafeBatchOutput, SelectField, TextField } from '~/terminal/screens/admin/components'

const LEVERAGE_PRECISION = 10_000n
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/

function isBytes32(s: string): boolean {
  return BYTES32_RE.test(s.trim())
}

/** Validate an address WITHOUT checksum enforcement — operators often paste lowercase. */
function isAddr(s: string): boolean {
  return isAddress(s.trim(), { strict: false })
}

/** A market <select> that falls back to a manual address entry ("custom"). */
function MarketSelect({
  markets,
  value,
  onChange,
}: {
  markets?: MarketRow[]
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  const isCustom = value === '' || !markets?.some((m) => m.market.toLowerCase() === value.toLowerCase())
  const options = [
    ...(markets ?? []).map((m) => ({ label: shortName(m), value: m.market })),
    { label: 'Custom address…', value: '__custom__' },
  ]
  const selectValue = isCustom ? '__custom__' : markets!.find((m) => m.market.toLowerCase() === value.toLowerCase())!.market
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SelectField
        value={selectValue}
        onChange={(v) => onChange(v === '__custom__' ? '' : v)}
        options={options}
      />
      {selectValue === '__custom__' ? <TextField value={value} onChange={onChange} placeholder="0x… market address" mono /> : null}
    </div>
  )
}

function shortName(m: MarketRow | AdminMarket): string {
  const name = (m as AdminMarket).name?.name
  const addr = `${m.market.slice(0, 6)}…${m.market.slice(-4)}`
  return name ? `${name} · ${addr}` : addr
}

/* ------------------------------------------------------------------ generic card shell */

function ActionCard({
  title,
  target,
  children,
  batch,
  error,
  onGenerate,
  generateLabel = 'Generate Safe batch',
  danger,
  disabled,
  filename,
}: {
  title: string
  /** Human note about what contract this action targets. */
  target: string
  children: React.ReactNode
  batch?: SafeBatch
  error?: string
  onGenerate: () => void
  generateLabel?: string
  danger?: boolean
  disabled?: boolean
  filename: string
}): JSX.Element {
  return (
    <Panel title={title}>
      <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.ink3Alt, marginBottom: 12, lineHeight: 1.5 }}>{target}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
      <div style={{ marginTop: 14 }}>
        <Button label={generateLabel} variant={danger ? 'danger' : 'solid'} onClick={onGenerate} disabled={disabled} />
      </div>
      {error ? (
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.redDown, marginTop: 8, lineHeight: 1.5 }}>{error}</div>
      ) : null}
      {batch ? <SafeBatchOutput batch={batch} filename={filename} /> : null}
    </Panel>
  )
}

/* ================================================================== 1 · OracleGuard.setVenue */

export function SetVenueAction({ chainId, deployment }: { chainId: number; deployment: PerpsFactoryDeployment }): JSX.Element {
  const [sourceType, setSourceType] = useState<string>(CHAINLINK_SOURCE_TYPE)
  const [venue, setVenue] = useState('')
  const [allowed, setAllowed] = useState('true')
  const [batch, setBatch] = useState<SafeBatch | undefined>()
  const [error, setError] = useState<string | undefined>()

  const onGenerate = (): void => {
    setBatch(undefined)
    setError(undefined)
    const st = sourceType.trim()
    if (!isBytes32(st)) {
      setError('Source type must be a bytes32 hash (0x + 64 hex).')
      return
    }
    if (!isAddr(venue)) {
      setError('Venue must be a valid address.')
      return
    }
    const spec: SafeActionSpec = {
      to: deployment.oracleGuard,
      abiFn: oracleGuardAdminAbi.find((f) => f.name === 'setVenue')! as never,
      args: [st as `0x${string}`, venue.trim() as Address, allowed === 'true'],
    }
    setBatch(
      buildSafeBatch({
        chainId,
        name: 'OracleGuard · setVenue',
        description: `${allowed === 'true' ? 'Allowlist' : 'Deny'} venue ${venue.trim()} for sourceType ${st}`,
        actions: [spec],
      }),
    )
  }

  return (
    <ActionCard
      title="Oracle · allowlist venue"
      target={`OracleGuard.setVenue(sourceType, venue, allowed) → ${deployment.oracleGuard}`}
      batch={batch}
      error={error}
      onGenerate={onGenerate}
      filename="oracleguard-setvenue"
    >
      <div>
        <FieldLabel>Source type (bytes32) — default: keccak256(&quot;chainlink&quot;)</FieldLabel>
        <TextField value={sourceType} onChange={setSourceType} placeholder="0x…" mono />
      </div>
      <div>
        <FieldLabel>Venue address (feed / AMM pair)</FieldLabel>
        <TextField value={venue} onChange={setVenue} placeholder="0x…" mono />
      </div>
      <div>
        <FieldLabel>Allowed</FieldLabel>
        <SelectField
          value={allowed}
          onChange={setAllowed}
          options={[
            { label: 'Allowlist (true)', value: 'true' },
            { label: 'Deny (false)', value: 'false' },
          ]}
        />
      </div>
    </ActionCard>
  )
}

/* ================================================================== 2 · MarketRegistry.setStatus */

export function SetStatusAction({
  chainId,
  deployment,
  markets,
}: {
  chainId: number
  deployment: PerpsFactoryDeployment
  markets?: MarketRow[]
}): JSX.Element {
  const [market, setMarket] = useState('')
  const [status, setStatus] = useState(String(RegistryStatus.Paused))
  const [batch, setBatch] = useState<SafeBatch | undefined>()
  const [error, setError] = useState<string | undefined>()

  const onGenerate = (): void => {
    setBatch(undefined)
    setError(undefined)
    if (!isAddr(market)) {
      setError('Select a market or enter a valid market address.')
      return
    }
    const statusNum = Number(status)
    const spec: SafeActionSpec = {
      to: deployment.registry,
      abiFn: marketRegistryAdminAbi.find((f) => f.name === 'setStatus')! as never,
      args: [market.trim() as Address, statusNum],
    }
    setBatch(
      buildSafeBatch({
        chainId,
        name: 'MarketRegistry · setStatus',
        description: `Set market ${market.trim()} status to ${statusLabel(statusNum)}`,
        actions: [spec],
      }),
    )
  }

  return (
    <ActionCard
      title="Market · pause / delist / reactivate"
      target={`MarketRegistry.setStatus(market, status) → ${deployment.registry}`}
      batch={batch}
      error={error}
      onGenerate={onGenerate}
      filename="marketregistry-setstatus"
    >
      <div>
        <FieldLabel>Market</FieldLabel>
        <MarketSelect markets={markets} value={market} onChange={setMarket} />
      </div>
      <div>
        <FieldLabel>New status</FieldLabel>
        <SelectField
          value={status}
          onChange={setStatus}
          options={[
            { label: 'ACTIVE (reactivate)', value: String(RegistryStatus.Active) },
            { label: 'PAUSED', value: String(RegistryStatus.Paused) },
            { label: 'DELISTED', value: String(RegistryStatus.Delisted) },
          ]}
        />
      </div>
    </ActionCard>
  )
}

function statusLabel(s: number): string {
  return s === 0 ? 'ACTIVE' : s === 1 ? 'PAUSED' : s === 2 ? 'DELISTED' : String(s)
}

/* ================================================================== 3 · BondManager.slash */

export function SlashBondAction({
  chainId,
  deployment,
  markets,
}: {
  chainId: number
  deployment: PerpsFactoryDeployment
  markets?: MarketRow[]
}): JSX.Element {
  const [market, setMarket] = useState('')
  const [batch, setBatch] = useState<SafeBatch | undefined>()
  const [error, setError] = useState<string | undefined>()

  const onGenerate = (): void => {
    setBatch(undefined)
    setError(undefined)
    if (!isAddr(market)) {
      setError('Select a market or enter a valid market address.')
      return
    }
    const spec: SafeActionSpec = {
      to: deployment.bondManager,
      abiFn: bondManagerAdminAbi.find((f) => f.name === 'slash')! as never,
      args: [market.trim() as Address],
    }
    setBatch(
      buildSafeBatch({
        chainId,
        name: 'BondManager · slash',
        description: `Slash the creation bond of market ${market.trim()} → treasury`,
        actions: [spec],
      }),
    )
  }

  return (
    <ActionCard
      title="Bond · slash abusive market"
      target={`BondManager.slash(market) → ${deployment.bondManager}`}
      danger
      batch={batch}
      error={error}
      onGenerate={onGenerate}
      generateLabel="Generate slash batch"
      filename="bondmanager-slash"
    >
      <Notice tone="warn">Slashing seizes the market&apos;s entire creation bond to the treasury — irreversible. Pair with a DELIST status change.</Notice>
      <div>
        <FieldLabel>Market</FieldLabel>
        <MarketSelect markets={markets} value={market} onChange={setMarket} />
      </div>
    </ActionCard>
  )
}

/* ================================================================== 4 · ParamGuard.setBounds */

export function SetBoundsAction({
  chainId,
  deployment,
  current,
}: {
  chainId: number
  deployment: PerpsFactoryDeployment
  current: ParamBounds
}): JSX.Element {
  // Pre-fill leverage as a human "×" (contract stores value × 1e4).
  const curLevX = current.maxLeverage !== undefined ? Number(current.maxLeverage / LEVERAGE_PRECISION) : undefined
  const [maxLevX, setMaxLevX] = useState(curLevX ? String(curLevX) : '')
  const [minMaint, setMinMaint] = useState(current.minMaintenanceMarginBps !== undefined ? current.minMaintenanceMarginBps.toString() : '')
  const [minFee, setMinFee] = useState(current.minFeeBps !== undefined ? current.minFeeBps.toString() : '')
  const [maxFee, setMaxFee] = useState(current.maxFeeBps !== undefined ? current.maxFeeBps.toString() : '')
  const [batch, setBatch] = useState<SafeBatch | undefined>()
  const [error, setError] = useState<string | undefined>()

  const onGenerate = (): void => {
    setBatch(undefined)
    setError(undefined)
    const levX = Number(maxLevX)
    if (!Number.isFinite(levX) || levX <= 0) {
      setError('Max leverage must be a positive number (×).')
      return
    }
    const nums = [minMaint, minFee, maxFee].map((s) => Number(s))
    if (nums.some((n) => !Number.isInteger(n) || n < 0)) {
      setError('Margin and fee bounds must be non-negative integers (bps).')
      return
    }
    if (Number(minFee) > Number(maxFee)) {
      setError('minFeeBps cannot exceed maxFeeBps (contract reverts BadBounds).')
      return
    }
    const spec: SafeActionSpec = {
      to: deployment.paramGuard,
      abiFn: paramGuardAdminAbi.find((f) => f.name === 'setBounds')! as never,
      args: [BigInt(levX) * LEVERAGE_PRECISION, BigInt(minMaint), BigInt(minFee), BigInt(maxFee)],
    }
    setBatch(
      buildSafeBatch({
        chainId,
        name: 'ParamGuard · setBounds',
        description: `maxLeverage ${levX}× · minMaintMargin ${minMaint}bps · fee [${minFee}, ${maxFee}]bps`,
        actions: [spec],
      }),
    )
  }

  return (
    <ActionCard
      title="Params · governance bounds"
      target={`ParamGuard.setBounds(maxLev, minMaintMarginBps, minFeeBps, maxFeeBps) → ${deployment.paramGuard}`}
      batch={batch}
      error={error}
      onGenerate={onGenerate}
      filename="paramguard-setbounds"
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <FieldLabel>Max leverage (×)</FieldLabel>
          <TextField value={maxLevX} onChange={(v) => setMaxLevX(v.replace(/[^0-9.]/g, ''))} placeholder="20" mono inputMode="decimal" />
        </div>
        <div>
          <FieldLabel>Min maintenance margin (bps)</FieldLabel>
          <TextField value={minMaint} onChange={(v) => setMinMaint(v.replace(/[^0-9]/g, ''))} placeholder="50" mono inputMode="numeric" />
        </div>
        <div>
          <FieldLabel>Min fee (bps)</FieldLabel>
          <TextField value={minFee} onChange={(v) => setMinFee(v.replace(/[^0-9]/g, ''))} placeholder="2" mono inputMode="numeric" />
        </div>
        <div>
          <FieldLabel>Max fee (bps)</FieldLabel>
          <TextField value={maxFee} onChange={(v) => setMaxFee(v.replace(/[^0-9]/g, ''))} placeholder="15" mono inputMode="numeric" />
        </div>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.faint }}>
        Leverage is stored on-chain as value × 1e4 (LEVERAGE_PRECISION). The batch encodes {maxLevX || '—'} × 1e4.
      </div>
    </ActionCard>
  )
}

/* ================================================================== 5 · FeeRouter.setShares / setSinks */

export function FeeRouterAction({ chainId, deployment }: { chainId: number; deployment: PerpsFactoryDeployment }): JSX.Element {
  const [mode, setMode] = useState<'shares' | 'sinks'>('shares')
  const [platformBps, setPlatformBps] = useState('')
  const [creatorBps, setCreatorBps] = useState('')
  const [treasury, setTreasury] = useState('')
  const [insuranceHub, setInsuranceHub] = useState('')
  const [batch, setBatch] = useState<SafeBatch | undefined>()
  const [error, setError] = useState<string | undefined>()

  const onGenerate = (): void => {
    setBatch(undefined)
    setError(undefined)
    if (mode === 'shares') {
      const p = Number(platformBps)
      const c = Number(creatorBps)
      if (!Number.isInteger(p) || !Number.isInteger(c) || p < 0 || c < 0) {
        setError('Shares must be non-negative integers (bps).')
        return
      }
      if (p + c > 10_000) {
        setError('platformBps + creatorBps cannot exceed 10000 (contract reverts BadShares).')
        return
      }
      const spec: SafeActionSpec = {
        to: deployment.feeRouter,
        abiFn: feeRouterAdminAbi.find((f) => f.name === 'setShares')! as never,
        args: [BigInt(p), BigInt(c)],
      }
      setBatch(
        buildSafeBatch({
          chainId,
          name: 'FeeRouter · setShares',
          description: `platform ${p}bps · creator ${c}bps · insurance ${10_000 - p - c}bps`,
          actions: [spec],
        }),
      )
      return
    }
    if (!isAddr(treasury) || !isAddr(insuranceHub)) {
      setError('Treasury and InsuranceHub must be valid addresses.')
      return
    }
    const spec: SafeActionSpec = {
      to: deployment.feeRouter,
      abiFn: feeRouterAdminAbi.find((f) => f.name === 'setSinks')! as never,
      args: [treasury.trim() as Address, insuranceHub.trim() as Address],
    }
    setBatch(
      buildSafeBatch({
        chainId,
        name: 'FeeRouter · setSinks',
        description: `treasury ${treasury.trim()} · insuranceHub ${insuranceHub.trim()}`,
        actions: [spec],
      }),
    )
  }

  return (
    <ActionCard
      title="Fees · router config"
      target={`FeeRouter.${mode === 'shares' ? 'setShares(platformBps, creatorBps)' : 'setSinks(treasury, insuranceHub)'} → ${deployment.feeRouter}`}
      batch={batch}
      error={error}
      onGenerate={onGenerate}
      filename={`feerouter-${mode}`}
    >
      <div>
        <FieldLabel>Action</FieldLabel>
        <SelectField
          value={mode}
          onChange={(v) => {
            setMode(v as 'shares' | 'sinks')
            setBatch(undefined)
            setError(undefined)
          }}
          options={[
            { label: 'Set fee split (setShares)', value: 'shares' },
            { label: 'Set fee sinks (setSinks)', value: 'sinks' },
          ]}
        />
      </div>
      {mode === 'shares' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Platform share (bps)</FieldLabel>
            <TextField value={platformBps} onChange={(v) => setPlatformBps(v.replace(/[^0-9]/g, ''))} placeholder="5000" mono inputMode="numeric" />
          </div>
          <div>
            <FieldLabel>Creator share (bps)</FieldLabel>
            <TextField value={creatorBps} onChange={(v) => setCreatorBps(v.replace(/[^0-9]/g, ''))} placeholder="4000" mono inputMode="numeric" />
          </div>
        </div>
      ) : (
        <>
          <div>
            <FieldLabel>Treasury</FieldLabel>
            <TextField value={treasury} onChange={setTreasury} placeholder="0x…" mono />
          </div>
          <div>
            <FieldLabel>InsuranceHub</FieldLabel>
            <TextField value={insuranceHub} onChange={setInsuranceHub} placeholder="0x…" mono />
          </div>
        </>
      )}
      {mode === 'shares' ? (
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: terminalColors.faint }}>
          Insurance share = 10000 − platform − creator. Platform share cannot drop below the on-chain floor.
        </div>
      ) : null}
    </ActionCard>
  )
}

/* ================================================================== 6 · PerpMarket per-market config */

export function MarketConfigAction({
  chainId,
  markets,
}: {
  chainId: number
  markets?: MarketRow[]
}): JSX.Element {
  const [market, setMarket] = useState('')
  const [fn, setFn] = useState<'setFeeRate' | 'setFeeReceiver' | 'setInsuranceFund'>('setFeeRate')
  const [feeRate, setFeeRate] = useState('')
  const [addr, setAddr] = useState('')
  const [batch, setBatch] = useState<SafeBatch | undefined>()
  const [error, setError] = useState<string | undefined>()

  const abiFn = useMemo(() => perpMarketAdminAbi.find((f) => f.name === fn)!, [fn])

  const onGenerate = (): void => {
    setBatch(undefined)
    setError(undefined)
    if (!isAddr(market)) {
      setError('Select a market or enter a valid market address.')
      return
    }
    let args: readonly unknown[]
    let desc: string
    if (fn === 'setFeeRate') {
      const r = Number(feeRate)
      if (!Number.isInteger(r) || r < 0 || r > 100) {
        setError('Fee rate must be an integer 0–100 (contract requires feeRate ≤ 100).')
        return
      }
      args = [BigInt(r)]
      desc = `Set market ${market.trim()} feeRate to ${r} (per-side, /10000)`
    } else {
      if (!isAddr(addr)) {
        setError('Enter a valid address.')
        return
      }
      args = [addr.trim() as Address]
      desc = `${fn}(${addr.trim()}) on market ${market.trim()}`
    }
    const spec: SafeActionSpec = {
      to: market.trim() as Address,
      abiFn: abiFn as never,
      args,
    }
    setBatch(
      buildSafeBatch({
        chainId,
        name: `PerpMarket · ${fn}`,
        description: desc,
        actions: [spec],
      }),
    )
  }

  return (
    <ActionCard
      title="Market contract · fee / receiver / insurance"
      target={`PerpMarket.${fn}(…) → the selected market clone address`}
      batch={batch}
      error={error}
      onGenerate={onGenerate}
      filename={`perpmarket-${fn}`}
    >
      <div>
        <FieldLabel>Market (the clone address is the tx target)</FieldLabel>
        <MarketSelect markets={markets} value={market} onChange={setMarket} />
      </div>
      <div>
        <FieldLabel>Function</FieldLabel>
        <SelectField
          value={fn}
          onChange={(v) => {
            setFn(v as typeof fn)
            setBatch(undefined)
            setError(undefined)
          }}
          options={[
            { label: 'setFeeRate(uint256)', value: 'setFeeRate' },
            { label: 'setFeeReceiver(address)', value: 'setFeeReceiver' },
            { label: 'setInsuranceFund(address)', value: 'setInsuranceFund' },
          ]}
        />
      </div>
      {fn === 'setFeeRate' ? (
        <div>
          <FieldLabel>Fee rate (per side, 0–100, denominated /10000)</FieldLabel>
          <TextField value={feeRate} onChange={(v) => setFeeRate(v.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="10" mono inputMode="numeric" />
        </div>
      ) : (
        <div>
          <FieldLabel>{fn === 'setFeeReceiver' ? 'Fee receiver address' : 'Insurance fund address'}</FieldLabel>
          <TextField value={addr} onChange={setAddr} placeholder="0x…" mono />
        </div>
      )}
    </ActionCard>
  )
}
