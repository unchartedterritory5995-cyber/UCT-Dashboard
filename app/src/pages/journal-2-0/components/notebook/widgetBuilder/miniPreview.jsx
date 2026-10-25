import { measuresOf, cellOf } from '../widgets/builtViews/builtModel'
import styles from './ExamplesGallery.module.css'

/**
 * Notebook widgets phase 2 (wave 8, Task 8.16): the small, STATIC thumbnail on an example card (spec 5.2 step 1).
 *
 * ⛔ Never a chart engine and never one of the builder's live views: a card draws a few SVG shapes from the card's
 * payload (the same payload shape a placed widget has, widget_engine/payload.py), so a gallery of twenty-odd cards
 * costs no more than a handful of paths. The full live preview runs only once a card is opened.
 *
 * Words are never invented: a figure is the payload's own (builtModel.cellOf, so a hidden one reads "Not enough
 * trades yet (3)" and an unknown one "no data", never a zero), and a drawing is shapes only, `aria-hidden`.
 */
export const W = 120
export const H = 48

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const toneOf = (v) => (finite(v) && v < 0 ? styles.neg : finite(v) && v > 0 ? styles.pos : styles.flat)

/** The first measure's values along a list of rows (`v1`), finite ones only, at most `cap`. */
function valuesOf(list, cap) {
  return (Array.isArray(list) ? list : []).slice(0, cap).map((r) => (r && finite(r.v1) ? r.v1 : null))
}

function Bars({ rows }) {
  const vals = valuesOf(rows, 6)
  const max = Math.max(0, ...vals.filter(finite).map(Math.abs))
  if (!vals.length || max === 0) return <Glyph type="bar" />
  const gap = 3
  const bh = (H - gap * (vals.length - 1)) / vals.length
  return (
    <svg className={styles.mini} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false">
      {vals.map((v, i) => (
        <rect key={i} x={0} y={i * (bh + gap)} width={finite(v) ? Math.max(2, (Math.abs(v) / max) * W) : 2}
          height={Math.max(1, bh)} rx={1} className={toneOf(v)} />
      ))}
    </svg>
  )
}

function Line({ series }) {
  const vals = valuesOf(series, 400).filter(finite)
  if (vals.length < 2) return <Glyph type="line" />
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo || 1
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - lo) / span) * (H - 4)).toFixed(1)}`)
  return (
    <svg className={styles.mini} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false">
      <polyline points={pts.join(' ')} fill="none" strokeWidth="2" className={toneOf(vals[vals.length - 1] - vals[0])} />
    </svg>
  )
}

function Points({ points }) {
  const list = (Array.isArray(points) ? points : []).filter((p) => p && finite(p.x) && finite(p.y)).slice(0, 200)
  if (!list.length) return <Glyph type="scatter" />
  const xs = list.map((p) => p.x)
  const ys = list.map((p) => p.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const sx = (x) => 3 + ((x - x0) / (x1 - x0 || 1)) * (W - 6)
  const sy = (y) => H - 3 - ((y - y0) / (y1 - y0 || 1)) * (H - 6)
  return (
    <svg className={styles.mini} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false">
      {list.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2} className={toneOf(p.y)} />)}
    </svg>
  )
}

function Cells({ cells }) {
  const list = (Array.isArray(cells) ? cells : []).slice(-60)
  if (!list.length) return <Glyph type="heat" />
  const cols = 15
  const size = 6
  return (
    <svg className={styles.mini} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false">
      {list.map((c, i) => (
        <rect key={i} x={(i % cols) * (size + 2)} y={Math.floor(i / cols) * (size + 2)} width={size} height={size}
          rx={1} className={toneOf(c?.v1)} />
      ))}
    </svg>
  )
}

/** A view's shape with no numbers: what a card shows while it waits, or when its numbers could not be had. */
export function Glyph({ type }) {
  let body
  if (type === 'line') body = <polyline points="0,40 25,30 45,34 70,18 95,22 120,8" fill="none" strokeWidth="2" />
  else if (type === 'scatter') {
    body = [[10, 36], [24, 20], [40, 30], [58, 14], [76, 26], [92, 10], [108, 22]]
      .map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.5} />)
  } else if (type === 'heat') {
    body = Array.from({ length: 30 }, (_, i) => <rect key={i} x={(i % 15) * 8} y={Math.floor(i / 15) * 8 + 14} width={6} height={6} rx={1} />)
  } else if (type === 'bar' || type === 'table' || type === 'list') {
    body = [100, 74, 52, 34].map((w, i) => <rect key={i} x={0} y={i * 12 + 2} width={w} height={8} rx={1} />)
  } else body = <rect x={0} y={18} width={70} height={14} rx={2} />
  return (
    <svg className={`${styles.mini} ${styles.glyph}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true"
      focusable="false">
      {body}
    </svg>
  )
}

/** The first figure of a Number, Number-with-comparison or Progress card, as the payload states it. */
function Figure({ payload }) {
  const m = measuresOf(payload)[0]
  const value = payload?.value && typeof payload.value === 'object' ? payload.value : {}
  if (!m) return <Glyph type="number" />
  const c = cellOf(value, 1, m)
  return (
    <span className={styles.figure}>
      <span className={styles.figureLabel}>{m.label || 'Result'}</span>
      <span className={`${styles.figureValue} ${c.hidden ? styles.figureHidden : toneOf(c.value)}`}>{c.text}</span>
    </span>
  )
}

/** The card's thumbnail from its payload: a figure for one-number views, shapes for the rest. */
export default function MiniPreview({ payload }) {
  const view = typeof payload?.view === 'string' ? payload.view : 'number'
  if (view === 'number' || view === 'compare' || view === 'progress') return <Figure payload={payload} />
  if (view === 'line') return <Line series={payload.series} />
  if (view === 'scatter') return <Points points={payload.points} />
  if (view === 'heat') return <Cells cells={payload.cells} />
  return <Bars rows={payload.rows} />
}
