import { tableModelOf, measuresOf, cellSpeech, SMALL_SAMPLE } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import { useChartWidth, useHitFloor, clipText, clamp } from './svg'
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
 */
const PAD = 6
const BAR = 12
const BAR_GAP = 4

export default function BarView({ params, onDrill, width: forced }) {
  const p = params || {}
  const model = tableModelOf(p)
  const ms = measuresOf(p)
  const [boxRef, width] = useChartWidth(forced)
  const floor = useHitFloor()
  const group = useCellGroup()
  if (!model.rows.length || !ms.length) return <p className={s.empty}>{'No rows to show.'}</p>
  const multi = ms.length > 1
  const rowH = Math.max(floor, ms.length * (BAR + BAR_GAP) + 10, 30)
  const labelW = clamp(Math.round(width * 0.3), 90, 220)
  const valueW = clamp(Math.round(width * 0.3), 96, 230)
  const plotX = labelW + PAD * 2
  const plotW = Math.max(40, width - labelW - valueW - PAD * 4)
  // One zero line for every measure: in the middle when any measure goes negative, else at the left.
  const anyNeg = model.rows.some((r) => r.values.some((c) => typeof c.value === 'number' && c.value < 0))
  const zeroX = anyNeg ? plotX + plotW / 2 : plotX
  const reach = anyNeg ? plotW / 2 : plotW
  const extents = ms.map((_, k) => Math.max(0, ...model.rows.map((r) => Math.abs(r.values[k]?.value ?? 0))) || 1)
  const height = model.rows.length * rowH + PAD * 2
  return (
    <div className={styles.chartBox} ref={boxRef}>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="group"
        aria-label={`${ms.map((m) => m.label || 'Value').join(', ')} by row`} data-testid="built-bar-view"
        {...group.groupProps}>
        <line x1={zeroX} x2={zeroX} y1={PAD} y2={height - PAD} className={styles.axis} />
        {model.rows.map((r, i) => {
          const what = r.label2 ? `${r.label} · ${r.label2}` : r.label
          const y = PAD + i * rowH
          const barsTop = y + (rowH - ms.length * (BAR + BAR_GAP) + BAR_GAP) / 2
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
                const by = barsTop + k * (BAR + BAR_GAP)
                const len = typeof v === 'number' ? (Math.abs(v) / extents[k]) * reach : 0
                const x0 = typeof v === 'number' && v < 0 ? zeroX - len : zeroX
                return (
                  <g key={`m${k}`}>
                    {typeof v === 'number' && (
                      <rect x={x0} y={by} width={Math.max(len, 1)} height={BAR} data-measure={k + 1}
                        className={`${v < 0 ? styles.barNeg : styles.barPos} ${styles[`barTone${k + 1}`] || ''}`} />
                    )}
                    <text x={width - valueW} y={by + BAR / 2} dominantBaseline="middle"
                      className={c.hidden || typeof v !== 'number' ? styles.valueDim : styles.value}>
                      {multi && <tspan className={styles.tick}>{`${k + 1} `}</tspan>}
                      {c.text}
                      {c.small && <tspan dx="6" className={styles.badgeText}>{SMALL_SAMPLE}</tspan>}
                    </text>
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
