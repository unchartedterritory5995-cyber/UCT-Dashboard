// app/src/components/chart/supportLoop/importGaps.js
//
// ─── ⭐ INDICATOR SUPPORT LOOP, PHASE A — WHAT A PASTED SCRIPT LOST, BY NAME ──
//
// Spec: `docs/pine/support-loop/PHASE-A.md`. This module answers ONE question
// about an import report (`PineBox.inspectSource`'s result): which pieces of the
// member's TradingView script did not translate, and which TradingView built-in
// each one was. The notice (A1) and the gap log (A2) both read this answer, so a
// script cannot raise a notice the log never hears about, or the reverse.
//
// ⛔ IT DECIDES NOTHING ABOUT TRANSLATION. Like `importOutcome.js`, it reads what
// the translator already returned: each output's `refusal` (with the `token` the
// translator names), a translated output the downstream door refused, a missing
// part recorded as a note, a drawing program that lost a removal, and a refusal
// on the whole script.
//
// ⛔⛔ HOW EACH GAP FAILED IS `doorCoverage.js`'s CLASSIFICATION, IMPORTED, NOT
// RE-TYPED. `name-unknown` means the door has never heard of the name; anything
// else is `call-unmapped` (the door knows the name and could not map THIS call).
// That file's header explains why the two must stay distinct; using its own
// `UNKNOWN_NAME_GUARDS` keeps them distinct the same way here.
//
// ⛔⛔ AND A NAME IS ONLY EVER A NAME FROM THE CLOSED LIST. A refusal's `token`
// is whatever the member wrote at that spot: `ta.foo`, but just as often
// `myHelper` or `secretLevel`. So a token is reported by name only when it is in
// `pineBuiltins.json`, the closed allowlist of real Pine built-ins; anything
// else becomes an UNNAMED gap. The server re-checks the same list
// (`api/services/indicator_support.py`) and is the authority; this check is what
// keeps a member's own identifier off the screen as a "TradingView function" and
// out of the request body in the first place.

import { UNKNOWN_NAME_GUARDS } from '../engine/ast/doorCoverage'
import { assessObjectLoss } from '../engine/ast/objectLoss.js'
import BUILTINS from './pineBuiltins.json'

export const GAP_KIND = Object.freeze({
  NAME_UNKNOWN: 'name-unknown',
  CALL_UNMAPPED: 'call-unmapped',
})

/** The closed set. Frozen, built once. */
export const PINE_BUILTIN_NAMES = Object.freeze(new Set(BUILTINS.names))

/** Is `name` a real Pine built-in, by the closed list? Never throws. */
export function isPineBuiltin(name) {
  return typeof name === 'string' && PINE_BUILTIN_NAMES.has(name)
}

/** Refusals that describe the SHAPE of the script, not a piece of TradingView
 *  this engine lacks: a script that plots nothing, or whose only outputs are
 *  hidden helpers, constants or unchanged price, is answered by its own refusal
 *  sentence. Calling one of those "a part that isn't supported yet" would be
 *  untrue, so they never raise the notice. `language` is another language
 *  entirely (`foreignLanguage.js`). */
export const NOT_A_GAP_GUARDS = Object.freeze(new Set([
  'language',
  'pine:no-output',
  'pine:objects-only',
  'pine:hidden-only',
  'pine:constant-only',
  'pine:presentation-only',
]))

/** Notes that record a MISSING PART of the script (same codes as
 *  `importOutcome.js::MISSING_PART_CODES`). */
const MISSING_PART_NOTE_CODES = Object.freeze(new Set(['pine:strategy-chart', 'pine:strategy-call']))

export function gapKindOf(guard) {
  return UNKNOWN_NAME_GUARDS.includes(guard) ? GAP_KIND.NAME_UNKNOWN : GAP_KIND.CALL_UNMAPPED
}

/**
 * The gaps in one import report.
 *
 * PURE, and it never throws.
 *
 * @param {object|null} report `PineBox.inspectSource` / `inspectPine` result
 * @returns {{gaps: Array<{name: string|null, kind: string, guard: string|null}>,
 *   named: string[], unnamed: number}}
 *   `gaps` is deduplicated: one entry per distinct built-in name, and one per
 *   distinct unnamed piece (guard + line). `named` is the sorted distinct names.
 */
