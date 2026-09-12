// app/src/components/chart/builder/memberPane/memberPaneDefinition.js
//
// ─── ⭐⭐ T3 — A MEMBER'S OWN SCRIPT, AS A DEFINITION A PANE CAN BIND ────────
//
// Everything between "the member pasted Pine" and "the binder has columns"
// already exists and has for weeks. What did not exist was the ONE function that
// walks it end to end without a React component in the middle:
//
//     source → translatePine(strict) → paneGate → rows → buildDefinition
//              → installUserDefinitions → addInstance → binder → columns
//
// This module is the first four steps. `MemberPane.jsx` is the rest.
//
// ⛔⛔ THE HOST LANE, AND `paneGate` DECIDES — NOT AN `if (t.ok)` WRITTEN HERE.
// Ruling D2 put that decision in `engine/ast/paneGate.js` precisely so it cannot
// be re-derived slightly differently at each call site. The screener lane's
// `ok: true` is inadmissible (it rides four refusals on Volume v2), and since
// ruling D1 `ok` alone is not enough either.
//
// ⭐ IT IS THE SAME RECIPE `visualParitySet.test.js::documentOf` MEASURES ON TEN
// REAL SCRIPTS, driven by the host lane instead of the lenient one and written
// where the product can call it. That test is the reason this is a productised
// path rather than a first attempt: the rows, the manifest placements and the
// `buildDefinition` call are the shapes it already proved land a valid document.
import { translatePine } from '../../engine/ast/pine'
import { paneGate } from '../../engine/ast/paneGate'
import { memberInputTranslation } from '../builderInputs'
import { manifestFromPlacements, paramLocatorsIn } from '../pineParamManifest'
import { alertNoteForOutput } from '../../engine/ast/parse'
import { applyParamEdit } from '../paramEdit'
import { buildDefinition } from '../BuilderSheet'
import { evaluateFormula } from '../FormulaField'
import { BUILDER_INPUT_SCOPE } from '../builderInputs'

/** ⭐ ≈ A QUARTER OF THE CHART, and the unit is the schema's own.
 *  `defSchema` validates `placement.pane.height` as a FRACTION in (0, 1) — a
 *  per-indicator default that `paneLayout` turns into a pixel target — so "a
 *  quarter" is `0.25` and not a pixel count this module would have to guess. */
export const MEMBER_PANE_HEIGHT = 0.25

/** The id prefix a member-pane definition installs under.
 *  ⛔ It must satisfy `defSchema.ID_RE` and must never collide with a stored
 *  definition: the server mints `u_` + 12 hex, and `-` is not a hex digit. */
export const MEMBER_PANE_DEF_PREFIX = 'u_member-pane'

/** ⛔ THE SAME CEILING THE BUILDER'S OWN IMPORT USES. A script with forty plots
 *  is not a reason to register forty columns on somebody's chart. */
const CARRY_MAX = 12

const keyAt = (i) => (i === 0 ? 'value' : `out${i + 1}`)

/**
 * A member's Pine as a definition document, or the reason it is not one.
 *
 * @param {object} arg
 * @param {string} arg.source the member's script
 * @param {string} [arg.id] the definition id to install under
 * @param {string} [arg.name] the chip name; defaults to the script's own title
 * @param {object} [arg.translation] a host translation to reuse rather than redo
 * @returns {{ok: boolean, definition: object|null, reason: string|null,
 *            guard: string|null, translation: object|null, rows: object[]}}
 */
