// app/src/components/chart/engine/repaintVerdict.js
//
// ─── THE PER-PLOT REPAINT VERDICT, AS A THING A SURFACE CAN RENDER ───────────
//
// ⭐⭐ WHERE THE VERDICT LIVES: NOWHERE. IT IS DERIVED, EVERY TIME, BY THE
// LINTER. That is the decision this module IS, and the alternative is what makes
// it worth writing down.
//
// The owner ruled per PLOT (`docs/decisions/2026-08-06-machine-repaint-linter.md`
// §4): `ichimoku` is `non-repainting` on `tenkan`/`kijun`/`spanA`/`spanB` and
// something else on `chikou`, because *"a per-definition badge cannot express
// this without lying in one direction or the other"*. Phase D Task 15 then
// measured why the ruling had not been applied: **nothing in shipped source read
// a per-plot verdict**, so the two available moves were badge-a-plot (invisible)
// or badge-the-definition (slanders four clean columns). This module is the
// third move — the surface that makes the per-plot verdict visible — and it
// takes the honest form of the three:
//
//   * NOT a stored `plots[].repaint`. `defSchema` now REFUSES that field by
//     name. A badge an author types is the "audited metadata" the record's §1
//     measured to be a shared default that audited nothing, and a stored verdict
//     goes STALE — Task 10 recorded exactly that about the `ast` lane's saved
//     `repaint` column, and `installUserDefinitions` re-lints rather than
//     trusting it for precisely this reason.
//   * NOT a second badge column beside `meta.repaint`. Two fields answering one
//     question is the shape that rots; there would be no gate that could keep
//     them agreeing on the sixteen definitions no linter can read.
//   * DERIVED from `ast/lint.lintDefinition`, whose output shape has been
//     `(defId, plotKey) → verdict` since Task 7 (obligation 9) and which no
//     caller had. This module is that caller.
//
// ─── HOW IT RELATES TO `meta.repaint`, STATED RATHER THAN LEFT TO INFERENCE ──
//
// `meta.repaint` is the definition's DECLARED CLAIM. This module is the
// MEASUREMENT. They are different kinds of sentence and they are deliberately
// not merged:
//
//   * the claim keeps its consumers and its meaning — `indicatorCatalog` reads
//     it for the library row, and on the ONE lane where the badge is decidable
//     (`ast`, a tree this repo can read) `nativeRegistry.validateAstLane`
//     already REFUSES a definition whose claim disagrees with the linter, in
//     both directions. Nothing here weakens that.
//   * the measurement is what a chart renders, because on a hand-written lane
//     the claim is an unauditable default (record §1) and rendering an
//     unaudited default as a fact is the defect the record is about.
//
// ⛔ AND THIS MODULE NEVER RESOLVES A DISAGREEMENT BETWEEN THEM. Where the
// claim and the measurement differ — `ichimoku` today — that is a FINDING for
// the owner (record §2), recorded in the record's `LINTER-MEASUREMENT-V1` block
// and held down by three rails in three files. There is deliberately no function
// here that reads `meta.repaint`, so no future edit can quietly make this
// surface agree with a badge instead of with the maths.
//
// ⚠️ WHAT A SURFACE GETS, AND WHAT IT DOES NOT. Only plots the linter DECIDED
// and decided are NOT clean produce a notice. Three consequences, all intended:
//
//   * a definition whose every plot is clean renders NOTHING. *"A badge that
//     every indicator wears carries no information"* is the owner's own reason
//     for the per-plot ruling (record §4), and sixteen chips wearing
//     `non-repainting` is a uniform column wearing a costume.
//   * a plot the linter could not read renders NOTHING EITHER, and that is the
//     one that needs saying out loud: silence here means *"no opinion"*, never
//     *"clean"*. Obligation 8 exists so those two cannot be written the same
//     way, and a surface that painted an undecidable plot green would write them
//     the same way in pixels.
//   * so an absent notice is never evidence of anything. The evidence is the
//     record's measurement block.

import { lintDefinition, modeFromReach, REPAINT_MODES, UNKNOWN } from './ast/lint'

