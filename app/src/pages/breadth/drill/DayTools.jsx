import styles from './scan/ScanDeck.module.css'

// The scan day's two options, under the date they are about (owner 2026-11-19). Signature chips:
// the chosen one soft-filled; Replay, when on, also carries the gold underline (it is the
// window's current mode).
export default function DayTools({ markDay, replay, onToggle, canReplay = true }) {
  return (
    <div className={styles.dayTools} role="group" aria-label="This day on the charts">
      <button type="button" className={styles.dayChip} aria-pressed={!!markDay}
        onClick={() => onToggle('markDay', !markDay)}
        title="Mark day: paint this day's candle white (black on a light chart) on every chart here, so it stands out">
        <span aria-hidden="true">◐</span>Mark day
      </button>
      <button type="button" className={styles.dayChip} aria-pressed={!!replay} data-mode="replay"
        disabled={!canReplay}
        onClick={() => onToggle('replay', !replay)}
        title={canReplay
          ? "Replay from this day: every chart here ends on this day, as if it were today. Stays on for the next drill until you turn it off"
          : 'Replay needs a past session'}>
        <span aria-hidden="true">⏮</span>Replay
      </button>
    </div>
  )
}
