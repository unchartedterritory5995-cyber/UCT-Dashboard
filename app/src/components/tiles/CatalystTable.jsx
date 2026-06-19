import { useMemo, useState } from 'react'
import useCatalysts from '../../hooks/useCatalysts'
import useUserTickerSet from '../../hooks/useUserTickerSet'
import useLivePrices from '../../hooks/useLivePrices'
import HighlightThesis from '../../utils/highlightThesis'
import { timeAgo, formatET } from '../../utils/timeAgo'
import TickerPopup from '../TickerPopup'
import CompanyLogo from '../CompanyLogo'
import { useAuth } from '../../context/AuthContext'
import styles from './CatalystTable.module.css'
import { prefetchBarOnIntent } from '../../utils/prefetchBars'
import ReadAloudButton from '../voice/ReadAloudButton'

const UI_ENABLED = (import.meta.env.VITE_CATALYST_UI_ENABLED ?? '1') !== '0'

const ALL_TAGS = ['Catalyst', 'Earnings', 'Gapper', 'News']

function TagChip({ tag, active, onClick, count }) {
  const cls = {
    Catalyst: styles.tagCatalyst,
    Earnings: styles.tagEarnings,
    Gapper:   styles.tagGapper,
    News:     styles.tagNews,
  }[tag] || styles.tagDefault
  const dim = !active ? styles.chipDim : ''
  return (
    <button
      type="button"
      className={`${styles.tag} ${cls} ${styles.chipBtn} ${dim}`}
      onClick={onClick}
      title={`Toggle ${tag} (${count})`}
    >
      {tag}{count != null ? ` ${count}` : ''}
    </button>
  )
}

function RowTagChip({ tag }) {
  const cls = {
    Catalyst: styles.tagCatalyst,
    Earnings: styles.tagEarnings,
    Gapper:   styles.tagGapper,
    News:     styles.tagNews,
  }[tag] || styles.tagDefault
  return <span className={`${styles.tag} ${cls}`}>{tag || '—'}</span>
}

function NewBadge({ isNew }) {
  if (!isNew) return null
  return (
    <span className={styles.newBadge} title="New catalyst — first surfaced today">
      NEW
    </span>
  )
}

function GradeBadge({ grade }) {
  if (!grade) return null
  const cls = { A: styles.gradeA, B: styles.gradeB, C: styles.gradeC }[grade] || styles.gradeB
  return (
    <span className={`${styles.gradeBadge} ${cls}`} title={`Catalyst strength: grade ${grade}`}>
      {grade}
    </span>
  )
}

const TYPE_ICONS = {
  'M&A': '🤝', 'FDA': '💊', 'Analyst': '📈', 'Contract': '📝', 'Guidance': '🎯',
  'Product': '🚀', 'Legal': '⚖️', 'Insider': '👤', 'Index': '🧩', 'Offering': '💵',
  'Earnings': '📊', 'Momentum': '🌊', 'Sector-wide': '🏭',
}

function TypeChip({ type }) {
  if (!type || type === 'None') return null
  const icon = TYPE_ICONS[type]
  return (
    <span className={styles.typeChip} title="Catalyst type">
      {icon ? `${icon} ` : ''}{type}
    </span>
  )
}

function FeedbackButtons({ ticker, marketDate, verdict, onVote }) {
  return (
    <span className={styles.feedbackWrap}>
      <button
        type="button"
        className={`${styles.fbBtn} ${verdict === 'good' ? styles.fbGoodActive : ''}`}
        title="Good catalyst — show more like this"
        onClick={() => onVote(ticker, marketDate, 'good')}
      >👍</button>
      <button
        type="button"
        className={`${styles.fbBtn} ${verdict === 'bad' ? styles.fbBadActive : ''}`}
        title="Lame / not a real catalyst — learn to exclude these"
        onClick={() => onVote(ticker, marketDate, 'bad')}
      >👎</button>
    </span>
  )
}

