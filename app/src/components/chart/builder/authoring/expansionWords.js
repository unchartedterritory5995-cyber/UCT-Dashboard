// app/src/components/chart/builder/authoring/expansionWords.js
//
// ─── ⭐ BATCH 2 — THE READ-BACK SAYS "LINEAR REGRESSION", NOT ITS ARITHMETIC ──────
//
// A definition stores `linreg(close, 50, 0)` as the tree it IS (sum, wma and a
// constant — `callExpansions.js`). Read back literally that is a paragraph of
// arithmetic nobody asked for. `describeTree` recognises each expansion
// STRUCTURALLY (`recogniseExpansion` rebuilds it and compares), says it in a few
// words, and lets the shipped sentence writer (`sentence.js`, untouched) say the
// rest: each recognised subtree is swapped for a placeholder name the sentence
// writer reads as an input, and the placeholder's words are put back.
//
// ⛔ A tree with no recognised expansion is sentenceFor's own sentence, byte for byte.

import { sentenceFor } from '../../engine/ast/sentence'
import { recogniseExpansion } from '../../engine/ast/callExpansions'

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(6))))
const numOf = (t) => (t && t.type === 'num' ? t.value
  : (t && t.type === 'op' && t.name === 'u-' && t.args && t.args[0] && t.args[0].type === 'num' ? -t.args[0].value : NaN))

/** The member words for one recognised expansion. */
function phraseOf(hit, scope) {
  const say = (t) => describeTree(t, scope)
  const [a0, a1, a2] = hit.args
  const n = fmt(numOf(a1))
  switch (hit.name) {
    case 'linreg': {
      const off = a2 === undefined ? 0 : numOf(a2)
      return `the ${n}-bar linear regression of ${say(a0)}${off ? `, read ${fmt(off)} bar${off === 1 ? '' : 's'} back` : ''}`
    }
    case 'correlation': return `the ${fmt(numOf(a2))}-bar correlation of ${say(a0)} with ${say(a1)}`
    case 'vwma': return `the ${n}-bar volume-weighted average of ${say(a0)}`
    case 'roc': return `the ${n}-bar rate of change of ${say(a0)}, in percent`
    case 'mom': return `the ${n}-bar momentum of ${say(a0)}`
    case 'kcMiddle': return `the ${n}-bar Keltner Channel middle line of ${say(a0)}`
    case 'kcUpper':
    case 'kcLower': return `the ${hit.name === 'kcUpper' ? 'upper' : 'lower'} Keltner Channel band of ${say(a0)} (${n} bars, ${say(a2)} × the average true range)`
    default: return hit.name
  }
}

/** `sentenceFor`, with every recognised expansion said by name. Throws as sentenceFor does. */
export function describeTree(tree, scope = {}) {
  const subs = []
  const swap = (node) => {
    if (!node || typeof node !== 'object') return node
    const hit = recogniseExpansion(node)
    if (hit) {
      const name = `zzexpansion${subs.length}`
      subs.push({ name, hit })
      return { type: 'series', name }
    }
    if (!Array.isArray(node.args)) return node
    let changed = false
    const args = node.args.map((a) => { const x = swap(a); if (x !== a) changed = true; return x })
    return changed ? { ...node, args } : node
  }
  const swapped = swap(tree)
  if (!subs.length) return sentenceFor(tree, scope)
  const withPlaceholders = { ...(scope || {}) }
  for (const s of subs) withPlaceholders[s.name] = true
  let text = sentenceFor(swapped, withPlaceholders)
  for (const s of subs) text = text.split(`the input ${s.name}`).join(phraseOf(s.hit, scope))
  return text
}

// ─── ⭐ the condition words (moved from `readback.js`, unchanged) ─────────────────

export const RELATION_WORDS = Object.freeze({
  '>': 'is above', '<': 'is below', '>=': 'is at or above', '<=': 'is at or below', '==': 'equals', '!=': 'does not equal',
})
const isLogical = (n) => !!n && n.type === 'op' && (n.name === '&&' || n.name === '||')
const isTruthOp = (n) => !!n && n.type === 'op' && (!!RELATION_WORDS[n.name] || isLogical(n) || n.name === '!')

/**
 * A yes/no tree built ONLY from comparisons of numbers joined by and / or / not,
 * said as the condition it is ("the 14-bar RSI of close is above 70 and …");
 * null for anything else, which then keeps `sentence.js`'s exact sentence. The
 * operands are `sentence.js`'s own phrases — this adds relation and join words.
 *
 * EXACT: a comparison is 1 or 0 (or, under semantics 2, unknown — never 1), and
 * over such values `&&` / `||` / `!` are 1 exactly when the plain logic words are
 * true. So "true when P" is the bar set the engine marks 1. What an UNKNOWN bar
 * shows is the semantics line's job, not this sentence's.
 */
export function conditionWords(node, scope) {
  if (!node || node.type !== 'op' || !Array.isArray(node.args)) return null
  if (RELATION_WORDS[node.name] && node.args.length === 2) {
    if (node.args.some(isTruthOp)) return null // a yes/no compared as a number: keep the exact sentence
    return `${describeTree(node.args[0], scope)} ${RELATION_WORDS[node.name]} ${describeTree(node.args[1], scope)}`
  }
  if (isLogical(node) && node.args.length === 2) {
    const parts = []
    for (const c of node.args) {
      const p = conditionWords(c, scope)
      if (p === null) return null
      parts.push(isLogical(c) && c.name !== node.name ? `(${p})` : p)
    }
    return parts.join(node.name === '&&' ? ' and ' : ' or ')
  }
  if (node.name === '!' && node.args.length === 1) {
    const p = conditionWords(node.args[0], scope)
    return p === null ? null : `not (${p})`
  }
  return null
}
