/**
 * Wave B find-in-note — pure match-finding over a ProseMirror doc.
 *
 * Deliberately framework/React-free so it's testable without mounting
 * TipTap: takes any object exposing ProseMirror's `doc.descendants(fn)`
 * walk (a real `@tiptap/pm/model` Node, or a test double) and a search
 * term, returns `{from, to}` absolute-position ranges.
 *
 * Scoped to WITHIN a single text node — a search term split across a mark
 * boundary (e.g. half bold, half plain) will not match. A reasonable v1
 * limit (native browser find has similar element-boundary limits); doing
 * cross-node matching would mean synthesizing a flattened text index +
 * position map for marginal benefit on real notes.
 */
export function findMatchesInDoc(doc, term) {
  const needle = (term || '').trim().toLowerCase()
  if (!needle) return []
  const matches = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = node.text.toLowerCase()
    let idx = 0
    while (true) {
      const found = text.indexOf(needle, idx)
      if (found === -1) break
      matches.push({ from: pos + found, to: pos + found + needle.length })
      idx = found + needle.length // non-overlapping
    }
  })
  return matches
}

/** Wraps index math for next/previous with cyclic wraparound — pulled out
 * of the TipTap extension so it's testable in isolation too. */
export function nextMatchIndex(count, current) {
  if (count === 0) return -1
  return (current + 1) % count
}
export function prevMatchIndex(count, current) {
  if (count === 0) return -1
  return (current - 1 + count) % count
}