export function memberPaneDefinition({ source, id, name, translation = null } = {}) {
  const no = (reason, guard = null, t = null) => ({
    ok: false, definition: null, reason, guard, translation: t, rows: [], notes: [],
  })
  if (typeof source !== 'string' || !source.trim()) return no('there is no script to draw')

  let t = translation
  if (!t) {
    try {
      // ⭐ `paramManifest: true` RIDES ON THIS TRANSLATION, for the reason
      // `PineBox` gives: the manifest and the saved computation must come from
      // ONE translation result, or the parameter ids address a tree nobody built.
      t = memberInputTranslation(translatePine, source, { paramManifest: true, strict: true })
    } catch (err) {
      // ⛔ A THROW IS A REASON, NOT A CRASH ON THE PAINT PATH. `PreviewPane`'s
      // header is explicit that a pane which dies reads as "correctly inert"
      // from every negative test; this keeps the two distinguishable.
      return no(`the translator threw: ${String((err && err.message) || err)}`)
    }
  }

  const gate = paneGate(t)
  if (!gate.ok) return no(gate.reason, gate.guard, t)

  // ⛔ THE ROWS ARE THE ONES A CHART CAN DRAW, and `hidden` is respected because
  // an author who wrote `display = display.none` meant it — Clouds' layer plots
  // exist only as `fill` anchors. A pane that drew them would be drawing the
  // scaffolding.
  // ⛔⛔ AND AN `alertcondition` IS NOT DRAWABLE — RULING D1. It registers a
  // condition the platform offers under Alerts and draws nothing in Pine, so a
  // pane that plotted it would put a 0/1 square wave on a volume scale beside
  // four real series. `chooseOutput` already declines to SELECT one on this lane;
  // this is the same rule applied to the whole row set, because the second and
  // third conditions in a script were never the selected row anyway.
  const drawable = (t.outputs || [])
    .filter((o) => o && o.ast && o.formula && !o.hidden && !o.refusal
      && o.kind !== 'alertcondition')
    .slice(0, CARRY_MAX)
  if (!drawable.length) return no('this script declares nothing a chart can draw', null, t)

  // ⛔⛔ THE LINT SCOPE MUST BE THE SCOPE THE DOOR WILL USE.
  // `evaluateFormula` decides the repaint mode, and it needs the DEFINITION's
  // declared inputs — chrome plus the member's own knobs — or a formula naming
  // `basisInput` reads as an unknown series and comes back `repaints`. The
  // install door lints against the finished document's inputs and measures
  // `non-repainting`, then refuses the disagreement. Measured on the corpus:
  // 15 scripts refused with `declared "repaints" but the linter MEASURES
  // "non-repainting"` — two authorities over one badge, four lines apart.
  const memberSpecs = memberInputSpecs(drawable)
  const lintScope = {
    ...BUILDER_INPUT_SCOPE,
    ...Object.fromEntries((memberSpecs || []).map((spec) => [spec.key, true])),
  }
  const rows = drawable.map((o, i) => {
    const p = o.presentation || {}
    // ⛔⛔ THE MODE COMES FROM THE LINTER, NEVER FROM A DEFAULT WRITTEN HERE.
    // `meta.repaint` is a TRUTH CLAIM a member makes decisions on, and the
    // install door refuses a declaration that disagrees with what it measures —
    // IN BOTH DIRECTIONS, because under-claiming is as false as over-claiming.
    // ⚰️ A hard-coded `'clean'` here declared `repaints` on a plain
    // `sma(close, 20)` and the door refused it with
    // `declared "repaints" but the linter MEASURES "non-repainting"`. Asking the
    // same function the door asks is the only way the two can agree.
    const ev = evaluateFormula(o.formula, lintScope)
    return {
      key: keyAt(i),
      label: o.title || '',
      source: o.formula,
      ast: o.ast,
      mode: (ev && ev.verdict && ev.verdict.mode) || 'clean',
      readback: (ev && ev.readback) || '',
      style: typeof p.style === 'string' ? p.style : 'line',
      color: typeof p.color === 'string' ? p.color : undefined,
      hidden: false,
      ...(p.marker && p.marker.shape ? { marker: p.marker } : {}),
    }
  })

  // ⛔ EVERY LOCATOR NAMES ITS PLOT EXPLICITLY, INCLUDING PLOT 1 — the rule
  // `BuilderSheet`'s multi-output import already follows. `treeIndex: null`
  // resolves against `compute.ast`, which is an ALIAS of the scan plot, so a
  // later reassignment would silently move every unnamed locator.
  const manifest = manifestFromPlacements(t.inputParams || [], drawable.map((o, i) => ({
    treeIndex: keyAt(i),
    locators: paramLocatorsIn(t.inputParams || [], o.ast),
  })))

  const declaredName = String(name || t.title || 'Pine script').slice(0, 40)
  let definition = null
  try {
    definition = buildDefinition({
      defId: id || MEMBER_PANE_DEF_PREFIX,
      name: declaredName,
      source: rows[0].source,
      ast: rows[0].ast,
      mode: rows[0].mode,
      readback: rows[0].readback,
      inputs: memberSpecs,
      plots: rows,
      // ⭐ THE AUTHOR'S OWN PANE INTENT. `overlay = true` means the price pane;
      // anything else gets its own sub-pane at a quarter of the chart.
      // ⚰️ IT IS `presentation.overlay`, NOT `declaration.overlay`.
      // `translatePine`'s `declaration` is the STRING `"indicator"` — the word
      // the script declared itself with — so `declaration.overlay` is
      // `undefined` for every script ever written, and a reader written that way
      // silently puts EVERY import on its own sub-pane including the ones whose
      // author asked for the price pane. `visualParitySet.test.js::documentOf`
      // still reads it the wrong way; the overlay case below is the rail.
      placement: (t.presentation && t.presentation.overlay === true)
        ? { target: 'price' }
        : { target: 'pane', pane: { height: MEMBER_PANE_HEIGHT } },
      paramManifest: Object.keys(manifest).length ? manifest : null,
    })
  } catch (err) {
    return no(`the document could not be built: ${String((err && err.message) || err)}`, null, t)
  }
  // ⭐ THE CONDITIONS THE PANE DECLINED, AS SENTENCES — ruling D1's disclosure,
  // produced here rather than left for the pane to compose. A member whose script
  // declares an alert should be told where it went, on the surface that did not
  // draw it.
  const notes = (t.outputs || []).flatMap((o) => alertNoteForOutput(o))
  return { ok: true, definition, reason: null, guard: null, translation: t, rows, notes }
}

