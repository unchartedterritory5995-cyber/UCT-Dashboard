/**
 * Timeline (Time Heatmap) — rows = metrics, columns = recent trading days,
 * cell color = the bright tier color. The one style that shows the time
 * dimension. Signal of the Day row label is gold ★; notable pulses.
 */
import { Fragment } from 'react'
import { metricColor, resolveViewColors } from './breadthViewShared'
import signalStyles from './signals.module.css'

export default function TimelineView({ recentRows = [], metrics, onDrill, signalKey, notableKey, options = {} }) {
  if (!metrics?.length || !recentRows.length) return null
  const win = options.windowDays ?? 20
  const days = [...recentRows].slice(0, win).reverse()  // oldest → newest, up to `win`
  const colors = resolveViewColors(options.palette, options.intensity)
  const cols = days.length
  return (
    <div style={{ overflow: 'auto', height: '100%', padding: '12px 18px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `92px repeat(${cols}, 1fr)`, gap: 2, minWidth: 320 }}>
        {metrics.map(m => {
          const isSignal = m.key === signalKey
          const isNotable = m.key === notableKey
          const clickable = !!m.drillKey
          return (
            <Fragment key={m.key}>
              <div onClick={clickable ? () => onDrill(m) : undefined}
                   role={clickable ? 'button' : undefined}
                   aria-label={clickable ? `${m.label} details` : undefined}
                   className={isNotable ? signalStyles.pulse : undefined}
                   style={{ font: '700 9px Instrument Sans, sans-serif', textTransform: 'uppercase',
                            letterSpacing: '.3px', color: isSignal ? '#c9a84c' : '#94a3b8',
                            display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
                            cursor: clickable ? 'pointer' : 'default' }}>
                {isSignal ? '★ ' : ''}{m.label}
              </div>
              {days.map((row, i) => (
                <div key={i} data-testid={`cell-${m.key}-${i}`} title={`${m.label} · ${row.date}: ${m.getFmt(row)}`}
                     style={{ height: 16, borderRadius: 2, background: metricColor(m, row, colors.tier), opacity: colors.fillOpacity }} />
              ))}
            </Fragment>
          )
        })}
      </div>
      <div style={{ font: '600 9px Instrument Sans, sans-serif', color: '#64748b', marginTop: 6, textAlign: 'right' }}>
        ← older · newer →
      </div>
    </div>
  )
}
