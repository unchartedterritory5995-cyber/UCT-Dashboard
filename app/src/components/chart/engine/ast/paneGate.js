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

import {
  assessObjectLoss, objectRemovalRefusal, OBJECT_REMOVAL_GUARD,
} from './objectLoss'
import { hiddenOnChart } from './pine'

/** The lane whose verdict a pane is allowed to act on. */
export const PANE_LANE = 'host'

/** ⭐⭐ MAY A PANE DRAW THIS SCRIPT'S OBJECT PROGRAM? — owner ruling 2026-09-27
 *  (option b).
 *
 *  A program that lost anything that REMOVES a drawing is never drawn: the chart
 *  would keep objects TradingView removed, which is a wrong picture rather than
 *  a smaller one. Everything else is drawn, and `objectLoss.js` words the
 *  disclosure. Classification lives there; THIS is the decision, and both of its
 *  consumers — the objects-only admissions below and `memberPaneDefinition`'s
 *  withholding for a plotting script — ask this one function.
 *
 *  @returns {{draw: boolean, loss: object, refusal: string|null, guard: string|null}} */
export function paneObjectsGate(t) {
  const loss = assessObjectLoss(t)
  if (loss.verdict === 'removes') {
    return { draw: false, loss, refusal: objectRemovalRefusal(loss), guard: OBJECT_REMOVAL_GUARD }
  }
  return { draw: true, loss, refusal: null, guard: null }
}

/** May a pane render this translation, and if not, why not?
 *
 *  @param {object|null} t a `translatePine` result
 *  @param {{allowObjectsOnly?: boolean}} [opts]
 *    `allowObjectsOnly` admits a script that DRAWS and offers no screenable
 *    column — see `objectsOnlyPaneGate.js`. Default FALSE.
 *
 *    ⛔⛔ THE FLAG IS A PARAMETER, NOT A READ. This module is a pure decision
 *    and its whole value is that the decision lives in one testable place; a
 *    module that reached for `import.meta.env` would make the ruling depend on
 *    the build, and `ast/` is the TRANSLATOR layer, which has no business
 *    knowing what a UI build was configured with. The caller reads the flag.
 *
 *  @returns {{ok: boolean, reason: string|null, guard: string|null}}
 */
export function paneGate(t, opts = {}) {
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
    // ⭐⭐ `ok: false` USED TO MEAN "nothing came out of this script", AND IT NO
    // LONGER DOES. `pine:objects-only` is a script that DRAWS — a table, labels,
    // boxes — and offers no plot or alert condition, so there is nothing to
    // filter a scan on. `ok` is false because the SCREENER contract is unchanged
    // and honest; the drawing is real and survives the refusal.
    //
    // ⛔ IT IS GATED, AND THE GATE DEFAULTS CLOSED. This is a D2 revisit — owner
    // decision 2026-09-20 — so it arrives OFF and the first deploy carrying it
    // changes nothing a member sees.
    //
    // ⛔ AND THE OBJECT PROGRAM MUST ACTUALLY HAVE OPS. A guard name alone is a
    // claim about the script; the ops are the drawing. Admitting on the name and
    // finding nothing to draw would put an empty pane on screen with no sentence,
    // which is the one outcome this module exists to prevent.
    if (opts.allowObjectsOnly === true
        && r && r.guard === 'pine:objects-only'
        && t.objects && Array.isArray(t.objects.ops) && t.objects.ops.length > 0) {
      // ⛔⛔ 2026-09-27 — A DIRTY PROGRAM IS NOT ADMITTED WHOLESALE ANY MORE. This
      // branch exists BECAUSE the program dropped ops (a clean one arrives `ok:
      // true`, below), and it used to answer `ok` for all of them — including the
      // ones that lost a delete. The drawing is the only thing such a script
      // offers, so a lost removal refuses it, by name.
      const og = paneObjectsGate(t)
      if (!og.draw) return no(og.refusal, og.guard)
      return { ok: true, reason: null, guard: null }
    }
    return no(r && r.message
      ? String(r.message)
      : 'the host lane refused this script', r ? r.guard || null : null)
  }
  // ⭐⭐ A CLEAN OBJECTS-ONLY SCRIPT NOW ARRIVES HERE `ok: true`, AND THE
  // ADMISSION ABOVE CANNOT SEE IT. The 2026-09-23 merge reconciled two lineages
  // that disagreed about what the HOST lane returns for a script that draws and
  // offers no column:
  //
  //   clean object program (zero drops) → `ok: true`,  selected -1, 0 outputs
  //   DIRTY object program (some drops) → `ok: false`, guard `pine:objects-only`
  //
  // The branch that wrote the admission above only ever saw the second shape, so
  // it keys on the refusal — and a table-only script that translates PERFECTLY
  // fell straight past it into "this script declares nothing a chart can draw",
  // which is the one sentence this module exists to stop being said about a
  // script that draws a table. Measured end to end through `memberPaneDefinition`
  // → `installUserDefinitions`; `objectsOnlyAnchorMode.test.js` is the rail.
  //
  // ⛔ SAME GATE, SAME DEFAULT, SAME EVIDENCE REQUIREMENT. Off, this returns
  // exactly the refusal it always did. And the ops must really be there — a
  // verdict alone is a claim about the script, the ops are the drawing.
  //
  // ⛔ IT IS DERIVED, NOT RE-CHECKED. `ok: true` on the host lane already MEANS
  // the object program is clean (`pineObjectOnlyHostAccept`: no partial credit,
  // every attempted op survived), so re-testing `droppedOps === 0` here would be
  // a second authority over one value — and the two would drift the day that
  // doctrine moves.
  //
  // ⚠️ IT CANNOT FIRE FOR A SCRIPT THAT HAS A ROW. `selected` is a real index
  // whenever any output was chosen, so a plotting script that also draws objects
  // takes the ordinary path below, unchanged.
  const drawsObjects = !!(t.objects && Array.isArray(t.objects.ops) && t.objects.ops.length > 0)
  // ⭐ B1 — a carried paint (`bgcolor` / `barcolor`) is a drawing too, admitted on
  // the same gate and the same flag as an objects-only script: it offers no column
  // to screen on either. `ok: true` here already means every paint was carried.
  const drawsPaints = !!(t.presentation && Array.isArray(t.presentation.paints)
    && t.presentation.paints.some((p) => p && !p.withheld && !p.hidden && !p.na))
  if (!Number.isInteger(t.selected) || t.selected < 0) {
    if (opts.allowObjectsOnly === true && drawsPaints && !drawsObjects) return { ok: true, reason: null, guard: null }
    if (opts.allowObjectsOnly === true && drawsObjects) {
      // ⛔ "CLEAN" HERE MEANS `droppedOps === 0`, AND THAT IS NOT THE SAME AS
      // LOSING NOTHING: the READER counts `box.delete` inside a loop it cannot run
      // before the converter sees an op (measured: `sonarlab-order-blocks`, zero
      // drops, a lost `box.delete`). The same gate asks, so the same answer holds.
      const og = paneObjectsGate(t)
      if (!og.draw) return no(og.refusal, og.guard)
      return { ok: true, reason: null, guard: null }
    }
    // ⭐⭐ H8 — `selected` never offers a constant (`chooseOutput`: "a constant is
    // never the first offer" — a SCREENER rule), so a script whose only rows are
    // constants TradingView draws (`plot(0)`, `plot(syminfo.mintick)`) selects
    // nothing. Drawing is `hiddenOnChart`'s question, asked here as the pane asks it.
    if ((t.outputs || []).some((o) => o && !o.refusal && o.formula && o.kind !== 'alertcondition'
      && !hiddenOnChart(o))) return { ok: true, reason: null, guard: null }
    // Ruling D1's honest case, arriving here rather than as a blank pane.
    return no('this script declares nothing a chart can draw')
  }
  const row = (t.outputs || [])[t.selected]
  if (!row || row.refusal || row.hidden) {
    return no('the output this script offers first is not one a chart can draw')
  }
  return { ok: true, reason: null, guard: null }
}