/** The member's OWN declared inputs, as `buildDefinition` wants them.
 *
 *  ⚰️ THIS READ `translation.declared` AND THAT IS AN ARRAY OF **NAMES**, not of
 *  input specs. `buildDefinition` passes them straight into the document, so the
 *  install door answered `inputs[14].key: required non-empty string, got
 *  undefined` — on 16 corpus scripts, every one with the same sentence. Measured
 *  while re-running the install census for R-G; it had been invisible because
 *  `uncharted-volume-v2.pine` declares NO surviving member input, so the one
 *  script this module was built against took the `undefined` branch and the
 *  default.
 *
 *  ⭐ THE SPECS COME OFF THE ROWS. `memberInputTranslation` annotates each output
 *  with `memberInputs` — `{key, type, label, default}`, the shape `defSchema`
 *  validates — and a multi-plot document needs the UNION across the rows it
 *  keeps, deduped by key, because one knob can feed several plots.
 *
 *  ⛔ ONLY THE ROWS THE PANE KEEPS. An input referenced solely by an output the
 *  pane declined (a hidden helper, an `alertcondition`) is not a knob this
 *  document has anything to do with, and declaring it would put a control on a
 *  member's pane that moves nothing.
 *
 *  ⚠️ AN EMPTY LIST RETURNS `undefined` ON PURPOSE: `buildDefinition` falls back
 *  to `BUILDER_INPUTS` for a falsy list, so passing `[]` and passing nothing are
 *  the same thing — said out loud here so the next reader does not "fix" it.
 */
function memberInputSpecs(rows) {
  const byKey = new Map()
  for (const o of rows) {
    for (const spec of (o.memberInputs || [])) {
      if (spec && typeof spec.key === 'string' && spec.key && !byKey.has(spec.key)) {
        byKey.set(spec.key, spec)
      }
    }
  }
  return byKey.size ? [...byKey.values()] : undefined
}

/** ⭐⭐ N DEFINITIONS THAT DIFFER ON ONE PARAMETER — the honest shape of
 *  "two Volume instances with different `lookbackBarsHVE`".
 *
 *  ⛔⛔ TWO INSTANCES OF ONE DEFINITION CANNOT DIFFER ON IT, and that is a
 *  property of the system rather than a gap in this function. A `input.int` the
 *  translator folded becomes an IMMUTABLE parameter in `compute.paramManifest` —
 *  a literal baked into the tree with locators pointing at it — not a
 *  `defSchema` input an instance carries a value for. `applyParamEdit` rewrites
 *  that literal and hands back a NEW definition, atomically (every locator's
 *  round-trip verifies before anything is written, or nothing is).
 *
 *  ⚠️ SO THE MEMBER-FACING FACT IS: varying a folded parameter costs a second
 *  definition, not a second instance. Written down here because the alternative
 *  — quietly installing one definition and hoping the instance carried the
 *  value — would draw two identical panes and look like it worked.
 *
 *  @param {object} arg
 *  @param {string} arg.source the member's script
 *  @param {string} arg.paramId e.g. `'__uct_param_3'`
 *  @param {Array<number|string|boolean>} arg.values one per variant
 *  @param {string} [arg.idPrefix]
 *  @returns {{ok: boolean, variants: object[], reason: string|null}}
 */
export function memberPaneVariants({ source, paramId, values, idPrefix = MEMBER_PANE_DEF_PREFIX }) {
  const base = memberPaneDefinition({ source, id: `${idPrefix}-0` })
  if (!base.ok) return { ok: false, variants: [], reason: base.reason }
  if (!Array.isArray(values) || !values.length) {
    return { ok: false, variants: [], reason: 'no values to vary' }
  }
  const out = []
  for (let i = 0; i < values.length; i += 1) {
    const one = memberPaneDefinition({ source, id: `${idPrefix}-${i}`, translation: base.translation })
    if (!one.ok) return { ok: false, variants: [], reason: one.reason }
    const applied = applyParamEdit(one.definition, paramId, values[i])
    if (!applied.ok) {
      // ⛔⛔ THE D1 CASE, NAMED RATHER THAN LEFT AS "no such parameter".
      // A parameter the SCRIPT declares can be absent from the PANE's document
      // because every locator for it sits in a row the pane does not draw —
      // and after ruling D1 an `alertcondition` is exactly such a row. Measured
      // on `uncharted-volume-v2.pine`: `lookbackBarsHVE` (`__uct_param_3`)
      // appears in the HVE Trigger tree and NOWHERE else, so once the condition
      // goes to Alerts the knob has no drawn series left to move.
      const known = ((one.translation || {}).inputParams || [])
        .find((p) => p && p.id === paramId)
      if (known && !((one.definition.compute || {}).paramManifest || {})[paramId]) {
        return {
          ok: false,
          variants: [],
          reason: `\`${known.title || paramId}\` is declared by this script but reaches `
            + 'no series this pane draws — every place it is used sits in an output the '
            + 'pane declined (an alert condition draws nothing). Varying it would change '
            + 'no pixel.',
        }
      }
      return { ok: false, variants: [], reason: applied.error }
    }
    out.push({ value: values[i], definition: applied.definition, notes: one.notes })
  }
  return { ok: true, variants: out, reason: null }
}
