// app/src/components/chart/patternShapes/SupportResistanceLayer.jsx — the textbook support / resistance layer.
//
// Zones as thin translucent bands with a dotted edge, trendlines as dashed lines, labelled "Support a-b" /
// "Resistance a-b" (a confirmed zone adds " | broken & retested (confirmed)", as judged) / "Uptrend line (support)" /
// "Downtrend line (resistance)" to the right of the drawing's end.
// Blue = support, orange = resistance (the judged render's colours). Deliberately unlike the pattern drawings
// (solid direction-coloured lines and boxes, the purple shelf pivot): this layer is context, not a setup.
// Display only; positions come from srLevelsGeometry (one authority), label offsets from the overlay's
// label-collision pass (`dy`, keyed by item key), so an S/R label never prints over a pattern or metrics label.
import { srLevelsGeometry } from './srLevelsGeometry'

export default function SupportResistanceLayer({ levelsSr, tToX, priceToY, dy = null }) {
  const g = srLevelsGeometry(levelsSr, tToX, priceToY)
  if (!g.zones.length && !g.lines.length) return null
  const off = (k) => (dy && dy[k]) || 0
  return (
    <g data-role="sr-levels" style={{ pointerEvents: 'none' }}>
      {g.zones.map((z) => (
        <g key={z.key} data-role="sr-zone" data-sr-role={z.role} data-sr-state={z.confirmed ? 'confirmed' : 'intact'}>
          <rect data-role="sr-zone-band" x={z.x1} y={z.y0} width={Math.max(1, z.x2 - z.x1)} height={z.h}
            fill={z.color} fillOpacity={0.14} stroke={z.color} strokeOpacity={0.55} strokeWidth={0.75}
            strokeDasharray="2 3" />
          <text data-role="sr-zone-label" x={z.labelX} y={z.labelY + off(z.key)} fontSize="10" fontWeight="500"
            fill={z.color} textAnchor="start">
            {z.label}
          </text>
        </g>
      ))}
      {g.lines.map((t) => (
        <g key={t.key} data-role="sr-trendline" data-sr-side={t.side}>
          <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.color} strokeWidth={1.5} strokeOpacity={0.85}
            strokeDasharray="6 4" />
          <text data-role="sr-trendline-label" x={t.labelX} y={t.labelY + off(t.key)} fontSize="10" fill={t.color}
            textAnchor="start">
            {t.label}
          </text>
        </g>
      ))}
    </g>
  )
}
