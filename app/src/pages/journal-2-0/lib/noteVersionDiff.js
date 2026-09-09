/**
 * Wave C (Version History) — word-level plain-text diff between two note
 * bodies. Pure, framework-free (same convention as noteFind.js) — diffs
 * body_plain, never body_json/HTML, so there is no rich-content rendering
 * risk here at all (directive §30's "do not inject raw HTML into an unsafe
 * diff renderer" concern doesn't apply: this never touches markup).
 *
 * Classic LCS (longest-common-subsequence) word diff via dynamic
 * programming — the "simplest robust representation" the directive asks
 * for (§29/§75), not an enormous semantic diff engine. Splits on
 * whitespace, keeping the separators so the reconstructed text preserves
 * original spacing.
 */

// Defensive cap: LCS is O(n*m). Real notes run to low thousands of words: at
// 2000x2000 that's 4M table cells, comfortably fast. Refuse (rather than
// hang the tab) past a size where the table would get expensive -- this is
// the "diff on a realistically large note remains usable" exit gate
// (directive §114) expressed as an explicit ceiling, not a hope.
export const DIFF_MAX_WORDS_PRODUCT = 4_000_000

function tokenize(text) {
  // Each word is glued to ITS OWN *leading* whitespace into one token
  // (" word", not " " + "word" as two separate tokens). Found live (via
  // this file's own test suite, twice): splitting whitespace into
  // standalone tokens lets the LCS match on a bare space between two
  // otherwise completely different sentences, fragmenting what should
  // read as "these N words were replaced by these M words" into an
  // alternating wall of tiny removed/added/equal-space spans.
  //
  // Gluing to the *trailing* space instead (tried first) has its own bug:
  // the last word before an insertion point carries no trailing space in
  // one text but does in the other the moment something follows it, so a
  // pure "append a word at the end" turns the final unchanged word into a
  // spurious removed+added pair. Leading-glue doesn't have that failure
  // mode because a word's leading whitespace is fixed by what comes
  // BEFORE it, which an append never changes.
  //
  // `\s*\S+` covers a word plus any run of whitespace before it; `\s+$`
  // catches trailing whitespace with no following word. Together they
  // partition the string with no gaps, so reconstructing every token in
  // order always recovers the original text exactly.
  if (!text) return []
  const matches = text.match(/\s*\S+|\s+$/g)
  return matches || []
}

/**
 * Returns `{ ops, tooLargeToDiff }`. `ops` is an array of
 * `{ type: 'equal' | 'added' | 'removed', text }` in DISPLAY order (removed
 * spans from the old text appear before the added spans that replace them,
 * matching how a reader scans "what did this used to say, what does it say
 * now"). `tooLargeToDiff` is true when the defensive size cap was hit --
 * the caller should show a "too large to diff, view each version
 * individually" message rather than blocking rendering.
 */
export function diffNoteBodies(oldText, newText) {
  const a = tokenize(oldText)
  const b = tokenize(newText)

  if (a.length * b.length > DIFF_MAX_WORDS_PRODUCT) {
    return { ops: [], tooLargeToDiff: true }
  }

  // Standard LCS length table.
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  // Walk the table to emit ops, then merge consecutive same-type tokens
  // into spans (a run of 40 unchanged words should render as one span, not
  // 40 tiny ones).
  const raw = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ type: 'equal', text: a[i] })
      i++; j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      raw.push({ type: 'removed', text: a[i] })
      i++
    } else {
      raw.push({ type: 'added', text: b[j] })
      j++
    }
  }
  while (i < n) { raw.push({ type: 'removed', text: a[i] }); i++ }
  while (j < m) { raw.push({ type: 'added', text: b[j] }); j++ }

  const ops = []
  for (const op of raw) {
    const last = ops[ops.length - 1]
    if (last && last.type === op.type) last.text += op.text
    else ops.push({ ...op })
  }
  return { ops, tooLargeToDiff: false }
}

/** True when a diff has no added/removed spans at all -- the two bodies are
 * identical (word-token-wise). Lets the UI show "no changes" instead of an
 * all-equal wall of text. */
export function diffHasChanges(ops) {
  return ops.some((op) => op.type !== 'equal')
}
