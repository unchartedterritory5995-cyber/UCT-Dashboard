// app/src/components/chart/chartIq/ChartIqOverlay.jsx — draws a Chart IQ plan (chartIqPlan.buildPlan) over a StockChart.
//
// Peer layer to PatternOverlay: an SVG inside the StockChart wrapper, sized to the chart container, pointer-events off at the
// root so the chart pans and drawings work underneath (a marker opts back in only to show its reason on hover). Coordinates
// come from the chart itself (timeScale().timeToCoordinate / series.priceToCoordinate) and reproject on every scroll / zoom.
import { useCallback, useEffect, useState } from 'react'

const DASH = { dashed: '6 4', dotted: '2 3', solid: null }
const FONT = 10
const CHAR_W = FONT * 0.6
const NUDGES = [0, -(FONT + 2), FONT + 2, -2 * (FONT + 2), 2 * (FONT + 2)]

// Text labels must never sit on top of each other (seen on the live site 2026-11-02: "Base breakout (support)" over
// "BUY · Hammer at support" over "BUY · 20EMA tap"). Labels are placed in priority order (the caller's order); each one tries
// its own y, then one and two lines up / down; one that still collides keeps its MARK but loses its text (the mark's hover
// title still names it). Pure: boxes in, { y, hidden } per label out.
export function layoutLabels(labels, width, height) {
  const placed = []
  const box = (l, y) => {
    const w = String(l.text || '').length * CHAR_W
    const x0 = l.anchor === 'end' ? l.x - w : l.anchor === 'middle' ? l.x - w / 2 : l.x
    return { x0, x1: x0 + w, y0: y - FONT, y1: y + 2 }
  }
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
  return labels.map((l) => {
    for (const d of NUDGES) {
      const y = l.y + d
      if (y - FONT < 0 || y > height) continue
      const b = box(l, y)
      if (!placed.some((p) => hit(p, b))) {
        placed.push(b)
        return { y, hidden: false }
      }
    }
    return { y: l.y, hidden: true }
  })
}

function useRedraw(chart, containerRef) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => (t + 1) % 1_000_000), [])
  useEffect(() => {
    const el = containerRef?.current
    if (!chart || !el) return undefined
    const upd = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    upd()
    const ro = new ResizeObserver(upd)
    ro.observe(el)
    const ts = chart.timeScale()
    ts.subscribeVisibleTimeRangeChange(bump)
    ts.subscribeVisibleLogicalRangeChange(bump)
    return () => {
      ro.disconnect()
      try { ts.unsubscribeVisibleTimeRangeChange(bump) } catch { /* chart gone */ }
      try { ts.unsubscribeVisibleLogicalRangeChange(bump) } catch { /* chart gone */ }
    }
  }, [chart, containerRef, bump])
  return size
}

function markerTextY(m, y, stack) {
  const r = m.size >= 2 ? 4 : 2.5
  const dir = m.pos === 'above' ? -1 : 1
  const cy = y + dir * (8 + stack * 12)
  return cy + dir * (r + 4) + (dir > 0 ? FONT : 0)
}

function markerAnchor(x, width) {
  return x < 60 ? 'start' : x > width - 60 ? 'end' : 'middle'
}

function Marker({ m, x, y, stack, width, label }) {
  const r = m.size >= 2 ? 4 : 2.5
  const dir = m.pos === 'above' ? -1 : 1
  const cy = y + dir * (8 + stack * 12)
  const shape = m.shape === 'up'
    ? <path d={`M ${x} ${cy - r - 1} L ${x - r - 1} ${cy + r} L ${x + r + 1} ${cy + r} Z`} fill={m.color} />
    : m.shape === 'down'
      ? <path d={`M ${x} ${cy + r + 1} L ${x - r - 1} ${cy - r} L ${x + r + 1} ${cy - r} Z`} fill={m.color} />
      : <circle cx={x} cy={cy} r={r} fill={m.color} />
  return (
    <g style={{ pointerEvents: 'auto', cursor: m.why ? 'help' : 'default' }} data-chart-iq-marker={m.kind}>
      <title>{m.why ? `${m.text || m.kind}: ${m.why}` : (m.text || '')}</title>
      {shape}
      {m.text && !(label && label.hidden) ? (
        <text x={Math.max(4, Math.min(width - 4, x))} y={label ? label.y : markerTextY(m, y, stack)} fill={m.color} fontSize={FONT}
          textAnchor={markerAnchor(x, width)}
          style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.65)', strokeWidth: 3 }}>{m.text}</text>
      ) : null}
    </g>
  )
}

