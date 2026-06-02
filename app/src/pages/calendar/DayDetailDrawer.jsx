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
  const rows = [...(day.bmo||[]).map(e=>({...e,_timing:'bmo'})),
               ...(day.amc||[]).map(e=>({...e,_timing:'amc'}))]
  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <div className={styles.drawer} onClick={e => e.stopPropagation()}>
        <div className={styles.drawerHd}>{day.label || ds}<button onClick={onClose}>✕</button></div>
        <MacroBand econ={day.econ} fed={day.fed} />
        <div className={styles.cards}>
          {rows.map(e => <EarningsCard key={e.sym} entry={e} timing={e._timing} onSelect={onSelect} />)}
        </div>
      </div>
    </div>
  )
}
