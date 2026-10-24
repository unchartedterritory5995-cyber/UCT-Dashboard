import { measuresOf, cellOf, fmtValue, SMALL_SAMPLE } from './builtModel'
import { useCellGroup } from './cellGroup'
import { CountLine } from './Counts'
import styles from './builtViews.module.css'
import { snapshotStyles as s, toneOf } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the Progress view. The first measure against the widget's target (the plan's
 * `display.target`, a number the member set), as an inline-SVG bar (`<rect>`). ⛔ An unknown value fills nothing
 * and says why; it is never drawn as 0% of the way there.
 * ⛔ Ruling R-32: while SHARED the target number is not drawn (it is a plan value, from `def`, and a shared body is
 * the archive image a public page shows): the bar and "<n>% of target" only.
 */
const BAR_W = 600
const BAR_H = 16

/** The target the member set, from the frozen plan; null when the note carries none (a plan over 4 KB). */
const targetOf = (p) => {
  const t = p?.def?.display?.target
  return typeof t === 'number' && Number.isFinite(t) ? t : null
}

export default function ProgressView({ params, onDrill }) {
  const p = params || {}
  const m = measuresOf(p)[0]
  const group = useCellGroup()
  if (!m) return <p className={s.empty}>{'This widget has nothing to show.'}</p>
  const c = cellOf(p.value, 1, m)
  const target = targetOf(p)
  const label = m.label || 'Measure 1'
  const known = typeof c.value === 'number'
  const frac = known && target ? Math.max(0, Math.min(1, c.value / target)) : null
  const shared = p.share === true
  const pct = frac === null ? '' : `${Math.round((c.value / target) * 100)}%`
  let of
  if (target === null) of = 'No target saved with this widget.'
  else if (shared) of = pct ? `${pct} of target` : 'of target'
  else of = `of ${fmtValue(target, m.fmt)}`
  const drill = typeof onDrill === 'function' ? (el) => onDrill({}, label, el) : null
  return (
    <div className={styles.progress} data-testid="built-progress-view" {...group.groupProps}>
      <span className={`${styles.metricBody} ${drill ? styles.drillable : ''}`}
        {...group.itemProps(0, drill, `${label}: ${c.text} ${of}${pct && !shared ? `, ${pct}` : ''}`)}>
        <span className={styles.metricLabel}>{label}</span>
        <span className={`${styles.metricValue} ${c.hidden ? styles.metricHidden : toneOf(c.value)}`}>
          {c.text}
          {c.small && <span className={styles.badge}>{SMALL_SAMPLE}</span>}
        </span>
        <span className={styles.compareLine}>
          <span>{of}</span>
          {pct && !shared && <span>{pct}</span>}
        </span>
        <svg className={styles.chart} viewBox={`0 0 ${BAR_W} ${BAR_H}`} width="100%" height={BAR_H}
          preserveAspectRatio="none" aria-hidden="true">
          <rect x={0} y={0} width={BAR_W} height={BAR_H} rx={4} className={styles.track} />
          {frac !== null && frac > 0 && (
            <rect x={0} y={0} width={Math.max(2, frac * BAR_W)} height={BAR_H} rx={4} className={styles.barPos} />
          )}
        </svg>
      </span>
      {!c.hidden && <CountLine params={p} i={1} measure={m} />}
    </div>
  )
}
