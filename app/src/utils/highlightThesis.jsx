// app/src/utils/highlightThesis.jsx
//
// Renders a thesis string with:
//   - **bold** markdown converted to <strong>
//   - $CASHTAGS styled gold
//   - $123.45 amounts and +12% percentages styled bold (with +/− coloring on pct)
import React from 'react'

// Single combined splitter so order-of-application is deterministic
const SPLIT_RE = /(\*\*[^*]+\*\*|\$[A-Z]{1,5}\b|\$\d[\d,]*\.?\d*[BMK]?|[+-]?\d+(?:\.\d+)?%)/g

const GOLD = 'var(--ut-gold, #c9a84c)'

export default function HighlightThesis({ text }) {
  if (!text) return null
  const parts = text.split(SPLIT_RE).filter(p => p !== '')
  return (
    <>
      {parts.map((p, i) => {
        // **bold** markdown
        if (/^\*\*[^*]+\*\*$/.test(p)) {
          return <strong key={i}>{p.slice(2, -2)}</strong>
        }
        // $CASHTAG
        if (/^\$[A-Z]{1,5}$/.test(p)) {
          return <span key={i} style={{ color: GOLD, fontWeight: 600 }}>{p}</span>
        }
        // $123.45 / $1.2B etc.
        if (/^\$\d/.test(p)) {
          return <strong key={i}>{p}</strong>
        }
        // +12% / -5.3%
        if (/^[+-]?\d+(?:\.\d+)?%$/.test(p)) {
          const sign = p[0]
          const color = sign === '-'
            ? 'var(--loss)'
            : sign === '+' ? 'var(--gain)' : 'inherit'
          return <strong key={i} style={{ color }}>{p}</strong>
        }
        return <span key={i}>{p}</span>
      })}
    </>
  )
}
