// app/src/pages/calendar/FeedView.jsx
import { useMemo } from 'react'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import EarningsCard from './EarningsCard'
import EventCard from './EventCard'
import MacroBand from './MacroBand'
import { applyFilters, sortEntries } from './filterLogic'
import { useReactions, useDayMetrics } from './useCalendarData'
import { DEFAULT_EVENT_TYPES } from './CalendarHeader'
import UIcon from '../../components/ui/UIcon'
import styles from './Calendar.module.css'

function DayGroup({ ds, day, filters, onSelect, eventTypes, iposForDay, dividendsForDay, pulse }) {
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

  // A3: fetch per-day metrics (price, avg_vol, mc_b) and merge onto entries
  const { data: metricsMap } = useDayMetrics(ds)
  const entries = useMemo(() => {
    let all = [...bmo, ...amc, ...tbd]
    // Merge _price and _avg_vol from metricsMap (null-safe: if no metric, field stays undefined)
    if (metricsMap) {
      all = all.map(e => {
        const m = metricsMap[e.sym]
        if (!m) return e
        return {
          ...e,
          _price:   m.price   ?? e._price,
          _avg_vol: m.avg_vol ?? e._avg_vol,
          // mc_b already on entry from wire; override only if metricsMap has a better value
          mc_b: e.mc_b ?? m.mc_b,
        }
      })
    }
    all = applyFilters(all, filters)
    all = sortEntries(all, filters.sort)
    return all
  }, [bmo, amc, tbd, metricsMap, filters])

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

  // Split reporters by session so the feed shows the same clear grouping as
  // the month grid. Filtering + sorting already applied above; filter
  // preserves relative order within each session.
  const bmoEntries = useMemo(() => entries.filter(e => e._timing === 'bmo'), [entries])
  const amcEntries = useMemo(() => entries.filter(e => e._timing === 'amc'), [entries])
  const tbdEntries = useMemo(() => entries.filter(e => e._timing === 'tbd'), [entries])

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

      <TimingSection label="Before Open" icon="☀" hdClass={styles.bmoHd}
        entries={bmoEntries} prices={prices} reactions={reactions} onSelect={onSelect}
        pulseSym={pulseSym} />
      <TimingSection label="After Close" icon={<UIcon name="moon" size={14} />} hdClass={styles.amcHd}
        entries={amcEntries} prices={prices} reactions={reactions} onSelect={onSelect}
        pulseSym={pulseSym} />
      <TimingSection label="Time TBD" icon={<UIcon name="clock" size={14} />} hdClass={styles.tbdHd}
        entries={tbdEntries} prices={prices} reactions={reactions} onSelect={onSelect}
        pulseSym={pulseSym} />

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

// One session-grouped section (Before Open / After Close / Time TBD) inside a day group.
function TimingSection({ label, icon, hdClass, entries, prices, reactions, onSelect, pulseSym }) {
  if (!entries.length) return null
  return (
    <div className={styles.timedGroup}>
      <div className={`${styles.timedHd} ${hdClass}`}>
        <span className={styles.timedIcon} aria-hidden="true">{icon}</span>
        {label}
        <span className={styles.timedCount}>{entries.length}</span>
      </div>
      <div className={styles.cards}>
        {entries.map(e => (
          <EarningsCard key={`earn-${e.sym}`} entry={e} timing={e._timing}
            livePrice={prices[e.sym]?.price}
            liveSnap={prices[e.sym] ?? null}
            reaction={reactions?.[e.sym]}
            pulsed={pulseSym === e.sym}
            onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

export default function FeedView({ weekDates, days, filters, onSelect, eventTypes, iposByDate, dividendsByDate, pulse }) {
  const anyContent = weekDates.some(ds => {
    const d = days[ds]
    if (!d) return false
    return (d.bmo?.length || d.amc?.length || d.tbd?.length || d.econ?.length || d.fed?.length)
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
          /> : null)}
      {!anyContent && (
        <div className={styles.feedEmpty}>
          No companies reporting this week{filters.audience !== 'all' ? ' in this view — try All ($300M+)' : ''}.
        </div>
      )}
    </div>
  )
}
