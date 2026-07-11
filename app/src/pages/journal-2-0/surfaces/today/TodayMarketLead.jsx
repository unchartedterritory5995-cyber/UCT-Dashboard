/**
 * Today — market-hours lead (live positions + day P&L).
 *
 * For a BROKER-synced account this is the flagship: the Robinhood-style
 * BrokerAccountHero (live net-liq + equity curve + day P&L), assembled from the
 * same recipe OpenPositionsTab uses (useRealtimePrices over the position
 * symbols → portfolioAggregates + brokerLiveSummary + optionMarketValue). For a
 * MANUAL account the hero can't render (it self-returns null), so we fall back
 * to TodayNoSync (day P&L + positions list + quick-entry).
 *
 * Props:
 *   account    the selected account object (concrete, non-null here)
 *   settings   from the Outlet context (accountSize feeds the aggregates)
 *   overview   coach overview payload (manual fallback day P&L)
 *   onLogTrade / onLogPosition  add-flow openers (manual fallback)
 */
import { useMemo } from 'react'
import useJ2Positions from '../../hooks/useJ2Positions'
import useJ2OptionStrategies from '../../hooks/useJ2OptionStrategies'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import useRealtimePrices from '../../../../hooks/useRealtimePrices'
import BrokerAccountHero from '../../components/BrokerAccountHero'
import SyncFreshnessChip from '../../components/SyncFreshnessChip'
import {
  portfolioAggregates,
  brokerLiveSummary,
  currentPriceFor,
} from '../../../../lib/journal-2-0'
import TodayNoSync from './TodayNoSync'

export default function TodayMarketLead({
  account, settings, overview, onLogTrade, onLogPosition,
}) {
  const { positions } = useJ2Positions()
  const { strategies: optionStrategies } = useJ2OptionStrategies({ status: 'open' })
  const { accounts } = useJ2SelectedAccount()

  const symbols = useMemo(() => positions.map((p) => p.symbol), [positions])
  const { prices, isStreaming } = useRealtimePrices(symbols)

  const accountSize = settings?.accountSize ?? 0
  const isBroker = account?.balanceSource === 'broker'

  // Current price per position: live tick if present, else the broker's last
  // synced mark — mirrors OpenPositionsTab so after-hours numbers stay real.
  const priceMap = useMemo(() => {
    const m = {}
    for (const p of positions) m[p.symbol] = currentPriceFor(p, prices)
    return m
  }, [positions, prices])

  const aggregates = useMemo(
    () => portfolioAggregates(positions, priceMap, accountSize),
    [positions, priceMap, accountSize],
  )

  const brokerAccountCount = useMemo(
    () => accounts.filter((a) => a?.balanceSource === 'broker' && a?.brokerTotalEquity != null).length,
    [accounts],
  )
  const etToday = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    [],
  )
  const liveSummary = useMemo(
    () => (brokerAccountCount <= 1
      ? brokerLiveSummary(account, positions, optionStrategies, prices, etToday)
      : null),
    [brokerAccountCount, account, positions, optionStrategies, prices, etToday],
  )
  const optionMarketValue = useMemo(
    () => (optionStrategies || []).reduce(
      (s, o) => s + (Number.isFinite(o?.brokerCurrentValue) ? o.brokerCurrentValue : 0), 0,
    ),
    [optionStrategies],
  )

  if (isBroker) {
    // Broker lead: same freshness chip the Trades surface uses (Today had no
    // freshness readout before — this unifies it, no duplicate line).
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <SyncFreshnessChip />
        </div>
        <BrokerAccountHero
          account={account}
          aggregates={aggregates}
          liveSummary={liveSummary}
          isLive={isStreaming && liveSummary?.netLiq != null}
          positions={positions}
          prices={prices}
          optionMarketValue={optionMarketValue}
        />
      </>
    )
  }

  // Manual account — no broker net-liq to draw. Honest day-P&L fallback.
  return (
    <TodayNoSync
      overview={overview}
      positions={positions}
      prices={prices}
      onLogTrade={onLogTrade}
      onLogPosition={onLogPosition}
    />
  )
}
