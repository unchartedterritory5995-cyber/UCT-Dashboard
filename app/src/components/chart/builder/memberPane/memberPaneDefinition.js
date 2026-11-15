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
import { translatePine, lexPine, blockStatements, parseWholeExpression, findTop, isPunct, boundName, PAINT_RUNTIME_COLOUR, strippedForScan, OBJECT_SITE_SOURCES } from '../../engine/ast/pine'
import { withAlphaByte } from '../../designTokens'
import { DEFAULT_SERIES_COLOUR, V3_DEFAULT_SERIES_OPACITY } from '../../engine/pinePalette'
import { paneGate, paneObjectsGate, runtimeRouteOf, runtimeFallbackOf } from '../../engine/ast/paneGate'
import { runtimePaneEnabled } from '../../engine/runtimePaneGate'
import { strategyBrokerEnabled } from '../../engine/strategyBrokerGate'
import { registerStrategyBrokerGate } from '../../engine/strategyBrokerGateRegistry'
// W9-T1: the broker's build flag is read here (outside the server compute closure) and handed to the front end.
registerStrategyBrokerGate(strategyBrokerEnabled)
import { PINE_RECURRENCE_ORIGIN } from '../../engine/nativeRegistry'
import { naConditionIsFalse } from '../../engine/ast/interpret'
import { probeRuntimeProgram, probeObjectRuntime, runtimeVersionStamp, colourInputsTheRunReads } from '../../engine/runtime/runtimeColumns'
import { STRATEGY_WINDOW_HISTORY } from '../../engine/runtime/strategyRecord'
import { runtimeRepaintOf } from '../../engine/runtime/runtimeRepaint'
import { OHLC_DEF_STYLES } from '../../engine/defSchema'
import { ensureRuntimeLane } from '../../engine/runtime/runtimeAsync'
// ⭐⭐ RT5 — a runtime document may draw its OWN objects (`runtimeObjectsDoor.js`).
import { runtimeOwnObjectsOf, valueBuildDefersToDrawing } from './runtimeObjectsDoor'
// ⭐⭐ ENGINE 53 — ONE row pairing for both lanes (the runtime document and the run half).
import { pairRunRows } from './runRowPairing'
import { runtimeInputSpecsOf, plotColourInputAt } from '../../engine/runtime/runtimeInputs'
import { runtimeKillOf, runtimeNotGradedOf, runtimeSourceHash } from '../../engine/runtimeKill'
import { objectLossNote, RUN_HALF_DRAWING_SENTENCE } from '../../engine/ast/objectLoss'
// ⭐ ENGINE 53 — the run half's door reads the store's cap as the save door counts it.
import { DOCUMENT_BYTE_BUDGET } from '../../engine/ast/graphDocument'
import { storedBytesOf, sentDocument } from './storedBytes'
import { runHalfProgramDigest, isGraphForm, RUN_HALF_PROGRAM_STAMP, RUN_HALF_PROGRAM_GRAPH_STAMP } from '../../engine/runHalfProgram'
import { declaredCalcBarsOf } from '../../engine/runtime/objectStore'
import { objectsOnlyPaneEnabled } from '../../engine/objectsOnlyPaneGate'
import { memberInputTranslation, pineLineWidth } from '../builderInputs'
import { manifestFromPlacements, paramLocatorsIn } from '../pineParamManifest'
import {
  alertNoteForOutput, foldNotesForOutput, REQUIREMENT_NOTES,
} from '../../engine/ast/parse'
import { applyParamEdit } from '../paramEdit'
import { buildDefinition } from '../BuilderSheet'
import { DOOR_VERSION } from '../../engine/memberDocumentMigration'
import { evaluateFormula } from '../FormulaField'
import { BUILDER_INPUT_SCOPE, seriesNamesOf, memberInputKey } from '../builderInputs'

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
// ⭐⭐ R-P (2026-10-01, owner delegated: "you decide it all") - THE PANE'S CEILING IS
// TRADINGVIEW'S OWN: 64 plots per script. A member's script that TradingView draws in full
// is drawn in full here; at 12 it was cut (candlestick-patterns, madrid, ema-ribbon's 13th
// row). The document ceiling keeps R25's 1.5x headroom for hidden anchors: 64 x 1.5 = 96.
// (`BuilderSheet.jsx`'s own CARRY_MAX is a different limit - FORM rows in the formula
// editor, one live field each - and stays where it is, disclosed to the member.)
export const CARRY_MAX = 64
const DOC_CARRY_MAX = 96

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
    || p.colorGradient !== undefined
    || p.colorDynamic || p.colorDynamicArity !== undefined
  if (saidSomething) return p
  return {
    ...p,
    color: DEFAULT_SERIES_COLOUR,
    // ⛔ An author's own `transp=` already set `opacity`; it is never overridden.
    ...(version === 3 && p.opacity === undefined ? { opacity: V3_DEFAULT_SERIES_OPACITY } : {}),
  }
}

