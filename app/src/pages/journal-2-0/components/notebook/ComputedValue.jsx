import { describeComputed } from '../../lib/formula/computed'
import styles from './ComputedValue.module.css'

/**
 * Wave 11 (lane 11B): ONE way a formula or rollup value reads, wherever it shows
 * (properties panel, table cell, board card, list card, calendar chip).
 *
 * ⛔ An empty value is an em dash WITH its reason: the reason is the hover title
 * AND screen-reader text, because a title alone is unreachable on touch and to
 * a screen reader. Never NaN, never Infinity — `describeComputed` returns null
 * text for anything that is not a finite number.
 */
export default function ComputedValue({ cell, label = null, className = '' }) {
  const { text, empty, title } = describeComputed(cell)
  return (
    <span className={`${styles.value} ${empty ? styles.empty : ''} ${cell?.stale ? styles.stale : ''} ${className}`}
      title={title} data-computed-empty={empty ? 'true' : 'false'}>
      {label ? <span className={styles.label}>{label} </span> : null}
      {empty ? (
        <>
          <span aria-hidden="true">—</span>
          <span className={styles.srOnly}>{`No value: ${title}`}</span>
        </>
      ) : (
        <>
          {text}
          {cell?.capped || cell?.stale ? <span className={styles.srOnly}>{` (${title})`}</span> : null}
          {cell?.capped ? <span className={styles.mark} aria-hidden="true">*</span> : null}
        </>
      )}
    </span>
  )
}

/** The member's computed values on one note, as a compact row of chips. */
export function ComputedChips({ computed, className = '' }) {
  const cells = Object.entries(computed || {})
  if (!cells.length) return null
  return (
    <span className={`${styles.chips} ${className}`}>
      {cells.map(([id, cell]) => (
        <ComputedValue key={id} cell={cell} label={cell?.name || null} className={styles.chip} />
      ))}
    </span>
  )
}