/** ⭐⭐ MAY THIS REFUSED SCRIPT BE DRAWN BY THE PER-BAR RUNTIME LANE INSTEAD?
 *  (owner principle, PR #241, 2026-09-28)
 *
 *  True only when the host lane refused, and EVERY refusal it gave is one that
 *  names the runtime lane as where the script can be drawn (`route: 'runtime'`,
 *  set by `pine.js` on the refusal it raises for two coupled `var`s). One refusal
 *  of any other kind and the answer is no: a script with a second, unrelated
 *  wall is not drawable by routing alone, and drawing its routable half would be
 *  the partial picture this module exists to prevent.
 *
 *  ⛔ A PURE DECISION, like `paneGate`. Whether the route is switched ON is the
 *  caller's to read (`runtimePaneGate.runtimePaneEnabled`); whether the runtime
 *  lane actually builds the script is asked afterwards, of the lane itself.
 *
 *  @returns {boolean} */
export function runtimeRouteOf(t) {
  if (!t || typeof t !== 'object' || t.mode !== PANE_LANE || t.ok === true) return false
  const refusals = [...(t.refusals || [])]
  if (t.refusal && !refusals.includes(t.refusal)) refusals.push(t.refusal)
  if (!refusals.length) return false
  return refusals.every((r) => !!r && r.route === 'runtime')
}

/** ⭐⭐ RT1 (2026-10-02) — MAY THE RUNTIME LANE BE ASKED, AS THE MEMBER DOOR'S
 *  GENERAL FALLBACK? (integrator ruling: the per-bar runtime lane is the member
 *  door's fallback for whatever the host lane refuses.)
 *
 *  True when the HOST TRANSLATION refused — at least one refusal and `ok` not
 *  true — whatever the refusal's kind. It decides only that the runtime lane is
 *  ASKED; whether it builds, and whether what it would draw is exact, is the
 *  runtime lane's own answer (its refusals and budgets) and the door's
 *  (`memberPaneDefinition::runtimeLaneDefinition`). A script the host lane
 *  translates but `paneGate` still refuses (nothing drawable, a lost removal) is
 *  NOT a fallback case: the runtime lane would be asked the same question.
 *
 *  ⛔ A PURE DECISION; the switch is `runtimePaneGate.runtimePaneEnabled()`, read
 *  by the caller. `runtimeRouteOf` stays the narrower question (every refusal
 *  NAMES the runtime lane), because a routed refusal is worded differently when
 *  the runtime lane then declines.
 *
 *  @returns {boolean} */
export function runtimeFallbackOf(t) {
  if (!t || typeof t !== 'object' || t.mode !== PANE_LANE || t.ok === true) return false
  return (Array.isArray(t.refusals) && t.refusals.length > 0) || !!t.refusal
}

/** ⭐ The same decision as a predicate, for a call site that only branches.
 *  Derived from `paneGate` rather than restated — two authorities over one
 *  value is the defect this module exists to prevent. */
export function paneCanRender(t) {
  return paneGate(t).ok === true
}
