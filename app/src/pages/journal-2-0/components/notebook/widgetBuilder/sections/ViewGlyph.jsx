/**
 * The small static drawing of each view: inline SVG in currentColor, never an image or an emoji, and never the
 * member's numbers. Decorative (`aria-hidden`): every place that draws one says the view's name in words.
 *
 * ONE owner for the nine shapes (wave 8 consolidation): the builder's "Show it as" thumbnails (`size="section"`, the
 * default) and the My tools rows (`size="row"`, the old myTools/ViewThumb, deleted). Its own module so My tools takes
 * the drawing without the builder's section or its stylesheet.
 *
 * The row size draws the same shapes 0.8x smaller; its strokes and dots are drawn a little heavier so they keep their
 * weight at that size, and a view it does not know is an empty frame (a row always shows a thumbnail) where the
 * builder draws nothing.
 */
const SIZES = Object.freeze({
  section: { width: 40, height: 28, frame: 1.6, line: 2, dot: 2.2, unknown: false },
  row: { width: 32, height: 22, frame: 1.8, line: 2.2, dot: 2.4, unknown: true },
})

export function ViewGlyph({ view, size = 'section' }) {
  const z = SIZES[size] || SIZES.section
  const common = { width: z.width, height: z.height, viewBox: '0 0 40 28', 'aria-hidden': true, focusable: 'false' }
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
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={String(z.frame)}>
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
      return <svg {...common} fill="none" stroke="currentColor" strokeWidth={String(z.line)}><path d="M4 22l9-8 7 4 8-10 8 4" /></svg>
    case 'scatter':
      return (
        <svg {...common} fill="currentColor">
          {[[9, 19], [15, 12], [22, 16], [28, 8], [33, 14]].map(([cx, cy]) => (
            <circle key={`${cx}`} cx={String(cx)} cy={String(cy)} r={String(z.dot)} />
          ))}
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
      return z.unknown ? (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={String(z.frame)}>
          <rect x="6" y="5" width="28" height="18" rx="3" />
        </svg>
      ) : null
  }
}

export default ViewGlyph
