// app/src/pages/calendar/FeedView.jsx
import { useMemo, useState } from 'react'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import CompanyLogo from '../../components/CompanyLogo'
import EarningsCard from './EarningsCard'
import MainEventCard from './MainEventCard'
import CalendarDayTable from './CalendarDayTable'
import EventCard from './EventCard'
import EarningsTile from './EarningsTile'
import MacroBand from './MacroBand'
import { applyFilters, sortEntries } from './filterLogic'
import { impEff } from './importance'
import { useReactions } from './useCalendarData'
import { DEFAULT_EVENT_TYPES } from './CalendarHeader'
import { inPrintWindow } from './calendarTime'
import UIcon from '../../components/ui/UIcon'
import styles from './Calendar.module.css'

// Session groups, EarningsHub-style: a clean pill header + a tile gallery.
const TILE_SESSIONS = [
  ['bmo', 'Before Open', 'sun'],
  ['amc', 'After Close', 'moon'],
  ['tbd', 'Time TBD',    'clock'],
]

function DayGroup({ ds, day, filters, onSelect, eventTypes, iposForDay, dividendsForDay, pulse, tiers }) {
  // Memoize the session lists so the entries useMemo dep-check isn't always
  // invalidated by freshly-mapped arrays on every parent render.
  const bmo = useMemo(
    () => (day.bmo || []).map(e => ({ ...e, _timing: 'bmo' })),
    [day.bmo],
  )
  const amc = useMemo(
    () => (day.amc || []).map(e => ({ ...e, _timing: 'amc' })),
    [day.amc],
  )
  const tbd = useMemo(
    () => (day.tbd || []).map(e => ({ ...e, _timing: 'tbd' })),
    [day.tbd],
  )

  // Metrics (price/avg_vol/mc_b) are merged UPSTREAM in Calendar.jsx via the
  // week batch — they must exist before tiering, so DayGroup no longer fetches
  // its own copy (was one request per day + a rank-after-render bug).
  const entries = useMemo(() => {
    let all = [...bmo, ...amc, ...tbd]
    all = applyFilters(all, filters)
    all = sortEntries(all, filters.sort)
    return all
  }, [bmo, amc, tbd, filters])

  const syms = useMemo(() => entries.map(e => e.sym), [entries])
  const { prices } = useRealtimePrices(syms)
  const { data: reactions } = useReactions(ds)

  // B3: effective event types (default set when prop not provided)
  const activeTypes = eventTypes || DEFAULT_EVENT_TYPES

  // B3: IPO events for this day (only when chip is on)
  const ipoEvents = useMemo(() => {
    if (!activeTypes.has('ipos') || !iposForDay) return []
    return iposForDay.map(ev => ({ ...ev, type: 'ipo' }))
  }, [activeTypes, iposForDay])

  // B3: dividend + split events for this day (only when chip is on)
  const divEvents = useMemo(() => {
    if (!activeTypes.has('dividends') || !dividendsForDay) return []
    return dividendsForDay
  }, [activeTypes, dividendsForDay])

  // ── Flat ordering: one uniform list, no tiers. Mine pinned first, then
  //    personalized importance (default sort); an explicit sort choice wins.
  //    (CalendarDayTable handles the BMO/AMC session grouping internally.) ──
  const orderedEntries = useMemo(() => {
    const impOf = e => impEff(tiers?.impBySym?.get?.(e.sym) ?? 0, e)
    if (!filters.sort || filters.sort === 'mine') {
      return [...entries].sort((a, b) => (b.mine === true) - (a.mine === true) || impOf(b) - impOf(a))
    }
    return entries
  }, [entries, tiers, filters.sort])

  // Macro (Fed speakers / econ prints) is opt-in — it's not earnings, and by
  // default it was just noise on an earnings calendar. Off unless the user turns
  // the Macro chip on in Filters.
  const showMacro = activeTypes.has('macro')
  const hasEarnings = entries.length > 0
  const hasMacro    = showMacro && !!(day.econ?.length || day.fed?.length)
  const hasEvents   = ipoEvents.length > 0 || divEvents.length > 0

  if (!hasEarnings && !hasMacro && !hasEvents) return null

  // Macro-only day → one dim collapsed line (only when macro is on).
  if (!hasEarnings && !hasEvents && hasMacro) {
    return <MacroOnlyDay ds={ds} day={day} />
  }

  const mineN = entries.filter(e => e.mine).length
  const pulseSym = pulse && pulse.ds === ds ? pulse.sym : null
  return (
    <div className={styles.daygrp} id={`day-${ds}`}>
      <div className={styles.dayhd}>
        <span className={styles.d1}>{(day.label || ds).toUpperCase()}</span>
        {entries.length > 0 && <span className={styles.d2}>{entries.length}</span>}
        <span className={styles.ln} />
        {mineN > 0 && (
          <span className={styles.mineN}>
            <UIcon name="star-fill" size={9} style={{ verticalAlign: '-1px', marginRight: 3 }} />{mineN}
          </span>
        )}
      </div>
      {hasMacro && <MacroBand econ={day.econ} fed={day.fed} />}

      {/* Logo-tile gallery (EarningsHub-style): the company logo IS the content.
          Session-grouped, importance-ordered, minimal text — click for detail. */}
      {TILE_SESSIONS.map(([key, label, icon]) => {
        const rows = orderedEntries.filter(e => (e._timing || 'tbd') === key)
        if (!rows.length) return null
        return (
          <div key={key} className={styles.tileSession}>
            <div className={styles.tileSessionHd}>
              <UIcon name={icon} size={12} style={{ verticalAlign: '-1px', marginRight: 6 }} />
              {label}<span className={styles.tileSessionN}>{rows.length}</span>
            </div>
            <div className={styles.etileGrid}>
              {rows.map(e => <EarningsTile key={`${key}-${e.sym}`} e={e} onSelect={onSelect} />)}
            </div>
          </div>
        )
      })}

      {/* B3: IPO + dividend/split event cards (no BMO/AMC timing) */}
      {hasEvents && (
        <div className={styles.cards}>
          {ipoEvents.map((ev, i) => (
            <EventCard key={`ipo-${ev.sym || i}`} event={ev} />
          ))}
          {divEvents.map((ev, i) => (
            <EventCard key={`div-${ev.sym}-${ev.type}-${i}`} event={ev} />
          ))}
        </div>
      )}
    </div>
  )
}

