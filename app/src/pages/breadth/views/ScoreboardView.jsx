/**
 * Scoreboard — a card per metric: big current value + a sparkline of its recent
 * history (color = up/down vs the window start). Signal of the Day card has a
 * gold ★ + border; the notable card pulses.
 */
import { metricValue, sortVisibleMetrics } from './breadthViewShared'
import signalStyles from './signals.module.css'

function buildSpark(values, polarity) {
  const vals = values.filter(v => v != null)
  if (vals.length < 2) return null
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * 60
    const y = 15 - ((v - min) / range) * 13
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  // Color by *bullish* direction: for bearish metrics (e.g. VIX, 52w lows) a
  // rising raw value is bearish, so invert.
  const rising = vals[vals.length - 1] >= vals[0]
  const bullish = polarity === 'bear' ? !rising : rising
  return { pts, color: bullish ? '#34d399' : '#f87171' }
}

export default function ScoreboardView({ currentRow, recentRows = [], metrics, onDrill, signalKey, notableKey, normalize, options = {} }) {
  if (!currentRow || !metrics?.length) return null
  const sort = options.sort ?? 'group'
  const compact = options.density === 'compact'
  const win = options.sparkWindow ?? 20
  const ordered = normalize ? sortVisibleMetrics(metrics, sort, normalize, currentRow) : metrics
  const asc = [...recentRows].slice(0, win).reverse()  // oldest → newest, windowed
  const pad = compact ? 7 : 10
  const minW = compact ? 96 : 120
  return (
    <div style={{ overflow: 'auto', height: '100%', padding: '14px 18px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minW}px, 1fr))`, gap: 10 }}>
        {ordered.map(m => {
          const isSignal = m.key === signalKey
          const isNotable = m.key === notableKey
          const clickable = !!m.drillKey
          const sp = buildSpark(asc.map(r => metricValue(m, r)), m.polarity)
          return (
            <div key={m.key} onClick={clickable ? () => onDrill(m) : undefined}
                 role={clickable ? 'button' : undefined}
                 aria-label={clickable ? `${m.label} details` : undefined}
                 className={isNotable ? signalStyles.pulse : undefined}
                 style={{ background: '#0e131a', borderRadius: 8, padding: pad,
                          border: isSignal ? '1px solid #c9a84c' : '1px solid rgba(255,255,255,0.05)',
                          cursor: clickable ? 'pointer' : 'default' }}>
              <div style={{ font: '700 8px Instrument Sans, sans-serif', letterSpacing: '.5px',
                            textTransform: 'uppercase', color: isSignal ? '#c9a84c' : '#94a3b8' }}>
                {isSignal ? '★ ' : ''}{m.label}
              </div>
              <div style={{ font: `800 ${compact ? 18 : 22}px Instrument Sans, sans-serif`, color: '#e8e8ea',
                            lineHeight: 1.15, marginTop: 2 }}>
                {m.getFmt(currentRow)}
              </div>
              <svg width="100%" height="16" viewBox="0 0 60 16" preserveAspectRatio="none" style={{ marginTop: 2 }}>
                {sp
                  ? <polyline points={sp.pts} fill="none" stroke={sp.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  : <line x1="0" y1="8" x2="60" y2="8" stroke="#334155" strokeDasharray="2 2" />}
              </svg>
            </div>
          )
        })}
      </div>
    </div>
  )
}
