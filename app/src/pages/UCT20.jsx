// app/src/pages/UCT20.jsx
import { useState, useMemo, useCallback } from 'react'
import UIcon from '../components/ui/UIcon'
import useSWR, { useSWRConfig } from 'swr'
import PullToRefresh from '../components/PullToRefresh'
import Sheet from '../components/mobile/Sheet'
import TileCard from '../components/TileCard'
import TickerPopup from '../components/TickerPopup'
import UCT20Performance from '../components/tiles/UCT20Performance'
import UCT20Backtest from '../components/tiles/UCT20Backtest'
import { SkeletonTable } from '../components/Skeleton'
import useRealtimePrices from '../hooks/useRealtimePrices'
import useMobileSWR from '../hooks/useMobileSWR'
import ReadAloudButton from '../components/voice/ReadAloudButton'
import styles from './UCT20.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function fmtPct(v, digits = 1) {
  if (v == null) return null
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}
function fmtPrice(v) {
  if (v == null) return null
  return `$${v.toFixed(2)}`
}

// Earnings proximity — engine ships days_to_earnings only for a CONFIRMED
// upcoming report (past/unknown dates arrive as null).
const ER_BADGE_MAX_DAYS = 7   // show the row badge inside this window
const ER_SOON_DAYS      = 3   // red styling: binary risk a breakout buyer inherits

function earningsInfo(item) {
  const session = item.earnings_session === 'BMO' || item.earnings_session === 'AMC'
    ? item.earnings_session : null
  // Recompute days client-side from the report date — the shipped
  // days_to_earnings is frozen at wire-build time and decays over weekends
  // (review-panel finding). The shipped value is only a fallback.
  let days = null
  let dateLabel = null
  if (typeof item.earnings_date === 'string' && item.earnings_date.length >= 10) {
    const d = new Date(`${item.earnings_date}T12:00:00`)
    if (!Number.isNaN(d.getTime())) {
      dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const today = new Date(); today.setHours(12, 0, 0, 0)
      days = Math.round((d - today) / 86400000)
    }
  }
  if (days == null) days = num(item.days_to_earnings)
  if (days == null || days < 0) return null
  return {
    days,
    badge: (days === 0 ? 'ER TODAY' : `ER ${days}D`) + (session ? ` · ${session}` : ''),
    soon: days <= ER_SOON_DAYS,
    detail: [dateLabel, session].filter(Boolean).join(' · ') + (dateLabel ? ` (${days === 0 ? 'today' : `${days}d`})` : ''),
  }
}

// ── Accurate, deterministic trend / posture tag ───────────────────────────
// Replaces the old AI-thesis `setup_type` (which was inaccurate). Derived
// purely from the engine's real computed fields — EMA stack, distance above
// the 50EMA, % from the 52-week high, and RS. First match wins. Thresholds
// live here so they're trivial to tune.
const TREND_EXTENDED_PCT = 0.30   // > 30% above 50EMA = overbought / chase risk
const TREND_NEAR_HIGH    = 90     // pct_hi >= 90 = within ~10% of 52w high
const TREND_WEAK_RS      = 50

function trendTag(item) {
  const price = num(item.price)
  const e50   = num(item.e50)
  const rs    = num(item.rs)
  const pctHi = num(item.pct_hi)
  const align = item.ema_align
  const aboveE50 = price != null && e50 != null && price > e50

  if (align === 'LAG' || (price != null && e50 != null && price < e50) || (rs != null && rs < TREND_WEAK_RS))
    return { label: 'LAGGARD', cls: styles.tagLaggard }
  if (price != null && e50 != null && (price - e50) / e50 > TREND_EXTENDED_PCT)
    return { label: 'EXTENDED', cls: styles.tagExtended }
  if (align === 'LEAD' && pctHi != null && pctHi >= TREND_NEAR_HIGH)
    return { label: 'LEADER', cls: styles.tagLeader }
  if (aboveE50 && pctHi != null && pctHi < TREND_NEAR_HIGH)
    return { label: 'PULLBACK', cls: styles.tagPullback }
  return { label: 'TRENDING', cls: styles.tagTrending }
}

function rsClass(rs) {
  return rs >= 80 ? styles.rsHigh : rs >= 50 ? styles.rsMid : styles.rsLow
}