/** The clean verdict — the one value that produces no notice. */
export const CLEAN = 'non-repainting'

// ─── the severity scale, DERIVED BY DRIVING THE LINTER ───────────────────────
//
// ⛔ THIS WAS A HAND-TYPED `{ 'non-repainting': 0, 'preview-repaints': 1,
// repaints: 2 }` AND THE COMMENT ABOVE IT CLAIMED IT READ THROUGH
// `REPAINT_MODES` "rather than beside it". It did not: it re-spelled all three
// names. That is the second-authority defect on the one ordering a member-facing
// badge rests on, and it survived because the PYTHON twin was the side anybody
// audited — [[lesson_rail_the_mirror_not_just_the_lane]] is exactly this shape.
//
// ⭐ SEVERITY IS A FUNCTION OF FORWARD REACH, AND `modeFromReach` IS THE SHIPPED
// FUNCTION THAT KNOWS IT. Zero forward bars promises everything; a finite k
// promises settlement at k; an unknown reach promises nothing. So the scale is
// read off the linter by asking it what it calls each of the three reach
// classes its own contract names — never by typing the answers beside it.
//
// This is the JS half of a mirrored derivation. The Python lane
// (`api/services/user_definition_relint.admission_rank`) drives
// `alert_user_series._gate_repaint`, the real admission door; there is no such
// door in the browser, so this lane drives the authority it does have. Rename a
// mode or reclassify a reach in `lint.js` and BOTH scales follow, because
// neither one holds a copy.
const SEVERITY = Object.freeze(
  [0, 1, UNKNOWN].reduce((scale, reach, rank) => (
    { ...scale, [modeFromReach(reach)]: rank }
  ), {}),
)

/** ⛔ A MODE THIS SCALE CANNOT PLACE RANKS **WORST**, NOT BEST.
 *
 *  The `?? 0` that stood here ranked an unrecognised verdict as CLEANEST — a
 *  member-facing badge failing OPEN, on the one question where an unknown answer
 *  should be the most alarming thing on the chart and not the least. A fourth
 *  badge value would have rolled a definition up to "clean" and rendered nothing.
 *
 *  Strictly above every rank the scale holds, derived from its size so it cannot
 *  drift when the vocabulary grows. `severityScale` is exported for the rail:
 *  a scale nobody can read back is a scale nobody can assert on. */
const UNPLACEABLE = Object.keys(SEVERITY).length

export function severityOf(mode) {
  const rank = SEVERITY[mode]
  return typeof rank === 'number' ? rank : UNPLACEABLE
}

/** The scale itself, for the rails — including the vocabulary it must cover.
 *  ⛔ THE ANTI-ROT HANDLE. `repaintSeverityScale.test.js` asserts these keys are
 *  EXACTLY `REPAINT_MODES`, so a fourth mode entering the vocabulary reddens
 *  rather than being silently sorted — the same claim the Python twin's
 *  `ranks()` carries, so the two rot together instead of one rotting alone. */
export function severityScale() {
  return { scale: { ...SEVERITY }, unplaceable: UNPLACEABLE, vocabulary: [...REPAINT_MODES] }
}

/** The plain sentence a member reads. Two shapes, because the vocabulary draws
 *  exactly one distinction and it is this one: `preview-repaints` can NAME the
 *  bar after which the value settles and `repaints` cannot (record §3.2). A
 *  sentence that blurred them would throw away the only information the
 *  trichotomy carries. */
function sentenceFor(mode, forward) {
  if (mode === 'preview-repaints' && Number.isInteger(forward) && forward > 0) {
    return `Each point moves while the next ${forward} bar${forward === 1 ? '' : 's'} form, `
      + `and is final the moment the ${forward === 1 ? 'next bar closes' : `${forward}th bar after it closes`}.`
  }
  return 'No bar makes a point on this line final — it can move at any time.'
}

/**
 * Every plot of `def` the linter DECIDED and decided is not clean.
 *
 * @returns {{plotKey: string, label: string, mode: string, forward: number|string,
 *            sentence: string, reasons: string[]}[]} — empty for the clean case,
 *          which is the overwhelmingly common one and renders nothing.
 */
