// app/src/pages/Calendar.jsx
import { useState, useMemo } from 'react'
import useMobileSWR from '../hooks/useMobileSWR'
import useLivePrices from '../hooks/useLivePrices'
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
  if (v == null || eps_est == null) return styles.tdDim
  if (v > eps_est) return `${styles.tdMono} ${styles.epsPos}`
  if (v < eps_est) return `${styles.tdMono} ${styles.epsNeg}`
  return `${styles.tdMono} ${styles.epsMixed}`
}

// Filtering is done server-side via cap_universe ($300M+ tickers).
// No client-side filtering needed — render what the API returns.

// ── Earnings table ────────────────────────────────────────────────────────────

function EarningsTable({ entries, reactions, livePrices, onSelect, label }) {
  if (!entries.length) return null

  return (
    <table className={styles.earningsTable}>
      <thead>
        <tr>
          <th className={styles.thLeft}>Ticker</th>
          <th className={styles.hideOnMobile}>Price</th>
          <th className={styles.hideOnMobile}>EPS Est</th>
          <th className={styles.hideOnMobile}>EPS Act</th>
          <th>Surp %</th>
          <th className={styles.hideOnMobile}>Revenue</th>
          <th>Gap %</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {entries.map(entry => (
          <EarningsRow
            key={entry.sym}
            entry={entry}
            reaction={reactions?.[entry.sym]}
            livePrice={livePrices[entry.sym]?.price}
            onClick={() => onSelect(entry, label)}
          />
        ))}
      </tbody>
    </table>
  )
}

function EarningsRow({ entry, reaction, livePrice, onClick }) {
  const v         = verdict(entry.eps_act, entry.eps_est)
  const pill      = pillLabel(v)
  const reported  = entry.eps_act != null

  const estFmt    = fmtEps(entry.eps_est)   ?? '—'
  const actFmt    = fmtEps(entry.eps_act)   ?? '—'
  const surprFmt  = calcSurprise(entry.eps_act, entry.eps_est)

  const revFmt = entry.rev_act != null
    ? fmtRev(entry.rev_act)
    : entry.rev_est != null
      ? `${fmtRev(entry.rev_est)} est`
      : '—'

  const reactionFmt = reaction != null
    ? `${reaction >= 0 ? '+' : ''}${reaction.toFixed(1)}%`
    : null

  const surprClass = surprFmt == null
    ? styles.reactionNeutral
    : surprFmt.startsWith('+') ? styles.reactionPos : styles.reactionNeg

  const priceFmt = livePrice != null
    ? `$${livePrice.toFixed(2)}`
    : '—'

  return (
    <tr className={styles.earningsRow} onClick={onClick}>
      <td className={styles.tdTicker}><TickerPopup sym={entry.sym} /></td>
      <td className={`${styles.tdMono} ${styles.hideOnMobile}`}>{priceFmt}</td>
      <td className={`${styles.tdDim} ${styles.hideOnMobile}`}>{estFmt}</td>
      <td className={`${reported ? epsActClass(entry.eps_act, entry.eps_est, styles) : styles.tdDim} ${styles.hideOnMobile}`}>
        {reported ? actFmt : '—'}
      </td>
      <td className={surprFmt != null ? surprClass : styles.reactionNeutral}>
        {surprFmt ?? '—'}
      </td>
      <td className={`${styles.tdDim} ${styles.hideOnMobile}`}>{revFmt}</td>
      <td className={reactionFmt ? (reaction >= 0 ? styles.reactionPos : styles.reactionNeg) : styles.reactionNeutral}>
        {reactionFmt ?? '—'}
      </td>
      <td>
        {pill ? (
          <span className={pillClass(v, styles)}>{pill}</span>
        ) : null}
      </td>
    </tr>
  )
}

// ── Earnings panel ─────────────────────────────────────────────────────────────

function EarningsPanel({ days, weekDates, onSelectEntry }) {
  const [activeDate, setActiveDate] = useState(() => {
    const today = new Date().toISOString().slice(0, 10)
    return weekDates.includes(today) ? today : weekDates[0]
  })

  // Live price reactions for reported tickers (30s)
  const { data: reactions } = useMobileSWR(
    `/api/calendar/reactions?date=${activeDate}`,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false, marketHoursOnly: true }
  )

  const dayData = days[activeDate] || {}
  // Filter out entries with zero coverage (no estimates, no actuals = pure noise)
  const _filterNoise = entries => entries.filter(e =>
    e.eps_est != null || e.eps_act != null || e.rev_est != null || e.rev_act != null
  )
  const bmo = _filterNoise(dayData.bmo || [])
  const amc = _filterNoise(dayData.amc || [])

  // Extract tickers for the active day and fetch live prices
  const todayTickers = useMemo(
    () => [...bmo, ...amc].map(e => e.sym),
    [bmo, amc]
  )
  const { prices: livePrices } = useLivePrices(todayTickers)

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
      </div>

      <div className={styles.earningsList}>
        {/* BMO */}
        <div className={styles.timingSection}>
          <div className={`${styles.sectionLabel} ${styles.bmoLabel}`}>
            ▲ Before Market Open — {bmo.length} reporters
          </div>
          {bmo.length === 0 ? (
            <div className={styles.emptyBucket}>No reporters</div>
          ) : (
            <EarningsTable
              entries={bmo}
              reactions={reactions}
              livePrices={livePrices}
              onSelect={onSelectEntry}
              label="BEFORE MARKET OPEN"
            />
          )}
        </div>

        {/* AMC */}
        <div className={styles.timingSection}>
          <div className={`${styles.sectionLabel} ${styles.amcLabel}`}>
            ▼ After Market Close — {amc.length} reporters
          </div>
          {amc.length === 0 ? (
            <div className={styles.emptyBucket}>No reporters</div>
          ) : (
            <EarningsTable
              entries={amc}
              reactions={reactions}
              livePrices={livePrices}
              onSelect={onSelectEntry}
              label="AFTER MARKET CLOSE"
            />
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
  const { data, error } = useMobileSWR('/api/calendar', fetcher, {
    refreshInterval: 2 * 60 * 1000,  // 2 min — pick up reported actuals quickly
    revalidateOnFocus: false,
    marketHoursOnly: true,
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
