/**
 * HookSwapPerps admin — Gnosis Safe Transaction-Builder batch generator.
 *
 * The panel never holds keys or sends owner txs (the owner of every perps contract is the
 * treasury Safe multisig). Instead every admin action is EMITTED as a Safe Transaction-Builder
 * batch JSON (the exact shape the Safe UI's "Transaction Builder" app imports): treasury owners
 * load the JSON, review each call, and collect signatures. This module encodes the calldata with
 * viem and assembles that JSON.
 *
 * Shape (matches the Stable-fee batch pattern already used for HookSwap governance):
 *   { version:"1.0", chainId:"<id>", meta:{ name, description, txBuilderVersion:"1.16.5" },
 *     transactions:[{ to, value:"0", data, contractMethod:{ inputs, name, payable },
 *                     contractInputsValues:{ <paramName>: <stringValue> } }] }
 */
import { encodeFunctionData } from 'viem'
import type { Abi, AbiFunction } from 'viem'

/** The Transaction-Builder version string the Safe UI stamps on exports. */
export const TX_BUILDER_VERSION = '1.16.5'

/** One decoded input in the Safe `contractMethod` block. */
export interface SafeMethodInput {
  name: string
  type: string
  internalType?: string
}

/** One transaction inside a Safe batch. */
export interface SafeBatchTransaction {
  to: string
  value: string
  data: string
  contractMethod: {
    inputs: SafeMethodInput[]
    name: string
    payable: boolean
  }
  contractInputsValues: Record<string, string>
}

/** A full Safe Transaction-Builder batch (importable JSON). */
export interface SafeBatch {
  version: '1.0'
  chainId: string
  createdAt?: number
  meta: {
    name: string
    description: string
    txBuilderVersion: string
  }
  transactions: SafeBatchTransaction[]
}

/**
 * A single owner-only action the panel can turn into one Safe transaction.
 * `abiFn` is the exact write-function fragment; `args` are the encoded call args (already
 * coerced to bigint/boolean/hex as the ABI needs); `displayValues` overrides how a value is
 * shown in `contractInputsValues` (defaults to a faithful stringify of `args`).
 */
export interface SafeActionSpec {
  /** Target contract address (a shared perps contract, or a specific market clone). */
  to: string
  /** The write-function ABI fragment (from the admin ABIs). */
  abiFn: AbiFunction
  /** Positional args matching `abiFn.inputs`. */
  args: readonly unknown[]
  /** Native value in wei; every perps owner write here is non-payable → "0". */
  value?: string
}

/** Faithful string form of an arg for `contractInputsValues` (Safe reads these as strings). */
function stringifyInput(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'bigint') {
    return value.toString(10)
  }
  return String(value)
}

/** Build one Safe transaction from an action spec (encodes calldata with viem). */
export function buildSafeTransaction(spec: SafeActionSpec): SafeBatchTransaction {
  const abi = [spec.abiFn] as unknown as Abi
  // viem's `encodeFunctionData` is heavily generic; we intentionally feed it a runtime-widened
  // `Abi` + string `functionName`, so assert the params to the broad param type.
  const data = encodeFunctionData({
    abi,
    functionName: spec.abiFn.name,
    args: spec.args as unknown[],
  } as Parameters<typeof encodeFunctionData>[0])

  const inputs: SafeMethodInput[] = spec.abiFn.inputs.map((inp) => ({
    name: inp.name ?? '',
    type: inp.type,
    // Safe's builder tolerates a missing internalType; mirror `type` when none is present.
    internalType: ('internalType' in inp && inp.internalType) || inp.type,
  }))

  const contractInputsValues: Record<string, string> = {}
  spec.abiFn.inputs.forEach((inp, i) => {
    contractInputsValues[inp.name ?? String(i)] = stringifyInput(spec.args[i])
  })

  return {
    to: spec.to,
    value: spec.value ?? '0',
    data,
    contractMethod: {
      inputs,
      name: spec.abiFn.name,
      payable: spec.abiFn.stateMutability === 'payable',
    },
    contractInputsValues,
  }
}

/** Assemble a full importable Safe batch from one or more action specs. */
export function buildSafeBatch({
  chainId,
  name,
  description,
  actions,
}: {
  chainId: number
  name: string
  description: string
  actions: SafeActionSpec[]
}): SafeBatch {
  return {
    version: '1.0',
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: {
      name,
      description,
      txBuilderVersion: TX_BUILDER_VERSION,
    },
    transactions: actions.map(buildSafeTransaction),
  }
}

/** Pretty-printed JSON for display + download. */
export function safeBatchToJson(batch: SafeBatch): string {
  return JSON.stringify(batch, null, 2)
}

/** Trigger a browser download of the batch JSON (client-only; no server round-trip). */
export function downloadSafeBatch(batch: SafeBatch, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }
  const blob = new Blob([safeBatchToJson(batch)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
