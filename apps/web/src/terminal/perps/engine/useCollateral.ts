/**
 * HookSwapPerps — collateral deposit / withdraw (all on-chain, no engine, no Permit2).
 *
 * The order flow requires collateral pre-deposited into the market clone (usePlaceOrder's
 * deposit guard). This hook is the funding side: it reads the trader's on-chain ledger +
 * wallet balances and drives the three writes the market exposes.
 *
 * CONTRACT FACTS (verified against contracts/perps/src/factory/PerpMarket.sol):
 *   • The on-chain ledger `getUserBalance(user) → (available, locked)` is ALWAYS in
 *     STANDARD_DECIMALS = 18 units, regardless of collateral token decimals
 *     (PerpMarket.sol:84 `STANDARD_DECIMALS = 18`, :1024 getUserBalance).
 *   • `deposit(token, amount)` (PerpMarket.sol:306) pulls `amount` in the TOKEN's NATIVE
 *     decimals via safeTransferFrom, then normalizes to 18 → parse deposits in token decimals.
 *     Requires prior ERC-20 approve(market, amount).
 *   • `depositETH()` payable (PerpMarket.sol:340) wraps `msg.value` (wei, ETH = 18) to WETH
 *     and credits `available`. No approval. Only valid when `weth != 0` and `supportedTokens[weth]`.
 *   • `withdraw(token, amount)` (PerpMarket.sol:366) debits `available` by `amount` in STANDARD
 *     18-dec units, then transfers `_fromStandardDecimals(amount)` tokens out → parse withdrawals
 *     in 18-dec. `whenNotPaused`.
 *   • `weth()` (PerpMarket.sol:158) is the market's wrapped-native; when `collateral == weth()`
 *     BOTH the native-ETH path (`depositETH`) and the ERC-20 WETH path (`deposit`) are valid.
 *
 * DATA POLICY: every balance/allowance is a real chain read; every tx hash is a real broadcast
 * result. Nothing is fabricated. Honest disabled reasons for no-wallet / wrong-chain / no-market
 * / amount-exceeds-balance.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import type { Address, Hash } from '~/chains'
import type { PerpMarketView } from '~/terminal/perps/engine/marketView'
import { erc20Abi, perpMarketReadAbi, perpMarketWriteAbi, STANDARD_DECIMALS } from '~/terminal/perps/engine/perpMarketAbi'

/** Minimal `symbol()` ABI — the module's local erc20Abi only declares the three
 *  functions the deposit flow needs (decimals/balanceOf/allowance). */
const ERC20_SYMBOL_ABI = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const

/** Which asset a deposit moves when the collateral is WETH: raw ETH (wrapped) or the ERC-20. */
export type CollateralAsset = 'native' | 'erc20'

/** Tx lifecycle for the funding actions. */
export type CollateralStatus = 'idle' | 'approving' | 'depositing' | 'withdrawing' | 'confirming' | 'done' | 'error'

export interface UseCollateral {
  /** True when a market + trader are present (reads/writes can proceed). */
  ready: boolean
  /** True when the market's collateral == its weth() → the native-ETH deposit path is offered. */
  isWethCollateral: boolean
  /** The market's wrapped-native address (depositETH target), or undefined until read. */
  weth?: Address
  /** Collateral token decimals for the ERC-20 amount fields (deposit/wallet balance/allowance). */
  collateralDecimals: number
  /** Collateral token symbol (e.g. "WETH", "USDG"), undefined while loading. */
  collateralSymbol?: string

  /** Deposited collateral available to trade (raw, 18-dec), or undefined while loading. */
  availableRaw?: bigint
  /** Human available balance, e.g. "12.5000". */
  availableFormatted?: string
  /** Collateral locked in open positions (raw, 18-dec). */
  lockedRaw?: bigint

  /** Wallet's collateral ERC-20 balance (raw, token-dec), or undefined while loading. */
  walletErc20Raw?: bigint
  /** Human wallet ERC-20 balance. */
  walletErc20Formatted?: string
  /** Wallet's native ETH balance (raw, wei). */
  nativeRaw?: bigint
  /** Human native ETH balance. */
  nativeFormatted?: string
  /** ERC-20 allowance the market may pull (raw, token-dec), or undefined while loading. */
  allowanceRaw?: bigint

