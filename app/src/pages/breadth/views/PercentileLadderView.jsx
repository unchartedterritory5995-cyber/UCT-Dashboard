/**
 * Percentile Ladder — each metric drawn against its OWN distribution over the
 * loaded window: a 10-bin histogram, today's marker, and the percentile rank.
 * A metric with too few readings says so rather than ranking against noise.
 */
import { metricValue, percentileRank, resolveViewColors } from './breadthViewShared'

const MIN_READINGS = 20
const BINS = 10
// The marker's own width, and the viewBox it must stay inside.
const MARKER_W = 1.4
const TRACK_W = 100

/**
 * 🔴 THE 100th-PERCENTILE MARKER USED TO DRAW NOTHING AT ALL.
 *
 * `x={pct}` inside `viewBox="0 0 100 26"` puts a reading at the top of its own
 * distribution at x ∈ [100, 101.4] — entirely outside the box, so the svg
 * clipped it — and 96-99 were progressively half-clipped. A reading at the very
 * top of its distribution is exactly what this lens exists to surface, so the
 * one position that mattered most was the one that rendered blank.
 *
 * The marker is centred on its percentile and then clamped into the track.
 */
export const markerX = (pct) =>
  Math.min(Math.max(pct - MARKER_W / 2, 0), TRACK_W - MARKER_W)

export default function PercentileLadderView({ rows = [], rowIdx = 0, currentRow, metrics = [], onDrill, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const window = rows.slice(rowIdx)
  if (!window.length || !metrics.length || !currentRow) return null

  const sortMode = options.sort ?? 'group'

  const entries = metrics.map(m => {
    const vals = window.map(r => metricValue(m, r)).filter(v => v != null)
    const today = metricValue(m, currentRow)
    if (vals.length < MIN_READINGS || today == null) {
      return { m, ok: false, have: vals.length }
    }
    const sorted = [...vals].sort((a, b) => a - b)
    const pct = percentileRank(sorted, today)
    const min = sorted[0], max = sorted[sorted.length - 1]
    const span = max - min || 1
    const hist = Array.from({ length: BINS }, () => 0)
    for (const v of vals) {
      const bin = Math.min(BINS - 1, Math.floor((v - min) / span * BINS))
      hist[bin] += 1
    }
    const peak = Math.max(...hist, 1)
    return { m, ok: true, pct, hist, peak, min, max, today, count: vals.length }
  })

  const ordered = sortMode === 'percentile'
    ? [...entries].sort((a, b) => (b.ok ? b.pct : -1) - (a.ok ? a.pct : -1))
    : entries

  const basis = `${window.length} sessions · since ${window[window.length - 1].date}`

  return (
    <div style={{ overflow: 'auto', height: '100%', padding: '12px 18px' }}>
      <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8 }}>{basis}</div>
      {ordered.map(({ m, ok, pct, hist, peak, today, have }) => (
        <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
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

          {ok ? (
            <>
              <svg width="100%" height="26" viewBox="0 0 100 26" preserveAspectRatio="none"
                   style={{ flex: 1, minWidth: 0 }} role="img"
                   aria-label={`${m.label}: ${m.getFmt(currentRow)}, ${pct}th percentile of ${window.length} sessions`}>
                {hist.map((c, i) => {
                  const h = (c / peak) * 18
                  return <rect key={i} x={i * 10 + 0.6} y={20 - h} width={8.8} height={h}
                               fill={colors.tier.g1} opacity={0.35} />
                })}
                <line x1="0" y1="20.5" x2="100" y2="20.5" stroke="#334155" strokeWidth="0.6"
                      vectorEffect="non-scaling-stroke" />
                <rect data-testid={`marker-${m.key}`} x={markerX(pct)} y="1"
                      width={MARKER_W} height="21"
                      fill={colors.bull} opacity={colors.fillOpacity}>
                  <title>{`${m.getFmt(currentRow)} — ${pct}th percentile`}</title>
                </rect>
              </svg>
              <div style={{ width: 78, flex: '0 0 78px', display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ font: '800 15px \'Instrument Sans\', sans-serif', color: '#e8e8ea' }}>
                  {m.getFmt(currentRow)}
                </span>
                <span data-testid={`pctile-${m.key}`}
                      style={{ font: '700 10px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
                  {pct}
                </span>
              </div>
            </>
          ) : (
            <div data-testid={`insufficient-${m.key}`}
                 style={{ flex: 1, font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b' }}>
              Needs {MIN_READINGS} readings to rank — has {have}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
