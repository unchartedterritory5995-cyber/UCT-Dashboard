/**
 * PROTOTYPE — a compact signed bar strip. ONE grammar for both the Overview
 * Business Trend and the Financials metric expansion, so the panel does not
 * grow two chart vocabularies.
 *
 * Hand-written SVG, no chart library. That is a deliberate reversal: the study
 * first reused the research-kit's `MetricTrendChart`, which is echarts-backed
 * and 140px tall. Inside a docked panel it drew its axes and then no series at
 * all, labelled its y-axis `40,000,000,000`, and spent an echarts instance per
 * expanded row of a table people open and close constantly. It is built for a
 * full research page; this surface needs 34px and no axis.
 *
 * Bars share a zero baseline, so a loss reads as a loss rather than as a short
 * bar. Values are never labelled here — the exact figures sit directly beneath
 * in the table, which is the whole point: the chart carries SHAPE, the rows
 * carry PRECISION.
 */
import { useMemo } from 'react'
import styles from './dockPanels.module.css'

const num = (v) => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * @param values   oldest → newest
 * @param labels   parallel to values, used for the hover title only
 * @param format   value formatter for the hover title
 * @param height   svg height in px
 */
export default function MiniBars({ values, labels = [], format = String, height = 34, endpoints = false }) {
  const geom = useMemo(() => {
    const vals = (values || []).map(num)
    if (vals.filter(v => v != null).length < 2) return null
    const present = vals.filter(v => v != null)
    const max = Math.max(0, ...present)
    const min = Math.min(0, ...present)
    const span = (max - min) || 1
    const zeroY = height * (max / span)
    return {
      zeroY,
      bars: vals.map((v, i) => {
        if (v == null) return { key: i, empty: true }
        const h = Math.max(1.5, (Math.abs(v) / span) * height)
        return {
          key: i,
          y: v >= 0 ? zeroY - h : zeroY,
          h,
          negative: v < 0,
          title: `${labels[i] ?? ''} ${format(v)}`.trim(),
        }
      }),
    }
  }, [values, labels, format, height])

  if (!geom) return null

  const strip = (
    <div className={styles.btBars}
      style={{ gridTemplateColumns: `repeat(${geom.bars.length}, 1fr)`, height }}>
      {geom.bars.map(b => (
        <div key={b.key} className={styles.btCol} style={{ height }} title={b.title}>
          <svg className={styles.btSvg} style={{ height }}
            viewBox={`0 0 10 ${height}`} preserveAspectRatio="none" aria-hidden="true">
            {!b.empty && (
              <rect x="1.5" width="7" y={b.y} height={b.h} rx="0.5"
                className={b.negative ? styles.btNeg : styles.btPos} />
            )}
            <line x1="0" x2="10" y1={geom.zeroY} y2={geom.zeroY} className={styles.btZero} />
          </svg>
        </div>
      ))}
    </div>
  )

  // Without a shared axis the strip's DIRECTION is ambiguous — and beneath a
  // newest-first value list, a reader can reasonably assume it runs the same
  // way. Naming just the two endpoints settles it in one line.
  if (!endpoints || labels.length < 2) return strip
  return (
    <>
      {strip}
      <div className={styles.btEnds}>
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </>
  )
}