function Stat({ label, value, tone }) {
  if (value == null || value === '') return null
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statVal} ${tone === 'gain' ? styles.gain : tone === 'loss' ? styles.loss : ''}`}>{value}</span>
    </div>
  )
}

function TradePlan({ entry, stop, target1, target2 }) {
  const targets = [target1, target2].filter(Boolean).join('  ·  ')
  if (!entry && !stop && !targets) return null
  return (
    <div className={styles.tradePlan}>
      <span className={styles.tradePlanTitle}>Trade Plan</span>
      {entry && <div className={styles.tradeRow}><span className={styles.tradeLabel}>ENTRY</span><span className={styles.tradeText}>{entry}</span></div>}
      {stop  && <div className={styles.tradeRow}><span className={styles.tradeLabel}>STOP</span><span className={`${styles.tradeText} ${styles.loss}`}>{stop}</span></div>}
      {targets && <div className={styles.tradeRow}><span className={styles.tradeLabel}>TARGET</span><span className={`${styles.tradeText} ${styles.gain}`}>{targets}</span></div>}
    </div>
  )
}

function StockCard({ item, rank, expanded, onToggle, posData, isNew, liveData, hasInsiderBuy, rsData }) {
  const sym      = item.ticker ?? item.sym ?? item.symbol ?? '—'
  const company  = item.company ?? ''
  const rating   = num(item.score ?? item.rs_score)
  const tag      = trendTag(item)
  const earnings = earningsInfo(item)

  const livePrice = num(liveData?.price) ?? num(item.price)
  const liveChg   = num(liveData?.change_pct) ?? num(item.change)
  const rsRank    = num(rsData?.rs_rank) ?? num(item.rs)

  const liveReturn = (num(liveData?.price) != null && posData?.entry_price)
    ? (liveData.price - posData.entry_price) / posData.entry_price * 100
    : null
  const displayReturn = liveReturn ?? num(posData?.pct_return)
  const daysHeld = posData?.days_held

  const hasStructured = !!(item.company_desc || item.catalyst_text || item.price_action)
  const legacyThesis  = item.thesis ?? ''

  const chartMarkers = useMemo(() => {
    const m = []
    if (posData?.entry_date) {
      m.push({ time: posData.entry_date, position: 'belowBar', color: '#3cb868', shape: 'arrowUp', text: 'BUY' })
    }
    return m
  }, [posData])

  const chartPriceLines = useMemo(() => {
    const lines = []
    if (posData?.entry_price) lines.push({ price: posData.entry_price, color: '#3cb868', lineStyle: 2, title: `Entry $${posData.entry_price.toFixed(2)}` })
    if (posData?.stop_price)  lines.push({ price: posData.stop_price,  color: '#e74c3c', lineStyle: 2, title: `Stop $${posData.stop_price.toFixed(2)}` })
    return lines
  }, [posData])

  return (
    <div className={`${styles.card} ${expanded ? styles.cardOpen : ''}`}>
      {/* Collapsed row — aligned grid; keyboard-drivable (Enter/Space toggles) */}
      <div
        className={styles.row}
        onClick={onToggle}
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
        }}
      >
        <span className={styles.rank}>{rank}</span>
        <span className={`${styles.cTag} ${styles.tagCell}`}>
          <span className={`${styles.tag} ${tag.cls}`}>{tag.label}</span>
        </span>
        <span className={styles.tickerCell}>
          <span className={styles.tickerInner} onClick={e => e.stopPropagation()}>
            <TickerPopup sym={sym} markers={chartMarkers} priceLines={chartPriceLines} stopPrice={posData?.stop_price ?? null}>
              <span className={styles.sym}>{sym}</span>
            </TickerPopup>
          </span>
          {isNew && <span className={styles.newBadge}>NEW</span>}
          {hasInsiderBuy && <span className={styles.insiderBadge}>INSIDER</span>}
          {earnings && earnings.days <= ER_BADGE_MAX_DAYS && (
            <span className={`${styles.erBadge} ${earnings.soon ? styles.erBadgeSoon : ''}`}>{earnings.badge}</span>
          )}
          {company && <span className={styles.companyName}>{company}</span>}
        </span>
        <span className={styles.price}>{fmtPrice(livePrice) ?? '—'}</span>
        <span className={`${styles.chg} ${(liveChg ?? 0) >= 0 ? styles.gain : styles.loss}`}>{fmtPct(liveChg) ?? '—'}</span>
        <span className={`${styles.cRs} ${styles.rsCell}`}>
          {rsRank != null ? <span className={`${styles.rsBadge} ${rsClass(rsRank)}`}>{Math.round(rsRank)}</span> : <span className={styles.dim}>—</span>}
        </span>
        <span className={`${styles.cDays} ${styles.days}`}>{daysHeld != null ? `${daysHeld}d` : <span className={styles.dim}>—</span>}</span>
        <span className={`${styles.since} ${(displayReturn ?? 0) >= 0 ? styles.gain : styles.loss}`}>{fmtPct(displayReturn) ?? <span className={styles.dim}>—</span>}</span>
        <span className={styles.rating}>{rating != null ? rating.toFixed(1) : '—'}</span>
        <span className={styles.caret}>{expanded ? '▾' : '▸'}</span>
      </div>

      {/* Expanded — full width, two columns */}
      {expanded && (
        <div className={styles.expanded}>
          <div className={styles.expandedMain}>
            {hasStructured ? (
              <>
                {item.company_desc && <p className={styles.companyDesc}>{item.company_desc}</p>}
                {item.catalyst_text && (
                  <div className={styles.section}>
                    <span className={styles.sectionLabel}>CATALYST</span>
                    <p className={styles.sectionText}>{item.catalyst_text}</p>
                  </div>
                )}
                {item.price_action && (
                  <div className={styles.section}>
                    <span className={styles.sectionLabel}>PRICE ACTION</span>
                    <p className={styles.sectionText}>{item.price_action}</p>
                  </div>
                )}
              </>
            ) : legacyThesis ? (
              <p className={styles.legacyThesis}>{legacyThesis}</p>
            ) : (
              <p className={styles.sectionText}>No thesis available for this name yet.</p>
            )}
            <ReadAloudButton
              trackId={`uct20-pick-${sym}`}
              label={`UCT 20 — ${sym}`}
              textProvider={() => {
                if (hasStructured) {
                  return `${sym}. ${item.company_desc || ''}. Catalyst: ${item.catalyst_text || ''}. Price action: ${item.price_action || ''}.`
                }
                return `${sym}. ${legacyThesis}.`
              }}
            >
              Read
            </ReadAloudButton>
          </div>

          <aside className={styles.expandedSide}>
            <TradePlan entry={item.entry} stop={item.stop} target1={item.target_1} target2={item.target_2} />
            <div className={styles.statGrid}>
              <Stat label="RS" value={rsRank != null ? Math.round(rsRank) : null} />
              <Stat label="Rating" value={rating != null ? rating.toFixed(1) : null} />
              <Stat label="1M" value={fmtPct(num(item.ret_1m))} tone={(num(item.ret_1m) ?? 0) >= 0 ? 'gain' : 'loss'} />
              <Stat label="3M" value={fmtPct(num(item.ret_3m))} tone={(num(item.ret_3m) ?? 0) >= 0 ? 'gain' : 'loss'} />
              <Stat label="From High" value={num(item.pct_hi) != null ? `${num(item.pct_hi).toFixed(0)}%` : null} />
              <Stat label="Inst Own" value={num(item.inst_own) != null ? `${num(item.inst_own).toFixed(0)}%` : null} />
              <Stat label="Inst Δ" value={num(item.inst_trans) != null ? `${num(item.inst_trans) >= 0 ? '+' : ''}${num(item.inst_trans).toFixed(1)}%` : null} tone={(num(item.inst_trans) ?? 0) >= 0 ? 'gain' : 'loss'} />
              <Stat label="Short Float" value={num(item.short_flt) != null ? `${num(item.short_flt).toFixed(1)}%` : null} />
              <Stat label="Earnings" value={earnings?.detail || null} tone={earnings?.soon ? 'loss' : undefined} />
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function MethodologySheet({ open, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} variant="auto" title="How the UCT20 is built">
      <div className={styles.methodBody}>
        <p className={styles.methodLede}>
          The UCT20 is a fully systematic ranking, rebuilt every trading morning at
          7:35 AM ET. No name is ever hand-picked — every slot is earned from the
          same scored data, and the full process is described below.
        </p>

        <h3 className={styles.methodH}>1 · The universe</h3>
        <p className={styles.methodP}>
          A stock must first pass every gate just to be considered: price above $10,
          average volume over 1M shares, market cap above $500M, trading above its
          200-day moving average, and at least $15M in average daily dollar volume.
          Roughly 800–1,000 names qualify on a normal day.
        </p>

        <h3 className={styles.methodH}>2 · The composite score</h3>
        <p className={styles.methodP}>
          Each candidate is scored on six weighted factors: relative strength versus
          the S&amp;P 500 measured across 1, 3, 6, and 12 months and weighted toward the
          longer timeframes (40%), trend quality — proximity to 52-week highs, price
          tightness, volume contraction, and moving-average structure (26%), earnings
          growth with a bonus for growth accelerating above its own 5-year trend (16%),
          liquidity (12%), and institutional sponsorship (6%).
        </p>

        <h3 className={styles.methodH}>3 · Bonuses and penalties</h3>
        <p className={styles.methodP}>
          Stocks within 4% of their 52-week high earn the largest bonus; stocks far
          below their highs are penalized. Names in the market&rsquo;s leading sectors and
          leading industry groups get a small boost — but only when the stock itself
          is already strong. Score penalties apply for heavy short interest, biotech
          binary risk, an earnings report inside 3 days, and a confirmed break below
          the 50-day moving average (a broken chart cannot ride its reputation).
        </p>

        <h3 className={styles.methodH}>4 · Stability</h3>
        <p className={styles.methodP}>
          Proven leaders get a small tenure bonus so the list turns over 1–3 names a
          day instead of churning — but only while their trend is intact. A separate
          13-week momentum screen lets young leaders — recent IPOs, fresh breakouts —
          compete with the established names. When the overall market weakens
          (S&amp;P below its 50- or 200-day average) all scores are marked down.
        </p>

        <h3 className={styles.methodH}>5 · The tracking portfolio</h3>
        <p className={styles.methodP}>
          The performance tracker below the list is a simulated $50,000 portfolio that
          simply follows the published list: equal-weight slots, buy at the market open
          when a name joins, sell at the open when it drops out. No stop-losses and no
          discretion — every fill is the real market price, so the record is exactly
          what following the list would have produced. Tracking began June 22, 2026
          after a data-integrity repair; earlier history could not be verified and is
          deliberately excluded.
        </p>

        <h3 className={styles.methodH}>6 · Integrity</h3>
        <p className={styles.methodP}>
          The data feed is validated before every publish. If a morning run fails its
          quality checks, the last verified list is served — clearly labeled — instead
          of a broken one, and the team is alerted. The ER badge flags names reporting
          earnings within 7 days.
        </p>

        <p className={styles.methodDisclaimer}>
          The UCT20 is a systematic momentum ranking for research and education. It is
          not investment advice or a recommendation to buy any security.
        </p>
      </div>
    </Sheet>
  )
}

export default function UCT20() {
  const { mutate } = useSWRConfig()
  const { data: rows }    = useSWR('/api/leadership',      fetcher, { refreshInterval: 3600000 })
  const { data: portData } = useSWR('/api/uct20/portfolio', fetcher, { refreshInterval: 3600000 })
  const { data: insiderFeed } = useSWR('/api/insider/feed', fetcher, { refreshInterval: 3600000, revalidateOnFocus: false })
  const { data: rsRankings } = useMobileSWR('/api/rs-rankings', fetcher, { refreshInterval: 3600000, marketHoursOnly: true })
  const [expandedIdx, setExpandedIdx] = useState(null)
  const [showMethodology, setShowMethodology] = useState(false)

  const handleRefresh = useCallback(() => Promise.all([
    mutate('/api/leadership'),
    mutate('/api/uct20/portfolio'),
    mutate('/api/rs-rankings'),
  ]), [mutate])

  // Accept both the new wrapped shape ({ stocks, status, last_updated }) and
  // the legacy raw-array shape so older cached responses don't blank the page.
  const rawStocks = Array.isArray(rows)
    ? rows
    : Array.isArray(rows?.stocks) ? rows.stocks : []
  const leadershipStatus = (rows && !Array.isArray(rows)) ? rows.status : null
  const leadershipUpdated = (rows && !Array.isArray(rows)) ? rows.last_updated : null
  const stocks = rawStocks.slice(0, 20)

  const allTickers = useMemo(() =>
    stocks.map(item => item.ticker ?? item.sym ?? item.symbol).filter(Boolean),
    [stocks]
  )
  const { prices } = useRealtimePrices(allTickers)

  const rsMap = useMemo(() => {
    const map = {}
    if (Array.isArray(rsRankings)) {
      for (const r of rsRankings) map[r.ticker] = r
    }
    return map
  }, [rsRankings])

  const posMap = useMemo(() => {
    const map = {}
    for (const pos of portData?.open_positions ?? []) map[pos.symbol] = pos
    return map
  }, [portData])

  const insiderBuySyms = useMemo(() => {
    if (!Array.isArray(insiderFeed)) return new Set()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const syms = new Set()
    for (const b of insiderFeed) {
      if (b.date >= cutoffStr) syms.add(b.symbol)
    }
    return syms
  }, [insiderFeed])

  const latestEntry = useMemo(() => {
    const dates = Object.values(posMap).map(p => p.entry_date).filter(Boolean)
    return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
  }, [posMap])

  function toggle(i) {
    setExpandedIdx(prev => prev === i ? null : i)
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}><UIcon name="star" size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />UCT 20</h1>
        <ReadAloudButton
          trackId="uct20-all-picks"
          label="UCT 20 picks"
          textProvider={() => {
            if (!stocks?.length) return ''
            return stocks.map((p, i) => {
              const rank = i + 1
              const sym = p.ticker ?? p.sym ?? p.symbol ?? ''
              const thesis = p.catalyst_text || p.thesis || ''
              return `Number ${rank}. ${sym}. ${thesis}.`
            }).join(' ')
          }}
          size="md"
        >
          Read all picks
        </ReadAloudButton>
        <button className={styles.methodBtn} onClick={() => setShowMethodology(true)}>
          <UIcon name="book" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          How it&rsquo;s built
        </button>
      </div>
      <MethodologySheet open={showMethodology} onClose={() => setShowMethodology(false)} />
      {leadershipStatus === 'held' && stocks.length > 0 && (
        <div className={styles.staleBanner}>
          This morning&rsquo;s rebuild didn&rsquo;t pass its quality checks, so you&rsquo;re seeing the
          last verified list{leadershipUpdated ? ` (from ${leadershipUpdated})` : ''}. The team has
          been alerted — it will refresh automatically once a clean run completes.
        </div>
      )}
      {leadershipStatus === 'stale' && stocks.length > 0 && (
        <div className={styles.staleBanner}>
          This list is from {leadershipUpdated || 'a previous session'} — a scheduled morning
          rebuild appears to have been missed. It will catch up on the next run.
        </div>
      )}
      <TileCard title="UCT 20 — Current Top Stocks">
        {!rows ? (
          <SkeletonTable rows={8} cols={3} />
        ) : stocks.length === 0 ? (
          <div className={styles.emptyState}>
            {leadershipStatus === 'stale' ? (
              <>
                <p className={styles.emptyStateTitle}>Leadership data is stale</p>
                <p className={styles.emptyStateBody}>
                  Last updated: {leadershipUpdated || 'unknown'}. The next refresh runs at 7:35 AM ET.
                </p>
              </>
            ) : (
              <>
                <p className={styles.emptyStateTitle}>Leadership data not yet available</p>
                <p className={styles.emptyStateBody}>
                  The UCT 20 refreshes daily at 7:35 AM ET after the morning wire push. Check back after.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className={styles.table}>
            <div className={styles.headerRow}>
              <span className={styles.rank}>#</span>
              <span className={`${styles.cTag} ${styles.alignL}`} title="Deterministic trend posture computed from EMA structure, RS, and distance from the 52-week high">TREND</span>
              <span className={styles.alignL}>TICKER</span>
              <span className={styles.alignR}>PRICE</span>
              <span className={styles.alignR}>CHG</span>
              <span className={`${styles.cRs} ${styles.alignC}`} title="Relative strength vs the S&P 500 (percentile)">RS</span>
              <span className={`${styles.cDays} ${styles.alignR}`} title="Days held in the tracking portfolio">DAYS</span>
              <span className={styles.alignR} title="Return since the name was added to the list">SINCE ADD</span>
              <span className={styles.alignR}>RATING</span>
              <span />
            </div>
            {stocks.map((item, i) => {
              const sym = item.ticker ?? item.sym ?? item.symbol
              const posData = posMap[sym] ?? null
              const isNew = posData?.entry_date != null && posData.entry_date === latestEntry
              return (
                <StockCard
                  key={sym ?? i}
                  item={item}
                  rank={i + 1}
                  expanded={expandedIdx === i}
                  onToggle={() => toggle(i)}
                  posData={posData}
                  isNew={isNew}
                  liveData={prices[sym] ?? null}
                  hasInsiderBuy={insiderBuySyms.has(sym)}
                  rsData={rsMap[sym] ?? null}
                />
              )
            })}
          </div>
        )}
        <p className={styles.tableFootnote}>
          Systematic momentum ranking for research and education — not investment advice
          or a recommendation to buy any security.
        </p>
        <UCT20Performance />
        <UCT20Backtest />
      </TileCard>
    </div>
    </PullToRefresh>
  )
}
