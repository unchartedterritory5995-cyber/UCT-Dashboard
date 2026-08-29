/**
 * Heat Ribbon — one row per metric, one cell per session across the loaded
 * window, colored by that session's OWN tier. Answers "when did the regime
 * change?", which no snapshot view can.
 */
import { metricColor, resolveViewColors } from './breadthViewShared'

export default function HeatRibbonView({ rows = [], rowIdx = 0, metrics = [], onDrill, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const compact = options.density === 'compact'
  // rows are newest-first from the cursor; display oldest → newest (left → right).
  const window = rows.slice(rowIdx).reverse()
  if (!window.length || !metrics.length) return null

  const basis = `${window.length} sessions · since ${window[0].date}`
  const cellH = compact ? 10 : 16

  return (
    <div style={{ overflow: 'auto', height: '100%', padding: '12px 18px' }}>
      <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8 }}>
        {basis}
      </div>
      {metrics.map(m => (
        <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <div style={{ width: 104, flex: '0 0 104px', textAlign: 'right',
                        font: '700 9px \'Instrument Sans\', sans-serif', letterSpacing: '.4px',
                        textTransform: 'uppercase', color: '#94a3b8',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        cursor: m.drillKey ? 'pointer' : 'default' }}
               role={m.drillKey ? 'button' : undefined}
               aria-label={m.drillKey ? `${m.label} details` : undefined}
               onClick={m.drillKey ? () => onDrill(m) : undefined}>
            {m.label}
          </div>
          <div style={{ display: 'grid', gap: 1, flex: 1,
                        gridTemplateColumns: `repeat(${window.length}, minmax(0, 1fr))` }}>
            {window.map((row, i) => (
              <div key={row.date ?? i} data-testid={`ribbon-${m.key}-${i}`}
                   title={`${row.date} · ${m.label} ${m.getFmt(row)}`}
                   style={{ height: cellH, borderRadius: 1,
                            opacity: colors.fillOpacity,
                            background: metricColor(m, row, colors.tier) }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
