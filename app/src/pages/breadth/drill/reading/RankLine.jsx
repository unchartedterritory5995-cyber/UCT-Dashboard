import { rankLine, ordinal } from './readingModel'
import styles from './Reading.module.css'

const Chevron = () => (
  <svg width="9" height="9" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

// The two lines under the count: where the reading sits ("Top 6% since 2008 · Strong", a range
// bar, History ›) and a faint line ("Last this high: … · seen N times in 18 years").
// ⛔ ALWAYS TWO LINES, loaded or not: the top band has a fixed height, so the window never moves
// when the answer lands (or when it never does).
export default function RankLine({ reading, loading = false, onHistory = null, histOpen = false, showButton = true }) {
  const line = reading ? rankLine(reading) : null
  if (!line) {
    return (
      <>
        <span className={styles.rank} data-state="pending" aria-hidden={!loading || undefined}>
          {loading ? <span className={styles.skel} /> : <span className={styles.placeholder}>—</span>}
        </span>
        <span className={styles.faint} aria-hidden="true">{' '}</span>
      </>
    )
  }
  const tone = line.tone || undefined
  return (
    <>
      <span className={styles.rank} data-state={line.state} aria-label="The reading" role="group">
        <span className={styles.rankText}>{line.text}</span>
        {line.word && (
          <span className={styles.word} data-tone={tone}><i aria-hidden="true" />{line.word}</span>
        )}
        <span className={styles.track} data-tone={tone} role="img"
          aria-label={`${ordinal(line.marker)} percentile of every session since ${reading.window.start.slice(0, 4)}`}>
          <i className={styles.trackZone} style={{ left: `${line.zone.from}%`, width: `${line.zone.to - line.zone.from}%` }} />
          <i className={styles.trackMid} />
          <i className={styles.trackDot} style={{ left: `${line.marker}%` }} data-marker={Math.round(line.marker)} />
        </span>
        {showButton && onHistory && (
          <button type="button" className={styles.histBtn} aria-expanded={histOpen}
            data-muted={!line.emphasis || undefined} onClick={onHistory}
            aria-label="History of this reading">
            History<Chevron />
          </button>
        )}
      </span>
      <span className={styles.faint} title={line.faint}>{line.faint}</span>
    </>
  )
}
