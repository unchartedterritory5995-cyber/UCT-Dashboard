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
import { DEFAULT_SERIES_COLOUR, V3_DEFAULT_SERIES_OPACITY } from '../../engine/pinePalette'
import { paneGate, paneObjectsGate } from '../../engine/ast/paneGate'
import { objectLossNote } from '../../engine/ast/objectLoss'
import { objectsOnlyPaneEnabled } from '../../engine/objectsOnlyPaneGate'
import { memberInputTranslation } from '../builderInputs'
import { manifestFromPlacements, paramLocatorsIn } from '../pineParamManifest'
import {
  alertNoteForOutput, foldNotesForOutput, REQUIREMENT_NOTES,
} from '../../engine/ast/parse'
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

/** ⛔ THE PANE'S OWN CEILING. A script with forty plots is not a reason to
 *  register forty columns on somebody's chart.
 *
 *  ⚰️⚰️ THIS SAID "THE SAME CEILING THE BUILDER'S OWN IMPORT USES" AND THERE IS NO
 *  IMPORT. Measured 2026-09-15: this constant is not exported, and
 *  `BuilderSheet.jsx` declares a SECOND `const CARRY_MAX = 12` inline. Two
 *  independent constants with one name, and a comment asserting a wiring nobody
 *  built — `lesson_a_comment_claiming_agreement_is_not_agreement`. The comment is
 *  corrected in the same commit as the number, or the trap outlives the fix.
 *
 *  ⭐ R25 — IT IS PER SURFACE, AND HIDDEN ANCHORS DO NOT COUNT AGAINST IT. The
 *  builder's cap bounds COLUMN REGISTRATION ("forty columns on somebody's
 *  chart"); a `display.none` anchor registers no column and draws no series, so
 *  it is not what that cap protects. Clouds needs **23** rows of which 21 are
 *  anchors; the visible ceiling is unchanged at 12 and the document ceiling is
 *  23 × 1.5 = 34, rounded to 36 for headroom, so a script one cloud larger than
 *  Clouds still lands. */
const CARRY_MAX = 12
const DOC_CARRY_MAX = 36

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
/** ⭐⭐ WHAT TRADINGVIEW DRAWS WHEN THE AUTHOR NAMES NO COLOUR.
 *
 *  A `plot` / `plotshape` / `plotchar` that says nothing about colour draws
 *  `#2962FF` on TradingView at every version probed, v3 at 35% transparency —
 *  measured on live captures, see `DEFAULT_SERIES_COLOUR`. Without this the row
 *  reached the sheet colourless and the sheet gave it the engine's own gold, a
 *  colour the author never saw.
 *
 *  ⛔ APPLIED HERE, NOT IN THE TRANSLATOR. `presentation` reports what the author
 *  WROTE ("absent is absent"); a platform default is a rendering rule, and this
 *  is the one place a Pine row becomes something the chart renders.
 *
 *  ⛔ ONLY WHEN THE AUTHOR SAID NOTHING. A colour the translator could not carry
 *  (`colorDynamic`, `colorDynamicArity`) is the author speaking, and painting it
 *  blue would present a guess as their choice; it stays uncarried. `fill`,
 *  `hline` and the candle outputs have their own defaults, not yet measured. */
