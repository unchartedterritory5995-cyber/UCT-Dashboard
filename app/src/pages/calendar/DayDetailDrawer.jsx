// app/src/pages/calendar/DayDetailDrawer.jsx
import { useEffect } from 'react'
import EarningsCard from './EarningsCard'
import MacroBand from './MacroBand'
import styles from './Calendar.module.css'

export default function DayDetailDrawer({ ds, day, onClose, onSelect }) {
  useEffect(() => {
    const h = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  if (!day) return null
  const bmo = (day.bmo||[]).map(e=>({...e,_timing:'bmo'}))
  const amc = (day.amc||[]).map(e=>({...e,_timing:'amc'}))
  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <div className={styles.drawer} onClick={e => e.stopPropagation()}>
        <div className={styles.drawerHd}>{day.label || ds}<button onClick={onClose}>✕</button></div>
        <MacroBand econ={day.econ} fed={day.fed} />
        <DrawerTimingSection label="Before Open" icon="☀" hdClass={styles.bmoHd} rows={bmo} onSelect={onSelect} />
        <DrawerTimingSection label="After Close" icon="🌙" hdClass={styles.amcHd} rows={amc} onSelect={onSelect} />
      </div>
    </div>
  )
}

function DrawerTimingSection({ label, icon, hdClass, rows, onSelect }) {
  if (!rows.length) return null
  return (
    <div className={styles.timedGroup}>
      <div className={`${styles.timedHd} ${hdClass}`}>
        <span aria-hidden="true">{icon}</span> {label}
        <span className={styles.timedCount}>{rows.length}</span>
      </div>
      <div className={styles.cards}>
        {rows.map(e => <EarningsCard key={e.sym} entry={e} timing={e._timing} onSelect={onSelect} />)}
      </div>
    </div>
  )
}
