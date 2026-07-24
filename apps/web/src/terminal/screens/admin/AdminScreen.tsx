/**
 * HookSwapPerps — OPERATOR ADMIN CONSOLE (hidden `/admin` route, for admin.hookswap.org).
 *
 * A read + Safe-batch-generate console for platform operators. It NEVER holds keys or sends
 * owner txs: the owner of every perps contract is the treasury Gnosis Safe multisig, so each
 * admin action is emitted as an importable Safe Transaction-Builder batch that the multisig
 * owners sign. The console:
 *   1. Gates the UI on the treasury Safe's `getOwners()` (defense-in-UX; the real gate is the
 *      Safe's required owner signatures).
 *   2. Reads + displays LIVE on-chain perps state per chain (markets, oracle, bounds, bonds,
 *      insurance, fees) — facts only, honest "—" for anything unreadable.
 *   3. For each owner-only function, renders a form + "Generate Safe batch".
 *
 * Design: DAYSIGNAL Terminal-native (terminalColors/--t-* theme-aware, IBM Plex Mono for
 * addresses/numbers, InstrumentPanel/StatCard chrome). Not in the public nav.
 */
import { useMemo, useState } from 'react'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { ExplorerDataType } from 'uniswap/src/utils/linking'
import { formatUnits } from '~/chains'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { useAccount } from '~/hooks/useAccount'
import { ExplorerAddress, shortAddr } from '~/terminal/components/ExplorerAddress'
import { Eyebrow } from '~/terminal/components/InstrumentPanel'
import { StatCard } from '~/terminal/components/StatCard'
import { getPerpsFactoryDeployment, PERPS_FACTORY_ADDRESSES } from '~/terminal/perps/factory/abis'
import { RegistryStatus, RegistryTier } from '~/terminal/perps/factory/useMarkets'
import { terminalColors } from '~/terminal/theme/tokens'
import {
  FeeRouterAction,
  MarketConfigAction,
  SetBoundsAction,
  SetStatusAction,
  SetVenueAction,
  SlashBondAction,
} from '~/terminal/screens/admin/actions'
import { Button, DISPLAY, MONO, Notice, Panel, Row, SANS } from '~/terminal/screens/admin/components'
import { useAdminState, type AdminMarket } from '~/terminal/screens/admin/useAdminState'
import { useSafeOwners } from '~/terminal/screens/admin/useSafeOwners'

/* ------------------------------------------------------------------ helpers */

const PERPS_CHAIN_IDS = Object.keys(PERPS_FACTORY_ADDRESSES).map((k) => Number(k) as UniverseChainId)

function fmtEth(wei?: bigint): string {
  if (wei === undefined) {
    return '—'
  }
  if (wei === 0n) {
    return '0 ETH'
  }
  return `${Number(formatUnits(wei, 18)).toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH`
}

function fmtBps(bps?: bigint): string {
  if (bps === undefined) {
    return '—'
  }
  return `${bps.toString()} bps (${(Number(bps) / 100).toFixed(2)}%)`
}

function fmtSeconds(s?: bigint): string {
  if (s === undefined) {
    return '—'
  }
  const n = Number(s)
  if (n % 86400 === 0) {
    return `${n / 86400}d (${n}s)`
  }
  if (n % 3600 === 0) {
    return `${n / 3600}h (${n}s)`
  }
  return `${n}s`
}

function fmtDate(ts?: bigint): string {
  if (ts === undefined || ts === 0n) {
    return '—'
  }
  return new Date(Number(ts) * 1000).toISOString().slice(0, 10)
}

function statusText(status: RegistryStatus): { label: string; color: string } {
  switch (status) {
    case RegistryStatus.Active:
      return { label: 'ACTIVE', color: terminalColors.greenDeep }
    case RegistryStatus.Paused:
      return { label: 'PAUSED', color: terminalColors.warn }
    case RegistryStatus.Delisted:
      return { label: 'DELISTED', color: terminalColors.redDown }
    default:
      return { label: '—', color: terminalColors.ink3Alt }
  }
}