  /** True when an ERC-20 deposit of `amountStr` needs an approve first (allowance < amount). */
  needsApproval: (amountStr: string) => boolean
  /** The max depositable for an asset as a decimal string ('' when unknown / zero). */
  maxDeposit: (asset: CollateralAsset) => string
  /** The max withdrawable (= available) as a decimal string. */
  maxWithdraw: () => string

  /** Approve the market to pull `amountStr` of the collateral ERC-20 (exact amount). */
  approve: (amountStr: string) => Promise<void>
  /** Deposit `amountStr` — native ETH (depositETH) or ERC-20 (deposit). */
  deposit: (amountStr: string, asset: CollateralAsset) => Promise<void>
  /** Withdraw `amountStr` (18-dec) of deposited collateral back to the wallet. */
  withdraw: (amountStr: string) => Promise<void>

  status: CollateralStatus
  /** The in-flight/last action's real tx hash — never fabricated. */
  txHash?: Hash
  /** Which action the current txHash belongs to. */
  lastAction?: 'approve' | 'deposit' | 'withdraw'
  error?: string
  reset: () => void
  /** Re-read all balances/allowance (e.g. after an external change). */
  refetchAll: () => void
}

function toMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'shortMessage' in e && typeof (e as { shortMessage: unknown }).shortMessage === 'string') {
    return (e as { shortMessage: string }).shortMessage
  }
  if (e instanceof Error) {
    return e.message.split('\n')[0]
  }
  return 'Transaction failed'
}

/** parseUnits that returns undefined instead of throwing on a malformed / empty string. */
function tryParse(amountStr: string, decimals: number): bigint | undefined {
  const s = (amountStr ?? '').trim()
  if (s === '') {
    return undefined
  }
  try {
    const v = parseUnits(s, decimals)
    return v > 0n ? v : undefined
  } catch {
    return undefined
  }
}

function fmt(raw: bigint | undefined, decimals: number): string | undefined {
  if (raw === undefined) {
    return undefined
  }
  return Number(formatUnits(raw, decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })
}

