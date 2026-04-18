/**
 * Community tab — trader profile grid + detail view.
 *
 * Default: grid of trader cards (one per opted-in user) with
 * at-a-glance metrics. Sortable (Most Active / Win Rate / Avg R /
 * Profit Factor / Recent Activity). Searchable. Your own card is
 * highlighted with a blue border + "You" badge.
 *
 * Click a card → drill into that trader's full 12-stat grid + trade
 * history table.
 *
 * Privacy: $ amounts are never shown. Server strips shares +
 * pnlDollar from every community payload.
 */

import { useMemo, useState } from 'react'
import useJ2CommunityTraders from '../hooks/useJ2CommunityTraders'
import useJ2CommunityTrades from '../hooks/useJ2CommunityTrades'
import useJ2CommunityPositions from '../hooks/useJ2CommunityPositions'
import TraderCard from '../components/TraderCard'
import TraderDetail from '../components/TraderDetail'
import styles from './CommunityTab.module.css'

const SORT_OPTIONS = [
  { key: 'tradeCount', label: 'Most Active' },
  { key: 'winRate', label: 'Win Rate' },
  { key: 'avgR', label: 'Avg R' },
  { key: 'profitFactor', label: 'Profit Factor' },
  { key: 'recent', label: 'Recent Activity' },
]

function sortTraders(list, key) {
  const val = {
    tradeCount: (t) => t.tradeCount,
    winRate: (t) => t.winRate ?? -1,
    avgR: (t) => t.avgRMultiple ?? -Infinity,
    // null PF encodes ∞; treat it as highest when sorting PF desc
    profitFactor: (t) =>
      t.profitFactor == null && t.wins > 0 ? Infinity : t.profitFactor ?? -1,
    recent: (t) => (t.lastTradeDate ? new Date(t.lastTradeDate).getTime() : 0),
  }[key] || ((t) => t.tradeCount)
  return [...list].sort((a, b) => val(b) - val(a))
}

export default function CommunityTab() {
  const { traders, isLoading: tradersLoading, error: tradersError } = useJ2CommunityTraders()
  const { trades, isLoading: tradesLoading } = useJ2CommunityTrades()
  const { positions } = useJ2CommunityPositions()

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState('tradeCount')
  const [selectedTraderId, setSelectedTraderId] = useState(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const arr = q
      ? traders.filter((t) => (t.trader || '').toLowerCase().includes(q))
      : traders
    return sortTraders(arr, sortKey)
  }, [traders, query, sortKey])

  const selectedTrader = useMemo(
    () => traders.find((t) => t.traderId === selectedTraderId) || null,
    [traders, selectedTraderId],
  )

  const selectedTraderTrades = useMemo(() => {
    if (!selectedTraderId) return []
    return trades.filter((t) => t.traderId === selectedTraderId)
  }, [trades, selectedTraderId])

  const selectedTraderPositions = useMemo(() => {
    if (!selectedTraderId) return []
    return positions.filter((p) => p.traderId === selectedTraderId)
  }, [positions, selectedTraderId])

  if (tradersError) {
    return (
      <div className={styles.errorBanner} role="alert">
        Failed to load community traders: {String(tradersError.message || tradersError)}
      </div>
    )
  }

  // Detail view — drilled into a trader
  if (selectedTrader) {
    return (
      <TraderDetail
        trader={selectedTrader}
        trades={selectedTraderTrades}
        openPositions={selectedTraderPositions}
        onBack={() => setSelectedTraderId(null)}
      />
    )
  }

  // Grid view — list of trader cards
  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        <h3 className={styles.introTitle}>Community Traders</h3>
        <p className={styles.introBody}>
          Browse traders who have opted in via Portfolio Settings. Click any
          card to see their full trading history and analytics. Dollar amounts
          and share counts are never shared — only scale-independent metrics.
        </p>
      </div>

      <div className={styles.toolbar}>
        <input
          type="text"
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search traders…"
          aria-label="Search traders by name"
        />
        <div className={styles.sortGroup}>
          <span className={styles.sortLabel}>Sort</span>
          <div className={styles.sortPills} role="radiogroup" aria-label="Sort traders">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`${styles.sortPill} ${sortKey === opt.key ? styles.sortPillActive : ''}`}
                onClick={() => setSortKey(opt.key)}
                aria-pressed={sortKey === opt.key}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tradersLoading && traders.length === 0 ? (
        <div className={styles.loading}>Loading community traders…</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          {traders.length === 0 ? (
            <>
              <p>No traders have shared yet.</p>
              <p className={styles.emptyHint}>
                Be the first — turn on <strong>Community Sharing</strong> in
                Portfolio Settings. Once your first trade closes, your card
                will appear here.
              </p>
            </>
          ) : (
            <p>No traders match your search.</p>
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map((t) => (
            <TraderCard
              key={t.traderId}
              trader={t}
              onClick={() => setSelectedTraderId(t.traderId)}
            />
          ))}
        </div>
      )}

      {tradesLoading && trades.length === 0 && (
        <p className={styles.hint}>Loading trade history in background…</p>
      )}
    </div>
  )
}