/* ------------------------------------------------------------------ markets table */

function MarketsTable({ chainId, markets }: { chainId: number; markets?: AdminMarket[] }): JSX.Element {
  if (markets === undefined) {
    return <Notice tone="muted">Loading markets…</Notice>
  }
  if (markets.length === 0) {
    return <Notice tone="muted">No markets registered on this chain yet.</Notice>
  }
  const th: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: terminalColors.ink3Alt,
    textAlign: 'left',
    padding: '6px 10px',
    borderBottom: `1px solid ${terminalColors.line}`,
    whiteSpace: 'nowrap',
  }
  const td: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: 11.5,
    color: terminalColors.ink,
    padding: '8px 10px',
    borderBottom: `1px solid ${terminalColors.line2}`,
    whiteSpace: 'nowrap',
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
        <thead>
          <tr>
            <th style={th}>Market</th>
            <th style={th}>Tier</th>
            <th style={th}>Status</th>
            <th style={th}>Collateral</th>
            <th style={th}>Creator</th>
            <th style={th}>Created</th>
            <th style={th}>Bond</th>
            <th style={th}>Insurance</th>
            <th style={th}>Oracle venue</th>
            <th style={th}>Dev / stale</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((m) => {
            const st = statusText(m.status)
            return (
              <tr key={m.market}>
                <td style={td}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontWeight: 600 }}>{m.name?.name ?? 'MKT'}</span>
                    <ExplorerAddress address={m.market} chainId={chainId} fontSize={10.5} />
                  </div>
                </td>
                <td style={td}>{m.tier === RegistryTier.Curated ? 'CURATED' : 'PERMLESS'}</td>
                <td style={{ ...td, color: st.color, fontWeight: 600 }}>{st.label}</td>
                <td style={td}>
                  <ExplorerAddress address={m.collateral} chainId={chainId} type={ExplorerDataType.TOKEN} fontSize={10.5} label={m.name?.collateralSymbol} />
                </td>
                <td style={td}>
                  <ExplorerAddress address={m.creator} chainId={chainId} fontSize={10.5} />
                </td>
                <td style={td}>{fmtDate(m.createdAt)}</td>
                <td style={td}>
                  {m.bond ? (
                    <span style={{ color: m.bond.slashed ? terminalColors.redDown : m.bond.withdrawn ? terminalColors.ink3Alt : terminalColors.ink }}>
                      {fmtEth(m.bond.amount)}
                      {m.bond.slashed ? ' · SLASHED' : m.bond.withdrawn ? ' · WITHDRAWN' : ''}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={td}>{m.insuranceBalance !== undefined ? `${m.insuranceBalance.toString()} raw` : '—'}</td>
                <td style={td}>{m.oracle ? shortAddr(m.oracle.venue) : '—'}</td>
                <td style={td}>{m.oracle ? `${m.oracle.maxDeviationBps.toString()}bps / ${m.oracle.maxStaleness.toString()}s` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ the screen */

export function AdminScreen(): JSX.Element {
  const account = useAccount()
  const accountDrawer = useAccountDrawer()
  const connected = Boolean(account.address)

  // Panel-selected chain (independent of the connected wallet chain — reads are cross-chain).
  const [chainId, setChainId] = useState<UniverseChainId>(PERPS_CHAIN_IDS[0] ?? UniverseChainId.Sepolia)
  const deployment = getPerpsFactoryDeployment(chainId)

  const safe = useSafeOwners({ chainId, account: account.address })
  const state = useAdminState({ chainId })

  const marketRows = useMemo(() => state.markets, [state.markets])

  // Owner-only actions are shown only when the connected wallet is a Safe owner.
  const showActions = connected && safe.isOwner && Boolean(deployment)

  return (
    <div style={{ padding: '20px var(--tm-gutter) 48px' }}>
      {/* Header */}
      <Eyebrow style={{ display: 'block', marginBottom: 8 }}>HookSwapPerps · Operator console</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: terminalColors.ink, margin: 0 }}>
          Perps admin
        </h1>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 600,
            color: terminalColors.greenDeep,
            background: terminalColors.greenBg,
            border: `1px solid ${terminalColors.greenBorder}`,
            padding: '3px 8px',
            borderRadius: 999,
          }}
        >
          Safe-signed · no keys held
        </span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: terminalColors.ink2, marginBottom: 16, maxWidth: 720, lineHeight: 1.5 }}>
        Read live perps state and generate Gnosis Safe Transaction-Builder batches for every owner-only action. Every
        contract is owned by the treasury Safe multisig, so this console never sends a transaction — it produces a batch
        the Safe owners import, review, and sign.
      </div>

      {/* Chain selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {PERPS_CHAIN_IDS.map((id) => {
          const active = id === chainId
          return (
            <button
              key={id}
              type="button"
              onClick={() => setChainId(id)}
              style={{
                fontFamily: MONO,
                fontSize: 11.5,
                fontWeight: 600,
                color: active ? terminalColors.greenDeep : terminalColors.ink3Alt,
                background: active ? terminalColors.greenBg : 'transparent',
                border: `1px solid ${active ? terminalColors.greenBorder : terminalColors.line}`,
                borderRadius: 9,
                padding: '7px 16px',
                cursor: 'pointer',
              }}
            >
              {getChainLabel(id)} · {id}
            </button>
          )
        })}
      </div>

      {/* Safe gate */}
      <div style={{ marginBottom: 18 }}>
        <Panel title="Authorization" corners>
          <Row
            label="Treasury Safe"
            value={<ExplorerAddress address={safe.safe} chainId={chainId} fontSize={12.5} fontWeight={500} short={false} />}
          />
          {safe.error ? (
            <Notice tone="warn">
              Couldn&apos;t read the treasury Safe on {getChainLabel(chainId)} (it may not be deployed on this chain, or the
              RPC is unavailable). Actions stay hidden — the real gate is the Safe&apos;s owner signatures regardless.
            </Notice>
          ) : (
            <>
              <Row label="Owners" value={safe.owners ? String(safe.owners.length) : safe.isLoading ? 'loading…' : '—'} />
              <Row label="Threshold" value={safe.threshold !== undefined ? `${safe.threshold}-of-${safe.owners?.length ?? '?'}` : '—'} />
              {!connected ? (
                <div style={{ marginTop: 10 }}>
                  <Button label="Connect wallet" onClick={() => accountDrawer.open()} />
                </div>
              ) : safe.isLoading ? (
                <Notice tone="muted">Verifying Safe ownership…</Notice>
              ) : safe.isOwner ? (
                <Notice tone="green">
                  Connected wallet <strong>{shortAddr(account.address)}</strong> is a treasury-Safe owner. Admin actions
                  are unlocked below.
                </Notice>
              ) : (
                <Notice tone="red">
                  Not authorized — <strong>{shortAddr(account.address)}</strong> is not a treasury-Safe owner. Connect a
                  Safe owner wallet to generate admin batches. (State below is still readable.)
                </Notice>
              )}
            </>
          )}
        </Panel>
      </div>

      {!deployment ? (
        <Notice tone="muted">The perps factory suite isn&apos;t deployed on {getChainLabel(chainId)}.</Notice>
      ) : (
        <>
          {/* KPI tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            <StatCard size="lg" label="Markets" value={state.marketCount !== undefined ? String(state.marketCount) : undefined} />
            <StatCard size="lg" label="Listing fee" value={state.factory.listingFee !== undefined ? fmtEth(state.factory.listingFee) : undefined} />
            <StatCard size="lg" label="Bonds held" value={state.bonds.totalBondsHeld !== undefined ? fmtEth(state.bonds.totalBondsHeld) : undefined} />
            <StatCard size="lg" label="Platform fee" value={state.fees.platformShareBps !== undefined ? `${(Number(state.fees.platformShareBps) / 100).toFixed(0)}%` : undefined} />
          </div>

          {/* Config panels */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 16 }}>
            <Panel title="Fees · FeeRouter + factory">
              <Row label="Platform share" value={fmtBps(state.fees.platformShareBps)} />
              <Row label="Creator share" value={fmtBps(state.fees.creatorShareBps)} />
              <Row label="Insurance share" value={fmtBps(state.fees.insuranceShareBps)} />
              <Row label="Platform floor" value={fmtBps(state.fees.platformFloorBps)} />
              <Row label="Fee treasury" value={<ExplorerAddress address={state.fees.treasury} chainId={chainId} fontSize={12} />} />
              <Row label="InsuranceHub sink" value={<ExplorerAddress address={state.fees.insuranceHub} chainId={chainId} fontSize={12} />} />
              <Row label="Listing fee" value={fmtEth(state.factory.listingFee)} />
              <Row label="Min bond · curated" value={fmtEth(state.factory.minBondCurated)} />
              <Row label="Min bond · permissionless" value={fmtEth(state.factory.minBondPermissionless)} />
            </Panel>

            <Panel title="Params · ParamGuard bounds">
              <Row
                label="Max leverage"
                value={state.bounds.maxLeverage !== undefined ? `${Number(state.bounds.maxLeverage / 10000n)}× (${state.bounds.maxLeverage.toString()})` : '—'}
              />
              <Row label="Min maintenance margin" value={fmtBps(state.bounds.minMaintenanceMarginBps)} />
              <Row label="Min fee" value={fmtBps(state.bounds.minFeeBps)} />
              <Row label="Max fee" value={fmtBps(state.bounds.maxFeeBps)} />
            </Panel>

            <Panel title="Oracle + bonds (global)">
              <Row label="OracleGuard factory" value={<ExplorerAddress address={state.oracle.factory} chainId={chainId} fontSize={12} />} />
              <Row label="Global min liquidity" value={state.oracle.minLiquidity !== undefined ? state.oracle.minLiquidity.toString() : '—'} />
              <Row label="Bond treasury" value={<ExplorerAddress address={state.bonds.treasury} chainId={chainId} fontSize={12} />} />
              <Row label="Withdraw delay" value={fmtSeconds(state.bonds.withdrawDelay)} />
              <Row label="Total bonds held" value={fmtEth(state.bonds.totalBondsHeld)} />
            </Panel>
          </div>

          {/* Markets table */}
          <div style={{ marginBottom: 20 }}>
            <Panel title="Markets" meta={state.marketCount !== undefined ? [`${state.marketCount} total`] : undefined}>
              <MarketsTable chainId={chainId} markets={marketRows} />
              <div style={{ fontFamily: SANS, fontSize: 10.5, color: terminalColors.faint, marginTop: 10, lineHeight: 1.5 }}>
                Read live from MarketRegistry + OracleGuard + BondManager + InsuranceHub. Insurance balance is in the
                market&apos;s collateral token (raw units). Bond amounts are native ETH. Names derive from each market&apos;s
                Chainlink reference feed; markets without a readable feed show the address only.
              </div>
            </Panel>
          </div>

          {/* Actions */}
          <div style={{ marginBottom: 10 }}>
            <Eyebrow style={{ display: 'block', marginBottom: 4 }}>Admin actions</Eyebrow>
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: terminalColors.ink2, lineHeight: 1.5 }}>
              Each action generates a Safe Transaction-Builder batch (chainId {chainId}). The panel encodes calldata only —
              the treasury Safe signs and executes.
            </div>
          </div>

          {!showActions ? (
            <Notice tone="muted">
              {connected
                ? 'Admin actions are hidden — connect a treasury-Safe owner wallet to generate batches. (Anyone can still verify the state above.)'
                : 'Connect a treasury-Safe owner wallet to generate admin batches.'}
            </Notice>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
              <SetVenueAction chainId={chainId} deployment={deployment} />
              <SetStatusAction chainId={chainId} deployment={deployment} markets={marketRows} />
              <SlashBondAction chainId={chainId} deployment={deployment} markets={marketRows} />
              <SetBoundsAction chainId={chainId} deployment={deployment} current={state.bounds} />
              <FeeRouterAction chainId={chainId} deployment={deployment} />
              <MarketConfigAction chainId={chainId} markets={marketRows} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
