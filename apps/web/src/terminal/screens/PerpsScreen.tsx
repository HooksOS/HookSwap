/**
 * HookSwapPerps — "Pro Desk" perpetuals terminal (Option A, pixel-perfect to the
 * approved design proposal).
 *
 * Layout — a 4-column desk with a full-bleed market stat bar above it:
 *   [ Markets watchlist | chart + OHLC | OrderBook / Trades stack | Order Ticket ]
 * and a Positions panel spanning the full width beneath.
 *
 * DATA WIRING (no mock data — handoff hard rule):
 *   Every live surface binds to the HookSwapPerps matching engine + chain:
 *     • market directory  → useMarkets (engine GET /markets, on-chain registry fallback)
 *     • stat bar          → useTicker (engine GET /ticker — mark + index from the market's
 *                           on-chain Chainlink refFeed; 24h change / volume / open interest)
 *     • chart             → useCandles (engine GET /candles — OHLC from the mark series + trades)
 *     • order book        → useOrderbook (poll + WS)
 *     • trades / mark      → useTrades (poll + WS; last price is the mark fallback)
 *     • positions         → usePositions (on-chain PairedPositions for the wallet)
 *     • order ticket      → usePlaceOrder (EIP-712 sign → POST /orders)
 *   When the engine is unreachable, or a wallet isn't connected / is on the wrong chain,
 *   the panels render honest loading / empty / offline / connect / switch states — nothing
 *   is fabricated. The engine base URL is the single `PERPS_ENGINE_URL` constant in
 *   ./perps/engine/client.ts (env `PERPS_ENGINE_URL`).
 *
 * HONEST NULLS: mark + index bind to the Chainlink refFeed when the market has one, else
 * mark falls back to last-trade / book-mid and index shows '—'. 24h change is '—' until the
 * engine has enough mark history; 24h volume is '—' until the market trades; funding is '—'
 * until computed. Candles accrue as the mark samples + trades land. Nothing is guessed.
 */
