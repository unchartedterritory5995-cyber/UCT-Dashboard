/**
 * Wave 13 lane 13A — the discipline record (Insights → Discipline).
 *
 * How often the member's trades followed the plan they wrote before entry, over the last 20 and
 * the last 60 closed trades. Every number is the server's (`plan_grading.discipline_record`);
 * the sample wording is ruling R3: under 10 "too few to judge" (the rate stays behind a reveal),
 * 10-24 "thin sample" with a range, 25 and up shown plainly. Options are counted and not graded.
 *
 * Dark behind `notebook_plan_grading_enabled` — the Insights tab is not offered while off.
 */
import { useState } from 'react'
import { useDisciplineRecord } from '../../hooks/usePlanGrade'
import styles from './DisciplineRecord.module.css'

const ROWS = [
  { key: 'planRate', label: 'Trades with a plan' },
  { key: 'entry', label: 'Entry kept' },
  { key: 'stop', label: 'Stop honoured' },
  { key: 'size_', label: 'Size kept' },
  { key: 'target', label: 'Target hit', pick: (w) => w.target?.hitRate },
  { key: 'followedPlan', label: 'Followed the whole plan' },
]

const pctText = (r) => (typeof r === 'number' ? `${Math.round(r * 100)}%` : '—')

/** One rate, worded by its sample (R3). Exported for the rail. */
export function RateCell({ stat }) {
  if (!stat || !stat.n) return <span className={styles.muted}>no graded trades</span>
  const frac = `${stat.k} of ${stat.n}`
  if (stat.band === 'too_few') {
    return (
      <details className={styles.reveal}>
        <summary className={styles.summary}>too few to judge</summary>
        <span className={styles.revealed}>{pctText(stat.rate)} ({frac})</span>
      </details>
    )
  }
  if (stat.band === 'thin') {
    const [lo, hi] = stat.range || []
    return (
      <span>
        <span className={styles.rate}>{pctText(stat.rate)}</span>
        <span className={styles.muted}> ({frac}) · thin sample, likely {pctText(lo)} to {pctText(hi)}</span>
      </span>
    )
  }
  return <span><span className={styles.rate}>{pctText(stat.rate)}</span><span className={styles.muted}> ({frac})</span></span>
}

export default function DisciplineRecord({ accountId }) {
  const { enabled, record, error, isLoading, retry } = useDisciplineRecord(accountId)
  const [size, setSize] = useState(20)
  if (!enabled) return null

  if (isLoading && !record) return <p className={styles.muted} data-testid="discipline-loading">Reading your trades…</p>
  if (error) {
    return (
      <p className={styles.muted} role="alert">
        Couldn’t load your discipline record.{' '}
        <button type="button" className={styles.linkBtn} onClick={retry}>Try again</button>
      </p>
    )
  }
  const windows = record?.windows || []
  const w = windows.find((x) => x.size === size) || windows[0]
  if (!w || !w.trades) {
    return (
      <section className={styles.card} aria-labelledby="discipline-title" data-testid="discipline-record">
        <h3 id="discipline-title" className={styles.title}>Discipline record</h3>
        <p className={styles.muted}>Close a trade to start your record. Each one is checked against the plan you wrote before it.</p>
      </section>
    )
  }

  return (
    <section className={styles.card} aria-labelledby="discipline-title" data-testid="discipline-record">
      <div className={styles.head}>
        <h3 id="discipline-title" className={styles.title}>Discipline record</h3>
        <div className={styles.toggle} role="group" aria-label="How many trades">
          {windows.map((x) => (
            <button key={x.size} type="button" aria-pressed={x.size === w.size}
              className={`${styles.toggleBtn} ${x.size === w.size ? styles.toggleOn : ''}`}
              onClick={() => setSize(x.size)}>
              Last {x.size}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.counts}>
        {w.trades} closed trade{w.trades === 1 ? '' : 's'}: {w.planned} planned, {w.unplanned} unplanned
        {w.needsPick ? `, ${w.needsPick} waiting for you to pick a plan` : ''}
        {w.options ? `, ${w.options} option${w.options === 1 ? '' : 's'} (not graded yet)` : ''}.
      </p>
      <table className={styles.table}>
        <caption className={styles.srOnly}>Plan checks over the last {w.size} closed trades</caption>
        <thead>
          <tr><th scope="col">Check</th><th scope="col">How often</th></tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key}>
              <th scope="row" className={styles.rowLabel}>{r.label}</th>
              <td><RateCell stat={r.pick ? r.pick(w) : w[r.key]} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {w.target?.reachedNotTaken ? (
        <p className={styles.muted}>Price reached your target {w.target.reachedNotTaken} time{w.target.reachedNotTaken === 1 ? '' : 's'} without the exit taking it.</p>
      ) : null}
      {w.editedAfterEntry ? (
        <p className={styles.muted}>{w.editedAfterEntry} plan{w.editedAfterEntry === 1 ? ' was' : 's were'} only readable after entry and are labelled so.</p>
      ) : null}
    </section>
  )
}