function fmtPct(v) {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function fmtVolX(v) {
  if (v == null || v === 0) return '—'
  if (v >= 100) return `${v.toFixed(0)}×`
  if (v >= 10) return `${v.toFixed(1)}×`
  return `${v.toFixed(2)}×`
}

function fmtPrice(v) {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}

function parseSources(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch {
    return []
  }
}

function ExplainTickerWidget() {
  const [open, setOpen] = useState(false)
  const [sym, setSym] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  async function lookup() {
    const t = sym.trim().toUpperCase()
    if (!t) return
    setLoading(true); setResult(null)
    try {
      const r = await fetch(`/api/catalysts/explain/${t}`)
      if (!r.ok) {
        setResult({ error: `HTTP ${r.status}` })
      } else {
        setResult(await r.json())
      }
    } catch (e) {
      setResult({ error: String(e) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.explainRow}>
      <button
        type="button"
        className={styles.explainToggle}
        onClick={() => setOpen(o => !o)}
        title="Why isn't a ticker on the list?"
      >
        🔎 {open ? 'Close lookup' : 'Why isn\'t X on the list?'}
      </button>
      {open && (
        <div className={styles.explainPanel}>
          <div className={styles.explainInputRow}>
            <input
              type="text"
              value={sym}
              onChange={(e) => setSym(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && lookup()}
              placeholder="Ticker (e.g. NVDA)"
              className={styles.explainInput}
              maxLength={6}
            />
            <button type="button" className={styles.explainBtn} disabled={loading} onClick={lookup}>
              {loading ? '…' : 'Check'}
            </button>
          </div>
          {result && result.error && (
            <div className={styles.explainError}>Error: {result.error}</div>
          )}
          {result && !result.error && !result.found && (
            <div className={styles.explainBody}>
              <strong>{result.ticker}</strong>: not in candidate pool this refresh.
              <div className={styles.explainHint}>{result.reason}</div>
            </div>
          )}
          {result && !result.error && result.found && (
            <div className={styles.explainBody}>
              <div className={styles.explainHeader}>
                <strong>{result.ticker}</strong>
                <span>{result.tag ? `tag: ${result.tag}` : 'no tag'}</span>
                <span>score: {result.score?.toFixed(2)}</span>
                <span>rank: {result.rank_among_scored ?? '—'} / {result.total_scored}</span>
              </div>
              <div className={styles.explainHint}>{result.reason}</div>
              <details className={styles.explainDetails}>
                <summary>Signal breakdown</summary>
                <pre className={styles.explainPre}>
{JSON.stringify(result.signal_summary, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SortableTh({ col, className, sortBy, onSort, children }) {
  const active = sortBy && sortBy.col === col
  const arrow = !active ? '' : (sortBy.dir === 'asc' ? ' ▲' : ' ▼')
  return (
    <th
      className={`${className} ${styles.sortableHeader} ${active ? styles.sortActive : ''}`}
      onClick={() => onSort(col)}
      title="Click to sort"
    >
      {children}{arrow}
    </th>
  )
}

function CitationsPopover({ sources }) {
  const [open, setOpen] = useState(false)
  if (!sources || sources.length === 0) return null
  return (
    <span className={styles.citationsWrap}>
      <button
        type="button"
        className={styles.citationsBtn}
        onClick={() => setOpen(o => !o)}
        title={`${sources.length} source${sources.length > 1 ? 's' : ''} cited`}
      >
        ⓘ
      </button>
      {open && (
        <span className={styles.citationsPop}>
          <span className={styles.citationsHeader}>
            Sources ({sources.length})
            <button type="button" className={styles.citationsClose} onClick={() => setOpen(false)}>✕</button>
          </span>
          {sources.slice(0, 8).map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noreferrer" className={styles.citationLink}>
              {(() => {
                try { return new URL(url).hostname.replace(/^www\./, '') }
                catch { return url.slice(0, 40) }
              })()}
            </a>
          ))}
        </span>
      )}
    </span>
  )
}

export default function CatalystTable() {
  const { data, mutate, isValidating } = useCatalysts()
  const auth = useAuth() || {}
  const isAdmin = auth?.user?.role === 'admin'
  const myTickers = useUserTickerSet()
  const [refreshing, setRefreshing] = useState(false)
  const [activeTags, setActiveTags] = useState(new Set(ALL_TAGS))
  const [aOnly, setAOnly] = useState(false)
  // Local optimistic record of this session's 👍/👎 votes, keyed by ticker.
  const [votes, setVotes] = useState({})

  if (!UI_ENABLED) return null

  const allRows = data?.rows || []
  const generatedAt = data?.generated_at
  const marketDate = data?.market_date
  const sectorContexts = data?.sector_contexts || []

  // One-glance morning digest: total + A-grade count + the top catalyst types.
  const summary = (() => {
    const g = { A: 0, B: 0, C: 0 }
    const types = {}
    for (const r of allRows) {
      if (g[r.grade] != null) g[r.grade]++
      const t = r.catalyst_type
      if (t && t !== 'None') types[t] = (types[t] || 0) + 1
    }
    const topTypes = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 3)
    return { total: allRows.length, aCount: g.A, topTypes }
  })()

  // Stale warning: on a trading day a refresh older than ~2h means the
  // scheduled run likely isn't firing — pairs with the backend self-heal.
  const ageMin = generatedAt ? (Date.now() / 1000 - generatedAt) / 60 : null
  const isStale = ageMin != null && ageMin > 120

  async function vote(ticker, md, verdict) {
    // Toggle off if clicking the same verdict again.
    const next = votes[ticker] === verdict ? null : verdict
    setVotes(prev => ({ ...prev, [ticker]: next }))
    if (!next) return
    try {
      await fetch('/api/catalysts/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, market_date: md, verdict: next }),
      })
    } catch {
      /* best-effort — keep optimistic state */
    }
  }

  // Live prices for the displayed tickers — gives us tick-by-tick % change
  // (2s SWR poll). Backend stored gap_pct is the fallback while live data
  // is loading or for tickers not in the live-price endpoint's universe.
  const tickerSymbols = useMemo(() => allRows.map(r => r.ticker), [allRows])
  const { prices: livePrices } = useLivePrices(tickerSymbols)

  // Sort state: null = engine-ranked order (default), or {col, dir} for column sort
  const [sortBy, setSortBy] = useState(null)

  function toggleSort(col) {
    setSortBy(prev => {
      if (!prev || prev.col !== col) return { col, dir: 'desc' }
      if (prev.dir === 'desc') return { col, dir: 'asc' }
      return null  // third click clears
    })
  }

  function getSortValue(row, col) {
    const live = livePrices[row.ticker] || livePrices[String(row.ticker).toUpperCase()]
    switch (col) {
      case 'sym':       return row.ticker || ''
      case 'price':     return (live?.price != null ? live.price : row.price) ?? 0
      case 'change':    return (live?.change_pct != null ? live.change_pct : row.gap_pct) ?? 0
      case 'volx':      return row.vol_x ?? 0
      case 'tag':       return row.tag || ''
      case 'when':      return row.catalyst_at ?? row.thesis_at ?? 0
      default:          return row.rank ?? 999
    }
  }

  // Per-tag counts (used in chip labels) — computed against full row list,
  // not filtered list, so toggling a chip doesn't change the counts.
  const tagCounts = useMemo(() => {
    const counts = {}
    for (const t of ALL_TAGS) counts[t] = 0
    for (const r of allRows) {
      if (counts[r.tag] != null) counts[r.tag]++
    }
    return counts
  }, [allRows])

  const filteredRows = useMemo(() => {
    const filtered = allRows.filter(r => activeTags.has(r.tag) && (!aOnly || r.grade === 'A'))
    if (!sortBy) return filtered
    const sorted = [...filtered].sort((a, b) => {
      const av = getSortValue(a, sortBy.col)
      const bv = getSortValue(b, sortBy.col)
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortBy.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortBy.dir === 'asc' ? av - bv : bv - av
    })
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, activeTags, aOnly, sortBy, livePrices])

  function toggleTag(tag) {
    setActiveTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      // If user just turned everything off, turn everything back on
      if (next.size === 0) return new Set(ALL_TAGS)
      return next
    })
  }

  async function forceRefresh() {
    if (!isAdmin) return
    setRefreshing(true)
    try {
      await fetch('/api/catalysts/refresh', { method: 'POST' })
      // run_refresh does 8 source pulls + enrichment + up to 20 LLM syntheses
      // (30–60s). A single 3s refetch showed the pre-refresh list and looked
      // like "nothing changed" — poll several times across the job's lifetime.
      const at = [5000, 12000, 20000, 30000, 45000]
      at.forEach(ms => setTimeout(() => mutate(), ms))
    } finally {
      setTimeout(() => setRefreshing(false), 47000)
    }
  }

  const updatedText = generatedAt ? `updated ${timeAgo(generatedAt)}` : 'no data yet'
  const showingAll = activeTags.size === ALL_TAGS.length

  return (
    <div className={styles.tile}>
      <div className={styles.header}>
        <span className={styles.title}>🎯 STOCK CATALYSTS</span>
        <span className={styles.meta}>
          <span
            className={`${styles.updated} ${isStale ? styles.stale : ''}`}
            title={isStale ? 'Data looks stale for a trading day — a refresh should be running' : undefined}
          >
            {updatedText}{isStale ? ' ⚠ stale' : ''}
          </span>
          {allRows.length > 0 && (
            <ReadAloudButton
              trackId="stock-catalysts-brief"
              label="Stock Catalysts brief"
              textProvider={() => {
                if (!filteredRows.length) return 'No catalysts to read yet.'
                const parts = filteredRows.slice(0, 12).map(r => {
                  const t = r.catalyst_type && r.catalyst_type !== 'None' ? `${r.catalyst_type}. ` : ''
                  const thesis = (r.thesis_text || '').replace(/\*\*/g, '')
                  return `${r.ticker}. ${t}${thesis}`
                })
                return `Today's stock catalysts. ${parts.join(' ')}`
              }}
            >
              🔊 Listen
            </ReadAloudButton>
          )}
          <a href="/catalysts/history" className={styles.historyLink} title="Browse past trading days">
            history →
          </a>
          {isAdmin && (
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={forceRefresh}
              disabled={refreshing || isValidating}
            >
              {refreshing ? '…' : '↻ Refresh'}
            </button>
          )}
        </span>
      </div>

      {allRows.length > 0 && (
        <div className={styles.summaryLine}>
          {summary.total} catalyst{summary.total === 1 ? '' : 's'} today
          {summary.aCount > 0 ? ` · ${summary.aCount} A-grade` : ''}
          {summary.topTypes.map(([t, n]) => ` · ${n} ${t}`).join('')}
        </div>
      )}

      <ExplainTickerWidget />

      {sectorContexts.length > 0 && (
        <div className={styles.sectorBanners}>
          {sectorContexts.map((sc, i) => (
            <div key={i} className={styles.sectorBanner}>
              <span className={styles.sectorBadge}>📊 {sc.sector} · {sc.ticker_count} catalysts</span>
              <span className={styles.sectorSummary}>{sc.summary}</span>
              {sc.source_urls && sc.source_urls.length > 0 && (
                <CitationsPopover sources={sc.source_urls} />
              )}
            </div>
          ))}
        </div>
      )}

      {allRows.length > 0 && (
        <div className={styles.chipRow}>
          {ALL_TAGS.map(t => (
            <TagChip
              key={t}
              tag={t}
              active={activeTags.has(t)}
              onClick={() => toggleTag(t)}
              count={tagCounts[t]}
            />
          ))}
          <button
            type="button"
            className={`${styles.chipBtn} ${aOnly ? styles.aOnlyActive : styles.chipDim}`}
            onClick={() => setAOnly(v => !v)}
            title="Show only A-grade (highest-conviction) catalysts"
          >
            ★ A only
          </button>
          {!showingAll && (
            <button
              type="button"
              className={styles.chipBtn}
              onClick={() => setActiveTags(new Set(ALL_TAGS))}
              title="Show all"
            >
              reset
            </button>
          )}
        </div>
      )}

      {allRows.length === 0 ? (
        <div className={styles.empty}>
          No catalysts yet. Click the ↻ refresh button to pull fresh data.
        </div>
      ) : filteredRows.length === 0 ? (
        <div className={styles.empty}>
          No rows match the active tag filter. Click a chip above to add it back.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <SortableTh col="sym"    className={styles.colSym}     sortBy={sortBy} onSort={toggleSort}>Sym</SortableTh>
                <SortableTh col="price"  className={styles.colPrice}   sortBy={sortBy} onSort={toggleSort}>Price</SortableTh>
                <SortableTh col="change" className={styles.colGap}     sortBy={sortBy} onSort={toggleSort}>% Change</SortableTh>
                <SortableTh col="volx"   className={styles.colVol}     sortBy={sortBy} onSort={toggleSort}>Vol×</SortableTh>
                <SortableTh col="tag"    className={styles.colTag}     sortBy={sortBy} onSort={toggleSort}>Tag</SortableTh>
                <th className={styles.colThesis}>Catalyst</th>
                <SortableTh col="when"   className={styles.colUpdated} sortBy={sortBy} onSort={toggleSort}>When</SortableTh>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(r => {
                const onMyList = myTickers.has(String(r.ticker || '').toUpperCase())
                // Prefer live price + change from useLivePrices (2s poll);
                // fall back to stored snapshot values when live data is loading
                // or the ticker isn't in the live-prices universe.
                const live = livePrices[r.ticker] || livePrices[String(r.ticker).toUpperCase()]
                const displayPrice = (live && live.price != null) ? live.price : r.price
                const displayChange = (live && live.change_pct != null) ? live.change_pct : r.gap_pct
                return (
                  <tr
                    key={r.ticker}
                    className={onMyList ? styles.rowMine : ''}
                    onPointerEnter={() => prefetchBarOnIntent(r.ticker, 'D')}
                    onFocus={() => prefetchBarOnIntent(r.ticker, 'D')}
                  >
                    <td className={styles.colSym}>
                      <span className={styles.symCell}>
                        <CompanyLogo sym={r.ticker} size={20} tile />
                        <TickerPopup sym={r.ticker}>
                          <span className={styles.ticker}>
                            {onMyList && <span className={styles.star} title="On your watchlist or flagged">★</span>}
                            {r.ticker}
                          </span>
                        </TickerPopup>
                      </span>
                    </td>
                    <td className={styles.colPrice}>{fmtPrice(displayPrice)}</td>
                    <td className={`${styles.colGap} ${(displayChange ?? 0) >= 0 ? styles.gain : styles.loss}`}>
                      {fmtPct(displayChange)}
                    </td>
                    <td className={styles.colVol}>{fmtVolX(r.vol_x)}</td>
                    <td className={styles.colTag}>
                      <NewBadge isNew={r.is_new} />
                      <RowTagChip tag={r.tag} />
                      <GradeBadge grade={r.grade} />
                    </td>
                    <td className={styles.colThesis}>
                      <TypeChip type={r.catalyst_type} />
                      <HighlightThesis text={r.thesis_text} />
                      <CitationsPopover sources={parseSources(r.thesis_sources)} />
                      <FeedbackButtons
                        ticker={r.ticker}
                        marketDate={marketDate}
                        verdict={votes[r.ticker]}
                        onVote={vote}
                      />
                    </td>
                    <td
                      className={styles.colUpdated}
                      title={r.catalyst_at
                        ? `Catalyst occurred ${timeAgo(r.catalyst_at)}\nSynthesized ${r.thesis_at ? timeAgo(r.thesis_at) : '—'}`
                        : (r.thesis_at ? `Synthesized ${timeAgo(r.thesis_at)} (no source timestamp)` : 'No data yet')}
                    >
                      {r.catalyst_at
                        ? formatET(r.catalyst_at)
                        : (r.thesis_at ? <span className={styles.fallbackTime}>{formatET(r.thesis_at)}</span> : '—')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.footer}>
        Informational only — not investment advice. Synthesized by Claude Opus 4.7.
      </div>
    </div>
  )
}
