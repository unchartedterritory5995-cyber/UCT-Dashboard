/**
 * Divergence Lens — price and participation z-scored onto one frame, with
 * sustained gaps shaded. Answers "is price outrunning the troops?", the
 * classic breadth read, which the table can only imply.
 */
import { resolveViewColors, WIDEN_WINDOW_HINT } from './breadthViewShared'
import useHoverReadout from './useHoverReadout'
import HoverReadout from './HoverReadout'
import { zscore, divergenceRuns } from './divergence'

// Both series are z-scored against the loaded window, so the refusal below is a
// window-DEPTH refusal — exactly the Regime Clock's, and it now carries the
// same "here is what to do about it" hint. Fewer than this and the standard
// deviation is noise; the boundary itself is pinned in the test file.
const MIN_SESSIONS = 20

const PRICE_LABEL = { sp500_close: 'S&P 500', qqq_close: 'QQQ' }
const PART_LABEL = {
  pct_above_50sma: '% above 50 SMA',
  pct_above_200sma: '% above 200 SMA',
  breadth_score: 'Health score',
}

// The session column under the pointer. One listener on the plot, not one per
// session — a 365-day window plots 365 of these.
const columnIndex = (e) => {
  const el = e.target?.closest?.('[data-seek-idx]')
  if (!el) return null
  const i = Number(el.getAttribute('data-seek-idx'))
  return Number.isInteger(i) ? i : null
}

const fmtZ = (z) => (z == null ? 'not reported' : `${z >= 0 ? '+' : ''}${z.toFixed(2)}σ`)

export default function DivergenceView({
  rows = [], rowIdx = 0, onSeek, canSeek, options = {},
}) {
  const { hostRef, tipRef, show, hide } = useHoverReadout()
  const colors = resolveViewColors(options.palette, options.intensity)
  const priceKey = options.price ?? 'sp500_close'
  const partKey = options.participation ?? 'pct_above_50sma'
  const minGap = Number(options.minGap ?? 5)

  const asc = rows.slice(rowIdx).reverse()  // oldest → newest for plotting
  if (asc.length < MIN_SESSIONS) {
    return (
      <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        <div data-testid="divergence-refusal">
          Needs {MIN_SESSIONS} sessions to z-score both series — has {asc.length}.
        </div>
        <div data-testid="divergence-refusal-hint" style={{ marginTop: 6, color: '#64748b', fontSize: 11 }}>
          {WIDEN_WINDOW_HINT}
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
  const colW = 100 / Math.max(1, asc.length - 1)

  const line = (zs) => zs.map((z, i) => (z == null ? null : `${X(i).toFixed(2)},${Y(z).toFixed(2)}`))
    .filter(Boolean).join(' ')

  const verdict = active
    ? (active.dir === 'price-leads'
        ? `Price leading breadth — ${active.end - active.start + 1} sessions and counting`
        : `Breadth leading price — ${active.end - active.start + 1} sessions and counting`)
    : 'In step — no sustained divergence'

  // ⛔ THE COLOUR IS THE DIRECTION, NOT THE PRESENCE OF A DIVERGENCE. Painting
  // any active run bearish called "Breadth leading price" — the bullish half of
  // this lens — a warning. Price outrunning the troops is the warning; the
  // troops outrunning price is not. The shaded runs in the SVG below already
  // read `r.dir`; this line is what disagreed with them.
  const verdictColor = active && active.dir === 'price-leads' ? colors.bear : colors.bull

  return (
    <div ref={hostRef}
         style={{ height: '100%', display: 'flex', flexDirection: 'column',
                  padding: '10px 18px 16px', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span data-testid="divergence-verdict"
              style={{ font: '800 15px \'Instrument Sans\', sans-serif',
                       color: verdictColor }}>
          {verdict}
        </span>
        <span style={{ font: '600 11px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
          <span style={{ color: '#e2e8f0' }}>■</span> {PRICE_LABEL[priceKey] ?? priceKey}
          {'   '}
          <span style={{ color: colors.bull }}>■</span> {PART_LABEL[partKey] ?? partKey}
        </span>
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
           aria-label={`Divergence: ${verdict}`} style={{ flex: 1, minHeight: 0, marginTop: 10 }}
           onClick={(e) => {
             const i = columnIndex(e)
             if (i == null) return
             const d = asc[i]?.date
             if (d && (canSeek ? canSeek(d) : false)) onSeek?.(d)
           }}
           onMouseOver={(e) => {
             const i = columnIndex(e)
             if (i == null) { hide(); return }
             show(e, `col:${i}`, asc[i].date, [
               `${PRICE_LABEL[priceKey] ?? priceKey} ${fmtZ(zPrice[i])}`,
               `${PART_LABEL[partKey] ?? partKey} ${fmtZ(zPart[i])}`,
             ])
           }}
           onMouseLeave={hide}>
        {runs.map((r, k) => (
          <rect key={k} x={X(r.start)} y="0" width={Math.max(0.4, X(r.end) - X(r.start))} height="100"
                fill={r.dir === 'price-leads' ? colors.bear : colors.bull} opacity="0.12" />
        ))}
        <line x1="0" y1="50" x2="100" y2="50" stroke="#1e293b" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        <polyline points={line(zPrice)} fill="none" stroke="#e2e8f0" strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke" />
        <polyline points={line(zPart)} fill="none" stroke={colors.bull} strokeWidth="1.2"
                  opacity={colors.fillOpacity} vectorEffect="non-scaling-stroke" />
        {/* ⭐ A COLUMN PER SESSION, TRANSPARENT AND FULL-HEIGHT — the crosshair
            this lens never had. Two z-scored polylines have no per-point mark to
            aim at, so the hit target is the whole column the session owns; it is
            drawn last so it sits above the shaded runs and the lines. */}
        {asc.map((r, i) => {
          const reachable = canSeek ? !!canSeek(r.date) : false
          return (
            <rect key={r.date ?? i} data-testid={`divergence-col-${i}`}
                  data-seek-idx={i} data-seek-date={r.date}
                  x={Math.max(0, X(i) - colW / 2)} y="0" width={colW} height="100"
                  fill="transparent" style={{ cursor: reachable ? 'pointer' : 'default' }}>
              <title>{`${r.date} · ${PRICE_LABEL[priceKey] ?? priceKey} ${fmtZ(zPrice[i])} · `
                     + `${PART_LABEL[partKey] ?? partKey} ${fmtZ(zPart[i])}`}</title>
            </rect>
          )
        })}
      </svg>

      <div data-testid="divergence-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginTop: 6 }}>
        {asc.length} sessions · since {asc[0].date} · shaded where the gap held ≥{minGap} sessions
      </div>
      <HoverReadout tipRef={tipRef} styleKey="divergence" />
    </div>
  )
}
