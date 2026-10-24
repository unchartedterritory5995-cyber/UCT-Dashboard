import { tableModelOf, measuresOf, cellSpeech, SMALL_SAMPLE } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import { useChartWidth, useHitFloor, clipText, clamp, textW } from './svg'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the Bar view. One horizontal row per group (best first, as the server sorted
 * them), with a bar for each measure (up to three, grouped, top to bottom in the legend's order). Pure inline SVG
 * (`<rect>`, `<text>`), laid out in REAL pixels at the measured width (ruling R-31); never a chart engine, never a
 * fetch. A bar with no value draws no bar and says why ("no data", "Not enough trades yet (n)"), never a
 * zero-length bar that reads as $0. Negatives grow left from one zero line. Each measure has its own scale (they
 * can be dollars and a rate), and every bar carries its value as text, so no bar is read by length alone. Rows come
 * from `tableModelOf`, so a shared widget's account names are already "Account N" here (R-25).
 *
 * The value column is MEASURED from its widest line (textW, as Line and Scatter size their axis), the hidden
 * sentence and the "small sample" badge included, so nothing is clipped. When one line each would take more than
 * VALUE_MAX of the width (the label and bar columns would be starved), the badge and a hidden sentence go on a
 * second line instead.
 */
const PAD = 6
const BAR = 12
const BAR_GAP = 4
const LINE_H = 14
const VALUE_PX = 12
const BADGE_PX = 11
/** The most of the width the value column may take before its badge and hidden sentences wrap. */
export const VALUE_MAX = 0.4
const MIN_PLOT = 40

/** A hidden sentence split in two at the word nearest its middle ("Not enough trades" / "yet (3)"). */
function split(text) {
  const words = String(text).split(' ')
  if (words.length < 2) return [text]
  let best = 1
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' ').length
    const b = words.slice(i).join(' ').length
    const ba = words.slice(0, best).join(' ').length
    const bb = words.slice(best).join(' ').length
    if (Math.max(a, b) < Math.max(ba, bb)) best = i
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')]
}

/** One value's lines: `[{text, px, badge}]`. One line (value, then the badge beside it) or, `wrap`, two. */
export function valueLines(c, prefix, wrap) {
  const head = `${prefix}${c.text}`
  if (!wrap) return [{ text: head, px: VALUE_PX, badge: c.small ? SMALL_SAMPLE : null }]
  if (c.hidden) return split(head).map((t) => ({ text: t, px: VALUE_PX, badge: null }))
  return [{ text: head, px: VALUE_PX, badge: null }, ...(c.small ? [{ text: SMALL_SAMPLE, px: BADGE_PX, badge: null, isBadge: true }] : [])]
}

/** The width one line takes, its badge (6 px apart) included. */
export const lineWidth = (l) => textW(l.text, l.px) + (l.badge ? 6 + textW(l.badge, BADGE_PX) : 0)

