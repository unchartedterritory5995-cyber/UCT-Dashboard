// app/src/pages/calendar/FeedView.jsx
import { useMemo } from 'react'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import EarningsCard from './EarningsCard'
import EventCard from './EventCard'
import MacroBand from './MacroBand'
import { applyFilters, sortEntries } from './filterLogic'
import { useReactions, useDayMetrics } from './useCalendarData'
import { DEFAULT_EVENT_TYPES } from './CalendarHeader'
import styles from './Calendar.module.css'

function DayGroup({ ds, day, filters, onSelect, eventTypes, iposForDay, dividendsForDay }) {
  // Memoize bmo/amc so the entries useMemo dep-check isn't always invalidated
  // by freshly-mapped arrays on every parent render.
  const bmo = useMemo(
    () => (day.bmo || []).map(e => ({ ...e, _timing: 'bmo' })),
    [day.bmo],
  )
  const amc = useMemo(
    () => (day.amc || []).map(e => ({ ...e, _timing: 'amc' })),
    [day.amc],
  )

  // A3: fetch per-day metrics (price, avg_vol, mc_b) and merge onto entries
  const { data: metricsMap } = useDayMetrics(ds)
  const entries = useMemo(() => {
    let all = [...bmo, ...amc]
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
  }, [bmo, amc, metricsMap, filters])

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

  const hasEarnings = entries.length > 0
  const hasMacro    = !!(day.econ?.length || day.fed?.length)
  const hasEvents   = ipoEvents.length > 0 || divEvents.length > 0

  if (!hasEarnings && !hasMacro && !hasEvents) return null

  const mineN = entries.filter(e => e.mine).length
  return (
    <div className={styles.daygrp}>
      <div className={styles.dayhd}>
        <span className={styles.d1}>{(day.label || ds).toUpperCase()}</span>
        <span className={styles.d2}>{entries.length} reporters</span>
        <span className={styles.ln} />
        {mineN > 0 && <span className={styles.mineN}>{mineN} of yours</span>}
      </div>
      <MacroBand econ={day.econ} fed={day.fed} />
      <div className={styles.cards}>
        {entries.map(e => (
          <EarningsCard key={`earn-${e.sym}`} entry={e} timing={e._timing}
            livePrice={prices[e.sym]?.price}
            liveSnap={prices[e.sym] ?? null}
            reaction={reactions?.[e.sym]}
            onSelect={onSelect} />
        ))}
        {/* B3: IPO event cards interleaved */}
        {ipoEvents.map((ev, i) => (
          <EventCard key={`ipo-${ev.sym || i}`} event={ev} />
        ))}
        {/* B3: dividend + split event cards interleaved */}
        {divEvents.map((ev, i) => (
          <EventCard key={`div-${ev.sym}-${ev.type}-${i}`} event={ev} />
        ))}
      </div>
    </div>
  )
}

export default function FeedView({ weekDates, days, filters, onSelect, eventTypes, iposByDate, dividendsByDate }) {
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
          /> : null)}
    </div>
  )
}
