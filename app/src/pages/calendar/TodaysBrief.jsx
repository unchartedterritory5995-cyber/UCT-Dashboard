// app/src/pages/calendar/TodaysBrief.jsx
// The retention moat: a five-second personal answer pinned atop the Board.
// YOUR REPORTS (your names printing today/tomorrow, with POSITION/WATCHLIST
// badges no competitor shows live) · REPORTED (your verdicts since yesterday's
// close) · MACRO TODAY. Pure client-side join over data the page already has —
// zero new endpoints. Board + current week only.
import { useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import CompanyLogo from '../../components/CompanyLogo'
import UIcon from '../../components/ui/UIcon'
import { useReactions } from './useCalendarData'
import styles from './Calendar.module.css'

const DISMISS_KEY = 'uct.calendar.brief.dismissed'

// _sources → the single most meaningful badge (a broker POSITION outranks a
// watch). Positions get the gold treatment; everything else is a dim tag.
function sourceBadge(sources) {
  if (!sources || !sources.length) return null
  if (sources.includes('positions')) return { label: 'POSITION', gold: true }
  if (sources.includes('watchlist') || sources.includes('flagged')) return { label: 'WATCHLIST', gold: false }
  if (sources.includes('uct20')) return { label: 'UCT20', gold: false }
  return null
}

function sessionPhrase(timing, isToday) {
  const when = isToday ? 'today' : 'tomorrow'
  if (timing === 'bmo') return `${when} · before open`
  if (timing === 'amc') return `${when} · after close`
  return `${when} · time TBD`
}

export default function TodaysBrief({ days, weekDates, todayIso, onSelect }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })
  const dismiss = useCallback(() => {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
    setDismissed(true)
  }, [])

  // today + tomorrow ISO within the loaded week
  const tomorrowIso = useMemo(() => {
    const idx = weekDates.indexOf(todayIso)
    return idx >= 0 && idx + 1 < weekDates.length ? weekDates[idx + 1] : null
  }, [weekDates, todayIso])

  const { data: reactions } = useReactions(weekDates.includes(todayIso) ? todayIso : null)

  const entriesFor = useCallback((ds) => {
    const d = days[ds]
    if (!d) return []
    return [
      ...(d.bmo || []).map(e => ({ ...e, _timing: 'bmo' })),
      ...(d.amc || []).map(e => ({ ...e, _timing: 'amc' })),
      ...(d.tbd || []).map(e => ({ ...e, _timing: 'tbd' })),
    ]
  }, [days])

  // YOUR REPORTS — mine names printing today/tomorrow that haven't reported yet
  const yourReports = useMemo(() => {
    const out = []
    for (const [ds, isToday] of [[todayIso, true], [tomorrowIso, false]]) {
      if (!ds) continue
      for (const e of entriesFor(ds)) {
        if (e.mine && e.eps_act == null) out.push({ ...e, _isToday: isToday })
      }
    }
    // positions first, then watchlist/uct20; cap so the rail stays a glance
    return out.sort((a, b) =>
      (b._sources?.includes('positions') ? 1 : 0) - (a._sources?.includes('positions') ? 1 : 0)
    ).slice(0, 12)
  }, [entriesFor, todayIso, tomorrowIso])

  // REPORTED — mine names that already printed this week, newest day first
  const reportedMine = useMemo(() => {
    const out = []
    for (const ds of [...weekDates].reverse()) {
      for (const e of entriesFor(ds)) {
        if (e.mine && e.eps_act != null) out.push({ ...e, _ds: ds })
      }
    }
    return out.slice(0, 8)
  }, [entriesFor, weekDates])

  // MACRO TODAY — key econ + fed speakers on today
  const macroToday = useMemo(() => {
    const d = days[todayIso]
    if (!d) return []
    const econ = (d.econ || []).filter(ev => ev.is_key)
    const fed = (d.fed || []).map(ev => ({ ...ev, _fed: true }))
    return [...econ, ...fed].slice(0, 4)
  }, [days, todayIso])

  const surprise = (a, e) => {
    if (a == null || e == null || e === 0) return null
    return ((a - e) / Math.abs(e)) * 100
  }

  const hasContent = yourReports.length || reportedMine.length || macroToday.length
  if (!hasContent) {
    if (dismissed) return null
    return (
      <div className={styles.briefEmpty}>
        <span>Star names or connect your broker to build your brief.</span>
        <Link to="/calendar/mystocks" className={styles.briefEmptyLink}>Open Hub →</Link>
        <button className={styles.briefDismiss} onClick={dismiss} aria-label="Dismiss">
          <UIcon name="x" size={12} />
        </button>
      </div>
    )
  }

  return (
    <div className={styles.brief} aria-label="Today's brief">
      {yourReports.length > 0 && (
        <div className={styles.briefCluster}>
          <div className={styles.briefLbl}>Your reports</div>
          <div className={styles.briefScroll}>
            {yourReports.map(e => {
              const badge = sourceBadge(e._sources)
              return (
                <button key={`yr-${e.sym}`} className={styles.briefCard}
                        onClick={() => onSelect?.(e, e._timing)}>
                  <CompanyLogo sym={e.sym} size={24} tile />
                  <span className={styles.briefSym}>{e.sym}</span>
                  <span className={styles.briefWhen}>{sessionPhrase(e._timing, e._isToday)}</span>
                  {badge && (
                    <span className={badge.gold ? styles.briefBadgeGold : styles.briefBadge}>
                      {badge.label}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {reportedMine.length > 0 && (
        <div className={styles.briefCluster}>
          <div className={styles.briefLbl}>Reported</div>
          <div className={styles.briefScroll}>
            {reportedMine.map(e => {
              const s = surprise(e.eps_act, e.eps_est)
              const gap = e._ds === todayIso ? reactions?.[e.sym] : null
              const beat = s == null ? null : s >= 0
              return (
                <button key={`rp-${e.sym}`}
                        className={`${styles.briefChip} ${beat === false ? styles.briefChipMiss : beat ? styles.briefChipBeat : ''}`}
                        onClick={() => onSelect?.(e, e._timing || 'amc')}>
                  <span className={styles.briefSym}>{e.sym}</span>
                  {beat != null && <span>{beat ? 'BEAT' : 'MISS'}</span>}
                  {gap != null && (
                    <span className={gap >= 0 ? styles.pos : styles.neg}>
                      {gap >= 0 ? '+' : ''}{gap.toFixed(1)}%
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {macroToday.length > 0 && (
        <div className={styles.briefCluster}>
          <div className={styles.briefLbl}>Macro today</div>
          <div className={styles.briefScroll}>
            {macroToday.map((ev, i) => (
              <span key={`mc-${i}`} className={styles.briefMacro}>
                {ev._fed && <UIcon name="mic" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />}
                <span className={styles.briefMacroTm}>{ev.time || ''}</span> {ev.event}
                {ev.estimate && <span className={styles.briefMacroEst}> · est {ev.estimate}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