export function importGaps(report) {
  const none = { gaps: [], named: [], unnamed: 0 }
  try {
    if (!report || report.foreign || report.error) {
      // ⭐ A CONTROLLED ERROR IS A GAP: the engine failed on the script. It has
      // no name, and the member deserves the same notice and the same button.
      if (report && report.error && !report.foreign) {
        return { gaps: [{ name: null, kind: GAP_KIND.CALL_UNMAPPED, guard: 'import:internal-error' }], named: [], unnamed: 1 }
      }
      return none
    }
    // ⛔ TRADINGVIEW SCRIPTS ONLY. A thinkScript or TC2000 paste has its own
    // vocabulary and is not this loop's scope (owner decision).
    if (report.dialect && report.dialect !== 'pine') return none

    const byKey = new Map()
    const add = (refusal, fallbackGuard = null) => {
      if (!refusal || typeof refusal !== 'object') return
      const guard = (refusal && refusal.guard) || fallbackGuard || null
      if (guard && NOT_A_GAP_GUARDS.has(guard)) return
      const token = refusal && typeof refusal.token === 'string' ? refusal.token : null
      const name = isPineBuiltin(token) ? token : null
      const kind = gapKindOf(guard)
      const key = name
        ? `n::${name}`
        : `u::${guard || '?'}::${refusal && refusal.line != null ? refusal.line : '?'}`
      if (byKey.has(key)) {
        // A name refused one way in one plot and another way in a second stays ONE
        // gap; `name-unknown` wins, because it is the stronger statement.
        const prev = byKey.get(key)
        if (prev.kind !== GAP_KIND.NAME_UNKNOWN && kind === GAP_KIND.NAME_UNKNOWN) byKey.set(key, { name, kind, guard })
        return
      }
      byKey.set(key, { name, kind, guard })
    }

    const outputs = Array.isArray(report.outputs) ? report.outputs : []
    const carried = new Set()
    for (const out of outputs) {
      if (!out) continue
      if (!out.formula) {
        if (out.refusal) {
          add(out.refusal)
          carried.add(`${out.refusal.guard}::${out.refusal.token}::${out.refusal.line}`)
        }
        continue
      }
      if (out.hidden) continue
      if (out.downstream && out.downstream.ok === false) {
        add({ guard: out.downstream.guard || 'downstream', token: null, line: out.line ?? null })
      }
    }
    const top = report.refusal
    if (top && !carried.has(`${top.guard}::${top.token}::${top.line}`)) add(top)

    for (const n of (Array.isArray(report.ignored) ? report.ignored : [])) {
      if (n && MISSING_PART_NOTE_CODES.has(n.code)) add({ guard: n.code, token: null, line: n.line ?? null })
    }
    // The drawing program lost a removal: `importOutcome.js` calls that a missing
    // part, and so does this (same reader, `objectLoss.js`).
    if (report.objects || report.objectDiagnostics) {
      const loss = assessObjectLoss({ objects: report.objects, objectDiagnostics: report.objectDiagnostics })
      if (loss && loss.verdict === 'removes') add({ guard: 'pine:object-removal-lost', token: null, line: null })
    }

    const gaps = [...byKey.values()]
    const named = gaps.filter((g) => g.name).map((g) => g.name).sort()
    return { gaps, named, unnamed: gaps.length - named.length }
  } catch {
    return none
  }
}

/** The notice's sentence, or null when nothing is missing.
 *
 *  ⭐ PLAIN AND NOT ALARMING: it says what is not supported yet and what that
 *  means for the chart, and nothing about errors or failure. */
export function gapNoticeText({ gaps = [], named = [], unnamed = 0 } = {}) {
  const n = gaps.length
  if (!n) return null
  const head = `${n} part${n === 1 ? '' : 's'} of this script ${n === 1 ? 'isn’t' : 'aren’t'} supported yet, `
    + 'so the chart may differ from TradingView'
  if (!named.length) return `${head}.`
  const tail = unnamed > 0 ? `, and ${unnamed} other part${unnamed === 1 ? '' : 's'}` : ''
  return `${head}: ${named.join(', ')}${tail}.`
}

/** What the gap log (A2) sends: allowlisted names with their kind, and a COUNT of
 *  the unnamed ones. Nothing else from the report goes anywhere. */
export function gapLogPayload({ gaps = [] } = {}) {
  const named = []
  let unlisted = 0
  for (const g of gaps) {
    if (g && isPineBuiltin(g.name)) named.push({ name: g.name, kind: g.kind === GAP_KIND.NAME_UNKNOWN ? GAP_KIND.NAME_UNKNOWN : GAP_KIND.CALL_UNMAPPED })
    else unlisted += 1
  }
  return { gaps: named, unlisted }
}
