// app/src/pages/calendar/WeekView.jsx
import CompanyLogo from '../../components/CompanyLogo'
import { applyFilters, sortEntries } from './filterLogic'
import styles from './Calendar.module.css'

export default function WeekView({ weekDates, days, filters, onSelect }) {
  return (
    <div className={styles.weekgrid}>
      {weekDates.map(ds => {
        const day = days[ds]; if (!day) return null
        const rows = sortEntries(applyFilters(
          [...(day.bmo||[]).map(e=>({...e,_timing:'bmo'})),
           ...(day.amc||[]).map(e=>({...e,_timing:'amc'}))], filters), filters.sort)
        return (
          <div key={ds} className={`${styles.wcol} ${day.is_today ? styles.wcolToday : ''}`}>
            <div className={styles.wd}>{day.label || ds}</div>
            {rows.map(e => (
              <div key={e.sym} className={styles.wrow} onClick={() => onSelect(e, e._timing)}>
                <CompanyLogo sym={e.sym} size={20} />
                <span className={`${styles.t} ${e.mine ? styles.gold : ''}`}>{e.sym}</span>
                <span className={styles.v}>{e._timing.toUpperCase()}</span>
              </div>
            ))}
            {!rows.length && <div className={styles.emptyBucket}>—</div>}
          </div>
        )
      })}
    </div>
  )
}
