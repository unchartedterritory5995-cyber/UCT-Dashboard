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

/*
 * What a WORD is made of, in any script: a letter, a digit or a combining mark
 * (\p{L}\p{N}\p{M}). Whole-word matching refuses a match with one of these
 * right before or after it -- `\b` is ASCII-only and would split "café" or
 * "市场". And what glues ONE emoji together: a zero-width joiner (the family in
 * "👨‍👩‍👧") and a skin-tone modifier ("👍🏽"). A whole-word match never
 * splits an emoji sequence either. (U+FE0F, the emoji presentation selector in
 * "🛢️", is a mark, so \p{M} already covers it.)
 */
const GLUED_BEFORE = /[\p{L}\p{N}\p{M}\u200D]/u
const GLUED_AFTER = /[\p{L}\p{N}\p{M}\u200D\p{Emoji_Modifier}]/u
const ATTACHES_BACKWARD = /^[\p{M}\u200D\p{Emoji_Modifier}]/u
const ATTACHES_FORWARD = /\u200D$/u

/** True when [from, to) is NOT a whole word: something glues it to a neighbour. */
function gluedToANeighbour(doc, from, to, matched) {
  const before = charBefore(doc, from)
  const after = charAfter(doc, to)
  // A joiner or modifier at the match's own edge attaches it to a neighbour
  // only if that neighbour is something (not a space, not a block edge).
  const hasBefore = before !== '' && !/\s/u.test(before)
  const hasAfter = after !== '' && !/\s/u.test(after)
  return GLUED_BEFORE.test(before) || GLUED_AFTER.test(after)
    || (hasBefore && ATTACHES_BACKWARD.test(matched))
    || (hasAfter && ATTACHES_FORWARD.test(matched))
}

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
 *    edges ("**MU**ch" is not a whole-word MU), and an emoji sequence is never
 *    split (see GLUED_BEFORE). No lookbehind anywhere (the iOS 16 floor): the
 *    boundary is checked by hand.
 *
 * ⛔⛔ The scan must ALWAYS move forward (wave-5 re-review R1-B1). A rejected
 * candidate resumes one CODE POINT on, never one code unit: under the `u` flag
 * a `lastIndex` inside a surrogate pair is snapped back to the pair's start, so
 * `m.index + 1` on "NVDA🚀" re-found the same 🚀 forever and froze the tab on
 * every keystroke in the find field. Behind that, a progress guard: each
 * candidate must start strictly after the previous one, and if one ever does
 * not, this text node's scan stops (with a warning) instead of looping.
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
    let previousStart = -1
    let m
    while ((m = re.exec(node.text)) !== null) {
      // The progress guard: candidates start at strictly increasing offsets,
      // so this loop runs at most text.length times -- whatever the step does.
      if (m.index <= previousStart) {
        warnNoProgress(needle)
        break
      }
      previousStart = m.index
      // non-overlapping; an empty match cannot occur (the needle is non-empty)
      const from = pos + m.index
      const to = from + m[0].length
      if (wholeWord && gluedToANeighbour(doc, from, to, m[0])) {
        // Not a whole word here; a whole word may still START inside this
        // candidate ("aaa aa"), so resume one CODE POINT on (two units for an
        // astral character), never past the candidate and never mid-pair.
        re.lastIndex = m.index + codePointLength(m[0])
        continue
      }
      matches.push({ from, to })
    }
  })
  return matches
}

/** UTF-16 length of the first code point of `s`: 2 for an astral character. */
const codePointLength = (s) => (s.codePointAt(0) > 0xFFFF ? 2 : 1)

let warnedNoProgress = false
function warnNoProgress(needle) {
  if (warnedNoProgress) return
  warnedNoProgress = true
  // eslint-disable-next-line no-console
  console.warn('[noteFind] a find scan stopped making progress and was cut short', { needle })
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
