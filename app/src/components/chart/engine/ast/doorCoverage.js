// app/src/components/chart/engine/ast/doorCoverage.js
//
// ─── 🔴 WHICH DOORS CAN REACH WHAT THE ENGINE ALREADY HAS ───────────────────
//
// ⛔⛔ THE FINDING THIS EXISTS FOR, and it reframes the whole import program: a
// language-surface sweep on 2026-08-29 concluded that MOST of the gap between us
// and TradingView "is not missing capability — it is SHIPPED capability the door
// cannot reach." `pow` and `valuewhen` are declared, computed, evaluated
// correctly from the native builder, and unreachable through the Pine door in
// ANY spelling. `ta.tr` refuses while bare `tr` translates. `timeframe.isdaily`
// refuses while the identical bare name works, over clock columns the manifest
// declares.
//
// ⛔ AND NOTHING MEASURED IT. The corpus measures whichever names 75 chosen
// scripts happen to use, so a declared function no fixture calls can be
// unreachable from every importer forever and every gate stays green. That is
// `lesson_a_corpus_is_blind_beside_what_it_measures` at the level of the whole
// program: we were finding these one at a time, by hand, by porting indicators.
//
// ⭐ SO THIS ASKS THE MANIFEST, NOT A FIXTURE. For every name the engine
// declares it probes each door with the spellings that dialect would use, and
// reports a matrix. A name reachable natively and refused by an importer is a
// hole — found mechanically, with no corpus and no indicator to port.
//
// ⚠️ WHAT IT IS NOT: a correctness check. It answers "does this door ACCEPT this
// name", never "does it produce the right tree" — `ast_conformance` and the
// vendor probes own that. A door could accept a name and mistranslate it, and
// this file would call it reachable. Both measurements are needed and neither
// implies the other.

import { TABLE } from './parse'

// ⚰⚰ THE FIRST VERSION OF THIS FILE PROBED EACH DOOR WITH *OUR* SPELLING AND
// *OUR* ARITY, AND THE NUMBER IT PRODUCED WAS MOSTLY WRONG. It reported 52 of 63
// functions unreachable from thinkScript — but thinkorswim spells `sma` as
// `Average`, and Pine's `ta.atr` takes a length where ours takes three series and
// a length. So the probe was measuring "does this door accept the ENGINE's
// signature", which every dialect correctly refuses, and would have shipped a
// roster of holes that mostly were not holes.
//
// ⭐ WHAT REPLACED IT IS A ONE-DIRECTIONAL TEST THAT CANNOT MAKE THAT MISTAKE.
// A translator can only ever emit an engine name that appears somewhere in its
// own source. So:
//   * a declared name ABSENT from a translator's source is PROVABLY unreachable
//     through that door — no spelling of any arity can reach it;
//   * a name PRESENT proves nothing, and this file says so rather than counting
//     it as covered.
// Absence is the half that is sound, and absence is the half that finds holes.
// (`lesson_a_premise_that_says_nothing_to_find_retires_the_search` cuts the other
// way here: a confident "reachable" would stop somebody looking.)

/** Bar fields, in the spelling every dialect shares. Used to build a call whose
 *  arguments are real series rather than placeholders — a probe that fed
 *  `series` as a literal name would refuse for a reason about the ARGUMENT and
 *  be recorded as an unreachable FUNCTION. */
const FIELD_FOR_ROLE = Object.freeze({
  source: 'close', left: 'close', right: 'open',
  high: 'high', low: 'low', close: 'close', open: 'open', volume: 'volume',
  seed: 'close', update: 'close',
})

/** A plausible whole number for an `int` slot, by role.
 *
 *  ⛔ THE VALUES OBEY THE DECLARED DOMAINS. `macd` declares `domain: "lookback"`
 *  — its other periods must fit inside the one its lookback names — so a probe
 *  that passed 14 for every slot would be REFUSED for the domain rather than for
 *  reachability, and the name would be recorded unreachable when it is not. */
const INT_FOR_ROLE = Object.freeze({
  period: 14, fast: 12, slow: 26, fastPeriod: 12, slowPeriod: 26,
  left: 5, right: 5, leftPeriod: 5, rightPeriod: 5,
  tenkanPeriod: 9, kijunPeriod: 26, senkouBPeriod: 52,
  warmupPeriod: 250, smoothing: 3, offset: 1, length: 14,
})

