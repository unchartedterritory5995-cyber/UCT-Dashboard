/**
 * Rotation Lens — equal-weight vs cap-weight, small vs large, and the VXN-VIX
 * spread. All three series already ride in every breadth row and appear
 * nowhere else on this tab.
 */
import { resolveViewColors } from './breadthViewShared'
// ⭐ The panel table MOVED to `rotation.js` (framework-free) — The Read quotes a
// panel's own `up`/`down` sentence, and a second copy of that copy is how the
// strip and the card beneath it would end up naming opposite directions. The
// `risingIsBull` ruling and the `measured` ruling both live there now.
import { ROTATION_PANELS as PANELS, rotationMeasured } from './rotation'

const pointIndex = (e) => {
  const el = e.target?.closest?.('[data-seek-idx]')
  if (!el) return null
  const i = Number(el.getAttribute('data-seek-idx'))
  return Number.isInteger(i) ? i : null
}

export default function RotationView({
  rows = [], rowIdx = 0, onSeek, canSeek, options = {},
}) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const lookback = Number(options.lookback ?? 20)
  // `win`, not `window`: a local named `window` shadows the global for the
  // whole function body.
  const win = rows.slice(rowIdx)
  if (!win.length) return null

  // The sparklines below plot oldest → newest; this is the session each drawn
  // x-position belongs to, computed ONCE rather than per panel.
  const ascRows = [...win].reverse()
  const colW = 100 / Math.max(1, ascRows.length - 1)
  const reachable = ascRows.map(r => (canSeek ? !!canSeek(r.date) : false))

  // THE SPAN MEASURED IS THE SPAN PRINTED — the rule, and its reason, live in
  // `rotation.js` beside the table this lens draws from.
  const measured = rotationMeasured(lookback, win.length)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px' }}>
      <div data-testid="rotation-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8 }}>
        {win.length} session{win.length === 1 ? '' : 's'} · since {win[win.length - 1].date}
        {measured < lookback
          ? ` · shorter than the ${lookback}-day setting, so changes are measured over ${measured}`
          : ` · changes measured over ${measured} sessions`}
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {PANELS.map(p => {
          const series = win.map(p.read)
          const vals = series.filter(v => v != null && !isNaN(Number(v))).map(Number)
          const now = series[0]
          const prior = measured > 0 ? series[measured] : null
          const usable = now != null && prior != null && vals.length >= 2

          const delta = usable ? Number(now) - Number(prior) : null
          // A ratio's own direction is the whole signal; `up`/`down` name what
          // that direction means for THIS pair rather than a generic bull/bear.
          const verdict = !usable
            ? `${p.sub} not reported over this window`
            : (delta >= 0 ? p.up : p.down)
          // …and the colour reads the SAME declaration the sentence does.
          const rising = usable && delta >= 0
          const deltaColor = rising === p.risingIsBull ? colors.bull : colors.bear

          const min = vals.length ? Math.min(...vals) : 0
          const max = vals.length ? Math.max(...vals) : 1
          const range = (max - min) || 1
          const asc = [...series].reverse()
          const pts = asc.map((v, i) => (v == null ? null
            : `${(i / Math.max(1, asc.length - 1) * 100).toFixed(2)},${(28 - ((Number(v) - min) / range) * 26).toFixed(2)}`))
            .filter(Boolean).join(' ')

          return (
            <div key={p.key} style={{ background: '#0e131a', borderRadius: 10, padding: 12,
                                      border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ font: '700 10px \'Instrument Sans\', sans-serif', letterSpacing: '.5px',
                               textTransform: 'uppercase', color: '#94a3b8' }}>{p.label}</span>
                <span style={{ font: '600 9px \'Instrument Sans\', sans-serif', color: '#475569' }}>{p.sub}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                <span style={{ font: '800 22px \'Instrument Sans\', sans-serif', color: '#e8e8ea' }}>
                  {usable ? Number(now).toFixed(3) : '—'}
                </span>
                {usable && (
                  <span data-testid={`rotation-delta-${p.key}`}
                        style={{ font: '700 11px \'Instrument Sans\', sans-serif',
                                 color: deltaColor }}>
                    {delta >= 0 ? '+' : ''}{delta.toFixed(3)} / {measured}d
                  </span>
                )}
              </div>
              <svg width="100%" height="30" viewBox="0 0 100 30" preserveAspectRatio="none"
                   style={{ marginTop: 6 }} aria-hidden="true"
                   onClick={(e) => {
                     const i = pointIndex(e)
                     if (i == null || !reachable[i]) return
                     onSeek?.(ascRows[i].date)
                   }}>
                {pts
                  ? <polyline data-testid={`rotation-spark-${p.key}`} points={pts} fill="none" strokeWidth="1.4"
                              vectorEffect="non-scaling-stroke" opacity={colors.fillOpacity}
                              stroke={deltaColor} />
                  : <line x1="0" y1="15" x2="100" y2="15" stroke="#334155" strokeDasharray="2 2" />}
                {pts && asc.map((v, i) => (v == null ? null : (
                  <rect key={ascRows[i]?.date ?? i} data-testid={`rotation-point-${p.key}-${i}`}
                        data-seek-idx={i} data-seek-date={ascRows[i]?.date}
                        x={Math.max(0, (i / Math.max(1, asc.length - 1)) * 100 - colW / 2)}
                        y="0" width={colW} height="30" fill="transparent"
                        style={{ cursor: reachable[i] ? 'pointer' : 'default' }}>
                    <title>{`${ascRows[i]?.date} · ${p.sub} ${Number(v).toFixed(3)}`}</title>
                  </rect>
                )))}
              </svg>
              <div data-testid={`rotation-verdict-${p.key}`}
                   style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#94a3b8', marginTop: 4 }}>
                {verdict}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
