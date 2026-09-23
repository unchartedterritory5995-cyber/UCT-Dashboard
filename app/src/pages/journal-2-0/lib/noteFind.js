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
 * position map for marginal benefit on real notes. ⭐ Wave 5 (replace) leans
 * on this: a match inside ONE text node has ONE set of marks, so a
 * replacement can carry exactly the marks the matched text had, and it never
 * spans a block edge (askInsertNode.jsx's filterTransaction stays quiet).
 *
 * ⛔ Wave 5: matching is a REGEX over the node's own text, never an index into
 * `text.toLowerCase()`. Lower-casing can change a string's LENGTH ('İ' is one
 * code unit and lower-cases to two), so an offset found in the lower-cased
 * copy addressed the wrong characters of the original — harmless while find
 * only painted a highlight, a wrong-text EDIT once replace writes through it.
 */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The term the bar searches for: trimmed, and '' for nothing to find. */
export function normalizeFindTerm(term) {
  return (term || '').trim()
}

export function findMatchesInDoc(doc, term, { caseSensitive = false } = {}) {
  const needle = normalizeFindTerm(term)
  if (!needle) return []
  // `u` so case folding is Unicode's; `i` only when case does not matter.
  const re = new RegExp(escapeRegExp(needle), caseSensitive ? 'gu' : 'giu')
  const matches = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    re.lastIndex = 0
    let m
    while ((m = re.exec(node.text)) !== null) {
      // non-overlapping; an empty match cannot occur (the needle is non-empty)
      matches.push({ from: pos + m.index, to: pos + m.index + m[0].length })
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
