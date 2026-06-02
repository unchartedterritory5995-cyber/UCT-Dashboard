/**
 * Levels (Equalizer) — vertical mixing-board columns; height = where the metric
 * sits on its range (normalize), color = tier. Signal of the Day column is gold
 * ★ + outlined; the notable column pulses.
 */
import { metricColor } from './breadthViewShared'
import signalStyles from './signals.module.css'

export default function EqualizerView({ currentRow, metrics, normalize, onDrill, signalKey, notableKey }) {
  if (!currentRow || !metrics?.length) return null
  return (
    <div style={{ height: '100%', overflowX: 'auto', overflowY: 'hidden', padding: '18px 18px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: '100%', minHeight: 160 }}>
        {metrics.map(m => {
          const norm = normalize(m, currentRow)
          const h = norm == null ? 2 : Math.max(2, norm)
          const color = metricColor(m, currentRow)
          const isSignal = m.key === signalKey
          const isNotable = m.key === notableKey
          const clickable = !!m.drillKey
          return (
            <div key={m.key} onClick={clickable ? () => onDrill(m) : undefined}
                 role={clickable ? 'button' : undefined}
                 aria-label={clickable ? `${m.label} details` : undefined}
                 style={{ flex: '1 0 34px', minWidth: 34, height: '100%', display: 'flex',
                          flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
                          cursor: clickable ? 'pointer' : 'default' }}>
              <div style={{ font: '800 9px Instrument Sans, sans-serif', color: '#cbd5e1', marginBottom: 3 }}>
                {m.getFmt(currentRow)}
              </div>
              <div className={isNotable ? signalStyles.pulse : undefined}
                   style={{ width: '100%', height: `${h}%`, borderRadius: '3px 3px 0 0',
                            background: `linear-gradient(${color}, ${color}99)`,
                            boxShadow: isSignal ? '0 0 0 1px #c9a84c, 0 0 10px rgba(201,168,76,.4)' : 'none',
                            transition: 'height .4s ease' }} />
              <div style={{ font: '700 7px Instrument Sans, sans-serif', color: isSignal ? '#c9a84c' : '#94a3b8',
                            marginTop: 4, textTransform: 'uppercase', whiteSpace: 'nowrap',
                            maxWidth: 44, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isSignal ? '★' : ''}{m.label}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
