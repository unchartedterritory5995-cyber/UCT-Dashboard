/**
 * Rotation Lens — equal-weight vs cap-weight, small vs large, and the VXN-VIX
 * spread. All three series already ride in every breadth row and appear
 * nowhere else on this tab.
 */
import { resolveViewColors } from './breadthViewShared'

const PANELS = [
  { key: 'rsp_spy_ratio', label: 'Equal vs Cap', sub: 'RSP / SPY',
    up: 'Broadening — the average stock is gaining on the index',
    down: 'Narrowing — the index is carried by its largest names',
    read: r => r.rsp_spy_ratio },
  { key: 'iwm_qqq_ratio', label: 'Small vs Large', sub: 'IWM / QQQ',
    up: 'Broadening — small caps leading',
    down: 'Narrowing — large caps leading',
    read: r => r.iwm_qqq_ratio },
  { key: 'vol_spread', label: 'Vol Spread', sub: 'VXN − VIX',
    up: 'Narrowing — tech vol bid over the broad market',
    down: 'Broadening — tech vol easing toward the market',
    read: r => (r.vxn == null || r.vix == null ? null : Number(r.vxn) - Number(r.vix)) },
]

export default function RotationView({ rows = [], rowIdx = 0, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const lookback = Number(options.lookback ?? 20)
  const window = rows.slice(rowIdx)
  if (!window.length) return null

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px',
                  display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      {PANELS.map(p => {
        const series = window.map(p.read)
        const vals = series.filter(v => v != null && !isNaN(Number(v))).map(Number)
        const now = series[0]
        const prior = series[Math.min(lookback, series.length - 1)]
        const usable = now != null && prior != null && vals.length >= 2

        const delta = usable ? Number(now) - Number(prior) : null
        // A ratio's own direction is the whole signal; `up`/`down` name what
        // that direction means for THIS pair rather than a generic bull/bear.
        const verdict = !usable
          ? `${p.sub} not reported over this window`
          : (delta >= 0 ? p.up : p.down)

        const min = vals.length ? Math.min(...vals) : 0
        const max = vals.length ? Math.max(...vals) : 1
        const span = (max - min) || 1
        const asc = [...series].reverse()
        const pts = asc.map((v, i) => (v == null ? null
          : `${(i / Math.max(1, asc.length - 1) * 100).toFixed(2)},${(28 - ((Number(v) - min) / span) * 26).toFixed(2)}`))
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
                <span style={{ font: '700 11px \'Instrument Sans\', sans-serif',
                               color: delta >= 0 ? colors.bull : colors.bear }}>
                  {delta >= 0 ? '+' : ''}{delta.toFixed(3)} / {lookback}d
                </span>
              )}
            </div>
            <svg width="100%" height="30" viewBox="0 0 100 30" preserveAspectRatio="none"
                 style={{ marginTop: 6 }} aria-hidden="true">
              {pts
                ? <polyline points={pts} fill="none" strokeWidth="1.4" vectorEffect="non-scaling-stroke"
                            opacity={colors.fillOpacity}
                            stroke={usable && delta >= 0 ? colors.bull : colors.bear} />
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
  )
}
