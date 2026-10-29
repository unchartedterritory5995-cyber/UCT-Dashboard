// app/src/components/chart/engine/ast/formulaHints.js
//
// ─── ⭐ ONE SHORT, ACTIONABLE LINE FOR A REFUSED FORMULA ─────────────────────────
//
// The engine's refusals are exact and they are pinned — word for word, across two
// interpreters (`interpret.js` ⇄ `ast_interpret.py`) and by the escape census — so
// they are NOT rewritten here. What they are not is helpful to a member who typed
// `avg(close, 20)`: the answer ("write `sma(close, 20)`") sits behind a list of
// every one of ~80 declared names (audit 2026-10-13, P2-7).
//
// ⭐ THIS IS A READER OF THE REFUSAL, NEVER A SECOND AUTHORITY OVER WHAT IS LEGAL.
// It is shown BESIDE the engine's message, it never changes whether a formula
// saves, and every name it suggests is checked against the closed table or the
// expansion list at call time — a hint naming something that does not parse is a
// rail failure (`formulaHints.test.js` parses every suggestion it can produce).
//
// Sources, in order:
//   1. the table's own RULINGS (`_functions_excluded`) — a name the manifest has
//      already ruled on gets that ruling's spelling, e.g. `hl2` → `(high + low) / 2`;
//   2. SPELLINGS OTHER PLATFORMS USE for a function this table already has
//      (`avg` → `sma`, `smma` → `rma`, `stddev` → `stdev` …);
//   3. a SIGNATURE for a wrong argument count, read off the table's `argRoles`;
//   4. a did-you-mean over the declared names (`sentence.js::didYouMean`).
// Silent (null) when none applies: a wrong guess is worse than none.

import TABLE_JSON from './closedTable.json'
import HINTS from './formulaHints.json'
import { didYouMean } from './sentence.js'
import { CALL_EXPANSIONS, EXPANSION_NAMES } from './callExpansions.js'

const FUNCTIONS = TABLE_JSON.functions
const SERIES = TABLE_JSON.series
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k)

/** `name(role, role, …)` from the table's declared argument roles, or the
 *  expansion's own signature. */
export function signatureOf(name) {
  if (own(CALL_EXPANSIONS, name)) return CALL_EXPANSIONS[name].signature
  const spec = FUNCTIONS[name]
  if (!spec) return null
  const roles = Array.isArray(spec.argRoles) ? spec.argRoles : (spec.args || []).map((_, i) => `arg${i + 1}`)
  return `${name}(${roles.join(', ')})`
}

/** The hint tables (`formulaHints.json`) — data, so this module is not an enumeration site. */
const RULED = Object.freeze(HINTS.ruled)
/** What other platforms call a function this table already has. */
const SPELLINGS = Object.freeze(HINTS.spellings)
/** Arity mistakes common enough to deserve their own sentence: `{args, say}`. */
const ARITY = Object.freeze(HINTS.arity)

const quoted = (error) => {
  const m = /"([^"]+)"/.exec(String(error || ''))
  return m ? m[1] : null
}
const declaredFunctionNames = () => [...Object.keys(FUNCTIONS), ...EXPANSION_NAMES]

/** Ruled names are camelCase in the manifest (`bbUpper`); a member types any case. */
const RULED_BY_LOWER = Object.freeze(Object.fromEntries(Object.keys(RULED).map((k) => [k.toLowerCase(), k])))

function nameHint(name) {
  if (!name) return null
  const key = name.toLowerCase()
  if (own(RULED_BY_LOWER, key)) {
    const r = RULED[RULED_BY_LOWER[key]]
    if (r.not) return `${r.not}.`
    return `\`${name}\` is written \`${r.instead}\` here${r.why ? ` — ${r.why}` : ''}.`
  }
  if (own(SPELLINGS, key) && !own(FUNCTIONS, key) && !own(SERIES, key)) {
    return `UCT writes this as \`${SPELLINGS[key]}\`.`
  }
  return null
}

/** A did-you-mean line from `sentence.js`'s own matcher, reworded as a sentence. */
function nearHint(name, candidates) {
  const d = didYouMean(name, candidates)
  return d ? `Did you mean ${d.replace(/^ — did you mean /, '').replace(/\?$/, '')}?` : null
}

/**
 * The one-line hint for a refused formula, or null.
 * @param {{guard?: string, error?: string}} result  — `evaluateFormula`'s refusal shape
 */
export function formulaHint(result) {
  if (!result || typeof result.error !== 'string' || !result.error) return null
  const { guard, error } = result
  if (guard === 'resolve:function') {
    const name = quoted(error)
    return nameHint(name) || nearHint(name, declaredFunctionNames())
      || (name ? `\`${name}\` is not a function UCT formulas have. The Formula reference lists every one.` : null)
  }
  if (guard === 'sentence:name' || guard === 'resolve:name') {
    const name = quoted(error)
    return nameHint(name) || nearHint(name, [...Object.keys(SERIES), ...Object.keys(TABLE_JSON.scalars || {})])
  }
  if (guard === 'resolve:arity') {
    const m = /—\s*([A-Za-z_][A-Za-z0-9_]*) expects \d+ arguments?, got (\d+)/.exec(error)
    if (!m) return null
    const [, name, got] = m
    const special = ARITY[name]
    if (special && special.args === Number(got)) return `${special.say}.`
    const sig = signatureOf(name)
    return sig ? `\`${name}\` is written \`${sig}\`.` : null
  }
  if (guard === 'resolve:window') {
    const m = /—\s*([A-Za-z_][A-Za-z0-9_]*) argument/.exec(error)
    const sig = m ? signatureOf(m[1]) : null
    return 'A length is written as a whole number (`sma(close, 20)`), or as an input you add under Inputs'
      + (sig ? ` — \`${sig}\`` : '') + '.'
  }
  if (guard === 'resolve:expansion') return null // the expansion's own sentence already names the fix
  return null
}

/** Every formula a hint can tell a member to write — so a rail can parse them all. */
export function suggestedFormulas() {
  const out = []
  for (const r of Object.values(RULED)) if (r.instead) out.push(r.instead)
  for (const s of Object.values(SPELLINGS)) out.push(s)
  for (const s of HINTS.alsoSuggested || []) out.push(s)
  return out
}
