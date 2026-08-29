// app/src/components/chart/engine/ast/doorCoverage.js
//
// ─── 🔴 WHICH DOORS CAN REACH WHAT THE ENGINE ALREADY HAS ───────────────────
//
// ⛔⛔ THE FINDING THIS EXISTS FOR, and it reframes the whole import program: a
// language-surface sweep on 2026-08-29 concluded that most of the gap between us
// and TradingView "is not missing capability — it is SHIPPED capability the door
// cannot reach." `pow` and `valuewhen` are declared, computed and correct from
// the native builder, and no member can reach either by pasting Pine.
//
// ⛔ AND NOTHING MEASURED IT. The corpus can only ever exercise the names 75
// chosen scripts happen to use, so a declared function no fixture calls can be
// unreachable from every importer forever with every gate green
// (`lesson_a_corpus_is_blind_beside_what_it_measures`, at the level of the whole
// program). We were finding these one at a time, by hand, by porting indicators.
//
// ─── ⚰️⚰️ TWO WRONG VERSIONS SHIPPED BEFORE THIS ONE. BOTH ARE WHY IT IS BUILT
//     THE WAY IT IS, AND NEITHER IS A FOOTNOTE ────────────────────────────────
//
// 1. IT PROBED EACH DOOR WITH *OUR* SIGNATURE and reported 52 of 63 unreachable
//    from thinkScript. thinkorswim spells `sma` as `Average`; Pine's `ta.atr`
//    takes a length where ours takes three series and a length. It was measuring
//    "does this door accept the ENGINE's signature", which every dialect
//    correctly refuses.
//
// 2. REBUILT ON SOURCE-ABSENCE — "a translator can only emit a name that appears
//    in its own source, so absence PROVES unreachability" — it reported 38 holes
//    and shipped. ⛔ THE PREMISE IS FALSE. MEASURED: `cos`, `sin`, `tan`, `exp`,
//    `log10` and `rma` appear NOWHERE in `pine.js` and every one of them
//    translates, because the resolver looks the name up in the TABLE rather than
//    naming it. The whole point of a closed manifest is that readers consult it
//    generically — so a text search over a translator is measuring the wrong
//    artifact, and it manufactured six holes that are not holes.
//    (It also, on the way, built its pattern as ``new RegExp(`\b${n}\b`)`` inside
//    a template literal, where `\b` is the BACKSPACE character — every pattern
//    was `<BS>sma<BS>` and it announced `sma`, `rsi` and `stdev` unreachable from
//    everything. That is `lesson_a_heredoc_turns_backslash_b_into_a_backspace`.)
//
// ⭐ SO THIS ASKS THE DOOR, AND BELIEVES ITS ANSWER. It runs the real translator
// and classifies by the guard the door itself returns, because "refused" is not
// one fact:
//   • `reachable`     — it translated. Nothing to do.
//   • `name-unknown`  — the door does not know this name at all. A TRUE hole:
//                       no arguments would have helped.
//   • `call-unmapped` — the door KNOWS the name and could not map this call
//                       (`pine:role-order`, `pine:arity`). ⚠️ That may mean the
//                       dialect's own signature differs from ours rather than
//                       that a member is blocked — so it is reported SEPARATELY
//                       and is an adapter question, not a missing capability.
// Conflating those last two is what made version 2 wrong.
//
// ⚠️ AND IT IS NOT A CORRECTNESS CHECK. It answers "does this door accept this
// name", never "does it produce the right tree" — `ast_conformance` and the
// vendor probes own that. A door could accept a name and mistranslate it and
// this file would call it reachable. Both are needed; neither implies the other.
//
// ⛔ IT COVERS FUNCTIONS ONLY, AND THAT BOUND IS MEASURED RATHER THAN ASSUMED.
// The same question about CLOCK entries has a different answer: `isdaily`,
// `isweekly`, `ismonthly`, `sessionfirst` and `isintraday` all translate from
// Pine, so the clock vocabulary is reached generically and a clock ratchet built
// on any absence test would be pure noise. Extending this to scalars, operators
// or clock needs its own measurement first — see `doorCoverage.test.js`.

import { TABLE } from './parse'

/** Bar fields, in the spelling every dialect shares. A probe that fed the ROLE
 *  name (`source`) as an identifier would refuse for a reason about the ARGUMENT
 *  and be recorded as an unreachable FUNCTION. */
const FIELD_FOR_ROLE = Object.freeze({
  source: 'close', left: 'close', right: 'open',
  high: 'high', low: 'low', close: 'close', open: 'open', volume: 'volume',
  seed: 'close', update: 'close', condition: 'close', anchor: 'close',
})

/** A plausible whole number for an `int` slot, by role.
 *
 *  ⛔ THE VALUES OBEY THE DECLARED DOMAINS. `macd` declares `domain: "lookback"`
 *  — its other periods must fit inside the one its lookback names — so a probe
 *  that passed 14 everywhere would be refused FOR THE DOMAIN and the name
 *  recorded unreachable when it is not. Same for the Ichimoku five. */
