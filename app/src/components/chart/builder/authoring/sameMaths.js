// app/src/components/chart/builder/authoring/sameMaths.js
//
// ─── DO TWO DEFINITIONS CALCULATE THE SAME THING? (#500, Agent contract 2026-10-29) ──
//
// The Agent's "you already have this indicator" stop used to compare DISPLAY NAMES.
// Once derived names moved to plain words (#500), a member's indicator saved under the
// legacy formula wording ("(EMA 9 − EMA 20) ÷ EMA 20 × 100") stopped matching a new draft
// of the same maths ("EMA 9 vs EMA 20 %"). Owner ruling: decide duplicates by the
// CALCULATION — parameters, sources, timeframes, anything that changes a number — and
// ignore what only changes how it looks.
//
// ⭐ THREE ANSWERS, NOT TWO. `'same'` is claimed only when every rule below holds; a
// document this cannot fully read is `'unknown'`, never `'same'`. The Agent treats ONLY
// `'same'` as a duplicate, so an unknown can at worst miss a duplicate — it can never
// stop a member from saving something new.
//
// What "same" requires (contract §2):
//   * `compute.kind === 'ast'` on both (native/server/other kinds → unknown);
//   * each plot's tree, by canonical `astHash`, position for position in `plots[]` —
//     parameters, `tf` and `sym` are literals INSIDE the tree, so the hash covers them;
//   * the scan plot at the same position, band `edges` at the same positions;
//   * `definitionSemantics.semanticsOf` equal (this also covers a Pine origin);
//   * `meta.timeframes` the same set (absent = every timeframe);
//   * calculation-capable inputs equal by (type, default) in declaration order — a
//     `color` input, or an input referenced only from presentation (`$ref`s in plots /
//     paints), is ignored;
//   * `objects` empty on both, or deep-equal; otherwise unknown.
// Ignored: names, labels, descriptions, tags, ids, versions, colours, plot style / width /
// hidden / legend, placement, paints, and `compute.source` text (the tree decides, not
// the spelling).
//
// ⛔ CANONICAL FORM ONLY. `a + b` vs `b + a` is `'different'`: no algebra is attempted,
// because an equivalence this module cannot prove is exactly what it must not claim.
// ⛔ PURE: no I/O, never throws, never mutates its arguments. `reason` is a diagnostic
// for logs and tests — callers must not branch on its text.

import { astHash } from '../../engine/ast/parse'
import { semanticsOf } from '../../engine/definitionSemantics'

export const MATHS_VERDICTS = Object.freeze(['same', 'different', 'unknown'])

/** Input types whose value can reach a calculation. `color` never can. */
const CALC_INPUT_TYPES = Object.freeze(['int', 'float', 'bool', 'enum', 'string', 'source'])
const REF_RE = /^\$([A-Za-z][A-Za-z0-9_]*)$/

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const verdictOf = (verdict, reason) => Object.freeze({ verdict, reason })
const unknown = (reason) => verdictOf('unknown', reason)
const different = (reason) => verdictOf('different', reason)

/** Every `$key` named anywhere under `value` (plots and paints are presentation). */
function refsIn(value, out) {
  if (typeof value === 'string') {
    const m = REF_RE.exec(value)
    if (m) out.add(m[1])
  } else if (Array.isArray(value)) {
    for (const v of value) refsIn(v, out)
  } else if (isObj(value)) {
    for (const v of Object.values(value)) refsIn(v, out)
  }
  return out
}

/** Stable JSON with sorted keys — for deep equality of plain data only. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (isObj(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify(String(value))
  return JSON.stringify(value === undefined ? null : value)
}

const isEmpty = (v) => v === undefined || v === null
  || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0)

/**
 * The calculation signature of one definition, or `{ unknown: reason }` when the
 * document cannot be read fully enough to say what it calculates.
 */
