/**
 * Rotation Lens — equal-weight vs cap-weight, small vs large, and the VXN-VIX
 * spread. All three series already ride in every breadth row and appear
 * nowhere else on this tab.
 */
import { resolveViewColors } from './breadthViewShared'

/**
 * ⛔ `risingIsBull` IS DECLARED PER PANEL, NEVER INFERRED FROM THE RAW SIGN.
 *
 * A uniform `delta >= 0 ? bull : bear` is only right where rising IS the good
 * direction, and the third panel inverts: for `vol_spread`, rising means
 * "Narrowing — tech vol bid over the broad market". So a rising VXN−VIX drew a
 * GREEN number and a GREEN sparkline directly above a sentence reading
 * *Narrowing*. Each panel already states what rising means in its own `up`
 * copy; the colour is now driven from that same declaration, so it cannot
 * contradict the sentence beneath it.
 */
const PANELS = [
  { key: 'rsp_spy_ratio', label: 'Equal vs Cap', sub: 'RSP / SPY', risingIsBull: true,
    up: 'Broadening — the average stock is gaining on the index',
    down: 'Narrowing — the index is carried by its largest names',
    read: r => r.rsp_spy_ratio },
  { key: 'iwm_qqq_ratio', label: 'Small vs Large', sub: 'IWM / QQQ', risingIsBull: true,
    up: 'Broadening — small caps leading',
    down: 'Narrowing — large caps leading',
    read: r => r.iwm_qqq_ratio },
  { key: 'vol_spread', label: 'Vol Spread', sub: 'VXN − VIX', risingIsBull: false,
    up: 'Narrowing — tech vol bid over the broad market',
    down: 'Broadening — tech vol easing toward the market',
    read: r => (r.vxn == null || r.vix == null ? null : Number(r.vxn) - Number(r.vix)) },
]

export default function RotationView({ rows = [], rowIdx = 0, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const lookback = Number(options.lookback ?? 20)
  const window = rows.slice(rowIdx)
  if (!window.length) return null

  // ⛔ THE SPAN MEASURED IS THE SPAN PRINTED. `series[Math.min(lookback, len-1)]`
  // silently compared against the OLDEST available row and still printed
  // "/60d" — implying history this lens never read, which is precisely what the
  // spec's basis rule forbids. `measured` is the number of sessions the change
  // actually covers, and it is what both the label and the footer state.
  const measured = Math.min(lookback, window.length - 1)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px' }}>
      <div data-testid="rotation-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8 }}>
        {window.length} session{window.length === 1 ? '' : 's'} · since {window[window.length - 1].date}
        {measured < lookback
          ? ` · shorter than the ${lookback}-day setting, so changes are measured over ${measured}`
          : ` · changes measured over ${measured} sessions`}
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {PANELS.map(p => {
          const series = window.map(p.read)
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
                  <span data-testid={`delta-${p.key}`}
                        style={{ font: '700 11px \'Instrument Sans\', sans-serif',
                                 color: deltaColor }}>
                    {delta >= 0 ? '+' : ''}{delta.toFixed(3)} / {measured}d
                  </span>
                )}
              </div>
              <svg width="100%" height="30" viewBox="0 0 100 30" preserveAspectRatio="none"
                   style={{ marginTop: 6 }} aria-hidden="true">
                {pts
                  ? <polyline data-testid={`spark-${p.key}`} points={pts} fill="none" strokeWidth="1.4"
                              vectorEffect="non-scaling-stroke" opacity={colors.fillOpacity}
                              stroke={deltaColor} />
                  : <line x1="0" y1="15" x2="100" y2="15" stroke="#334155" strokeDasharray="2 2" />}
              </svg>
              <div data-testid={`verdict-${p.key}`}
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
