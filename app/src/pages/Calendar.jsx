// app/src/pages/Calendar.jsx
import { useState } from 'react'
import useSWR from 'swr'
import TickerPopup from '../components/TickerPopup'
import EarningsModal from '../components/tiles/EarningsModal'
import ErrorBoundary from '../components/ErrorBoundary'
import styles from './Calendar.module.css'

const fetcher = (url) => fetch(url).then(r => r.json())

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtEps(v) {
  if (v == null) return null
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(2)}`
}

function fmtRev(v) {
  if (v == null) return null
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}B`
  return `$${Math.round(v)}M`
}

function verdict(eps_act, eps_est) {
  if (eps_act == null) return 'pending'
  if (eps_est == null) return 'reported'
  if (eps_act > eps_est) return 'beat'
  if (eps_act < eps_est) return 'miss'
  return 'meet'
}

function calcSurprise(act, est) {
  if (act == null || est == null || est === 0) return null
  const pct = ((act - est) / Math.abs(est)) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

// Normalize calendar entry → EarningsModal row format
function toModalRow(entry) {
  const v = verdict(entry.eps_act, entry.eps_est)
  return {
    sym:              entry.sym,
    verdict:          v === 'meet' ? 'mixed' : v,
    reported_eps:     entry.eps_act,
    eps_estimate:     entry.eps_est,
    surprise_pct:     calcSurprise(entry.eps_act, entry.eps_est),
    rev_actual:       entry.rev_act,
    rev_estimate:     entry.rev_est,
    rev_surprise_pct: calcSurprise(entry.rev_act, entry.rev_est),
  }
}

function pillClass(v, styles) {
  if (v === 'beat')     return `${styles.verdictPill} ${styles.pillBeat}`
  if (v === 'miss')     return `${styles.verdictPill} ${styles.pillMiss}`
  if (v === 'meet')     return `${styles.verdictPill} ${styles.pillMixed}`
  if (v === 'reported') return `${styles.verdictPill} ${styles.pillMixed}`
  if (v === 'pending')  return `${styles.verdictPill} ${styles.pillPending}`
  return `${styles.verdictPill} ${styles.pillPending}`
}

function pillLabel(v) {
  if (v === 'beat')     return 'BEAT'
  if (v === 'miss')     return 'MISS'
  if (v === 'meet')     return 'MIXED'
  if (v === 'reported') return 'RPTD'
  return null
}

function epsActClass(v, eps_est, styles) {
  if (v == null || eps_est == null) return styles.epsAct
  if (v > eps_est) return `${styles.epsAct} ${styles.epsPos}`
  if (v < eps_est) return `${styles.epsAct} ${styles.epsNeg}`
  return `${styles.epsAct} ${styles.epsMixed}`
}

// ── Filter helpers ────────────────────────────────────────────────────────────

const MC_PRESETS = [
  { id: 'all',   label: 'All Cap' },
  { id: 'large', label: 'Large 10B+' },
  { id: 'mid',   label: 'Mid 2-10B' },
  { id: 'small', label: 'Small <2B' },
]
const PRICE_PRESETS = [
  { id: 'all', label: 'Any Price' },
  { id: '10',  label: '$10+' },
  { id: '25',  label: '$25+' },
  { id: '50',  label: '$50+' },
]
const VOL_PRESETS = [
  { id: 'all',  label: 'Any Vol' },
  { id: '500k', label: '500K+' },
  { id: '1m',   label: '1M+' },
  { id: '5m',   label: '5M+' },
]

function applyFilters(entries, metrics, mcFilter, priceFilter, volFilter) {
  if (mcFilter === 'all' && priceFilter === 'all' && volFilter === 'all') return entries
  return entries.filter(e => {
    const m = metrics?.[e.sym]
    const mc    = m?.mc_b  ?? e.mc_b  ?? null
    const price = m?.price ?? null
    const vol   = m?.avg_vol ?? null

    if (mcFilter === 'large' && (mc == null || mc < 10))               return false
    if (mcFilter === 'mid'   && (mc == null || mc < 2 || mc >= 10))    return false
    if (mcFilter === 'small' && (mc == null || mc >= 2))               return false

    if (priceFilter === '10'  && (price == null || price < 10))  return false
    if (priceFilter === '25'  && (price == null || price < 25))  return false
    if (priceFilter === '50'  && (price == null || price < 50))  return false

    if (volFilter === '500k' && (vol == null || vol < 500_000))   return false
    if (volFilter === '1m'   && (vol == null || vol < 1_000_000)) return false
    if (volFilter === '5m'   && (vol == null || vol < 5_000_000)) return false

    return true
  })
}

// ── Earnings grid header ──────────────────────────────────────────────────────

function GridHeader() {
  return (
    <div className={styles.gridHeader}>
      <span className={styles.colHead}>Ticker</span>
      <span className={styles.colHead}>EPS Est</span>
      <span className={styles.colHead}>EPS Act</span>
      <span className={styles.colHead}>Surp %</span>
      <span className={styles.colHead}>Revenue</span>
      <span className={styles.colHead}>Gap %</span>
      <span className={styles.colHead}></span>
    </div>
  )
}

// ── Earnings ticker row ────────────────────────────────────────────────────────

function TickerRow({ entry, reaction, onClick }) {
  const v         = verdict(entry.eps_act, entry.eps_est)
  const pill      = pillLabel(v)
  const reported  = entry.eps_act != null

  const estFmt    = fmtEps(entry.eps_est)   ?? '—'
  const actFmt    = fmtEps(entry.eps_act)   ?? '—'
  const surprFmt  = calcSurprise(entry.eps_act, entry.eps_est)

  // Revenue: prefer actual, fall back to estimate (labeled)
  const revFmt = entry.rev_act != null
    ? fmtRev(entry.rev_act)
    : entry.rev_est != null
      ? `${fmtRev(entry.rev_est)} est`
      : '—'

  const reactionFmt = reaction != null
    ? `${reaction >= 0 ? '+' : ''}${reaction.toFixed(1)}%`
    : null

  // Surprise color
  const surprClass = surprFmt == null
    ? styles.reactionNeutral
    : surprFmt.startsWith('+') ? styles.reactionPos : styles.reactionNeg

  return (
    <div className={styles.tickerRow} onClick={onClick} role="button" tabIndex={0}
         onKeyDown={e => e.key === 'Enter' && onClick()}>

      {/* Col 1 — Ticker */}
      <span className={styles.colTicker}><TickerPopup sym={entry.sym} /></span>

      {/* Col 2 — EPS Est */}
      <span className={`${styles.colValDim}`}>{reported ? estFmt : (estFmt !== '—' ? estFmt : '—')}</span>

      {/* Col 3 — EPS Act */}
      <span className={`${styles.colValBright} ${reported ? epsActClass(entry.eps_act, entry.eps_est, styles) : styles.colValDim}`}>
        {reported ? actFmt : '—'}
      </span>

      {/* Col 4 — Surprise % */}
      <span className={surprFmt != null ? surprClass : styles.reactionNeutral}>
        {surprFmt ?? '—'}
      </span>

      {/* Col 5 — Revenue */}
      <span className={styles.colValDim}>{revFmt}</span>

      {/* Col 6 — Gap % */}
      {reactionFmt ? (
        <span className={reaction >= 0 ? styles.reactionPos : styles.reactionNeg}>
          {reactionFmt}
        </span>
      ) : (
        <span className={styles.reactionNeutral}>—</span>
      )}

      {/* Col 7 — Verdict pill */}
      {pill ? (
        <span className={pillClass(v, styles)}>{pill}</span>
      ) : (
        <span className={styles.pillPending} />
      )}
    </div>
  )
}

// ── Filter chip strip ─────────────────────────────────────────────────────────

function FilterChips({ presets, value, onChange, label }) {
  return (
    <div className={styles.filterGroup}>
      <span className={styles.filterLabel}>{label}</span>
      <div className={styles.filterChips}>
        {presets.map(p => (
          <button
            key={p.id}
            className={[styles.filterChip, value === p.id ? styles.filterChipActive : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Earnings panel ─────────────────────────────────────────────────────────────

function EarningsPanel({ days, weekDates, onSelectEntry }) {
  const [activeDate, setActiveDate] = useState(() => {
    const today = new Date().toISOString().slice(0, 10)
    return weekDates.includes(today) ? today : weekDates[0]
  })

  const [mcFilter,    setMcFilter]    = useState('all')
  const [priceFilter, setPriceFilter] = useState('all')
  const [volFilter,   setVolFilter]   = useState('all')

  // Live price reactions for reported tickers (30s)
  const { data: reactions } = useSWR(
    `/api/calendar/reactions?date=${activeDate}`,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )

  // Price / avg-vol / mc metrics for filter bar (2 min)
  const { data: metrics } = useSWR(
    `/api/calendar/day-metrics?date=${activeDate}`,
    fetcher,
    { refreshInterval: 2 * 60_000, revalidateOnFocus: false }
  )

  const dayData = days[activeDate] || {}
  const rawBmo = dayData.bmo || []
  const rawAmc = dayData.amc || []

  const bmo = applyFilters(rawBmo, metrics, mcFilter, priceFilter, volFilter)
  const amc = applyFilters(rawAmc, metrics, mcFilter, priceFilter, volFilter)

  const filtersActive = mcFilter !== 'all' || priceFilter !== 'all' || volFilter !== 'all'

  return (
    <div className={styles.earningsPanel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelLabel}>Earnings Calendar</div>

        {/* Day tabs */}
        <div className={styles.dayTabs}>
          {weekDates.map(ds => {
            const d = days[ds]
            if (!d) return null
            const isActive = ds === activeDate
            const isToday  = d.is_today
            return (
              <button
                key={ds}
                className={[
                  styles.dayTab,
                  isActive ? styles.dayTabActive : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setActiveDate(ds)}
              >
                {d.label}
                {isToday && <span className={styles.todayDot} />}
              </button>
            )
          })}
        </div>

        {/* Filter bar */}
        <div className={styles.filterBar}>
          <FilterChips presets={MC_PRESETS}    value={mcFilter}    onChange={setMcFilter}    label="MCap" />
          <FilterChips presets={PRICE_PRESETS} value={priceFilter} onChange={setPriceFilter} label="Price" />
          <FilterChips presets={VOL_PRESETS}   value={volFilter}   onChange={setVolFilter}   label="Avg Vol" />
          {filtersActive && (
            <button className={styles.filterReset} onClick={() => {
              setMcFilter('all'); setPriceFilter('all'); setVolFilter('all')
            }}>
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      <div className={styles.earningsList}>
        {/* BMO */}
        <div className={styles.timingSection}>
          <div className={`${styles.sectionLabel} ${styles.bmoLabel}`}>
            ▲ Before Market Open — {bmo.length}{filtersActive && rawBmo.length !== bmo.length ? `/${rawBmo.length}` : ''} reporters
          </div>
          {bmo.length === 0 ? (
            <div className={styles.emptyBucket}>
              {filtersActive && rawBmo.length > 0 ? 'No reporters match filters' : 'No reporters'}
            </div>
          ) : (
            <>
              <GridHeader />
              {bmo.map(e => (
                <TickerRow
                  key={e.sym}
                  entry={e}
                  reaction={reactions?.[e.sym]}
                  onClick={() => onSelectEntry(e, 'BEFORE MARKET OPEN')}
                />
              ))}
            </>
          )}
        </div>

        {/* AMC */}
        <div className={styles.timingSection}>
          <div className={`${styles.sectionLabel} ${styles.amcLabel}`}>
            ▼ After Market Close — {amc.length}{filtersActive && rawAmc.length !== amc.length ? `/${rawAmc.length}` : ''} reporters
          </div>
          {amc.length === 0 ? (
            <div className={styles.emptyBucket}>
              {filtersActive && rawAmc.length > 0 ? 'No reporters match filters' : 'No reporters'}
            </div>
          ) : (
            <>
              <GridHeader />
              {amc.map(e => (
                <TickerRow
                  key={e.sym}
                  entry={e}
                  reaction={reactions?.[e.sym]}
                  onClick={() => onSelectEntry(e, 'AFTER MARKET CLOSE')}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Economic events panel ──────────────────────────────────────────────────────

function EconPanel({ days, weekDates }) {
  return (
    <div className={styles.econPanel}>
      <div className={styles.econHeader}>
        <div className={styles.panelLabel}>Macro Events — Full Week</div>
      </div>
      <div className={styles.econList}>
        {weekDates.map(ds => {
          const d = days[ds]
          if (!d) return null
          const econ = d.econ || []
          const fed  = d.fed  || []
          const hasEvents = econ.length > 0 || fed.length > 0

          return (
            <div key={ds} className={styles.econDay}>
              <div className={[
                styles.econDayHeader,
                d.is_today ? styles.econDayToday : '',
              ].filter(Boolean).join(' ')}>
                {d.label}
                {d.is_today && <span className={styles.econTodayBadge}>TODAY</span>}
              </div>

              {!hasEvents && (
                <div className={styles.econEmpty}>No major events</div>
              )}

              {econ.map((ev, i) => (
                <div key={i} className={styles.econEvent}>
                  <span className={styles.econTime}>{ev.time || '—'}</span>
                  {ev.is_key ? (
                    <span className={styles.econStar}>★</span>
                  ) : (
                    <span className={styles.econStar} style={{ opacity: 0 }}>★</span>
                  )}
                  <span className={[
                    styles.econEventName,
                    ev.is_key ? styles.econEventNameKey : '',
                  ].filter(Boolean).join(' ')}>
                    {ev.event}
                  </span>
                  {(ev.actual || ev.estimate || ev.prior) && (
                    <span className={styles.econMeta}>
                      {ev.actual && (
                        <span className={styles.econActual}>A: {ev.actual}</span>
                      )}
                      {ev.estimate && (
                        <span>{ev.actual ? ' · ' : ''}est {ev.estimate}</span>
                      )}
                      {ev.prior && (
                        <span> · prev {ev.prior}</span>
                      )}
                    </span>
                  )}
                </div>
              ))}

              {fed.map((ev, i) => (
                <div key={`fed-${i}`} className={styles.fedEvent}>
                  <span className={styles.fedTime}>{ev.time || '—'}</span>
                  <span className={styles.econStar} style={{ opacity: 0 }}>★</span>
                  <span className={styles.fedEventName}>{ev.event}</span>
                  {ev.note && <span className={styles.fedNote}>{ev.note}</span>}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Calendar() {
  const { data, error } = useSWR('/api/calendar', fetcher, {
    refreshInterval: 5 * 60 * 1000,
    revalidateOnFocus: false,
  })

  const [selected, setSelected] = useState(null)   // { row, label }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.error}>Failed to load calendar data</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading calendar…</div>
      </div>
    )
  }

  const weekDates = data.week_start
    ? (() => {
        const dates = []
        const start = new Date(data.week_start + 'T00:00:00')
        for (let i = 0; i < 5; i++) {
          const d = new Date(start)
          d.setDate(start.getDate() + i)
          dates.push(d.toISOString().slice(0, 10))
        }
        return dates
      })()
    : Object.keys(data.days || {}).sort()

  const weekLabel = data.week_start && data.week_end
    ? `Week of ${fmtWeekRange(data.week_start, data.week_end)}`
    : ''

  const sourceLabel = data.source === 'wire' ? 'WIRE' : data.source === 'live' ? 'LIVE' : null

  return (
    <>
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <span className={styles.pageTitle}>Calendar</span>
          {weekLabel && <span className={styles.weekRange}>{weekLabel}</span>}
          {sourceLabel && (
            <span className={[
              styles.sourceBadge,
              data.source === 'wire' ? styles.sourceWire : styles.sourceLive,
            ].join(' ')}>
              {sourceLabel}
            </span>
          )}
        </div>
        <div className={styles.body}>
          <EarningsPanel
            days={data.days}
            weekDates={weekDates}
            onSelectEntry={(entry, timingLabel) =>
              setSelected({ row: toModalRow(entry), label: timingLabel })
            }
          />
          <EconPanel days={data.days} weekDates={weekDates} />
        </div>
      </div>

      {selected && (
        <ErrorBoundary
          fallback={<div style={{ color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'monospace', padding: '12px' }}>Unable to load — click a ticker to retry.</div>}
          key={selected.row.sym}
        >
          <EarningsModal
            row={selected.row}
            label={selected.label}
            onClose={() => setSelected(null)}
          />
        </ErrorBoundary>
      )}
    </>
  )
}

function fmtWeekRange(start, end) {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end   + 'T00:00:00')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (s.getMonth() === e.getMonth()) {
    return `${months[s.getMonth()]} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`
  }
  return `${months[s.getMonth()]} ${s.getDate()} – ${months[e.getMonth()]} ${e.getDate()}, ${s.getFullYear()}`
}
