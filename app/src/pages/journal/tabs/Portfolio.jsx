// app/src/pages/journal/tabs/Portfolio.jsx
import { useState, useMemo, useCallback } from 'react'
import useSWR from 'swr'
import useLivePrices from '../../../hooks/useLivePrices'
import styles from './Portfolio.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const SORT_OPTIONS = [
  { key: 'unrealized_pnl', label: 'P&L' },
  { key: 'sym', label: 'Symbol' },
  { key: 'days_held', label: 'Days Held' },
  { key: 'risk', label: 'Risk' },
  { key: 'journal', label: 'Journal' },
]

const FILTER_DIRECTION = [
  { key: '', label: 'All' },
  { key: 'long', label: 'Long' },
  { key: 'short', label: 'Short' },
]

const FILTER_JOURNAL = [
  { key: '', label: 'All' },
  { key: 'complete', label: 'Complete' },
  { key: 'partial', label: 'Partial' },
  { key: 'missing', label: 'Missing' },
]

function journalStatus(jc) {
  if (!jc) return 'missing'
  if (jc.completeness_pct >= 80) return 'complete'
  if (jc.completeness_pct >= 40) return 'partial'
  return 'missing'
}

function journalStatusLabel(status) {
  if (status === 'complete') return 'Complete'
  if (status === 'partial') return 'Partial'
  return 'Missing'
}

