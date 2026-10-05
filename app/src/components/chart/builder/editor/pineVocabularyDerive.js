// app/src/components/chart/builder/editor/pineVocabularyDerive.js
//
// ─── A6 — THE PINE EDITOR'S VOCABULARY, DERIVED ─────────────────────────────
//
// ⛔⛔ NOT A HAND-TYPED LIST. Two authorities, each asked for the one fact it
// owns, and nothing typed in between:
//
//   1. THE ENGINE says WHICH NAMES IT HOLDS — the closed table's `functions`
//      (`closedTable.json`, through `parse.js::TABLE`), `PINE_CALL_SHAPES`,
//      `PINE_SHORT_FORM`, `BUILTIN_CALL_TREE`, and every exported built-in tree
//      `pine.js` resolves a full spelling through (`PINE_NAMESPACED_TREE`,
//      `barstate.*`, `timeframe.*`, `syminfo.*`, `dayofweek.*`, `math.pi`, the
//      output and paint calls, the folded `input.*` kinds, the palette).
//      `normaliseName` is the translator's own (lowercase, underscores dropped).
//
//   2. REAL PINE says HOW A NAME IS SPELLED IN EACH VERSION. The translator
//      resolves `ta.sma` and `math.sma` alike (both namespaces reach the same
//      table — `VALUE_NAMESPACES`), so it cannot say which one TradingView
//      means. The committed, licence-cleared corpus can: every script is lexed
//      with the engine's own `lexPine` (which also reads `//@version=`), and a
//      spelling is offered for version N only when a version-N script uses it.
//      So v4 offers `sma(` and v5/v6 offer `ta.sma(` — measured, not assumed.
//
// ⭐ THE RESULT IS FROZEN in `pineVocabulary.json` (the browser cannot read the
// corpus) and `pineVocabulary.test.js` RE-DERIVES IT and fails on any drift — a
// table function added or dropped, a corpus script added — and separately asks
// the translator to resolve every frozen spelling. Regenerate with
// `UPDATE_PINE_VOCAB=1 npx vitest run src/components/chart/builder/editor/pineVocabulary.test.js`.
//
// ⚠️ v5 AND v6 FILL EACH OTHER'S GAPS for a name only one of them spells in the
// corpus. Pine v6 renamed no `ta.*`/`math.*` value function (the v5→v6
// migration changes types, `na` handling and some `request`/`strategy`
// arguments), so a v5 spelling is the v6 spelling unless evidence says
// otherwise. v4 borrows NOTHING: its spellings are bare and the namespaced
// form would be wrong there.

import { TABLE } from '../../engine/ast/parse'
import {
  PINE_CALL_SHAPES, PINE_SHORT_FORM, BUILTIN_CALL_TREE, PINE_NAMESPACED_TREE, PINE_MATH_CONSTANTS,
  BUILTIN_CONSTANT_TREE, BUILTIN_CALENDAR_TREE, BUILTIN_TIMEFRAME_ALIAS, BUILTIN_TIMEFRAME_SCALAR,
  BUILTIN_TIMEFRAME_CALL, BUILTIN_BARSTATE_SERIES, BUILTIN_SYMBOL_SCOPED, BUILTIN_SYMBOL_NUMERIC,
  PINE_TEXT_PREDICATE, OUTPUT_CALLS, PAINT_CALLS, VALUE_NAMESPACES, derivedSeriesTree, lexPine, translatePine,
} from '../../engine/ast/pine'
import { FOLDED_INPUT_TYPES } from '../builderInputs'
import { isPineColourSpelling } from '../../engine/pinePalette'

/** The translator's own key normalisation (`pine.js::normaliseName`). */
export const normaliseName = (name) => String(name).toLowerCase().replace(/_/g, '')

/** The version buckets the editor offers. `≤4` (and a versionless script, which
 *  Pine reads as v1) spell value functions bare. */
export const VERSIONS = Object.freeze([4, 5, 6])
export const bucketOf = (version) => (Number.isFinite(version) && version >= 6 ? 6
  : Number.isFinite(version) && version === 5 ? 5 : 4)

const keysOf = (obj) => (obj instanceof Set ? [...obj] : Object.keys(obj || {}))