const INT_FOR_ROLE = Object.freeze({
  period: 14, length: 14, fast: 12, slow: 26, fastPeriod: 12, slowPeriod: 26,
  left: 5, right: 5, leftPeriod: 5, rightPeriod: 5,
  tenkanPeriod: 9, kijunPeriod: 26, senkouBPeriod: 52,
  warmupPeriod: 250, smoothing: 3, offset: 1, occurrence: 1,
})

/** A call this engine itself would accept, built from the entry's declaration. */
export function probeCall(name, spec) {
  const args = (spec.args || []).map((kind, i) => {
    const role = (spec.argRoles || [])[i]
    if (kind === 'int') return String(INT_FOR_ROLE[role] ?? 14)
    return FIELD_FOR_ROLE[role] || 'close'
  })
  return `${name}(${args.join(', ')})`
}

/** The spellings a Pine author could plausibly write for one engine name.
 *
 *  ⭐ DERIVED FROM PINE'S OWN NAMESPACE RULE, not a hand-map: v5 puts technical
 *  analysis under `ta.` and maths under `math.`, and v3/v4 code — still
 *  everywhere in the wild — uses the bare name. A member's paste may carry any
 *  of the three. */
export const PINE_PREFIXES = Object.freeze(['', 'ta.', 'math.'])

/** Guards that mean THE DOOR DOES NOT KNOW THIS NAME, as opposed to knowing it
 *  and disliking the call. ⛔ Derived from each translator's own refusal
 *  vocabulary; a guard not listed here is treated as `call-unmapped`, which is
 *  the conservative direction — it under-reports true holes rather than
 *  inventing them, and inventing them is how version 2 shipped wrong. */
export const UNKNOWN_NAME_GUARDS = Object.freeze([
  'pine:function', 'pine:builtin', 'pine:undefined',
  'thinkscript:function', 'thinkscript:study-ref',
  'pcf:name',
])

/** Run one door and say what it answered: `reachable`, `name-unknown`, or
 *  `call-unmapped` with the guard that decided it. */
function classify(run) {
  let out
  try { out = run() } catch (err) {
    return { status: 'call-unmapped', guard: `THROW:${(err && err.message) || err}` }
  }
  if (!out) return { status: 'name-unknown', guard: null }
  if (out.result) {                                    // the native / pcf reader
    if (out.result.ok) return { status: 'reachable', guard: null }
    const g = out.result.guard || null
    return {
      status: UNKNOWN_NAME_GUARDS.includes(g) ? 'name-unknown' : 'call-unmapped',
      guard: g,
    }
  }
  const usable = (out.outputs || []).find((o) => !o.refusal && o.formula)
  if (usable) return { status: 'reachable', guard: null, formula: usable.formula }
  const g = (out.refusal && out.refusal.guard)
    || ((out.outputs || []).map((o) => o.refusal && o.refusal.guard).find(Boolean))
    || null
  return {
    status: UNKNOWN_NAME_GUARDS.includes(g) ? 'name-unknown' : 'call-unmapped',
    guard: g,
  }
}

const asPinePlot = (expr) => `//@version=5\nindicator("t")\nplot(${expr})\n`
const asThinkScript = (expr) => `plot p = ${expr};\n`

/**
 * The reachability row for every declared function, per door.
 *
 * @param doors `{native, pine, thinkscript, pcf}` — injected so the derivation
 *   can be railed against a stub, and so a file whose job is to ask questions
 *   about three translators does not import them.
 */
export function functionReachability(doors, table = TABLE) {
  const rows = []
  for (const [name, spec] of Object.entries((table && table.functions) || {})) {
    const call = probeCall(name, spec)
    const row = { name, call }

    if (doors.native) row.native = classify(() => doors.native(call))

    if (doors.pine) {
      // ⭐ BEST OF THE THREE SPELLINGS. A name reachable under `ta.` and not bare
      // is still reachable, and reporting it as a hole would send somebody to fix
      // something that works.
      const tries = [...new Set(PINE_PREFIXES.map((p) => `${p}${name}`))]
        .map((s) => classify(() => doors.pine(
          asPinePlot(call.replace(`${name}(`, `${s}(`)))))
      row.pine = tries.find((t) => t.status === 'reachable')
        || tries.find((t) => t.status === 'call-unmapped')
        || tries[0]
    }

    if (doors.thinkscript) {
      row.thinkscript = classify(() => doors.thinkscript(asThinkScript(call)))
    }
    if (doors.pcf) row.pcf = classify(() => doors.pcf(call))
    rows.push(row)
  }
  return rows
}

