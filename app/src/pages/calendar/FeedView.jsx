// app/src/pages/calendar/FeedView.jsx
import { useMemo } from 'react'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import EarningsCard from './EarningsCard'
import MacroBand from './MacroBand'
import { applyFilters, sortEntries } from './filterLogic'
import styles from './Calendar.module.css'

function DayGroup({ ds, day, filters, onSelect, reactions }) {
  const bmo = (day.bmo || []).map(e => ({ ...e, _timing: 'bmo' }))
  const amc = (day.amc || []).map(e => ({ ...e, _timing: 'amc' }))
  let entries = [...bmo, ...amc]
  entries = applyFilters(entries, filters)
  entries = sortEntries(entries, filters.sort)

  const syms = useMemo(() => entries.map(e => e.sym), [entries])
  const { prices } = useRealtimePrices(syms)
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

export default function FeedView({ weekDates, days, filters, onSelect, reactionsByDate }) {
  return (
    <div className={styles.feed}>
      {weekDates.map(ds => days[ds]
        ? <DayGroup key={ds} ds={ds} day={days[ds]} filters={filters}
            onSelect={onSelect} reactions={reactionsByDate?.[ds]} /> : null)}
    </div>
  )
}