function signatureOf(def) {
  if (!isObj(def)) return { unknown: 'not a definition document' }
  const compute = def.compute
  if (!isObj(compute)) return { unknown: 'no compute block' }
  if (compute.kind !== 'ast') return { unknown: `compute.kind ${JSON.stringify(compute.kind)} is not compared` }
  const plots = Array.isArray(def.plots) ? def.plots : null
  if (!plots || !plots.length) return { unknown: 'no plots' }

  const trees = isObj(compute.trees) ? compute.trees : null
  const keys = []
  const hashes = []
  for (let i = 0; i < plots.length; i += 1) {
    const p = plots[i]
    if (!isObj(p) || typeof p.key !== 'string' || !p.key) return { unknown: `plots[${i}] has no key` }
    let tree
    if (trees) tree = trees[p.key]
    else if (plots.length === 1) tree = compute.ast
    if (!isObj(tree)) return { unknown: `plots[${i}] (${p.key}) has no tree` }
    let h
    try { h = astHash(tree) } catch { return { unknown: `plots[${i}] (${p.key}) tree is not canonical` } }
    keys.push(p.key)
    hashes.push(h)
  }
  const posOf = (key) => keys.indexOf(key)

  let scan = 0
  if (trees) {
    scan = posOf(compute.scanPlot)
    if (scan < 0) return { unknown: 'scanPlot names no plot' }
  }

  const edges = plots.map((p, i) => {
    if (!isObj(p.edges)) return null
    const upper = posOf(p.edges.upper)
    const lower = posOf(p.edges.lower)
    return (upper < 0 || lower < 0) ? { bad: i } : [upper, lower]
  })
  const bad = edges.find((e) => e && e.bad !== undefined)
  if (bad) return { unknown: `plots[${bad.bad}] band edges name no plot` }

  const meta = isObj(def.meta) ? def.meta : {}
  let timeframes = null
  if (meta.timeframes !== undefined && meta.timeframes !== null) {
    if (!Array.isArray(meta.timeframes) || meta.timeframes.some((t) => typeof t !== 'string')) {
      return { unknown: 'meta.timeframes is malformed' }
    }
    timeframes = [...new Set(meta.timeframes)].sort()
  }

  const presentation = refsIn([def.plots, def.paints], new Set())
  const inputs = []
  for (const input of (Array.isArray(def.inputs) ? def.inputs : [])) {
    if (!isObj(input)) return { unknown: 'an input is malformed' }
    if (input.type === 'color') continue
    if (!CALC_INPUT_TYPES.includes(input.type)) return { unknown: `input type ${JSON.stringify(input.type)} is not compared` }
    if (presentation.has(input.key)) continue
    inputs.push([input.type, stable(input.default)])
  }

  return {
    hashes,
    scan,
    edges,
    semantics: semanticsOf(def),
    timeframes,
    inputs: stable(inputs),
    objects: isEmpty(def.objects) ? null : stable(def.objects),
  }
}

/**
 * @returns {{verdict: 'same'|'different'|'unknown', reason: string}} frozen.
 */
export function mathsVerdict(defA, defB) {
  try {
    const a = signatureOf(defA)
    if (a.unknown) return unknown(`first: ${a.unknown}`)
    const b = signatureOf(defB)
    if (b.unknown) return unknown(`second: ${b.unknown}`)
    if (a.hashes.length !== b.hashes.length) return different('a different number of outputs')
    for (let i = 0; i < a.hashes.length; i += 1) {
      if (a.hashes[i] !== b.hashes[i]) return different(`output ${i + 1} calculates something else`)
    }
    if (a.scan !== b.scan) return different('a different output is scanned')
    if (stable(a.edges) !== stable(b.edges)) return different('band edges differ')
    if (a.semantics !== b.semantics) return different('evaluation semantics differ')
    if (stable(a.timeframes) !== stable(b.timeframes)) return different('it runs on different timeframes')
    if (a.inputs !== b.inputs) return different('a calculation input differs')
    if (a.objects !== b.objects) return unknown('drawn objects differ and are not compared')
    return verdictOf('same', 'every calculation-affecting part matches')
  } catch {
    return unknown('could not be compared')
  }
}

/** Only a proven `'same'` is true. */
export function sameMaths(defA, defB) {
  return mathsVerdict(defA, defB).verdict === 'same'
}
