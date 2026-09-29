import { useFilingWatchFrequency } from '../hooks/useFilingWatch'
import { formatETDate } from '../utils/timeAgo'
import styles from './FilingWatchFrequency.module.css'

// TERM-062 (FB-S7-02) — before a member saves a filing watch, say how often one
// on this ticker actually fired, and the re-arm rule that protects them.
//
// Every number here comes from the response: the count and window from the
// durable `alert_fires` record, the rule from `cooldown.sentence`, which the
// server composes from the constants the sweep applies. Nothing is typed here.
//
// ⛔ "never watched" is NOT "fired 0 times". The server answers `fires: null`
// when no watch covered the ticker in the window, and this says so in words.
// A failed read renders nothing at all — an unreadable record is not an empty one.

export function frequencyText(freq, sym) {
  if (!freq || typeof freq.window_days !== 'number') return null
  if (!freq.covered || typeof freq.fires !== 'number') {
    return `No filing-watch record for ${sym} in the last ${freq.window_days} days.`
  }
  const n = freq.fires
  const times = `${n} ${n === 1 ? 'time' : 'times'}`
  const partial = typeof freq.covered_since === 'number' && typeof freq.window_start === 'number'
    && freq.covered_since > freq.window_start
  const span = partial
    ? `since ${formatETDate(freq.covered_since)}`
    : `in the last ${freq.window_days} days`
  return `A filing watch on ${sym} fired ${times} ${span}.`
}

export default function FilingWatchFrequency({ sym }) {
  const freq = useFilingWatchFrequency(sym)
  const s = sym?.toUpperCase()
  const line = frequencyText(freq, s)
  if (!line) return null
  const rule = typeof freq?.cooldown?.sentence === 'string' ? freq.cooldown.sentence : null
  return (
    <p className={styles.note} data-testid="filing-watch-frequency">
      <span>{line}</span>
      {rule && <span className={styles.rule}> {rule}</span>}
    </p>
  )
}
