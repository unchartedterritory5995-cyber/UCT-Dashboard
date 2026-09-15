// app/src/components/chart/engine/ast/paneGate.js
//
// ─── ⭐⭐ RULING D2 (option B) — WHAT A PANE IS ALLOWED TO DRAW ──────────────
//
// T3/T5 drive a member pane from the SAVED DEFINITION the HOST lane produces. That
// is a decision about which translation is authoritative, and a decision like that
// needs one place to live or it becomes four slightly different `if`s at four call
// sites.
//
// ⚰️ THIS SAID THE IR LANE "STAYS AS IT IS UNTIL SESSION 3'S TEXT LAYER" — CORRECTED
// IN PLACE (H.6, 2026-09-15), because session 3 ARRIVED and nothing about this gate
// changed. `pineRuntimeTextLane.test.js` pins that arrival: `pine:text-value` no
// longer stops either script, and the IR lane reaches 77 statements on v2 where it
// reached 40. The text layer was never the thing holding the IR lane off the pane.
//
// ⛔ WHAT ACTUALLY HOLDS IT OFF, MEASURED: `buildRuntimeIr(v2)`'s FIRST refusal is
// `runtime:statement@249` — neither text nor tuple — and the IR vocabulary declares
// `STMT.FOR`, `STMT.WHILE`, `EXPR.TUPLE` and `EXPR.ARRAY_OP` while lowering NONE of
// them: zero mentions across `lower.js`, `lowerIr.js` and `vm.js`. So D2's revisit
// waits on the IR LOWERING PROGRAMME, which is wave-sized and is not this file's to
// schedule. **D2 stands**; `PANE_LANE = 'host'` is unchanged by this correction.
//
// ⭐ The reason to correct the sentence rather than delete it: a deferral naming a
// precondition that has since been MET reads as "nearly ready" to the next engineer,
// and this one had already been cited that way. A deferral must name the condition
// that is actually outstanding, or it misdirects exactly the person acting on it.
//
// ⛔⛔ THE SCREENER LANE IS NOT ADMISSIBLE HERE, AND THAT IS THE POINT.
// `translatePine(src, {})` is LENIENT by contract: it answers `ok: true` while
// carrying refusals, because a screen only needs ONE usable column. Volume v2 is
// the case — the screener lane says `ok: true` with FOUR refusals, and four of its
// five rows carry no tree at all. A pane built on that verdict would draw one line
// and silently omit the rest of the member's script, which is the "partial success
// reported as success" failure `translatePine`'s own strict mode was written to end.
//
// ⛔ AND `ok` ALONE IS NOT ENOUGH SINCE RULING D1. A script whose only output is an
// `alertcondition` translates cleanly and answers `selected: -1` on a host target —
// nothing failed, and there is still no line to draw. The gate reads BOTH.
//
// ⭐ IT RETURNS A REASON, NEVER A BARE `false`. A pane that declines to render owes
// the member a sentence, and a boolean cannot carry one.

/** The lane whose verdict a pane is allowed to act on. */
export const PANE_LANE = 'host'

/** May a pane render this translation, and if not, why not?
 *
 *  @param {object|null} t a `translatePine` result
 *  @returns {{ok: boolean, reason: string|null, guard: string|null}}
 */
export function paneGate(t) {
  const no = (reason, guard = null) => ({ ok: false, reason, guard })
  if (!t || typeof t !== 'object') return no('there is no translation to draw')
  // ⛔ THE LANE IS CHECKED FIRST AND EXPLICITLY. `mode` exists on the result
  // precisely so a verdict that travels cannot be ambiguous about which question
  // it answered; reading `ok` off a screener result is the whole defect.
  if (t.mode !== PANE_LANE) {
    return no(`this verdict came from the ${t.mode || 'unknown'} lane, which answers a `
      + 'different question — a pane needs the host translation')
  }
  if (t.ok !== true) {
    const r = t.refusal || (t.refusals || [])[0] || null
    return no(r && r.message
      ? String(r.message)
      : 'the host lane refused this script', r ? r.guard || null : null)
  }
  if (!Number.isInteger(t.selected) || t.selected < 0) {
    // Ruling D1's honest case, arriving here rather than as a blank pane.
    return no('this script declares nothing a chart can draw')
  }
  const row = (t.outputs || [])[t.selected]
  if (!row || row.refusal || row.hidden) {
    return no('the output this script offers first is not one a chart can draw')
  }
  return { ok: true, reason: null, guard: null }
}

/** ⭐ The same decision as a predicate, for a call site that only branches.
 *  Derived from `paneGate` rather than restated — two authorities over one
 *  value is the defect this module exists to prevent. */
export function paneCanRender(t) {
  return paneGate(t).ok === true
}