export function repaintNotices(def) {
  return cached(def).notices
}

/** The notice for ONE plot, or null.
 *
 *  ⚠️ A LEGEND CHIP IS PER (INSTANCE, PLOT), so this is the lookup a chip needs —
 *  and it is why the notice cannot be a per-definition value. `ichimoku` draws
 *  five columns and exactly one of them is the subject; a chip-level badge keyed
 *  on the DEFINITION would mark `TK` and `KJ`, which are clean by construction. */
export function plotRepaintNotice(def, plotKey) {
  if (!plotKey) return null
  return cached(def).byPlot.get(plotKey) || null
}

/**
 * The definition-level ROLL-UP of the measurement: the worst verdict any of its
 * plots was decided to carry, or `null` when the linter decided none of them.
 *
 * ⛔ `null` IS NOT `non-repainting`. A catalogue of seventeen hand-written
 * computes rolls up to seventeen `null`s, and a caller that reads that as clean
 * has written *"the linter agreed with every shipped badge"* over silence —
 * the sentence obligation 8 exists to make impossible.
 *
 * ⛔ AND THIS IS NOT WRITTEN ANYWHERE. It answers record §4.1's third open
 * question — *"what the definition-level badge says when its plots disagree"* —
 * with: the definition-level BADGE (`meta.repaint`) says whatever it declares
 * and is the author's claim; the definition-level MEASUREMENT is this, computed
 * on demand, and the two meeting is a finding rather than an assignment.
 */
export function definitionRollUp(def) {
  return cached(def).rollUp
}

// --------------------------------------------------------------------------- //
// the cache
// --------------------------------------------------------------------------- //

/** ⚠️ A `WeakMap` ON THE DEFINITION OBJECT, AND IT IS NOT PREMATURE. The chip
 *  lookup runs inside the crosshair legend's map — once per chip, on every
 *  pointer move over the chart — and on the `ast` lane `lintDefinition` walks a
 *  tree. Definitions are frozen-in-practice module objects (natives) or objects
 *  `installUserDefinitions` replaces wholesale on a rev bump, so identity is a
 *  correct key: a changed definition is a different object and gets a fresh
 *  answer. Weak so an uninstalled user definition is collectable. */
const CACHE = new WeakMap()

function cached(def) {
  if (!def || typeof def !== 'object') return EMPTY
  const hit = CACHE.get(def)
  if (hit) return hit
  const built = build(def)
  CACHE.set(def, built)
  return built
}

const EMPTY = Object.freeze({ notices: Object.freeze([]), byPlot: new Map(), rollUp: null })

function build(def) {
  let rows
  try {
    rows = lintDefinition(def).plots
  } catch {
    // ⛔ A RENDER SURFACE MAY NOT TAKE THE CHART DOWN. The linter is a pure
    // function of a definition and is not supposed to throw, but a malformed
    // stored definition reaching it is exactly the case a chart must survive —
    // and the safe answer is "no opinion", never "clean".
    return EMPTY
  }
  const decided = rows.filter((r) => r && r.decidability === 'decided' && r.mode)
  const labels = new Map((Array.isArray(def.plots) ? def.plots : [])
    .filter((p) => p && p.key).map((p) => [p.key, p.label || p.key]))

  const notices = decided
    .filter((r) => r.mode !== CLEAN)
    .map((r) => Object.freeze({
      plotKey: r.plotKey,
      label: labels.get(r.plotKey) || r.plotKey,
      mode: r.mode,
      forward: r.forward,
      sentence: sentenceFor(r.mode, r.forward),
      reasons: r.reasons,
    }))

  const rollUp = decided.length
    ? decided.map((r) => r.mode).reduce((a, b) => (severityOf(b) > severityOf(a) ? b : a))
    : null

  return Object.freeze({
    notices: Object.freeze(notices),
    byPlot: new Map(notices.map((n) => [n.plotKey, n])),
    rollUp,
  })
}