/** A call this engine would accept, built from the entry's own declaration. */
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
 *  ⭐ DERIVED FROM PINE'S OWN NAMESPACE RULE, not a hand-map: Pine v5 puts
 *  technical analysis under `ta.`, maths under `math.`, and v3/v4 code (still
 *  everywhere) uses the bare name. A member's paste may carry any of the three,
 *  so a name reachable through only one of them is still a hole for whoever
 *  pasted the other. */
export const PINE_PREFIXES = Object.freeze(['', 'ta.', 'math.'])

const asPinePlot = (expr) => `//@version=5\nindicator("t")\nplot(${expr})\n`
const asThinkScript = (expr) => `plot p = ${expr};\n`

/** Does a door ACCEPT this expression? Never whether it is right. */
function accepts(run) {
  try {
    const out = run()
    if (!out) return false
    if (out.result) return !!out.result.ok            // pcf / native reader
    if (out.refusal) return false
    return (out.outputs || []).some((o) => !o.refusal && o.formula)
  } catch {
    return false
  }
}

/**
 * Which declared names a door's source can NEVER emit.
 *
 * @param sources `{pine, thinkscript, pcf}` — each translator's own text.
 *   Injected rather than read here so the derivation can be railed against a
 *   stub, and so this module does not import three translators into a file whose
 *   whole job is to ask questions about them.
 *
 * ⛔ THE MATCH IS ON A WHOLE WORD, and it is built by TOKENISING the source
 * rather than by a regex. Substring matching would find `pow` inside `power` and
 * report a hole closed that is open.
 *
 * ⚰️ AND A REGEX IS HOW THE FIRST TRY BROKE, IN A WAY THAT LOOKED LIKE A FINDING.
 * Written as ``new RegExp(`\b${n}\b`)`` inside a TEMPLATE LITERAL, `\b` is the
 * BACKSPACE CHARACTER and not a word boundary — so every pattern was
 * `<BS>sma<BS>`, nothing ever matched, and the report confidently announced that
 * `sma`, `rsi` and `stdev` were unreachable from every importer. A tool that
 * finds holes must not manufacture them; tokenising has no escape to get wrong.
 */
export function unreachableNames(sources, table = TABLE) {
  const declared = Object.keys((table && table.functions) || {})
  const out = {}
  for (const [door, text] of Object.entries(sources || {})) {
    const words = new Set(String(text || '').split(/[^A-Za-z0-9_]+/))
    out[door] = declared.filter((n) => !words.has(n))
  }
  return out
}

/**
 * The holes: declared, and provably unreachable through at least one importer.
 *
 * ⛔ A NAME MISSING FROM A DOOR IS NOT AUTOMATICALLY A DEFECT, and the roster
 * says which kind it is rather than implying one. Three cases, and only the first
 * is work:
 *   • the dialect HAS the concept and we do not reach it — a real hole
 *     (`pow`, `valuewhen`, `ta.tr`, `timeframe.isdaily` were all found this way);
 *   • the dialect does not have the concept at all — nothing to reach;
 *   • the dialect has it under a name that means something DIFFERENT — reaching
 *     it would be the `MIN`/`lowest` mistranslation this program refuses.
 * Deciding which is a human's job; FINDING them is this file's.
 */
export function holesByDoor(sources, table = TABLE) {
  const missing = unreachableNames(sources, table)
  const doors = Object.keys(missing)
  const byName = {}
  for (const d of doors) {
    for (const n of missing[d]) {
      byName[n] = byName[n] || []
      byName[n].push(d)
    }
  }
  return Object.entries(byName)
    .map(([name, absentFrom]) => ({ name, absentFrom }))
    .sort((a, b) => (b.absentFrom.length - a.absentFrom.length)
      || (a.name < b.name ? -1 : 1))
}

/** A short report a human can act on, denominator first. */
export function report(sources, table = TABLE) {
  const declared = Object.keys((table && table.functions) || {})
  const missing = unreachableNames(sources, table)
  const holes = holesByDoor(sources, table)
  const per = Object.entries(missing)
    .map(([d, list]) => `${d} reaches ${declared.length - list.length}/${declared.length}`)
    .join(' · ')
  return {
    declared: declared.length,
    missing,
    holes,
    // ⭐ THE DENOMINATOR IS ALWAYS PRESENT. "20 holes" means nothing without "out
    // of 63 declared" (`lesson_a_hit_rate_is_meaningless_without_its_base_rate`).
    line: `${declared.length} declared · ${per} · ${holes.length} name(s) `
      + 'provably unreachable through at least one importer',
  }
}
