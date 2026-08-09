// app/src/components/calendar/transcriptSearch.js
//
// Search over transcript segments, kept as pure functions so the matching and
// navigation rules can be tested without a DOM.
//
// The old behaviour was highlight-only: typing filtered nothing, counted
// nothing and scrolled nowhere, so on a 100+ turn transcript it looked inert.
// These primitives give the panel a real match list to count over and step
// through.

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g

/** Literal-text matcher. A user typing "12%" or "(FCF)" means those characters. */
export function escapeLiteral(q) {
  return q.replace(ESCAPE_RE, '\\$&')
}

/**
 * Every occurrence of `query` across `segments`, in reading order.
 *
 * @returns {Array<{segIndex:number, field:'speaker'|'content', start:number, end:number}>}
 */
export function findMatches(segments, query) {
  const q = (query || '').trim()
  if (!q || !Array.isArray(segments)) return []

  const re = new RegExp(escapeLiteral(q), 'gi')
  const out = []

  segments.forEach((seg, segIndex) => {
    // Speaker first so a hit on the name sorts ahead of hits in the body —
    // that is the order the turn is read in.
    for (const field of ['speaker', 'content']) {
      const text = seg?.[field]
      if (typeof text !== 'string' || !text) continue
      re.lastIndex = 0
      let m
      while ((m = re.exec(text)) !== null) {
        // A zero-width match would never advance lastIndex: hard-stop rather
        // than hang the render thread.
        if (m[0].length === 0) break
        out.push({ segIndex, field, start: m.index, end: m.index + m[0].length })
      }
    }
  })

  return out
}

/** Indices of segments holding at least one match — the "only matching turns" filter. */
export function segmentsWithMatches(matches) {
  return new Set((matches || []).map(m => m.segIndex))
}

/** Wrap `activeIndex` around the match list in either direction. */
export function stepIndex(activeIndex, total, delta) {
  if (!total) return 0
  return (((activeIndex + delta) % total) + total) % total
}
