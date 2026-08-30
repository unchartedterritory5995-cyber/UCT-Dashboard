/**
 * Percentile Ladder — each metric drawn against its OWN distribution over the
 * loaded window: a 10-bin histogram, today's marker, and the percentile rank.
 * A metric with too few readings says so rather than ranking against noise.
 */
import {
  ALL_METRICS_HIDDEN, LADDER_MIN_READINGS as MIN_READINGS, metricValue, percentileRank,
  resolveViewColors,
} from './breadthViewShared'

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

/**
 * ⭐ THE SEEKABLE MARK HERE IS THE HISTOGRAM BAND, NOT THE TODAY-MARKER.
 *
 * The marker IS the cursor's own session, so "seeking" to it is a no-op dressed
 * as a link. The bands, though, are built FROM sessions — each one holds the
 * readings that fell in its slice of the range — so a band has a real date to
 * offer: the most recent session at that level. That is the question this lens
 * makes a reader ask ("when were we last down there?") and the one thing on it
 * that a cursor can answer. An empty band offers nothing and says so.
 */
const bandDate = (e) => e.target?.closest?.('[data-seek-date]')?.getAttribute('data-seek-date') ?? null

export default function PercentileLadderView({
  rows = [], rowIdx = 0, currentRow, metrics = [], onDrill, onSeek, canSeek, options = {},
}) {
  const colors = resolveViewColors(options.palette, options.intensity)
  // ⭐ `rows.slice(rowIdx)` — the window AS OF THE CURSOR, never all loaded
  // rows. Scrubbing back a month must rank that day against the history it
  // could see, not against sessions that had not happened yet. (`BreadthViews`
  // computes its own board-level `pctileByKey` over every loaded row; the
  // comment there says why the two differ.)
  //
  // `win`, not `window`: a local named `window` shadows the global for the
  // whole function body.
  const win = rows.slice(rowIdx)
  if (!win.length || !currentRow) return null

  // 🔴 UNCHECK EVERY METRIC IN CUSTOMIZE AND THIS RENDERED `null` — a blank
  // panel with no explanation. Same answer the Monitor tab has always given.
  if (!metrics.length) {
    return (
      <div data-testid="ladder-refusal"
           style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        {ALL_METRICS_HIDDEN}
      </div>
    )
  }

  const sortMode = options.sort ?? 'group'

  const entries = metrics.map(m => {
    // Value AND date together: the histogram is a count, but a band that can be
    // clicked has to name the session it sends the cursor to.
    const readings = []
    for (const r of win) {
      const v = metricValue(m, r)
      if (v != null) readings.push({ v, date: r.date })
    }
    const vals = readings.map(x => x.v)
    const today = metricValue(m, currentRow)
    if (vals.length < MIN_READINGS || today == null) {
      return { m, ok: false, have: vals.length }
    }
    const sorted = [...vals].sort((a, b) => a - b)
    const pct = percentileRank(sorted, today)
    const min = sorted[0], max = sorted[sorted.length - 1]
    const span = max - min || 1
    const hist = Array.from({ length: BINS }, () => 0)
    const bandLast = Array.from({ length: BINS }, () => null)
    for (const x of readings) {
      const bin = Math.min(BINS - 1, Math.floor((x.v - min) / span * BINS))
      hist[bin] += 1
      // `win` is newest-first, so the FIRST reading to land in a band is the
      // most recent session at that level.
      if (bandLast[bin] == null) bandLast[bin] = x.date
    }
    const peak = Math.max(...hist, 1)
    return { m, ok: true, pct, hist, bandLast, peak, min, max, today, count: vals.length }
  })

  const ordered = sortMode === 'percentile'
    ? [...entries].sort((a, b) => (b.ok ? b.pct : -1) - (a.ok ? a.pct : -1))
    : entries

  const basis = `${win.length} sessions · since ${win[win.length - 1].date}`

  return (
    <div style={{ overflow: 'auto', height: '100%', padding: '12px 18px' }}>
      <div data-testid="ladder-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8 }}>{basis}</div>
      {ordered.map(({ m, ok, pct, hist, bandLast, peak, have }) => (
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
                   aria-label={`${m.label}: ${m.getFmt(currentRow)}, ${pct}th percentile of ${win.length} sessions`}
                   onClick={(e) => {
                     const d = bandDate(e)
                     if (d && (canSeek ? canSeek(d) : false)) onSeek?.(d)
                   }}>
                {hist.map((c, i) => {
                  const h = (c / peak) * 18
                  return <rect key={i} x={i * 10 + 0.6} y={20 - h} width={8.8} height={h}
                               fill={colors.tier.g1} opacity={0.35} />
                })}
                {/* A short bar is a 1px target; the click band is the whole
                    column, and it is a SEPARATE transparent rect so the drawn
                    distribution keeps its own geometry. */}
                {hist.map((c, i) => {
                  const d = bandLast?.[i] ?? null
                  const reachable = c > 0 && d != null && (canSeek ? !!canSeek(d) : false)
                  return (
                    <rect key={`band-${i}`} data-testid={`ladder-band-${m.key}-${i}`}
                          data-seek-date={d ?? undefined}
                          x={i * 10} y="0" width="10" height="21" fill="transparent"
                          style={{ cursor: reachable ? 'pointer' : 'default' }}>
                      <title>{c === 0
                        ? 'No session in this band'
                        : `${c} session${c === 1 ? '' : 's'} in this band · last ${d}`}</title>
                    </rect>
                  )
                })}
                <line x1="0" y1="20.5" x2="100" y2="20.5" stroke="#334155" strokeWidth="0.6"
                      vectorEffect="non-scaling-stroke" />
                {/* ⛔ `marker-{key}` COLLIDED WITH `MetersView`'s OWN MARKERS.
                    Both boards can be on screen in the same test document, and
                    both draw one marker per metric — a query for `marker-vix`
                    matched whichever rendered first. Every id this view owns is
                    namespaced to the view. */}
                <rect data-testid={`ladder-marker-${m.key}`} x={markerX(pct)} y="1"
                      width={MARKER_W} height="21"
                      fill={colors.bull} opacity={colors.fillOpacity}>
                  <title>{`${m.getFmt(currentRow)} — ${pct}th percentile`}</title>
                </rect>
              </svg>
              <div style={{ width: 78, flex: '0 0 78px', display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ font: '800 15px \'Instrument Sans\', sans-serif', color: '#e8e8ea' }}>
                  {m.getFmt(currentRow)}
                </span>
                <span data-testid={`ladder-pctile-${m.key}`}
                      style={{ font: '700 10px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
                  {pct}
                </span>
              </div>
            </>
          ) : (
            <div data-testid={`ladder-refusal-${m.key}`}
                 style={{ flex: 1, font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b' }}>
              Needs {MIN_READINGS} readings to rank — has {have}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
