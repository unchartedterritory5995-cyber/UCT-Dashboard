import { rankLine, ordinal } from './readingModel'
import styles from './Reading.module.css'

const Chevron = () => (
  <svg width="9" height="9" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

// THE READING, a section of its own in the top band (owner 2026-11-19: the rank squeezed under
// the count was "extremely packed" while the band's right side sat empty). Three rows:
//   Top 1% since 2008  ● Extreme
//   [────────────●]                  History ›
//   Last this high: Apr 10, 2025 · seen 68 times in 19 years
// ⛔ ALWAYS THREE ROWS, loaded or not: the band has a fixed height, so the window never moves
// when the answer lands (or when it never does).
export default function RankLine({ reading, loading = false, onHistory = null, histOpen = false, showButton = true }) {
  const line = reading ? rankLine(reading) : null
  if (!line) {
    return (
      <div className={styles.readingTile} data-state="pending" aria-hidden={!loading || undefined}>
        <span className={styles.rankHead}>{loading ? <span className={styles.skel} /> : <span className={styles.placeholder}>—</span>}</span>
        <span className={styles.rankRow}><span className={styles.track} /></span>
        <span className={styles.faint}>{' '}</span>
      </div>
    )
  }
  const tone = line.tone || undefined
  return (
    <div className={styles.readingTile} data-state={line.state} aria-label="The reading" role="group">
      <span className={styles.rankHead}>
        <span className={styles.rankText}>{line.text}</span>
        {line.word && (
          <span className={styles.word} data-tone={tone}><i aria-hidden="true" />{line.word}</span>
        )}
      </span>
      <span className={styles.rankRow}>
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
    </div>
  )
}
