/**
 * HookSwap Locker — owner action center for the proof-of-lock detail page.
 *
 * Rendered ONLY when the connected wallet is the lock's owner (otherwise returns
 * null, so the public proof-of-lock view is untouched). Surfaces every user-facing
 * function of the ERC-20 / LP `HookSwapTokenLocker` child contract — the exact
 * contract at `lock.lockerContract` (the indexer indexes only the token-locker, so a
 * detail-page lock is always a token/LP child):
 *
 *   • Extend        → deposit(0, newUnlockTime)        — push the unlock date forward
 *   • Increase       → approve(locker, amt) + deposit(amt, 0) — add more locked tokens
 *   • Withdraw       → withdraw()                        — enabled only after unlockTime
 *   • Transfer owner → transferOwnership(newOwner)       — hand the lock to another wallet
 *   • Recovery       → withdrawEth() / withdrawToken()   — sweep stray ETH / non-locked tokens
 *
 * FACTS-ONLY: no fabricated data. Live unlock time + balance are read on-chain from
 * the child via getLockData() (falling back to the indexer values), so a just-extended
 * time / just-increased balance reflects immediately. Every button is a real wagmi
 * write with pending / success / error states and honest disabled reasons (e.g.
 * "Withdraw available after Aug 20, 2026"). If the wallet is on the wrong network we
 * offer a switch rather than letting a tx revert.
 */
