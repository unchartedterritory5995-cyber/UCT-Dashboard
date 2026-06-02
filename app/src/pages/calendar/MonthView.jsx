// app/src/pages/calendar/MonthView.jsx
import CompanyLogo from '../../components/CompanyLogo'
import styles from './Calendar.module.css'

// monthDays: [{ ds, dayNum, inMonth, isToday, syms:[...], mineSyms:Set, hasMacro }]
export default function MonthView({ monthDays, onOpenDay }) {
  return (
    <>
      <div className={styles.mgridHd}>
        {['Mon','Tue','Wed','Thu','Fri'].map(d => <div key={d} className={styles.scolLbl}>{d}</div>)}
      </div>
      <div className={styles.mgrid}>
        {monthDays.map(c => (
          <div key={c.ds} className={`${styles.gcell} ${c.isToday ? styles.gcellToday : ''} ${c.inMonth ? '' : styles.gcellOff}`}
               onClick={() => onOpenDay(c.ds)}>
            <div className={styles.dn}>{c.dayNum}{c.hasMacro ? ' ★' : ''}</div>
            <div className={styles.glogos}>
              {c.syms.slice(0, 6).map(s => (
                <span key={s} className={c.mineSyms.has(s) ? styles.mineRing : ''}>
                  <CompanyLogo sym={s} size={18} />
                </span>
              ))}
              {c.syms.length > 6 && <span className={styles.gmore}>+{c.syms.length - 6}</span>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
