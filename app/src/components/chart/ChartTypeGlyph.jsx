// The chart-type icons (Candles, Hollow, HLC bars, OHLC bars, Line, Area) — one drawing for
// Chart Settings' Price style tiles and the header's chart-type button (owner 11-15).
// `size` scales the 26-unit drawing; colour is currentColor.
import UIcon from '../ui/UIcon'
export default function TypeGlyph({ kind, size = 26 }) {
  const s = { width: size, height: size, display: 'block' }
  switch (kind) {
    case 'candles':
      // owner 11-15: ONE candles icon everywhere — the chart header button, its list, Chart Settings'
      // Type menu and the Price Style rail all show the same drawing (the UCT icon set's "chart").
      return <span style={{ display: 'inline-flex' }}><UIcon name="chart" size={size} gold={false} aria-hidden="true" /></span>
    case 'hollow':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.4">
          <line x1="8" y1="3" x2="8" y2="23" />
          <rect x="5.5" y="8" width="5" height="9" />
          <line x1="18" y1="4" x2="18" y2="22" />
          <rect x="15.5" y="7" width="5" height="8" />
        </svg>
      )
    case 'hlc':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.4">
          <line x1="8" y1="4" x2="8" y2="22" />
          <line x1="8" y1="15" x2="12" y2="15" />
          <line x1="18" y1="6" x2="18" y2="20" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
      )
    case 'bars':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.4">
          <line x1="8" y1="4" x2="8" y2="22" />
          <line x1="4" y1="9" x2="8" y2="9" />
          <line x1="8" y1="15" x2="12" y2="15" />
          <line x1="18" y1="6" x2="18" y2="20" />
          <line x1="14" y1="10" x2="18" y2="10" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
      )
    case 'line':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
          <polyline points="3,17 9,11 14,15 23,5" />
        </svg>
      )
    case 'area':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
          <polyline points="3,17 9,11 14,15 23,5" />
          <path d="M3 17 L9 11 L14 15 L23 5 L23 22 L3 22 Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
        </svg>
      )
    default:
      return null
  }
}