// Macro-only day: a single dim, expandable line. Collapses the "0 companies
// reporting" noise while keeping the Fed/econ events one click away.
function MacroOnlyDay({ ds, day }) {
  const [open, setOpen] = useState(!!day.is_today)
  const count = (day.econ?.length || 0) + (day.fed?.length || 0)
  return (
    <div className={styles.macroOnly} id={`day-${ds}`}>
      <button className={styles.macroOnlyToggle} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={styles.macroOnlyLbl}>{(day.label || ds).toUpperCase()}</span>
        <span className={styles.macroOnlyMeta}>
          no earnings · {count} macro {count === 1 ? 'event' : 'events'}
        </span>
        <span className={styles.macroOnlyChev} aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && <MacroBand econ={day.econ} fed={day.fed} />}
    </div>
  )
}

// ── Print Tape ───────────────────────────────────────────────────────────────
// After the close (and pre-open for BMO), today's board leads with a
// market-wide scoreboard of what just reported, sorted by |surprise|. No
// competitor reflows the calendar itself in real time. Pure client-side.
function PrintTape({ entries, reactions, onSelect }) {
  const reported = useMemo(() => {
    const withActual = entries.filter(e => e.eps_act != null)
    const surp = e => {
      if (e.eps_est == null || e.eps_est === 0) return 0
      return Math.abs((e.eps_act - e.eps_est) / e.eps_est)
    }
    return [...withActual].sort((a, b) => surp(b) - surp(a)).slice(0, 12)
  }, [entries])
  if (!reported.length) return null
  const surprise = (a, e) => (a == null || e == null || e === 0)
    ? null : ((a - e) / Math.abs(e)) * 100
  return (
    <div className={styles.printTape}>
      <div className={styles.printTapeHd}>
        <UIcon name="bolt" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        Print Tape<span className={styles.printTapeCap}>· just reported, biggest surprise first</span>
      </div>
      <div className={styles.printTapeRows}>
        {reported.map(e => {
          const s = surprise(e.eps_act, e.eps_est)
          const gap = reactions?.[e.sym]
          const beat = s == null ? null : s >= 0
          return (
            <button key={`pt-${e.sym}`} className={styles.printRow}
                    onClick={() => onSelect?.(e, e._timing)}>
              <CompanyLogo sym={e.sym} size={18} tile />
              <span className={styles.printSym}>{e.sym}</span>
              {beat != null && (
                <span className={beat ? styles.printBeat : styles.printMiss}>
                  {beat ? 'BEAT' : 'MISS'}{s != null && ` ${s >= 0 ? '+' : ''}${s.toFixed(0)}%`}
                </span>
              )}
              {gap != null && (
                <span className={gap >= 0 ? styles.pos : styles.neg}>
                  {gap >= 0 ? '▲ +' : '▼ '}{gap.toFixed(1)}%
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Collapsed strip for zero-data reporters: "Also reporting (12) ▸" expands to
// compact logo+ticker+session lines. Clicking a line still opens the modal.
function CompactCluster({ entries, onSelect }) {
  const [open, setOpen] = useState(false)
  if (!entries.length) return null
  const glyph = t => t === 'bmo' ? 'BMO' : t === 'amc' ? 'AMC' : 'TBD'
  return (
    <div className={styles.compactWrap}>
      <button className={styles.compactToggle} onClick={() => setOpen(o => !o)}
              aria-expanded={open}>
        Also reporting ({entries.length}) <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className={styles.compactList}>
          {entries.map(e => (
            <div key={`c-${e.sym}`} className={styles.compactRow}
                 onClick={() => onSelect?.(e, e._timing)}>
              <CompanyLogo sym={e.sym} size={20} tile />
              <span className={styles.compactSym}>{e.sym}</span>
              {e.name && <span className={styles.compactName}>{e.name}</span>}
              <span className={styles.compactGlyph}>{glyph(e._timing)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function FeedView({ weekDates, days, filters, onSelect, eventTypes, iposByDate, dividendsByDate, pulse, weekTiers }) {
  // Empty-state check uses the FILTERED view of each day — checking the raw
  // payload rendered a blank feed with no message when the audience filter
  // hid everything (each DayGroup nulls itself on filtered emptiness). Metric
  // filters needing per-day price data are approximated here (that data lives
  // inside DayGroup), which at worst delays the message one render.
  const anyContent = weekDates.some(ds => {
    const d = days[ds]
    if (!d) return false
    if (d.econ?.length || d.fed?.length) return true
    const all = [
      ...(d.bmo || []).map(e => ({ ...e, _timing: 'bmo' })),
      ...(d.amc || []).map(e => ({ ...e, _timing: 'amc' })),
      ...(d.tbd || []).map(e => ({ ...e, _timing: 'tbd' })),
    ]
    return applyFilters(all, filters).length > 0
  })
  return (
    <div className={styles.feed}>
      {weekDates.map(ds => days[ds]
        ? <DayGroup
            key={ds}
            ds={ds}
            day={days[ds]}
            filters={filters}
            onSelect={onSelect}
            eventTypes={eventTypes}
            iposForDay={iposByDate?.[ds] || null}
            dividendsForDay={dividendsByDate?.[ds] || null}
            pulse={pulse}
            tiers={weekTiers?.[ds]}
          /> : null)}
      {!anyContent && (
        <div className={styles.feedEmpty}>
          No companies reporting this week{filters.audience !== 'all' ? ' in this view — try the All filter' : ''}.
        </div>
      )}
    </div>
  )
}
