/**
 * HookSwap Terminal — Farms.
 *
 * A spacious, three-part Farms page in the DAYSIGNAL light / Ledger aesthetic:
 *   • "Explore"        — the cross-chain farms analytics (FarmsExplore): total-staked
 *                        hero + TVL/count chart, stat tiles, status donut + APR
 *                        histogram, and the sortable per-farm Ledger. All indexer-bound.
 *   • "Create farm"    — a de-crammed, stepped wizard (CreateFarmWizard) wrapping
 *                        `StakingRewardsFactory.createAndFund(stakingToken, rewardToken,
 *                        rewardAmount, duration)`: it deploys a funded `StakingRewards`
 *                        child that streams the reward token to stakers over the window.
 *   • "Stake & manage" — pick (or paste) a farm and stake / claim / unstake (FarmsManage).
 *
 * DATA POLICY (facts-only, no fabricated data):
 *   • The factory address is config-driven (`~/terminal/farms/addresses.ts`). On a chain
 *     with no deployed factory the Create / Manage tabs render an honest "Farms aren't
 *     live on {chain} yet" COMING-SOON state — never an error, never mock data. The
 *     Explore tab is cross-chain (indexer) and always available.
 *   • Every token symbol/decimals, farm balance, reward rate, period end and the farm
 *     registry are REAL on-chain reads. They read "—" until they resolve.
 *   • `createAndFund` PULLS the reward budget via `transferFrom`, and `stake` pulls the
 *     staking token the same way — both are GATED behind a live ERC-20 allowance: the
 *     button stays "Approve" until the approval is CONFIRMED on-chain.
 *   • Protocol fees are owner-configurable and DEFAULT 0 (see
 *     `contracts/farms/src/StakingRewardsFactory.sol`: flat native `createFee` + `protocolFeeBps`
 *     cut, cap 5%). The create wizard READS them live and shows the exact fee before you sign;
 *     the native `createFee` is sent as `msg.value`. On a factory predating the fee feature the
 *     reads error and are honestly treated as "None".
 *   • APR is NEVER fabricated (no USD anchor → reward rate + amounts in token terms only).
 */
import { useState } from 'react'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { useEnabledChains } from 'uniswap/src/features/chains/hooks/useEnabledChains'
import { useAccountDrawer } from '~/components/AccountDrawer/MiniPortfolio/hooks'
import { useAccount } from '~/hooks/useAccount'
import { Eyebrow } from '~/terminal/components/InstrumentPanel'
import { terminalColors, terminalFonts, terminalShadows } from '~/terminal/theme/tokens'
import { getFarmFactory } from '~/terminal/farms/addresses'
import { useFarm, useFarmList } from '~/terminal/farms/useFarm'
import { CreateFarmWizard } from '~/terminal/screens/farms/CreateFarmWizard'
import { FarmsExplore } from '~/terminal/screens/farms/FarmsExplore'
import { FarmsManage } from '~/terminal/screens/farms/FarmsManage'
import { assume0xAddress } from '~/utils/wagmi'
import '~/terminal/theme/terminal.css'

const MONO = terminalFonts.mono
const DISPLAY = terminalFonts.display
const SANS = terminalFonts.sans

type FarmsTab = 'explore' | 'create' | 'manage'

const TABS: { id: FarmsTab; label: string }[] = [
  { id: 'explore', label: 'Explore' },
  { id: 'create', label: 'Create farm' },
  { id: 'manage', label: 'Stake & manage' },
]

export function FarmsScreen(): JSX.Element {
  const account = useAccount()
  const accountDrawer = useAccountDrawer()
  const [tab, setTab] = useState<FarmsTab>('explore')

  const connected = Boolean(account.address)
  const owner = assume0xAddress(account.address)

  // Deployment status + wallet-independent reads reflect the DISPLAYED chain (mirrors VestingScreen).
  const { defaultChainId, chains } = useEnabledChains()
  const chainId = (account.chainId ?? defaultChainId ?? chains[0]) as typeof account.chainId
  const chainLabel = chainId ? getChainLabel(chainId) : '—'

  const factory = getFarmFactory(chainId)
  const deployed = Boolean(factory)

  // Farm registry (real read) — drives the header "total farms" chip.
  const list = useFarmList({ chainId })
  const totalFarms = list.farms?.length

  // The Manage tab's selected farm lives here so it survives tab switches.
  const [selectedFarm, setSelectedFarm] = useState('')
  const [stakeAmount, setStakeAmount] = useState('')
  const [unstakeAmount, setUnstakeAmount] = useState('')
  const farm = useFarm({ chainId, owner, farm: selectedFarm, stakeAmount, unstakeAmount })

  const onConnect = (): void => accountDrawer.open()

  return (
    <div style={{ padding: '20px var(--tm-gutter) 40px' }}>
      {/* Header */}
      <Eyebrow style={{ display: 'block', marginBottom: 8 }}>YIELD FARMS</Eyebrow>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <h1
          style={{
            fontFamily: DISPLAY,
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: terminalColors.ink,
            margin: 0,
          }}
        >
          Farms
        </h1>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: terminalColors.ink3Alt }}>
          {deployed ? (totalFarms !== undefined ? `${totalFarms} on ${chainLabel}` : `— on ${chainLabel}`) : `not deployed on ${chainLabel}`}
        </span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13.5, color: terminalColors.ink2, marginBottom: 20, maxWidth: 620, lineHeight: 1.55 }}>
        Launch a self-service staking farm — deposit a reward budget and stakers earn it over time — or stake into an
        existing farm and claim rewards. Any ERC-20 (including a v2 LP token) works as the staking token; the create flow
        shows any live protocol fee before you sign.
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          background: terminalColors.panel2,
          padding: 4,
          borderRadius: 11,
          width: 'fit-content',
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        {TABS.map(({ id, label }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              style={{
                padding: '7px 18px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontFamily: SANS,
                fontSize: 13,
                fontWeight: 600,
                color: active ? terminalColors.ink : terminalColors.ink2,
                background: active ? terminalColors.bg : 'transparent',
                boxShadow: active ? terminalShadows.segmentedActive : undefined,
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {tab === 'explore' ? (
        <FarmsExplore />
      ) : tab === 'create' ? (
        <CreateFarmWizard
          deployed={deployed}
          chainLabel={chainLabel}
          chainId={chainId}
          owner={owner}
          connected={connected}
          onConnect={onConnect}
        />
      ) : (
        <FarmsManage
          deployed={deployed}
          connected={connected}
          chainLabel={chainLabel}
          chainId={chainId}
          owner={owner}
          onConnect={onConnect}
          selectedFarm={selectedFarm}
          setSelectedFarm={setSelectedFarm}
          farm={farm}
          stakeAmount={stakeAmount}
          setStakeAmount={setStakeAmount}
          unstakeAmount={unstakeAmount}
          setUnstakeAmount={setUnstakeAmount}
        />
      )}
    </div>
  )
}
