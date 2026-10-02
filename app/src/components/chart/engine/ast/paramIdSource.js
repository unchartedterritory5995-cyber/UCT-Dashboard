// app/src/components/chart/engine/ast/paramIdSource.js
//
// ─── C46 — A PARAMETER ID IS A FUNCTION OF THE SCRIPT'S SOURCE ───────────────
//
// `__uct_param_N` used to be a COUNTER: the N-th input the translation walk
// happened to resolve first. Which inputs the walk reaches, and in what order,
// is a property of what the translator can FOLD — so every translator
// improvement that folded one more block renumbered ids it had no business
// touching (objects triage § C46 has the three measured cases).
//
// The id is now read off the source alone:
//
//   1. THE FROZEN LEGACY MAP WINS. A script whose token stream hashes to an
//      entry of `paramIdLegacy.js` keeps, for each input call that entry names,
//      exactly the id the counter gave it on the day the map was frozen
//      (`docs/pine/param-ids.json` is the same fact, by title).
//   2. EVERYTHING ELSE IS `SOURCE_ID_BASE + n`, where `n` is the input call's
//      1-based ORDINAL among the script's `input(…)` / `input.*(…)` calls in
//      token order. The base keeps the two ranges disjoint: a legacy id is a
//      small dense number, a source id is above a thousand, so an id minted
//      under one rule can never alias an id saved under the other.
//
// Nothing here reads a parsed node, a binding, or a resolved value: the token
// stream is the only input, which is what makes the result independent of how
// much of the script translates.
//
// ⛔ PURE AND DEPENDENCY-FREE. `pine.js` imports this; this imports nothing.

/** Source ids start above this. A legacy id is a dense counter (the largest in
 *  the frozen map is far below it), so the two ranges cannot meet. */
export const SOURCE_ID_BASE = 1000

export const PARAM_ID_PREFIX = '__uct_param_'

const isInputCallAt = (tokens, i) => {
  const t = tokens[i]
  if (!t || t.kind !== 'ident' || typeof t.value !== 'string') return false
  if (t.value !== 'input' && !t.value.startsWith('input.')) return false
  const next = tokens[i + 1]
  return !!(next && next.kind === 'punct' && next.value === '(')
}

/** Every `input(…)` / `input.*(…)` call in the script, in token order.
 *  @returns {Array<{line: number, column: number}>} */
export function inputCallSites(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i += 1) {
    if (isInputCallAt(tokens, i)) out.push({ line: tokens[i].line, column: tokens[i].column })
  }
  return out
}

const before = (a, b) => a.line < b.line || (a.line === b.line && a.column < b.column)

/** The 1-based ordinal of the input call whose first token is `tok`.
 *
 *  ⛔ TOTAL, NEVER NULL. A call node whose token is not one of `sites` (a node a
 *  rewrite built) still gets a number that depends on the source alone: one more
 *  than the count of input calls written before it. */
export function sourceOrdinalOf(sites, tok) {
  let n = 0
  for (const s of sites) {
    if (s.line === tok.line && s.column === tok.column) return n + 1
    if (before(s, tok)) n += 1
  }
  return n + 1
}

/** cyrb53 — a 53-bit string hash, synchronous and dependency-free. */
function cyrb53(str) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** The script's identity for the frozen map: a hash of its TOKEN STREAM, so
 *  line endings, blank lines and comments — none of which the lexer emits — do
 *  not make a member's paste a different script from the one that was pinned. */
export function scriptKey(tokens) {
  let s = ''
  for (const t of tokens) s += `${t.kind}\u0001${t.value}\u0002`
  return cyrb53(s).toString(36)
}

/** Which of the frozen map's lanes a translation is in — read off the options
 *  the caller passed, never off what the walk managed to fold.
 *
 *  The counter numbered what each DOOR minted, and the doors mint different
 *  sets: a member door (`declareInputs`) carries an input a formula can hold as
 *  an identifier instead of minting it, and the screen lane resolves what the
 *  host lane refuses. Same script, different numbers — so the frozen map keeps
 *  one list per lane. (A source id does not depend on the lane at all.)
 *  @returns {number} an index into `LEGACY_LANES` */
export function legacyLaneOf(opts) {
  const member = !!(opts && opts.declareInputs)
  const strict = !!(opts && opts.strict === true)
  if (member) return strict ? 2 : 3
  return strict ? 0 : 1
}

/** One lane of a frozen entry, decoded: `out[k]` is the source ordinal of the
 *  input call that holds legacy id `k + 1`. `null` when the lane mints nothing. */
export function decodeLegacyLane(encoded, lane) {
  if (typeof encoded !== 'string') return null
  const lanes = encoded.split('|')
  let text = lanes[lane]
  if (typeof text === 'string' && text.startsWith('=')) text = lanes[Number(text.slice(1))]
  if (!text) return null
  return text.split('.').map((x) => parseInt(x, 36))
}

/** The id of the input call with source ordinal `ordinal`.
 *  @param {number[]|null|undefined} legacy the frozen map's entry for this
 *         script: `legacy[k]` is the source ordinal that holds legacy id `k + 1`. */
export function paramIdFor(legacy, ordinal) {
  if (legacy) {
    const at = legacy.indexOf(ordinal)
    if (at >= 0) return `${PARAM_ID_PREFIX}${at + 1}`
  }
  return `${PARAM_ID_PREFIX}${SOURCE_ID_BASE + ordinal}`
}

/** The number inside an id, for ordering a manifest. */
export function paramIdNumber(id) {
  return Number(String(id).slice(PARAM_ID_PREFIX.length))
}
