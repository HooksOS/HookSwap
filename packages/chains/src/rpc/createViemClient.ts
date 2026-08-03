import { SessionGateSource, type Session } from '@universe/sessions'
import { logger } from 'utilities/src/logger/logger'
import { createPublicClient, defineChain, fallback, http, PublicClient, Transport, walletActions } from 'viem'
import { createUniRpcTransportFactory } from './createUniRpcTransport'
import { SignerInfo } from './FlashbotsCommon'
import { createFlashbotsRpcClient } from './FlashbotsRpcClient'
import { createObservableTransport } from './observability/createObservableTransport'
import { getRpcObserver } from './observability/rpcObserver'
import type { RpcConfigResolver } from './resolveRpcConfig'
import { createSessionGatedTransport } from './session/createSessionGatedTransport'
import { RPCType, UniverseChainId } from './types'
import type { ViemChainInfo } from './types'

export interface CreateViemClientFactoryCtx {
  resolveRpcConfig: RpcConfigResolver
  getChainInfo: (chainId: UniverseChainId) => ViemChainInfo
  areAddressesEqual: (a: string, b: string) => boolean
  /**
   * Optional per-request session gate. When the getter returns a Session,
   * UniRPC traffic awaits ready and retries once on 401. When it returns null
   * (flag off, session not bootstrapped, non-UniRPC traffic), passes through.
   */
  getSessionGate?: () => Session | null
}

interface CreateViemClientInput {
  chainId: UniverseChainId
  rpcType: RPCType
  signerInfo?: SignerInfo
}

export type CreateViemClient = (input: CreateViemClientInput) => PublicClient | undefined

export function createViemClientFactory(ctx: CreateViemClientFactoryCtx): CreateViemClient {
  return (input: CreateViemClientInput): PublicClient | undefined => {
    try {
      const rpcConfig = ctx.resolveRpcConfig({ chainId: input.chainId, rpcType: input.rpcType })
      if (!rpcConfig) {
        return undefined
      }

      const chainInfo = ctx.getChainInfo(input.chainId)
      const viemChain = defineChain({
        id: chainInfo.id,
        name: chainInfo.name,
        nativeCurrency: chainInfo.nativeCurrency,
        rpcUrls: chainInfo.rpcUrls,
      })

      if (rpcConfig.shouldUseFlashbots && rpcConfig.flashbotsConfig) {
        return createFlashbotsRpcClient({
          chain: viemChain,
          refundPercent: rpcConfig.flashbotsConfig.refundPercent,
          calldataHintsEnabled: rpcConfig.flashbotsConfig.calldataHintsEnabled,
          signerInfo: input.signerInfo,
          areAddressesEqual: ctx.areAddressesEqual,
          observer: getRpcObserver(),
        })
      }

      // Route UniRPC-bound configs through createUniRpcTransportFactory so
      // session handling, the 6s timeout, and the id:0 defense-in-depth patch
      // are applied consistently. Branch on the explicit `isUniRpc` flag —
      // earlier versions sniffed for header presence, which was an implicit
      // contract that any legacy provider with static headers could break.
      let baseTransport: Transport
      // Set when `baseTransport` already emits observer events per inner endpoint
      // (the fallback path wraps each URL individually so telemetry attributes the
      // failure to the endpoint that actually failed); skips the outer wrapper so
      // requests are not double-counted.
      let isObservable = false
      if (rpcConfig.isUniRpc) {
        const uniRpcTransportConfig = { rpcUrl: rpcConfig.rpcUrl, headers: rpcConfig.headers ?? {} }
        const { getRequestHeaders } = rpcConfig
        const uniRpcTransport = getRequestHeaders
          ? createUniRpcTransportFactory({
              session: { type: 'headers', getSessionHeaders: getRequestHeaders },
            })({ config: uniRpcTransportConfig })
          : createUniRpcTransportFactory({
              // Cookie-based session auth (web). The transport unconditionally
              // sets credentials: 'include' for the cookies branch.
              session: { type: 'cookies' },
            })({ config: uniRpcTransportConfig })

        // Session gating wraps only the UniRPC path — legacy/Flashbots are
        // independent of the entry-gateway session. The wrapper is a no-op
        // when `getSessionGate` returns null (session not bootstrapped).
        baseTransport = ctx.getSessionGate
          ? createSessionGatedTransport({
              baseTransportFactory: uniRpcTransport,
              getSession: ctx.getSessionGate,
              source: SessionGateSource.UnirpcViem,
            })
          : uniRpcTransport
      } else {
        const fetchOptions = rpcConfig.headers ? { headers: rpcConfig.headers } : undefined
        const urls = [rpcConfig.rpcUrl, ...(rpcConfig.fallbackRpcUrls ?? [])]
        if (urls.length > 1) {
          // Public reads get real client-side failover across the chain's ordered
          // public endpoints — a dead or rate-limited primary must not take the chain
          // down. viem's `fallback` builds each inner transport with retryCount 0 and
          // advances on any error that isn't a user rejection / execution revert, so a
          // 429 moves straight to the next endpoint.
          baseTransport = fallback(
            urls.map((url) =>
              createObservableTransport({
                baseTransportFactory: http(url, { fetchOptions }),
                observer: getRpcObserver(),
                meta: { chainId: input.chainId, url },
              }),
            ),
          )
          isObservable = true
        } else {
          baseTransport = http(rpcConfig.rpcUrl, { fetchOptions })
        }
      }

      return createPublicClient({
        chain: viemChain,
        transport: isObservable
          ? baseTransport
          : createObservableTransport({
              baseTransportFactory: baseTransport,
              observer: getRpcObserver(),
              meta: { chainId: input.chainId, url: rpcConfig.rpcUrl },
            }),
      }).extend(walletActions)
    } catch (error) {
      logger.error(error, {
        tags: { file: 'createViemClient', function: 'createViemClient' },
        extra: { chainId: input.chainId, rpcType: input.rpcType },
      })
      return undefined
    }
  }
}
