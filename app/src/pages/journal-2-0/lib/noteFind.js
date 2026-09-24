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

/**
 * A letter, a digit or a combining mark: what a WORD is made of, in any
 * script. Whole-word matching refuses a match with one of these right before
 * or after it -- `\b` is ASCII-only and would split "café" or "市场".
 */
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u

// The code point just before `from` / just after `to` in the document, read
// across mark (text-node) edges. A block edge or an inline atom reads as '\n',
// i.e. a boundary. Two code units, so an astral letter is read whole.
const charBefore = (doc, from) => {
  if (from <= 0) return ''
  return [...doc.textBetween(Math.max(0, from - 2), from, '\n', '\n')].pop() || ''
}
const charAfter = (doc, to) => {
  const end = doc.content.size
  if (to >= end) return ''
  return [...doc.textBetween(to, Math.min(end, to + 2), '\n', '\n')][0] || ''
}

/**
 * Every match of `term` in `doc`, as `{from, to}`.
 *  - `caseSensitive`: case must match (default: it need not).
 *  - `wholeWord`: a match must not have a letter, digit or mark right before
 *    or after it, so renaming the ticker `MU` leaves "much" and "community"
 *    alone and `AMD` does not touch `AMDL`. The neighbour is read across mark
 *    edges ("**MU**ch" is not a whole-word MU). No lookbehind anywhere (the
 *    iOS 16 floor): the boundary is checked by hand.
 */
export function findMatchesInDoc(doc, term, { caseSensitive = false, wholeWord = false } = {}) {
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
      const from = pos + m.index
      const to = from + m[0].length
      if (wholeWord && (WORD_CHAR.test(charBefore(doc, from)) || WORD_CHAR.test(charAfter(doc, to)))) {
        // Not a whole word here; a whole word may still START inside this
        // candidate ("aaa aa"), so resume one character on, not past it.
        re.lastIndex = m.index + 1
        continue
      }
      matches.push({ from, to })
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