export default function BarView({ params, onDrill, width: forced }) {
  const p = params || {}
  const model = tableModelOf(p)
  const ms = measuresOf(p)
  const [boxRef, width] = useChartWidth(forced)
  const floor = useHitFloor()
  const group = useCellGroup()
  if (!model.rows.length || !ms.length) return <p className={s.empty}>{'No rows to show.'}</p>
  const multi = ms.length > 1
  const prefixOf = (k) => (multi ? `${k + 1} ` : '')
  const widest = (wrap) => Math.ceil(Math.max(0, ...model.rows.flatMap((r) => ms.flatMap((m, k) =>
    valueLines(r.values[k] || { text: '' }, prefixOf(k), wrap).map(lineWidth)))))
  let wrap = false
  let valueW = widest(false) + PAD * 2
  if (valueW > width * VALUE_MAX) { wrap = true; valueW = widest(true) + PAD * 2 }
  const linesPerSlot = wrap ? Math.max(1, ...model.rows.flatMap((r) => ms.map((m, k) => valueLines(r.values[k] || { text: '' }, prefixOf(k), true).length))) : 1
  const slotH = Math.max(BAR + BAR_GAP, linesPerSlot * LINE_H)
  const rowH = Math.max(floor, ms.length * slotH + 8, 30)
  const labelW = Math.max(60, Math.min(clamp(Math.round(width * 0.3), 80, 220), width - valueW - MIN_PLOT - PAD * 2))
  const plotX = labelW + PAD
  const plotW = Math.max(MIN_PLOT, width - labelW - valueW - PAD)
  const valueX = width - valueW + PAD
  // One zero line for every measure: in the middle when any measure goes negative, else at the left.
  const anyNeg = model.rows.some((r) => r.values.some((c) => typeof c.value === 'number' && c.value < 0))
  const zeroX = anyNeg ? plotX + plotW / 2 : plotX
  const reach = anyNeg ? plotW / 2 : plotW
  const extents = ms.map((_, k) => Math.max(0, ...model.rows.map((r) => Math.abs(r.values[k]?.value ?? 0))) || 1)
  const height = model.rows.length * rowH + PAD * 2
  return (
    <div className={styles.chartFit} ref={boxRef}>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="group"
        aria-label={`${ms.map((m) => m.label || 'Value').join(', ')} by row`} data-testid="built-bar-view"
        data-value-wrap={wrap ? '' : undefined} {...group.groupProps}>
        <line x1={zeroX} x2={zeroX} y1={PAD} y2={height - PAD} className={styles.axis} />
        {model.rows.map((r, i) => {
          const what = r.label2 ? `${r.label} · ${r.label2}` : r.label
          const y = PAD + i * rowH
          const slotsTop = y + (rowH - ms.length * slotH) / 2
          const speech = `${what}: ${ms.map((m, k) => `${multi ? `${m.label || `Measure ${k + 1}`} ` : ''}${cellSpeech(r.values[k], m)}`).join('; ')}`
            + `${r.flagged ? ', Flagged' : ''}`
          return (
            <g key={r.key} className={styles.mark} {...group.itemProps(i, drillFor(onDrill, r, what), speech)}>
              <title>{speech}</title>
              <rect x={0} y={y} width={width} height={rowH} className={styles.hit} data-hit="" />
              <text x={labelW} y={y + rowH / 2 - (r.flagged ? 6 : 0)} className={styles.label} textAnchor="end"
                dominantBaseline="middle">{clipText(what, labelW)}</text>
              {r.flagged && (
                <text x={labelW} y={y + rowH / 2 + 8} className={styles.flagText} textAnchor="end"
                  dominantBaseline="middle">Flagged</text>
              )}
              {ms.map((m, k) => {
                const c = r.values[k] || { text: '', value: null }
                const v = c.value
                const top = slotsTop + k * slotH
                const by = top + (slotH - BAR) / 2
                const len = typeof v === 'number' ? (Math.abs(v) / extents[k]) * reach : 0
                const x0 = typeof v === 'number' && v < 0 ? zeroX - len : zeroX
                const lines = valueLines(c, prefixOf(k), wrap)
                const firstY = top + slotH / 2 - ((lines.length - 1) * LINE_H) / 2
                return (
                  <g key={`m${k}`}>
                    {typeof v === 'number' && (
                      <rect x={x0} y={by} width={Math.max(len, 1)} height={BAR} data-measure={k + 1}
                        className={`${v < 0 ? styles.barNeg : styles.barPos} ${styles[`barTone${k + 1}`] || ''}`} />
                    )}
                    {lines.map((l, j) => (
                      <text key={`l${j}`} x={valueX} y={firstY + j * LINE_H} dominantBaseline="middle" data-value-line=""
                        data-px={l.px}
                        className={l.isBadge ? styles.badgeText : (c.hidden || typeof v !== 'number' ? styles.valueDim : styles.value)}>
                        {l.text}
                        {l.badge && <tspan dx="6" className={styles.badgeText} data-badge="">{l.badge}</tspan>}
                      </text>
                    ))}
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
      {multi && (
        <p className={styles.caption} data-testid="built-bar-legend">
          {`Bars top to bottom: ${ms.map((m, k) => `${k + 1} ${m.label || `Measure ${k + 1}`}`).join(' · ')}. Each measure is on its own scale.`}
        </p>
      )}
    </div>
  )
}
