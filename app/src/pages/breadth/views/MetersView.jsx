/**
 * Tactical Readout — each metric as a marker on a shared oversold→overbought
 * track with 30/70 reference ticks. Marker color = metricColor (tier-driven).
 * The Signal of the Day gets a gold ★ label; the notable divergence pulses.
 */
import { metricColor, sortVisibleMetrics, resolveViewColors } from './breadthViewShared'
import signalStyles from './signals.module.css'

export default function MetersView({ currentRow, metrics, normalize, onDrill, signalKey, notableKey, options = {} }) {
  if (!currentRow || metrics.length === 0) return null
  const ordered = sortVisibleMetrics(metrics, options.sort ?? 'group', normalize, currentRow)
  const colors = resolveViewColors(options.palette, options.intensity)
  return (
    <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ font: '600 10px Instrument Sans, sans-serif', color: '#64748b',
                    textAlign: 'right', marginBottom: 2 }}>oversold ◄ ► overbought</div>
      {ordered.map(m => {
        const norm = normalize(m, currentRow)
        const color = metricColor(m, currentRow, colors.tier)
        const clickable = !!m.drillKey
        const isSignal = m.key === signalKey
        const isNotable = m.key === notableKey
        return (
          <div key={m.key}
               role={clickable ? 'button' : undefined}
               aria-label={clickable ? `${m.label} details` : undefined}
               onClick={clickable ? () => onDrill(m) : undefined}
               style={{ display: 'grid', gridTemplateColumns: '84px 1fr 52px',
                        alignItems: 'center', gap: 10, cursor: clickable ? 'pointer' : 'default' }}>
            <span style={{ font: '700 9px Instrument Sans, sans-serif', letterSpacing: '.5px',
                           textTransform: 'uppercase', color: isSignal ? '#c9a84c' : '#94a3b8', textAlign: 'right' }}>
              {isSignal ? '★ ' : ''}{m.label}
            </span>
            <div style={{ height: 10, borderRadius: 6, position: 'relative',
                          background: 'linear-gradient(90deg,#14532d,#3f6212,#713f12,#7f1d1d)' }}>
              <div style={{ position: 'absolute', top: 0, left: '30%', width: 1, height: 10,
                            background: 'rgba(255,255,255,.25)' }} />
              <div style={{ position: 'absolute', top: 0, left: '70%', width: 1, height: 10,
                            background: 'rgba(255,255,255,.25)' }} />
              {norm != null && (
                <div data-testid={`marker-${m.key}`}
                     className={isNotable ? signalStyles.pulse : undefined}
                     style={{ position: 'absolute', top: -3, left: `${norm}%`, width: 4, height: 16,
                              borderRadius: 2, background: color, transform: 'translateX(-2px)',
                              opacity: colors.fillOpacity,
                              boxShadow: colors.dim ? 'none' : `0 0 ${colors.glow ? 14 : 8}px ${color}`,
                              transition: 'left .4s ease' }} />
              )}
            </div>
            <span style={{ font: '800 13px Instrument Sans, sans-serif', color: '#e2e8f0' }}>
              {m.getFmt(currentRow)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
