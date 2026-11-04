/**
 * JourneyStrip — the set's progress as a JOURNEY the mark walks (owner, batch 16: "an animated bar of a journey that
 * our logo is filling up"). A gold track fills to the current item and the mark rides its leading edge; each
 * finished item is a lit stop, the current one a pulsing stop. Replaces the segmented strip.
 */
import StudyMark from '../../components/study/StudyMark'
import styles from './JourneyStrip.module.css'

export default function JourneyStrip({ index = 0, total = 10, results = {}, items = [] }) {
  const n = Math.max(1, total)
  const done = Math.min(index, n)
  const fill = (done / n) * 100
  const stops = Array.from({ length: n }, (_, i) => {
    const it = items[i]
    const r = it ? results[it.id] : null
    const state = i < done ? (r && r.correct === false ? 'miss' : 'hit') : i === done ? 'now' : 'todo'
    return { i, state }
  })
  return (
    <div className={styles.wrap} role="progressbar" aria-valuemin={0} aria-valuemax={n} aria-valuenow={done} aria-label={`Question ${Math.min(done + 1, n)} of ${n}`} data-testid="progress-strip">
      <span className={styles.srOnly}>Question {Math.min(done + 1, n)} of {n}</span>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${fill}%` }} />
        <ol className={styles.stops}>
          {stops.map((s) => (
            <li key={s.i} className={`${styles.stop} ${styles[s.state]}`} aria-hidden="true" />
          ))}
        </ol>
        <div className={styles.walker} style={{ left: `${fill}%` }} aria-hidden="true">
          <div className={styles.walkerIn}><StudyMark mood="live" size={34} /></div>
        </div>
      </div>
    </div>
  )
}
