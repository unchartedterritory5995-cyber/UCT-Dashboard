// The relative-rotation graph: RS-Ratio across, RS-Momentum up, centred on 100, one tail per name.
//
// ⛔ ONE GRAPH (engineering map 2026-11-08, decisions D1 and D5). Extracted from the Terminal's
// RRG panel (`pages/terminal/panels/RrgPanel.jsx`) so the Compare panel's Rotation tab draws the
// SAME graph from the SAME formula (`relativeMath.rrgPath`, `RRG_METHOD`). The extraction changed
// nothing the Terminal renders: `RrgPanel.markup.test.jsx` holds a snapshot written before it.
//
// `rows` are `rrgPath` reads with a `sym` (RrgPanel's `rrgRows`): `{ sym, tail: [{d, x, y}], quadrant }`.
// The colours are the Terminal graph's own (gain / warn / loss / info). No gold: the rotation view
// has no look-here mark (map 3-08 risk note).
import { RRG_METHOD } from '../../pages/terminal/panels/relativeMath'
import styles from './RrgGraph.module.css'

const W = 560
const H = 380
const PAD = 34

const Q_CLASS = { Leading: 'qLeading', Weakening: 'qWeakening', Lagging: 'qLagging', Improving: 'qImproving' }
const QUADRANT_ORDER = ['Leading', 'Weakening', 'Lagging', 'Improving']

/** What the graph SHOWS, for a screen reader: the axes, then which names sit in which
 *  quadrant (a11y audit 2026-10-06 — a static "relative rotation graph" said nothing). */
export function rrgChartLabel(rows, benchmark) {
  const parts = QUADRANT_ORDER.map((q) => {
    const syms = rows.filter((r) => r.quadrant === q).map((r) => r.sym)
    return syms.length ? `${q}: ${syms.join(', ')}` : null
  }).filter(Boolean)
  return `Relative rotation graph vs ${benchmark}, RS-Ratio across and RS-Momentum up, centred on 100. `
    + (parts.length ? `${parts.join('. ')}.` : 'Nothing plotted.')
}

// Label geometry in viewBox units, sized for the PHONE label (RrgGraph.module.css raises
// .pointLabel to 18 units at <=640px, ~11px on screen once the 560-wide graph is scaled to a
// 390px phone). Audit 2026-10-08 (RRG #24): the labels were ~7px there and piled up in the centre.
const LABEL_CHAR_W = 11
const LABEL_GAP = 20

/** Place one label per point head so no two overlap: each starts up-right of its point, flips
 *  left near the right edge, and is pushed down past any already-placed label it would collide
 *  with. Returns [{ sym, x, y, anchor, moved }] in input order. */
export function placeLabels(heads, width = W) {
  const placed = []
  const order = heads.map((h, i) => i).sort((a, b) => heads[a].y - heads[b].y || heads[a].x - heads[b].x)
  const out = []
  for (const i of order) {
    const h = heads[i]
    const w = h.sym.length * LABEL_CHAR_W
    const flip = h.x + 6 + w > width - 4
    const left = flip ? h.x - 6 - w : h.x + 6
    let y = h.y - 6
    let bumped = true
    while (bumped) {
      bumped = false
      for (const p of placed) {
        const overlapX = left < p.left + p.w && p.left < left + w
        if (overlapX && Math.abs(p.y - y) < LABEL_GAP) { y = p.y + LABEL_GAP; bumped = true }
      }
    }
    placed.push({ left, w, y })
    out[i] = { sym: h.sym, x: flip ? h.x - 6 : h.x + 6, y, anchor: flip ? 'end' : 'start', moved: y !== h.y - 6 }
  }
  return out
}

/** Pure: every point the graph draws, in viewBox units, so a test can hold the graph to the
 *  formula (`rrgPath`) without reading pixels. */
export function graphGeometry(rows) {
  const xs = rows.flatMap((r) => r.tail.map((p) => p.x))
  const ys = rows.flatMap((r) => r.tail.map((p) => p.y))
  const hx = Math.max(0.5, ...xs.map((v) => Math.abs(v - 100))) * 1.15
  const hy = Math.max(0.25, ...ys.map((v) => Math.abs(v - 100))) * 1.15
  const px = (v) => PAD + ((v - (100 - hx)) / (2 * hx)) * (W - 2 * PAD)
  const py = (v) => H - PAD - ((v - (100 - hy)) / (2 * hy)) * (H - 2 * PAD)
  return { px, py, hx, hy }
}

/** The method sentence the Terminal prints under the graph (UCT's stated approximation, never
 *  claimed to be JdK's proprietary formula). `unit` is 'week' or 'session'. */
export function RrgMethodNote({ benchmark, unit }) {
  return (
    <>
      UCT&apos;s approximation, not JdK&apos;s proprietary formula: RS = 100 × price ÷ {benchmark};
      RS-Ratio = 100 × RS ÷ its {RRG_METHOD.ratioLen}-{unit} average; RS-Momentum = 100 × RS-Ratio ÷ its{' '}
      {RRG_METHOD.momLen}-{unit} average. Tails show the last {RRG_METHOD.tail} {unit}s.
    </>
  )
}

export default function RrgGraph({ rows, benchmark }) {
  const { px, py } = graphGeometry(rows)
  const labels = placeLabels(rows.map((r) => {
    const head = r.tail[r.tail.length - 1]
    return { sym: r.sym, x: px(head.x), y: py(head.y) }
  }))
  return (
    <div className={styles.chartBox}>
      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rrgChartLabel(rows, benchmark)}>
        <line className={styles.axis} x1={px(100)} x2={px(100)} y1={PAD / 2} y2={H - PAD} />
        <line className={styles.axis} x1={PAD} x2={W - PAD / 2} y1={py(100)} y2={py(100)} />
        <text className={styles.quadText} x={W - PAD} y={PAD} textAnchor="end">Leading</text>
        <text className={styles.quadText} x={W - PAD} y={H - PAD - 6} textAnchor="end">Weakening</text>
        <text className={styles.quadText} x={PAD + 4} y={H - PAD - 6}>Lagging</text>
        <text className={styles.quadText} x={PAD + 4} y={PAD}>Improving</text>
        <text className={styles.axisText} x={W / 2} y={H - 8} textAnchor="middle">RS-Ratio →</text>
        <text className={styles.axisText} x={10} y={H / 2} transform={`rotate(-90 10 ${H / 2})`} textAnchor="middle">RS-Momentum →</text>
        {rows.map((r, i) => {
          const head = r.tail[r.tail.length - 1]
          const q = styles[Q_CLASS[r.quadrant]]
          const lab = labels[i]
          return (
            <g key={r.sym} data-testid={`rrg-point-${r.sym}`} data-quadrant={r.quadrant}>
              <polyline className={`${styles.tailLine} ${q}`} points={r.tail.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} />
              {r.tail.slice(0, -1).map((p) => <circle key={p.d} className={q} cx={px(p.x)} cy={py(p.y)} r={1.6} />)}
              <circle className={q} cx={px(head.x)} cy={py(head.y)} r={4} />
              {lab.moved && <line className={styles.labelLeader} x1={px(head.x)} y1={py(head.y)} x2={lab.x} y2={lab.y} />}
              <text className={styles.pointLabel} x={lab.x} y={lab.y} textAnchor={lab.anchor}>{r.sym}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
