/**
 * HookSwap Terminal — LaunchPad Create surface (mounted at `/launch/create`).
 *
 * A multi-engine launch console: the user picks one of four @hookos/sdk-powered launch mechanics
 * from {@link LaunchEnginePicker}, and the selected engine panel renders below it. The Explore /
 * directory half (market-cap hero + launches ledger) lives at `/launch` via LaunchpadExplore.
 *
 * ENGINES (availability resolved LIVE from the SDK per chain — see `launchpad/engines.ts`):
 *   • bondingCurve — TokenFactory bonding-curve mint that graduates to a real DEX pool.
 *   • fairV3       — the original HookOSV3Launcher fair launch (LP locked in the FeeVault). DEFAULT.
 *   • quickLaunch  — RHLaunchpad direct-to-v4 memecoin fast path (Robinhood only).
 *   • stockReward  — StockRewardLauncherV4 taxed launch → tokenized-stock rewards (Robinhood only).
 *
 * The default engine is `fairV3`, so the original launch flow is unchanged on first load; the other
 * engines are additive. DATA POLICY (no mock data) is enforced inside each engine hook/panel.
 */
import { useState } from 'react'
import { Link } from 'react-router'
import { UniverseChainId } from 'uniswap/src/features/chains/types'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { useAccount } from '~/hooks/useAccount'
import { Eyebrow } from '~/terminal/components/InstrumentPanel'
import { DEFAULT_ENGINE_ID, getEngine, type LaunchEngineId } from '~/terminal/launchpad/engines'
import { LaunchEnginePicker } from '~/terminal/launchpad/LaunchEnginePicker'
import { BondingCurveEngine } from '~/terminal/launchpad/engines/BondingCurveEngine'
import { FairLaunchV3Engine } from '~/terminal/launchpad/engines/FairLaunchV3Engine'
import { QuickLaunchEngine } from '~/terminal/launchpad/engines/QuickLaunchEngine'
import { StockRewardEngine } from '~/terminal/launchpad/engines/StockRewardEngine'
import { DISPLAY, EngineIntro, MONO, SANS } from '~/terminal/launchpad/primitives'
import { terminalColors } from '~/terminal/theme/tokens'
import { assume0xAddress } from '~/utils/wagmi'

export function LaunchCreateScreen(): JSX.Element {
  const account = useAccount()
  const accountDrawer = useAccountDrawer()

  const chainId = account.chainId ?? UniverseChainId.Robinhood
  const connected = Boolean(account.address)
  const owner = assume0xAddress(account.address)

  const [engineId, setEngineId] = useState<LaunchEngineId>(DEFAULT_ENGINE_ID)
  const engine = getEngine(engineId)

  const onConnect = (): void => accountDrawer.open()
  const engineProps = { chainId, connected, owner, onConnect }

  return (
    <div style={{ padding: '20px var(--tm-gutter) 40px' }}>
      {/* Back to the LaunchPad Explore directory */}
      <Link
        to="/launch"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: terminalColors.ink3Alt,
          textDecoration: 'none',
          marginBottom: 14,
        }}
      >
        ← LaunchPad
      </Link>

      {/* Generic header — the selected engine's identity comes from the picker + EngineIntro */}
      <Eyebrow style={{ display: 'block', marginBottom: 8 }}>LaunchPad</Eyebrow>
      <h1
        style={{
          fontFamily: DISPLAY,
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: terminalColors.ink,
          margin: '0 0 6px',
        }}
      >
        Launch a token — any way you want
      </h1>
      <div style={{ fontFamily: SANS, fontSize: 13, color: terminalColors.ink2, marginBottom: 18, maxWidth: 640, lineHeight: 1.5 }}>
        Four launch engines, powered by the HookSwap SDK. Pick a mechanic; availability, fees, and targets are read live
        on-chain for your connected network.
      </div>

      {/* Engine picker */}
      <LaunchEnginePicker chainId={chainId} selected={engineId} onSelect={setEngineId} />

      {/* Selected engine identity + panel */}
      <EngineIntro pill={engine.pill} description={engine.description} />

      {engineId === 'fairV3' ? (
        <FairLaunchV3Engine {...engineProps} />
      ) : engineId === 'bondingCurve' ? (
        <BondingCurveEngine {...engineProps} />
      ) : engineId === 'quickLaunch' ? (
        <QuickLaunchEngine {...engineProps} />
      ) : (
        <StockRewardEngine {...engineProps} />
      )}
    </div>
  )
}