export function useCollateral({
  market,
  trader,
  chainId,
}: {
  market?: PerpMarketView
  trader?: Address
  chainId?: number
}): UseCollateral {
  const marketAddress = market?.address
  const collateral = market?.collateral
  const enabled = Boolean(marketAddress && trader)

  /* --------------------------------------------------------------- reads */

  // On-chain ledger — ALWAYS 18-dec standard units (PerpMarket.sol:84,1024).
  const balanceRead = useReadContract({
    address: marketAddress,
    chainId,
    abi: perpMarketReadAbi,
    functionName: 'getUserBalance',
    args: trader ? [trader] : undefined,
    query: { enabled, refetchInterval: 15_000 },
  })
  const balanceTuple = balanceRead.data as readonly [bigint, bigint] | undefined
  const availableRaw = balanceTuple ? balanceTuple[0] : undefined
  const lockedRaw = balanceTuple ? balanceTuple[1] : undefined

  // The market's wrapped-native (depositETH target).
  const wethRead = useReadContract({
    address: marketAddress,
    chainId,
    abi: perpMarketWriteAbi,
    functionName: 'weth',
    query: { enabled: Boolean(marketAddress) },
  })
  const weth = wethRead.data as Address | undefined
  const isWethCollateral =
    Boolean(weth && collateral && weth.toLowerCase() === collateral.toLowerCase())

  // Collateral token decimals — the TOKEN's native decimals (what deposit/approve/balanceOf use).
  const decimalsRead = useReadContract({
    address: collateral,
    chainId,
    abi: erc20Abi,
    functionName: 'decimals',
    query: { enabled: Boolean(collateral) },
  })
  const collateralDecimals = decimalsRead.data !== undefined ? Number(decimalsRead.data as number) : STANDARD_DECIMALS

  // Collateral token SYMBOL. The UI must name the token a market actually settles
  // in (WETH vs USDG vs …) rather than assuming WETH — collateral is fixed per
  // market at createMarket() time, so it varies across markets on the same chain.
  const symbolRead = useReadContract({
    address: collateral,
    chainId,
    abi: ERC20_SYMBOL_ABI,
    functionName: 'symbol',
    query: { enabled: Boolean(collateral) },
  })
  const collateralSymbol = symbolRead.data !== undefined ? String(symbolRead.data) : undefined

  // Wallet's collateral ERC-20 balance (token-dec).
  const walletErc20Read = useReadContract({
    address: collateral,
    chainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: trader ? [trader] : undefined,
    query: { enabled: Boolean(collateral && trader), refetchInterval: 15_000 },
  })
  const walletErc20Raw = walletErc20Read.data as bigint | undefined

  // Wallet's native ETH balance (wei) — only meaningful when the ETH deposit path is available.
  const nativeRead = useBalance({
    address: trader,
    chainId,
    query: { enabled: Boolean(trader && isWethCollateral), refetchInterval: 15_000 },
  })
  const nativeRaw = nativeRead.data?.value

  // ERC-20 allowance the market may pull (token-dec).
  const allowanceRead = useReadContract({
    address: collateral,
    chainId,
    abi: erc20Abi,
    functionName: 'allowance',
    args: trader && marketAddress ? [trader, marketAddress] : undefined,
    query: { enabled: Boolean(collateral && trader && marketAddress) },
  })
  const allowanceRaw = allowanceRead.data as bigint | undefined

  /* --------------------------------------------------------------- writes */

  const { writeContractAsync } = useWriteContract()
  const [txHash, setTxHash] = useState<Hash | undefined>(undefined)
  const [lastAction, setLastAction] = useState<'approve' | 'deposit' | 'withdraw' | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const receipt = useWaitForTransactionReceipt({ hash: txHash, chainId })

  const refetchAll = useCallback(() => {
    void balanceRead.refetch()
    void walletErc20Read.refetch()
    void allowanceRead.refetch()
    void nativeRead.refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On a mined receipt: refresh chain state. An approve is a means-to-an-end — clear it so the
  // deposit starts fresh with the new allowance; deposit/withdraw stay as 'done' for feedback.
  useEffect(() => {
    if (!receipt.isSuccess) {
      return
    }
    refetchAll()
    if (lastAction === 'approve') {
      setTxHash(undefined)
      setLastAction(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess])

  const reset = useCallback(() => {
    setTxHash(undefined)
    setLastAction(undefined)
    setPending(false)
    setError(undefined)
  }, [])

  const runWrite = useCallback(
    async (action: 'approve' | 'deposit' | 'withdraw', send: () => Promise<Hash>): Promise<void> => {
      setError(undefined)
      setTxHash(undefined)
      setLastAction(action)
      setPending(true)
      try {
        const hash = await send()
        setTxHash(hash)
      } catch (e) {
        setError(toMessage(e))
      } finally {
        setPending(false)
      }
    },
    [],
  )

  const approve = useCallback(
    async (amountStr: string): Promise<void> => {
      if (!collateral || !marketAddress) {
        return
      }
      const amount = tryParse(amountStr, collateralDecimals)
      if (amount === undefined) {
        setError('Enter an amount')
        setLastAction('approve')
        return
      }
      await runWrite('approve', () =>
        writeContractAsync({
          address: collateral,
          chainId,
          abi: erc20Abi,
          functionName: 'approve',
          args: [marketAddress, amount],
        }),
      )
    },
    [collateral, marketAddress, collateralDecimals, chainId, runWrite, writeContractAsync],
  )

  const deposit = useCallback(
    async (amountStr: string, asset: CollateralAsset): Promise<void> => {
      if (!marketAddress) {
        return
      }
      if (asset === 'native') {
        // depositETH() — value in wei (ETH = 18 dec).
        const value = tryParse(amountStr, STANDARD_DECIMALS)
        if (value === undefined) {
          setError('Enter an amount')
          setLastAction('deposit')
          return
        }
        await runWrite('deposit', () =>
          writeContractAsync({
            address: marketAddress,
            chainId,
            abi: perpMarketWriteAbi,
            functionName: 'depositETH',
            args: [],
            value,
          }),
        )
        return
      }
      // ERC-20 deposit(token, amount) — amount in the token's native decimals.
      if (!collateral) {
        return
      }
      const amount = tryParse(amountStr, collateralDecimals)
      if (amount === undefined) {
        setError('Enter an amount')
        setLastAction('deposit')
        return
      }
      await runWrite('deposit', () =>
        writeContractAsync({
          address: marketAddress,
          chainId,
          abi: perpMarketWriteAbi,
          functionName: 'deposit',
          args: [collateral, amount],
        }),
      )
    },
    [marketAddress, collateral, collateralDecimals, chainId, runWrite, writeContractAsync],
  )

  const withdraw = useCallback(
    async (amountStr: string): Promise<void> => {
      if (!marketAddress || !collateral) {
        return
      }
      // withdraw(token, amount) — amount in STANDARD 18-dec units (matches the ledger).
      const amount = tryParse(amountStr, STANDARD_DECIMALS)
      if (amount === undefined) {
        setError('Enter an amount')
        setLastAction('withdraw')
        return
      }
      if (availableRaw !== undefined && amount > availableRaw) {
        setError('Amount exceeds available balance')
        setLastAction('withdraw')
        return
      }
      await runWrite('withdraw', () =>
        writeContractAsync({
          address: marketAddress,
          chainId,
          abi: perpMarketWriteAbi,
          functionName: 'withdraw',
          args: [collateral, amount],
        }),
      )
    },
    [marketAddress, collateral, chainId, availableRaw, runWrite, writeContractAsync],
  )

  const needsApproval = useCallback(
    (amountStr: string): boolean => {
      const amount = tryParse(amountStr, collateralDecimals)
      if (amount === undefined) {
        return false
      }
      // Unknown allowance → require approval to be safe (never assume it's sufficient).
      return allowanceRaw === undefined ? true : allowanceRaw < amount
    },
    [collateralDecimals, allowanceRaw],
  )

  const maxDeposit = useCallback(
    (asset: CollateralAsset): string => {
      if (asset === 'native') {
        return nativeRaw !== undefined && nativeRaw > 0n ? formatUnits(nativeRaw, STANDARD_DECIMALS) : ''
      }
      return walletErc20Raw !== undefined && walletErc20Raw > 0n ? formatUnits(walletErc20Raw, collateralDecimals) : ''
    },
    [nativeRaw, walletErc20Raw, collateralDecimals],
  )

  const maxWithdraw = useCallback(
    (): string => (availableRaw !== undefined && availableRaw > 0n ? formatUnits(availableRaw, STANDARD_DECIMALS) : ''),
    [availableRaw],
  )

  const status: CollateralStatus = useMemo(() => {
    if (error) {
      return 'error'
    }
    if (pending) {
      return lastAction === 'approve' ? 'approving' : lastAction === 'withdraw' ? 'withdrawing' : 'depositing'
    }
    if (txHash) {
      if (receipt.isSuccess) {
        return 'done'
      }
      return 'confirming'
    }
    return 'idle'
  }, [error, pending, lastAction, txHash, receipt.isSuccess])

  return {
    ready: enabled,
    isWethCollateral,
    weth,
    collateralDecimals,
    collateralSymbol,
    availableRaw,
    availableFormatted: fmt(availableRaw, STANDARD_DECIMALS),
    lockedRaw,
    walletErc20Raw,
    walletErc20Formatted: fmt(walletErc20Raw, collateralDecimals),
    nativeRaw,
    nativeFormatted: fmt(nativeRaw, STANDARD_DECIMALS),
    allowanceRaw,
    needsApproval,
    maxDeposit,
    maxWithdraw,
    approve,
    deposit,
    withdraw,
    status,
    txHash,
    lastAction,
    error,
    reset,
    refetchAll,
  }
}
