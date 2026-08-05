import DayPath from '../../components/breadth/DayPath'
import styles from './LiveSessionStrip.module.css'

/**
 * The session so far, above the table that describes finished days.
 *
 * The Monitor's rows each answer "what did that day look like". None of them
 * can answer "what is today doing", because today isn't a row yet. This strip
 * is that answer: where each headline metric stands right now, and the shape
 * that got it there.
 *
 * Renders nothing without a live reading — including once the 4:15 collector
 * has written the day, at which point the table's top row IS the answer and a
 * provisional summary above it would be a second opinion about a settled fact.
 */

const ITEMS = [
  { key: 'breadth_score',   label: 'SCORE',      decimals: 1 },
  { key: 'pct_above_50sma', label: '% > 50-DAY', decimals: 1, suffix: '%' },
  { key: 'adv_decline',     label: 'ADV − DEC',  decimals: 0 },
  { key: 'up_4pct_today',   label: 'UP 4%',      decimals: 0 },
  { key: 'down_4pct_today', label: 'DOWN 4%',    decimals: 0 },
]

export default function LiveSessionStrip({ live }) {
  const row = live?.row
  if (!row) return null

  const shown = ITEMS.filter(i => row[i.key] != null)
  if (!shown.length) return null

  return (
    <div className={styles.strip} role="status" aria-live="polite">
      <span className={styles.stamp} title={
        `Provisional — computed ${live.clock} ET across ${live.measured ?? '—'} names. `
        + `The 4:15 PM collector writes the day's authoritative row.`
      }>
        <span className={styles.pulse} aria-hidden="true" />
        LIVE · {live.clock}
      </span>

      <div className={styles.items}>
        {shown.map(item => (
          <div key={item.key} className={styles.item}>
            <span className={styles.label}>{item.label}</span>
            <span className={styles.value}>
              {Number(row[item.key]).toFixed(item.decimals)}{item.suffix ?? ''}
            </span>
            <DayPath
              points={live.path?.[item.key]}
              label={item.label}
              decimals={item.decimals}
              width={70}
              height={20}
            />
          </div>
        ))}
      </div>

      <span className={styles.since}>since the open</span>
    </div>
  )
}
