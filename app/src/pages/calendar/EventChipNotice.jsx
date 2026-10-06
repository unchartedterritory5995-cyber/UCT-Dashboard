// app/src/pages/calendar/EventChipNotice.jsx
import styles from './Calendar.module.css'

// The IPO and dividend chips used to vanish silently when their read failed, which read as "no
// IPOs / no dividends this week" (quality pass 2026-10-05). A failed or partial read now says so
// above the feed. `null` = that chip is off; 'loading' and 'ok' say nothing.
export default function EventChipNotice({ ipos, dividends }) {
  const lines = []
  if (ipos === 'failed') lines.push("IPO dates couldn't be read right now. That is not the same as no IPOs this week.")
  if (dividends === 'failed') lines.push("Dividend and split dates couldn't be read right now. That is not the same as none this week.")
  if (dividends === 'partial') lines.push("Some dividend and split dates couldn't be read. A few of your names may be missing their chip.")
  if (!lines.length) return null
  return (
    <div className={styles.loading} role="status" data-testid="event-chip-notice">
      {lines.map((l) => <p key={l} style={{ margin: 0 }}>{l}</p>)}
    </div>
  )
}