/** ⛔⛔ THE PROBE IS VALID FOR PINE AND FOR NOTHING ELSE, and that bound is
 *  MEASURED rather than assumed. Pine v3/v4 uses BARE names that coincide with
 *  many of ours (`sma`, `rsi`, `atr`), and its resolver looks a name up in the
 *  TABLE — which is why `cos` and `rma` translate while appearing nowhere in
 *  `pine.js`. thinkorswim spells `ema` as `MovAvgExponential` and TC2000 spells
 *  it `XAVGC`, so probing THEM with our spelling asks whether they accept a
 *  language they do not speak, and every answer is a false hole. That was this
 *  file's first wrong version and it reported 52.
 *
 *  ⭐ SO THOSE TWO DOORS ARE READ, NOT PROBED. Both publish their mapping as
 *  DATA — `TS_CALL_SHAPES`, `PCF_FUSED`, `PCF_CALLS`, `PCF_EXPANSIONS` — whose
 *  `fn` field names the engine function each vendor spelling produces. Reading a
 *  declared field is exact where a text search was not: it cannot be fooled by a
 *  name appearing in a comment, and it cannot miss a generic lookup, because
 *  these doors have none. */
const DOORS = ['pine']

/** Which engine functions a NAME-MAPPING door can produce, read off its own
 *  published maps rather than inferred.
 *
 *  @param maps one or more objects whose values may carry `fn` (the engine name
 *    that spelling emits). Unknown shapes are ignored rather than guessed at. */
export function mappedFunctions(...maps) {
  const out = new Set()
  for (const m of maps) {
    for (const spec of Object.values(m || {})) {
      if (!spec || typeof spec !== 'object') continue
      // ⛔ TWO FIELD NAMES, BECAUSE THE TWO DOORS SPELL IT DIFFERENTLY. `PCF_FUSED`
      // and `PCF_CALLS` name the engine function `fn`; `TS_CALL_SHAPES` names it
      // `engine`. ⚰️ Reading only `fn` reported thinkScript as reaching 0 of 63 —
      // a number so obviously wrong it was caught on sight, but a subtler map
      // would have shipped. A reader over somebody else's data structure must be
      // checked against that structure, not against the one you expected.
      const emitted = typeof spec.fn === 'string' ? spec.fn
        : (typeof spec.engine === 'string' ? spec.engine : null)
      if (emitted) out.add(emitted)
      // `PCF_EXPANSIONS` values are BUILDERS, not descriptors — they compose a
      // tree and name no engine function, so what they emit is not readable here.
      // Deliberately not guessed at: this reader UNDER-reports rather than
      // inventing, which is the direction the previous two versions got wrong.
    }
  }
  return out
}

/** Declared functions a name-mapping door has no spelling for. */
export function unmappedFor(reachable, table = TABLE) {
  return Object.keys((table && table.functions) || {})
    .filter((n) => !reachable.has(n))
    .sort()
}

/** The TRUE holes: the door does not know the name at all.
 *
 *  ⛔ SEPARATE FROM `adapterGaps` ON PURPOSE. A name the door knows but cannot
 *  map from our argument list may simply mean the dialect's own signature
 *  differs — Pine's `ta.atr(length)` against our `atr(high, low, close, length)`
 *  — and calling that "unreachable" is the error that made the previous version
 *  of this file wrong in six places. */
export function nameHoles(rows) {
  return rows
    .map((r) => ({
      name: r.name,
      absentFrom: DOORS.filter((d) => r[d] && r[d].status === 'name-unknown'),
    }))
    .filter((r) => r.absentFrom.length > 0)
    .sort((a, b) => (b.absentFrom.length - a.absentFrom.length)
      || (a.name < b.name ? -1 : 1))
}

/** Names a door KNOWS and could not map from our canonical call. An adapter
 *  question, reported so it is visible without being counted as a hole. */
export function adapterGaps(rows) {
  return rows
    .map((r) => ({
      name: r.name,
      doors: DOORS.filter((d) => r[d] && r[d].status === 'call-unmapped')
        .map((d) => `${d}:${r[d].guard || '?'}`),
    }))
    .filter((r) => r.doors.length > 0)
    .sort((a, b) => (a.name < b.name ? -1 : 1))
}

/** A short report, denominator first. */
export function report(rows) {
  const holes = nameHoles(rows)
  const gaps = adapterGaps(rows)
  const per = DOORS
    .filter((d) => rows.some((r) => r[d]))
    .map((d) => `${d} ${rows.filter((r) => r[d] && r[d].status === 'reachable').length}`)
    .join(' · ')
  // ⛔ `holes` AND `adapterGaps` SPEAK FOR THE PROBED DOORS ONLY (Pine). The
  // name-mapping doors are answered by `mappedFunctions` + `unmappedFor`, which
  // read their published maps — a different question with a different method,
  // kept separate so one can never be reported as the other.
  return {
    declared: rows.length,
    holes,
    adapterGaps: gaps,
    // ⭐ THE DENOMINATOR IS ALWAYS PRESENT
    // (`lesson_a_hit_rate_is_meaningless_without_its_base_rate`).
    line: `${rows.length} declared · reachable: ${per} · `
      + `${holes.length} name(s) a door does not know · `
      + `${gaps.length} name(s) known but unmapped from our signature`,
  }
}
