// app/src/pages/calendar/FeedView.jsx
import { useMemo } from 'react'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import EarningsCard from './EarningsCard'
import MacroBand from './MacroBand'
import { applyFilters, sortEntries } from './filterLogic'
import { useReactions, useDayMetrics } from './useCalendarData'
import styles from './Calendar.module.css'

function DayGroup({ ds, day, filters, onSelect }) {
  const bmo = (day.bmo || []).map(e => ({ ...e, _timing: 'bmo' }))
  const amc = (day.amc || []).map(e => ({ ...e, _timing: 'amc' }))

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
  if (!entries.length && !(day.econ?.length || day.fed?.length)) return null

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
          <EarningsCard key={e.sym} entry={e} timing={e._timing}
            livePrice={prices[e.sym]?.price} reaction={reactions?.[e.sym]}
            onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

export default function FeedView({ weekDates, days, filters, onSelect }) {
  return (
    <div className={styles.feed}>
      {weekDates.map(ds => days[ds]
        ? <DayGroup key={ds} ds={ds} day={days[ds]} filters={filters}
            onSelect={onSelect} /> : null)}
    </div>
  )
}