const DEFAULT_COLOURED_KINDS = new Set(['plot', 'plotshape', 'plotchar'])
function tradingViewDefaultColour(output, version) {
  const p = output.presentation || {}
  if (!DEFAULT_COLOURED_KINDS.has(output.kind)) return p
  const saidSomething = p.color !== undefined || p.colorUp !== undefined
    || p.colorDown !== undefined || p.colorPalette !== undefined
    || p.colorDynamic || p.colorDynamicArity !== undefined
  if (saidSomething) return p
  return {
    ...p,
    color: DEFAULT_SERIES_COLOUR,
    // ⛔ An author's own `transp=` already set `opacity`; it is never overridden.
    ...(version === 3 && p.opacity === undefined ? { opacity: V3_DEFAULT_SERIES_OPACITY } : {}),
  }
}

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

  // ⭐ THE FLAG IS READ HERE, ONCE. `paneGate` is a pure decision and stays one;
  // the UI layer is what knows how this build was configured.
  const allowObjectsOnly = objectsOnlyPaneEnabled()
  const gate = paneGate(t, { allowObjectsOnly })
  if (!gate.ok) return no(gate.reason, gate.guard, t)
  // ⭐⭐ 2026-09-27 (owner ruling, option b) — WHAT THE OBJECT PROGRAM LOST.
  // `paneGate` has already refused a drawing-only script that lost a removal. A
  // script that ALSO plots reaches here with the same loss, and its plots are
  // still true: they are drawn, and its drawings are WITHHELD rather than drawn
  // as a picture that keeps objects TradingView removed. The pane already draws a
  // plot-only document (`objects: null` is every script without drawings), so
  // withholding is a narrowing of what it draws, never a new render path.
  const objectsGate = paneObjectsGate(t)
  const withholdObjects = !objectsGate.draw

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
  // ⭐⭐ (j) j.1 / R24 — A HIDDEN OUTPUT IS CARRIED, AND CARRYING ONE IS NOT A D2
  // REVISIT. D2 governs WHICH lane's saved definition a pane reads, not what a
  // definition may CONTAIN. Clouds' 21 `display.none` plots are the anchors its
  // 20 fills reference: drop them and the fills have nothing to point at, which
  // is why the pane carried 2 of 23 rows and drew no cloud at all.
  //
  // ⛔ THE VISIBLE CEILING IS UNCHANGED. `CARRY_MAX` still bounds what a member
  // sees; `DOC_CARRY_MAX` bounds the document, because an anchor costs a row and
  // not a column. A script with forty VISIBLE plots is still cut at 12.
  //
  // ⛔ AND RULING 1.2 IS UNTOUCHED, WHICH IS THE WHOLE RISK HERE. That ruling is
  // about what the door OFFERS and SELECTS — "a column offered under the script's
  // title that is actually the author's hidden ohlc4 fill edge is a
  // mistranslation wearing a label". Selection is `chooseOutput`'s and it already
  // declines a hidden row; this only decides what the document CONTAINS.
  // Carriage is not offer, and the acceptance pins that both ways.
  const carryable = (t.outputs || [])
    .filter((o) => o && o.ast && o.formula && !o.refusal && o.kind !== 'alertcondition')
  const visible = carryable.filter((o) => !o.hidden).slice(0, CARRY_MAX)
  const visibleSet = new Set(visible)
  const drawable = carryable
    .filter((o) => !o.hidden ? visibleSet.has(o) : true)
    .slice(0, DOC_CARRY_MAX)
  // ⛔ THE REFUSAL STILL KEYS OFF WHAT CAN BE *SEEN*. A script whose only rows are
  // hidden anchors draws nothing a member could look at, and saying "nothing a
  // chart can draw" remains the honest answer for it.
  // ⭐⭐ …UNLESS WHAT IT DRAWS IS AN OBJECT. A table-only script has no output
  // rows at all, so every row filter above empties — and "declares nothing a
  // chart can draw" becomes FALSE about a script that draws a table. The
  // definition already carries the object program (see `objects:` below) and
  // `objectReaderFor` already reads it; the only thing standing in the way was
  // this sentence, written when `ok: false` could only mean "nothing came out".
  //
  // ⛔ SAME GATE, SAME DEFAULT. Off, this returns exactly the refusal it always
  // did, and the fact that it now asks a second question is invisible.
  const drawsObjects = !withholdObjects && !!(t.objects && (t.objects.ops || []).length)
  if (!visible.length && !(allowObjectsOnly && drawsObjects)) {
    return no('this script declares nothing a chart can draw', null, t)
  }

  // ⛔⛔ THE LINT SCOPE MUST BE THE SCOPE THE DOOR WILL USE.
  // `evaluateFormula` decides the repaint mode, and it needs the DEFINITION's
  // declared inputs — chrome plus the member's own knobs — or a formula naming
  // `basisInput` reads as an unknown series and comes back `repaints`. The
  // install door lints against the finished document's inputs and measures
  // `non-repainting`, then refuses the disagreement. Measured on the corpus:
  // 15 scripts refused with `declared "repaints" but the linter MEASURES
  // "non-repainting"` — two authorities over one badge, four lines apart.
  // ⭐ The object trees' inputs join the document only when the object program
  // does: a WITHHELD drawing (a lost removal, `withholdObjects`) is not in the
  // document, and an input only it reads would be a knob that moves nothing.
  const memberSpecs = withObjectInputs(memberInputSpecs(drawable), drawsObjects ? t : null)
  const lintScope = {
    ...BUILDER_INPUT_SCOPE,
    ...Object.fromEntries((memberSpecs || []).map((spec) => [spec.key, true])),
  }
  // ⭐⭐ R34 / C1 — THE CONDITION COLUMNS THIS DOCUMENT NEEDS, minted at most once
  // per canonical formula, for a conditionally coloured FILL (j.3b) and — since
  // 2026-09-27 — a conditionally coloured PLOT. One minting helper for both, so a
  // plot and a fill coloured by the same condition share ONE column.
  //
  // ⚰️⚰️ THE PLOT HALF WAS MISSING, AND MEMBERS SAW GOLD. `outputPresentation`
  // has carried `colorUp`/`colorDown`/`colorCondition` for a plot since C1-A, and
  // `BuilderSheet`'s own Pine import mints the column; this door never did, so
  // every `plot(x, color = cond ? color.green : color.red)` on a member's chart
  // drew in the pane's default gold. Measured against TradingView 2026-09-27
  // (vendor harness, live captures): Cumulative Volume Delta's histogram
  // `#ff5252ff` vs ours `#c9a84cff` on 618/618 bars; ATR Trailing Stoploss's line
  // `#363a45ff` vs `#c9a84cff` on 568/568.
  //
  // ⛔ THEY ARE APPENDED AFTER `DOC_CARRY_MAX` HAS BOUNDED THE AUTHOR'S OUTPUTS:
  // a derived column is not an author output competing for a slot, and dropping
  // one would leave a `colorMode` naming a column nobody declared.
  const conditionRows = []
  const conditionKeyByFormula = new Map()
  const conditionColumnFor = (cc) => {
    if (!cc || typeof cc.formula !== 'string' || !cc.ast) return null
    const formula = cc.formula
    let key = conditionKeyByFormula.get(formula)
    if (!key) {
      key = keyAt(drawable.length + conditionRows.length)
      const ev = evaluateFormula(formula, lintScope)
      conditionRows.push({
        key,
        label: '',
        source: formula,
        ast: cc.ast,
        // ⛔ THE SAME `evaluateFormula` AN AUTHOR'S ROW GOES THROUGH. A second
        // evaluator over the same expression is free to disagree with the one
        // that drew the line, which is the defect `columnColorsForPlot` already
        // avoids once by riding the compute lane rather than re-deriving.
        mode: (ev && ev.verdict && ev.verdict.mode) || 'clean',
        readback: (ev && ev.readback) || '',
        style: 'line',
        // ⛔ HIDDEN: it binds no series (R27 amended) and costs the member no
        // visible slot — `CARRY_MAX` bounds what is SEEN, and this is not.
        hidden: true,
        // The marker that makes this row identifiable as DERIVED rather than
        // authored, for anything that counts outputs.
        conditionFor: formula,
      })
      conditionKeyByFormula.set(formula, key)
    }
    return key
  }
  const rows = drawable.map((o, i) => {
    const p = tradingViewDefaultColour(o, t && t.version)
    // A plot coloured by a condition between two static colours draws per point.
    const condKey = (typeof p.colorUp === 'string' && typeof p.colorDown === 'string')
      ? conditionColumnFor(p.colorCondition) : null
    // ⭐⭐ …and so does an N-way chain: a palette, and a column holding which
    // entry each bar uses (ATR Trailing Stoploss's green/red/black line).
    const paletteKey = (!condKey && Array.isArray(p.colorPalette) && p.colorPalette.length >= 2)
      ? conditionColumnFor(p.colorIndex) : null
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
      // ⭐ (j) j.1 — THE AUTHOR'S OWN `display.none`, CARRIED AS WRITTEN. It was
      // hard-coded `false` because the filter above had already removed every
      // hidden row, so the field could only ever be false and said nothing. Now
      // it is the anchor's whole meaning: the renderer draws no series for it and
      // a fill may still reference it.
      hidden: !!o.hidden,
      // ⚰️ `opacity` WAS DROPPED HERE, AND IT IS NOT DECORATION — measured on the
      // real chart, 2026-09-12 (T5 pixels). Volume v2's fourth plot is
      // `Scale Padding`: `color = #FFFFFF, opacity = 0, width = 1`, a series whose
      // whole job is to SET THE SCALE and never be seen. Without the opacity it
      // drew as a solid white line across the sub-pane — the most prominent thing
      // on it, and an artefact of the import rather than anything the script asks
      // for. `defSchema` validates it and the renderer reads it (I-4, "an author's
      // declaration dropped on the floor — Wired"); only this step was missing.
      ...(p.opacity !== undefined ? { opacity: p.opacity } : {}),
      ...(p.marker && p.marker.shape ? { marker: p.marker } : {}),
      ...(condKey ? { colorMode: `column:${condKey}`, colorUp: p.colorUp, colorDown: p.colorDown } : {}),
      ...(paletteKey ? { colorMode: `column:${paletteKey}`, colorPalette: p.colorPalette.slice() } : {}),
    }
  })

  // ⭐⭐ (j) j.1 — THE FILLS, CARRIED BY THE ANCHORS THEY ALREADY NAME.
  //
  // `presentation.fills` has shipped since a6: `{a, b, color?, opacity?}` where
  // `a` and `b` are indices into `t.outputs`, resolved by `resolveFillHandles`
  // from the SAME `outputPresentation` call a `plot()` makes. Nothing here
  // invents a colour or a second path — R10 — it maps the two output indices onto
  // the two row keys this document just assigned and copies the colour through.
  //
  // ⛔ A FILL WHOSE ANCHOR IS NOT CARRIED IS DROPPED, NOT HALF-WRITTEN. A
  // `fill: {with}` pointing at a key no plot owns would be a locator into
  // nothing, and the renderer would silently draw one less band than the document
  // claims. Dropping it keeps the document's own arithmetic closeable.
  //
  // ⚠️ COLOUR IS COPIED ONLY WHERE THE ENGINE FOLDED ONE. Clouds' own fills carry
  // NONE — their colour is `isBullish ? bull : bear` over two user functions that
  // `staticColourOf` folds neither way — so these rows get anchors and no colour,
  // which is the honest shape and exactly what j.3 has to close.
  {
    const keyOfOutput = new Map()
    drawable.forEach((o, i) => { keyOfOutput.set((t.outputs || []).indexOf(o), keyAt(i)) })
    const byKey = new Map(rows.map((r) => [r.key, r]))
    // ⭐ R34 — a conditional fill's column comes from the SAME `conditionColumnFor`
    // the plots above use (declared before the rows), so a plot and a fill over
    // one condition share one column.
    for (const f of ((t.presentation || {}).fills || [])) {
      if (!f || !Number.isInteger(f.a) || !Number.isInteger(f.b)) continue
      const ka = keyOfOutput.get(f.a)
      const kb = keyOfOutput.get(f.b)
      if (!ka || !kb || ka === kb) continue
      const row = byKey.get(ka)
      if (!row || row.fill) continue
      row.fill = { with: kb }
      if (typeof f.color === 'string') row.fillColor = f.color
      if (Number.isFinite(f.opacity)) row.fillOpacity = f.opacity
      // ⭐⭐ (j) j.3b(b) / R34 — A CONDITIONAL FILL NAMES A CONDITION COLUMN.
      //
      // j.3b(a) carries `colorUp`/`colorDown`/`colorCondition` on the fill;
      // `colorMode: 'column:<key>'` needs a COLUMN to name, and the pane document
      // had none. The condition becomes a hidden row here and the fill points at it.
      //
      // ⛔⛔ KEYED BY THE CANONICAL FORMULA. Clouds' twenty fills are twenty
      // `fill()` calls over ONE `isBullish`: keyed per fill this mints twenty
      // identical columns — twenty evaluations of one expression, twenty rows
      // against the document cap, and twenty chances for them to disagree. Keyed by
      // formula it mints one, and the second fill REUSES it.
      const fillKey = (typeof f.colorUp === 'string' && typeof f.colorDown === 'string')
        ? conditionColumnFor(f.colorCondition) : null
      if (fillKey) {
        row.fill.colorMode = `column:${fillKey}`
        row.fill.colorUp = f.colorUp
        row.fill.colorDown = f.colorDown
      } else if (Array.isArray(f.colorPalette) && f.colorPalette.length >= 2) {
        const palKey = conditionColumnFor(f.colorIndex)
        if (palKey) {
          row.fill.colorMode = `column:${palKey}`
          row.fill.colorPalette = f.colorPalette.slice()
        }
      }
    }
    // ⭐ A COLUMN NOBODY NAMES CANNOT EXIST — BY CONSTRUCTION, NOT BY A GUARD.
    //
    // ⚰️ A prune here (`only push a row some fill names`) was written first, then
    // MEASURED REDUNDANT: deleting it left every case green, because minting
    // happens inside the loop above only for a fill that has already survived every
    // `continue` — a dropped anchor, a duplicate owner — and the mint and the
    // `colorMode` assignment are one step. There is no path that mints a column and
    // then loses its namer.
    //
    // ⛔ So it is gone, per `lesson_a_guard_repeated_is_a_guard_unproved`: an
    // unreachable guard reads as protection in review, cannot be mutation-proved,
    // and would have to be maintained by everyone who touches this block. The
    // property it claimed is stronger without it — "the last fill's removal removes
    // the column" is what the acceptance pins, and it holds because a removed fill
    // never mints.
    for (const cr of conditionRows) rows.push(cr)
  }

  // ⛔ EVERY LOCATOR NAMES ITS PLOT EXPLICITLY, INCLUDING PLOT 1 — the rule
  // `BuilderSheet`'s multi-output import already follows. `treeIndex: null`
  // resolves against `compute.ast`, which is an ALIAS of the scan plot, so a
  // later reassignment would silently move every unnamed locator.
  // ⛔⛔ 2026-09-26 — …EXCEPT WHEN THERE IS NO `compute.trees` TO NAME. A document
  // with ONE row is written single-tree by `buildDefinition` (`multi` is
  // `rows.length > 1`), so a locator naming `'value'` resolved against
  // `compute.trees` — which does not exist — and every parameter of a one-plot
  // member pane was DETACHED: `applyParamEdit` refused "every locator is detached"
  // and `reconcile` reported the control dead. Measured on the rail below. `null` is
  // the one address a single-tree document has, and it is unambiguous there.
  const singleTree = rows.length === 1
  const manifest = manifestFromPlacements(t.inputParams || [], drawable.map((o, i) => ({
    treeIndex: singleTree ? null : keyAt(i),
    locators: paramLocatorsIn(t.inputParams || [], o.ast),
  })))

  // ⭐⭐ 2026-09-26 — A LEFTWARD DISPLACEMENT IS DRAWN, NOT DROPPED.
  //
  // ⚰️ `plot(x, offset = -N)` translated to the undisplaced tree plus `displace: -N`
  // on the translator's row — and these rows never carried it, so the pane drew
  // every such plot N bars LATE: a pivot marked on its confirmation bar instead of
  // the pivot bar, with nothing on screen saying so. The row now carries it and the
  // binder draws bar i's value at bar i + displace, Pine's own rule. The COLUMN is
  // untouched — the scan, the alert seam and every `source` reference still read the
  // value on the bar that computed it; `displace` is a drawing fact only.
  //
  // ⛔ AND A DEFINITION-PARAMETER EDIT MUST MOVE IT. When the displacement is `±p + c`
  // for one parameter `p` of this document, the row carries that relation and
  // `paramEdit` recomputes the displacement with the edit. When it reads a parameter
  // any other way, that parameter is WITHHELD from the manifest — an edit that moved
  // the pivot and left its drawing where it was would be the half-applied trap — and
  // the member is told why.
  const withheld = new Set()
  drawable.forEach((o, i) => {
    const d = o && o.displace
    if (!Number.isInteger(d) || d >= 0) return
    rows[i].displace = d
    const from = o._displaceFrom
    const tracked = from && manifest[from.param] ? from.param : null
    if (tracked) rows[i].displaceFrom = { param: from.param, scale: from.scale, add: from.add }
    for (const pid of (o._displaceParams || [])) {
      if (pid !== tracked && manifest[pid]) withheld.add(pid)
    }
  })
  for (const pid of withheld) delete manifest[pid]
  // ⛔ A BAND BETWEEN TWO PLOTS DRAWN AT DIFFERENT DISPLACEMENTS IS REFUSED BY NAME.
  // Each edge would be drawn where its own plot is, but which bar's colour a band
  // takes when its edges disagree is not something this door has measured against
  // TradingView — drawing one guess would be a band that looks right and is not.
  // No committed corpus script does this (measured 2026-09-26).
  for (const r of rows) {
    const w = r.fill && r.fill.with
    if (!w) continue
    const other = rows.find((x) => x.key === w)
    const a = r.displace || 0
    const b = (other && other.displace) || 0
    if (a !== b) {
      return no(`a fill joins two plots drawn at different displacements (${a} and ${b} bars), `
        + 'and which bar\'s colour such a band takes has not been measured against TradingView — '
        + 'so it is not drawn as a guess. TO UNBLOCK: give both plots the same `offset`.',
      'pine:plot-offset', t)
    }
  }

  // ⭐⭐ AN OBJECTS-ONLY SCRIPT NEEDS AN ANCHOR ROW, AND ITS PEERS ALREADY WROTE
  // ONE. A definition's primary `source`/`ast` come from its first plot, and a
  // table-only script has none — so without this the document build dies on
  // `rows[0].source` and the member is told "the translator threw".
  //
  // ⛔ IT IS HIDDEN, AND THE HIDDENNESS IS THE WHOLE JUSTIFICATION. The renderer
  // draws no series for a hidden row, so this puts nothing on screen; the object
  // program carries every visible thing the script does. `pine.js` records that
  // real published table-drawing scripts conventionally carry a `plot(0)`
  // placeholder for exactly this reason — this is that placeholder, supplied by
  // the engine for an author who declined to write one, rather than a column
  // invented out of nothing.
  //
  // ⚠ IT MUST NEVER BE OFFERED. It is not in `visible`, not in `drawable`, and
  // not in the manifest — it exists only so the document has a well-formed
  // primary. `objectsOnlyAnchor.test.js` is the rail on that.
  const OBJECTS_ONLY_ANCHOR = Object.freeze({
    key: 'value',
    label: '',
    source: '0',
    ast: Object.freeze({ type: 'num', value: 0 }),
    // ⛔⛔ THE STRING FROM `REPAINT_MODES`, NOT AN OLD VOCABULARY.
    // `worstRepaint([anchor.mode])` — the pipeline that stamps `meta.repaint` —
    // treats a mode it does not recognise as UNKNOWN and fails CLOSED to
    // `'repaints'`. The install door then re-lints a literal `0` and correctly
    // measures `'non-repainting'`, so the declaration disagrees with the
    // measurement and the definition is refused with
    // *"declared 'repaints' but the linter MEASURES 'non-repainting'"* —
    // the same disagreement `evaluateFormula`/`nativeRegistry.validateAstLane`
    // catch in both directions.
    // ⚰️ THIS WAS `'clean'` and `'clean'` is not in `REPAINT_MODES`
    // (`['non-repainting', 'preview-repaints', 'repaints']`), which is old
    // vocabulary from before the modes were named this way. Grep-verified:
    // `mode: 'clean'` appeared NOWHERE else in `chart/`. Nothing was ever
    // installing a member's objects-only definition end to end because of it.
    // A literal `0` never depends on any bar, so `'non-repainting'` is not just
    // conservative here — it is exactly what the linter will measure.
    mode: 'non-repainting',
    readback: '',
    style: 'line',
    hidden: true,
  })
  const primary = rows.length ? rows[0] : OBJECTS_ONLY_ANCHOR

  const declaredName = String(name || t.title || 'Pine script').slice(0, 40)
  let definition = null
  try {
    definition = buildDefinition({
      defId: id || MEMBER_PANE_DEF_PREFIX,
      name: declaredName,
      source: primary.source,
      ast: primary.ast,
      mode: primary.mode,
      readback: primary.readback,
      inputs: memberSpecs,
      plots: rows.length ? rows : [primary],
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
      // ⭐⭐ R2 STEP 6 — THE OBJECT PROGRAM RIDES ON THE PANE DOCUMENT TOO, OR
      // THE TABLES CANNOT REACH A CHART.
      //
      // ⚰⚰ MEASURED 2026-09-13, and it is T5b's defect in a second place.
      // `objectReaderFor` reads `definition.objects` and nothing else; the SCAN
      // document has carried it since C3B (`BuilderSheet.jsx` passes
      // `objectProgram` to both `save()` and the preview), and this document —
      // the one that actually reaches a member's chart through
      // `indicatorInstances` — did not name it. So a script whose whole product
      // is two dashboards saved, installed, drew its four plots, and drew NO
      // TABLE, with every count on the way green: `translatePine` reported 6
      // cells, `paneGate` passed, the binder asked for an object reader and got
      // `null` because the field was absent.
      //
      // ⛔ `buildDefinition` already takes this argument. Nothing needed
      // inventing; the pane document simply did not pass what it had —
      // `lesson_a_projection_drops_what_it_does_not_name`, on the same document
      // that taught it for `meta.disclosures` one item ago.
      // ⛔ AND NOT WHEN IT LOST A REMOVAL — see `withholdObjects` above.
      objects: drawsObjects ? t.objects : null,
    })
  } catch (err) {
    return no(`the document could not be built: ${String((err && err.message) || err)}`, null, t)
  }
  // ⭐ THE CONDITIONS THE PANE DECLINED, AS SENTENCES — ruling D1's disclosure,
  // produced here rather than left for the pane to compose. A member whose script
  // declares an alert should be told where it went, on the surface that did not
  // draw it.
  // ⭐ AND THE FOLDS, ON THE SAME LIST. `baseTimeframeFolds` is a divergence this
  // project has already measured and accepted; the row records that it happened,
  // and a member reading a folded series is owed the sentence beside it.
  // ⛔ DEDUPED BY CHANNEL ACROSS THE WHOLE DOCUMENT, not per row —
  // `foldNotesForOutput` dedupes within one output, and four outputs folding the
  // same call would otherwise put four copies of one sentence on screen, which
  // reads as four problems.
  const notes = []
  const seen = new Set()
  // ⭐⭐ THE DRAWING DISCLOSURE LEADS THE LIST. A pane whose lines, labels or
  // tables are incomplete — or withheld — is the fact a member most needs before
  // reading anything it draws. Worded in `objectLoss.js`, never here; `null` for
  // a clean object program and for a script that draws no objects at all.
  const drawingNote = objectLossNote(objectsGate.loss, { withheld: withholdObjects })
  if (drawingNote) {
    seen.add(`${drawingNote.name} :: ${drawingNote.note}`)
    notes.push(drawingNote)
  }
  for (const o of (t.outputs || [])) {
    for (const n of [...alertNoteForOutput(o), ...foldNotesForOutput(o)]) {
      const key = `${n.name} :: ${n.note}`
      if (seen.has(key)) continue
      seen.add(key)
      notes.push(n)
    }
  }
  // ⭐ 2026-09-26 — A PARAMETER WITHHELD BECAUSE IT SETS A DISPLACEMENT THE
  // DOCUMENT CANNOT RECOMPUTE, said in words beside the others. Silence would
  // read as "this script has no such setting".
  for (const pid of withheld) {
    const p = (t.inputParams || []).find((x) => x && x.id === pid)
    const name = (p && (p.title || p.sourceName)) || pid
    notes.push({
      name,
      note: `\`${name}\` also sets where a plot is drawn (its \`offset\`), in a way this `
        + 'document cannot recompute from a new value — so it is not offered as an '
        + 'adjustable setting here. Change it in the script and paste it again.',
    })
  }
  // ⭐⭐ T5b — THE DISCLOSURES RIDE ON THE SAVED DOCUMENT, OR THE MEMBER NEVER
  // SEES THEM.
  //
  // ⚰️ MEASURED 2026-09-13: a saved definition does NOT carry the member's Pine.
  // `compute.source` is the SCAN PLOT'S FORMULA — 126 characters for a 34,378-
  // character script — so nothing downstream can re-derive these sentences from
  // the artifact. Until now the alert note, the fold note and the window badge
  // existed only inside the builder's preview, and a member who SAVED the script
  // and opened it on their own chart got the drawing with no disclosure at all.
  // ⛔ That is the one surface the rulings are actually about: D1's sentence,
  // ruling 3.5's fold sentence, and the badge that
  // `_requirement_tags.window_dependent.why_the_pane_may` makes the CONDITION on
  // a pane being allowed to serve `ta.cum`.
  //
  // ⭐ `meta.*` IS THE SANCTIONED HOME. `defSchema` documents unknown `meta`
  // keys as IGNORE-AND-PRESERVE, so this survives validation, the round trip and
  // the server without a schema change.
  // ⛔ THE TAG IS CARRIED, NOT THE FINISHED SENTENCE. The badge needs the bar
  // count, which only the chart knows; the producer still owns the wording
  // (`parse.js::requirementNote`) and the consumer supplies the number.
  const requirementTags = requirementTagsRaised(t)
  definition.meta = {
    ...(definition.meta || {}),
    disclosures: notes.map((n) => ({ name: n.name, note: n.note })),
    requirementTags,
  }

  return {
    ok: true,
    definition,
    reason: null,
    guard: null,
    translation: t,
    rows,
    notes,
    // ⚠️ NOT A NOTE YET — a tag needs the BAR COUNT, which only the chart knows.
    // The pane finishes the sentence with `parse.js::requirementNote` once the
    // series has loaded; the producer still owns the wording.
    requirementTags,
  }
}

