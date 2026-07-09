// app/src/pages/calendar/MacroBand.jsx
import UIcon from '../../components/ui/UIcon'
import styles from './Calendar.module.css'

export default function MacroBand({ econ = [], fed = [] }) {
  if (!econ.length && !fed.length) return null
  return (
    <div className={styles.macroband}>
      {econ.map((ev, i) => (
        <span key={`e${i}`} className={styles.mtag}>
          <span className={styles.mtagTm}>{ev.time || '—'}</span>
          <span className={ev.is_key ? styles.mtagKey : ''}>{ev.is_key ? <UIcon name="star-fill" size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} /> : ''}{ev.event}</span>
          {/* est/prior were fetched and thrown away — an estimate is the bar
              the release must clear. Actual stays NEUTRAL-bright: whether a
              hot CPI is "good" depends on your book, so we don't color it. */}
          {ev.estimate && <span className={styles.mtagMeta}>est {ev.estimate}</span>}
          {ev.prior    && <span className={styles.mtagMeta}>prior {ev.prior}</span>}
          {ev.actual   && <span className={styles.mtagActual}>→ {ev.actual}</span>}
        </span>
      ))}
      {fed.map((ev, i) => (
        <span key={`f${i}`} className={styles.mtag}>
          <span className={styles.mtagTm}>{ev.time || '—'}</span>
          <span className={styles.mtagFed}><UIcon name="mic" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{ev.event}</span>
        </span>
      ))}
    </div>
  )
}
