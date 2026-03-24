// app/src/pages/Calendar.jsx
import { useState } from 'react'
import useSWR from 'swr'
import TickerPopup from '../components/TickerPopup'
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

function pillClass(v, styles) {
  if (v === 'beat') return `${styles.verdictPill} ${styles.pillBeat}`
  if (v === 'miss') return `${styles.verdictPill} ${styles.pillMiss}`
  if (v === 'meet') return `${styles.verdictPill} ${styles.pillMixed}`
  if (v === 'reported') return `${styles.verdictPill} ${styles.pillMixed}`
  return `${styles.verdictPill} ${styles.pillPending}`
}

function pillLabel(v) {
  if (v === 'beat') return 'Beat'
  if (v === 'miss') return 'Miss'
  if (v === 'meet') return '≈'
  if (v === 'reported') return 'Rptd'
  return null
}

function epsActClass(v, eps_est, styles) {
  if (v == null || eps_est == null) return styles.epsAct
  if (v > eps_est) return `${styles.epsAct} ${styles.epsPos}`
  if (v < eps_est) return `${styles.epsAct} ${styles.epsNeg}`
  return `${styles.epsAct} ${styles.epsMixed}`
}

// ── Earnings ticker row ────────────────────────────────────────────────────────

function TickerRow({ entry, reaction }) {
  const v = verdict(entry.eps_act, entry.eps_est)
  const pill = pillLabel(v)
  const actFmt = fmtEps(entry.eps_act)
  const estFmt = fmtEps(entry.eps_est)
  const revActFmt = fmtRev(entry.rev_act)
  const revEstFmt = fmtRev(entry.rev_est)

  const reactionPct = reaction != null ? reaction : null
  const reactionFmt = reactionPct != null
    ? `${reactionPct >= 0 ? '+' : ''}${reactionPct.toFixed(1)}%`
    : null

  return (
    <div className={styles.tickerRow}>
      <TickerPopup sym={entry.sym} />
      <div className={styles.epsMeta}>
        {/* EPS */}
        {entry.eps_act != null ? (
          <>
            <span className={epsActClass(entry.eps_act, entry.eps_est, styles)}>
              {actFmt}
            </span>
            {entry.eps_est != null && (
              <span className={styles.epsEst}>vs {estFmt}</span>
            )}
          </>
        ) : estFmt ? (
          <span className={styles.epsEst}>{estFmt} est</span>
        ) : null}
        {/* Revenue */}
        {(revActFmt || revEstFmt) && (
          <span className={styles.revSep}>·</span>
        )}
        {revActFmt ? (
          <span className={styles.revAct}>{revActFmt} rev</span>
        ) : revEstFmt ? (
          <span className={styles.revEst}>{revEstFmt} rev</span>
        ) : null}
      </div>
      {/* Live price reaction (Massive, 30s) — only for reported tickers */}
      {reactionFmt && (
        <span className={reactionPct >= 0 ? styles.reactionPos : styles.reactionNeg}>
          {reactionFmt}
        </span>
      )}
      {pill && (
        <span className={pillClass(v, styles)}>{pill}</span>
      )}
    </div>
  )
}

// ── Earnings panel ─────────────────────────────────────────────────────────────

function EarningsPanel({ days, weekDates }) {
  const [activeDate, setActiveDate] = useState(() => {
    // Default to today if in week, else Monday
    const today = new Date().toISOString().slice(0, 10)
    return weekDates.includes(today) ? today : weekDates[0]
  })

  // Live price reactions for reported tickers on the active date (Massive, 30s)
  const { data: reactions } = useSWR(
    `/api/calendar/reactions?date=${activeDate}`,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false }
  )

  const dayData = days[activeDate] || {}
  const bmo = dayData.bmo || []
  const amc = dayData.amc || []

  return (
    <div className={styles.earningsPanel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelLabel}>Earnings Calendar</div>
        <div className={styles.dayTabs}>
          {weekDates.map(ds => {
            const d = days[ds]
            if (!d) return null
            const isActive = ds === activeDate
            const isToday = d.is_today
            return (
              <button
                key={ds}
                className={[
                  styles.dayTab,
                  isActive ? styles.dayTabActive : '',
                  isToday ? styles.dayTabToday : '',
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
            bmo.map(e => <TickerRow key={e.sym} entry={e} reaction={reactions?.[e.sym]} />)
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
            amc.map(e => <TickerRow key={e.sym} entry={e} reaction={reactions?.[e.sym]} />)
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
        <EarningsPanel days={data.days} weekDates={weekDates} />
        <EconPanel     days={data.days} weekDates={weekDates} />
      </div>
    </div>
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
