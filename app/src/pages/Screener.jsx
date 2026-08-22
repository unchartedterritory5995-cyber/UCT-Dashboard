import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import useMobileSWR from '../hooks/useMobileSWR'
import useRealtimePrices from '../hooks/useRealtimePrices'
import TickerPopup from '../components/TickerPopup'
import ScannerShell from './screener/shell/ScannerShell'
import { SkeletonTable } from '../components/Skeleton'
import { prefetchBars, prefetchBarOnIntent } from '../utils/prefetchBars'
import UIcon from '../components/ui/UIcon'
import styles from './Screener.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const PAGE_TABS = [
  { key: 'scanner', label: 'Scanner' },          // full-market ScannerShell (default)
  { key: 'board',   label: 'Candidate Board' },   // the 7 AM scanner candidate board
  { key: 'live',    label: 'Live Scan', icon: 'bolt' },
]

// ── Trigger definitions (each returns an object or null) ─────────────────────
const TRIGGERS = [
  {
    id: 'PDH_BREAK',
    label: 'PDH Break',
    color: '#c9a84c',
    check: (price, px, row) => {
      const lvl = row.prev_day_high ?? px?.prev_close
      return lvl && price > lvl ? { level: lvl } : null
    },
  },
  {
    id: 'R2G',
    label: 'Red→Green',
    color: '#4ade80',
    check: (price, px, row) => {
      const ref = row.prev_day_close ?? px?.prev_close
      if (!ref || !px?.day_open) return null
      return px.day_open < ref && price > ref ? { level: ref } : null
    },
  },
  {
    id: 'SURGE_5',
    label: '+5% Surge',
    color: '#60a5fa',
    check: (price, px) => {
      const chg = px?.change_pct ?? 0
      return chg >= 5 ? { pct: chg } : null
    },
  },
  {
    id: 'DROP_5',
    label: '-5% Drop',
    color: '#f87171',
    check: (price, px) => {
      const chg = px?.change_pct ?? 0
      return chg <= -5 ? { pct: chg } : null
    },
  },
]

function fmt(n, d = 2) { return n != null ? n.toFixed(d) : '—' }
function fmtPct(n) { const s = n >= 0 ? '+' : ''; return `${s}${fmt(n)}%` }