/** short (normalised) → the table key it reaches, or null for a built-in tree. */
export function engineShortNames(table = TABLE) {
  const out = new Map()
  const fnKeys = Object.keys((table && table.functions) || {})
  const byNorm = new Map()
  for (const k of fnKeys) if (!byNorm.has(normaliseName(k))) byNorm.set(normaliseName(k), k)
  for (const k of fnKeys) out.set(normaliseName(k), k)
  for (const [k, shape] of Object.entries(PINE_CALL_SHAPES)) {
    out.set(normaliseName(k), byNorm.get(normaliseName(shape.table)) || null)
  }
  for (const k of keysOf(PINE_SHORT_FORM)) if (!out.has(normaliseName(k))) out.set(normaliseName(k), byNorm.get(normaliseName(k)) || null)
  for (const k of keysOf(BUILTIN_CALL_TREE)) if (!out.has(normaliseName(k))) out.set(normaliseName(k), null)
  return out
}

/** Every FULL spelling the translator resolves through one of its exported trees. */
export function engineFullNames(table = TABLE) {
  const out = new Set()
  for (const t of [PINE_NAMESPACED_TREE, PINE_MATH_CONSTANTS, BUILTIN_CONSTANT_TREE, BUILTIN_CALENDAR_TREE,
    BUILTIN_TIMEFRAME_ALIAS, BUILTIN_TIMEFRAME_SCALAR, BUILTIN_TIMEFRAME_CALL, BUILTIN_BARSTATE_SERIES,
    BUILTIN_SYMBOL_SCOPED, BUILTIN_SYMBOL_NUMERIC, PINE_TEXT_PREDICATE, OUTPUT_CALLS, PAINT_CALLS,
    FOLDED_INPUT_TYPES, (table && table.series) || {}]) {
    for (const k of keysOf(t)) out.add(k)
  }
  return out
}

/** A refusal that means "the engine does not hold this NAME". Any other refusal
 *  (arity, argument roles, a colour in a column…) means the name RESOLVED. */
export const UNKNOWN_NAME_GUARDS = Object.freeze(new Set(['pine:function', 'pine:builtin', 'pine:undefined']))

/** ⭐⭐ THE TRANSLATOR IS ASKED, NOT PREDICTED: does the host lane resolve
 *  `label` under Pine `version` in at least one shape — a value, a call, a
 *  condition, a text argument, a timeframe argument? The output and paint calls
 *  are statements (no value shape can hold them) and are the engine's own
 *  declared sets, so they are taken from those sets. */
export function translatorResolves(label, version) {
  if (Object.prototype.hasOwnProperty.call(OUTPUT_CALLS, label) || keysOf(PAINT_CALLS).includes(label)) return true
  const forms = [`plot(${label})`, `plot(${label}(close, 14))`, `plot(${label}(close > open) ? 1 : 0)`,
    `plot(${label}(syminfo.ticker, "A") ? 1 : 0)`, `plot(${label}("D"))`]
  return forms.some((body) => {
    const t = translatePine(`//@version=${version}
indicator("p")
${body}`, { strict: true })
    return !t.refusal || !UNKNOWN_NAME_GUARDS.has(t.refusal.guard)
  })
}

/** Is this bare/dotted spelling one the engine holds, and under which short key? */
function classify(w, shorts, fulls, table) {
  const dot = w.indexOf('.')
  if (dot > 0) {
    const head = w.slice(0, dot)
    const rest = w.slice(dot + 1)
    // ⛔ A short name the engine ALREADY OWNS UNDER ANOTHER NAMESPACE is not this
    // one: `PINE_NAMESPACED_TREE` holds `math.max`, and Pine's `ta.max(x)` is the
    // all-time high of `x` — a different function the namespace-blind index
    // would otherwise map onto the same two-argument `max`.
    const ownedElsewhere = [...VALUE_NAMESPACES].some((ns) => ns !== head && fulls.has(`${ns}.${rest}`))
    if (VALUE_NAMESPACES.has(head) && shorts.has(normaliseName(rest)) && !fulls.has(w) && !ownedElsewhere) {
      return { short: normaliseName(rest), key: shorts.get(normaliseName(rest)) }
    }
    if (fulls.has(w) || isPineColourSpelling(w)) return { short: null, key: null }
    return null
  }
  if (fulls.has(w)) return { short: null, key: null }
  if (shorts.has(normaliseName(w))) return { short: normaliseName(w), key: shorts.get(normaliseName(w)), bare: true }
  if (derivedSeriesTree(w, table)) return { short: null, key: null }
  return null
}

