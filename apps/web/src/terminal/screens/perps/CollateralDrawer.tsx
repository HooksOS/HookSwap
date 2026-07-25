/**
 * HookSwapPerps — collateral deposit / withdraw drawer.
 *
 * A Terminal modal that funds (or defunds) the trader's isolated-margin balance in the
 * selected market clone. Deposit / Withdraw tabs; when the collateral is the market's WETH
 * it offers BOTH a raw-ETH deposit (`depositETH`, no approval) and an ERC-20 WETH deposit
 * (`deposit`, approve→deposit). Every balance is a live chain read; every tx hash links to
 * the real explorer entry. Honest states for disconnected / wrong-chain / no-market and
 * amount-exceeds-balance — nothing is fabricated (usePlaceOrder + useCollateral bind to
 * on-chain PerpMarket state).
 */
import { useEffect, useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { ExplorerDataType, getExplorerLink } from 'uniswap/src/utils/linking'
import { Modal } from '~/terminal/components/Modal'
import type { Address } from '~/chains'
import type { PerpMarketView } from '~/terminal/perps/engine/marketView'
import { useCollateral, type CollateralAsset } from '~/terminal/perps/engine/useCollateral'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

type Tab = 'deposit' | 'withdraw'

export function CollateralDrawer({
  open,
  onClose,
  market,
  trader,
  chainId,
  connected,
  wrongChain,
  onConnect,
  onSwitchChain,
  collateralSymbol: collateralSymbolProp,
}: {
  open: boolean
  onClose: () => void
  market?: PerpMarketView
  trader?: Address
  chainId: number
  connected: boolean
  wrongChain: boolean
  onConnect: () => void
  onSwitchChain: () => void
  /** Symbol of the token THIS market settles in (fixed at market creation). */
  collateralSymbol?: string
}): JSX.Element {
  const col = useCollateral({ market, trader, chainId })
  // Prefer the caller's value; otherwise read it straight off the market's collateral token.
  const collateralSymbol = collateralSymbolProp ?? col.collateralSymbol

  const [tab, setTab] = useState<Tab>('deposit')
  const [asset, setAsset] = useState<CollateralAsset>('native')
  const [amount, setAmount] = useState('')

  const base = market?.base ?? 'BASE'
  // The deposit-asset label: raw ETH vs the ERC-20 WETH collateral (both credit the same balance).
  // Follows the market's REAL collateral: a USDG-margined market must not be
  // labelled "WETH" just because WETH was the first collateral ever shipped.
  const assetLabel = asset === 'native' ? 'ETH' : (collateralSymbol ?? 'WETH')

  // When the collateral isn't WETH there's no native path → force the ERC-20 deposit.
  useEffect(() => {
    if (!col.isWethCollateral && asset === 'native') {
      setAsset('erc20')
    }
  }, [col.isWethCollateral, asset])

  // Clear the input + any prior tx when the drawer opens or the tab flips.
  useEffect(() => {
    if (open) {
      setAmount('')
      col.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab])

  const busy = col.status === 'approving' || col.status === 'depositing' || col.status === 'withdrawing' || col.status === 'confirming'
  const amountNum = Number(amount)
  const amountValid = Number.isFinite(amountNum) && amountNum > 0

  // Balance context for the active tab.
  const walletBal = asset === 'native' ? col.nativeFormatted : col.walletErc20Formatted
  const maxStr = tab === 'deposit' ? col.maxDeposit(asset) : col.maxWithdraw()

  // Over-balance guard (client-side; the contract also enforces it).
  const overBalance = useMemo(() => {
    if (!amountValid) {
      return false
    }
    const cap = Number(maxStr)
    return Number.isFinite(cap) && amountNum > cap
  }, [amountValid, amountNum, maxStr])

  const needsApproval = tab === 'deposit' && asset === 'erc20' && col.needsApproval(amount)

  const explorerTx = (hash: string): string | undefined => {
    try {
      return getExplorerLink({ chainId: chainId as UniverseChainId, data: hash, type: ExplorerDataType.TRANSACTION })
    } catch {
      return undefined
    }
  }

  /* --------------------------------------------------------------- primary action */

  const primary = ((): { label: string; onClick: () => void; disabled: boolean; tone: 'green' | 'red' } => {
    if (!connected) {
      return { label: 'Connect wallet', onClick: onConnect, disabled: false, tone: 'green' }
    }
    if (wrongChain) {
      // Was hardcoded to "Sepolia" — wrong on every other chain the markets live on.
      return { label: `Switch to ${getChainLabel(chainId as UniverseChainId)}`, onClick: onSwitchChain, disabled: false, tone: 'green' }
    }
    if (!market) {
      return { label: 'No market selected', onClick: () => undefined, disabled: true, tone: 'green' }
    }
    if (col.status === 'approving') {
      return { label: 'Approving…', onClick: () => undefined, disabled: true, tone: 'green' }
    }
    if (col.status === 'depositing' || col.status === 'withdrawing') {
      return { label: 'Confirm in wallet…', onClick: () => undefined, disabled: true, tone: tab === 'withdraw' ? 'red' : 'green' }
    }
    if (col.status === 'confirming') {
      return { label: tab === 'deposit' ? 'Depositing…' : 'Withdrawing…', onClick: () => undefined, disabled: true, tone: tab === 'withdraw' ? 'red' : 'green' }
    }
    if (tab === 'withdraw') {
      return {
        label: 'Withdraw',
        onClick: () => void col.withdraw(amount),
        disabled: !amountValid || overBalance,
        tone: 'red',
      }
    }
    if (needsApproval) {
      return {
        label: `Approve ${assetLabel}`,
        onClick: () => void col.approve(amount),
        disabled: !amountValid || overBalance,
        tone: 'green',
      }
    }
    return {
      label: `Deposit ${assetLabel}`,
      onClick: () => void col.deposit(amount, asset),
      disabled: !amountValid || overBalance,
      tone: 'green',
    }
  })()

  const accent = primary.tone === 'red' ? terminalColors.redDown : terminalColors.brandGreen
  const disabled = primary.disabled || busy

  return (
    <Modal open={open} onClose={onClose} title="Collateral" width={380} radius={18}>
      <div style={{ padding: '4px 20px 22px', fontFamily: MONO }}>
        <div style={{ fontFamily: SANS, fontSize: 12, color: terminalColors.ink3, marginBottom: 12, lineHeight: 1.5 }}>
          Isolated margin for <b style={{ color: terminalColors.ink }}>{market?.label ?? '—'}</b>
          {collateralSymbol ? (
            <>
              , settled in <b style={{ color: terminalColors.ink }}>{collateralSymbol}</b>
            </>
          ) : null}
          . Deposited collateral is held in the market and settles your positions.
          {collateralSymbol ? (
            // "Why is this WETH and not a stablecoin?" — because the collateral token
            // is fixed at market creation (createMarket(collateral,…)), so it is a
            // property of the market, not a choice here. Saying so prevents users
            // hunting for a setting that does not exist.
            <div style={{ marginTop: 6, color: terminalColors.ink3Alt, fontSize: 11.5 }}>
              Each market settles in one fixed token, set when the market was created — switch markets to use a
              different collateral.
            </div>
          ) : null}
        </div>

        {/* Disconnected: every figure below is "—" and the form cannot do anything, so
            lead with connecting rather than rendering a dead deposit form. */}
        {!connected ? (
          <div
            style={{
              fontFamily: SANS,
              fontSize: 12,
              color: terminalColors.ink3,
              background: terminalColors.panel2,
              border: `1px solid ${terminalColors.line}`,
              borderRadius: 10,
              padding: '10px 12px',
              marginBottom: 14,
              lineHeight: 1.5,
            }}
          >
            Connect a wallet to see your balances and deposit collateral.
          </div>
        ) : null}

        {/* Deposit / Withdraw */}
        <div style={{ display: 'flex', background: terminalColors.panel2, borderRadius: 8, padding: 3, gap: 2, marginBottom: 14 }}>
          {(['deposit', 'withdraw'] as const).map((t) => {
            const on = tab === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  fontFamily: MONO,
                  fontSize: 12,
                  fontWeight: 600,
                  padding: 8,
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: on ? terminalColors.ink : terminalColors.ink3,
                  background: on ? terminalColors.bg : 'transparent',
                  boxShadow: on ? '0 1px 2px rgba(20,24,15,.08)' : 'none',
                }}
              >
                {t}
              </button>
            )
          })}
        </div>

        {/* Asset toggle — only when the collateral is WETH (both paths credit the same balance). */}
        {tab === 'deposit' && col.isWethCollateral ? (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['native', 'erc20'] as const).map((a) => {
              const on = asset === a
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAsset(a)}
                  style={{
                    flex: 1,
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '7px 0',
                    borderRadius: 8,
                    cursor: 'pointer',
                    color: on ? terminalColors.greenDeep : terminalColors.ink3,
                    background: on ? terminalColors.greenBg : 'transparent',
                    border: `1px solid ${on ? terminalColors.greenBorder : terminalColors.line}`,
                  }}
                >
                  {a === 'native' ? 'ETH (wrap)' : 'WETH (ERC-20)'}
                </button>
              )
            })}
          </div>
        ) : null}

        {/* Amount */}
        <div style={{ background: terminalColors.panel, border: `1px solid ${terminalColors.line2}`, borderRadius: 8, padding: '9px 11px', marginBottom: 10 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 10,
              color: terminalColors.ink3,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 5,
            }}
          >
            <span>Amount</span>
            <span>
              {tab === 'deposit' ? `Wallet ${walletBal ?? '—'}` : `Avail ${col.availableFormatted ?? '—'}`}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              inputMode="decimal"
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontFamily: MONO,
                fontSize: 18,
                fontWeight: 600,
                color: terminalColors.ink,
                minWidth: 0,
              }}
            />
            <button
              type="button"
              onClick={() => setAmount(maxStr)}
              disabled={maxStr === ''}
              style={{
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.04em',
                color: maxStr === '' ? terminalColors.faint : terminalColors.greenDeep,
                background: terminalColors.greenBg,
                border: `1px solid ${terminalColors.greenBorder}`,
                borderRadius: 6,
                padding: '3px 8px',
                cursor: maxStr === '' ? 'default' : 'pointer',
                opacity: maxStr === '' ? 0.5 : 1,
              }}
            >
              MAX
            </button>
            <span style={{ fontSize: 12, color: terminalColors.ink3, minWidth: 40, textAlign: 'right' }}>
              {tab === 'deposit' ? assetLabel : 'WETH'}
            </span>
          </div>
        </div>

        {/* Ledger readout */}
        <div style={{ borderTop: `1px dashed ${terminalColors.line}`, paddingTop: 8, marginBottom: 4 }}>
          <Row k="Available" v={col.availableFormatted ?? '—'} />
          <Row k="Locked (in positions)" v={col.lockedRaw !== undefined ? fmt18(col.lockedRaw) : '—'} />
          {col.isWethCollateral ? <Row k="Wallet ETH" v={col.nativeFormatted ?? '—'} /> : null}
          <Row k={`Wallet ${col.isWethCollateral ? 'WETH' : 'collateral'}`} v={col.walletErc20Formatted ?? '—'} />
        </div>

        {overBalance ? (
          <div style={{ fontFamily: SANS, fontSize: 11, color: terminalColors.redDown, marginTop: 6 }}>
            Amount exceeds your {tab === 'deposit' ? 'wallet balance' : 'available balance'}.
          </div>
        ) : null}

        {/* Primary */}
        <button
          type="button"
          onClick={primary.onClick}
          disabled={disabled}
          style={{
            width: '100%',
            height: 44,
            borderRadius: 10,
            marginTop: 12,
            border: 'none',
            fontFamily: MONO,
            fontSize: 13,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: terminalColors.btnInk,
            background: wrongChain ? terminalColors.warn : accent,
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          {primary.label}
        </button>

        {/* Tx status — real receipt / error, never fabricated. */}
        {col.error ? (
          <div style={{ marginTop: 10, textAlign: 'center', fontSize: 11, color: terminalColors.redDown, fontFamily: SANS }}>
            {col.error}
          </div>
        ) : col.status === 'done' && col.txHash ? (
          <div style={{ marginTop: 10, textAlign: 'center', fontSize: 11, color: terminalColors.greenDeep }}>
            {col.lastAction === 'withdraw' ? 'Withdrawn' : 'Deposited'} ·{' '}
            {explorerTx(col.txHash) ? (
              <a href={explorerTx(col.txHash)} target="_blank" rel="noreferrer" style={{ color: terminalColors.greenDeep }}>
                {col.txHash.slice(0, 10)}…
              </a>
            ) : (
              `${col.txHash.slice(0, 10)}…`
            )}
          </div>
        ) : col.status === 'confirming' && col.txHash ? (
          <div style={{ marginTop: 10, textAlign: 'center', fontSize: 10.5, color: terminalColors.faint }}>
            Waiting for confirmation ·{' '}
            {explorerTx(col.txHash) ? (
              <a href={explorerTx(col.txHash)} target="_blank" rel="noreferrer" style={{ color: terminalColors.ink3 }}>
                {col.txHash.slice(0, 10)}…
              </a>
            ) : (
              `${col.txHash.slice(0, 10)}…`
            )}
          </div>
        ) : needsApproval && amountValid && !overBalance ? (
          <div style={{ marginTop: 10, textAlign: 'center', fontSize: 10.5, color: terminalColors.faint }}>
            One-time approval, then deposit.
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function fmt18(raw: bigint): string {
  return Number(formatUnits(raw, 18)).toLocaleString('en-US', { maximumFractionDigits: 6 })
}

function Row({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontFamily: MONO, fontSize: 11 }}>
      <span style={{ color: terminalColors.ink3 }}>{k}</span>
      <span style={{ color: terminalColors.ink }}>{v}</span>
    </div>
  )
}
