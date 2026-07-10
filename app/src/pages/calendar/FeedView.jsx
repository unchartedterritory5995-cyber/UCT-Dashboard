// app/src/pages/calendar/FeedView.jsx
import { useMemo, useState } from 'react'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import CompanyLogo from '../../components/CompanyLogo'
import EarningsCard from './EarningsCard'
import MainEventCard from './MainEventCard'
import CalendarDayTable from './CalendarDayTable'
import EventCard from './EventCard'
import MacroBand from './MacroBand'
import { applyFilters, sortEntries } from './filterLogic'
import { impEff } from './importance'
import { useReactions } from './useCalendarData'
import { DEFAULT_EVENT_TYPES } from './CalendarHeader'
import UIcon from '../../components/ui/UIcon'
import styles from './Calendar.module.css'

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

  // ── Tier partition (the hierarchy algorithm, computed once per week in
  //    Calendar.jsx). Fallback when tiers are absent: everything → table. ──
  const { mainEntry, featuredEntries, tableEntries, compactEntries } = useMemo(() => {
    const t = tiers || { mainEvent: null, featured: new Set(), table: null, compact: new Set(), impBySym: new Map() }
    const impOf = e => impEff(t.impBySym?.get?.(e.sym) ?? 0, e)
    let main = null
    const feat = []
    const tab = []
    const comp = []
    for (const e of entries) {
      if (t.mainEvent && e.sym === t.mainEvent) main = e
      else if (t.featured?.has(e.sym)) feat.push(e)
      else if (t.compact?.has(e.sym)) comp.push(e)
      else tab.push(e)
    }
    // Featured ordered by personalized importance; the table keeps the user's
    // chosen sort EXCEPT the default 'mine' sort, where importance rules.
    feat.sort((a, b) => impOf(b) - impOf(a))
    if (!filters.sort || filters.sort === 'mine') {
      tab.sort((a, b) => (b.mine === true) - (a.mine === true) || impOf(b) - impOf(a))
    }
    return { mainEntry: main, featuredEntries: feat, tableEntries: tab, compactEntries: comp }
  }, [entries, tiers, filters.sort])

  const hasEarnings = entries.length > 0
  const hasMacro    = !!(day.econ?.length || day.fed?.length)
  const hasEvents   = ipoEvents.length > 0 || divEvents.length > 0

  if (!hasEarnings && !hasMacro && !hasEvents) return null

  const mineN = entries.filter(e => e.mine).length
  const pulseSym = pulse && pulse.ds === ds ? pulse.sym : null
  return (
    <div className={styles.daygrp} id={`day-${ds}`}>
      <div className={styles.dayhd}>
        <span className={styles.d1}>{(day.label || ds).toUpperCase()}</span>
        <span className={styles.d2}>
          {entries.length} {entries.length === 1 ? 'company reporting' : 'companies reporting'}
        </span>
        <span className={styles.ln} />
        {mineN > 0 && <span className={styles.mineN}>{mineN} of yours</span>}
      </div>
      <MacroBand econ={day.econ} fed={day.fed} />

      {/* Print Tape — today's market-wide scoreboard during the print window */}
      {day.is_today && inPrintWindow() && (
        <PrintTape entries={entries} reactions={reactions} onSelect={onSelect} />
      )}

      {/* The curated lead — exactly one, only when the day earns it */}
      {mainEntry && (
        <div className={styles.mainEventWrap}>
          <MainEventCard
            entry={mainEntry}
            timing={mainEntry._timing}
            livePrice={prices[mainEntry.sym]?.price}
            reaction={reactions?.[mainEntry.sym]}
            hasKeyMacro={!!day.econ?.some(ev => ev.is_key)}
            onSelect={onSelect}
            pulsed={pulseSym === mainEntry.sym}
          />
        </div>
      )}

      {/* Featured strip — mine + megacaps + top importance, session chips on card */}
      {featuredEntries.length > 0 && (
        <div className={styles.cards}>
          {featuredEntries.map(e => (
            <EarningsCard key={`feat-${e.sym}`} entry={e} timing={e._timing}
              livePrice={prices[e.sym]?.price}
              liveSnap={prices[e.sym] ?? null}
              reaction={reactions?.[e.sym]}
              pulsed={pulseSym === e.sym}
              onSelect={onSelect} />
          ))}
        </div>
      )}

      {/* The density engine — every remaining name with data, 36px rows */}
      <CalendarDayTable entries={tableEntries} onSelect={onSelect} />

      <CompactCluster entries={compactEntries} onSelect={onSelect} />

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

// ── Print Tape ───────────────────────────────────────────────────────────────
// After the close (and pre-open for BMO), today's board leads with a
// market-wide scoreboard of what just reported, sorted by |surprise|. No
// competitor reflows the calendar itself in real time. Pure client-side.
function inPrintWindow() {
  try {
    const h = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', hour12: false,
    })
    // WebKit renders midnight as "24" with hour12:false — normalize to 0 so the
    // 00:00-00:59 hour stays OUT of the window (24 >= 16 would wrongly admit it).
    const hour = parseInt(h, 10) % 24
    return hour >= 16 || (hour >= 6 && hour < 10)   // post-close OR pre-open
  } catch { return false }
}

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
          No companies reporting this week{filters.audience !== 'all' ? ' in this view — try All ($300M+)' : ''}.
        </div>
      )}
    </div>
  )
}