import { ReactNode, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { useAccount } from '~/hooks/useAccount'
import { useSelectChain } from '~/hooks/useSelectChain'
import { useIsMobileViewport } from '~/terminal/hooks/useIsMobileViewport'
import type { Address } from '~/chains'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { MarketStatBar } from '~/terminal/screens/perps/MarketStatBar'
import { OpenOrdersTable } from '~/terminal/screens/perps/OpenOrdersTable'
import { OrderBook } from '~/terminal/screens/perps/OrderBook'
import { OrderTicket } from '~/terminal/screens/perps/OrderTicket'
import { PerpsChart } from '~/terminal/screens/perps/PerpsChart'
import { PerpsWatchlist } from '~/terminal/screens/perps/PerpsWatchlist'
import { PositionsTable } from '~/terminal/screens/perps/PositionsTable'
import { PerpsTutorial, PERPS_TUTORIAL_STEPS } from '~/terminal/screens/perps/PerpsTutorial'
import { TradesFeed } from '~/terminal/screens/perps/TradesFeed'
import { PERPS_FACTORY_ADDRESSES, PERPS_FACTORY_HOME_CHAIN } from '~/terminal/perps/factory/abis'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { isTestnetChain } from 'uniswap/src/features/chains/utils'
import { useMarketNames } from '~/terminal/perps/factory/useMarketNames'
import type { PerpMarketView } from '~/terminal/perps/engine/marketView'
import { useCandles } from '~/terminal/perps/engine/useCandles'
import { useClosePosition } from '~/terminal/perps/engine/useClosePosition'
import { useMarkets } from '~/terminal/perps/engine/useMarkets'
import { useOpenOrders } from '~/terminal/perps/engine/useOpenOrders'
import { useOrderbook } from '~/terminal/perps/engine/useOrderbook'
import { usePositions } from '~/terminal/perps/engine/usePositions'
import { useTicker } from '~/terminal/perps/engine/useTicker'
import { useTrades } from '~/terminal/perps/engine/useTrades'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

/**
 * Which chain's perps directory to show. HookSwapPerps factories are deployed on Sepolia
 * (11155111, the canonical test chain) AND Robinhood (4663, mainnet pilot). Default the
 * DATA to a MAINNET (Robinhood) so the live desk never surfaces the Sepolia test markets;
 * only show Sepolia's markets when the wallet is actually connected to Sepolia (the testing
 * path). Generic: any deployed chain the wallet is on wins; otherwise fall back to the first
 * deployed MAINNET (never a testnet). See visibleChains.ts for the same data-gate idea.
 */
function resolvePerpsDirectoryChain(connectedChainId: UniverseChainId | undefined): UniverseChainId {
  // Wallet is on a chain that has perps deployed → show that chain (incl. the Sepolia test path).
  if (connectedChainId !== undefined && PERPS_FACTORY_ADDRESSES[connectedChainId]) {
    return connectedChainId
  }
  // Otherwise default to the primary mainnet perps chain — never the Sepolia test markets.
  if (PERPS_FACTORY_ADDRESSES[UniverseChainId.Robinhood]) {
    return UniverseChainId.Robinhood
  }
  const firstMainnet = (Object.keys(PERPS_FACTORY_ADDRESSES).map(Number) as UniverseChainId[]).find(
    (id) => !isTestnetChain(id),
  )
  return firstMainnet ?? PERPS_FACTORY_HOME_CHAIN
}

export function PerpsScreen(): JSX.Element {
  const account = useAccount()
  const accountDrawer = useAccountDrawer()
  const selectChain = useSelectChain()
  const navigate = useNavigate()
  const isMobile = useIsMobileViewport()

  const connected = Boolean(account.address)
  const trader = account.address as Address | undefined
  // Directory chain: the connected mainnet (default Robinhood); Sepolia only when connected to it.
  const PERPS_CHAIN = resolvePerpsDirectoryChain(account.chainId)
  const wrongChain = connected && account.chainId !== PERPS_CHAIN

  // Interactive first-visit walkthrough. `tutorialOpen` is bumped to force-open it
  // from the "Tutorial" button; it also auto-starts once (localStorage-gated).
  const [tutorialOpen, setTutorialOpen] = useState(0)

  const marketsQuery = useMarkets({ chainId: PERPS_CHAIN })
  const rawMarkets = marketsQuery.markets

  // Derive a human name for each market from its on-chain Chainlink refFeed ("ETH / USD" →
  // "ETH-PERP"). marketId is a one-way keccak hash so the creator's label is unrecoverable —
  // this reads real on-chain identity instead. Markets whose feed doesn't resolve keep their
  // honest short-address fallback ("MKT 0x…").
  const nameInputs = useMemo(
    () => rawMarkets?.map((m) => ({ market: m.address, collateral: m.collateral })),
    [rawMarkets],
  )
  const { names: marketNames } = useMarketNames({ markets: nameInputs, chainId: PERPS_CHAIN })

  // Enrich the market rows: replace ONLY the address fallback ("MKT 0x…") with the derived
  // name (never clobber a real engine/catalog symbol). Downstream (chart title, ticket) then
  // shows the readable name too.
  const markets = useMemo<PerpMarketView[] | undefined>(() => {
    if (!rawMarkets) {
      return rawMarkets
    }
    return rawMarkets.map((m) => {
      const resolved = marketNames.get(m.address.toLowerCase())
      if (resolved && m.label.startsWith('MKT ')) {
        return { ...m, label: resolved.name, base: resolved.base }
      }
      return m
    })
  }, [rawMarkets, marketNames])

  // Selected market — kept stable while the address still exists. The registry lists
  // markets in creation order, which is dominated by permissionless test markets; a
  // curated + ACTIVE market is the sensible landing default (falls back to first active,
  // then first of any). Never fabricates — purely a display-default preference.
  const [selectedAddr, setSelectedAddr] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!markets || markets.length === 0) {
      return
    }
    if (!selectedAddr || !markets.some((m) => m.address.toLowerCase() === selectedAddr.toLowerCase())) {
      const curatedActive = markets.find((m) => m.tier === 0 && m.status === 0)
      const active = markets.find((m) => m.status === 0)
      setSelectedAddr((curatedActive ?? active ?? markets[0]).address)
    }
  }, [markets, selectedAddr])

  const selected: PerpMarketView | undefined = useMemo(
    () => markets?.find((m) => m.address.toLowerCase() === selectedAddr?.toLowerCase()),
    [markets, selectedAddr],
  )

  const orderbook = useOrderbook({ market: selected?.address })
  const trades = useTrades({ market: selected?.address })
  const ticker = useTicker({ market: selected?.address })
  const candles = useCandles({ market: selected?.address, interval: '1m' })
  const positions = usePositions({
    market: selected?.address,
    collateral: selected?.collateral,
    trader,
    chainId: PERPS_CHAIN,
  })

  // Close flow — on-chain `closePair(pairId)`; refetch positions on a mined receipt.
  const closePosition = useClosePosition({
    market: selected,
    trader,
    chainId: PERPS_CHAIN,
    refetch: positions.refetch,
  })

  // Open (resting) orders — engine REST; cancel via DELETE /orders/:orderId (self-refetches).
  const openOrders = useOpenOrders({
    market: selected?.address,
    trader,
    chainId: PERPS_CHAIN,
  })

  // Mark: prefer the engine ticker (Chainlink refFeed), fall back to last trade / book mid.
  const markPrice = ticker.mark ?? trades.lastPrice ?? orderbook.mid
  const spread = orderbook.asks.length && orderbook.bids.length ? orderbook.asks[0].price - orderbook.bids[0].price : undefined

  const noMarkets = markets !== undefined && markets.length === 0
  const marketsLoading = markets === undefined && marketsQuery.isLoading

  return (
    <div>
      {/* Full-bleed market stat bar — binds to the engine ticker (honest '—' on null). */}
      <MarketStatBar
        market={selected}
        mark={markPrice}
        indexPrice={ticker.indexPrice}
        change24hPct={ticker.change24hPct}
        volume24h={ticker.volume24h}
        openInterest={ticker.openInterest}
        fundingRatePct={ticker.fundingRatePct}
        maxLeverageX={selected?.catalogMaxLeverage}
      />

      <div style={{ padding: '14px var(--tm-gutter) 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
          {/* Engine status — honest offline/fallback indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontFamily: terminalFonts.mono, fontSize: 10.5, color: terminalColors.ink3 }}>
              {marketsQuery.engineUnreachable ? (
                <span style={{ color: terminalColors.warn }}>
                  ● Matching engine offline{marketsQuery.source === 'chain' ? ' — showing on-chain markets' : ''}
                </span>
              ) : marketsQuery.source === 'engine' ? (
                <span style={{ color: terminalColors.greenDeep }}>● Engine connected</span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setTutorialOpen((n) => n + 1)}
              title="Replay the desk walkthrough"
              style={{
                fontFamily: terminalFonts.mono,
                fontSize: 10.5,
                color: terminalColors.ink3,
                background: 'transparent',
                border: `1px solid ${terminalColors.line}`,
                borderRadius: 7,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
            >
              ? Tutorial
            </button>
          </div>
          <button
            type="button"
            onClick={() => navigate('/perps/launch')}
            style={{
              fontFamily: terminalFonts.mono,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              color: terminalColors.greenDeep,
              background: terminalColors.greenBg,
              border: `1px solid ${terminalColors.greenBorder}`,
              borderRadius: 8,
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            Launch a market →
          </button>
        </div>

        {noMarkets ? (
          <NoMarkets onLaunch={() => navigate('/perps/launch')} />
        ) : (
          <div
            style={{
              display: 'grid',
              // Mobile: stack every desk panel into one column (no forced 4-col grid on a
              // phone). The `gridColumn: 1 / -1` spans below collapse to full width naturally.
              gridTemplateColumns: isMobile ? '1fr' : '210px minmax(0, 1fr) 240px 300px',
              gap: 12,
              alignItems: 'start',
            }}
          >
            {/* 1 — Markets watchlist */}
            <div data-tut="watchlist">
              <InstrumentPanel title="Markets" flush>
                {marketsLoading ? (
                  <PanelNote>Loading markets…</PanelNote>
                ) : marketsQuery.error ? (
                  <PanelNote>Markets unavailable</PanelNote>
                ) : markets ? (
                  <PerpsWatchlist markets={markets} names={marketNames} selected={selected?.address} onSelect={(m) => setSelectedAddr(m.address)} />
                ) : (
                  <PanelNote>Loading markets…</PanelNote>
                )}
              </InstrumentPanel>
            </div>

            {/* 2 — Chart + OHLC */}
            <div data-tut="chart">
              <InstrumentPanel
                title={`${selected?.label ?? 'Perp'} · 1M`}
                live={candles.status === 'live' || orderbook.status === 'live' || trades.status === 'live'}
                corners
                meta={[ticker.indexPrice !== undefined ? 'Mark · Chainlink' : selected ? `Mark · ${selected.source === 'engine' ? 'engine' : 'chain'}` : '—']}
                bodyStyle={{ padding: 10 }}
              >
                <PerpsChart candles={candles.candles} height={360} />
              </InstrumentPanel>
            </div>

            {/* 3 — Order Book + Trades stacked */}
            <div data-tut="orderbook" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <InstrumentPanel title="Order Book" flush>
                <OrderBook bids={orderbook.bids} asks={orderbook.asks} status={orderbook.status} spread={spread} />
              </InstrumentPanel>
              <InstrumentPanel title="Trades" flush>
                <TradesFeed trades={trades.trades} status={trades.status} />
              </InstrumentPanel>
            </div>

            {/* 4 — Order Ticket */}
            <div data-tut="ticket">
              <InstrumentPanel title="Order Ticket" meta={['Isolated']} flush>
                <OrderTicket
                  market={selected}
                  trader={trader}
                  chainId={PERPS_CHAIN}
                  connected={connected}
                  wrongChain={wrongChain}
                  markPrice={markPrice}
                  onConnect={() => accountDrawer.open()}
                  onSwitchChain={() => void selectChain(PERPS_CHAIN)}
                />
              </InstrumentPanel>
            </div>

            {/* Bottom — Positions (spans all columns) */}
            <div data-tut="positions" style={{ gridColumn: '1 / -1' }}>
              <InstrumentPanel title="Positions" flush>
                <PositionsTable
                  positions={positions.positions}
                  connected={connected}
                  loading={positions.isLoading}
                  onClose={(p) => void closePosition.close(p.pairId)}
                  pendingPairId={closePosition.pendingPairId}
                  closeDisabled={!closePosition.ready}
                />
                {/* Close status — real tx result / error, never fabricated. */}
                {closePosition.status !== 'idle' || closePosition.error ? (
                  <div
                    style={{
                      padding: '8px 14px',
                      borderTop: `1px solid ${terminalColors.line3}`,
                      fontFamily: terminalFonts.mono,
                      fontSize: 10.5,
                      textAlign: 'right',
                      color: closePosition.error
                        ? terminalColors.redDown
                        : closePosition.status === 'done'
                          ? terminalColors.greenDeep
                          : terminalColors.ink3,
                    }}
                  >
                    {closePosition.error
                      ? closePosition.error
                      : closePosition.status === 'closing'
                        ? 'Confirm in wallet…'
                        : closePosition.status === 'confirming'
                          ? `Closing position${closePosition.txHash ? ` · ${closePosition.txHash.slice(0, 10)}…` : ''}`
                          : closePosition.status === 'done'
                            ? `Position closed${closePosition.txHash ? ` · ${closePosition.txHash.slice(0, 10)}…` : ''}`
                            : null}
                  </div>
                ) : null}
              </InstrumentPanel>
            </div>

            {/* Bottom — Open Orders (engine resting orders, spans all columns) */}
            <div style={{ gridColumn: '1 / -1' }}>
              <InstrumentPanel
                title="Open Orders"
                flush
                meta={openOrders.error ? ['engine offline'] : undefined}
              >
                <OpenOrdersTable
                  orders={openOrders.orders}
                  connected={connected}
                  wrongChain={wrongChain}
                  loading={openOrders.isLoading}
                  onCancel={(o) => void openOrders.cancel(o.orderId)}
                  pendingOrderId={openOrders.pendingOrderId}
                  cancelDisabled={!openOrders.ready}
                />
                {/* Cancel status — real engine result / error, never fabricated. */}
                {openOrders.cancelStatus !== 'idle' || openOrders.cancelError ? (
                  <div
                    style={{
                      padding: '8px 14px',
                      borderTop: `1px solid ${terminalColors.line3}`,
                      fontFamily: terminalFonts.mono,
                      fontSize: 10.5,
                      textAlign: 'right',
                      color: openOrders.cancelError
                        ? terminalColors.redDown
                        : openOrders.cancelStatus === 'done'
                          ? terminalColors.greenDeep
                          : terminalColors.ink3,
                    }}
                  >
                    {openOrders.cancelError
                      ? openOrders.cancelError
                      : openOrders.cancelStatus === 'canceling'
                        ? 'Canceling order…'
                        : openOrders.cancelStatus === 'done'
                          ? 'Order cancelled'
                          : null}
                  </div>
                ) : null}
              </InstrumentPanel>
            </div>
          </div>
        )}

        <div style={{ fontFamily: terminalFonts.sans, fontSize: 11, color: terminalColors.faint, marginTop: 14, lineHeight: 1.5 }}>
          HookSwapPerps · P2P settlement · isolated margin · funding 1h. Order book, mark price, and positions bind to the
          matching-engine feed + on-chain state — no mock data.
        </div>
      </div>

      {/* Interactive first-visit walkthrough (localStorage-gated; replayable via the Tutorial button). */}
      <PerpsTutorial
        steps={PERPS_TUTORIAL_STEPS}
        storageKey="hookswap.perps.tutorial.seen.v1"
        ready={!noMarkets && !!markets && markets.length > 0}
        openSignal={tutorialOpen}
      />
    </div>
  )
}

function PanelNote({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div style={{ padding: 16, textAlign: 'center', fontFamily: terminalFonts.mono, fontSize: 10.5, color: terminalColors.faint }}>
      {children}
    </div>
  )
}

function NoMarkets({ onLaunch }: { onLaunch: () => void }): JSX.Element {
  return (
    <div
      style={{
        border: `1px solid ${terminalColors.line}`,
        borderRadius: 12,
        background: terminalColors.bg,
        padding: '48px 24px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: terminalFonts.display, fontSize: 20, fontWeight: 600, color: terminalColors.ink, marginBottom: 8 }}>
        No markets yet
      </div>
      <div style={{ fontFamily: terminalFonts.sans, fontSize: 13, color: terminalColors.ink3, marginBottom: 18 }}>
        The HookSwapPerps registry has no live markets. Launch the first one to start trading.
      </div>
      <button
        type="button"
        onClick={onLaunch}
        style={{
          fontFamily: terminalFonts.mono,
          fontSize: 12,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: terminalColors.btnInk,
          background: terminalColors.brandGreen,
          border: 'none',
          borderRadius: 9,
          padding: '10px 20px',
          cursor: 'pointer',
        }}
      >
        Launch a market →
      </button>
    </div>
  )
}
