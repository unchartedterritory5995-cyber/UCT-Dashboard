// app/src/pages/formulas/referenceSentence.js
//
// ─── THE REFERENCE PAGE'S SENTENCE, WITH ITS ARGUMENTS NAMED ─────────────────
//
// The manifest's `sentence` for a function or an operator is a TEMPLATE:
// `"the {1}/{2} MACD line of {0}"`. `sentence.js` fills it with the phrases of a
// real formula's operands. The reference page has no formula, so it printed the
// template as it stood, and a member read "the absolute value of {0}" under
// `abs(series)` (seen on production, 2026-11-14: 85 of the 86 functions and
// every operator).
//
// ⛔ NOTHING IS WRITTEN HERE. Each `{n}` becomes the n-th argument name of the
// SIGNATURE shown directly above the sentence (`vocabulary.js::signatureOf`), so
// the two lines on the page name the same things: `atr(high, low, close, period)`
// reads "the period-bar average true range of high, low and close". An operator's
// signature is its symbol and names no operands, so its operands are `a` and `b`.
//
// ⛔ A PLACEHOLDER WITH NO ARGUMENT TO NAME IT IS LEFT AS IT IS. Inventing a word
// for it would hide a manifest entry whose sentence and arguments disagree.

const PLACEHOLDER = /\{(\d+)\}/g
const OPERAND_NAMES = Object.freeze(['a', 'b', 'c'])

/** The argument names an entry's sentence may refer to, in position order. */
export function referenceArgs(item) {
  if (!item) return []
  if (item.kind === 'operator') return OPERAND_NAMES
  const sig = typeof item.signature === 'string' ? item.signature : ''
  const open = sig.indexOf('(')
  const close = sig.lastIndexOf(')')
  if (open < 0 || close <= open) return []
  return sig.slice(open + 1, close).split(',').map((s) => s.trim()).filter(Boolean)
}

/** `item.sentence` with every `{n}` replaced by the name of argument n. */
export function referenceSentence(item) {
  const sentence = item && typeof item.sentence === 'string' ? item.sentence : ''
  if (!sentence) return ''
  const args = referenceArgs(item)
  return sentence.replace(PLACEHOLDER, (whole, n) => {
    const name = args[Number(n)]
    return typeof name === 'string' && name ? name : whole
  })
}
