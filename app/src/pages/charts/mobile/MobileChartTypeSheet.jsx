import Sheet from '../../../components/mobile/Sheet'
import haptics from '../../../components/mobile/haptics'
import styles from './MobileCharts.module.css'

/* Chart-type picker. The five types StockChart renders (chartDefaults:
 * candles | hollow | bars | line | area), each drawn as a tiny idealized SVG —
 * the SetupGlyph precedent: inline SVG sketches, never emoji. Writes ride the
 * same settings sink as the desktop gear (cs.chartType + preset:'custom').
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

export const CHART_TYPES = [
  { key: 'candles', name: 'Candles', Glyph: GlyphCandles },
  { key: 'hollow', name: 'Hollow', Glyph: GlyphHollow },
  { key: 'bars', name: 'Bars', Glyph: GlyphBars },
  { key: 'line', name: 'Line', Glyph: GlyphLine },
  { key: 'area', name: 'Area', Glyph: GlyphArea },
]

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
