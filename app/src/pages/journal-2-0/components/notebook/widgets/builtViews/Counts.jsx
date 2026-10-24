import { measuresOf, countText, ADD_STOPS_HREF } from './builtModel'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the counts a member reads a figure by. Every average or rate says what it
 * was made from, in its own unit ("from 47 trades", "from 9 of 47 trades (38 have no stop)"), and a measure the
 * server marked with a coverage hint carries the door that fixes it ("Add stops to see R for more trades").
 */

/** The hint as a link (spec 5.2). The server's own sentence when it sent one. */
export function HintLink({ hint }) {
  if (!hint) return null
  return <a className={`${s.link} ${styles.hint}`} href={ADD_STOPS_HREF}>{hint}</a>
}

/** The count line under one total figure (Number, Compare, Progress). */
export function CountLine({ params, i, measure }) {
  const c = countText(params?.value, i, measure, params?.coverage)
  if (!c.text && !c.hint) return null
  return (
    <span className={styles.metricCount}>
      {c.text}
      {c.hint && <>{' '}<HintLink hint={c.hint} /></>}
    </span>
  )
}

/** Under a chart view: one line per measure whose count is short of what the widget read, so a bar of averages
 *  never hides that most trades had no stop. Nothing when every measure is known on every row. */
export function CoverageNote({ params }) {
  const p = params || {}
  const lines = measuresOf(p).map((m, k) => {
    const cov = Array.isArray(p.coverage) ? p.coverage[k] : null
    const short = cov && typeof cov.have === 'number' && typeof cov.total === 'number' && cov.have < cov.total
    return short ? { key: `c${k}`, label: m.label || `Measure ${k + 1}`, ...countText(p.value, k + 1, m, p.coverage) } : null
  }).filter(Boolean)
  if (!lines.length) return null
  return (
    <ul className={styles.coverage} data-testid="built-coverage">
      {lines.map((l) => (
        <li key={l.key}>
          {`${l.label}: ${l.text}`}
          {l.hint && <>{' '}<HintLink hint={l.hint} /></>}
        </li>
      ))}
    </ul>
  )
}

/** The payload's footnotes (a capped scan's path-dependent measures, a split's missing rows), under the body. */
export function Footnotes({ params }) {
  const list = Array.isArray(params?.footnotes) ? params.footnotes.filter((f) => typeof f === 'string' && f) : []
  if (!list.length) return null
  return (
    <ul className={styles.footnotes} data-testid="built-footnotes">
      {list.map((f, i) => <li key={`f${i}`}>{f}</li>)}
    </ul>
  )
}