function fmtDollar(v) {
  if (v == null) return '--'
  const sign = v >= 0 ? '+' : ''
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtPct(v) {
  if (v == null) return '--'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function fmtPrice(v) {
  if (v == null) return '--'
  return `$${Number(v).toFixed(2)}`
}

function colorCls(v, gain, loss, neutral) {
  if (v == null) return neutral || ''
  if (v > 0) return gain
  if (v < 0) return loss
  return neutral || ''
}

export default function Portfolio({ onOpenTrade, stats }) {
  const [sortBy, setSortBy] = useState('unrealized_pnl')
  const [sortDir, setSortDir] = useState('desc')
  const [filterDir, setFilterDir] = useState('')
  const [filterAccount, setFilterAccount] = useState('')
  const [filterSetup, setFilterSetup] = useState('')
  const [filterJournal, setFilterJournal] = useState('')
  const [groupBy, setGroupBy] = useState('')

  const { data, error, isLoading } = useSWR('/api/journal/portfolio', fetcher, {
    refreshInterval: 30000,
    dedupingInterval: 15000,
    revalidateOnFocus: false,
  })

  const positions = data?.positions || []
  const summary = data?.summary || {}
  const exposure = data?.exposure || {}

  // Live prices for all open position tickers
  const tickers = useMemo(() => positions.map(p => p.sym).filter(Boolean), [positions])
  const { prices } = useLivePrices(tickers)

  // Enrich positions with live data
  const enriched = useMemo(() => {
    return positions.map(pos => {
      const live = prices[pos.sym]
      const livePrice = live?.price ?? null
      const dayChange = live?.change_pct ?? null
      const entryPrice = pos.entry_price ? Number(pos.entry_price) : null
      const stopPrice = pos.stop_price ? Number(pos.stop_price) : null
      const shares = pos.shares ? Number(pos.shares) : null
      const isShort = (pos.direction || 'long').toLowerCase() === 'short'
      const dirMult = isShort ? -1 : 1

      let unrealizedPct = null
      let unrealizedDollar = null
      let marketValue = null
      let stopDistPct = null
      let riskRemaining = null

      if (livePrice && entryPrice && entryPrice > 0) {
        unrealizedPct = ((livePrice - entryPrice) / entryPrice * 100) * dirMult
        if (shares) {
          unrealizedDollar = (livePrice - entryPrice) * shares * dirMult
          marketValue = livePrice * Math.abs(shares)
        }
      }

      if (livePrice && stopPrice && livePrice > 0) {
        stopDistPct = ((livePrice - stopPrice) / livePrice * 100) * dirMult
        if (shares) {
          riskRemaining = Math.abs(livePrice - stopPrice) * Math.abs(shares)
        }
      }

      const jStatus = journalStatus(pos.journal_completeness)

      return {
        ...pos,
        livePrice,
        dayChange,
        unrealizedPct,
        unrealizedDollar,
        marketValue,
        stopDistPct,
        riskRemaining,
        jStatus,
        direction: (pos.direction || 'long').toLowerCase(),
      }
    })
  }, [positions, prices])

  // Filter
  const filtered = useMemo(() => {
    let result = enriched
    if (filterDir) result = result.filter(p => p.direction === filterDir)
    if (filterAccount) result = result.filter(p => (p.account || 'default') === filterAccount)
    if (filterSetup) result = result.filter(p => p.setup === filterSetup)
    if (filterJournal) result = result.filter(p => p.jStatus === filterJournal)
    return result
  }, [enriched, filterDir, filterAccount, filterSetup, filterJournal])

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered]
    const dir = sortDir === 'desc' ? -1 : 1
    arr.sort((a, b) => {
      let av, bv
      switch (sortBy) {
        case 'unrealized_pnl':
          av = a.unrealizedDollar ?? (a.unrealizedPct ?? -999999)
          bv = b.unrealizedDollar ?? (b.unrealizedPct ?? -999999)
          break
        case 'sym':
          av = (a.sym || '').toLowerCase()
          bv = (b.sym || '').toLowerCase()
          return dir * av.localeCompare(bv)
        case 'days_held':
          av = a.days_held ?? -1
          bv = b.days_held ?? -1
          break
        case 'risk':
          av = a.riskRemaining ?? 999999
          bv = b.riskRemaining ?? 999999
          break
        case 'journal':
          av = a.journal_completeness?.completeness_pct ?? 0
          bv = b.journal_completeness?.completeness_pct ?? 0
          break
        default:
          av = 0; bv = 0
      }
      return dir * (av - bv)
    })
    return arr
  }, [filtered, sortBy, sortDir])

  // Group
  const grouped = useMemo(() => {
    if (!groupBy) return null
    const groups = {}
    sorted.forEach(p => {
      let key
      if (groupBy === 'direction') key = p.direction
      else if (groupBy === 'account') key = p.account || 'default'
      else if (groupBy === 'setup') key = p.setup || 'Untagged'
      else key = 'all'
      if (!groups[key]) groups[key] = []
      groups[key].push(p)
    })
    return groups
  }, [sorted, groupBy])

  // Aggregated live totals
  const totals = useMemo(() => {
    let totalUnrealized = 0
    let totalMarketValue = 0
    let totalRisk = 0
    let bestPos = null
    let worstPos = null
    let missingJournal = 0

    enriched.forEach(p => {
      if (p.unrealizedDollar != null) totalUnrealized += p.unrealizedDollar
      if (p.marketValue != null) totalMarketValue += p.marketValue
      if (p.riskRemaining != null) totalRisk += p.riskRemaining
      if (p.jStatus !== 'complete') missingJournal++

      if (p.unrealizedPct != null) {
        if (!bestPos || p.unrealizedPct > (bestPos.unrealizedPct ?? -Infinity)) bestPos = p
        if (!worstPos || p.unrealizedPct < (worstPos.unrealizedPct ?? Infinity)) worstPos = p
      }
    })

    const longCount = enriched.filter(p => p.direction === 'long').length
    const shortCount = enriched.filter(p => p.direction === 'short').length
    const longPct = enriched.length > 0 ? (longCount / enriched.length * 100) : 0
    const shortPct = enriched.length > 0 ? (shortCount / enriched.length * 100) : 0

    // Total unrealized as pct of total entry cost
    let totalEntryCost = 0
    enriched.forEach(p => {
      const ep = p.entry_price ? Number(p.entry_price) : 0
      const sh = p.shares ? Math.abs(Number(p.shares)) : 0
      totalEntryCost += ep * sh
    })
    const totalUnrealizedPct = totalEntryCost > 0 ? (totalUnrealized / totalEntryCost * 100) : null

    return {
      totalUnrealized,
      totalUnrealizedPct,
      totalMarketValue,
      totalRisk,
      bestPos,
      worstPos,
      longCount,
      shortCount,
      longPct,
      shortPct,
      missingJournal,
    }
  }, [enriched])

  const handleSort = useCallback((key) => {
    if (sortBy === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
  }, [sortBy])

  // Risk panel computations
  const riskData = useMemo(() => {
    // Concentration — top 3 by market value
    const withMv = enriched.filter(p => p.marketValue != null && p.marketValue > 0)
    const totalMv = withMv.reduce((s, p) => s + p.marketValue, 0)
    const concentration = [...withMv]
      .sort((a, b) => b.marketValue - a.marketValue)
      .slice(0, 3)
      .map(p => ({
        sym: p.sym,
        pct: totalMv > 0 ? (p.marketValue / totalMv * 100) : 0,
      }))

    // Positions with stop < 2% away
    const nearStop = enriched.filter(p => {
      if (p.stopDistPct == null) return false
      return Math.abs(p.stopDistPct) < 2
    })

    // Positions missing stop
    const missingStop = enriched.filter(p => p.stop_price == null)

    return { concentration, nearStop, missingStop, totalMv }
  }, [enriched])

  // Journal discipline
  const discipline = useMemo(() => {
    const complete = enriched.filter(p => p.jStatus === 'complete')
    const missingThesis = enriched.filter(p => !p.journal_completeness?.has_thesis)
    const missingScreenshots = enriched.filter(p => !p.journal_completeness?.has_screenshots)
    const needingReview = enriched.filter(p =>
      p.journal_completeness?.review_status === 'draft' || p.journal_completeness?.review_status === 'logged'
    )
    return { complete, missingThesis, missingScreenshots, needingReview }
  }, [enriched])

  // Loading
  if (isLoading && !data) {
    return (
      <div className={styles.wrap}>
        <div className={styles.loading}>
          <div className={styles.loadingBar} />
          <span>Loading portfolio...</span>
        </div>
      </div>
    )
  }

  // Error
  if (error) {
    return (
      <div className={styles.wrap}>
        <div className={styles.error}>
          <span className={styles.errorIcon}>!</span>
          Failed to load portfolio. Check your connection.
        </div>
      </div>
    )
  }

  // Empty
  if (enriched.length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>&#x25CB;</div>
          <div className={styles.emptyTitle}>No open positions</div>
          <div className={styles.emptyText}>Log a new trade to start tracking your portfolio.</div>
        </div>
      </div>
    )
  }

  function renderPositionCard(pos) {
    const isLong = pos.direction === 'long'
    const jDotCls = pos.jStatus === 'complete' ? styles.jDotGreen
      : pos.jStatus === 'partial' ? styles.jDotAmber
      : styles.jDotRed

    return (
      <div
        key={pos.id}
        className={`${styles.posCard} ${isLong ? styles.posCardLong : styles.posCardShort}`}
        onClick={() => onOpenTrade(pos.id)}
      >
        {/* Journal status dot */}
        <div className={`${styles.jDot} ${jDotCls}`} title={`Journal: ${journalStatusLabel(pos.jStatus)}`} />

        <div className={styles.posGrid}>
          {/* Left: symbol + direction */}
          <div className={styles.posLeft}>
            <span className={styles.posSym}>{pos.sym}</span>
            <span className={isLong ? styles.dirBadgeLong : styles.dirBadgeShort}>
              {isLong ? 'LONG' : 'SHORT'}
            </span>
            {pos.setup && <span className={styles.posSetup}>{pos.setup}</span>}
          </div>

          {/* Center: prices */}
          <div className={styles.posCenter}>
            <div className={styles.priceRow}>
              <span className={styles.priceLabel}>Entry</span>
              <span className={styles.priceVal}>{fmtPrice(pos.entry_price)}</span>
              <span className={styles.priceArrow}>&rarr;</span>
              <span className={styles.priceLabel}>Now</span>
              <span className={`${styles.priceVal} ${colorCls(pos.unrealizedPct, styles.valGain, styles.valLoss, '')}`}>
                {pos.livePrice ? fmtPrice(pos.livePrice) : '--'}
              </span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaItem}>
                <span className={styles.metaLabel}>Shares</span>
                <span className={styles.metaVal}>{pos.shares ?? '--'}</span>
              </span>
              <span className={styles.metaItem}>
                <span className={styles.metaLabel}>Mkt Val</span>
                <span className={styles.metaVal}>{pos.marketValue != null ? `$${Math.round(pos.marketValue).toLocaleString()}` : '--'}</span>
              </span>
              <span className={styles.metaItem}>
                <span className={styles.metaLabel}>Days</span>
                <span className={styles.metaVal}>{pos.days_held ?? '--'}</span>
              </span>
            </div>
          </div>

          {/* Right: P&L */}
          <div className={styles.posRight}>
            <div className={`${styles.pnlDollar} ${colorCls(pos.unrealizedDollar, styles.valGain, styles.valLoss, '')}`}>
              {fmtDollar(pos.unrealizedDollar)}
            </div>
            <div className={`${styles.pnlPct} ${colorCls(pos.unrealizedPct, styles.valGain, styles.valLoss, '')}`}>
              {fmtPct(pos.unrealizedPct)}
            </div>
            {pos.dayChange != null && (
              <div className={`${styles.dayChange} ${colorCls(pos.dayChange, styles.valGain, styles.valLoss, '')}`}>
                Day: {pos.dayChange >= 0 ? '+' : ''}{pos.dayChange.toFixed(2)}%
              </div>
            )}
          </div>
        </div>

        {/* Bottom meta: stop distance + risk */}
        <div className={styles.posBottom}>
          <span className={styles.bottomItem}>
            <span className={styles.bottomLabel}>Stop Dist</span>
            <span className={`${styles.bottomVal} ${
              pos.stopDistPct != null
                ? (Math.abs(pos.stopDistPct) < 2 ? styles.valLoss : Math.abs(pos.stopDistPct) < 5 ? styles.valWarn : styles.valGain)
                : ''
            }`}>
              {pos.stopDistPct != null ? `${pos.stopDistPct.toFixed(1)}%` : 'No stop'}
            </span>
          </span>
          <span className={styles.bottomItem}>
            <span className={styles.bottomLabel}>Risk $</span>
            <span className={styles.bottomVal}>
              {pos.riskRemaining != null ? `$${Math.round(pos.riskRemaining).toLocaleString()}` : '--'}
            </span>
          </span>
          <span className={styles.bottomItem}>
            <span className={styles.bottomLabel}>Stop</span>
            <span className={`${styles.bottomVal} ${styles.valLoss}`}>
              {fmtPrice(pos.stop_price)}
            </span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* ══ Portfolio Header ══ */}
      <div className={styles.header}>
        <div className={styles.heroSection}>
          <div className={styles.heroLabel}>Total Unrealized P&amp;L</div>
          <div className={`${styles.heroValue} ${colorCls(totals.totalUnrealized, styles.valGain, styles.valLoss, '')}`}>
            {fmtDollar(totals.totalUnrealized)}
          </div>
          {totals.totalUnrealizedPct != null && (
            <div className={`${styles.heroPct} ${colorCls(totals.totalUnrealizedPct, styles.valGain, styles.valLoss, '')}`}>
              {fmtPct(totals.totalUnrealizedPct)}
            </div>
          )}
        </div>

        <div className={styles.headerStats}>
          <div className={styles.headerStat}>
            <span className={styles.statLabel}>Open Positions</span>
            <span className={styles.statVal}>{enriched.length}</span>
          </div>

          <div className={styles.headerStat}>
            <span className={styles.statLabel}>Exposure</span>
            <div className={styles.exposureBarWrap}>
              <div className={styles.exposureBar}>
                <div className={styles.exposureLong} style={{ width: `${totals.longPct}%` }} />
                <div className={styles.exposureShort} style={{ width: `${totals.shortPct}%` }} />
              </div>
              <span className={styles.exposureText}>
                {totals.longCount}L / {totals.shortCount}S
              </span>
            </div>
          </div>

          <div className={styles.headerStat}>
            <span className={styles.statLabel}>Capital at Risk</span>
            <span className={styles.statVal}>
              {totals.totalRisk > 0 ? `$${Math.round(totals.totalRisk).toLocaleString()}` : '--'}
            </span>
          </div>

          <div className={styles.headerStat}>
            <span className={styles.statLabel}>Needs Journal</span>
            <span className={`${styles.statVal} ${totals.missingJournal > 0 ? styles.statValWarn : ''}`}>
              {totals.missingJournal}
            </span>
          </div>

          <div className={styles.headerStat}>
            <span className={styles.statLabel}>Best Position</span>
            <span className={`${styles.statVal} ${styles.valGain}`}>
              {totals.bestPos ? `${totals.bestPos.sym} ${fmtPct(totals.bestPos.unrealizedPct)}` : '--'}
            </span>
          </div>

          <div className={styles.headerStat}>
            <span className={styles.statLabel}>Worst Position</span>
            <span className={`${styles.statVal} ${styles.valLoss}`}>
              {totals.worstPos ? `${totals.worstPos.sym} ${fmtPct(totals.worstPos.unrealizedPct)}` : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* ══ Controls: Sort + Filter + Group ══ */}
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Sort</span>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              className={`${styles.controlBtn} ${sortBy === opt.key ? styles.controlBtnActive : ''}`}
              onClick={() => handleSort(opt.key)}
            >
              {opt.label}
              {sortBy === opt.key && (
                <span className={styles.sortArrow}>{sortDir === 'desc' ? '\u25BE' : '\u25B4'}</span>
              )}
            </button>
          ))}
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Direction</span>
          {FILTER_DIRECTION.map(opt => (
            <button
              key={opt.key}
              className={`${styles.controlBtn} ${filterDir === opt.key ? styles.controlBtnActive : ''}`}
              onClick={() => setFilterDir(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {summary.accounts && summary.accounts.length > 1 && (
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>Account</span>
            <button
              className={`${styles.controlBtn} ${filterAccount === '' ? styles.controlBtnActive : ''}`}
              onClick={() => setFilterAccount('')}
            >
              All
            </button>
            {summary.accounts.map(acc => (
              <button
                key={acc}
                className={`${styles.controlBtn} ${filterAccount === acc ? styles.controlBtnActive : ''}`}
                onClick={() => setFilterAccount(acc)}
              >
                {acc}
              </button>
            ))}
          </div>
        )}

        {summary.setups_in_use && summary.setups_in_use.length > 0 && (
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>Setup</span>
            <button
              className={`${styles.controlBtn} ${filterSetup === '' ? styles.controlBtnActive : ''}`}
              onClick={() => setFilterSetup('')}
            >
              All
            </button>
            {summary.setups_in_use.map(s => (
              <button
                key={s}
                className={`${styles.controlBtn} ${filterSetup === s ? styles.controlBtnActive : ''}`}
                onClick={() => setFilterSetup(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Journal</span>
          {FILTER_JOURNAL.map(opt => (
            <button
              key={opt.key}
              className={`${styles.controlBtn} ${filterJournal === opt.key ? styles.controlBtnActive : ''}`}
              onClick={() => setFilterJournal(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Group</span>
          {[
            { key: '', label: 'None' },
            { key: 'direction', label: 'Direction' },
            { key: 'account', label: 'Account' },
            { key: 'setup', label: 'Setup' },
          ].map(opt => (
            <button
              key={opt.key}
              className={`${styles.controlBtn} ${groupBy === opt.key ? styles.controlBtnActive : ''}`}
              onClick={() => setGroupBy(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══ Position Cards ══ */}
      <div className={styles.positionsList}>
        {filtered.length === 0 ? (
          <div className={styles.noResults}>No positions match your filters.</div>
        ) : grouped ? (
          Object.entries(grouped).map(([groupKey, groupPositions]) => (
            <div key={groupKey} className={styles.group}>
              <div className={styles.groupHeader}>
                <span className={styles.groupLabel}>{groupKey.toUpperCase()}</span>
                <span className={styles.groupCount}>{groupPositions.length}</span>
              </div>
              {groupPositions.map(renderPositionCard)}
            </div>
          ))
        ) : (
          sorted.map(renderPositionCard)
        )}
      </div>

      {/* ══ Risk & Exposure Panel ══ */}
      <div className={styles.riskPanel}>
        <div className={styles.sectionHeading}>Risk &amp; Exposure</div>

        {/* Exposure bar */}
        <div className={styles.riskRow}>
          <span className={styles.riskLabel}>Exposure by Direction</span>
          <div className={styles.exposureBarLarge}>
            <div className={styles.exposureLong} style={{ width: `${totals.longPct}%` }} />
            <div className={styles.exposureShort} style={{ width: `${totals.shortPct}%` }} />
            {totals.longPct === 0 && totals.shortPct === 0 && (
              <div className={styles.exposureCash} style={{ width: '100%' }} />
            )}
          </div>
          <div className={styles.exposureLegend}>
            <span className={styles.legendGreen}>{totals.longPct.toFixed(0)}% Long</span>
            <span className={styles.legendRed}>{totals.shortPct.toFixed(0)}% Short</span>
          </div>
        </div>

        {/* Top 3 concentration */}
        {riskData.concentration.length > 0 && (
          <div className={styles.riskRow}>
            <span className={styles.riskLabel}>Top Concentration</span>
            <div className={styles.riskList}>
              {riskData.concentration.map(c => (
                <div key={c.sym} className={styles.riskItem}>
                  <span className={styles.riskItemSym}>{c.sym}</span>
                  <span className={styles.riskItemVal}>{c.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Near stop warnings */}
        {riskData.nearStop.length > 0 && (
          <div className={styles.riskRow}>
            <span className={styles.riskLabel}>Stop &lt; 2% Away</span>
            <div className={styles.riskList}>
              {riskData.nearStop.map(p => (
                <div
                  key={p.id}
                  className={`${styles.riskItem} ${styles.riskItemWarn}`}
                  onClick={() => onOpenTrade(p.id)}
                >
                  <span className={styles.warnDot} />
                  <span className={styles.riskItemSym}>{p.sym}</span>
                  <span className={styles.riskItemVal}>{p.stopDistPct != null ? `${p.stopDistPct.toFixed(1)}%` : '--'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Missing stop warnings */}
        {riskData.missingStop.length > 0 && (
          <div className={styles.riskRow}>
            <span className={styles.riskLabel}>Missing Stop</span>
            <div className={styles.riskList}>
              {riskData.missingStop.map(p => (
                <div
                  key={p.id}
                  className={`${styles.riskItem} ${styles.riskItemDanger}`}
                  onClick={() => onOpenTrade(p.id)}
                >
                  <span className={styles.dangerDot} />
                  <span className={styles.riskItemSym}>{p.sym}</span>
                  <span className={styles.riskItemVal}>No stop set</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══ Journal Discipline ══ */}
      <div className={styles.disciplinePanel}>
        <div className={styles.sectionHeading}>Journal Discipline</div>

        <div className={styles.disciplineGrid}>
          <div className={`${styles.disciplineCard} ${styles.disciplineComplete}`}>
            <span className={styles.disciplineCount}>{discipline.complete.length}</span>
            <span className={styles.disciplineLabel}>Complete</span>
          </div>

          <div className={styles.disciplineCard}>
            <span className={`${styles.disciplineCount} ${discipline.missingThesis.length > 0 ? styles.valWarn : ''}`}>
              {discipline.missingThesis.length}
            </span>
            <span className={styles.disciplineLabel}>Missing Thesis</span>
          </div>

          <div className={styles.disciplineCard}>
            <span className={`${styles.disciplineCount} ${discipline.missingScreenshots.length > 0 ? styles.valWarn : ''}`}>
              {discipline.missingScreenshots.length}
            </span>
            <span className={styles.disciplineLabel}>Missing Screenshots</span>
          </div>

          <div className={styles.disciplineCard}>
            <span className={`${styles.disciplineCount} ${discipline.needingReview.length > 0 ? styles.valWarn : ''}`}>
              {discipline.needingReview.length}
            </span>
            <span className={styles.disciplineLabel}>Needs Review</span>
          </div>
        </div>

        {/* Clickable lists */}
        {discipline.missingThesis.length > 0 && (
          <div className={styles.disciplineList}>
            <span className={styles.disciplineListLabel}>Missing thesis:</span>
            {discipline.missingThesis.map(p => (
              <button key={p.id} className={styles.disciplineChip} onClick={() => onOpenTrade(p.id)}>
                {p.sym}
              </button>
            ))}
          </div>
        )}

        {discipline.missingScreenshots.length > 0 && (
          <div className={styles.disciplineList}>
            <span className={styles.disciplineListLabel}>Missing screenshots:</span>
            {discipline.missingScreenshots.map(p => (
              <button key={p.id} className={styles.disciplineChip} onClick={() => onOpenTrade(p.id)}>
                {p.sym}
              </button>
            ))}
          </div>
        )}

        {discipline.needingReview.length > 0 && (
          <div className={styles.disciplineList}>
            <span className={styles.disciplineListLabel}>Needs review:</span>
            {discipline.needingReview.map(p => (
              <button key={p.id} className={styles.disciplineChip} onClick={() => onOpenTrade(p.id)}>
                {p.sym}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
