// app/src/components/chart/patternShapes/SetupRsiPanel.jsx — the RSI(14) panel a divergence setup row draws.
//
// A divergence is a comparison between two panels: price makes a lower low while RSI(14) makes a higher low.
// The drawing that passed blind judging had an RSI(14) panel UNDER price, with dotted 70 / 30 guides, the RSI
// line, and the same two points joined with dots. This renders that panel as an SVG strip along the bottom of
// the price pane, from the row's `geometry.extras.draw_panel`:
//   { kind: 'rsi14', points: [{t, value}], p1: {t, value}, p2: {t, value}, guides: [70, 30] }
//
// ⛔ WHY A STRIP AND NOT A CHART PANE. Every pane index on the chart belongs to the pane layout
// (`computePaneLayout`, keyed by indicator instances): the pane manifest, the stretch plan and each pane's
// legend all read `chart.panes()` by position. A pane added from outside that layout would be counted by
// every one of them and shift the indices they rely on. The strip draws inside the pattern overlay's own SVG,
// so it touches no pane, no series and no chart option. It exists only while the Setups toggle is on and a
// served row carries the panel; when either goes away it unmounts with the setup layer.
//
// Pure geometry: time to x through the chart's own `tToX`, RSI 0..100 to y inside the strip. Nothing is
// fetched or computed here; the values are the server's.
import { getColor } from './style'

// Share of the price pane's height the strip occupies, and its floor / ceiling in pixels.
export const RSI_PANEL_SHARE = 0.24
export const RSI_PANEL_MIN_PX = 64
export const RSI_PANEL_MAX_PX = 150

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** The panel a row carries, or null when it carries none (or a malformed one). Pure — exported for tests. */
export function rsiPanelOf(row) {
  const p = row?.geometry?.extras?.draw_panel
  if (!p || p.kind !== 'rsi14' || !Array.isArray(p.points) || p.points.length < 2) return null
  if (!p.p1 || !p.p2 || !finite(p.p1.value) || !finite(p.p2.value)) return null
  return p
}

export default function SetupRsiPanel({ row, tToX, width, height }) {
  const panel = rsiPanelOf(row)
  if (!panel || !(width > 0) || !(height > 0)) return null
  const h = Math.max(RSI_PANEL_MIN_PX, Math.min(RSI_PANEL_MAX_PX, Math.round(height * RSI_PANEL_SHARE)))
  const top = height - h
  const pad = 6
  const yOf = (v) => top + pad + (1 - Math.max(0, Math.min(100, v)) / 100) * (h - 2 * pad)
  const pts = []
  for (const pt of panel.points) {
    if (!pt || !finite(pt.value)) continue
    const x = tToX(pt.t)
    if (x == null || !Number.isFinite(x)) continue
    pts.push(`${x},${yOf(pt.value)}`)
  }
  const x1 = tToX(panel.p1.t)
  const x2 = tToX(panel.p2.t)
  const ends = x1 != null && x2 != null
  const color = getColor(row)
  const guides = Array.isArray(panel.guides) ? panel.guides.filter(finite) : [70, 30]
  return (
    <g data-setup-panel="rsi14" data-setup-draw-panel={row.pattern_id}>
      <rect data-role="rsi-panel-bg" x={0} y={top} width={width} height={h}
        fill="var(--bg, #101012)" opacity={0.94} />
      <line data-role="rsi-panel-edge" x1={0} y1={top} x2={width} y2={top}
        stroke="var(--border, #2a2c31)" strokeWidth={1} />
      {guides.map((g) => (
        <line key={g} data-role="rsi-guide" data-level={g} x1={0} y1={yOf(g)} x2={width} y2={yOf(g)}
          stroke="var(--border-accent, #383b41)" strokeWidth={1} strokeDasharray="2,3" />
      ))}
      {pts.length >= 2 && (
        <polyline data-role="rsi-line" points={pts.join(' ')} fill="none"
          stroke="var(--text-muted, #cfcac0)" strokeWidth={1.1} opacity={0.85} />
      )}
      {ends && (
        <>
          <line data-role="rsi-divergence" x1={x1} y1={yOf(panel.p1.value)} x2={x2} y2={yOf(panel.p2.value)}
            stroke={color} strokeWidth={1.8} />
          <circle cx={x1} cy={yOf(panel.p1.value)} r={3} fill={color} />
          <circle cx={x2} cy={yOf(panel.p2.value)} r={3} fill={color} />
        </>
      )}
      <text x={6} y={top + 13} fontSize="10" fill="var(--text-muted, #cfcac0)" opacity={0.9}>RSI(14)</text>
    </g>
  )
}