/**
 * Derive the vocabulary.
 *
 * @param {string[]} sources the corpus scripts (text)
 * @returns {Array<{label: string, versions: number[], call: boolean, key: string|null}>}
 *   sorted by label; `key` is the closed-table function the spelling reaches
 *   (the hover reads its sentence), null for a built-in tree.
 */
export function deriveVocabulary(sources, table = TABLE) {
  const shorts = engineShortNames(table)
  const fulls = engineFullNames(table)
  // bucket → spelling → {files, calls, uses, key, short}
  const seen = new Map(VERSIONS.map((v) => [v, new Map()]))
  for (const src of sources) {
    let lexed
    try { lexed = lexPine(src) } catch { continue }
    const bucket = bucketOf(lexed.version)
    const toks = lexed.tokens || []
    // A script's own function definition (`name(a) =>`) is not evidence of a built-in.
    const arrowLines = new Set(toks.filter((u) => u.kind === 'punct' && u.value === '=>').map((u) => u.line))
    const defined = new Set()
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]
      if (t.kind !== 'ident' || !toks[i + 1] || toks[i + 1].value !== '(') continue
      const prev = toks[i - 1]
      if (prev && prev.line === t.line) continue
      if (arrowLines.has(t.line)) defined.add(t.value)
    }
    const fileSeen = new Set()
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]
      if (t.kind !== 'ident' || defined.has(t.value)) continue
      // `plot(…, bgcolor = x)` — a NAMED ARGUMENT, not a use of the built-in.
      if (toks[i + 1] && toks[i + 1].kind === 'punct' && toks[i + 1].value === '=') continue
      const c = classify(t.value, shorts, fulls, table)
      if (!c) continue
      const isCall = !!(toks[i + 1] && toks[i + 1].kind === 'punct' && toks[i + 1].value === '(')
      // A bare SHORT name counts only as a call: `avg = …` is a member's variable.
      if (c.bare && !isCall) continue
      const m = seen.get(bucket)
      const rec = m.get(t.value) || { files: 0, calls: 0, uses: 0, key: c.key, short: c.short }
      rec.uses += 1
      if (isCall) rec.calls += 1
      if (!fileSeen.has(t.value)) { rec.files += 1; fileSeen.add(t.value) }
      m.set(t.value, rec)
    }
  }
  // One spelling per (bucket, short): the most-used one the translator RESOLVES
  // in that version. Full spellings stand alone.
  const chosen = new Map(VERSIONS.map((v) => [v, new Map()]))
  for (const v of VERSIONS) {
    const byShort = new Map()
    for (const [label, rec] of seen.get(v)) {
      if (!translatorResolves(label, v)) continue
      if (rec.short === null) { chosen.get(v).set(label, rec); continue }
      const cur = byShort.get(rec.short)
      if (!cur || rec.uses > cur[1].uses || (rec.uses === cur[1].uses && label < cur[0])) byShort.set(rec.short, [label, rec])
    }
    for (const [label, rec] of byShort.values()) chosen.get(v).set(label, rec)
  }
  // v5 and v6 fill each other's gaps (see header); v4 never borrows.
  const fill = (to, from) => {
    const have = new Set([...chosen.get(to).values()].map((r) => r.short).filter(Boolean))
    for (const [label, rec] of seenChosen(from)) {
      if (rec.short !== null ? !have.has(rec.short) : !chosen.get(to).has(label)) chosen.get(to).set(label, rec)
    }
  }
  const snapshot = new Map(VERSIONS.map((v) => [v, new Map(chosen.get(v))]))
  const seenChosen = (v) => snapshot.get(v)
  fill(6, 5)
  fill(5, 6)
  const out = new Map()
  for (const v of VERSIONS) {
    for (const [label, rec] of chosen.get(v)) {
      const e = out.get(label) || { label, versions: [], calls: 0, uses: 0, key: rec.key || null }
      e.versions.push(v)
      e.calls += rec.calls
      e.uses += rec.uses
      out.set(label, e)
    }
  }
  return [...out.values()]
    .map((e) => ({ label: e.label, versions: e.versions.sort(), call: e.calls * 2 >= e.uses, key: e.key }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
}
