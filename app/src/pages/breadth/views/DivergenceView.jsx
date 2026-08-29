/**
 * Divergence Lens — price and participation z-scored onto one frame, with
 * sustained gaps shaded. Answers "is price outrunning the troops?", the
 * classic breadth read, which the table can only imply.
 */
import { resolveViewColors } from './breadthViewShared'
import { zscore, divergenceRuns } from './divergence'

const MIN_SESSIONS = 20

const PRICE_LABEL = { sp500_close: 'S&P 500', qqq_close: 'QQQ' }
const PART_LABEL = {
  pct_above_50sma: '% above 50 SMA',
  pct_above_200sma: '% above 200 SMA',
  breadth_score: 'Health score',
}

export default function DivergenceView({ rows = [], rowIdx = 0, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const priceKey = options.price ?? 'sp500_close'
  const partKey = options.participation ?? 'pct_above_50sma'
  const minGap = Number(options.minGap ?? 5)

  const asc = rows.slice(rowIdx).reverse()  // oldest → newest for plotting
  if (asc.length < MIN_SESSIONS) {
    return (
      <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        <div data-testid="divergence-insufficient">
          Needs {MIN_SESSIONS} sessions to z-score both series — has {asc.length}.
        </div>
      </div>
    )
  }

  const zPrice = zscore(asc.map(r => r[priceKey]))
  const zPart = zscore(asc.map(r => r[partKey]))
  const runs = divergenceRuns(zPrice, zPart, minGap)
  const last = runs.length ? runs[runs.length - 1] : null
  const active = last && last.end === asc.length - 1 ? last : null

  const all = [...zPrice, ...zPart].filter(v => v != null)
  const bound = Math.max(1, ...all.map(Math.abs))
  const X = (i) => (i / Math.max(1, asc.length - 1)) * 100
  const Y = (z) => 50 - (z / bound) * 46

  const line = (zs) => zs.map((z, i) => (z == null ? null : `${X(i).toFixed(2)},${Y(z).toFixed(2)}`))
    .filter(Boolean).join(' ')

  const verdict = active
    ? (active.dir === 'price-leads'
        ? `Price leading breadth — ${active.end - active.start + 1} sessions and counting`
        : `Breadth leading price — ${active.end - active.start + 1} sessions and counting`)
    : 'In step — no sustained divergence'

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '10px 18px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span data-testid="divergence-verdict"
              style={{ font: '800 15px \'Instrument Sans\', sans-serif',
                       color: active ? colors.bear : colors.bull }}>
          {verdict}
        </span>
        <span style={{ font: '600 11px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
          <span style={{ color: '#e2e8f0' }}>■</span> {PRICE_LABEL[priceKey] ?? priceKey}
          {'   '}
          <span style={{ color: colors.bull }}>■</span> {PART_LABEL[partKey] ?? partKey}
        </span>
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
           aria-label={`Divergence: ${verdict}`} style={{ flex: 1, minHeight: 0, marginTop: 10 }}>
        {runs.map((r, k) => (
          <rect key={k} x={X(r.start)} y="0" width={Math.max(0.4, X(r.end) - X(r.start))} height="100"
                fill={r.dir === 'price-leads' ? colors.bear : colors.bull} opacity="0.12" />
        ))}
        <line x1="0" y1="50" x2="100" y2="50" stroke="#1e293b" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        <polyline points={line(zPrice)} fill="none" stroke="#e2e8f0" strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke" />
        <polyline points={line(zPart)} fill="none" stroke={colors.bull} strokeWidth="1.2"
                  opacity={colors.fillOpacity} vectorEffect="non-scaling-stroke" />
      </svg>

      <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginTop: 6 }}>
        {asc.length} sessions · since {asc[0].date} · shaded where the gap held ≥{minGap} sessions
      </div>
    </div>
  )
}
