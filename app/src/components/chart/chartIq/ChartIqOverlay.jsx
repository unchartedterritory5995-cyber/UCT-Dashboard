// app/src/components/chart/chartIq/ChartIqOverlay.jsx — draws a Chart IQ plan (chartIqPlan.buildPlan) over a StockChart.
//
// Peer layer to PatternOverlay: an SVG inside the StockChart wrapper, sized to the chart container, pointer-events off at the
// root so the chart pans and drawings work underneath (a marker opts back in only to show its reason on hover). Coordinates
// come from the chart itself (timeScale().timeToCoordinate / series.priceToCoordinate) and reproject on every scroll / zoom.
import { useCallback, useEffect, useState } from 'react'

const DASH = { dashed: '6 4', dotted: '2 3', solid: null }
const FONT = 10

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

function Marker({ m, x, y, stack, width }) {
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
      {m.text ? (
        <text x={Math.max(4, Math.min(width - 4, x))} y={cy + dir * (r + 4) + (dir > 0 ? FONT : 0)} fill={m.color} fontSize={FONT}
          textAnchor={x < 60 ? 'start' : x > width - 60 ? 'end' : 'middle'}
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
  const stacks = new Map()
  return (
    <svg data-testid="chart-iq-overlay" width={size.width} height={size.height}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      {plan.segments.map((s, k) => {
        const x1 = tx(s.t1), x2 = tx(s.t2), y1 = py(s.p1), y2 = py(s.p2)
        if (x1 == null || x2 == null || y1 == null || y2 == null) return null
        return (
          <g key={`s${k}`} data-chart-iq-seg={s.kind}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={s.color} strokeWidth={s.width || 2} strokeDasharray={DASH[s.dash] || null} opacity={0.95} />
            {s.label ? (
              <text x={Math.min(x2, size.width - 4)} y={y2 - 4} fill={s.color} fontSize={FONT} textAnchor="end"
                style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.65)', strokeWidth: 3 }}>{s.label}</text>
            ) : null}
          </g>
        )
      })}
      {plan.hlines.map((h, k) => {
        const y = py(h.price)
        if (y == null) return null
        return (
          <g key={`h${k}`} data-chart-iq-hline={h.kind}>
            <line x1={0} y1={y} x2={size.width} y2={y} stroke={h.color} strokeWidth={1} strokeDasharray={DASH[h.dash] || null} opacity={0.9} />
            <text x={size.width - 4} y={y - 3} fill={h.color} fontSize={FONT} textAnchor="end"
              style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.65)', strokeWidth: 3 }}>{h.label}</text>
          </g>
        )
      })}
      {plan.markers.map((m, k) => {
        const x = tx(m.t)
        const c = bar.get(m.t)
        if (x == null || !c) return null
        const y = py(m.pos === 'above' ? c.high : c.low)
        if (y == null) return null
        const key = `${m.t}|${m.pos}`
        const n = stacks.get(key) || 0
        stacks.set(key, n + 1)
        return <Marker key={`m${k}`} m={m} x={x} y={y} stack={n} width={size.width} />
      })}
    </svg>
  )
}
