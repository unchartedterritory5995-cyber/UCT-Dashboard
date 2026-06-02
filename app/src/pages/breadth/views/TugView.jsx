/**
 * Bull/Bear Tug — paired metrics oppose around a center spine; bar length is the
 * pair's share of the combined total. Unpaired metrics render as a single signed
 * bar from center (direction by polarity, magnitude by deviation from neutral).
 * A net-posture line summarizes the paired board. The Signal of the Day is marked
 * with a gold ★; the notable divergence with a ◆ (and pulses when unpaired).
 */
import { metricValue, netPosture, resolveViewColors } from './breadthViewShared'
import signalStyles from './signals.module.css'

function Side({ metric, value, share, align, color, onDrill }) {
  const clickable = !!metric?.drillKey
  return (
    <div style={{ display: 'flex', justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <div
        role={clickable ? 'button' : undefined}
        aria-label={clickable ? `${metric.label} details` : undefined}
        onClick={clickable ? () => onDrill(metric) : undefined}
        style={{ width: `${share}%`, minWidth: 28, height: 20, background: color,
                 borderRadius: 4, display: 'flex', alignItems: 'center',
                 justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
                 padding: '0 6px', color: '#fff', font: '800 11px Instrument Sans, sans-serif',
                 cursor: clickable ? 'pointer' : 'default' }}>
        {value}
      </div>
    </div>
  )
}

function SingleBar({ metric, norm, value, onDrill, isSignal, isNotable, colors }) {
  const clickable = !!metric?.drillKey
  const polarity = metric.polarity === 'bear' ? 'bear' : 'bull'
  const n = norm == null ? 50 : norm
  const effBull = polarity === 'bear' ? (50 - n) : (n - 50)  // -50..50
  const isBull = effBull >= 0
  const mag = Math.min(100, Math.abs(effBull) / 50 * 100)
  const color = isBull ? colors.bull : colors.bear
  const bar = (
    <div
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `${metric.label} details` : undefined}
      onClick={clickable ? () => onDrill(metric) : undefined}
      className={isNotable ? signalStyles.pulse : undefined}
      style={{ width: `${mag}%`, minWidth: 24, height: 18, background: color, borderRadius: 3,
               display: 'flex', alignItems: 'center',
               justifyContent: isBull ? 'flex-start' : 'flex-end',
               padding: '0 6px', color: '#fff', font: '800 10px Instrument Sans, sans-serif',
               cursor: clickable ? 'pointer' : 'default' }}>
      {value}
    </div>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 92px 1fr', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{!isBull && bar}</div>
      <div style={{ textAlign: 'center', font: '700 8px Instrument Sans, sans-serif',
                    letterSpacing: '.5px', color: isSignal ? '#c9a84c' : '#94a3b8', textTransform: 'uppercase' }}>
        {isSignal ? '★ ' : isNotable ? '◆ ' : ''}{metric.label}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>{isBull && bar}</div>
    </div>
  )
}

export default function TugView({ currentRow, metrics, normalize, onDrill, signalKey, notableKey, options = {} }) {
  if (!currentRow || metrics.length === 0) return null
  const ups = metrics.filter(m => m.pair && m.pair.side === 'up')
  const unpaired = metrics.filter(m => !m.pair)
  const posture = netPosture(metrics, currentRow)
  const colors = resolveViewColors(options.palette, options.intensity)

  // Prefix the center label of a paired row when either side is a flagged signal.
  const prefixFor = (...keys) => {
    if (keys.includes(signalKey)) return '★ '
    if (keys.includes(notableKey)) return '◆ '
    return ''
  }

  return (
    <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ups.map(up => {
        const down = metrics.find(m => m.key === up.pair.partnerKey)
        const u = metricValue(up, currentRow) ?? 0
        const d = down ? (metricValue(down, currentRow) ?? 0) : 0
        const total = u + d || 1
        const uShare = u / total * 100
        const dShare = d / total * 100
        const label = up.label.replace(/^Up\s*/i, '').replace(/^Dn\s*/i, '')
        const prefix = prefixFor(up.key, down?.key)
        const isGold = prefix === '★ '
        return (
          <div key={up.key} style={{ display: 'grid', gridTemplateColumns: '1fr 92px 1fr',
                                      alignItems: 'center', gap: 6 }}>
            <Side metric={down} value={down ? down.getFmt(currentRow) : '—'} share={dShare}
                  align="right" color={colors.bear} onDrill={onDrill} />
            <div style={{ textAlign: 'center', font: '700 8px Instrument Sans, sans-serif',
                          letterSpacing: '.5px', color: isGold ? '#c9a84c' : '#94a3b8', textTransform: 'uppercase' }}>
              {prefix}{label}
            </div>
            <Side metric={up} value={up.getFmt(currentRow)} share={uShare}
                  align="left" color={colors.bull} onDrill={onDrill} />
          </div>
        )
      })}
      {unpaired.map(m => (
        <SingleBar key={m.key} metric={m} value={m.getFmt(currentRow)}
                   norm={normalize ? normalize(m, currentRow) : null} onDrill={onDrill}
                   isSignal={m.key === signalKey} isNotable={m.key === notableKey} colors={colors} />
      ))}
      {posture != null && (
        <div style={{ textAlign: 'center', marginTop: 10,
                      font: '800 13px Instrument Sans, sans-serif',
                      color: posture >= 0 ? '#34d399' : '#f87171' }}>
          NET POSTURE: <span style={{ color: '#fff' }}>
            {posture >= 0 ? '+' : ''}{posture}% {posture >= 0 ? 'BULLISH' : 'BEARISH'}
          </span>
        </div>
      )}
    </div>
  )
}