export default function ChartIqOverlay({ chart, series, containerRef, plan, candles }) {
  const size = useRedraw(chart, containerRef)
  if (!chart || !series || !plan || !size.width) return null
  const tx = (t) => { try { return chart.timeScale().timeToCoordinate(t) } catch { return null } }
  const py = (p) => { try { return series.priceToCoordinate(p) } catch { return null } }
  const bar = new Map((candles || []).map((c) => [c.time, c]))
  // Positions first, then ONE label layout over all of them (priority: watch lines, then levels / bases, then markers).
  const W = size.width
  const segs = plan.segments.map((s) => {
    const x1 = tx(s.t1), x2 = tx(s.t2), y1 = py(s.p1), y2 = py(s.p2)
    return x1 == null || x2 == null || y1 == null || y2 == null ? null : { s, x1, x2, y1, y2 }
  })
  const hls = plan.hlines.map((h) => { const y = py(h.price); return y == null ? null : { h, y } })
  const stacks = new Map()
  const marks = plan.markers.map((m) => {
    const x = tx(m.t), c = bar.get(m.t)
    if (x == null || !c) return null
    const y = py(m.pos === 'above' ? c.high : c.low)
    if (y == null) return null
    const key = `${m.t}|${m.pos}`; const n = stacks.get(key) || 0; stacks.set(key, n + 1)
    return { m, x, y, stack: n }
  })
  const want = []
  hls.forEach((o, k) => { if (o && o.h.label) want.push({ id: `h${k}`, text: o.h.label, x: W - 4, y: o.y - 3, anchor: 'end' }) })
  segs.forEach((o, k) => { if (o && o.s.label) want.push({ id: `s${k}`, text: o.s.label, x: Math.min(o.x2, W - 4), y: o.y2 - 4, anchor: 'end' }) })
  marks.forEach((o, k) => {
    if (o && o.m.text) want.push({ id: `m${k}`, text: o.m.text, x: Math.max(4, Math.min(W - 4, o.x)), y: markerTextY(o.m, o.y, o.stack), anchor: markerAnchor(o.x, W) })
  })
  const laid = layoutLabels(want, W, size.height)
  const L = new Map(want.map((w, i) => [w.id, laid[i]]))
  return (
    <svg data-testid="chart-iq-overlay" width={size.width} height={size.height}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      {segs.map((o, k) => {
        if (!o) return null
        const { s, x1, x2, y1, y2 } = o
        const lab = L.get(`s${k}`)
        return (
          <g key={`s${k}`} data-chart-iq-seg={s.kind}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={s.color} strokeWidth={s.width || 2} strokeDasharray={DASH[s.dash] || null} opacity={0.95} />
            {s.label && lab && !lab.hidden ? (
              <text x={Math.min(x2, size.width - 4)} y={lab.y} fill={s.color} fontSize={FONT} textAnchor="end"
                style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.65)', strokeWidth: 3 }}>{s.label}</text>
            ) : null}
          </g>
        )
      })}
      {hls.map((o, k) => {
        if (!o) return null
        const { h, y } = o
        const lab = L.get(`h${k}`)
        return (
          <g key={`h${k}`} data-chart-iq-hline={h.kind}>
            <line x1={0} y1={y} x2={size.width} y2={y} stroke={h.color} strokeWidth={1} strokeDasharray={DASH[h.dash] || null} opacity={0.9} />
            {h.label && lab && !lab.hidden ? (
              <text x={size.width - 4} y={lab.y} fill={h.color} fontSize={FONT} textAnchor="end"
                style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.65)', strokeWidth: 3 }}>{h.label}</text>
            ) : null}
          </g>
        )
      })}
      {marks.map((o, k) => (o
        ? <Marker key={`m${k}`} m={o.m} x={o.x} y={o.y} stack={o.stack} width={size.width} label={L.get(`m${k}`)} />
        : null))}
    </svg>
  )
}