/** ─── ⭐⭐ WHICH REQUIREMENT TAGS THIS DOCUMENT RAISES ───────────────────────
 *
 *  ⛔⛔ DERIVED FROM THE MANIFEST'S OWN ROSTERS, NEVER TYPED. Each tag names the
 *  `calls` and `series` that set it; this walks the document's trees for those
 *  names. A literal `['cum']` here would be a second authority over a roster
 *  `_requirement_tags` already owns, and the next name added to a tag would
 *  silently stop being disclosed — the same argument `parse.js::hostAdmissible`
 *  makes for the same rosters.
 *
 *  ⚠️ AND IT IS THE PANE'S OWN DOCUMENT, so it answers about what is DRAWN. The
 *  full translation's alertcondition is not here — D1 removed it — which is the
 *  correct answer: a tag is a disclosure about a value on screen.
 */
export function requirementTagsRaised(translation, notes = REQUIREMENT_NOTES) {
  const names = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if ((node.type === 'call' || node.type === 'series') && typeof node.name === 'string') {
      names.add(node.name)
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'name') continue
      walk(node[k])
    }
  }
  for (const o of (translation && translation.outputs) || []) walk(o.ast || o.tree || null)

  const raised = []
  for (const [tag, spec] of Object.entries(notes || {})) {
    if ((spec.names || []).some((n) => names.has(n))) raised.push(tag)
  }
  return raised.sort()
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
/** ⭐⭐ THE KNOBS THE OBJECT PROGRAM READS, ADDED TO THE ROWS' KNOBS.
 *
 *  ⚰️ `memberInputSpecs` takes the specs off the DRAWN rows only — right for a
 *  plot, and blind to the drawing. An input the translation DECLARED (so every
 *  object tree reads it by name) but that no drawn row happens to use was left
 *  out of the document, and `objectReaderFor` met it as an unknown name: the
 *  tree refused and the object it placed vanished. Measured 2026-09-26 across
 *  the door's object drawers: 16 scripts with a tree refused this way.
 *
 *  ⛔ A SPEC IS NEVER INVENTED. It is taken from the translation's own
 *  annotation of whichever output declared it; a name no output annotates stays
 *  undeclared, and its tree still refuses — loudly, by name.
 */
function withObjectInputs(specs, t) {
  const declared = new Set((t && t.declared) || [])
  const trees = (t && t.objects && t.objects.trees) || []
  if (!declared.size || !trees.length) return specs
  const read = new Set()
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (n.type === 'series' && typeof n.name === 'string' && declared.has(n.name)) read.add(n.name)
    for (const k of Object.keys(n)) if (k !== 'tok') walk(n[k])
  }
  walk(trees)
  if (!read.size) return specs
  const byKey = new Map((specs || []).map((s) => [s.key, s]))
  for (const o of (t.outputs || [])) {
    for (const spec of (o.memberInputs || [])) {
      if (spec && read.has(spec.key) && !byKey.has(spec.key)) byKey.set(spec.key, spec)
    }
  }
  return byKey.size ? [...byKey.values()] : specs
}

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
 *  ⭐⭐ RULING R-H (owner, 2026-09-12): ACCEPTED FOR THIS WAVE, ROUTED FOR THE
 *  NEXT. "Inputs as runtime parameters" is a named wave-2 item beside arrays and
 *  loops — it is required for the *user inputs editable* criterion, which is NOT
 *  waived, only sequenced. Until it lands, a member cannot vary an input per
 *  pane instance, and this function is the honest shape of what they CAN do.
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
