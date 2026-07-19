/**
 * HookSwapPerps — "Pro Desk" perpetuals terminal (Option A, pixel-perfect to the
 * approved design proposal).
 *
 * Layout — a 4-column desk with a full-bleed market stat bar above it:
 *   [ Markets watchlist | chart + OHLC | OrderBook / Trades stack | Order Ticket ]
 * and a Positions panel spanning the full width beneath.
 *
 * DATA POLICY (no mock data — handoff hard rule):
 *   The HookSwapPerps matching-engine backend is NOT deployed yet. Every live
 *   surface — price, 24h change, mark/index, funding, OI, volume, candles, order
 *   book, trades, positions, and the order-ticket receipt — renders an HONEST
 *   empty / loading / '—' state ("No price history yet", "Order book unavailable",
 *   "No trades yet", "No open positions", "Connect wallet to trade"). Only the
 *   instrument *catalog* (pair label + max leverage + venue) is shown, which is
 *   static configuration, not fabricated market data. See ./perps/perpsCatalog.ts.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { useAccount } from '~/hooks/useAccount'
import { InstrumentPanel } from '~/terminal/components/InstrumentPanel'
import { MarketStatBar } from '~/terminal/screens/perps/MarketStatBar'
import { OrderBook } from '~/terminal/screens/perps/OrderBook'
import { OrderTicket } from '~/terminal/screens/perps/OrderTicket'
import { PerpsChart } from '~/terminal/screens/perps/PerpsChart'
import { PerpsWatchlist } from '~/terminal/screens/perps/PerpsWatchlist'
import { PositionsTable } from '~/terminal/screens/perps/PositionsTable'
import { TradesFeed } from '~/terminal/screens/perps/TradesFeed'
import { PERP_INSTRUMENTS, PerpInstrument } from '~/terminal/screens/perps/perpsCatalog'
import { terminalColors, terminalFonts } from '~/terminal/theme/tokens'

export function PerpsScreen(): JSX.Element {
  const account = useAccount()
  const accountDrawer = useAccountDrawer()
  const navigate = useNavigate()
  const connected = Boolean(account.address)

  const [instrument, setInstrument] = useState<PerpInstrument>(PERP_INSTRUMENTS[0])

  return (
    <div>
      {/* Full-bleed market stat bar */}
      <MarketStatBar instrument={instrument} />

      <div style={{ padding: '14px var(--tm-gutter) 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '210px minmax(0, 1fr) 240px 300px',
            gap: 12,
            alignItems: 'start',
          }}
        >
          {/* 1 — Markets watchlist */}
          <InstrumentPanel title="Markets" flush>
            <PerpsWatchlist selected={instrument.symbol} onSelect={setInstrument} />
          </InstrumentPanel>

          {/* 2 — Chart + OHLC */}
          <InstrumentPanel
            title={`${instrument.symbol} · 1H`}
            live
            corners
            meta={['TWAP · ' + instrument.venue]}
            bodyStyle={{ padding: 10 }}
          >
            <PerpsChart height={360} />
          </InstrumentPanel>

          {/* 3 — Order Book + Trades stacked */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <InstrumentPanel title="Order Book" flush>
              <OrderBook />
            </InstrumentPanel>
            <InstrumentPanel title="Trades" flush>
              <TradesFeed />
            </InstrumentPanel>
          </div>

          {/* 4 — Order Ticket */}
          <InstrumentPanel title="Order Ticket" meta={['Isolated']} flush>
            <OrderTicket instrument={instrument} connected={connected} onConnect={() => accountDrawer.open()} />
          </InstrumentPanel>

          {/* Bottom — Positions (spans all columns) */}
          <div style={{ gridColumn: '1 / -1' }}>
            <InstrumentPanel title="Positions" flush>
              <PositionsTable connected={connected} />
            </InstrumentPanel>
          </div>
        </div>

        <div style={{ fontFamily: terminalFonts.sans, fontSize: 11, color: terminalColors.faint, marginTop: 14, lineHeight: 1.5 }}>
          HookSwapPerps · P2P settlement · up to 100× · funding 1h. Live orderbook, mark price, and positions bind to the
          matching-engine feed once deployed — no mock data.
        </div>
      </div>
    </div>
  )
}