import { useEffect, useMemo, useState } from 'react'
import { useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { erc20Abi, formatUnits, isAddress, parseUnits, type Address, type Hash } from '~/chains'
import { useAccount } from '~/hooks/useAccount'
import { ExplorerAddress } from '~/terminal/components/ExplorerAddress'
import { tokenLockerAbi } from '~/terminal/lockers/abis'
import type { Lock } from '~/terminal/lockers/analytics/client'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'
import { assume0xAddress } from '~/utils/wagmi'
import { ExplorerDataType } from 'uniswap/src/utils/linking'
import type { EVMUniverseChainId } from 'uniswap/src/features/chains/types'

const MONO = terminalFonts.mono
const SANS = terminalFonts.sans

/**
 * No `redBorder` token exists (green owns `greenBorder`; red does not), so the tx
 * error banner's hairline is mixed from `redDown` into `redBg` — theme-aware, and
 * a near-match for the former hardcoded #E4C7C4 in light mode.
 */
const RED_BORDER = `color-mix(in srgb, ${terminalColors.redDown} 22%, ${terminalColors.redBg})`

/** unix seconds → "Aug 20, 2026 03:14 PM". */
function fmtDateTime(unixSec: number): string {
  if (!Number.isFinite(unixSec) || unixSec <= 0) {
    return '—'
  }
  return new Date(unixSec * 1000).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** datetime-local value → unix seconds, or undefined if empty/invalid. */
function toUnix(value: string): number | undefined {
  if (!value) {
    return undefined
  }
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

/* ------------------------------------------------------------------ small parts */

function Field(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  mono?: boolean
}): JSX.Element {
  const { value, onChange, placeholder, type = 'text', mono = true } = props
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      spellCheck={false}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${terminalColors.line}`,
        borderRadius: 10,
        background: terminalColors.panel,
        padding: '9px 11px',
        fontFamily: mono ? MONO : SANS,
        fontSize: 13,
        fontWeight: 500,
        color: terminalColors.ink,
        outline: 'none',
      }}
    />
  )
}

function ActionBtn({
  children,
  onClick,
  enabled,
  tone = 'primary',
}: {
  children: React.ReactNode
  onClick: () => void
  enabled: boolean
  tone?: 'primary' | 'neutral'
}): JSX.Element {
  const primary = tone === 'primary'
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      style={{
        fontFamily: SANS,
        fontSize: 12.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        borderRadius: 10,
        padding: '9px 15px',
        cursor: enabled ? 'pointer' : 'default',
        color: enabled ? (primary ? terminalColors.btnInk : terminalColors.ink2) : terminalColors.faint,
        background: enabled ? (primary ? terminalColors.brandGreen : terminalColors.bg) : terminalColors.panel2,
        border: primary ? 'none' : `1px solid ${terminalColors.line}`,
      }}
    >
      {children}
    </button>
  )
}

function ActionRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: terminalColors.ink }}>{label}</span>
        {hint ? <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3, lineHeight: 1.45 }}>{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ component */

export function LockOwnerActions({ lock, onChanged }: { lock: Lock; onChanged: () => void }): JSX.Element | null {
  const account = useAccount()
  const { switchChain } = useSwitchChain()

  const connectedAddr = account.address
  const onRightChain = account.chainId === lock.chainId

  const lockerAddr = assume0xAddress(lock.lockerContract)
  const tokenAddr = assume0xAddress(lock.token)

  // Ownership is gated on the AUTHORITATIVE on-chain owner, not the indexer's `lock.owner`
  // (which can be stale — e.g. right after a transferOwnership). Read `owner()` from the
  // child lock contract whenever a wallet is connected; fall back to the indexer value only
  // while that read is in flight, so a wallet never sees owner controls it doesn't hold.
  const ownerRead = useReadContract({
    address: lockerAddr,
    chainId: lock.chainId,
    abi: tokenLockerAbi,
    functionName: 'owner',
    query: { enabled: Boolean(connectedAddr) },
  })
  const onChainOwner = ownerRead.data as Address | undefined
  const effectiveOwner = onChainOwner ?? lock.owner
  const isOwner = Boolean(connectedAddr && connectedAddr.toLowerCase() === effectiveOwner.toLowerCase())

  // Live on-chain lock data (unlock time + balance) from the child, so a just-extended
  // time / just-increased balance reflects without waiting for the indexer. No inputs.
  const lockDataRead = useReadContract({
    address: lockerAddr,
    chainId: lock.chainId,
    abi: tokenLockerAbi,
    functionName: 'getLockData',
    query: { enabled: isOwner },
  })
  const lockData = lockDataRead.data as
    | readonly [boolean, number, Address, Address, Address, Address, number, number, bigint, bigint]
    | undefined

  const liveUnlockTime = lockData ? Number(lockData[7]) : lock.unlockTime
  const liveBalance = lockData ? lockData[8] : undefined
  const now = Math.floor(Date.now() / 1000)
  const unlockable = liveUnlockTime <= now

  // ---- write plumbing: one submitted tx tracked at a time ----
  const { writeContractAsync, isPending: isSubmitting } = useWriteContract()
  const [txHash, setTxHash] = useState<Hash | undefined>(undefined)
  const [txLabel, setTxLabel] = useState<string>('')
  const [txError, setTxError] = useState<string | undefined>(undefined)
  const receipt = useWaitForTransactionReceipt({ hash: txHash, chainId: lock.chainId })
  const busy = isSubmitting || (Boolean(txHash) && receipt.isLoading)

  const submit = async (label: string, run: () => Promise<Hash>): Promise<void> => {
    setTxError(undefined)
    setTxLabel(label)
    try {
      const hash = await run()
      setTxHash(hash)
    } catch (e) {
      setTxHash(undefined)
      setTxError(e instanceof Error ? shortenError(e.message) : 'Transaction rejected')
    }
  }

  // ---- extend ----
  const [extendValue, setExtendValue] = useState('')
  const extendUnix = toUnix(extendValue)
  const canExtend = onRightChain && extendUnix !== undefined && extendUnix > liveUnlockTime && !busy
  const onExtend = (): void => {
    if (extendUnix === undefined) {
      return
    }
    void submit('Extend', () =>
      writeContractAsync({
        address: lockerAddr,
        chainId: lock.chainId,
        abi: tokenLockerAbi,
        functionName: 'deposit',
        args: [0n, extendUnix],
      }),
    )
  }

  // ---- increase amount (approve → deposit) ----
  const [amountValue, setAmountValue] = useState('')
  const balanceRead = useReadContract({
    address: tokenAddr,
    chainId: lock.chainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: connectedAddr ? [connectedAddr] : undefined,
    query: { enabled: isOwner && Boolean(connectedAddr) },
  })
  const allowanceRead = useReadContract({
    address: tokenAddr,
    chainId: lock.chainId,
    abi: erc20Abi,
    functionName: 'allowance',
    args: connectedAddr ? [connectedAddr, lockerAddr] : undefined,
    query: { enabled: isOwner && Boolean(connectedAddr) },
  })
  const walletBalance = balanceRead.data as bigint | undefined
  const allowance = allowanceRead.data as bigint | undefined

  // Refresh live reads + notify the parent (indexer refetch) once a tx confirms.
  useEffect(() => {
    if (receipt.isSuccess) {
      void ownerRead.refetch()
      void lockDataRead.refetch()
      void balanceRead.refetch()
      void allowanceRead.refetch()
      onChanged()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess])

  const amountRaw = useMemo(() => {
    if (!amountValue.trim()) {
      return undefined
    }
    try {
      return parseUnits(amountValue.trim(), lock.decimals)
    } catch {
      return undefined
    }
  }, [amountValue, lock.decimals])

  const amountValid = amountRaw !== undefined && amountRaw > 0n
  const insufficient = amountValid && walletBalance !== undefined && amountRaw > walletBalance
  const needsApproval = amountValid && allowance !== undefined && allowance < amountRaw
  const onApprove = (): void => {
    if (amountRaw === undefined || amountRaw <= 0n) {
      return
    }
    const amt = amountRaw
    void submit('Approve', () =>
      writeContractAsync({
        address: tokenAddr,
        chainId: lock.chainId,
        abi: erc20Abi,
        functionName: 'approve',
        args: [lockerAddr, amt],
      }),
    )
  }
  const onDeposit = (): void => {
    if (amountRaw === undefined || amountRaw <= 0n) {
      return
    }
    const amt = amountRaw
    void submit('Increase amount', () =>
      writeContractAsync({
        address: lockerAddr,
        chainId: lock.chainId,
        abi: tokenLockerAbi,
        functionName: 'deposit',
        args: [amt, 0],
      }),
    )
  }

  // ---- withdraw ----
  const onWithdraw = (): void => {
    void submit('Withdraw', () =>
      writeContractAsync({
        address: lockerAddr,
        chainId: lock.chainId,
        abi: tokenLockerAbi,
        functionName: 'withdraw',
        args: [],
      }),
    )
  }

  // ---- transfer ownership ----
  const [newOwner, setNewOwner] = useState('')
  const newOwnerValid = isAddress(newOwner) && newOwner.toLowerCase() !== effectiveOwner.toLowerCase()
  const onTransfer = (): void => {
    if (!newOwnerValid) {
      return
    }
    void submit('Transfer ownership', () =>
      writeContractAsync({
        address: lockerAddr,
        chainId: lock.chainId,
        abi: tokenLockerAbi,
        functionName: 'transferOwnership',
        args: [assume0xAddress(newOwner)],
      }),
    )
  }

  // ---- advanced recovery ----
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [recoverToken, setRecoverToken] = useState('')
  const recoverValid =
    isAddress(recoverToken) && recoverToken.toLowerCase() !== lock.token.toLowerCase()
  const onWithdrawEth = (): void => {
    void submit('Recover ETH', () =>
      writeContractAsync({
        address: lockerAddr,
        chainId: lock.chainId,
        abi: tokenLockerAbi,
        functionName: 'withdrawEth',
        args: [],
      }),
    )
  }
  const onWithdrawToken = (): void => {
    if (!recoverValid) {
      return
    }
    void submit('Recover token', () =>
      writeContractAsync({
        address: lockerAddr,
        chainId: lock.chainId,
        abi: tokenLockerAbi,
        functionName: 'withdrawToken',
        args: [assume0xAddress(recoverToken)],
      }),
    )
  }

  // Only the owner sees the action center — everyone else keeps the read-only view.
  if (!isOwner) {
    return null
  }

  const balanceLabel =
    walletBalance !== undefined ? `Wallet balance ${trimAmount(formatUnits(walletBalance, lock.decimals))} ${lock.symbol}` : undefined

  return (
    <div
      style={{
        marginTop: 22,
        borderTop: `1px solid ${terminalColors.line2}`,
        paddingTop: 18,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span
          style={{
            fontFamily: SANS,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: terminalColors.faint,
          }}
        >
          Owner actions
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 600,
            color: terminalColors.greenDeep,
            background: terminalColors.greenBg,
            border: `1px solid ${terminalColors.greenBorder}`,
            borderRadius: 999,
            padding: '1px 7px',
          }}
        >
          YOU OWN THIS LOCK
        </span>
      </div>

      {/* wrong-network guard */}
      {!onRightChain ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '10px 13px',
            marginTop: 12,
            border: `1px dashed ${terminalColors.line}`,
            borderRadius: 11,
            background: terminalColors.panel,
            fontFamily: SANS,
            fontSize: 12.5,
            color: terminalColors.ink3,
          }}
        >
          <span>
            Your wallet is on a different network. Switch to {lock.chainName} to manage this lock.
          </span>
          <ActionBtn enabled onClick={() => switchChain({ chainId: lock.chainId as EVMUniverseChainId })}>
            Switch to {lock.chainName}
          </ActionBtn>
        </div>
      ) : null}

      {/* tx status banner */}
      {txHash || txError ? (
        <div
          style={{
            marginTop: 12,
            padding: '10px 13px',
            borderRadius: 11,
            border: `1px solid ${txError ? RED_BORDER : terminalColors.greenBorder}`,
            background: txError ? terminalColors.redBg : terminalColors.greenBg,
            fontFamily: SANS,
            fontSize: 12.5,
            color: terminalColors.ink2,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {txError ? (
            <span style={{ color: terminalColors.redDown }}>✕ {txLabel} failed — {txError}</span>
          ) : receipt.isSuccess ? (
            <span style={{ color: terminalColors.greenDeep }}>✓ {txLabel} confirmed</span>
          ) : (
            <span>⏳ {txLabel} pending…</span>
          )}
          {txHash ? (
            <ExplorerAddress address={txHash} chainId={lock.chainId} type={ExplorerDataType.TRANSACTION} fontSize={11.5} />
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Extend */}
        <ActionRow label="Extend lock" hint={`Push the unlock date forward. Current: ${fmtDateTime(liveUnlockTime)}.`}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <Field value={extendValue} onChange={setExtendValue} type="datetime-local" mono={false} />
            </div>
            <ActionBtn enabled={canExtend} onClick={onExtend}>
              {busy && txLabel === 'Extend' ? 'Confirm…' : 'Extend'}
            </ActionBtn>
          </div>
          {extendUnix !== undefined && extendUnix <= liveUnlockTime ? (
            <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.warn }}>
              New unlock must be later than the current unlock time.
            </span>
          ) : null}
        </ActionRow>

        {/* Increase amount */}
        <ActionRow
          label="Increase locked amount"
          hint={
            [`Add more ${lock.symbol} to this lock.`, balanceLabel].filter(Boolean).join(' ')
          }
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <Field value={amountValue} onChange={setAmountValue} placeholder={`Amount of ${lock.symbol}`} />
            </div>
            {needsApproval ? (
              <ActionBtn enabled={onRightChain && amountValid && !insufficient && !busy} onClick={onApprove}>
                {busy && txLabel === 'Approve' ? 'Confirm…' : `Approve ${lock.symbol}`}
              </ActionBtn>
            ) : (
              <ActionBtn
                enabled={onRightChain && amountValid && !insufficient && allowance !== undefined && !busy}
                onClick={onDeposit}
              >
                {busy && txLabel === 'Increase amount' ? 'Confirm…' : 'Add tokens'}
              </ActionBtn>
            )}
          </div>
          {insufficient ? (
            <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.warn }}>
              Amount exceeds your wallet balance.
            </span>
          ) : null}
          {lock.isLpToken ? (
            <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3 }}>
              This is an LP lock — the amount is in LP tokens.
            </span>
          ) : null}
        </ActionRow>

        {/* Withdraw */}
        <ActionRow
          label="Withdraw"
          hint={
            unlockable
              ? liveBalance !== undefined
                ? `Sends the full balance (${trimAmount(formatUnits(liveBalance, lock.decimals))} ${lock.symbol}) back to you.`
                : 'Sends the full locked balance back to you.'
              : `Available after ${fmtDateTime(liveUnlockTime)}.`
          }
        >
          <div>
            <ActionBtn enabled={onRightChain && unlockable && !busy} onClick={onWithdraw}>
              {busy && txLabel === 'Withdraw' ? 'Confirm…' : unlockable ? 'Withdraw all' : 'Locked'}
            </ActionBtn>
          </div>
        </ActionRow>

        {/* Transfer ownership */}
        <ActionRow label="Transfer ownership" hint="Hand this lock to another wallet. The new owner controls all actions.">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <Field value={newOwner} onChange={setNewOwner} placeholder="0x… new owner address" />
            </div>
            <ActionBtn enabled={onRightChain && newOwnerValid && !busy} onClick={onTransfer} tone="neutral">
              {busy && txLabel === 'Transfer ownership' ? 'Confirm…' : 'Transfer'}
            </ActionBtn>
          </div>
          {newOwner.trim() && !isAddress(newOwner) ? (
            <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.warn }}>Enter a valid address.</span>
          ) : null}
        </ActionRow>

        {/* Advanced recovery */}
        <div style={{ paddingTop: 14 }}>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.03em',
              color: terminalColors.ink3,
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            {showAdvanced ? '▾' : '▸'} Advanced recovery
          </button>
          {showAdvanced ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.ink3, lineHeight: 1.5 }}>
                Recover assets that landed in this lock by accident (e.g. dividends). Recovering the locked token
                itself reverts — use Withdraw for that.
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <Field value={recoverToken} onChange={setRecoverToken} placeholder="0x… token to recover" />
                </div>
                <ActionBtn enabled={onRightChain && recoverValid && !busy} onClick={onWithdrawToken} tone="neutral">
                  {busy && txLabel === 'Recover token' ? 'Confirm…' : 'Recover token'}
                </ActionBtn>
              </div>
              {recoverToken.trim() && recoverToken.toLowerCase() === lock.token.toLowerCase() ? (
                <span style={{ fontFamily: SANS, fontSize: 11.5, color: terminalColors.warn }}>
                  That is the locked token — use Withdraw instead.
                </span>
              ) : null}
              <div>
                <ActionBtn enabled={onRightChain && !busy} onClick={onWithdrawEth} tone="neutral">
                  {busy && txLabel === 'Recover ETH' ? 'Confirm…' : 'Recover stray ETH'}
                </ActionBtn>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Trim a formatUnits string to at most 6 fractional digits (display only). */
function trimAmount(s: string): string {
  const [whole, frac] = s.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (!frac) {
    return grouped
  }
  const short = frac.slice(0, 6).replace(/0+$/, '')
  return short ? `${grouped}.${short}` : grouped
}

/** Keep on-chain error banners short + readable (strip the giant viem dump). */
function shortenError(msg: string): string {
  const firstLine = msg.split('\n')[0]?.trim() ?? msg
  return firstLine.length > 140 ? `${firstLine.slice(0, 140)}…` : firstLine
}
