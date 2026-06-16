// app/src/pages/calendar/WeekView.jsx
import CompanyLogo from '../../components/CompanyLogo'
import { applyFilters, sortEntries } from './filterLogic'
import styles from './Calendar.module.css'

// One timing-grouped column (BMO left / AMC right) inside a week-day column.
// Always renders its cell so BMO stays in the left grid column and AMC in the
// right column even when the other timing is empty.
function WeekTimingGroup({ label, icon, hdClass, rows, onSelect }) {
  return (
    <div className={styles.wtcol}>
      <div className={`${styles.wgroupHd} ${hdClass}`}>
        <span aria-hidden="true">{icon}</span> {label}
      </div>
      {rows.length ? rows.map(e => (
        <div key={`${e.sym}-${e._timing}`} className={styles.wrow} onClick={() => onSelect(e, e._timing)}>
          <CompanyLogo sym={e.sym} size={64} />
          <span className={`${styles.t} ${e.mine ? styles.gold : ''}`}>{e.sym}</span>
        </div>
      )) : <div className={styles.wtcolEmpty}>—</div>}
    </div>
  )
}

export default function WeekView({ weekDates, days, filters, onSelect }) {
  return (
    <div className={styles.weekgrid}>
      {weekDates.map(ds => {
        const day = days[ds]; if (!day) return null
        const bmo = sortEntries(applyFilters(
          (day.bmo||[]).map(e=>({...e,_timing:'bmo'})), filters), filters.sort)
        const amc = sortEntries(applyFilters(
          (day.amc||[]).map(e=>({...e,_timing:'amc'})), filters), filters.sort)
        const empty = !bmo.length && !amc.length
        return (
          <div key={ds} className={`${styles.wcol} ${day.is_today ? styles.wcolToday : ''}`}>
            <div className={styles.wd}>{day.label || ds}</div>
            {empty ? (
              <div className={styles.emptyBucket}>—</div>
            ) : (
              <div className={styles.wtimings}>
                <WeekTimingGroup label="BMO" icon="☀" hdClass={styles.bmoHd} rows={bmo} onSelect={onSelect} />
                <WeekTimingGroup label="AMC" icon="🌙" hdClass={styles.amcHd} rows={amc} onSelect={onSelect} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
