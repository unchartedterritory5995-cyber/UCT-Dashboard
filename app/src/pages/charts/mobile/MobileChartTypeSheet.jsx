import Sheet from '../../../components/mobile/Sheet'
import haptics from '../../../components/mobile/haptics'
import styles from './MobileCharts.module.css'

/* Chart-type picker. The types StockChart renders, each drawn as a tiny
 * idealized SVG — the SetupGlyph precedent: inline SVG sketches, never emoji.
 * Writes ride the same settings sink as the desktop gear (cs.chartType +
 * preset:'custom').
 *
 * ⛔ HEIKIN ASHI WAS BUILT, WORKING AND UNREACHABLE ON THIS SHELL. `heikinAshi`
 * is a real field in `chartDefaults`, StockChart transforms the series for it,
 * and the bars-push single-writer invariant explicitly excludes it — that is how
 * live it is. Its ONLY control was a checkbox inside `ChartToolbar`, which the
 * phone shell sets to `display:none` (presentation contract §0, mechanism M2).
 * Same shape as the Drawing Boards orphan: nothing broken, nothing missing, just
 * no door.
 *
 * ⭐ AND IT IS PRESENTED AS A TYPE, NOT AS THE BOOLEAN IT IS UNDERNEATH. To a
 * trader, Heikin Ashi is a chart type — mutually exclusive with reading raw
 * candles, which is exactly what it is for. The orthogonal checkbox is an
 * implementation detail that leaked into the desktop UI; on the phone the tile
 * writes `heikinAshi` and pins `chartType: 'candles'`, and choosing any other
 * tile clears it. Nothing is lost: the desktop checkbox is untouched, so an
 * unusual combination like "Heikin Ashi + bars" stays expressible there.
 *
 * ⛔ WHAT IS DELIBERATELY NOT OFFERED, said plainly rather than left as a
 * silence: Renko, Kagi, Point & Figure and Line Break. Each is a different
 * CONSTRUCTION of the series — bricks/reversals from price alone, with time
 * discarded — not a different way of drawing OHLC, so each needs its own
 * transform, its own axis semantics and its own live-bar rules against the
 * single-writer invariant. That is a build, not a picker entry, and none of them
 * is in the top of what a swing trader reaches for on a phone. Baseline and Step
 * Line are cheaper but need a new lightweight-charts series type on the paint
 * path the single-writer index guards; the analytical gain does not pay for that
 * risk today. If any of these is wanted, it is a scoped piece of work — not a
 * line in this array.
 */

const S = { stroke: 'currentColor', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' }

function GlyphCandles() {
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
      <line x1="7" y1="2" x2="7" y2="24" {...S} strokeWidth="1.2" />
      <rect x="4" y="8" width="6" height="9" fill="currentColor" rx="1" />
      <line x1="17" y1="4" x2="17" y2="22" {...S} strokeWidth="1.2" />
      <rect x="14" y="7" width="6" height="7" fill="currentColor" rx="1" />
      <line x1="27" y1="1" x2="27" y2="20" {...S} strokeWidth="1.2" />
      <rect x="24" y="5" width="6" height="10" fill="currentColor" rx="1" />
    </svg>
  )
}

function GlyphHollow() {
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
      <line x1="7" y1="2" x2="7" y2="24" {...S} strokeWidth="1.2" />
      <rect x="4" y="8" width="6" height="9" {...S} rx="1" />
      <line x1="17" y1="4" x2="17" y2="22" {...S} strokeWidth="1.2" />
      <rect x="14" y="7" width="6" height="7" {...S} rx="1" />
      <line x1="27" y1="1" x2="27" y2="20" {...S} strokeWidth="1.2" />
      <rect x="24" y="5" width="6" height="10" {...S} rx="1" />
    </svg>
  )
}

function GlyphBars() {
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
      {[[7, 3, 21], [17, 6, 23], [27, 1, 18]].map(([x, t, b]) => (
        <g key={x}>
          <line x1={x} y1={t} x2={x} y2={b} {...S} />
          <line x1={x - 4} y1={t + 5} x2={x} y2={t + 5} {...S} />
          <line x1={x} y1={b - 5} x2={x + 4} y2={b - 5} {...S} />
        </g>
      ))}
    </svg>
  )
}

function GlyphLine() {
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
      <polyline points="2,21 10,13 17,16 25,6 32,9" {...S} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

function GlyphArea() {
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
      <polyline points="2,21 10,13 17,16 25,6 32,9" {...S} strokeWidth="2" strokeLinejoin="round" />
      <polygon points="2,21 10,13 17,16 25,6 32,9 32,25 2,25" fill="currentColor" opacity="0.25" stroke="none" />
    </svg>
  )
}

function GlyphHeikin() {
  // Smoothed, mostly-filled bodies with short wicks — the look that IS the point.
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
      <line x1="7" y1="6" x2="7" y2="22" {...S} strokeWidth="1.2" />
      <rect x="4" y="9" width="6" height="10" fill="currentColor" rx="1" />
      <line x1="17" y1="4" x2="17" y2="18" {...S} strokeWidth="1.2" />
      <rect x="14" y="6" width="6" height="10" fill="currentColor" rx="1" />
      <line x1="27" y1="2" x2="27" y2="15" {...S} strokeWidth="1.2" />
      <rect x="24" y="3" width="6" height="10" fill="currentColor" rx="1" />
    </svg>
  )
}

// `ha` is a SELECTION key, not a `chartType` value — see the header.
export const HEIKIN_KEY = 'ha'

export const CHART_TYPES = [
  { key: 'candles', name: 'Candles', Glyph: GlyphCandles },
  { key: 'hollow', name: 'Hollow', Glyph: GlyphHollow },
  { key: 'bars', name: 'Bars', Glyph: GlyphBars },
  { key: 'line', name: 'Line', Glyph: GlyphLine },
  { key: 'area', name: 'Area', Glyph: GlyphArea },
  { key: HEIKIN_KEY, name: 'Heikin Ashi', Glyph: GlyphHeikin },
]

/** What the picker should show as selected, given the settings blob.
 *  ⛔ ONE function, so the tick and the write can never disagree about which
 *  tile is current — the classic way a picker ends up highlighting a row that
 *  does not describe the chart. */
export function selectedTypeKey(cs) {
  if (cs?.heikinAshi) return HEIKIN_KEY
  return cs?.chartType || 'candles'
}

/** The settings PATCH a tile press means. Pure, so it is testable without a chart. */
export function chartTypePatch(key) {
  if (key === HEIKIN_KEY) return { chartType: 'candles', heikinAshi: true }
  return { chartType: key, heikinAshi: false }
}

export default function MobileChartTypeSheet({ open, onClose, chartType, onPick, className = '' }) {
  return (
    <Sheet open={open} onClose={onClose} variant="bottom-sheet" title="Chart type" ariaLabel="Chart type picker" className={className}>
      <div className={styles.typeGrid} role="listbox" aria-label="Chart types">
        {CHART_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            role="option"
            aria-selected={t.key === chartType}
            className={`${styles.typeCell} ${t.key === chartType ? styles.typeCellActive : ''}`}
            onClick={() => { haptics.tap(); onPick(t.key); onClose() }}
          >
            <span className={styles.typeGlyph}><t.Glyph /></span>
            <span className={styles.typeName}>{t.name}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
