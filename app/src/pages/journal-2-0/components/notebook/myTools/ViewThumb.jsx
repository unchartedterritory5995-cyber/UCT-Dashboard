/**
 * The small static drawing of a widget's view in its My tools row (spec 5.8, "a small static thumbnail"): inline SVG
 * in currentColor, never an image or an emoji, and never the member's numbers (the row is a list of widgets, not a
 * preview of them). Decorative: the row says the view's name to a screen reader in words.
 *
 * ⚠️ The builder draws the same nine shapes as its view thumbnails (widgetBuilder/sections/ViewSection.jsx,
 * `ViewGlyph`, not exported). These are drawn at row size; if that one is ever exported, this file should use it.
 */
export default function ViewThumb({ view }) {
  const common = { width: 32, height: 22, viewBox: '0 0 40 28', 'aria-hidden': true, focusable: 'false' }
  switch (view) {
    case 'number':
      return <svg {...common}><rect x="6" y="9" width="28" height="10" rx="2" fill="currentColor" opacity=".85" /></svg>
    case 'compare':
      return (
        <svg {...common}>
          <rect x="4" y="8" width="16" height="12" rx="2" fill="currentColor" opacity=".85" />
          <rect x="22" y="12" width="14" height="8" rx="2" fill="currentColor" opacity=".45" />
        </svg>
      )
    case 'table':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="5" y="5" width="30" height="18" rx="2" /><path d="M5 11h30M5 17h30M17 5v18" />
        </svg>
      )
    case 'bar':
      return (
        <svg {...common} fill="currentColor">
          <rect x="5" y="5" width="26" height="4" rx="1" /><rect x="5" y="12" width="18" height="4" rx="1" opacity=".75" />
          <rect x="5" y="19" width="10" height="4" rx="1" opacity=".55" />
        </svg>
      )
    case 'line':
      return <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 22l9-8 7 4 8-10 8 4" /></svg>
    case 'scatter':
      return (
        <svg {...common} fill="currentColor">
          <circle cx="9" cy="19" r="2.4" /><circle cx="15" cy="12" r="2.4" /><circle cx="22" cy="16" r="2.4" />
          <circle cx="28" cy="8" r="2.4" /><circle cx="33" cy="14" r="2.4" />
        </svg>
      )
    case 'heat':
      return (
        <svg {...common} fill="currentColor">
          {[0, 1, 2].map((r) => [0, 1, 2, 3, 4].map((c) => (
            <rect key={`${r}${c}`} x={5 + c * 6.2} y={4 + r * 7} width="5" height="5.5" rx="1"
              opacity={0.3 + ((r + c) % 3) * 0.3} />
          )))}
        </svg>
      )
    case 'list':
      return (
        <svg {...common} fill="currentColor">
          {[6, 13, 20].map((y) => <rect key={y} x="6" y={y} width="28" height="3" rx="1.5" opacity=".75" />)}
        </svg>
      )
    case 'progress':
      return (
        <svg {...common}>
          <rect x="4" y="11" width="32" height="6" rx="3" fill="currentColor" opacity=".3" />
          <rect x="4" y="11" width="20" height="6" rx="3" fill="currentColor" />
        </svg>
      )
    default:
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="6" y="5" width="28" height="18" rx="3" />
        </svg>
      )
  }
}