export function memberPaneDefinition({ source, id, name, translation = null, enumInputs = true, routeHostPartial = true } = {}) {
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
      // ⭐ `colourInputs: true` (2026-09-28): an input only a COLOUR reads is
      // declared too, as TradingView lists it — `builderInputs.withColourInputs`.
      // ⭐ C18 — `objectRuntimeCheck`: a drawing value only an imperative run can
      // compute is read from the runtime lane when that lane builds the script
      // (`pine.js::buildObjectProgram`, `rtCheck`).
      // ⭐ C43 — `guardInputs: true`: an input only a `runtime.error` condition
      // reads is declared too, so a member's own value can reach the script's
      // validation as it does on TradingView — `builderInputs.withGuardInputs`.
      t = memberInputTranslation(translatePine, source, {
        paramManifest: true, strict: true, colourInputs: true, guardInputs: true,
        // ⭐⭐ `input.string(…, options = [...])` as a LIVE dropdown knob
        // (`pine.js::enumCompare`), not welded to the author's default.
        // (`enumInputs: false` is the pre-enum door, kept for the saved-document rail.)
        enumInputs: enumInputs !== false,
        objectRuntimeCheck: probeObjectRuntime,
        // ⭐ RT1 — with the runtime fallback switched on, every refused row keeps
        // what the author said it looks like (`pine.js`, `refusedPresentation`):
        // the runtime lane may draw it. Off, the option is absent and the
        // translation is byte-identical to before.
        ...(runtimePaneEnabled() ? { refusedPresentation: true } : {}),
      })
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
  if (!gate.ok) {
    // ⭐⭐ WHAT THE COLUMNAR LANE CANNOT REPRESENT ROUTES TO THE PER-BAR RUNTIME
    // LANE (owner principle, PR #241, 2026-09-28) — behind its own gate, OFF by
    // default, and only for a refusal that names that lane (`runtimeRouteOf`).
    // Off, or not routable, this is exactly the refusal it always was.
    // ⭐⭐ RT1 (2026-10-02, integrator ruling) — AND, BEYOND THAT ROUTE, THE
    // RUNTIME LANE IS THE DOOR'S GENERAL FALLBACK: any script the host lane
    // refuses is offered to it (`runtimeFallbackOf`). If the runtime lane builds
    // it within its budgets, and everything it would draw is exact, the pane
    // draws it from there; otherwise the member reads the HOST lane's refusal,
    // verbatim (see `runtimeLaneDefinition`).
    if (runtimePaneEnabled()) {
      const routed = runtimeRouteOf(t)
      if (routed || runtimeFallbackOf(t)) {
        return runtimeLaneDefinition({
          source, id, name, t, hostReason: gate.reason, hostGuard: gate.guard, routed, no,
        })
      }
    }
    return no(gate.reason, gate.guard, t)
  }
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
  // ⭐⭐ B1 — THE PAINTS (`bgcolor` / `barcolor`) THE TRANSLATOR CARRIED. A paint
  // that is withheld by name, hidden by its author (`display.none`) or `na` draws
  // nothing, so it never reaches the document; the withheld ones are disclosed
  // below, in words.
  const allPaints = ((t.presentation || {}).paints || []).filter(Boolean)
  const drawnPaints = allPaints.filter((p) => !p.withheld && !p.hidden && !p.na)
  const drawsPaints = drawnPaints.length > 0
  if (!visible.length && !(allowObjectsOnly && (drawsObjects || drawsPaints))) {
    return no('this script declares nothing a chart can draw', null, t)
  }
  // ⛔ A PANE SCRIPT WHOSE ONLY DRAWING IS A BACKGROUND IS REFUSED BY NAME.
  // TradingView shades the script's OWN pane; that pane exists here only when a
  // series is bound in it, and this script binds none — so the shading would land
  // nowhere (or, worse, on the price pane, which the author did not ask for).
  // A `barcolor` needs no pane of its own (it recolours the chart's candles), so
  // it does not trip this.
  if (!visible.length && !drawsObjects && t.presentation && t.presentation.overlay !== true
      && drawnPaints.some((p) => p.kind === 'bgcolor')) {
    return no('this script draws only a background in a pane of its own, and a pane with no '
      + 'series in it is not built here — so the shading is not drawn rather than drawn '
      + 'over the price chart. TO UNBLOCK: give the script `overlay = true`, or a plot.',
    'pine:paint-pane', t)
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
  // ⭐⭐ 2026-09-28 — THE INPUTS ONLY A COLOUR READS (`t.colourInputs`, from
  // `builderInputs.withColourInputs`). In the lint scope from the start, because a
  // condition column below may name one; declared on the document only where a
  // condition column ACTUALLY reads one (`colourDeclared`, below), so a knob that
  // would move nothing is never handed out. ⛔ APPENDED after every value input:
  // the inputs a document already declared keep their exact order and index.
  const colourSpecs = (t.colourInputs || [])
    .filter((s) => s && typeof s.key === 'string' && !(memberSpecs || []).some((m) => m.key === s.key))
  const lintScope = {
    ...BUILDER_INPUT_SCOPE,
    ...Object.fromEntries((memberSpecs || []).map((spec) => [spec.key, true])),
    ...Object.fromEntries(colourSpecs.map((spec) => [spec.key, true])),
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
  // ⭐⭐ H1 (C45, review round 2) — A COLOUR RULE'S GATES RIDE ITS CONDITION COLUMN.
  // The translation reads the gates each colour rule carries (`pine.js::
  // colourBlockRunsOf`, keyed by the rule's formula — the key this door mints one
  // column per); the column is a plot of the document like any other, so the bind
  // refuses THAT column where the colour's arm runs after a bar it skipped
  // (`nativeRegistry.computeFor`, `engine/blockRuns.js`), and the plot draws in its
  // series colour (`binder.pointColour` → null), a fill or a paint draws nothing.
  // ⚰️ They rode the PLOT, and a plot whose colour read such an arm drew no line.
  // (`colourBlockRunsOf` writes an entry only for a rule that carries gates.)
  const colourGatesByFormula = new Map(((t && t.blockRuns && t.blockRuns.colours) || [])
    .map((c) => [c.formula, c.gates]))
  /** condition-column key → the gates its colour rule carries. One column per
   *  formula (`conditionKeyByFormula`), so a key only ever meets one formula's. */
  const colourBlockRunKeys = new Map()
  /** ⭐ B1 — the paints this document draws (`definition.paints`), built below. */
  const docPaints = []
  /** ⭐⭐ The `input.color` specs a band's hue reads, by key (see the fills loop). */
  const fillColourSpecs = new Map()
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
    // ⭐ H1 — see `colourGatesByFormula`: the gates go with the column, by formula
    if (colourGatesByFormula.has(formula)) colourBlockRunKeys.set(key, colourGatesByFormula.get(formula))
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
    // ⭐⭐ C37 — …and a GRADIENT: the column holds the bar's POSITION between two
    // static colours (`pine.js::colourGradientRule`; RVOL's line, gold on 611
    // bars before this). Same hidden-column mint as the two rules above.
    const g = p.colorGradient
    const gradientKey = (!condKey && !paletteKey && g && typeof g.from === 'string' && typeof g.to === 'string')
      ? conditionColumnFor(g) : null
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
      ...rowColour(p),
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
      // ⚰️ AND SO WAS `linewidth`. `outputPresentation` reads it (`pres.width`) and
      // `chromeInputsFor` makes a row's `width` the DEFAULT of its width input, but
      // this projection never named it, so every member-pane plot drew at the
      // input's fallback of 1. Uncharted Clouds asks `linewidth = 2` for both MAs
      // and TradingView draws 2 (capture A's own `styles.plot_0.linewidth`).
      // ⭐ UNCLAMPED (TradingView set F, `f3-linewidth-v6`: linewidth 1..10 paints
      // N device px and `styles.linewidth` reads back N) — ⚰️ this was clamped to 1-4.
      // Clamped to the width input's own [1, 4], the Builder's Pine-import rule.
      ...(Number.isFinite(p.width) ? { width: pineLineWidth(p.width) } : {}),
      ...(p.marker && p.marker.shape ? { marker: p.marker } : {}),
      ...(condKey ? { colorMode: `column:${condKey}`, colorUp: p.colorUp, colorDown: p.colorDown } : {}),
      ...(paletteKey ? { colorMode: `column:${paletteKey}`, colorPalette: p.colorPalette.slice() } : {}),
      ...(gradientKey ? {
        colorMode: `column:${gradientKey}`,
        colorGradient: {
          from: g.from, to: g.to,
          ...(Number.isFinite(g.transparency) ? { transparency: g.transparency } : {}),
        },
      } : {}),
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
      // ⭐⭐ …and a static band colour that is the script's `input.color` is the
      // member's pick (`binder.effectiveFillColour`), like the two above.
      if (f.colorInput && memberInputKey(f.colorInput.name)) {
        const k = memberInputKey(f.colorInput.name)
        row.fillColorInput = k
        if (!fillColourSpecs.has(k)) fillColourSpecs.set(k, { key: k, type: 'color', label: f.colorInput.title || k, default: f.colorInput.hex })
      }
      if (Number.isFinite(f.opacity)) row.fillOpacity = f.opacity
      // ⭐⭐ THE RAW STAMP beside it: what the script wrote for this static band's
      // transparency (`pine.js::resolveFillHandles`), so a later correction to the
      // opacity rule reaches this SAVED document with certainty
      // (`memberDocumentMigration.upgradeFromDoorStamps`).
      if (f.transparency && typeof f.transparency.via === 'string') row.fillTransparency = { ...f.transparency }
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
        // ⭐⭐ THE BAND'S HUE IS THE MEMBER'S KNOB when the script's colour is an
        // `input.color` (`pine.js::colourInputNameOf`): the fill names the input and
        // the binder reads the instance's value; `colorUp` / `colorDown` stay the
        // author's defaults, which is what an older reader draws.
        for (const [side, field] of [['colorUpInput', f.colorUpInput], ['colorDownInput', f.colorDownInput]]) {
          const k = field && memberInputKey(field.name)
          if (!k) continue
          row.fill[side] = k
          if (!fillColourSpecs.has(k)) fillColourSpecs.set(k, { key: k, type: 'color', label: field.title || k, default: field.hex })
        }
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
    // ⭐⭐ B1 — A PAINT'S COLOUR RULE BECOMES A CONDITION COLUMN THROUGH THE SAME
    // `conditionColumnFor` a plot and a fill use, so a paint and a plot coloured
    // by one condition share one column, and the renderer reads a paint's colour
    // exactly as it reads a plot's (`pool.columnColorsForPlot`).
    for (const p of drawnPaints) {
      // `line` is the call's source line: what a disclosure, and the vendor harness's
      // pairing with TradingView's own colorer plots, name the paint by.
      const doc = {
        kind: p.kind,
        ...(Number.isInteger(p.line) ? { line: p.line } : {}),
        ...(typeof p.title === 'string' && p.title ? { title: p.title } : {}),
        // ⭐ F1 — render-time placement, witnessed (`pine.js::resolvePaint`).
        ...(Number.isInteger(p.offset) && p.offset !== 0 ? { offset: p.offset } : {}),
        ...(Number.isInteger(p.showLast) ? { showLast: p.showLast } : {}),
      }
      if (typeof p.color === 'string') doc.color = p.color
      if (Number.isFinite(p.opacity)) doc.opacity = p.opacity
      if (typeof p.colorUp === 'string' && typeof p.colorDown === 'string') {
        const k = conditionColumnFor(p.colorCondition)
        if (!k) continue
        Object.assign(doc, { colorMode: `column:${k}`, colorUp: p.colorUp, colorDown: p.colorDown })
      } else if (Array.isArray(p.colorPalette) && p.colorPalette.length >= 2) {
        const k = conditionColumnFor(p.colorIndex)
        if (!k) continue
        Object.assign(doc, { colorMode: `column:${k}`, colorPalette: p.colorPalette.slice() })
      } else if (p.colorGradient && typeof p.colorGradient.from === 'string') {
        const g = p.colorGradient
        const k = conditionColumnFor(g)
        if (!k) continue
        Object.assign(doc, {
          colorMode: `column:${k}`,
          colorGradient: {
            from: g.from, to: g.to,
            ...(Number.isFinite(g.transparency) ? { transparency: g.transparency } : {}),
          },
        })
      } else if (typeof doc.color !== 'string') {
        continue
      }
      docPaints.push(doc)
    }
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
  // ⛔⛔ …AND THE CONDITION COLUMNS ARE TREES TOO. A conditional colour's column
  // (`conditionColumnFor`, above) reads the SAME parameters its plot or fill does —
  // Uncharted Clouds' `isBullish = fastMA > slowMA` reads both lengths. ⚰️ They were
  // left out of the placements, so an edit to `ma1Length` moved the MAs and the
  // twenty layers and left the colour deciding which way the cloud faces on the OLD
  // lengths: TradingView set E3 (EMA 5/50) painted 520 band-bars the wrong side and
  // E4 (21/8) 4,980.
  // ⛔ ONLY A PARAMETER A DRAWN ROW ALREADY CARRIES IS EXTENDED. A parameter that
  // lives in a condition column ALONE (a `useAdapt ? teal : orange` toggle) is the
  // colour-input lane's (`colourSpecs`), and minting a folded parameter for it here
  // would be a second door onto one knob — and would move every saved document's
  // manifest for a script nobody edited.
  const drawnPlacements = drawable.map((o, i) => ({
    treeIndex: singleTree ? null : keyAt(i),
    locators: paramLocatorsIn(t.inputParams || [], o.ast),
  }))
  const drawnParams = new Set(drawnPlacements.flatMap((p) => p.locators.map((l) => l.id)))
  const manifest = manifestFromPlacements(t.inputParams || [], [
    ...drawnPlacements,
    ...conditionRows.map((cr) => ({
      treeIndex: cr.key,
      locators: paramLocatorsIn(t.inputParams || [], cr.ast).filter((l) => drawnParams.has(l.id)),
    })),
  ])

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
  // ⭐ A colour-only input joins the document only where a condition column the
  // document carries reads it (see `colourSpecs`), appended after the value inputs.
  const colourRead = new Set()
  for (const cr of conditionRows) seriesNamesOf(cr.ast, colourRead)
  const colourDeclared = colourSpecs.filter((s) => colourRead.has(s.key))
  // ⭐⭐ C43 — THE SCRIPT'S OWN `runtime.error` CALLS RIDE ON THE DOCUMENT
  // (`meta.runtimeErrors`), with the settings their conditions read declared, so
  // the chart can evaluate them at the member's own values
  // (`engine/runtimeErrorStop.js`). Appended after every value and colour input:
  // the inputs a document already declared keep their exact order and index.
  const runtimeErrors = runtimeErrorsStamp(t)
  const guardDeclared = guardInputSpecs(t, runtimeErrors, [...(memberSpecs || []), ...colourDeclared])
  // ⭐⭐ The colour inputs a BAND's hue reads (collected with the fills, above),
  // appended after every other input, so the inputs a document already declared
  // keep their order. One the value or colour lanes already declare is not added twice.
  const priorKeys = new Set([...(memberSpecs || []), ...colourDeclared, ...guardDeclared].map((x) => x && x.key))
  const fillDeclared = [...fillColourSpecs.values()].filter((x) => !priorKeys.has(x.key))
  const docInputs = (colourDeclared.length || guardDeclared.length || fillDeclared.length)
    ? [...(memberSpecs || []), ...colourDeclared, ...guardDeclared, ...fillDeclared] : memberSpecs
  let definition = null
  try {
    definition = buildDefinition({
      defId: id || MEMBER_PANE_DEF_PREFIX,
      name: declaredName,
      source: primary.source,
      ast: primary.ast,
      mode: primary.mode,
      readback: primary.readback,
      inputs: docInputs,
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
  // ⭐⭐ B1 — THE PAINTS RIDE ON THE DOCUMENT (`defSchema.validatePaints`), and
  // only when there are any, so every other document keeps its exact shape.
  if (docPaints.length) definition.paints = docPaints
  // ⭐⭐ DIV-4 — A `barcolor` WHOSE COLOUR THE HOST LANE WITHHELD, READ FROM THE
  // PER-BAR RUN (`runtimeReadPaints`). Behind the runtime pane's own switch: off,
  // the document is exactly what it was.
  const rtRead = runtimePaneEnabled() ? runtimeReadPaints(source, t, allPaints) : null
  if (rtRead) {
    definition.compute = { ...definition.compute, runtimeColours: rtRead.compute }
    // source order within a kind is what decides which `barcolor` paints a bar
    // (`vw-bgcolor-barcolor` P1/P2), so the merged list is put back in line order
    definition.paints = [...(definition.paints || []), ...rtRead.paints]
      .map((p, i) => ({ p, i }))
      .sort((a, b) => ((a.p.line ?? 1e9) - (b.p.line ?? 1e9)) || (a.i - b.i))
      .map((x) => x.p)
  }
  const rtReadLines = new Set(rtRead ? rtRead.paints.map((p) => `${p.kind}@${p.line}`) : [])
  // ⭐⭐ ENGINE 53 — THE RUN HALF (`hostPartialRunHalf`): a script whose host object program
  // lost drawings may have them made, complete, by the per-bar run, where every gate passes.
  // Declined, the document is exactly what it was.
  const runHalf = hostPartialRunHalf({ source, id, t, objectsGate, drawable, definition, routeHostPartial })
  if (runHalf && runHalf.runtimeObjects) {
    definition.compute = { ...definition.compute, runtimeObjects: runHalf.runtimeObjects }
    // the document's own script, by hash: what the bind and the store check the run half against
    definition.meta = { ...(definition.meta || {}), [RUN_HALF_SOURCE_STAMP]: runtimeSourceHash(source) }
    // Registered once a document that may need it exists (as a runtime document does).
    ensureRuntimeLane()
  }
  // ⛔⛔ THE DOOR NEVER GUESSES A PLACEMENT. Every locator above is one the
  // translator TAGGED (`paramLocatorsIn`): a literal that came from the parameter.
  // ⚰️ Round 2 also ran the saved-document migration here, which matched the call
  // SHAPE — and claimed a constant the author hard-coded at the parameter's value
  // (`len = input.int(21)` beside a literal `ta.ema(close, 21)` in the colour rule),
  // so an edit silently rewrote the colour. `memberPaneDefinition.noGuess.test.js`.
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
  const lossNote = objectLossNote(objectsGate.loss, { withheld: withholdObjects })
  // ⭐ ENGINE 53 — a document carrying a run half says where its drawings may come from.
  const drawingNote = lossNote && runHalf && runHalf.runtimeObjects
    ? { ...lossNote, note: `${lossNote.note} ${RUN_HALF_DRAWING_SENTENCE}` } : lossNote
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
  // ⭐ B1 — A PAINT THAT IS NOT DRAWN IS SAID SO, by line and by reason. A
  // member who wrote `bgcolor(...)` and sees no shading is owed the sentence.
  for (const p of allPaints) {
    if (!p.withheld) continue
    const name = `\`${p.kind}\`${Number.isInteger(p.line) ? ` (line ${p.line})` : ''}`
    const note = rtReadLines.has(`${p.kind}@${p.line}`)
      ? `${name} takes its colour from running the script bar by bar, the way TradingView does. It is `
        + "drawn only where that run is exact: on bars that start at the symbol's listing, at the "
        + "script's own settings; anywhere else it is not drawn."
      : `${name} is not drawn: ${p.withheld.reason}.`
    const key = `${name} :: ${note}`
    if (seen.has(key)) continue
    seen.add(key)
    notes.push({ name, note })
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
  // ⭐ C48 — see `blockRuns` below: each drawable plot's own gates, by its key —
  // ⭐ H1 — and after them each colour condition column's (`colourBlockRunKeys`).
  const blockRunKeys = [
    ...drawable.flatMap((o, i) => {
      const hit = ((t.blockRuns && t.blockRuns.outputs) || []).find((x) => x.index === (t.outputs || []).indexOf(o))
      return hit ? [{ key: keyAt(i), gates: hit.gates }] : []
    }),
    ...[...colourBlockRunKeys].map(([key, gates]) => ({ key, gates })),
  ]
  definition.meta = {
    ...(definition.meta || {}),
    disclosures: notes.map((n) => ({ name: n.name, note: n.note })),
    requirementTags,
    // ⭐⭐ C12w — THIS DOCUMENT'S `accum` RECURRENCES ARE PINE TRANSLATIONS
    // (`pine.js`: `var` state and self-reference), so a series proven to start at
    // the symbol's first-ever bar may seed them there (ruling R-W,
    // `nativeRegistry.historyFromListingFor`). `meta` is the sanctioned home —
    // ignore-and-preserve through validation, the round trip and the server —
    // and it rides OUTSIDE the trees, so no tree hash moves. A document without
    // it (saved before this, or from another translator) keeps the bounded window.
    recurrenceOrigin: PINE_RECURRENCE_ORIGIN,
    // ⭐⭐ THE DOOR STAMPS (`memberDocumentMigration.DOOR_VERSION`): the script's own
    // `//@version` (null for a script with none — TradingView compiles it as v1)
    // and the version of the door that wrote this document, so the next
    // correction to what the door writes can be applied to it on load instead of
    // guessed. Outside the trees: no tree hash, `def_hash` or `compute.fn` moves.
    pineVersion: Number.isInteger(t.version) ? t.version : null,
    doorVersion: DOOR_VERSION,
    // ⭐⭐ F1 — THIS SCRIPT'S VERSION READS AN `na` `?:` TEST AS FALSE (v4+,
    // `interpret.js::naConditionIsFalse`, witnessed by CAP's `rt1-na-test` for v4,
    // v5 and v6). Applied only from the listing, beside `recurrenceOrigin`
    // (`nativeRegistry.listingOptsFor`). Outside the trees, so no tree hash moves;
    // a document without it keeps `TERNARY`'s answer.
    ...(naConditionIsFalse(t.version) ? { naConditionFalse: true } : {}),
    // ⭐⭐ C26 — the other symbols the trees read and how the script SPELLED each
    // (`translatePine`'s `otherSymbols`). The bind decides from it which listing
    // TradingView means (`engine/otherSymbols.js`); absent for every script that
    // reads no other symbol, so no other document changes.
    ...(Array.isArray(t.otherSymbols) && t.otherSymbols.length ? { otherSymbols: t.otherSymbols } : {}),
    // ⭐⭐ C41 — the lower timeframes the trees read (`translatePine`'s `lowerTf`,
    // one code per `ltf` node). A chart fetches this symbol's intraday bars for
    // them and the bind decides which are served (`engine/lowerTf.js`); absent
    // for every script that reads none, so no other document changes and no
    // other chart fetches anything.
    ...(Array.isArray(t.lowerTf) && t.lowerTf.length ? { lowerTf: t.lowerTf } : {}),
    // ⭐⭐ C43 — the `runtime.error` calls the translation placed (each with the
    // conditions it stands under) and the ones it could not (by name). Absent for
    // every script that writes no `runtime.error`, so no other document changes.
    ...(runtimeErrors ? { runtimeErrors } : {}),
    // ⭐⭐ C29 — the chart-period values the translation folded (`timeframe.period`
    // text, `.multiplier`, `.in_seconds()`), each at every rung, so a chart whose
    // period differs from the one they were folded at is refused, never drawn off
    // the other period's constants (`engine/periodReads.js`). Absent otherwise.
    // The plots (keys) that read it are named, so ONLY they are refused there.
    ...(t.periodReads ? {
      periodReads: {
        ...t.periodReads,
        keys: drawable.flatMap((o, i) => {
          const hit = (t.periodReads.outputs || []).find((x) => x.index === (t.outputs || []).indexOf(o))
          return hit ? [{ key: keyAt(i), names: hit.names }] : []
        }),
      },
    } : {}),
    // ⭐⭐ C48 — the plots that read a call in a block that may not run on every
    // bar, each with that block's guard as a tree: the bind refuses the plot, by
    // name, on a chart where the block runs after a bar it skipped
    // (`engine/blockRuns.js`). Absent for every script with no such plot.
    // ⭐ H1 — a colour's hidden condition column is such a plot too: refused, it
    // takes the colour and only the colour with it.
    ...(blockRunKeys.length ? { blockRuns: { keys: blockRunKeys } } : {}),
  }

  // ⛔⛔ ENGINE 53 — THE STORE'S CAP, ON THE FINISHED DOCUMENT AS THE STORE WILL COUNT IT
  // (`storedBytes.js`: the save's engine stamp and graph form, the store's own serialisation).
  // A run half re-embeds the whole script; over the cap it is taken out again, so a document
  // the door mints is one the store will save.
  let runHalfOut = runHalf
  let docOut = definition
  let notesOut = notes
  if (runHalf && runHalf.runtimeObjects) {
    // ⭐⭐ ENGINE 54 — the program the run half rides beside, stamped (`runHalfProgram.js`)
    docOut = withRunHalfProgramStamps(definition)
    const bytes = storedBytesOf(docOut)
    if (bytes > DOCUMENT_BYTE_BUDGET) {
      docOut = withoutRunHalf(definition)
      notesOut = notes.map(withoutRunHalfSentence)
      runHalfOut = { declined: { code: 'run-half:size', why: `with the run half the document is ${bytes} bytes as `
        + `the store counts it, past its ${DOCUMENT_BYTE_BUDGET}-byte cap` } }
    }
  }
  return {
    ok: true,
    definition: docOut,
    reason: null,
    guard: null,
    translation: t,
    rows,
    notes: notesOut,
    // ⚠️ NOT A NOTE YET — a tag needs the BAR COUNT, which only the chart knows.
    // The pane finishes the sentence with `parse.js::requirementNote` once the
    // series has loaded; the producer still owns the wording.
    requirementTags,
    // ⭐ ENGINE 53 — the run half, minted (how many host plots its column rail compares) or
    // declined (by code, for the census); absent for a script whose drawings are complete.
    ...(runHalfOut && runHalfOut.runtimeObjects ? { runHalf: { minted: true, columns: Object.keys(runHalfOut.runtimeObjects.outputs).length } } : {}),
    ...(runHalfOut && runHalfOut.declined ? { runHalfDeclined: runHalfOut.declined } : {}),
  }
}

/** ⭐⭐ ENGINE 53 — THE RUN HALF OF A HOST DOCUMENT WHOSE DRAWINGS ARE INCOMPLETE.
 *
 *  The host lane draws this script's plots exactly, and its object program lost some of
 *  the script's drawings (`objectLoss` verdict `partial` or `removes`): a drawing held in
 *  a `var`, made in a loop, read back through a getter. The per-bar run executes every
 *  drawing call in source order, TradingView's own model, so it makes them all. This mints
 *  `compute.runtimeObjects = {source, outputs, ...runtimeVersionStamp}` on the SAME `ast`
 *  document (precedent: DIV-4's `compute.runtimeColours`): the plots stay the host's, the
 *  host program stays as the fallback (`definition.objects`), and the chart draws the run's
 *  drawings only where every gate passes on every run (`nativeRegistry.js::withRunHalf`).
 *
 *  ⛔ MINTED ONLY WHEN EVERY ONE OF THESE HOLDS, else the document is byte-identical and the
 *  result says why (`runHalfDeclined: {code, why}`):
 *    · the runtime pane is on for this member (`runtimePaneEnabled`), and the caller did not
 *      opt out (`routeHostPartial: false`);
 *    · the host program lost drawings it attempted, and the script is not windowed
 *      (`calc_bars_count`: the run takes the last N bars and nothing on the host side does);
 *    · the script is not on the kill list, is on the starter allowlist, and states its
 *      repaint class;
 *    · the run builds WITH its drawings, lowers at least one, reads no other symbol or
 *      timeframe, has no unsettled `na` test, and holds no strategy broker;
 *    · every visible host row pairs one to one with a run output (`pairRunRows`, the
 *      runtime document's own pairing) — the column rail at bind compares exactly these;
 *    · the document still fits the store's 64 KiB.
 *  ⛔ IT NEVER CREATES A REFUSAL: a decline is the host document as it always was. */
function hostPartialRunHalf({ source, id, t, objectsGate, drawable, definition, routeHostPartial }) {
  const loss = objectsGate && objectsGate.loss
  if (!loss || (loss.verdict !== 'partial' && loss.verdict !== 'removes')) return null
  const declined = (code, why) => ({ declined: { code, why } })
  if (!runtimePaneEnabled() || routeHostPartial === false) {
    return declined('run-half:pane-off', 'the per-bar runtime pane is not on here')
  }
  const diag = (t && t.objectDiagnostics) || {}
  if (!(Number.isInteger(diag.attemptedOps) && diag.attemptedOps > 0)) {
    return declined('run-half:no-drawing', 'the host object program attempted no drawing')
  }
  if (declaredCalcBarsOf(strippedForScan(String(source || ''))) !== null) {
    return declined('runtime:calc-bars-count', 'the script runs on its last bars only (`calc_bars_count`), '
      + 'and the host plots are drawn over every bar')
  }
  const killed = runtimeKillOf({ source, defId: id })
  if (killed) return declined('runtime:killed', killed)
  const notGraded = runtimeNotGradedOf({ source })
  if (notGraded) return declined('runtime:not-yet-graded', notGraded)
  const repaint = runtimeRepaintOf(source)
  if (!repaint.ok) return declined('runtime:repaint-unstated', repaint.why)
  let probe
  try { probe = probeRuntimeProgram(source, { objectsInRun: true }) } catch (err) {
    probe = { ok: false, refusal: { guard: 'runtime:build', message: String((err && err.message) || err) } }
  }
  if (!probe || !probe.ok) {
    const r = (probe && probe.refusal) || {}
    return declined(r.guard || 'runtime', `${r.guard || 'runtime'}${r.message ? ` — ${r.message}` : ''}`)
  }
  if (!(probe.objectOps > 0)) return declined('run-half:no-object-ops', 'the run lowered no drawing operation')
  if (probe.requests > 0) {
    return declined('runtime:request', `${probe.requests} \`request.security\` ${probe.requests === 1 ? 'reads' : 'read'} `
      + "another symbol or timeframe, and the run is handed only the chart's own bars")
  }
  if (probe.naTests > 0) {
    return declined('runtime:na-test', `${probe.naTests} ${probe.naTests === 1 ? 'condition' : 'conditions'} can read `
      + "an `na` value in a way the run has not been matched to TradingView for the script's `//@version`")
  }
  if (probe.broker) return declined('run-half:strategy', 'the run holds a strategy broker, which runs over its own window')
  const pairing = pairRunRows(t, probe.outputs)
  if (!pairing.ok) return declined(pairing.code, pairing.why)
  const outputs = {}
  for (const [i, o] of drawable.entries()) {
    if (o.hidden) continue
    const index = (t.outputs || []).indexOf(o)
    const run = pairing.runOutputOf.get(index)
    if (!Number.isInteger(run)) {
      return declined('run-half:row-unpaired', `\`${o.title || o.kind}\` (a \`${o.kind}\`) has no run output it pairs `
        + 'with, so the run cannot be checked against it')
    }
    outputs[keyAt(i)] = run
  }
  // ⭐⭐ ENGINE 54 — EVERY HOST CREATE SITE, BY THE SOURCE CALL BOTH LANES NAME IT BY
  // (`objectProgram.js::objectSiteKey`). The bind's object rail pairs a host object with a run
  // object only through this map, so a host site with no source call, or whose call the run did
  // not lower as a drawing of the same family, declines the run half here: that site could
  // never be compared, and a run half that cannot be compared is not drawn.
  const sites = runHalfSites(t, definition.objects, probe.objectSites)
  if (!sites.ok) return declined('run-half:site-unpaired', sites.why)
  // ⛔ The store's 64 KiB cap is asked of the FINISHED document, as the store will count it
  // (`storedBytes.js`), at the end of `memberPaneDefinition` (`runHalfOverCap`).
  return { runtimeObjects: { source, outputs, sites: sites.sites, ...runtimeVersionStamp(probe.outputs) } }
}

/** ⭐⭐ ENGINE 54 — `{host site id: source call}` for every create op of the host object program
 *  (loop bodies included), each proved to be a call the run lowered as a drawing of the same
 *  family: `{ok, sites}` or `{ok: false, why}`. A program with no create op maps nothing. */
export function runHalfSites(t, program, runSites) {
  const sources = (t && t.objectDiagnostics && t.objectDiagnostics[OBJECT_SITE_SOURCES]) || {}
  const lowered = new Set((runSites || []).map((r) => `${r.site}|${r.fn}`))
  const sites = {}
  let why = null
  const walk = (ops) => {
    for (const op of ops || []) {
      if (why || !op) continue
      if (op.k === 'create') {
        const key = Object.prototype.hasOwnProperty.call(sources, op.site) ? sources[op.site] : null
        if (typeof key !== 'string') { why = `the host's ${op.family} at site ${op.site} names no source call`; return }
        if (!lowered.has(`${key}|${op.family}.new`)) {
          why = `the ${op.family} made at line ${key.split(':')[0]} is not a drawing the run makes at the same call`
          return
        }
        sites[op.site] = key
      }
      if (Array.isArray(op.body)) walk(op.body)
    }
  }
  walk(program && program.ops)
  return why ? { ok: false, why } : { ok: true, sites }
}

/** ⭐⭐ ENGINE 54 — the run half's program stamps (`runHalfProgram.js`), on the FINISHED document:
 *  `programSha256` over the trees form, and `programGraphSha256` over the graph form when the
 *  save will send the document as a graph (`storedBytes.sentDocument`). The form is decided with
 *  both stamps present (each is 64 characters, so the bytes the decision reads are final); a
 *  document that stays inline drops the graph stamp, which only makes it smaller. */
function withRunHalfProgramStamps(definition) {
  const zero = '0'.repeat(64)
  const ro0 = definition.compute.runtimeObjects
  const placeholder = { ...definition, compute: { ...definition.compute,
    runtimeObjects: { ...ro0, [RUN_HALF_PROGRAM_STAMP]: zero, [RUN_HALF_PROGRAM_GRAPH_STAMP]: zero } } }
  const sent = sentDocument(placeholder)
  const graphSent = isGraphForm(sent)
  const ro = { ...ro0, [RUN_HALF_PROGRAM_STAMP]: runHalfProgramDigest(placeholder) }
  if (graphSent) ro[RUN_HALF_PROGRAM_GRAPH_STAMP] = runHalfProgramDigest(sent)
  return { ...definition, compute: { ...definition.compute, runtimeObjects: ro } }
}

/** ⭐ ENGINE 53 — the document with its run half taken out again: the compute key, the
 *  source stamp and the drawing note's sentence, so it is byte for byte the document the
 *  door writes when it never asks (`routeHostPartial: false`). */
function withoutRunHalf(definition) {
  const compute = { ...definition.compute }
  delete compute.runtimeObjects
  const meta = { ...(definition.meta || {}) }
  delete meta[RUN_HALF_SOURCE_STAMP]
  if (Array.isArray(meta.disclosures)) meta.disclosures = meta.disclosures.map(withoutRunHalfSentence)
  return { ...definition, compute, meta }
}
const withoutRunHalfSentence = (n) => (n && typeof n.note === 'string' && n.note.endsWith(` ${RUN_HALF_DRAWING_SENTENCE}`)
  ? { ...n, note: n.note.slice(0, -(RUN_HALF_DRAWING_SENTENCE.length + 1)) } : n)

/** ⭐ ENGINE 53 — the meta key a run-half document names its own script by (the sha256 of the
 *  Pine source, UTF-8): the bind runs `runtimeObjects.source` only when it hashes to this
 *  (`nativeRegistry.js::withRunHalf`), and the store saves the document only when this, the
 *  run half's source and the row's own script are one script (`runtime_definitions.
 *  run_half_source_refusal`). */
export const RUN_HALF_SOURCE_STAMP = 'pineSourceSha256'

/** ⭐⭐ DIV-4 — THE COLUMN KEY a runtime-read paint colour lands in (`k` = its place
 *  in `compute.runtimeColours.at`). A name no host row takes (`keyAt` mints
 *  `value`, `out2`, …). */
const RUNTIME_COLOUR_KEY = (k) => `rtcolour${k + 1}`

/** ⭐⭐ DIV-4 — THE `barcolor`s THE HOST LANE WITHHELD FOR THEIR COLOUR, READ FROM THE
 *  PER-BAR RUN: `{compute, paints}` for the document, or null.
 *
 *  The host lane cannot say every colour as a formula — SuperTrend STRATEGY's
 *  `buy1[1] < sell1[1] ? color.green : …` compares two unbounded `barssince` of a
 *  recurrence, which the columnar lane refuses by name (`pine.js`, "NOT OVER A
 *  RECURRENCE"). The per-bar runtime lane runs it as Pine does. Pine's own rule for
 *  the call (reference, `barcolor`): "color (series color) Color of bars"; an `na`
 *  colour leaves the bar its own colour. So each such paint is asked of the run at
 *  its own statement, as a colour (`objectTreesAt`, kind `colour` — the C18 door
 *  objects already use), and draws the packed colour the run left on each bar
 *  (`pool.packedPointColour`: `na` paints nothing, an alpha is drawn as computed).
 *
 *  ⛔ Exact or not drawn, and decided where the colour is computed
 *  (`nativeRegistry.js::withRuntimeColours`): bars from the listing, inputs at the
 *  author's defaults, a run that completes and whose probe runs agree on every bar.
 *  ⛔ Only a `barcolor` (no style transparency) of a v4+ script, only where the host
 *  withheld it for its COLOUR (`paint:colour`); every other withholding stands, and
 *  so does this one when the run cannot build the script with the colour read. */
function runtimeReadPaints(source, t, allPaints) {
  const version = t && t.version
  if (!(Number.isInteger(version) && version >= 4)) return null
  const picked = allPaints.filter((p) => p && p.kind === 'barcolor' && p.withheld
    && p.withheld.code === 'paint:colour' && p[PAINT_RUNTIME_COLOUR] && Number.isInteger(p.line))
  if (!picked.length) return null
  // the runtime pane's own per-script gates, first (the kill list, the starter allowlist)
  if (runtimeKillOf({ source }) || runtimeNotGradedOf({ source })) return null
  const at = picked.map((p) => {
    const c = p[PAINT_RUNTIME_COLOUR]
    return { line: c.line, column: c.column, node: c.node, kind: 'colour' }
  })
  let probe
  try { probe = probeObjectRuntime(source, at, { paneLane: true }) } catch { probe = null }
  if (!probe || !probe.ok) return null
  const keys = at.map((_, k) => RUNTIME_COLOUR_KEY(k))
  const paints = picked.map((p, k) => ({
    kind: p.kind,
    line: p.line,
    ...(typeof p.title === 'string' && p.title ? { title: p.title } : {}),
    // ⭐ F1 — render-time placement rides beside the colour, as on every paint
    ...(Number.isInteger(p.offset) && p.offset !== 0 ? { offset: p.offset } : {}),
    ...(Number.isInteger(p.showLast) ? { showLast: p.showLast } : {}),
    colorMode: `column:${keys[k]}`,
    colorPacked: {},
  }))
  return { compute: { source, at, keys }, paints }
}

/* The Pine outputs a runtime document draws as rows (`RUNTIME_ROW_KINDS`) are the pairing's
 * (`runRowPairing.js`). `alertcondition` is ruling D1's (not drawn); `fill`, `hline`, `bgcolor`
 * and `barcolor` have no row on this document, and are named in its disclosure when the script
 * writes one (`RUNTIME_UNDRAWN_KINDS`). */

/** ⭐ RT6 — the host paint withholdings a runtime document can lift: the colour
 *  (the run computes it) and a v4 `bgcolor`'s default transparency (CAP round 4
 *  measured it: 90). Every other code is about WHERE or WHETHER TradingView draws
 *  the paint, which a run does not answer. */
const RUNTIME_PAINT_COLOUR_CODES = new Set(['paint:colour', 'paint:v4-default-transp'])

/** ⭐ RT1 — what the host translation lists and a runtime document does NOT draw.
 *  Said to the member by name rather than left to look like the whole script. */
const RUNTIME_UNDRAWN_KINDS = Object.freeze({
  fill: 'a fill between two plots',
  hline: 'a horizontal line',
  bgcolor: 'a background colour',
  barcolor: 'a bar colour',
})

/** W4-T13 - the calls a runtime document draws as a candle / bar FROM THE RUN. Each is four host
 *  outputs (open, high, low, close - `pine.js::MULTI_OUTPUT_CALLS`) and four run outputs of the
 *  same call, in that order, so the n-th candle of a kind on one lane is the n-th on the other. */
const RUNTIME_CANDLE_STYLE = Object.freeze({ plotcandle: OHLC_DEF_STYLES[0], plotbar: OHLC_DEF_STYLES[1] })

/** ⭐⭐ W4-T13 - WHAT A RUNTIME CANDLE / BAR NEEDS TO BE DRAWN, or why it is withheld by name.
 *
 *  Drawn from the run's own columns: the four prices and the colours the call wrote. Withheld,
 *  each with its reason, rather than drawn in a stand-in:
 *  - below Pine v5 (no capture of v4's `transp` default for a candle);
 *  - `show_last` (a window of bars the renderer is not told), `force_overlay = true` over a
 *    script that is not an overlay (it asks for the price pane; this document is a pane), a
 *    `display` other than `display.all` / `display.pane`;
 *  - a colour the call did not write (`color`, and for a candle `wickcolor` and `bordercolor`):
 *    what TradingView draws then is NOT CAPTURED (docs/pine/capture-queue-2026-11-04-w4-t13.md,
 *    W4-P1), so it is not guessed; a colour this lane could not compute.
 *  A `display.none` candle draws nothing on TradingView either and is skipped by the caller.
 *
 *  @param {string} kind  'plotcandle' | 'plotbar'
 *  @param {number|null} version
 *  @param {object} ro  the run's descriptor of the candle's CLOSE output
 *  @param {boolean} overlay  the script is an `overlay = true` one
 *  @returns {{ok: true, colours: object} | {ok: false, why: string}} */
function runtimeCandlePresentation(kind, version, ro, overlay) {
  const why = (w) => ({ ok: false, why: w })
  if (!(Number.isInteger(version) && version >= 5)) {
    return why(`the colour rules of a v${version ?? '1'} candle have no capture here`)
  }
  const c = (ro && ro.candle) || {}
  if (c.showLast === true) return why('its `show_last` limits the candle to the last bars, which this pane does not apply')
  if (c.display !== undefined && c.display !== 'display.all' && c.display !== 'display.pane') {
    return why(`its \`display = ${c.display}\` is not a place this pane reads`)
  }
  if (c.forceOverlay === 'unread') return why('its `force_overlay` is not a literal `true` or `false`')
  if (c.forceOverlay === true && !overlay) {
    return why('it asks for the price chart (`force_overlay = true`) from a script that is not an overlay')
  }
  const fields = kind === 'plotcandle'
    ? [['body', 'colour', 'color'], ['wick', 'wick', 'wickcolor'], ['border', 'border', 'bordercolor']]
    : [['body', 'colour', 'color']]
  const colours = {}
  for (const [part, field, param] of fields) {
    const f = ro && ro[field]
    if (!f) return why(`it does not write \`${param} =\`, and TradingView's default for it is not captured`)
    if (!Number.isInteger(f.output)) {
      return why(`this lane could not compute its \`${param} =\` (${f.refused || 'unreadable'})`)
    }
    colours[part] = f.output
  }
  return { ok: true, colours }
}

/* ⚰️ RT2 — `RUNTIME_REPAINT_RISK` (a regex over the raw source, comments
 * included) stood here and DECLINED every script that mentioned `request.`,
 * `barstate.`, `timenow`, `varip` or `lookahead` (127 of the corpus with the
 * runtime flag on). It could not state a class, only refuse one. The class is
 * now STATED by `engine/runtime/runtimeRepaint.js::runtimeRepaintOf` — the host
 * linter's vocabulary and reach -> class step, over the reads the program makes
 * (code, never prose) — and mirrored on the server
 * (`api/services/runtime_repaint.py`), held to one answer per corpus script by
 * `tests/fixtures/runtime_repaint/corpus.json`. */

/** ⭐⭐ RT1 — THE COLOUR A RUNTIME ROW CAN CARRY, or why it cannot.
 *
 *  A runtime document computes each row's VALUE bar by bar; it carries a row's
 *  colour only as ONE static colour (or TradingView's default for a plot whose
 *  author named none). A colour that changes per bar (a condition, a palette, a
 *  gradient, any colour the host lane could not fold) has no carrier here, and a
 *  refused row whose call could not be read at all has an UNKNOWN colour.
 *
 *  ⛔ Such a row is WITHHELD BY NAME, never drawn in a stand-in colour. R-G keeps
 *  a host-lane line whose colour is uncarried because withholding it would take a
 *  correct line off charts that draw it today; nothing draws a runtime row today,
 *  and the vendor harness grades a wrong colour DIVERGE — a wrong drawing, which
 *  this lane must not introduce.
 *
 *  ⭐⭐ RT6 — A PER-BAR COLOUR IS NOW CARRIED, FROM THE SAME RUN. The runtime
 *  lane computes the plot's `color =` as an output of the run that computes its
 *  value (`pineRuntimeFrontend.js::describeColour`, `plotColours`), so the row
 *  reads its colour per bar from a hidden column (`colorPacked`), drawn by the
 *  renderer the host lane's rows use (`pool.columnColorsForPlot` →
 *  `binder.pointColour`). Pine's `na` colour draws nothing there. Still WITHHELD
 *  BY NAME, each with its reason: a colour this lane could not compute; a shape
 *  (`plotshape` / `plotchar`) — the marker layer reads two colours, not a column;
 *  a script below v4 (no capture of its colour rules); a `transp =` this door
 *  cannot read, or one over a colour that may carry its own transparency (the
 *  vendor folds a style transparency into an OPAQUE colour only, and which bars
 *  are opaque is not provable here).
 *
 *  @param {object} o  the host output
 *  @param {number|null} version  the script's Pine version
 *  @param {object} [ro]  the runtime lane's descriptor for the same output
 *  @returns {{ok: true, p: object, colourOutput?: number} | {ok: false, why: string}} */
function runtimeRowPresentation(o, version, ro = null) {
  if (o.refusal && !o.presentation) {
    return { ok: false, why: 'its colour and style could not be read from the call' }
  }
  const raw = o.presentation || {}
  if (raw.colorDynamic || raw.colorDynamicArity !== undefined || raw.colorUp !== undefined
    || raw.colorDown !== undefined || raw.colorPalette !== undefined || raw.colorGradient !== undefined) {
    const packed = runtimeRowColour(o, version, ro)
    if (!packed.ok) return packed
    const p = { ...raw }
    for (const k of ['color', 'opacity', 'colorDynamic', 'colorDynamicArity', 'colorUp', 'colorDown',
      'colorCondition', 'colorPalette', 'colorIndex', 'colorGradient', 'colorNaGated']) delete p[k]
    p.colorPacked = packed.colorPacked
    return { ok: true, p, colourOutput: packed.colourOutput }
  }
  return { ok: true, p: tradingViewDefaultColour(o, version) }
}

/** ⭐⭐ RT6 — the run's colour column for a row whose colour changes per bar, or
 *  the reason it is withheld. One reader for the plot rows; the paints have their
 *  own (`runtimePaintColour`) because their style transparency differs. */
function runtimeRowColour(o, version, ro) {
  const why = (w) => ({ ok: false, why: `its colour changes from bar to bar, and ${w}` })
  if (o.kind !== 'plot') return why('a shape whose colour changes per bar is not carried by this lane yet')
  if (!(Number.isInteger(version) && version >= 4)) {
    return why(`the colour rules of a v${version ?? '1'} script have no capture here`)
  }
  const c = ro && ro.colour
  if (!c || !Number.isInteger(c.output)) {
    return why(c && c.refused ? `this lane could not compute it (${c.refused})` : 'this lane could not find its `color =`')
  }
  if (ro.transp === 'unread') return why('its `transp =` is not a whole number written in the call')
  const t = Number.isInteger(ro.transp) ? ro.transp : null
  if (t !== null && t > 0 && ro.colourOpaque !== true) {
    return why('its `transp =` applies over a colour that may carry its own transparency, which no capture shows')
  }
  return { ok: true, colourOutput: c.output, colorPacked: t !== null && t > 0 ? { transparency: t } : {} }
}

/** ⭐⭐ RT6 — a `bgcolor` / `barcolor`'s colour from the run (the paint's output
 *  IS its colour), with its style transparency: `transp =` as written, or — CAP
 *  round 4, `vw-bgcolor-v4-default-spy-1d-2026-10-02`: a v3/v4 `bgcolor` with no
 *  `transp` draws at transparency 90 (`styleState` T1/T3 = 90, T2 = 0). Folded
 *  into an opaque colour only, so it is carried only over a colour provably
 *  opaque on every bar. */
function runtimePaintColour(kind, version, ro) {
  if (!(Number.isInteger(version) && version >= 4)) {
    return { ok: false, why: `the paint rules of a v${version ?? '1'} script have no capture here` }
  }
  if (ro.transp === 'unread') return { ok: false, why: 'its `transp =` is not a whole number written in the call' }
  let t = Number.isInteger(ro.transp) ? ro.transp : null
  if (t === null && kind === 'bgcolor' && version <= 4) t = V4_BGCOLOR_DEFAULT_TRANSP
  if (t !== null && t > 0 && ro.colourOpaque !== true) {
    return { ok: false, why: 'a transparency applies over a colour that may carry its own, which no capture shows' }
  }
  return { ok: true, colorPacked: t !== null && t > 0 ? { transparency: t } : {} }
}

/** CAP round 4 — a v4 `bgcolor` with no `transp` (`vw-bgcolor-v4-default`). */
const V4_BGCOLOR_DEFAULT_TRANSP = 90

/** ⭐ RT1 — a plot drawn away from its own bar (`offset`). A runtime document
 *  draws each value ON the bar that computed it; a shifted plot would be drawn
 *  N bars from where TradingView draws it, so it is withheld by name. The host
 *  lane's own carriers (`displace`, `_treeShift`) cover a translated row; a
 *  refused row reports the argument it was written with (`pine.js`,
 *  `refusedPresentation`). */
function runtimeRowOffset(o) {
  if (Number.isInteger(o.displace) && o.displace !== 0) return true
  if (Number.isInteger(o._treeShift) && o._treeShift !== 0) return true
  return o._offsetWritten === true
}

/** Pine v5/v6's positional place of `offset` in each row call (the reference
 *  signatures: `plot(series, title, color, linewidth, style, trackprice, histbase,
 *  offset, …)`, `plotshape(series, title, style, location, color, offset, …)`,
 *  `plotchar(series, title, char, location, color, offset, …)`). ⛔ v4 and below
 *  carry `transp` before it, one place later; a POSITIONAL offset there is withheld
 *  rather than read at a place this door has not checked. */
const RUNTIME_OFFSET_POSITION_V5 = Object.freeze({ plot: 7, plotshape: 5, plotchar: 5 })

const OFFSET_WITHHELD = 'it is drawn away from its own bar (`offset`), and this lane draws each value on the bar that computed it'

/** The call statement a row was written on (`line`), parsed, or null. */
function rowCallAt(stmts, line, kind) {
  const find = (list) => {
    for (const st of list || []) {
      const toks = st.header || []
      if (toks.length && toks[0].line === line) return toks
      const sub = find(st.sub)
      if (sub) return sub
    }
    return null
  }
  const toks = find(stmts)
  if (!toks) return null
  const eq = findTop(toks, (t) => isPunct(t, '='))
  let node = null
  try { node = parseWholeExpression(eq > 0 && boundName(toks, eq) ? toks.slice(eq + 1) : toks) } catch { return null }
  return node && node.type === 'call' && node.name === kind ? node : null
}

/** A displacement expression's whole-number value, over integer literals, the
 *  script's own literal `input.int` settings (`ctx.ints`: key → default) and a
 *  top-level name bound ONCE to such an expression (`ctx.binds`, e.g. wyckoff's
 *  `offsetVal = -pivotLen`), with the setting keys it read; or null when it reads
 *  anything else (a variable that is reassigned, `na`, a call). */
function shiftValueOf(node, ctx, keys, depth = 0) {
  if (!node || depth > 16) return null
  if (node.type === 'number') return Number.isInteger(node.value) ? node.value : null
  if (node.type === 'name') {
    if (ctx.ints.has(node.name)) {
      keys.add(node.name)
      return ctx.ints.get(node.name)
    }
    return ctx.binds.has(node.name) ? shiftValueOf(ctx.binds.get(node.name), ctx, keys, depth + 1) : null
  }
  if (node.type === 'unary' && (node.op === '-' || node.op === '+')) {
    const v = shiftValueOf(node.arg, ctx, keys, depth + 1)
    return v === null ? null : (node.op === '-' ? -v : v) + 0
  }
  if (node.type === 'binary' && (node.op === '+' || node.op === '-' || node.op === '*')) {
    const a = shiftValueOf(node.left, ctx, keys, depth + 1)
    const b = shiftValueOf(node.right, ctx, keys, depth + 1)
    if (a === null || b === null) return null
    return node.op === '+' ? a + b : node.op === '-' ? a - b : a * b
  }
  return null
}

/**
 * ⭐⭐ PHASE 3 WS-E — WHERE A RUNTIME ROW IS DRAWN, when its call says `offset`.
 *
 * ⚰️ `runtimeRowOffset` withheld EVERY row written with an `offset`, which on the
 * runtime-on census (WS-0 baseline) was the whole of `runtime:withheld-all` for 9
 * sample scripts — Williams fractal (`offset = -n`), TWAP (`offset = offset`, an
 * input at 0), and the swing-pivot family, each drawing a correct value on the
 * wrong bar or nothing at all.
 *
 * ⭐ A LEFTWARD displacement is now CARRIED, as `plots[].displace` — the field a
 * host row already carries (2026-09-26) and the binder already draws
 * (`binder.drawShiftOf` → `displacedColumn`: bar i's value at bar i + d, Pine's
 * rule), so ONE renderer draws both lanes' shifts. Zero is no displacement.
 *
 * ⛔ WHAT STAYS WITHHELD, BY NAME:
 *   · a RIGHTWARD displacement — the binder draws only leftward ones (a host row
 *     puts a rightward one in its tree as `x[N]`, and a runtime row has no tree);
 *   · an `offset` that reads anything but integer literals and the script's own
 *     literal `input.int` settings (a variable, `na`, a call) — its value per run
 *     is not known here;
 *   · a positional `offset` below v5 (`transp` moves it one place).
 *
 * ⛔⛔ AN OFFSET THAT READS A SETTING PINS THAT SETTING. The document's displacement
 * is fixed at mint, and a member's edit of the setting would re-run the script with
 * the new value while the drawing stayed where the old one put it — the
 * half-applied trap `memberPaneDefinition` refuses on the host lane. So the keys it
 * read are returned (`keys`) and the caller keeps them at the author's default, by
 * name. TradingView at defaults is what this draws.
 *
 * @returns {{ok: true, displace: number, keys: string[]} | {ok: false, why: string}}
 */
function runtimeRowShift(o, ctx) {
  const node = ctx.stmts && Number.isInteger(o.line) ? rowCallAt(ctx.stmts, o.line, o.kind) : null
  if (!node) return runtimeRowOffset(o) ? { ok: false, why: OFFSET_WITHHELD } : { ok: true, displace: 0, keys: [] }
  const args = node.args || []
  let arg = args.find((a) => a && a.name === 'offset')
  if (!arg) {
    const at = RUNTIME_OFFSET_POSITION_V5[o.kind]
    const positional = args.filter((a) => a && !a.name)
    if (Number.isInteger(at) && positional.length > at) {
      if (!(Number.isInteger(ctx.version) && ctx.version >= 5)) {
        return { ok: false, why: `${OFFSET_WITHHELD}; its \`offset\` is passed by position in a v${ctx.version ?? '1'} script, where this door has not checked its place` }
      }
      arg = positional[at]
    }
  }
  if (!arg) return { ok: true, displace: 0, keys: [] }
  const keys = new Set()
  const v = shiftValueOf(arg.value !== undefined ? arg.value : arg, ctx, keys)
  if (v === null) {
    return { ok: false, why: `${OFFSET_WITHHELD}; its \`offset\` is not a whole number this door can read before the run` }
  }
  if (v > 0) {
    return { ok: false, why: `it is drawn ${v} bar${v === 1 ? '' : 's'} to the RIGHT of the bar that computed it (\`offset\`), which this pane does not draw yet` }
  }
  return { ok: true, displace: v, keys: [...keys] }
}

/** The script's statements and literal whole-number settings, read once per document
 *  for `runtimeRowShift`. Never throws: a source this cannot read has no statements,
 *  and every row then falls back to the old rule. */
function runtimeShiftContext(source, version, specs) {
  let stmts = null
  let tokens = []
  try {
    const lexed = lexPine(String(source || ''))
    tokens = lexed.tokens || []
    stmts = blockStatements(tokens, lexed.indents, 0)
  } catch { stmts = null }
  const ints = new Map()
  for (const s of specs || []) if (s && s.type === 'int' && Number.isInteger(s.default)) ints.set(s.key, s.default)
  // ⭐ A TOP-LEVEL NAME BOUND ONCE (`name = expr`, no `var`, never reassigned with
  // `:=` or a compound operator anywhere in the source) holds that expression on
  // every bar. ⛔ A name bound twice, or ever reassigned, is not resolved.
  const binds = new Map()
  const reassigned = new Set()
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const t = tokens[i]
    const n = tokens[i + 1]
    if (t && t.kind === 'ident' && n && n.kind === 'punct' && /^(:=|\+=|-=|\*=|\/=|%=)$/.test(n.value)) reassigned.add(t.value)
  }
  const twice = new Set()
  for (const st of stmts || []) {
    const toks = st.header || []
    if (toks.length && toks[0].kind === 'ident' && (toks[0].value === 'var' || toks[0].value === 'varip')) continue
    const eq = findTop(toks, (t) => isPunct(t, '='))
    const nameTok = eq > 0 ? boundName(toks, eq) : null
    if (!nameTok) continue
    let node = null
    try { node = parseWholeExpression(toks.slice(eq + 1)) } catch { node = null }
    if (binds.has(nameTok.value)) twice.add(nameTok.value)
    if (node) binds.set(nameTok.value, node)
  }
  for (const k of [...reassigned, ...twice]) binds.delete(k)
  // ⛔ review L2 — a SETTING reassigned anywhere (`len := len + 1`) is not its default
  // on the bar the offset reads it: not read here either, so the row is withheld.
  for (const k of reassigned) ints.delete(k)
  for (const k of ints.keys()) binds.delete(k)
  return { stmts, version: Number.isInteger(version) ? version : null, ints, binds }
}

/**
 * ⭐⭐ THE RUNTIME-LANE DOCUMENT — a member's script drawn by the per-bar lane.
 *
 * Reached ONLY from `memberPaneDefinition`, only while `runtimePaneEnabled()`,
 * for a host translation that refused: either every refusal names this lane
 * (`routed`, `runtimeRouteOf`) or, since RT1, any refusal at all
 * (`runtimeFallbackOf`) — the runtime lane is the member door's general fallback.
 *
 * ⭐⭐ RT1 — WHICH SENTENCE A MEMBER READS WHEN THIS LANE DECLINES (integrator
 * decision, stated): the HOST lane's refusal, verbatim, with its own guard. It is
 * the more informative of the two — it names the construct the member WROTE, in
 * TradingView's terms, with its `TO UNBLOCK`; the runtime lane's reasons are about
 * its own internals (a lowering, a budget). The runtime reason is carried beside
 * it (`runtimeDeclined`) for the census and diagnostics, never instead of it. A
 * ROUTED refusal keeps its old wording — its host sentence promises the per-bar
 * lane, so saying why that lane declined is part of the answer.
 *
 * ⭐ RT1 — IT IS SAVEABLE once the store accepts runtime documents (the server's
 * `PINE_RUNTIME_SAVE_ENABLED`, `api/services/runtime_definitions.py`); the store
 * refuses one with its own sentence otherwise, which `MemberPane` renders.
 *
 * ⛔ AND IT MAPS ROWS TO OUTPUTS BY KIND AND ORDER, then DECLINES on any
 * disagreement. Both lanes emit outputs in source order, so the n-th `plotshape`
 * of the one is the n-th of the other — and when the counts differ the mapping
 * is unknown, which is a refusal, never a guess.
 */
function runtimeLaneDefinition({ source, id, name, t, hostReason, hostGuard = null, routed = true, no }) {
  const decline = (code, why) => {
    const refusal = routed
      ? no(`${hostReason} — and the per-bar lane that could draw it declined: ${why}`, 'pine:state', t)
      : no(hostReason, hostGuard, t)
    return { ...refusal, runtimeDeclined: { code, why } }
  }
  // ⛔ RT1 — THE PER-SCRIPT KILL SWITCH, FIRST. A script the server lists
  // (`PINE_RUNTIME_KILL_LIST`, delivered on the auth payload) falls back off this
  // lane to the host lane's refusal. Nothing is deleted: a saved copy stays in
  // the store and comes back the moment it is unlisted.
  const killed = runtimeKillOf({ source, defId: id })
  if (killed) return decline('runtime:killed', killed)
  // ⭐⭐ GT (2026-10-02, owner ruling D6) — THE STARTER ALLOWLIST, right after the
  // kill list: only a script graded MATCH against a TradingView capture (the
  // server's list, latched from the kill-list read) is drawn bar by bar. Every
  // other script declines by name and the member reads the host lane's sentence.
  const notGraded = runtimeNotGradedOf({ source })
  if (notGraded) return decline('runtime:not-yet-graded', notGraded)
  // ⭐⭐ RT2 — THE DOCUMENT'S REPAINT CLASS, STATED (`runtimeRepaintOf`): the
  // host linter's three-word vocabulary, by the host's reach -> class rule, over
  // the reads the program makes. Every row carries it as its `mode` and as its
  // `forward` window, so the pane's repaint notice (`repaintVerdict.js`, through
  // `lint.js::lintDefinition`) says it, and the server re-derives the same class
  // at the save door. Only a source the classifier cannot READ is unstated.
  const repaint = runtimeRepaintOf(source)
  if (!repaint.ok) return decline('runtime:repaint-unstated', repaint.why)
  // ⭐⭐ RT5 — when the host object program would draw nothing here and the run
  // builds WITH its drawings, the document's objects come from its own run.
  const own = runtimeOwnObjectsOf({ source, t })
  const ownObjects = !!own.probe
  const probe = own.probe || own.valueProbe || probeRuntimeProgram(source)
  if (!probe.ok) {
    const r = probe.refusal || {}
    // RT5: a drawing the value build cannot hold is the drawing build's to explain.
    // ⭐ W3W4-D2 — and `runtime:no-output`: a script that only draws has no output in the value build.
    if (valueBuildDefersToDrawing(r.guard) && own.guard) return decline(own.guard, own.why)
    return decline(r.guard || 'runtime', `${r.guard || 'runtime'}${r.message ? ` — ${r.message}` : ''}`)
  }
  // ⛔ RT2 — A REQUEST OF OTHER BARS, by name. A request this lane does not fold
  // into its own expression (another symbol, or a timeframe that is not the
  // chart's) reads bars the pane never hands the run (`computeRuntimeColumns`
  // passes no `requestBars`), so every value would be `na` where TradingView
  // draws one. The regex gate this replaces declined every `request.` by
  // accident; now that the class is stated, the decline has to be said.
  if (probe.requests > 0) {
    return decline('runtime:request', `${probe.requests} \`request.security\` ${probe.requests === 1 ? 'reads' : 'read'} `
      + "another symbol or timeframe, and this pane holds only the chart's own bars, so it is not drawn bar by bar")
  }
  // ⛔ RT1 — A `?:` WHOSE TEST CAN BE `na`, refused by name on the FALLBACK
  // (`lowerIr.js::naTestsOf` has the two vendor captures): this lane answers `na`
  // there and TradingView takes the other branch, so drawing it would draw the
  // disagreement. The routed case keeps its measured behaviour (C23).
  // ⭐⭐ RT3 — the lane now reads an `na` condition as TradingView does from v4
  // (`interpret.js::pineBool`, `naConditionIsFalse`), so `naTests` counts only
  // what is still unsettled: a `?:` in a script below v4, and a v4/v5 `or` /
  // `not` over a value that can be `na` (`lowerIr.js::naTestsOf`).
  if (!routed && probe.naTests > 0) {
    return decline('runtime:na-test', `${probe.naTests} ${probe.naTests === 1 ? 'condition' : 'conditions'} in this script `
      + 'can read a value that is `na` in a way this lane has not matched to TradingView for the script\'s '
      + '`//@version` (a `?:` below version 4, or an `or` / `not` in version 4 or 5), so it is not drawn bar by bar '
      + 'until the two are shown to agree')
  }
  // ⭐⭐ ENGINE 53 — THE PAIRING IS ONE FUNCTION (`runRowPairing.js`), shared with the run
  // half of a host document (`hostPartialRunHalf`): the n-th output of a kind on one lane is
  // the n-th on the other, candles four to a group; a count that disagrees declines.
  const pairing = pairRunRows(t, probe.outputs)
  if (!pairing.ok) return decline(pairing.code, pairing.why)
  const { ofKind, runtimeByKind, hostCandles, runCandles, runOutputOf } = pairing
  const seen = new Map()
  const carried = []
  const withheld = []
  // ⭐ WS-E — read once: the statements and literal settings `runtimeRowShift` reads,
  // and the settings a carried displacement pins at the author's default.
  const shiftCtx = runtimeShiftContext(source, t && t.version, runtimeInputSpecsOf(source).specs)
  const shiftPinned = new Set()
  for (const { o, index } of ofKind) {
    const ord = seen.get(o.kind) || 0
    seen.set(o.kind, ord + 1)
    // ⭐ H4 — a REFUSED row the author hid (`display.none`) is hidden too; only a
    // translated row ever carried `hidden` (`pine.js`, `_authorHidden`).
    if (o.hidden || o._authorHidden === true) continue
    const label = o.title || `${o.kind} ${ord + 1}`
    // ⭐ WS-E — a leftward `offset` is carried (`runtimeRowShift`), the rest withheld.
    const shift = runtimeRowShift(o, shiftCtx)
    if (!shift.ok) { withheld.push({ label, why: shift.why }); continue }
    const out = runOutputOf.get(index)
    const pres = runtimeRowPresentation(o, t && t.version, probe.outputs[out])
    if (!pres.ok) { withheld.push({ label, why: pres.why }); continue }
    for (const k of shift.keys) shiftPinned.add(k)
    carried.push({ o, index, p: pres.p, out, colourOutput: pres.colourOutput, displace: shift.displace })
  }
  // ⭐ W4-T13 - each candle / bar is ONE row on the document (its close column), with the other
  // three prices and the colours riding as hidden columns of the same run. Merged into the plot
  // rows by source line, so the legend and the paint order read as the script does.
  const candleEntries = []
  for (const kind of Object.keys(RUNTIME_CANDLE_STYLE)) {
    const hosts = hostCandles.get(kind) || []
    const runs = runCandles.get(kind) || []
    runs.forEach((run, ord) => {
      const group = hosts.slice(ord * 4, ord * 4 + 4)
      // A candle its author hid (`display = display.none`) draws nothing on TradingView either.
      // ⛔ ONLY THE AUTHOR'S HIDING: the host also hides a candle whose four columns are the bare
      // price series (`hiddenReason: 'passthrough'`, so it does not draw four lines over the chart),
      // and that is exactly the candle that RECOLOURS the chart's own bars, which TradingView draws.
      if (group.some(({ o }) => o.hiddenReason === 'author' || o._authorHidden === true)
        || (run.ro.candle && run.ro.candle.display === 'display.none')) return
      const label = (run.ro.candle && run.ro.candle.title) || `${kind} ${ord + 1}`
      const pres = runtimeCandlePresentation(kind, t && t.version, run.ro, !!(t.presentation && t.presentation.overlay === true))
      if (!pres.ok) { withheld.push({ label, why: pres.why }); return }
      candleEntries.push({
        candle: kind,
        label,
        line: Number.isInteger(run.ro.line) ? run.ro.line : Infinity,
        index: group[3].index,
        out: run.byRole.close,
        parts: { open: run.byRole.open, high: run.byRole.high, low: run.byRole.low },
        colours: pres.colours,
      })
    })
  }
  if (candleEntries.length) {
    candleEntries.sort((a, b) => a.line - b.line)
    const merged = []
    let ci = 0
    for (const entry of carried) {
      const at = Number.isInteger(entry.o && entry.o.line) ? entry.o.line : -Infinity
      while (ci < candleEntries.length && candleEntries[ci].line < at) merged.push(candleEntries[ci++])
      merged.push(entry)
    }
    while (ci < candleEntries.length) merged.push(candleEntries[ci++])
    carried.length = 0
    carried.push(...merged)
  }
  // ⭐ WS-E — the "draws nothing" decline moved BELOW the paints: a script whose
  // only output is a `barcolor` / `bgcolor` the run computes is a document too.
  const outputs = {}
  const drawnRows = carried.slice(0, CARRY_MAX)
  // ⭐⭐ RT6 — THE COLOUR COLUMNS, minted AFTER the drawn rows (a derived column
  // never competes for an author's slot — the host lane's `conditionRows` rule):
  // one hidden row per run colour output, each mapped to that output index.
  // `colourKeyOf` is shared by the plot rows and the paints below.
  const colourRows = []
  const colourKeyByOutput = new Map()
  // W4-T13 - a candle's price columns are minted by the same function but are NOT colour outputs
  // (`colourInputsTheRunReads` is told which outputs are colours), so they keep a map of their own.
  const ohlcKeyByOutput = new Map()
  const colourKeyOf = (outputIndex, tag = 'colourFor') => {
    const keyed = tag === 'ohlcFor' ? ohlcKeyByOutput : colourKeyByOutput
    if (keyed.has(outputIndex)) return keyed.get(outputIndex)
    // ⭐ F1 — a document with NO drawn row keeps `value` for the RT5 anchor row
    // (below), so its colour columns start one slot later. Reached once F1 carried a
    // paint's `offset`: wyckoff's only output is an offset `barcolor`, and its colour
    // column took `value` beside the anchor — a duplicate key the install door refuses.
    const key = keyAt(Math.max(drawnRows.length, 1) + colourRows.length)
    outputs[key] = outputIndex
    keyed.set(outputIndex, key)
    colourRows.push({
      key,
      label: '',
      source: '0',
      ast: { type: 'num', value: 0 },
      mode: repaint.mode,
      readback: '',
      style: 'line',
      // ⛔ HIDDEN: a colour column draws nothing itself; the row that names it does.
      hidden: true,
      // `colourFor` (a colour column) or `ohlcFor` (a candle's price column): which output it holds.
      [tag]: outputIndex,
    })
    return key
  }
  const packedOf = new Map()
  const candleOf = new Map()
  const rows = drawnRows.map(({ o, index, p, out, colourOutput, displace, candle, label, parts, colours }, i) => {
    const key = keyAt(i)
    outputs[key] = out
    if (candle) {
      // ⭐ W4-T13 - the row IS the close column; `ohlc` names the other three, `ohlcColors` the
      // colour columns (`defSchema.validateOhlc`, drawn by `binder.js`).
      candleOf.set(key, {
        ohlc: {
          open: colourKeyOf(parts.open, 'ohlcFor'),
          high: colourKeyOf(parts.high, 'ohlcFor'),
          low: colourKeyOf(parts.low, 'ohlcFor'),
        },
        ohlcColors: Object.fromEntries(Object.entries(colours).map(([part, outIdx]) => [part, colourKeyOf(outIdx)])),
      })
      return {
        key,
        label,
        source: '0',
        ast: { type: 'num', value: 0 },
        mode: repaint.mode,
        readback: '',
        style: RUNTIME_CANDLE_STYLE[candle],
        hidden: false,
        output: index,
      }
    }
    if (Number.isInteger(colourOutput)) packedOf.set(key, { colorMode: `column:${colourKeyOf(colourOutput)}`, colorPacked: p.colorPacked })
    return {
      key,
      label: o.title || '',
      // ⛔ A PLACEHOLDER TREE, never a formula a reader could mistake for the
      // computation: `buildDefinition` shapes the document around one, and the
      // compute block below replaces it wholesale.
      source: '0',
      ast: { type: 'num', value: 0 },
      // ⭐ RT2 — the document's stated class (`runtimeRepaintOf`), never a default.
      mode: repaint.mode,
      readback: '',
      style: typeof p.style === 'string' ? p.style : 'line',
      ...rowColour(p),
      hidden: false,
      // `linewidth`, as the host lane's rows carry it (see that projection).
      ...(Number.isFinite(p.width) ? { width: pineLineWidth(p.width) } : {}),
      ...(p.marker && p.marker.shape ? { marker: p.marker } : {}),
      // ⭐ WS-E — a leftward `offset`, drawn by the binder as a host row's is.
      ...(Number.isInteger(displace) && displace < 0 ? { displace } : {}),
      // The host output this row draws — the vendor harness and the pane's
      // disclosures read it; nothing computes from it.
      output: index,
    }
  })
  // ⭐⭐ RT6 — THE PAINTS (`bgcolor` / `barcolor`), FROM THE SAME RUN. The runtime
  // lane already emits each paint's colour per bar (its output IS the colour);
  // the host translation's paint records (`t.presentation.paints`, B1) say what
  // the call wrote around it — its line, title, `display`, `offset`, `show_last`.
  // Paired by kind and source order, the rule the host and the vendor harness
  // use (Pine allows these calls only at global scope); a count that disagrees
  // carries none of that kind. A paint the host withheld for a reason OTHER than
  // its colour (an argument it cannot read, …) stays withheld here.
  // ⭐ F1 — a whole-number `offset` / `show_last` is render-time only (CAP round 4,
  // `vw-bgcolor-barcolor-spy-1d-2026-10-02`): the host record carries the two numbers
  // and they ride here unchanged, so the binder places the run's colour exactly as it
  // places the host lane's (`binder.js::paintRenderColours`).
  const docPaints = []
  const paintWithheld = []
  {
    const hostPaints = ((t.presentation || {}).paints || []).filter(Boolean)
    for (const kind of ['bgcolor', 'barcolor']) {
      const hk = hostPaints.filter((p) => p.kind === kind)
      const rk = runtimeByKind.get(kind) || []
      if (!hk.length) continue
      if (hk.length !== rk.length) {
        for (const p of hk) {
          if (p.hidden || p.na) continue
          paintWithheld.push({ p, why: `the two lanes disagree on how many \`${kind}\` calls the script has (${hk.length} against ${rk.length})` })
        }
        continue
      }
      hk.forEach((p, i) => {
        // A paint its author hid, or coloured `na`, draws nothing on TradingView either.
        if (p.hidden || p.na) return
        if (p.withheld && !RUNTIME_PAINT_COLOUR_CODES.has(p.withheld.code)) {
          paintWithheld.push({ p, why: p.withheld.reason })
          return
        }
        const ro = probe.outputs[rk[i]]
        const c = runtimePaintColour(kind, t && t.version, ro)
        if (!c.ok) { paintWithheld.push({ p, why: c.why }); return }
        docPaints.push({
          kind,
          ...(Number.isInteger(p.line) ? { line: p.line } : {}),
          ...(typeof p.title === 'string' && p.title ? { title: p.title } : {}),
          colorMode: `column:${colourKeyOf(rk[i])}`,
          colorPacked: c.colorPacked,
          ...(Number.isInteger(p.offset) && p.offset !== 0 ? { offset: p.offset } : {}),
          ...(Number.isInteger(p.showLast) ? { showLast: p.showLast } : {}),
        })
      })
    }
  }
  // ⭐⭐ WS-E — A DOCUMENT THAT DRAWS NOTHING DECLINES, NOW COUNTING ITS PAINTS.
  // ⚰️ This stood above the paints and asked only for a ROW or the run's own
  // drawings, so a script that only paints its bars (`barcolor(cond ? c : na)`,
  // the whole of visualizing-displacement) was declined `runtime:nothing-drawn`
  // while the run computed exactly the colour TradingView paints. A carried paint
  // is drawn by the renderer the host lane's paints use (`binder.paintRenderColours`),
  // under the hidden anchor row an objects-only document already carries (below).
  if (!carried.length && !ownObjects && !docPaints.length) {
    const why = [...withheld.map((w) => `\`${w.label}\`: ${w.why}`),
      ...paintWithheld.map(({ p, why: w }) => `\`${p.kind}\`: ${w}`)]
    return decline(why.length ? 'runtime:withheld-all' : 'runtime:nothing-drawn', why.length
      ? `every output it draws is withheld (${why.join('; ')})`
      : 'the script declares nothing a chart row draws')
  }
  const objectsGate = paneObjectsGate(t)
  const hostWouldDraw = objectsGate.draw && !!(t.objects && (t.objects.ops || []).length)
  // ⭐ WS-E review M1 — a `calc_bars_count` document never carries the host program
  // (it would draw over every bar beside plots drawn over the window); named below.
  const drawsObjects = !ownObjects && !own.hostWithheld && hostWouldDraw
  // ⭐ RT5 — a document whose only output is its drawings carries the hidden
  // anchor row an objects-only document carries (never offered, never drawn).
  if (!rows.length) {
    rows.push({
      key: 'value', label: '', source: '0', ast: { type: 'num', value: 0 }, mode: repaint.mode,
      readback: '', style: 'line', hidden: true,
    })
  }
  // ⭐⭐ UIE PHASE 2 (M4) — THE SCRIPT'S OWN SETTINGS, as ordinary `defSchema` inputs
  // (`runtime/runtimeInputs.js`): the instance carries the member's values, and the run
  // rebuilds the program with them. One that cannot be read exactly keeps the author's
  // default, and says so.
  const runtimeInputs = runtimeInputSpecsOf(source)
  // ⭐ WS-E — a setting a carried `offset` reads stays at the author's default: the
  // displacement was fixed at mint, and an edit would move the values, not the drawing.
  for (const k of shiftPinned) {
    if (!runtimeInputs.specs.some((sp) => sp.key === k)) continue
    runtimeInputs.specs = runtimeInputs.specs.filter((sp) => sp.key !== k)
    runtimeInputs.skipped.push({ key: k, call: 'input.int',
      reason: "it sets where a plot is drawn (`offset`), which this pane draws at the author's default" })
  }
  // ⭐⭐ UIE PHASE 3 (M4) — A COLOUR INPUT IS A SETTING ONLY WHERE THE RUN COLOURS WITH IT:
  // a per-bar colour, the run's own drawings, a table (`colourInputsTheRunReads`,
  // measured). ⛔ One that only sets a plot's FIXED colour is not offered twice: every
  // plot already has its own colour in Style (the builder's `$<key>Color` input, seeded
  // with the author's colour). One the run never reads at all — a host-lane drawing's
  // colour, an unused input — would be a knob that changes nothing. Both skipped, by name.
  {
    const colourKeys = runtimeInputs.specs.filter((s) => s.type === 'color').map((s) => s.key)
    if (colourKeys.length) {
      const read = colourInputsTheRunReads(source, colourKeys,
        { objectsInRun: ownObjects, outputs: [...colourKeyByOutput.keys()] })
      const dead = colourKeys.filter((k) => !read.has(k))
      if (dead.length) {
        runtimeInputs.specs = runtimeInputs.specs.filter((s) => !dead.includes(s.key))
        const plotKeys = new Set(dead.filter((k) => drawnRows.some((d) => d.o && Number.isInteger(d.o.line)
          && plotColourInputAt(source, d.o.line, new Set([k])) === k)))
        for (const k of dead) {
          runtimeInputs.skipped.push({ key: k, call: 'input.color',
            reason: plotKeys.has(k)
              ? "it sets a plot's fixed colour, which is that plot's own colour in Style"
              : 'it colours nothing this pane draws from its own run, so a colour picked here would change nothing' })
        }
      }
    }
  }
  let definition
  try {
    definition = buildDefinition({
      defId: id || MEMBER_PANE_DEF_PREFIX,
      name: String(name || t.title || 'Pine script').slice(0, 40),
      source: rows[0].source,
      ast: rows[0].ast,
      mode: repaint.mode,
      readback: '',
      inputs: runtimeDocInputs(withObjectInputs(memberInputSpecs([]), drawsObjects ? t : null), runtimeInputs.specs),
      plots: [...rows, ...colourRows],
      placement: (t.presentation && t.presentation.overlay === true)
        ? { target: 'price' }
        : { target: 'pane', pane: { height: MEMBER_PANE_HEIGHT } },
      paramManifest: null,
      objects: drawsObjects ? t.objects : null,
    })
  } catch (err) {
    return decline('runtime:document', `the document could not be built: ${String((err && err.message) || err)}`)
  }
  // ⭐⭐ RT2 — EVERY DRAWN ROW DECLARES THE DOCUMENT'S FORWARD WINDOW
  // (`plots[].forward`, the one field `defSchema` lets a non-tree plot state).
  // `lint.js::lintDefinition` turns it into the badge through `modeFromReach` —
  // the host's own step — so the pane's notice and `meta.repaint` (the worst
  // row, `buildDefinition`) say the class this document was minted with.
  definition.plots = (definition.plots || []).map((pl) => (
    pl && Object.prototype.hasOwnProperty.call(outputs, pl.key) ? { ...pl, forward: repaint.forward } : pl))
  // ⭐⭐ RT6 — a row whose colour the run computes names its colour column
  // (`colorMode` + `colorPacked`), set on the built plot because `buildDefinition`
  // projects only the host lane's three colour forms.
  definition.plots = definition.plots.map((pl) => (pl && packedOf.has(pl.key) ? { ...pl, ...packedOf.get(pl.key) } : pl))
  // ⭐ W4-T13 - a candle row names its price and colour columns, set on the built plot for the
  // same reason (`buildDefinition` projects only the fields the host lane's rows carry).
  definition.plots = definition.plots.map((pl) => (pl && candleOf.has(pl.key) ? { ...pl, ...candleOf.get(pl.key) } : pl))
  // ⭐⭐ RT6 — the paints ride on the document (`defSchema.validatePaints`), only
  // when there are any, so every other runtime document keeps its exact shape.
  if (docPaints.length) definition.paints = docPaints
  // ⭐ THE IMPLEMENTATION IS THE SCRIPT ITSELF, and nothing of the placeholder
  // survives: a `runtime` compute block may not carry the `ast` lane's keys.
  definition.compute = {
    kind: 'runtime',
    fn: `runtime:${definition.id}`,
    rev: 1,
    source,
    outputs,
    // ⭐ RT5 — the run draws this document's objects (`runtimeObjects.js`).
    ...(ownObjects ? { objects: true } : {}),
  }
  const notes = [{
    name: 'Drawn bar by bar',
    note: 'This script is drawn by running it bar by bar, the way TradingView does, '
      + 'because a single formula per line cannot hold it. Its settings can be changed '
      + 'like any indicator\'s; a value outside the script author\'s own bounds or options '
      + 'is refused by name, never stretched to fit.',
  }]
  if (runtimeInputs.skipped.length) {
    notes.push({
      name: 'Settings',
      note: `Kept at the author's default: ${runtimeInputs.skipped.map((x) => `\`${x.key}\` (${x.reason})`).join('; ')}.`,
    })
  }
  for (const w of withheld) {
    notes.push({
      name: w.label,
      note: `\`${w.label}\` is not drawn: ${w.why}. Nothing is drawn for it rather than a guess.`,
    })
  }
  // ⭐ RT2 — a document that repaints says so, naming what it reads, in the
  // member's terms. A non-repainting one says nothing (the badge is silent on
  // the clean case by design, `repaintVerdict.js`).
  if (repaint.mode !== 'non-repainting') {
    notes.push({
      name: repaint.mode === 'preview-repaints' ? 'Settles one bar later' : 'Repaints',
      note: `${repaint.mode === 'preview-repaints'
        ? 'A point on this pane can move until the next bar arrives'
        : 'A point on this pane can move after its bar has closed'}: the script reads `
        + `${repaint.reads.map((r) => `\`${r.name}\``).join(', ')} (${repaint.reads.map((r) => r.why).join('; ')}).`,
    })
  }
  // ⛔ RF — THE PAINTS ARE COUNTED TOO. Since B1 a `bgcolor` / `barcolor` is no
  // longer an entry of `t.outputs`: it is `t.presentation.paints`. This list was
  // written (RT1) against `t.outputs` only, so after B1 a runtime document that
  // draws none of its script's bar colours said NOTHING about them — measured on
  // inside-bar-range (two `barcolor`s TradingView paints; the vendor harness
  // grades its paints DIVERGE). A paint the author hid or coloured `na` draws
  // nothing on TradingView either and is not named; every other one is.
  // ⭐⭐ RT6 — a paint this document DRAWS is off that list; one it withholds is
  // named on its own line with its reason, the sentence the host lane writes.
  for (const { p, why } of paintWithheld) {
    const pname = `\`${p.kind}\`${Number.isInteger(p.line) ? ` (line ${p.line})` : ''}`
    notes.push({ name: pname, note: `${pname} is not drawn: ${why}.` })
  }
  const undrawn = [...new Set([
    ...(t.outputs || [])
      .filter((o) => o && !o.hidden && Object.hasOwn(RUNTIME_UNDRAWN_KINDS, o.kind))
      .map((o) => o.kind),
    // ⭐ WS-E — a `fill` is the RUN's output, not the host's (`t.outputs` lists no
    // fill), so a run's fills were dropped from this note: the band was not drawn
    // and nothing said so. Every fill the run lowered — solid or gradient — is named.
    ...(probe.outputs || []).filter((ro) => ro && ro.call === 'fill' && ro.hidden !== true).map(() => 'fill'),
  ])]
  if (undrawn.length) {
    notes.push({
      name: 'Not drawn by this pane',
      note: `This script also writes ${undrawn.map((k) => RUNTIME_UNDRAWN_KINDS[k]).join(', ')}, `
        + 'which a script drawn bar by bar does not draw here yet. Its lines are drawn; those are not.',
    })
  }
  const drawingNote = ownObjects || own.hostWithheld ? null : objectLossNote(objectsGate.loss, { withheld: !objectsGate.draw })
  if (drawingNote) notes.unshift(drawingNote)
  if (!ownObjects && own.hostWithheld && hostWouldDraw) {
    notes.push({
      name: 'Drawings',
      note: 'Its lines, labels, boxes and tables are not drawn: it runs on its last bars only '
        + '(`calc_bars_count`), its plots are drawn over those bars, and its drawings could only be made over '
        + 'every bar of the chart, which would be a different picture from TradingView’s.',
    })
  }
  if (ownObjects) {
    // ⭐ WS-E review M2 (owner trade-off, disclosed): when the run's drawings REPLACE a
    // drawing program that lost some of its calls, say so, so a member who saw that
    // program's drawings before knows where they went.
    const rep = own.replacedPartialHost
    notes.push({
      name: 'Drawings',
      note: 'Its lines, labels, boxes and tables are made by the same bar-by-bar run, the way '
        + 'TradingView makes them. A kind of drawing whose result is not known exactly is not drawn.'
        + (rep ? ` These replace the drawing program this pane would otherwise use, which could not make `
          + `${Number.isInteger(rep.dropped) && Number.isInteger(rep.attempted) ? `${rep.dropped} of its ${rep.attempted}` : 'some of its'} `
          + 'drawing calls; a kind of drawing the run holds back is named on the chart, not drawn from that '
          + 'program instead.' : ''),
    })
  }
  definition.meta = {
    ...(definition.meta || {}),
    lane: 'runtime',
    // ⭐ RT1 — the script's identity for the kill switch and the server's save
    // door: the sha256 of the Pine source, recomputed by the server, never trusted.
    runtimeSourceHash: runtimeSourceHash(source),
    // ⭐⭐ RT1 — RULING R-W, APPLIED TO THIS LANE. A per-bar run starts its `var`
    // state at the first bar it is handed; that is TradingView's bar 0 only when
    // the loaded series provably starts at the symbol's listing. The columnar lane
    // admits only state that forgets its seed inside its 250-bar curtain; this
    // lane cannot prove that of a whole script, so a FALLBACK document computes
    // only on a series that starts at the listing (`runtimeColumns.js`), and is
    // refused by name on any other. The routed case keeps its measured behaviour.
    // ⭐⭐ W9-T11 — A STRATEGY (its program holds a broker, possible only with the broker gate
    // on) is stamped instead with the window rule (design 3.4): its run takes the most recent
    // `ctx.historyWindowBars` bars and never R-W's curtain. Every other document is as before.
    ...(probe.broker === true ? { runtimeHistory: STRATEGY_WINDOW_HISTORY } : routed ? {} : { runtimeHistory: 'listing' }),
    // ⭐⭐ P1 HARDENING — which front end / IR built this document, and what each
    // `compute.outputs` index named when it did (`runtimeColumns.js::runtimeVersionStamp`).
    // Every run re-checks them, so a later engine that orders outputs differently
    // refuses by name instead of drawing one plot under another's name.
    ...runtimeVersionStamp(probe.outputs),
    disclosures: notes.map((n) => ({ name: n.name, note: n.note })),
    requirementTags: [],
  }
  // Registered only once a runtime document exists, so a chart that never
  // routes a script never loads the lane (`nativeRegistry.registerRuntimeLane`).
  // ⭐ RT1 — and, in a browser, the run goes off the main thread
  // (`runtime/runtimeAsync.js`).
  ensureRuntimeLane()
  return {
    ok: true,
    definition,
    reason: null,
    guard: null,
    translation: t,
    rows,
    notes,
    requirementTags: [],
    lane: 'runtime',
    // ⭐ RT1 — offered as a save; the store answers (its sentence, verbatim) when
    // it does not take runtime documents.
    saveable: true,
    withheld: withheld.map((w) => w.label),
  }
}

/** The colour rules a plot, a fill or a paint carries (`outputPresentation`,
 *  `resolvePaint`): each holds the tree (`ast`) its condition column is minted from. */
const COLOUR_RULE_KEYS = Object.freeze(['colorCondition', 'colorIndex', 'colorGradient'])

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
 *
 *  ⭐⭐ W1 RE-REVIEW (2026-11-02) — A COLOUR IS A VALUE ON SCREEN TOO. A paint
 *  (`barcolor`/`bgcolor`, `t.presentation.paints`), a plot's colour and a fill's
 *  colour each draw from a rule (`colorCondition` / `colorIndex` /
 *  `colorGradient`), and the door mints a condition column from each
 *  (`conditionColumnFor`). ⚰️ Only the plot trees were walked, so
 *  `barcolor(ta.obv > 0 ? color.green : na)` or `plot(close, color = ta.cum(volume)
 *  > 0 ? …)` drew a colour decided by a running total with no history-depth badge.
 *  The rules are walked by the SAME `walk` and matched against the SAME roster —
 *  one detector — and they only ever ADD a tag: nothing here withholds a paint.
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
  /** a plot's, a fill's or a paint's colour rules, each the tree its column is minted from */
  const walkColourRules = (pres) => {
    if (!pres || typeof pres !== 'object') return
    for (const k of COLOUR_RULE_KEYS) if (pres[k] && typeof pres[k] === 'object') walk(pres[k].ast || null)
  }
  for (const o of (translation && translation.outputs) || []) {
    const tree = (o && (o.ast || o.tree)) || null
    walk(tree)
    // a refused row keeps its presentation for the runtime lane (`refusedPresentation`)
    // and draws nothing here: only a row whose tree is walked has a colour on screen
    if (tree) walkColourRules(o.presentation)
  }
  const presentation = (translation && translation.presentation) || {}
  for (const f of presentation.fills || []) walkColourRules(f)
  for (const p of presentation.paints || []) walkColourRules(p)

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
/** ⭐ UIE PHASE 2 (M4) — a runtime document's inputs: the ones its object program
 *  already declared (kept, by key), then every literal setting of the script. */
function runtimeDocInputs(declared, specs) {
  const byKey = new Map((declared || []).map((s) => [s.key, s]))
  for (const spec of specs || []) if (!byKey.has(spec.key)) byKey.set(spec.key, spec)
  return byKey.size ? [...byKey.values()] : declared
}

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

/** ⭐⭐ C43 — the document's stamp of the script's `runtime.error` calls, from the
 *  translation's own record (`pine.js`, `runtimeErrors`), or null.
 *
 *  Per placed call: the conditions (canonical trees, each with its `negate`
 *  mark), the message parts, and how each setting the conditions read reaches
 *  them — `live` (declared: the tree carries the identifier and the chart reads
 *  the member's value) or `folded` (the tree carries the value the translation
 *  saw, recorded here so the bind can tell when the member's value has moved
 *  off it and refuse to guess). `unread` is every call the lane could not place. */
function runtimeErrorsStamp(t) {
  const re = t && t.runtimeErrors
  if (!re || (!(re.stops || []).length && !(re.unread || []).length)) return null
  const stops = (re.stops || []).map((s) => {
    const live = []
    const folded = []
    for (const e of (s.inputs || [])) {
      if (!e || typeof e.name !== 'string') continue
      if (e.declared && !e.windowBound) { if (!live.includes(e.name)) live.push(e.name); continue }
      const v = Number(e.folded)
      if (!folded.some((f) => f.name === e.name)) folded.push({ name: e.name, value: Number.isFinite(v) ? v : null })
    }
    return {
      line: s.line,
      guards: (s.guards || []).map((g) => ({
        ast: g.ast, negate: g.negate === true, series: g.series || [], barCalls: g.barCalls === true,
      })),
      message: Array.isArray(s.message)
        ? s.message.map((p) => (typeof p.s === 'string' ? { s: p.s } : { n: p.n }))
        : null,
      live,
      folded,
      period: s.period || null,
    }
  })
  return { stops, unread: (re.unread || []).map((u) => ({ line: u.line ?? null, why: String(u.why || '') })) }
}

/** ⭐ C43 — the spec rows for the settings a `runtime.error` condition reads LIVE
 *  and the document does not already declare: the guard-only ones the member door
 *  added (`t.guardInputs`), and any an output annotates but no drawn row carries
 *  (the `withObjectInputs` case). ⛔ A spec is never invented: a live name with no
 *  spec stays undeclared, and the bind then names that call as not evaluable. */
function guardInputSpecs(t, stamp, existing) {
  if (!stamp) return []
  const wanted = new Set(stamp.stops.flatMap((s) => s.live))
  if (!wanted.size) return []
  const have = new Set((existing || []).map((s) => s && s.key))
  const out = []
  const take = (spec) => {
    if (!spec || typeof spec.key !== 'string' || !wanted.has(spec.key) || have.has(spec.key)) return
    have.add(spec.key)
    out.push(spec)
  }
  for (const spec of (t.guardInputs || [])) take(spec)
  for (const o of (t.outputs || [])) for (const spec of (o.memberInputs || [])) take(spec)
  return out
}

/** ⭐⭐ A ROW'S COLOUR CARRIES ITS OWN ALPHA (`#RRGGBBAA`), never a separate
 *  `opacity` beside it. The colour becomes the row's Style colour input's DEFAULT
 *  (`chromeInputsFor`), so a member's pick REPLACES colour and alpha together, the
 *  way TradingView's style colour does. ⚰️ With `opacity` beside it the renderer
 *  MULTIPLIED the pick by the script default's transparency: Uncharted Clouds' fast
 *  MA (`color.new(white, 100)`) drew a member's opaque yellow at alpha 0 (set E5).
 *  ⭐ A document saved in the old shape still renders TradingView's default and
 *  honours a pick: `pool.resolvePlotForInstance`. The alpha byte is TradingView's
 *  (`designTokens.withAlphaByte`). An opaque colour keeps its six digits. */
function rowColour(p) {
  // ⛔ No colour of its own (a palette / condition / gradient row): its opacity is
  // the palette's shared alpha and stays where it was.
  if (typeof p.color !== 'string') return { color: undefined, ...(p.opacity !== undefined ? { opacity: p.opacity } : {}) }
  if (Number.isFinite(p.opacity) && p.opacity < 1) {
    const c = withAlphaByte(p.color, p.opacity)
    if (c) return { color: c }
  }
  return { color: p.color, ...(p.opacity !== undefined ? { opacity: p.opacity } : {}) }
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