// ── LiveScanTab ───────────────────────────────────────────────────────────────
function LiveScanTab({ allCandidates, prices, isStreaming }) {
  const [feed, setFeed] = useState([])         // [{id, sym, trigger, price, meta, time}]
  const [flashSet, setFlashSet] = useState(new Set())
  const [mutedTriggers, setMutedTriggers] = useState(new Set())
  const firedRef = useRef(new Set())           // `${sym}_${trigId}` — one-shot detection

  // Reset the one-shot fired set only when the SET OF TICKERS changes (a new
  // day's candidates) — allCandidates is a fresh array identity on every SWR
  // refetch, which used to wipe the set every 30 min and re-fire old triggers.
  const tickerKey = allCandidates.map(r => r.ticker).join(',')
  useEffect(() => { firedRef.current = new Set() }, [tickerKey])

  // Evaluate triggers on every price tick
  useEffect(() => {
    if (!allCandidates.length) return
    const newFeed = []
    const newFlash = new Set()

    for (const row of allCandidates) {
      const sym = row.ticker
      const px = prices[sym]
      if (!px?.price) continue

      for (const trig of TRIGGERS) {
        if (mutedTriggers.has(trig.id)) continue
        const key = `${sym}_${trig.id}`
        const meta = trig.check(px.price, px, row)
        if (meta && !firedRef.current.has(key)) {
          firedRef.current.add(key)
          const entry = {
            id: `${key}_${Date.now()}`,
            sym,
            trigger: trig,
            price: px.price,
            change_pct: px.change_pct,
            meta,
            time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' }),
          }
          newFeed.push(entry)
          newFlash.add(sym)
        }
      }
    }

    if (newFeed.length) {
      setFeed(prev => [...newFeed, ...prev].slice(0, 100))
      setFlashSet(prev => { const next = new Set([...prev, ...newFlash]); return next })
      setTimeout(() => setFlashSet(prev => { const next = new Set(prev); newFlash.forEach(s => next.delete(s)); return next }), 1500)
    }
  }, [prices, allCandidates, mutedTriggers])

  const toggleMute = useCallback(id => {
    setMutedTriggers(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }, [])

  // Prices + stream state come from the parent's subscription — a second
  // useRealtimePrices here doubled the SSE subscription for the same tickers.
  return (
    <div className={styles.liveScan}>
      {/* Header */}
      <div className={styles.liveScanHeader}>
        <span className={`${styles.streamDot} ${isStreaming ? styles.streamDotLive : ''}`} />
        <span className={styles.streamLabel}>
          {!allCandidates.length ? 'No candidates to watch' : isStreaming ? 'Live' : 'Connecting...'}
        </span>
        <span className={styles.liveScanCount}>{allCandidates.length} candidates</span>
        <div className={styles.triggerFilters}>
          {TRIGGERS.map(t => (
            <button
              key={t.id}
              className={`${styles.trigFilter} ${mutedTriggers.has(t.id) ? styles.trigFilterMuted : ''}`}
              style={{ '--trig-color': t.color }}
              onClick={() => toggleMute(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {feed.length > 0 && (
          <button className={styles.clearFeed} onClick={() => { setFeed([]); firedRef.current = new Set() }}>
            Clear
          </button>
        )}
      </div>

      {/* Feed + candidates side by side */}
      <div className={styles.liveScanBody}>
        {/* Left: trigger feed */}
        <div className={styles.feedPanel}>
          <div className={styles.feedTitle}>Trigger Feed</div>
          {feed.length === 0 ? (
            <div className={styles.feedEmpty}>Watching for triggers…</div>
          ) : (
            feed.map(e => (
              <div key={e.id} className={styles.feedItem}>
                <span className={styles.feedTime}>{e.time}</span>
                <TickerPopup sym={e.sym}>
                  <span className={styles.feedSym}>{e.sym}</span>
                </TickerPopup>
                <span className={styles.feedTrig} style={{ color: e.trigger.color }}>{e.trigger.label}</span>
                <span className={styles.feedPrice}>${fmt(e.price)}</span>
                <span className={`${styles.feedChg} ${(e.change_pct ?? 0) >= 0 ? styles.pos : styles.neg}`}>
                  {fmtPct(e.change_pct ?? 0)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Right: candidate watch table */}
        <div className={styles.watchTable}>
          <div className={styles.watchHeader}>
            <span>Symbol</span><span>Price</span><span>Chg%</span><span>PDH</span><span>Triggers</span>
          </div>
          {allCandidates.map(row => {
            const sym = row.ticker
            const px = prices[sym]
            const price = px?.price
            const chg = px?.change_pct
            const activeTriggers = TRIGGERS.filter(t => {
              const key = `${sym}_${t.id}`
              return firedRef.current.has(key)
            })
            return (
              <div key={sym} className={`${styles.watchRow} ${flashSet.has(sym) ? styles.watchRowFlash : ''} ${activeTriggers.length ? styles.watchRowTriggered : ''}`}>
                <TickerPopup sym={sym}>
                  <span className={styles.watchSym}>{sym}</span>
                </TickerPopup>
                <span className={styles.watchPrice}>{price ? `$${fmt(price)}` : '—'}</span>
                <span className={`${styles.watchChg} ${chg == null ? '' : chg >= 0 ? styles.pos : styles.neg}`}>
                  {chg != null ? fmtPct(chg) : '—'}
                </span>
                <span className={styles.watchPdh}>{row.prev_day_high ? `$${fmt(row.prev_day_high)}` : '—'}</span>
                <div className={styles.watchTrigs}>
                  {activeTriggers.map(t => (
                    <span key={t.id} className={styles.watchTrigBadge} style={{ background: t.color + '22', color: t.color, borderColor: t.color + '55' }}>
                      {t.label}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Alert state display config ────────────────────────────────────────────────
const ALERT_CFG = {
  BREAKING:    { label: 'BREAKING', cls: 'alertBreaking', rowCls: 'rowBreaking', order: 0 },
  READY:       { label: 'READY',    cls: 'alertReady',    rowCls: 'rowReady',    order: 1 },
  WATCH:       { label: 'WATCH',    cls: 'alertWatch',    rowCls: '',            order: 2 },
  PATTERN:     { label: 'PATTERN',  cls: 'alertPattern',  rowCls: '',            order: 3 },
  NO_PATTERN:  { label: 'SIGNAL',   cls: 'alertNone',     rowCls: '',            order: 4 },
  RS_WEAK:     { label: 'RS WEAK',  cls: 'alertNone',     rowCls: 'rowExtended', order: 5 },
  NO_MOMENTUM: { label: 'NO MOM',   cls: 'alertNone',     rowCls: 'rowExtended', order: 5 },
  EXTENDED:    { label: 'EXT',      cls: 'alertNone',     rowCls: 'rowExtended', order: 6 },
  NO_DATA:     { label: '—',        cls: 'alertNone',     rowCls: 'rowExtended', order: 7 },
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const ao = (ALERT_CFG[a.alert_state] ?? ALERT_CFG.NO_DATA).order
    const bo = (ALERT_CFG[b.alert_state] ?? ALERT_CFG.NO_DATA).order
    if (ao !== bo) return ao - bo
    return (b.candle_score ?? 0) - (a.candle_score ?? 0)
  })
}

function scoreColor(score) {
  if (score == null) return 'var(--text-muted)'
  if (score >= 80) return 'var(--ut-green-bright)'
  if (score >= 55) return 'var(--ut-gold)'
  if (score >= 35) return '#4a9eff'
  return 'var(--text-muted)'
}

// ── Signal chips ──────────────────────────────────────────────────────────────
function SignalChips({ row, isGapper }) {
  const chips = []

  if (isGapper && row.gap_pct != null) {
    chips.push({
      key: 'gap',
      label: `+${row.gap_pct.toFixed(1)}% gap`,
      cls: row.gap_pct >= 8 ? 'indicatorAmber' : 'indicatorGreen',
    })
  }

  if (row.adr_pct != null) {
    chips.push({
      key: 'adr',
      label: `ADR ${row.adr_pct.toFixed(1)}%`,
      cls: row.adr_pct >= 8 ? 'indicatorAmber' : row.adr_pct >= 5 ? 'indicatorGreen' : 'indicatorMuted',
    })
  }

  if (row.pole_pct != null && row.pole_pct >= 15) {
    chips.push({ key: 'pole', label: `+${row.pole_pct.toFixed(0)}% run`, cls: 'indicatorGreen' })
  }

  if (row.ma_stack_intact) chips.push({ key: 'ma',  label: 'MA↑↑', cls: 'indicatorGreen' })
  if (row.ema_rising)      chips.push({ key: 'ema', label: 'EMA↑', cls: 'indicatorGreen' })

  if (row.rs_trend === 'up')   chips.push({ key: 'rs', label: 'RS↑', cls: 'indicatorGreen' })
  if (row.rs_trend === 'down') chips.push({ key: 'rs', label: 'RS↓', cls: 'indicatorRed' })

  if (row.vol_acc_ratio != null) {
    if (row.vol_acc_ratio > 1.1)    chips.push({ key: 'vol', label: 'ACC',  cls: 'indicatorGreen' })
    else if (row.vol_acc_ratio < 0.85) chips.push({ key: 'vol', label: 'DIST', cls: 'indicatorRed' })
  }

  if (row.earnings_date) {
    const suffix = row.earnings_tod === 'BMO' ? ' ▲' : row.earnings_tod === 'AMC' ? ' ▼' : ''
    chips.push({ key: 'earns', label: `EARNS ${row.earnings_date}${suffix}`, cls: 'indicatorAmber' })
  }

  if (!chips.length) return null
  return (
    <div className={styles.signalChips}>
      {chips.map(c => (
        <span key={c.key} className={`${styles.indicatorChip} ${styles[c.cls]}`}>{c.label}</span>
      ))}
    </div>
  )
}

// ── Candidate row ─────────────────────────────────────────────────────────────
function CandidateRow({ row, prices, isGapper }) {
  const alert = ALERT_CFG[row.alert_state] ?? ALERT_CFG.NO_DATA
  const lp    = prices[row.ticker]

  const rowCls = [
    styles.candidateItem,
    alert.rowCls ? styles[alert.rowCls] : '',
  ].filter(Boolean).join(' ')

  return (
    <li
      className={rowCls}
      onPointerEnter={() => prefetchBarOnIntent(row.ticker, 'D')}
      onFocus={() => prefetchBarOnIntent(row.ticker, 'D')}
    >
      {/* ── Row 1: badge · ticker · score · also · price ── */}
      <div className={styles.candidateTop}>
        <span className={`${styles.alertBadge} ${styles[alert.cls]}`}>{alert.label}</span>
        <TickerPopup sym={row.ticker} />
        {row.candle_score != null && (
          <span className={styles.candidateScore} style={{ color: scoreColor(row.candle_score) }}>
            {row.candle_score}
          </span>
        )}
        {row.also_qualified_as?.map(a => (
          <span key={a} className={styles.alsoChip}>
            {a === 'REMOUNT' ? 'remount' : a === 'GAPPER_NEWS' ? 'gap' : a.toLowerCase()}
          </span>
        ))}
        {lp && (
          <span className={styles.candidatePrice}>
            <span className={styles.candidatePriceAmt}>${lp.price?.toFixed(2)}</span>
            <span style={{ color: lp.change_pct >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
              {lp.change_pct >= 0 ? '+' : ''}{lp.change_pct?.toFixed(2)}%
            </span>
          </span>
        )}
      </div>

      {/* ── Row 2: company ── */}
      {row.company && <div className={styles.candidateCompany}>{row.company}</div>}

      {/* ── Row 3: signal chips ── */}
      <SignalChips row={row} isGapper={isGapper} />

      {/* ── Row 4: pattern info ── */}
      {row.pattern_detected && row.pattern_type && (
        <div className={styles.candidatePattern}>
          {row.pattern_type} · {row.days_in_pattern}d
          {row.apex_days_remaining != null && row.apex_days_remaining <= 12 && (
            <span className={styles.apexTag}>apex {row.apex_days_remaining}d</span>
          )}
        </div>
      )}
    </li>
  )
}

// ── Candidate list (sorted) ───────────────────────────────────────────────────
function CandidateList({ rows, prices, isGapper, emptyMsg }) {
  const sorted = useMemo(() => sortRows(rows ?? []), [rows])
  if (!sorted.length) {
    return (
      <div className={styles.emptyState}>
        {emptyMsg ?? 'No candidates — scanner runs at 7:00 AM CT'}
      </div>
    )
  }
  return (
    <ul className={styles.tickerList}>
      {sorted.map((row, i) => (
        <CandidateRow key={row.ticker ?? i} row={row} prices={prices} isGapper={isGapper} />
      ))}
    </ul>
  )
}

// ── Context bars ──────────────────────────────────────────────────────────────
function RegimeBar({ regime }) {
  if (!regime) return null
  const { phase, distribution_days, vix, exposure_pct, breadth_50ma } = regime
  const hostile = (distribution_days ?? 0) >= 6 || (vix ?? 0) > 25 || (breadth_50ma ?? 100) < 30
  const healthy = (distribution_days ?? 99) <= 2 && (vix ?? 99) < 18 && (breadth_50ma ?? 0) > 55
  const barCls  = hostile ? styles.regimeHostile : healthy ? styles.regimeHealthy : styles.regimeNeutral

  return (
    <div className={`${styles.regimeBar} ${barCls}`}>
      <span className={styles.regimeLabel}>REGIME</span>
      <span className={styles.regimePhase}>{phase}</span>
      {distribution_days != null && (
        <span className={styles.regimeStat}>{distribution_days} dist</span>
      )}
      {vix != null && (
        <span className={styles.regimeStat}>VIX {vix.toFixed(1)}</span>
      )}
      {exposure_pct != null && (
        <span className={styles.regimeStat}>{exposure_pct}% exp</span>
      )}
      {breadth_50ma != null && (
        <span className={styles.regimeStat}>{breadth_50ma.toFixed(0)}% &gt;50MA</span>
      )}
    </div>
  )
}

function PremarketBar({ premarket }) {
  if (!premarket) return null
  const { spy_change_pct, qqq_change_pct } = premarket
  if (spy_change_pct == null && qqq_change_pct == null) return null

  const fmtItem = (label, val) => val == null ? null : (
    <span className={styles.premarketItem} key={label}>
      <span style={{ opacity: 0.65 }}>{label}</span>
      {' '}
      <span style={{ color: val >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 700 }}>
        {val >= 0 ? '+' : ''}{val.toFixed(2)}%
      </span>
    </span>
  )

  return (
    <div className={styles.premarketBar}>
      <span className={styles.premarketLabel}>PREMARKET</span>
      {fmtItem('SPY', spy_change_pct)}
      {spy_change_pct != null && qqq_change_pct != null && (
        <span className={styles.premarketDivider}>·</span>
      )}
      {fmtItem('QQQ', qqq_change_pct)}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Screener({ embedded = false }) {
  const [pageTab, setPageTab] = useState('scanner')

  const { data, error } = useMobileSWR('/api/candidates', fetcher, {
    refreshInterval: 30 * 60 * 1000,
  })

  const candidates   = data?.candidates ?? {}
  const pullbackRows = candidates.pullback_ma ?? []
  const remountRows  = candidates.remount     ?? []
  const gapperRows   = candidates.gapper_news ?? []
  const generatedAt  = data?.generated_at     ?? null

  const allCandidates = useMemo(() => [
    ...pullbackRows, ...remountRows, ...gapperRows,
  ], [pullbackRows, remountRows, gapperRows])

  const allTickers = useMemo(() =>
    allCandidates.map(r => r.ticker).filter(Boolean),
    [allCandidates]
  )
  const { prices, isStreaming } = useRealtimePrices(['board', 'live'].includes(pageTab) ? allTickers : [])

  // Pre-warm Daily bars for the top candidates when scanner data arrives
  useEffect(() => {
    if (!allTickers.length) return
    prefetchBars(allTickers.slice(0, 30), 'D')
  }, [allTickers])

  const fullBleed = pageTab === 'scanner'
  const containerCls = `${fullBleed ? styles.containerFull : styles.container} ${embedded ? styles.pageEmbedded : ''}`.trim()

  return (
    <div className={containerCls}>
      <div className={fullBleed ? styles.headerFull : styles.header}>
        {!embedded && <h1 className={styles.heading}><UIcon name="screener" size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />Scanner Hub</h1>}
        <div className={styles.pageTabs}>
          {PAGE_TABS.map(t => (
            <button
              key={t.key}
              className={`${styles.pageTab}${pageTab === t.key ? ' ' + styles.pageTabActive : ''}`}
              onClick={() => setPageTab(t.key)}
            >
              {t.icon && <UIcon name={t.icon} size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />}{t.label}
            </button>
          ))}
        </div>
      </div>

      {pageTab === 'scanner' ? (
        // ⛔ AHEAD OF THE `/api/candidates` BRANCHES, DELIBERATELY — see
        // `ScannerShell.jsx`'s own header note. The scan definition detail that
        // used to live behind a "My Formulas" tab now mounts INSIDE ScannerShell
        // (via `ScreensManager`), and ScannerShell mounts here, ahead of the
        // `error ? … : !data ? <SkeletonTable/> : …` chain below — so it never
        // goes blank on a morning the pre-market candidate scan fails upstream.
        <ScannerShell embedded={embedded} />
      ) : error ? (
        <div className={styles.emptyState}>Scanner data unavailable</div>
      ) : !data ? (
        <SkeletonTable rows={8} cols={3} />
      ) : pageTab === 'live' ? (
        <LiveScanTab allCandidates={allCandidates} prices={prices} isStreaming={isStreaming} />
      ) : (
        <>
          <PremarketBar premarket={data.premarket_context} />
          <RegimeBar regime={data.regime_context} />

          {allCandidates.length === 0 && generatedAt && (
            <div className={styles.scanHealthWarn}>
              The {generatedAt} scan returned zero candidates in every bucket —
              that usually means the pre-market scan failed upstream, not that
              nothing set up today.
            </div>
          )}

          <div className={styles.columnsGrid}>
            <div className={styles.column}>
              <div className={styles.columnHeader}>
                <span className={styles.columnTitle}>Pullback MA</span>
                {pullbackRows.length > 0 && (
                  <span className={styles.columnCount}>{pullbackRows.length}</span>
                )}
              </div>
              <div className={styles.columnBody}>
                <CandidateList
                  rows={pullbackRows}
                  prices={prices}
                  emptyMsg="No pullback candidates — scanner runs at 7:00 AM CT"
                />
              </div>
            </div>

            <div className={styles.column}>
              <div className={styles.columnHeader}>
                <span className={styles.columnTitle}>Remount</span>
                {remountRows.length > 0 && (
                  <span className={styles.columnCount}>{remountRows.length}</span>
                )}
              </div>
              <div className={styles.columnBody}>
                <CandidateList
                  rows={remountRows}
                  prices={prices}
                  emptyMsg="No remount candidates"
                />
              </div>
            </div>

            <div className={styles.column}>
              <div className={styles.columnHeader}>
                <span className={styles.columnTitle}>Gappers</span>
                {gapperRows.length > 0 && (
                  <span className={styles.columnCount}>{gapperRows.length}</span>
                )}
              </div>
              <div className={styles.columnBody}>
                <CandidateList
                  rows={gapperRows}
                  prices={prices}
                  isGapper
                  emptyMsg="No gap candidates"
                />
              </div>
            </div>
          </div>

          {generatedAt && (
            <div className={styles.meta}>Generated: {generatedAt}</div>
          )}
        </>
      )}
    </div>
  )
}
