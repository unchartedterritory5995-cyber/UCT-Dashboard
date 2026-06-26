// app/src/utils/highlightThesis.jsx
//
// Renders a thesis string with restrained emphasis:
//   - the ONLY thing colored is a ± percentage move (the one number that
//     earns emphasis); green for +, red for −.
//   - **bold** markdown, $CASHTAGS and $amounts all render as plain text.
// (Decluttered 2026-06-26: the old "bold everything" treatment turned every
// cell into visual static — when fifteen things are bold, nothing is.)
import React from 'react'

// Split on **bold** (to strip the markers) and ± percentages (to color them).
const SPLIT_RE = /(\*\*[^*]+\*\*|[+-]\d+(?:\.\d+)?%)/g

export default function HighlightThesis({ text }) {
  if (!text) return null
  const parts = text.split(SPLIT_RE).filter(p => p !== '')
  return (
    <>
      {parts.map((p, i) => {
        // **bold** markdown → plain text (drop the markers, no <strong>)
        if (/^\*\*[^*]+\*\*$/.test(p)) {
          return <span key={i}>{p.slice(2, -2)}</span>
        }
        // ± percentage → the one colored signal
        if (/^[+-]\d+(?:\.\d+)?%$/.test(p)) {
          const color = p[0] === '-' ? 'var(--loss)' : 'var(--gain)'
          return <span key={i} style={{ color, fontWeight: 600 }}>{p}</span>
        }
        return <span key={i}>{p}</span>
      })}
    </>
  )
}

// Derive a one-line headline from a full thesis for the collapsed row view.
// Strips **markdown**, the redundant leading "Company Name (TICKER)" prefix
// (the ticker already sits in the Sym column), and a trailing source tag like
// "(News)" / "(Earnings - News)". CSS handles the single-line ellipsis.
export function thesisHeadline(text) {
  if (!text) return ''
  let s = String(text).replace(/\*\*/g, '').trim()
  // Drop a leading "Some Company (XYZ) " lead-in when present near the start.
  s = s.replace(/^.{0,60}?\(\$?[A-Z]{1,6}\)[\s:,-]*/, '')
  // Drop a trailing source citation in parens, e.g. "(News)" / "(Earnings - News)".
  s = s.replace(/\s*\([^()]{0,40}?(?:news|tweet|earnings|rss|report)[^()]*\)[.\s]*$/i, '')
  s = s.trim()
  // Stripping the "Company (TICKER)" lead-in can leave a lowercase verb
  // ("is gapping…") — recapitalize the first letter so it reads as a headline.
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}
