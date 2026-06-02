// app/src/pages/calendar/MacroBand.jsx
import styles from './Calendar.module.css'

export default function MacroBand({ econ = [], fed = [] }) {
  if (!econ.length && !fed.length) return null
  return (
    <div className={styles.macroband}>
      {econ.map((ev, i) => (
        <span key={`e${i}`} className={styles.mtag}>
          <span className={styles.mtagTm}>{ev.time || '—'}</span>
          <span className={ev.is_key ? styles.mtagKey : ''}>{ev.is_key ? '★ ' : ''}{ev.event}</span>
          {ev.actual && <span className={styles.pos}> A:{ev.actual}</span>}
        </span>
      ))}
      {fed.map((ev, i) => (
        <span key={`f${i}`} className={styles.mtag}>
          <span className={styles.mtagTm}>{ev.time || '—'}</span>
          <span className={styles.mtagFed}>🎙 {ev.event}</span>
        </span>
      ))}
    </div>
  )
}
