// app/src/components/chart/engine/defSchema.js
//
// ─── The indicator DEFINITION schema, and the validator that guards it ───────
//
// This is the contract every later piece of the indicator platform reads
// through: the registry stores definitions, the binder turns them into series,
// the Style tab renders `inputs[]`, the alert engine pins against
// `defId@version`, and (Phase D) a no-code builder EMITS this shape while an AI
// concierge is asked to author it. Getting the vocabulary right here is cheaper
// than getting it right in five places later.
//
// Spec: docs/superpowers/specs/2026-07-31-indicator-platform-design.md §3, §3.1.
//
// THE ONE RULE THAT SHAPES EVERYTHING — ASYMMETRIC UNKNOWN-FIELD POLICY
// ---------------------------------------------------------------------
// Definitions travel between clients of different ages. Two different unknowns
// need two different answers, and conflating them is how platforms rot:
//
//   * DOCUMENT fields (meta.*, labels, tooltips, descriptions) are
//     IGNORE-AND-PRESERVE. An unknown `meta.futureThing` survives validation
//     byte-untouched so a newer definition round-trips through an older client
//     without being quietly amputated. Forward compatibility is a property of
//     the DOCUMENT half only.
//
//   * BEHAVIOURAL fields FAIL CLOSED. An unknown `inputs[].type` or
//     `plots[].style` makes the definition INVALID AT REGISTRATION — never a
//     coercion to the nearest known value. The spec's reasoning is worth
//     repeating because it is not obvious: an input default that gets coerced
//     (an unrecognised `type` falling back to `float`, say) silently changes the
//     numbers the indicator computes, and those numbers feed alerts, the
//     screener, and the signal ledger. A chart that refuses to draw is a bug
//     report; a chart that draws the wrong thing is a wrong trade.
//
// So: unknown KEYS are preserved everywhere. Unknown VALUES of an ENUMERATED
// vocabulary are rejected. That is the line, and it is drawn at the value, not
// at the key.
//
// WHAT THIS VALIDATOR DELIBERATELY DOES NOT DO
// --------------------------------------------
// It does not resolve `token:` colour references. `designTokens.resolveToken()`
// needs a chart PRESET, which is a render-time fact, not a registration-time
// one — the same definition renders on four presets. So `'token:info'` is
// simply a legal colour string here; the binder resolves it per-theme at render
// time and decides what a miss means. Equally, it never touches the network,
// never reads settings, and never throws: it is a pure function of its argument.
//
// RELATIONSHIP TO `../indicatorRegistry.js`
// -----------------------------------------
// That file is a half-built version of this same idea — field descriptors with
// `type` / `min` / `max` / `options` / `showIf` / `disabled` driving the
// Indicators tab. It is NOT superseded here and must not be edited: it is what
// ships today. But the `inputs[]` vocabulary below is a strict SUPERSET of its
// field vocabulary so B4 can eventually drive ONE renderer from definitions
// rather than maintaining two parallel field systems:
//
//   registry `select`  → `enum`   (+ `options`)
//   registry `number`  → `int` | `float`   (+ `min` / `max` / `step`)
//   registry `color`   → `color`
//   registry `toggle`  → `bool`
//   registry `showIf`  → `activeWhen`  (a JS predicate cannot survive JSON, so
//                                       the definition form is declarative data)
//   registry `disabled: '<reason>'`    → carried through verbatim
//
// NAME COLLISION, ON PURPOSE: this module also exports `PLOT_STYLES`, but as a
// flat array of style NAMES, whereas `indicatorRegistry.PLOT_STYLES` is
// `[[value, label]]` pairs for a `<select>`. Different modules, different
// shapes, no import between them — import the one whose module you mean.

// ⭐ THE ONE IMPORT THIS MODULE HAS, ADDED AT PHASE D TASK 8, AND IT DOES NOT
// COST THE PURITY CLAIM ABOVE. `parseFormula` and `astHash` are pure functions
// of a string and a tree — no clock, no network, no settings — and `parseFormula`
// is the door that never throws. What they buy is the `ast` lane's storage rail:
// checking that a stored `compute.source` still parses to the stored
// `compute.ast` is not expressible without a parser, and D-A1 rules that there is
// exactly ONE. A second comparison written here by hand would be a second
// grammar, which is the thing that ruling exists to prevent.
import { astHash, KEY_RE } from './ast/parse'
// ⭐ THE THIRD IMPORT, ADDED WITH THE TC2000 READER, AND IT REPLACES A DIRECT
// `parseFormula` CALL RATHER THAN ADDING A SECOND ONE.
//
// ⭐⭐ THE RAIL BELOW IS "THE SOURCE THE USER EDITS PRODUCES THE TREE THAT
// RUNS", AND THAT SENTENCE DID NOT CHANGE WHEN A SECOND SURFACE DIALECT
// LANDED — ONLY THE READER IT IS ASKED THROUGH DID. A member who types
// `(C > AVGC50)` must get their OWN text back in the box; storing the native
// spelling instead would satisfy `parseFormula` and violate the half of the
// contract that matters ("the source is what the user edits"). So the check is
// asked in the source's own language: `readFormulaSource` derives the dialect
// from the source and hands back the reader's own tagged result.
//
// ⛔ IT IS THE SAME FUNCTION THE TEXT BOX USES, imported rather than repeated.
// A private dialect decision here would let a formula save through one rule and
// fail to validate under another — a second authority over one value, which is
// this repo's most repeated defect.
//
// ⚠️ AND THE CONTRACT IS NOT WEAKENED: the comparison is still `astHash`
// equality against the STORED tree, so a misread dialect fails loudly here
// rather than storing a pair that disagree.
import { readFormulaSource } from './ast/pcf'
// ⭐ THE SECOND IMPORT, ADDED WITH `plots[].forward`, AND IT COSTS THE PURITY
// CLAIM ABOVE NOTHING FOR THE SAME REASON THE FIRST ONE DOES NOT: `UNBOUNDED` is
// a frozen string constant, and `./ast/parse` — which this module already pulls
// in — is `./ast/lint`'s only import, so the dependency graph does not grow by
// one module's worth of anything. It is imported rather than retyped because a
// vocabulary written down twice is the `williams_r`/`williamsR` shape: the day
// the linter learns a fourth window form, a hand-copied literal here would keep
// refusing it while the linter accepted it, and the two would disagree about
// what a definition means.
import { UNBOUNDED as FORWARD_UNBOUNDED, declaredInputs } from './ast/lint'
// ⭐ THE FOURTH IMPORT, ADDED WITH THE MULTI-TREE DOCUMENT (spec §5.1), AND IT
// COSTS THE PURITY CLAIM NOTHING EITHER: `assertTrees` and `treesHash` are pure
// functions of a map of trees. Imported rather than re-derived because
// `treesHash` is an IDENTITY the Python lane must reproduce byte for byte
// (W1b.8's `user_definitions.trees_hash`, to be held to W1b.7's pinned fixture
// string); a second spelling of it here would be a second hash over one
// document — the defect this repo names most.
//
// ⚠️ AND THE DEPENDENCY-GRAPH ACCOUNTING THE IMPORT ABOVE DOES, DONE HONESTLY:
// this one DOES grow the graph, by one module. `trees.js` imports `./parse` and
// `./lint` (both already here) and `./freshness`, which is NEW — and
// `freshness.js`'s own only import is `./parse`. So the cost is one leaf that
// reads the same manifest this module's other imports read: no evaluator, no
// clock, no second grammar. It is here because the alternative is worse — the
// hash and the badge aggregators would be re-spelled per consumer.
import { treesHash as treesHashOf, assertTrees } from './ast/trees'
// ⭐⭐ C3B — the object program is validated by ITS OWN module, never by a
// second copy of the rules here. `assertObjectProgram` is the one authority on
// what a legal program is; this file only adds the DOCUMENT-level rules the
// program module cannot know (is it bound, and does every node it names exist).
import { assertObjectProgram, graphNodesReferenced, treeRefsReferenced } from './ast/objectProgram'
// ⭐ THE READOUT VOCABULARY IS OWNED BY ITS READER (`readoutSchema.js`), the
// same way LEGEND_FIELDS is owned here and read by `readout.js`: one list, two
// modules, and a format the resolver cannot print cannot be declared.
import {
  READOUT_FORMATS, READOUT_ENTRY_FIELDS, READOUT_CARD_FIELDS, READOUT_SOURCE_PREFIXES,
  READOUT_CONDITION_OPS, parseReadoutSource, parseReadoutGate,
  READOUT_ACTION_KINDS, READOUT_ACTION_FIELDS, READOUT_ACTION_INPUT_TYPE,
} from './readoutSchema'
// ⭐ THE PRESET FIELDS' VOCABULARIES ARE OWNED BY THEIR WRITERS (Phase 2a, unit
// 2a-15). `applyPresetFields` (`instanceControls.js`) hands a preset's `dotSize`
// to `setInstanceDotSize` (the words of `DOT_SIZES`), its `visibility` to
// `setInstanceVisibility` (the policies `normalizeVisibility` keeps, over the
// chart's own timeframe codes) and its `displayTarget` to the placement writer.
// The schema reads those three modules rather than typing their lists again, so
// a word the writer would drop with a `console.warn` cannot be declared. None of
// the three imports anything of this module (`presentation.js` imports nothing,
// `instanceTimeframe.js` only `../timeframes`), so there is no cycle to mind.
import { DOT_SIZES } from './presentation'
import { VISIBILITY_PRESETS } from './instanceTimeframe'
import { isValidTf } from '../timeframes'
// ⭐ The pane table (UCT RS design round, 2026-11-08): its grammar and its
// validator live beside its reader, `paneTable.js`, which imports nothing of
// this module — so there is no cycle.
import { validatePaneTable } from './paneTable'
import { isOptionsSource, OPTIONS_SOURCES, optionLabelFor, humanizeOptionValue } from './optionsSources'
// ⭐ The line-end label (`plots[].endLabel`, UCT RS split U2): grammar beside its
// reader, `endLabel.js`, which imports nothing of this module.
import { validateEndLabel } from './endLabel'
// ⭐ The client-derived column (`plots[].derive`, same round): grammar beside its
// one reader, `derivedColumns.js`, which imports nothing of this module.
import { DERIVE_FIELDS } from './derivedColumns'
// ⭐ The live forming-bar tail (`plots[].liveTail`, RS split U2b): its grammar is
// a leaf of its own, `liveTailSchema.js`, NOT the reader `liveTail.js` — the
// reader is also the benchmark tail store (the door's request, wall clocks), and
// this module is in the runtime lane's compute closure, which may hold neither
// (`tools/pine_runtime_closure.mjs`; fix lane F2, 2026-11-10).
import { LIVE_TAIL_KINDS, LIVE_TAIL_FIELDS, LIVE_TAIL_MA_TYPES } from './liveTailSchema'
// ⭐ The rating scale (`def.rescale`, 2026-11-12): its grammar is the leaf
// `rescaleSchema.js`, never the reader `rescale.js`, for the closure reason above.
import { RESCALE_FIELDS, RESCALE_TIMEFRAMES } from './rescaleSchema'

/** Schema major. A definition MUST declare exactly this to register. */
export const SCHEMA_VERSION = 1

// ─── The locked vocabularies ─────────────────────────────────────────────────
// Exported (and frozen) so the registry, binder, Style tab, and builder all read
// ONE list. A second hand-written copy of any of these is the bug.

/** Input types buildable in v1 (spec §3.1). */
export const INPUT_TYPES = Object.freeze([
  'int', 'float', 'bool', 'enum', 'string', 'color', 'source',
])

/** Schema-reserved input types — named by the spec, deliberately NOT buildable
 *  in v1. Rejected with a distinct message so an author (or an AI generating a
 *  definition) can tell "you typo'd" from "that ships later". */
export const RESERVED_INPUT_TYPES = Object.freeze([
  'timeframe', 'price', 'time', 'session', 'symbol', 'confirm',
])

/** ⭐⭐ PHASE 3 WS-D — the reserved types a RUNTIME document (`compute.kind === 'runtime'`,
 *  a pasted Pine script run bar by bar) may declare: Pine's `input.time` (UNIX milliseconds)
 *  and `input.session` (a session string). ⛔ ONLY there: the run is the one reader that
 *  hands either value to a script (`pineRuntimeFrontend.js`); on any other document nothing
 *  would read the setting, so they stay RESERVED for it, with the reserved sentence. */
export const RUNTIME_INPUT_TYPES = Object.freeze(['time', 'session'])

/** ⭐ PHASE 3 WS-D — a session string as TradingView writes one: `HHMM-HHMM`, ranges joined
 *  by `,`, an optional `:days` suffix (1 = Sunday … 7 = Saturday, each at most once), or
 *  `24x7`. Hours 00..24 (24 only as `2400`), minutes 00..59. The ONE reader: the run
 *  (`runtimeInputs.js` re-exports it) and the server (`user_definitions.py::_SESSION_RE`,
 *  railed against the same cases) agree with this. */
export function isSessionString(s) {
  if (typeof s !== 'string') return false
  if (s === '24x7') return true
  // `[0-9]`, spelled out: JS `\d` is ASCII-only, Python's is not; the server's twin uses
  // `[0-9]` + `re.ASCII` and the shared fixture's non-ASCII rows pin both.
  const m = /^([0-9]{4}-[0-9]{4}(?:,[0-9]{4}-[0-9]{4})*)(?::([1-7]{1,7}))?$/.exec(s)
  if (!m) return false
  if (m[2] && new Set(m[2]).size !== m[2].length) return false
  return m[1].split(',').every((r) => r.split('-').every((hm) => {
    const h = Number(hm.slice(0, 2))
    const mi = Number(hm.slice(2))
    return h <= 24 && mi <= 59 && !(h === 24 && mi !== 0)
  }))
}

/** ⭐ PHASE 3 WS-D — the widest instant JavaScript's Date holds (±8.64e15 ms); a time input's
 *  value is whole milliseconds inside it. */
export const TIME_INPUT_MAX_ABS_MS = 8.64e15

/** Plot styles buildable in v1 (spec §3.1).
 *
 *  `band` gets a rule the others don't need, added in B2 Task 2 when Bollinger
 *  and Donchian became definitions: a band is the only style whose meaning
 *  depends on OTHER columns, so it must say which ones. See `plots[].edges`
 *  and `validateBandEdges` below. */
export const PLOT_STYLES = Object.freeze([
  'line', 'stepline', 'histogram', 'area', 'baseline', 'hlines', 'markers', 'band',
  // W4-T13 - a candle / an OHLC bar drawn from FOUR computed columns of the document
  // (`plotcandle` / `plotbar` from the run). Only with `plots[].ohlc` (`validateOhlc`).
  'candles', 'ohlcBars',
])

/** W4-T13 - the two styles whose data is four columns, and the parts whose colour a document
 *  may name (`plots[].ohlcColors`): a candle has three, a bar one. ONE list per fact. */
export const OHLC_DEF_STYLES = Object.freeze(['candles', 'ohlcBars'])
export const OHLC_COLOUR_PARTS = Object.freeze({
  candles: Object.freeze(['body', 'wick', 'border']),
  ohlcBars: Object.freeze(['body']),
})

/** Schema-reserved plot styles — renderer lands later. Same distinct-message
 *  treatment as RESERVED_INPUT_TYPES.
 *
 *  `cross` — LWC 5.2 draws circle/square/arrowUp/arrowDown markers only, and
 *  its point markers are circles; a cross marker needs W6's series primitives.
 *  Until then it is refused with the later-phase sentence, never coerced to
 *  `markers` (which is what "circles" already is). */
/** ⭐⭐ C3A — THE EVENT-MARKER VOCABULARY, CLOSED ON PURPOSE.
 *
 *  A marker is the declarative half of Pine's `plotshape`/`plotchar`: a glyph on
 *  a bar, positioned relative to that bar, optionally carrying a short label. It
 *  is NOT the mutable object model (`label.new` and friends) — there is no id to
 *  update, nothing to delete, and no lifetime beyond the column it reads.
 *
 *  ⛔ THE THREE VOCABULARIES ARE CLOSED BECAUSE THE RENDERER'S ARE. LWC 5.2
 *  draws these four shapes at these three positions; a document naming a fifth
 *  would register happily and draw nothing, which is the "validated but inert"
 *  failure this schema exists to prevent (`colorMode: 'column:<key>'` shipped
 *  that way for a whole wave). */
export const MARKER_SHAPES = Object.freeze(['circle', 'square', 'arrowUp', 'arrowDown'])
export const MARKER_POSITIONS = Object.freeze(['aboveBar', 'belowBar', 'inBar'])
/** Bounds, not a list — the translator maps five named Pine sizes into it and a
 *  hand-authored document may pick anything sane between them. */
export const MARKER_SIZE_RANGE = Object.freeze({ min: 0.25, max: 4 })

/** ⭐ A PLOT WIDTH'S SANITY CEILING, in px. TradingView paints a Pine `linewidth`
 *  unclamped (set F: 1..10 is N px), so the door carries the script's own width —
 *  but `linewidth = 10000` would smear the pane for everyone who installs a shared
 *  script. 50 is far above any measured use; 1..10 stays exact. ONE value, held to
 *  the server's (`api/services/presentation_schema.LINE_WIDTH_HARD_MAX`) by
 *  `tests/fixtures/line_width_cap.json`, which both suites read. */
export const LINE_WIDTH_HARD_MAX = 50

/**
 * `plots[i].marker` — the glyph an event column draws.
 *
 * ⛔ ONLY ON A `markers` PLOT. A marker on a line plot would be two renderers
 * over one column, and the one that ran would depend on read order.
 */
function validateMarker(plot, path, errors) {
  const m = plot.marker
  if (m === undefined) return
  if (!isPlainObject(m)) {
    errors.push(`${path}.marker: expected an object, got ${fmt(m)}`)
    return
  }
  if (plot.style !== 'markers') {
    errors.push(
      `${path}.marker: only a plot with style "markers" draws one — this plot is ` +
      `${fmt(plot.style)}. A marker on a line plot would be two renderers over one column.`,
    )
  }
  if (!MARKER_SHAPES.includes(m.shape)) {
    errors.push(
      `${path}.marker.shape: expected one of ${MARKER_SHAPES.join(', ')} — got ${fmt(m.shape)}. ` +
      `The list is closed because the renderer's is: a fifth name would register and draw nothing.`,
    )
  }
  if (m.position !== undefined && !MARKER_POSITIONS.includes(m.position)) {
    errors.push(
      `${path}.marker.position: expected one of ${MARKER_POSITIONS.join(', ')} — got ${fmt(m.position)}`,
    )
  }
  if (m.size !== undefined
      && (typeof m.size !== 'number' || !Number.isFinite(m.size)
          || m.size < MARKER_SIZE_RANGE.min || m.size > MARKER_SIZE_RANGE.max)) {
    errors.push(
      `${path}.marker.size: expected a number between ${MARKER_SIZE_RANGE.min} and ` +
      `${MARKER_SIZE_RANGE.max}, got ${fmt(m.size)}`,
    )
  }
  if (m.text !== undefined && typeof m.text !== 'string') {
    errors.push(`${path}.marker.text: expected a string, got ${fmt(m.text)}`)
  }
  if (typeof m.text === 'string' && m.text.length > 24) {
    errors.push(`${path}.marker.text: at most 24 characters, got ${m.text.length}`)
  }
}

export const RESERVED_PLOT_STYLES = Object.freeze(['zones', 'bgband', 'barcolor', 'fill', 'cross'])

/** Compute lanes (spec §3). Every kind here PARSES — a definition naming one is
 *  well-formed and may be listed, merchandised and round-tripped by a client
 *  that cannot run it.
 *
 *  ⭐ AND `SUPPORTED_KINDS` BELOW IS NOW THE FILTER THIS COMMENT USED TO PROMISE.
 *  From B1 until Phase D Task 8 it read *"the registry's `supportedKinds` filter
 *  decides what a given client will actually run"* — and that filter had **no
 *  identifier anywhere in `app/src` or `api/`**. It was prose describing a
 *  mechanism nobody wrote, sitting in the file whose job is to fail closed.
 *  Measured 2026-08-06 (Task 3: repo-wide, zero identifiers, this comment plus
 *  spec §3.1); made real 2026-08-07 by the constant below and its one consumer,
 *  `nativeRegistry.validateUserDefinitions`. */
export const COMPUTE_KINDS = Object.freeze(['native', 'server', 'ast', 'script', 'runtime'])

/**
 * The lanes THIS CLIENT CAN EXECUTE — the `supportedKinds` filter, as an
 * identifier rather than a sentence.
 *
 * ⛔ THIS IS A STRICT SUBSET OF `COMPUTE_KINDS`, AND THE TWO SAY DIFFERENT
 * THINGS. "Declared" and "supported" are separate claims and conflating them
 * breaks in both directions:
 *
 *   * collapse them INTO one list and `script` — reserved AI plumbing, spec §3 —
 *     becomes a lane a client will try to run;
 *   * treat "unsupported" as "invalid" and an older bundle stops LISTING the
 *     whole server lane, which spec §3.1 (catalog fetch filters by client
 *     `supportedKinds`) and §5 (premium entries stay listed while locked)
 *     both forbid. A definition this client cannot run is still a definition it
 *     must be able to describe.
 *
 * So `validateDefinition` accepts every member of `COMPUTE_KINDS` — a `script`
 * definition is WELL-FORMED — and `validateUserDefinitions` is where a kind
 * outside this list is refused, by name, with a message that says "cannot run"
 * rather than "malformed".
 */
export const SUPPORTED_KINDS = Object.freeze(['native', 'server', 'ast'])

/** The `ast` lane's multi-tree keys (spec §5.1, the lane contract's "definition
 *  document v2"). Present TOGETHER on a multi-tree document and ABSENT together
 *  on a single-tree one — `validateTrees` holds the rules; this is the one list
 *  they and the other-lane refusal are read from. */
const V2_COMPUTE_KEYS = Object.freeze(['trees', 'treesHash', 'scanPlot', 'sources'])

/** Where the indicator draws. `volume` = the shipped left-axis overlay. */
export const PLACEMENT_TARGETS = Object.freeze(['price', 'pane', 'volume'])

/**
 * `placement.axis` — whether the pane's price scale shows (Phase 2a visual round,
 * item A4; owner decision D6). `'visible'` is the default and what an absent field
 * means; `'hidden'` asks the binder for an invisible right scale on that pane (no
 * tick labels, no last-value tag), so the value is read in the pane label. The
 * binder half (`placement.js` / `binder.js`) owns what "invisible" draws; this is
 * the declaration and its vocabulary. Behavioural, so an unknown value fails closed.
 */
export const PLACEMENT_AXIS_MODES = Object.freeze(['visible', 'hidden'])

/** Repaint honesty label (spec §3). Phase A/B: audited metadata. */
export const REPAINT_MODES = Object.freeze(['non-repainting', 'preview-repaints', 'repaints'])

/**
 * ⭐ THE SECOND HONESTY LABEL, AND IT EXISTS BECAUSE THE FIRST ONE RETURNS A
 * TRUE ZERO. `ast/lint.js::astReach` answers `forward: 0` for a table-declared
 * scalar — correctly: `market_cap` at bar `i` depends on no bar `j > i` — so the
 * repaint badge brands a formula whose value is up to a day old
 * `non-repainting` and no gate fires at all. The zero is a true answer to a
 * question nobody asked, which is why there is a second vocabulary here rather
 * than a fourth value in the one above: staleness and repainting are different
 * facts and a single field could only express one of them.
 *
 *   live           — every value the formula reads comes from the bar it draws on
 *   as-of-snapshot — at least one value is per-symbol and dated to a build
 *   unknown        — the reader could not resolve a leaf. FAIL-CLOSED: the
 *                    STALEST claim, mirroring `repaints`
 *
 * ⛔ NO CADENCE IN THE VALUE. `snapshot:nightly` would bake an open owner
 * question (is nightly the right cadence?) into a persisted, user-visible field.
 */
export const FRESHNESS_MODES = Object.freeze(['live', 'as-of-snapshot', 'unknown'])

/** Per-plot role — drives legend order, default widths, visual-budget linter. */
export const PLOT_ROLES = Object.freeze(['primary', 'secondary', 'context', 'signal'])

/**
 * `plots[].legend` — what this plot contributes to the crosshair readout.
 *
 * ⭐ AS OF B4 TASK 10 THIS IS THE ONLY PLACE A CHIP IS DECLARED, and this
 * paragraph is the corrected version of one that said the opposite.
 *
 * It used to read: "the chart's legend chips are hand-written today
 * (`StockChart.jsx:9588-9599`), which is why a migrated indicator vanishes from
 * the readout: the chip is keyed to a legacy series REF." That was true for the
 * whole of B3 and is now false in both halves — the hand-written `legChips`
 * array is DELETED and there is no series ref left to key to. The legend renders
 * `crosshairData.chips`, built by `readout.chipsFrom` from `plots[].legend` +
 * `meta.legendParams` + the lane's own inputs, for engine-drawn and hand-drawn
 * series alike. That is the "ONE formatting pipeline drives Style-tab precision,
 * chip values and crosshair readout" the UX contract (§6) asks for.
 *
 * ⚠️ Which makes a missing or wrong declaration here a chip that DISAPPEARS,
 * with no second copy to fall back on — see `readout.js`'s header for why the
 * obvious version of that rewrite would have deleted six chips for every user.
 *
 *   label    — the chip's leading text. Absent ⇒ `meta.shortName` plus, when
 *              `meta.legendParams` is non-empty, `(p1, p2, …)` resolved against
 *              the INSTANCE's inputs. There is deliberately no `$` substitution
 *              here: a chip label is a SENTENCE, and `$refs` resolves whole
 *              values only, so "RSI($period)" would need a second, interpolating
 *              grammar — a second thing to get wrong. `legendParams` is the
 *              answer to the same need and already ships.
 *              (This used to read "`SUBSTITUTABLE_PLOT_FIELDS` stays
 *              color/width/levels". It did not — `lineStyle` joined in B3 Task 8
 *              — and the reason it can is that it is a whole-value enum, which is
 *              precisely what a label is not.)
 *   decimals — how many the chip shows. NOT `precision`, which is the price
 *              scale's. Legacy prints RSI at 1 and MACD at 4 while both series
 *              carry LWC's default precision of 2, so they are genuinely two
 *              numbers.
 *   hide     — this plot contributes no chip. BB, VWAP and MACD's histogram all
 *              draw without one today; a migration that ADDS a chip is as much a
 *              regression as one that drops it.
 */
/** ⭐ `compact` JOINED THEM 2026-09-16. It says "this output is a MAGNITUDE" —
 *  print it the way an axis does (`4.61B`) rather than with `decimals`. The
 *  definition is the only thing that can know that: 4,609,414,802 and 4609.41 are
 *  the same shape to a formatter. `readout.chipValueText` is the one reader.
 *  ⭐ `showValue` JOINED THEM 2026-11-10 (UCT RS split, F3). `false` says "this
 *  plot's chip NAMES the line and prints no number": the chip, its pane suffix
 *  (` · SPY · 82`), its line-end tag and its readout rows all stay; only the
 *  value is withheld, on every surface that reads `chipValueText`. The slim RS
 *  line is the case: its ratio (`0.4378`) means nothing to a member, while the
 *  rating beside it does. Unlike `hide`, the chip is still emitted. */
export const LEGEND_FIELDS = Object.freeze(['label', 'decimals', 'hide', 'compact', 'showValue'])

/**
 * Line styles an AUTHOR may declare on a plot.
 *
 * ⚠️ NOT the same list as `indicatorRegistry.LINE_STYLES`, and it stopped being
 * so deliberately. That one is the USER-FACING picker (solid / dashed / dotted)
 * for the styles a user can choose; this one has to be able to name every style
 * the SHIPPED code actually draws, because a definition that cannot say what the
 * legacy block does is a definition that renders something else.
 *
 * `largeDashed` (LWC `LineStyle.LargeDashed` = 3) is the case that forced the
 * split. Three shipped guides use it — RSI's 50, MACD's 0, CCI's 0 — and the
 * three-name vocabulary could not express it, so those plots declared nothing.
 * "Declare nothing" is safe for a SERIES option (LWC keeps the current value)
 * and is NOT safe for a `createPriceLine` option: an omitted `lineStyle` there
 * takes LWC's own default, which is `Dashed`. The Task 8 rehearsal measured the
 * result — **379 changed pixels** on one guide line, a 6-on/6-off dash rendered
 * as 2-on/2-off. No user picker gains an entry: these three guides are authored,
 * not user-styled.
 */
export const PLOT_LINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted', 'largeDashed'])

/**
 * Non-parametric colour modes. `column:<key>` is the parametric third form.
 *
 * ⚠️ `column:<key>` IS VALIDATED-BUT-INERT IN v1, ON PURPOSE. Read that as a
 * decision, not as the family of defects the B2 review closed:
 *
 *   * `area`/`baseline` given a `color` option they do not have (I-2) — a WRONG
 *     option reaching the renderer. Fixed.
 *   * `opacity` validated and read by nothing (I-4) — an author's declaration
 *     dropped on the floor. Wired.
 *   * `plots[].precision` validated for every plot, read only for histograms
 *     (N-4) — same shape. Wired.
 *
 * `column:<key>` was validated-but-inert through v1 — reference-checked, drawn by
 * nobody, and this note used to say so. ⭐⭐ **C1 GAVE IT A RENDERER.**
 * `pool.columnColorsForPlot` resolves it and `binder.toPoints` colours each point
 * by whether the named column is non-zero on that bar, exactly as this comment
 * predicted ("the two places that must learn it").
 *
 * It is how a Pine `color = cond ? colour_a : colour_b` survives import, and that
 * is not a niche shape: measured over the frozen 60-script out-of-sample corpus,
 * **49 colour a plot from an expression rather than a literal**. `sign` cannot
 * express any of them, because the deciding quantity is a different series from
 * the one being drawn.
 *
 * ⛔ IT REQUIRES `colorUp`/`colorDown`, same as `sign` and for the same reason: a
 * per-point mode with nothing to alternate between draws one flat colour while
 * registering happily.
 */
export const COLOR_MODES = Object.freeze(['fixed', 'sign'])

/**
 * The ONLY three values an event column may hold (spec §3.1: "Events are
 * columns. `events[].key` MUST match a returned column valued {0, 1, NaN}").
 *
 * ⚠️ `NaN` IS IN THE DOMAIN AND IT IS NOT "NO EVENT". It is the warmup pad —
 * bars before the event is computable at all, exactly as every plot column is
 * NaN-padded to `bars.length`. `0` means "computed, did not happen". Collapsing
 * them would make a 200-bar indicator's first 199 bars read as 199 non-events.
 *
 * ⛔ WHY THIS IS A DOMAIN AND NOT A NULL TEST. `0.5` is not a "maybe". Every
 * consumer of an event column — the alert grammar, the screener, the D-phase AST
 * — reads exactly this one shape, so a float column wearing an event's name
 * would be read as a signal by all of them. A check that accepted "any finite
 * number" would pass 0.5; a check that accepted "NaN only" would pass an
 * all-NaN column that fires nothing. Neither is the claim.
 *
 * ⚠️ THIS ARRAY CANNOT BE USED WITH `.includes()`. `[0, 1, NaN].includes(NaN)`
 * is `true` (SameValueZero) but `indexOf` is not, and the surrounding
 * `checkVocabulary` uses `includes` on strings. Use `isEventColumnValue`, which
 * says what it means and cannot be got subtly wrong at a call site.
 */
export const EVENT_COLUMN_DOMAIN = Object.freeze([0, 1, NaN])

/** Is `v` a legal event-column value? The gate `EVENT_COLUMN_DOMAIN` describes. */
export function isEventColumnValue(v) {
  return v === 0 || v === 1 || Number.isNaN(v)
}

/** Entitlement tier. LOCKED in B2 Task 2 (carry-in c): it was validated only as
 *  "a string", so `tier: 'pro'` or a typo'd `'Free'` registered happily and then
 *  read as "not free" — or worse, as free — at whatever gate consumes it. A tier
 *  is a paywall claim, so it fails closed like every other behavioural value. */
export const TIERS = Object.freeze(['free', 'premium'])

/** Bar fields a `source` input may name directly. Anything else must be a
 *  `defId.plotKey` handle into the registry — see `validateSourceReferents`. */
export const SOURCE_BAR_FIELDS = Object.freeze([
  'open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'volume',
])

/**
 * The ONLY plot fields in which `$<inputKey>` substitution is legal (spec §3.1).
 *
 * ⚠️ `lineStyle` JOINED THE LIST IN B3 TASK 8, AND A MIGRATION IS WHY. Spec §3.1
 * listed color/width/levels because those were the three the first three pilots
 * needed. VWAP is the first migrated native with a user-facing STYLE picker
 * (`indicators.vwap.lineStyle` → solid/dashed/dotted, `StockChart.jsx:6004`), and
 * with the field un-substitutable its definition could only declare an author's
 * literal — so an engine-drawn VWAP rendered SOLID for every user who had ever
 * chosen dashed or dotted. Measured, not deduced: `engine_vwap_dashed_vs_legacy`
 * is the parity case, and on a build carrying the migration but NOT this change
 * (`9c7b7e62e647`) it reported **2,966 changed pixels (0.398656%) on 5/5 runs** —
 * while `engine_vwap_vs_legacy`, whose settings say `lineStyle: 'solid'`, reported
 * **0** on that same build. A whole class of user was one enum value away from a
 * silently different chart, and no case that existed could see it.
 *
 * That is the same sentence `PLOT_LINE_STYLES` above already carries, one level
 * up: a definition that cannot say what the chart draws is a definition that
 * renders something else. Extending the list is strictly narrower than the
 * alternatives — it invents no second grammar (`substitute` and `$refs` are
 * unchanged), and the resolved value is still checked against `PLOT_LINE_STYLES`,
 * so an input whose enum options wander outside the vocabulary fails at
 * registration exactly as a literal typo does.
 *
 * ⭐ `colorUp` / `colorDown` JOINED 2026-11-05 (UCT Relative Strength, Phase 1
 * unit 5). A `colorMode: 'column:<key>'` plot alternates between those two
 * colours per bar, and until now both had to be an author's literals — so a
 * member could recolour a one-colour line (`color: '$lineColor'`) but never a
 * two-colour one, and the RS line coloured by its position against its moving
 * average (the Phase preset: `bull` above, `bear` below) could not be a pair of
 * colour inputs. Same shape as `lineStyle`: whole-value, substituted first and
 * then validated as a colour, `$refs` recorded, `pool.resolvePlotForInstance`
 * re-applies the member's pick. `readout.resolvePlotColor` (the legend chip's
 * swatch) still reads `color` only — a chip is one swatch, and the plot keeps a
 * `color` for it.
 */
export const SUBSTITUTABLE_PLOT_FIELDS = Object.freeze(['color', 'width', 'levels', 'lineStyle', 'colorUp', 'colorDown'])

// ─── Grammar ─────────────────────────────────────────────────────────────────

/** `$<inputKey>` — the whole value is the reference, or it is not one. */
const REF_RE = /^\$([A-Za-z][A-Za-z0-9_]*)$/

// `KEY_RE` — input / plot / event / tree keys — is IMPORTED from `./ast/parse`,
// beside `LOOKBACK_RE`: one grammar, read by this module and by `ast/trees.js`.
// It was a private copy here until W1b.2, and the second private copy in
// `trees.js` was the second-authority-over-one-value defect this repo names
// most; `defSchema.test.js` now holds the two modules to the one export.

/** Definition id. Hyphens allowed (`uct-rsi`); dots are not — `defId.plotKey`
 *  addressing has to stay unambiguous. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** Sentinel returned by `substitute()` when a `$ref` did not resolve. Distinct
 *  from every legal value (including `undefined`) so a failed substitution can
 *  never be mistaken for a successful one that produced nothing — which is
 *  exactly the "silent default" the spec forbids. */
const REF_FAILED = Symbol('ref-failed')

// ─── Small pure helpers ──────────────────────────────────────────────────────

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Render a value for an error message. Every error names the offending field
 *  AND the offending value — a validator whose errors don't identify what to fix
 *  is a validator nobody debugs with, and these messages are read by a future AI
 *  generating definitions, so they are an interface, not decoration.
 *
 *  Exported (as `formatValue`) so `instances.js` writes its errors in the same
 *  voice — two error dialects inside one engine is a small thing that reads as
 *  sloppiness at exactly the moment someone is debugging. */
export function formatValue(v) {
  if (typeof v === 'string') return JSON.stringify(v)
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (typeof v === 'function') return 'a function'
  if (typeof v === 'symbol') return 'a symbol'
  if (Array.isArray(v)) return `an array [${v.map((x) => fmt(x)).join(', ')}]`
  const keys = Object.keys(v)
  return `an object {${keys.join(', ')}}`
}

/** Internal alias so the ~60 existing call sites read as they always did. */
const fmt = formatValue

function list(values) {
  return values.join(', ')
}

/** Structural clone of definition-shaped data.
 *
 *  Hand-rolled rather than `structuredClone` for one reason: structuredClone
 *  THROWS on a function, and a caller migrating off `indicatorRegistry` may well
 *  hand us a descriptor still carrying a `showIf` predicate. This validator's
 *  contract is "never throws" — so unclonable values pass through by reference
 *  instead, and the offending field is reported as an error like anything else. */
function deepClone(v) {
  if (Array.isArray(v)) return v.map(deepClone)
  if (isPlainObject(v)) {
    const out = {}
    for (const k of Object.keys(v)) out[k] = deepClone(v[k])
    return out
  }
  return v
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * Check a value against a locked vocabulary. THIS IS THE FAIL-CLOSED GATE.
 *
 * There is no fallback branch here and there must never be one: returning a
 * default for an unrecognised behavioural value is the silent coercion the spec
 * bans. A reserved value gets its own message so "not yet" reads differently
 * from "never".
 *
 * @returns {boolean} true when `value` is in `allowed`.
 */
function checkVocabulary(value, allowed, reserved, path, what, errors) {
  if (allowed.includes(value)) return true
  if (reserved.includes(value)) {
    errors.push(
      `${path}: ${what} ${fmt(value)} is SCHEMA-RESERVED for a later phase and cannot be ` +
      `registered in schemaVersion ${SCHEMA_VERSION} — buildable ${what}s are: ${list(allowed)}`,
    )
    return false
  }
  errors.push(
    `${path}: unknown ${what} ${fmt(value)} — expected one of: ${list(allowed)}. ` +
    `Unknown behavioural values are rejected at registration, never coerced.`,
  )
  return false
}

/**
 * Resolve a `$<inputKey>` reference against the declared inputs.
 *
 * Any string beginning with `$` in a substitutable field is TREATED as a
 * reference. A malformed one (`'$'`, `'$1x'`) is an error rather than a literal
 * passthrough — letting it through would ship `$` as a CSS colour, which is a
 * silent default wearing a disguise.
 *
 * ⚠️ `field` IS WHAT MAKES `SUBSTITUTABLE_PLOT_FIELDS` THE AUTHORITY RATHER THAN
 * A COMMENT. Until B3 Task 8 every call site simply called this function, so the
 * frozen array was read by nothing: a mutation deleting `lineStyle` from it left
 * the entire engine selection green while the constant, spec §3.1 and the
 * docstring all claimed otherwise. A vocabulary nothing enforces is a vocabulary
 * that drifts, and this one is the difference between a user's line style
 * reaching the renderer and being silently ignored. A `$ref` in a field the list
 * does not name is now an ERROR — not a passthrough, which would ship the literal
 * string `"$period"` into a plot option.
 *
 * @param {string} field the plot field being substituted, or `null` for a
 *        sub-value (a `levels[i]` element) whose PARENT field was already checked.
 * @returns the substituted value, the original value when it isn't a ref, or
 *          REF_FAILED (an error has already been pushed).
 */
function substitute(value, inputsByKey, path, errors, field) {
  if (typeof value !== 'string' || !value.startsWith('$')) return value

  if (field !== null && field !== undefined && !SUBSTITUTABLE_PLOT_FIELDS.includes(field)) {
    errors.push(
      `${path}: $ref ${fmt(value)} is not substitutable — ${fmt(field)} is not one of the ` +
      `fields the grammar resolves (${list([...SUBSTITUTABLE_PLOT_FIELDS])}). Write a literal, ` +
      `or add the field to SUBSTITUTABLE_PLOT_FIELDS and spec §3.1 together.`,
    )
    return REF_FAILED
  }

  const m = REF_RE.exec(value)
  if (!m) {
    errors.push(
      `${path}: malformed $ref ${fmt(value)} — the substitution grammar is ` +
      `$<inputKey> where inputKey matches ${KEY_RE}`,
    )
    return REF_FAILED
  }

  const key = m[1]
  const input = inputsByKey.get(key)
  if (!input) {
    const declared = [...inputsByKey.keys()]
    errors.push(
      `${path}: unresolvable $ref ${fmt(value)} — no input declares key ${fmt(key)} ` +
      `(declared input keys: ${declared.length ? list(declared) : 'none'}). ` +
      `An unresolvable $ref invalidates the definition; it is never silently defaulted.`,
    )
    return REF_FAILED
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'default')) {
    errors.push(
      `${path}: $ref ${fmt(value)} points at input ${fmt(key)}, which declares no "default" ` +
      `to substitute — give inputs[].default a value or stop referencing it.`,
    )
    return REF_FAILED
  }
  return deepClone(input.default)
}

/**
 * The input key a `$ref` names, or null when the value isn't one.
 *
 * WHY THE REFERENCE IS KEPT AFTER IT IS RESOLVED. `substitute` replaces
 * `color: '$color'` with the input's DEFAULT, which is right for a definition —
 * a definition has no user behind it. But an INSTANCE does: `{inputs: {color:
 * '#abcdef'}}` is the whole point of the field, and once the reference is gone
 * the binder has no way to know that this plot's colour is the one the user
 * edited rather than a literal the author wrote. It would render every migrated
 * indicator in its default colour and nobody would be able to say why.
 *
 * So the resolved plot carries `$refs`: `{ color: 'color', width: 'lineWidth',
 * levels: ['hi', null, 'lo'] }` — field → the input key it came from — and
 * `pool.resolvePlotForInstance` re-applies it per instance. `$`-prefixed because
 * KEY_RE forbids a leading `$`, so it can never collide with an author's field.
 */
function refKeyOf(value) {
  if (typeof value !== 'string' || !value.startsWith('$')) return null
  const m = REF_RE.exec(value)
  return m ? m[1] : null
}

function noteRef(plot, field, key) {
  if (!key) return
  if (!plot.$refs) plot.$refs = {}
  plot.$refs[field] = key
}

// ─── Section validators ──────────────────────────────────────────────────────

function validateCompute(compute, errors, inputScope) {
  if (!isPlainObject(compute)) {
    errors.push(`compute: required object, got ${fmt(compute)}`)
    return
  }
  // `kind` selects the EXECUTION LANE. An unrecognised lane silently falling
  // back to `native` would run a different implementation than the author
  // declared, so it is fail-closed alongside inputs[].type and plots[].style.
  //
  // ⚠️ CHECKED AGAINST `COMPUTE_KINDS`, NOT `SUPPORTED_KINDS`, AND THAT IS THE
  // WHOLE POINT OF THERE BEING TWO. A `script` definition is well-formed; it is
  // merely unrunnable here, which is `validateUserDefinitions`' sentence to say.
  checkVocabulary(compute.kind, COMPUTE_KINDS, [], 'compute.kind', 'compute kind', errors)

  if (!isNonEmptyString(compute.fn)) {
    errors.push(`compute.fn: required non-empty string (the compute function handle), got ${fmt(compute.fn)}`)
  }
  // `rev` is the MATH revision; a bump force-migrates every binding (spec §3.1).
  // It must be a real integer or that migration can never be ordered.
  if (!Number.isInteger(compute.rev) || compute.rev < 1) {
    errors.push(`compute.rev: required integer >= 1 (the math revision), got ${fmt(compute.rev)}`)
  }
  // `budget` — op/lookback/series caps for the `ast` lane.
  //
  // ⭐ THIS COMMENT USED TO READ *"reserved … the caps themselves have no
  // meaning yet"*, AND TASK 6 MADE THAT MEASURABLY FALSE while leaving this file
  // byte-identical on purpose (the correction is Task 8's, in the commit that
  // gives the field a registration-time consumer). The caps are read by
  // `ast/budget.js::effectiveBudget`, which resolves this object against
  // `DEFAULT_BUDGET` so a stored blob can only ever TIGHTEN — and they are
  // enforced twice: `checkBudget` at registration (the UX half, a message an
  // author sees while typing) and `assertBudget` inside `interpret` (the safety
  // half, which is the one a mutation must not be able to delete quietly).
  //
  // ⚠️ STILL ONLY A PRESENCE-SHAPE CHECK HERE, AND DELIBERATELY. Whether a cap
  // is a sane integer is `effectiveBudget`'s question and it answers by falling
  // back to the default rather than refusing — a malformed stored blob must not
  // make a chart un-drawable. This validator's job is that the field is an
  // object at all.
  if (compute.budget !== undefined && compute.budget !== null && !isPlainObject(compute.budget)) {
    errors.push(`compute.budget: reserved — expected null or an object, got ${fmt(compute.budget)}`)
  }

  if (compute.kind === 'ast') {
    validateAstCompute(compute, errors, inputScope)
  } else if (compute.kind === 'runtime') {
    validateRuntimeCompute(compute, errors)
  } else {
    // ⛔ THE MULTI-TREE KEYS BELONG TO THE `ast` LANE ALONE. On any other kind
    // they would be preserved by the unknown-key policy and read by nothing —
    // the accepted-and-ignored shape `plots[].repaint` was refused for.
    for (const k of V2_COMPUTE_KEYS) {
      if (compute[k] === undefined) continue
      errors.push(
        `compute.${k}: only an "ast" definition carries it — the tree is the implementation on that ` +
        `lane alone, and kind ${fmt(compute.kind)} names a compute handle, not a tree. Got ${fmt(compute[k])}.`,
      )
    }
  }
}

/**
 * ⭐⭐ THE `runtime` LANE'S SHAPE (2026-09-28) — a member's Pine, computed bar by
 * bar by the per-bar runtime lane (`engine/runtime/runtimeColumns.js`).
 *
 * It exists for the scripts the columnar lane cannot represent — two `var`s that
 * each read the other before setting their own — and which TradingView draws.
 * The document carries the member's SOURCE (the implementation, exactly as the
 * `ast` lane's tree is) and `outputs`, the map from each plot key to the runtime
 * program's output index.
 *
 * ⛔ WELL-FORMED IS NOT RUNNABLE. Like `script`, `runtime` is NOT in
 * `SUPPORTED_KINDS`: `nativeRegistry.validateUserDefinitions` admits it only while
 * `runtimePaneGate.runtimePaneEnabled()` is on. ⭐ RT1 (2026-10-02): the server's
 * save door has its own branch for it (`api/services/runtime_definitions.py`,
 * these same rules), switched off by default (`PINE_RUNTIME_SAVE_ENABLED`).
 */
function validateRuntimeCompute(compute, errors) {
  if (!isNonEmptyString(compute.source)) {
    errors.push(`compute.source: a "runtime" definition carries the script it runs — required non-empty string, got ${fmt(compute.source)}`)
  }
  // ⭐ RT5 — `objects: true`: the run draws this document's objects itself
  // (`runtime/runtimeObjects.js`), so a drawing-only script maps NO plot.
  if (compute.objects !== undefined && compute.objects !== true) {
    errors.push(`compute.objects: when present, true (the run draws the document's objects), got ${fmt(compute.objects)}`)
  }
  const ownObjects = compute.objects === true
  if (!isPlainObject(compute.outputs) || (!ownObjects && !Object.keys(compute.outputs).length)) {
    errors.push(`compute.outputs: a "runtime" definition maps each plot key to a runtime output index — required non-empty object, got ${fmt(compute.outputs)}`)
  } else {
    for (const [key, index] of Object.entries(compute.outputs)) {
      if (!Number.isInteger(index) || index < 0) {
        errors.push(`compute.outputs.${key}: required integer >= 0 (a runtime output index), got ${fmt(index)}`)
      }
    }
  }
  for (const k of V2_COMPUTE_KEYS) {
    if (compute[k] === undefined) continue
    errors.push(`compute.${k}: only an "ast" definition carries it — a "runtime" definition's implementation is its source. Got ${fmt(compute[k])}.`)
  }
}

/**
 * The `ast` lane's own three rules. ⭐ D-A1's RAIL, ARRIVING FROM THE STORAGE SIDE.
 *
 * D-A1 ruled ONE parser: `jsep` runs once, in the browser, at author time, and
 * `compute.ast` — the tree — is what is stored, versioned, wired and
 * interpreted. Python never parses. That ruling has a consequence nobody can opt
 * out of: **the tree is the implementation and the source is only a picture of
 * it**, so a stored pair that disagree is a definition whose read-back describes
 * maths nobody is computing. The concierge is designed against exactly that
 * failure from the authoring side; this is the same failure arriving from the
 * database, and the schema is the only place that can see it.
 *
 * 1. `compute.ast` must be a CANONICAL tree — four node types, exact key sets.
 *    Asked through `astHash`, which calls `assertCanonical` because the hash is
 *    taken of the PERSISTED artifact, not of something this process just built.
 *
 * 2. `compute.source` must PARSE BACK TO `compute.ast`. Compared by HASH rather
 *    than by deep-equality on purpose: the hash is the stable identity that
 *    already decides a `compute.rev` bump, so whitespace and key order cannot
 *    make two identical formulas disagree here while agreeing there.
 *
 * 3. ⭐ AN `ast` DEFINITION'S `compute.fn` IS ITS `astHash`, and that is not a
 *    formality. `fn` is the compute HANDLE; for a native it names a function in
 *    `NATIVE_COMPUTE`, for a server def it names an endpoint's definition id.
 *    For an AST there is no third thing to name — the tree IS the implementation
 *    — so naming it by its own hash makes "the handle changed" and "the maths
 *    changed" ONE event rather than two that can disagree. (`compute.fn` is
 *    required for EVERY kind — a non-empty-string check with no kind branch —
 *    so the alternative was not "no handle", it was "a handle that means
 *    nothing", which is the shape a rename rots into.)
 */
function validateAstCompute(compute, errors, inputScope) {
  if (!isNonEmptyString(compute.source)) {
    errors.push(
      `compute.source: an "ast" definition must carry the SOURCE the user edits alongside the ` +
      `tree that runs — got ${fmt(compute.source)}. Without it the formula can be computed and ` +
      `never read back, which is a definition no author can ever correct.`,
    )
  }
  // ⭐ `compute.ast`'s TWO OWN RULES REPORT WITHOUT RETURNING, so that the
  // multi-tree rules below are reached whatever shape the scan tree is in.
  // `storedHash === undefined` is the one signal that the tree is unusable —
  // the same condition `validateTrees`' alias branch already guards on.
  let storedHash
  if (compute.ast === undefined || compute.ast === null) {
    errors.push(
      `compute.ast: an "ast" definition must carry the canonical tree — got ${fmt(compute.ast)}. ` +
      `The tree is the implementation (D-A1: one parser, at author time); a definition without ` +
      `one names maths that does not exist.`,
    )
  } else {
    try {
      storedHash = astHash(compute.ast)
    } catch (err) {
      errors.push(
        `compute.ast: not a canonical tree (${err && err.message ? err.message : String(err)}) — ` +
        `the persisted shape is the contract with the Python lane and is deliberately smaller ` +
        `than jsep's.`,
      )
    }
  }

  // Silent with no hash to compare against: there is no expected value, so
  // there is no disagreement to report — one defect, one sentence.
  if (storedHash !== undefined && isNonEmptyString(compute.fn) && compute.fn !== storedHash) {
    errors.push(
      `compute.fn: an "ast" definition's compute handle IS its astHash — expected ` +
      `${fmt(storedHash)}, got ${fmt(compute.fn)}. The tree is the implementation, so there is no ` +
      `third thing for the handle to name; naming it by its own hash makes "the handle changed" ` +
      `and "the maths changed" one event rather than two that can disagree.`,
    )
  }

  // ⭐ THE MULTI-TREE RULES RUN HERE — ABOVE EVERY EARLY RETURN THIS FUNCTION
  // HAS (a missing `ast`, a non-canonical `ast`, and the scan-source parse
  // below) — so a document hears about its trees in the SAME pass rather than
  // one refusal per save attempt. ⛔ ALL THREE, NOT JUST THE LAST: the sheet
  // writes `ast = trees[scanPlot]`, so the likeliest v2 authoring bug breaks
  // `compute.ast` and the trees TOGETHER, and reporting only the first would
  // send an author round the loop once per defect. Only the alias check needs
  // `storedHash`; shape, one-key, per-tree canonicality, `treesHash` and
  // `sources` do not, so they are all still answerable here.
  validateTrees(compute, storedHash, errors, inputScope)

  if (storedHash === undefined) return   // compute.ast is unusable; reported above
  if (!isNonEmptyString(compute.source)) return   // already reported above
  const { result: parsed } = readFormulaSource(compute.source, 'auto', inputScope)
  if (!parsed.ok) {
    errors.push(
      `compute.source does not parse to compute.ast — it does not parse at all ` +
      `(${parsed.error}). The AST is what runs and the source is what the user edits; a pair ` +
      `that disagree is a read-back describing maths nobody is computing.`,
    )
    return
  }
  if (astHash(parsed.ast) !== storedHash) {
    errors.push(
      `compute.source does not parse to compute.ast — ${fmt(compute.source)} parses to ` +
      `${astHash(parsed.ast)} while the stored tree hashes to ${storedHash}. The AST is what ` +
      `runs and the source is what the user edits; a pair that disagree is a read-back ` +
      `describing maths nobody is computing.`,
    )
  }
}

/**
 * The multi-tree rules (spec §5.1, lane contract "definition document v2").
 *
 * ⛔ `compute.ast` IS THE SCAN TREE, and `scanPlot` names the plot it aliases —
 * so `def_hash` never moves and `scan_hits` / `definition_record` keys do not
 * either. `treesHash` is the SECOND identity, over every tree, and it is checked
 * rather than trusted for the same reason `fn` is (rule 3).
 *
 * ⛔ A SINGLE-TREE DOCUMENT CARRIES NONE OF THESE KEYS — a RULE with a refusal
 * behind it, not a convention. One tree is `compute.ast`, so a one-key `trees`
 * map would be a second spelling of the same document, and the contract's
 * byte-identical claim ("a v1 document validates exactly as today") is only
 * true while there is exactly one spelling. The other direction is refused by
 * name too: `scanPlot` / `treesHash` / `sources` beside no `trees`.
 *
 * `sources` is REQUIRED and COMPLETE on a multi-tree document for the reason
 * `compute.source` is required on every `ast` document: `compute.source` is one
 * string (the scan tree's), and a tree the sheet cannot print back is a formula
 * no author can ever correct.
 *
 * `scanPlot` is REQUIRED — there is no "default the first plot". A default would
 * make the compute section depend on `plots[]` order, a second authority over
 * which tree the scan runs.
 */
function validateTrees(compute, storedHash, errors, inputScope) {
  const { trees, scanPlot, sources } = compute
  if (trees === undefined) {
    for (const k of V2_COMPUTE_KEYS) {
      if (k === 'trees' || compute[k] === undefined) continue
      errors.push(
        `compute.${k}: only a multi-tree document (one carrying compute.trees) may declare it — got ` +
        `${fmt(compute[k])} beside no trees. A single-tree document is byte-identical to a schema-1 ` +
        `one on purpose, so no v2 key may ride on it alone.`,
      )
    }
    return
  }

  // Shape and key grammar are `assertTrees`'s (sorted keys back); its refusals
  // are labelled by field path, so they are pushed verbatim — `null` is refused
  // here too, never read as "absent".
  let keys
  try {
    keys = assertTrees(trees)
  } catch (err) {
    errors.push(err && err.message ? err.message : String(err))
    return
  }
  if (keys.length === 1) {
    errors.push(
      `compute.trees: one tree is compute.ast — a single-tree document carries no trees map (it is ` +
      `byte-identical to a schema-1 document on purpose), so drop trees/treesHash/scanPlot/sources or ` +
      `add a second plot. Got the one key ${fmt(keys[0])}.`,
    )
    return
  }

  const hashes = {}
  for (const k of keys) {
    try {
      hashes[k] = astHash(trees[k])
    } catch (err) {
      errors.push(
        `compute.trees.${k}: not a canonical tree (${err && err.message ? err.message : String(err)}) — ` +
        `every plot's tree is persisted in the same four-shape form as compute.ast`,
      )
    }
  }

  if (!isNonEmptyString(scanPlot) || !keys.includes(scanPlot)) {
    errors.push(
      `compute.scanPlot: must name one key of compute.trees (${list(keys)}) — the plot whose tree IS ` +
      `compute.ast — got ${fmt(scanPlot)}`,
    )
  } else if (hashes[scanPlot] !== undefined && storedHash !== undefined && hashes[scanPlot] !== storedHash) {
    errors.push(
      `compute.ast: must BE compute.trees.${scanPlot} — the scan tree is an ALIAS of the plot scanPlot ` +
      `names, which is what keeps def_hash still; here compute.ast hashes to ${storedHash} and ` +
      `trees.${scanPlot} to ${hashes[scanPlot]}`,
    )
  }

  // Compared only when every tree hashed: a non-canonical tree has no hash, so
  // the map has no honest identity to compare against yet.
  if (Object.keys(hashes).length === keys.length) {
    const expected = treesHashOf(trees)
    if (compute.treesHash !== expected) {
      errors.push(
        `compute.treesHash: expected ${fmt(expected)} (sha256 over the sorted "key":astHash pairs — ` +
        `ast/trees.js), got ${fmt(compute.treesHash)}. The hash is checked, never trusted, for the ` +
        `same reason compute.fn is.`,
      )
    }
  }

  if (sources === undefined) {
    errors.push(
      `compute.sources: a multi-tree document must carry the source text of EVERY tree ` +
      `({plotKey: source}) — compute.source is one string, the scan tree's, and a tree with no text ` +
      `is a formula no author can ever reopen`,
    )
    return
  }
  if (!isPlainObject(sources)) {
    errors.push(`compute.sources: expected an object of plotKey → source text, got ${fmt(sources)}`)
    return
  }
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(sources, k)) {
      errors.push(
        `compute.sources.${k}: missing — every tree carries the text the member edits (trees: ${list(keys)})`,
      )
    }
  }
  for (const k of Object.keys(sources)) {
    if (!keys.includes(k)) {
      errors.push(`compute.sources.${k}: names no tree (trees: ${list(keys)})`)
      continue
    }
    if (!isNonEmptyString(sources[k])) {
      errors.push(`compute.sources.${k}: expected the source text the member edits, got ${fmt(sources[k])}`)
      continue
    }
    // Through the ONE read door, in the source's own dialect — the same rule as
    // `compute.source` above, per tree.
    const { result } = readFormulaSource(sources[k], 'auto', inputScope)
    if (!result.ok) {
      errors.push(`compute.sources.${k} does not parse (${result.error})`)
      continue
    }
    if (hashes[k] !== undefined && astHash(result.ast) !== hashes[k]) {
      errors.push(
        `compute.sources.${k} does not parse to compute.trees.${k} — ${fmt(sources[k])} hashes to ` +
        `${astHash(result.ast)} while the stored tree hashes to ${hashes[k]}`,
      )
    }
  }
  if (isNonEmptyString(scanPlot) && keys.includes(scanPlot)
      && sources[scanPlot] !== undefined && sources[scanPlot] !== compute.source) {
    errors.push(
      `compute.sources.${scanPlot}: must equal compute.source — one text for the scan tree, never two ` +
      `that agree today`,
    )
  }
}

/** The closed set of fields a `meta.learn[]` entry may carry. */
export const META_LEARN_FIELDS = Object.freeze(['key', 'label'])

/**
 * `meta.learn`: a NON-EMPTY array of `{key, label}` — both non-empty strings,
 * keys unique, no other fields. Every refusal names the index and the field so
 * the author fixes the entry rather than guessing. An empty array is refused
 * too: a definition with no lessons declares no `learn` at all.
 */
function validateMetaLearn(learn, errors) {
  if (!Array.isArray(learn)) {
    errors.push(`meta.learn: expected an array of lessons [{key, label}], got ${fmt(learn)}`)
    return
  }
  if (learn.length === 0) {
    errors.push('meta.learn: expected at least one lesson {key, label} — a definition with no lessons declares no meta.learn')
    return
  }
  const seen = new Set()
  learn.forEach((entry, i) => {
    const path = `meta.learn[${i}]`
    if (!isPlainObject(entry)) {
      errors.push(`${path}: expected an object {key, label}, got ${fmt(entry)}`)
      return
    }
    for (const k of Object.keys(entry)) {
      if (!META_LEARN_FIELDS.includes(k)) {
        errors.push(`${path}.${k}: unknown lesson field — expected one of: ${list(META_LEARN_FIELDS)}`)
      }
    }
    if (!isNonEmptyString(entry.key)) {
      errors.push(`${path}.key: required non-empty string (a key the app's Learn map resolves), got ${fmt(entry.key)}`)
    } else if (seen.has(entry.key)) {
      errors.push(`${path}.key: duplicate lesson key ${fmt(entry.key)}`)
    } else {
      seen.add(entry.key)
    }
    if (!isNonEmptyString(entry.label)) {
      errors.push(`${path}.label: required non-empty string (the member-facing link text), got ${fmt(entry.label)}`)
    }
  })
}

// ─── `meta.tour` and `meta.searchHint` (UCT RS Phase 4, unit 4-03) ───────────
//
// Definition-level onboarding, read by the indicator library and its host. The
// ENGINE knows no indicator by name: a definition declares its own cards and its
// own disambiguation row, and these two validators are the whole contract.
//
//   meta.tour       [{title, body}] — 1 to TOUR_MAX_CARDS cards, shown one at a
//                   time on the first add. Lengths are capped HERE so a card can
//                   never outgrow the popover it is read in.
//   meta.searchHint {queries, line, cta?} — when the member's WHOLE search
//                   (trimmed, lower-cased, inner spaces collapsed) equals one of
//                   `queries`, the library prints `line` under its results with
//                   an Add button. Never a substring test: "rsi divergence" is a
//                   search for RSI, not a confusion to correct.
//
// BEHAVIOURAL, so checked and refused (fail-closed), never preserved: a card
// nobody can read in the space it gets, or a query in a form no search can equal,
// is an author error the schema names rather than one a member finds.

/** At most this many tour cards. */
export const TOUR_MAX_CARDS = 6
/** A card title's length cap, in characters. */
export const TOUR_TITLE_MAX = 60
/** A card body's length cap, in characters. */
export const TOUR_BODY_MAX = 240
/** The closed set of fields a `meta.tour[]` card may carry. */
export const META_TOUR_FIELDS = Object.freeze(['title', 'body'])
/** The closed set of fields `meta.searchHint` may carry. */
export const SEARCH_HINT_FIELDS = Object.freeze(['queries', 'line', 'cta'])
/** The hint line's length cap, in characters. */
export const SEARCH_HINT_LINE_MAX = 160
/** The optional button label's length cap, in characters. */
export const SEARCH_HINT_CTA_MAX = 40

/** The one normal form a search is compared in: trimmed, lower-cased, runs of
 *  whitespace collapsed to one space. A hint query must already be in it, and the
 *  library compares the member's query in it — an exact comparison, nothing more. */
export function normalizeHintQuery(q) {
  return String(q ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// ─── `meta.glossaryHref` (UCT RS Phase 4, unit 4-05) ────────────────────────
//
// The definition's public glossary page, linked from its About page beside the
// Learn links ("Glossary"). An IN-APP path only: it starts with one "/", carries
// no scheme, no host and no whitespace, so a definition can never point a member
// off the site from the chart. Behavioural (it renders a link), so checked.

/** The glossary path's length cap, in characters. */
export const GLOSSARY_HREF_MAX = 120

function validateMetaGlossaryHref(href, errors) {
  if (typeof href !== 'string' || !href) {
    errors.push(`meta.glossaryHref: expected an in-app path string such as "/methodology/relative-strength", got ${fmt(href)}`)
    return
  }
  if (href.length > GLOSSARY_HREF_MAX) {
    errors.push(`meta.glossaryHref: ${href.length} characters — at most ${GLOSSARY_HREF_MAX}`)
    return
  }
  if (!/^\/[A-Za-z0-9][A-Za-z0-9/_\-.]*(#[A-Za-z0-9_\-]+)?$/.test(href) || href.includes('//')) {
    errors.push(`meta.glossaryHref: "${href}" is not an in-app path (one leading "/", letters, digits, "-", "_", "." and "/", an optional #anchor)`)
  }
}

function validateMetaTour(tour, errors) {
  if (!Array.isArray(tour)) {
    errors.push(`meta.tour: expected an array of cards [{title, body}], got ${fmt(tour)}`)
    return
  }
  if (tour.length === 0) {
    errors.push('meta.tour: expected at least one card {title, body} — a definition with no tour declares no meta.tour')
    return
  }
  if (tour.length > TOUR_MAX_CARDS) {
    errors.push(`meta.tour: ${tour.length} cards — at most ${TOUR_MAX_CARDS}`)
  }
  tour.forEach((card, i) => {
    const path = `meta.tour[${i}]`
    if (!isPlainObject(card)) {
      errors.push(`${path}: expected an object {title, body}, got ${fmt(card)}`)
      return
    }
    for (const k of Object.keys(card)) {
      if (!META_TOUR_FIELDS.includes(k)) {
        errors.push(`${path}.${k}: unknown tour card field — expected one of: ${list(META_TOUR_FIELDS)}`)
      }
    }
    for (const [field, max] of [['title', TOUR_TITLE_MAX], ['body', TOUR_BODY_MAX]]) {
      const v = card[field]
      if (!isNonEmptyString(v)) {
        errors.push(`${path}.${field}: required non-empty string, got ${fmt(v)}`)
      } else if (v.length > max) {
        errors.push(`${path}.${field}: ${v.length} characters — at most ${max}`)
      }
    }
  })
}

function validateMetaSearchHint(hint, errors) {
  if (!isPlainObject(hint)) {
    errors.push(`meta.searchHint: expected an object {queries, line, cta?}, got ${fmt(hint)}`)
    return
  }
  for (const k of Object.keys(hint)) {
    if (!SEARCH_HINT_FIELDS.includes(k)) {
      errors.push(`meta.searchHint.${k}: unknown search hint field — expected one of: ${list(SEARCH_HINT_FIELDS)}`)
    }
  }
  const { queries, line, cta } = hint
  if (!Array.isArray(queries) || queries.length === 0) {
    errors.push(`meta.searchHint.queries: expected a non-empty array of lower-case search strings, got ${fmt(queries)}`)
  } else {
    const seen = new Set()
    queries.forEach((q, i) => {
      const path = `meta.searchHint.queries[${i}]`
      if (!isNonEmptyString(q)) {
        errors.push(`${path}: required non-empty string, got ${fmt(q)}`)
      } else if (normalizeHintQuery(q) !== q) {
        // A query outside the normal form can never equal a search, so it would
        // be a hint that silently never shows.
        errors.push(
          `${path}: ${fmt(q)} must be lower-case and trimmed, with single spaces — ` +
          `the library compares the whole search in that form, so this query could never match`,
        )
      } else if (seen.has(q)) {
        errors.push(`${path}: duplicate query ${fmt(q)}`)
      } else {
        seen.add(q)
      }
    })
  }
  if (!isNonEmptyString(line)) {
    errors.push(`meta.searchHint.line: required non-empty string (the sentence shown under the results), got ${fmt(line)}`)
  } else if (line.length > SEARCH_HINT_LINE_MAX) {
    errors.push(`meta.searchHint.line: ${line.length} characters — at most ${SEARCH_HINT_LINE_MAX}`)
  }
  if (cta !== undefined) {
    if (!isNonEmptyString(cta)) {
      errors.push(`meta.searchHint.cta: expected a non-empty string (the button label) or absent, got ${fmt(cta)}`)
    } else if (cta.length > SEARCH_HINT_CTA_MAX) {
      errors.push(`meta.searchHint.cta: ${cta.length} characters — at most ${SEARCH_HINT_CTA_MAX}`)
    }
  }
}

/**
 * @param {unknown} meta
 * @param {object} def the whole definition — `legendParams` names INPUT keys, so
 *        this is the one meta field that cannot be checked from `meta` alone.
 * @param {string[]} errors
 */
// ─── preset fields beyond `inputs` (Phase 2a, unit 2a-15) ───────────────────

/** Every key a `meta.presets[]` entry may carry. Closed: `applyPresetFields`
 *  reads the three non-input fields BY NAME, so a key outside this list is a
 *  typo that applies nothing, never data waiting for a future reader. */
export const PRESET_FIELDS = Object.freeze(['id', 'label', 'origin', 'inputs', 'visibility', 'dotSize', 'displayTarget'])

/** ⭐ UCT RS PHASE 3 (unit 3-01) — the preset keys that GATE rather than apply.
 *  `requiresServer: true` is read by `indicatorRegistry.visiblePresets` (the
 *  picker's filter), never by `applyPresetFields`, so it is a separate list:
 *  `PRESET_FIELDS` stays the exact set the writer applies. */
export const PRESET_GATE_FIELDS = Object.freeze(['requiresServer'])

/** The dot-size words a preset may name — `DOT_SIZES`' own keys (`presentation.js`),
 *  the vocabulary `setInstanceDotSize` accepts. ONE list, read from its owner. */
export const PRESET_DOT_SIZES = Object.freeze(Object.keys(DOT_SIZES))

/** The visibility policies a preset may name — `VISIBILITY_PRESETS`' own values
 *  (`instanceTimeframe.js`): `all` (stored as the ABSENT key), `intraday`,
 *  `dailyUp`, `custom` (the only one that carries timeframe codes). */
export const PRESET_VISIBILITY_PRESETS = Object.freeze(VISIBILITY_PRESETS.map((p) => p.value))

/** The outputs a definition draws as DOTS — the rule `instanceControls.dotPlotsOf`
 *  applies, restated over the RAW plots (this runs before `validatePlot`): a
 *  `markers` style or a `marker` glyph block, hidden ones excluded. Read here, not
 *  imported, because `instanceControls` imports this module. */
function dotPlotKeysOf(def) {
  const plots = def && Array.isArray(def.plots) ? def.plots : []
  return plots
    .filter((p) => isPlainObject(p) && isNonEmptyString(p.key) && p.hidden !== true
      && (p.style === 'markers' || isPlainObject(p.marker)))
    .map((p) => p.key)
}

/**
 * ⭐⭐ `meta.presets[i].{visibility, dotSize, displayTarget}` — checked EXACTLY as
 * `applyPresetFields` consumes them, so a value the writer would drop with a
 * `console.warn` is refused at registration instead, by definition id, preset id
 * and field:
 *
 *   visibility     `null` | `'all'` (the absent key — every timeframe), or the
 *                  policy object `normalizeVisibility` keeps: `{preset: 'intraday'}`,
 *                  `{preset: 'dailyUp'}`, `{preset: 'custom', tfs: [<code>, …]}` with
 *                  at least one code and every code one `isValidTf` knows. The
 *                  normaliser DROPS an unknown code and answers "all" for an empty
 *                  list — fail-open is right for a reader of a saved chart and wrong
 *                  for an author, so a code it would drop is refused here.
 *   dotSize        one word of `PRESET_DOT_SIZES` (every dot output), or
 *                  `{plotKey: word}` where every key is a declared dot output
 *                  (`dotPlotKeysOf`) and every value a word; an empty object sizes
 *                  nothing and is refused.
 *   displayTarget  one of `PLACEMENT_TARGETS` (`price` / `pane` / `volume`). The
 *                  writer also takes `@<instanceId>` for a DERIVED instance, but a
 *                  definition has no instance to name, so the preset vocabulary is
 *                  the placement vocabulary.
 *
 * Absent fields are fine (a preset that sets only inputs). The entry's own shape
 * (`id`, `label`, `inputs`) is the caller's check; this reads `p.id` for the
 * message only, so a preset that failed that check still gets its fields named.
 */
function validatePresetFields(p, i, def, errors) {
  const who = `definition ${fmt(def && def.id)}, preset ${fmt(p.id)}`
  const at = (field) => `meta.presets[${i}].${field}: ${who} — `

  for (const key of Object.keys(p)) {
    if (!PRESET_FIELDS.includes(key) && !PRESET_GATE_FIELDS.includes(key)) {
      errors.push(
        `${at(key)}unknown preset field. Expected one of ${list([...PRESET_FIELDS, ...PRESET_GATE_FIELDS])}; ` +
        `\`applyPresetFields\` reads its fields by name, so this one would register and apply nothing.`,
      )
    }
  }

  if (p.visibility !== undefined && p.visibility !== null && p.visibility !== 'all') {
    const v = p.visibility
    const SHAPES = `null, "all", {preset: "intraday"}, {preset: "dailyUp"} or {preset: "custom", tfs: [<timeframe code>, …]}`
    if (!isPlainObject(v)) {
      errors.push(`${at('visibility')}expected ${SHAPES}, got ${fmt(v)}`)
    } else {
      const extra = Object.keys(v).filter((k) => k !== 'preset' && k !== 'tfs')
      if (extra.length) {
        errors.push(`${at('visibility')}unknown key(s) ${list(extra.map(fmt))}; a policy carries \`preset\` and, for custom, \`tfs\``)
      }
      if (!PRESET_VISIBILITY_PRESETS.includes(v.preset) || v.preset === 'all') {
        errors.push(
          `${at('visibility.preset')}expected one of ${list(PRESET_VISIBILITY_PRESETS.filter((x) => x !== 'all').map(fmt))} ` +
          `(spell "every timeframe" as visibility: "all"), got ${fmt(v.preset)}`,
        )
      } else if (v.preset === 'custom') {
        if (!Array.isArray(v.tfs) || !v.tfs.length) {
          errors.push(
            `${at('visibility.tfs')}a custom policy needs a non-empty array of timeframe codes, got ${fmt(v.tfs)}. ` +
            `\`normalizeVisibility\` reads an empty list as "all", which is not what custom means.`,
          )
        } else {
          v.tfs.forEach((code, j) => {
            if (typeof code !== 'string' || !isValidTf(code)) {
              errors.push(
                `${at(`visibility.tfs[${j}]`)}${fmt(code)} is not a chart timeframe code; the normaliser would drop it silently.`,
              )
            }
          })
        }
      } else if (v.tfs !== undefined) {
        errors.push(`${at('visibility.tfs')}only a "custom" policy names timeframe codes; ${fmt(v.preset)} ignores them`)
      }
    }
  }

  if (p.dotSize !== undefined) {
    const d = p.dotSize
    const WORDS = list(PRESET_DOT_SIZES.map(fmt))
    if (typeof d === 'string') {
      if (!PRESET_DOT_SIZES.includes(d)) {
        errors.push(`${at('dotSize')}expected one of ${WORDS} (or {plotKey: word}), got ${fmt(d)}`)
      }
    } else if (!isPlainObject(d)) {
      errors.push(`${at('dotSize')}expected one of ${WORDS} or {plotKey: word}, got ${fmt(d)}`)
    } else {
      const dots = dotPlotKeysOf(def)
      const entries = Object.entries(d)
      if (!entries.length) {
        errors.push(`${at('dotSize')}an empty object sizes nothing; name a dot output (${list(dots) || 'none declared'}) or use a word`)
      }
      for (const [plotKey, word] of entries) {
        if (!dots.includes(plotKey)) {
          errors.push(
            `${at(`dotSize.${plotKey}`)}${fmt(plotKey)} is not a dot output of this definition ` +
            `(a non-hidden "markers" plot or one with a \`marker\` glyph). Declared: ${list(dots) || 'none'}`,
          )
        }
        if (typeof word !== 'string' || !PRESET_DOT_SIZES.includes(word)) {
          errors.push(`${at(`dotSize.${plotKey}`)}expected one of ${WORDS}, got ${fmt(word)}`)
        }
      }
    }
  }

  if (p.displayTarget !== undefined) {
    if (typeof p.displayTarget !== 'string' || !PLACEMENT_TARGETS.includes(p.displayTarget)) {
      errors.push(`${at('displayTarget')}expected one of ${list(PLACEMENT_TARGETS.map(fmt))}, got ${fmt(p.displayTarget)}`)
    }
  }
}

function validateMeta(meta, def, errors) {
  if (!isPlainObject(meta)) {
    errors.push(`meta: required object, got ${fmt(meta)}`)
    return
  }
  if (!isNonEmptyString(meta.name)) {
    errors.push(`meta.name: required non-empty string, got ${fmt(meta.name)}`)
  }
  for (const k of ['shortName', 'category', 'description', 'author']) {
    if (meta[k] !== undefined && typeof meta[k] !== 'string') {
      errors.push(`meta.${k}: expected a string, got ${fmt(meta[k])}`)
    }
  }
  // `tier` is an entitlement claim, not decoration — see TIERS. Omitting it is
  // legal (a definition need not gate itself); naming an unlocked tier is not.
  if (meta.tier !== undefined) {
    checkVocabulary(meta.tier, TIERS, [], 'meta.tier', 'tier', errors)
  }
  if (meta.tags !== undefined) {
    if (!Array.isArray(meta.tags) || meta.tags.some((t) => typeof t !== 'string')) {
      errors.push(`meta.tags: expected an array of strings, got ${fmt(meta.tags)}`)
    }
  }
  // `repaint` is document-ADJACENT but it is a truth claim about the maths that a
  // user makes decisions on, and its vocabulary is locked by the spec. An
  // unrecognised label rendered as "probably fine" is the coercion class. A
  // future value therefore has to arrive with a schema bump, not by luck.
  if (meta.repaint !== undefined) {
    checkVocabulary(meta.repaint, REPAINT_MODES, [], 'meta.repaint', 'repaint mode', errors)
  }
  // `freshness` is the same KIND of field as `repaint` and is guarded the same
  // way, for the same stated reason: it is a truth claim about the maths that a
  // user makes decisions on, and an unrecognised label rendered as "probably
  // fine" is the coercion class. A future value arrives with a schema bump, not
  // by luck. ⛔ AND IT IS NOT A FOURTH REPAINT VALUE — see FRESHNESS_MODES: the
  // repaint linter answers 0 for a scalar and is RIGHT, so this is a second
  // question rather than a wider answer to the first.
  if (meta.freshness !== undefined) {
    checkVocabulary(meta.freshness, FRESHNESS_MODES, [], 'meta.freshness', 'freshness mode', errors)
  }
  // ⭐⭐ P0G — `semantics` IS A BEHAVIOURAL meta field, not a document one: it
  // decides how the trees evaluate (`definitionSemantics.js`), so it is CHECKED,
  // not ignored-and-preserved. Absent (1) or exactly 2 — the only version the
  // store stamps (`user_definitions.decide_semantics`) — and never on a Pine
  // translation, whose comparisons keep Pine's `na`-is-false rule. Anything else
  // is a document no store wrote, refused by name rather than read as 1.
  if (meta.semantics !== undefined) {
    if (meta.semantics !== 2) {
      errors.push(`meta.semantics: expected 2 (or absent), got ${fmt(meta.semantics)}`)
    } else if (meta.recurrenceOrigin === 'pine') {
      errors.push('meta.semantics: a Pine translation keeps Pine semantics and carries no '
        + 'definition-semantics stamp')
    }
  }
  // `learn` (Phase 2a, unit 2a-10) is the lessons an indicator's About page
  // links to: `[{key, label}]`, where `key` names an entry in the APP's Learn
  // map (`lib/deskVideoHref.RS_LEARN_VIDEOS`) and `label` is the member-facing
  // link text. BEHAVIOURAL — it renders links — so it is checked, not preserved:
  // an entry shape nobody declared would render a link to nowhere. The key is
  // NOT checked against the map: that map is app code and this is engine code;
  // an unknown key renders no link (`learnHref` → null), never a broken one.
  if (meta.learn !== undefined && meta.learn !== null) {
    validateMetaLearn(meta.learn, errors)
  }
  // `tour` and `searchHint` (Phase 4, unit 4-03): first-add onboarding cards and
  // the library's exact-query disambiguation row. Behavioural, so checked —
  // see `validateMetaTour` / `validateMetaSearchHint`. `null` reads as absent,
  // the same as `learn`.
  if (meta.tour !== undefined && meta.tour !== null) {
    validateMetaTour(meta.tour, errors)
  }
  if (meta.searchHint !== undefined && meta.searchHint !== null) {
    validateMetaSearchHint(meta.searchHint, errors)
  }
  // `glossaryHref` (unit 4-05): the About page's Glossary link. `null` reads as absent.
  if (meta.glossaryHref !== undefined && meta.glossaryHref !== null) {
    validateMetaGlossaryHref(meta.glossaryHref, errors)
  }
  // `meta.legendFallback` (2026-11-07): the pane label's declared alternative value,
  // in the readout grammar. Each entry needs a scalar/payload source and a known format;
  // an optional `when` uses the same grammar as a readout row's.
  if (meta.legendFallback !== undefined) {
    if (!Array.isArray(meta.legendFallback)) {
      errors.push(`meta.legendFallback: expected an array of {source, format, when?}, got ${fmt(meta.legendFallback)}`)
    } else {
      meta.legendFallback.forEach((e, i) => {
        const p = isPlainObject(e) ? parseReadoutSource(e.source) : null
        if (!p || p.kind !== 'scalar') errors.push(`meta.legendFallback[${i}].source: expected a 'scalar:<a.b>' or 'payload:<a.b>' path, got ${fmt(e && e.source)}`)
        if (!isPlainObject(e) || !READOUT_FORMATS.includes(e.format)) errors.push(`meta.legendFallback[${i}].format: expected one of ${list(READOUT_FORMATS)}, got ${fmt(e && e.format)}`)
        // ⭐ UCT RS 3-08 — a `when` may be the equals gate too (`input:view=mansfield`):
        // one pane label value per Reading. The enum and its option are checked the
        // way a readout row's equals gate is (`equalsGateFault`).
        if (isPlainObject(e) && e.when !== undefined) {
          const gate = parseReadoutGate(e.when)
          if (!gate) {
            errors.push(`meta.legendFallback[${i}].when: expected a readout source or an input:<key>=<value> gate, got ${fmt(e.when)}`)
          } else if (typeof gate.equals === 'string') {
            const byKey = new Map((Array.isArray(def && def.inputs) ? def.inputs : [])
              .filter((x) => isPlainObject(x) && typeof x.key === 'string').map((x) => [x.key, x]))
            const fault = equalsGateFault(gate, byKey)
            if (fault) errors.push(`meta.legendFallback[${i}].when: ${fault}`)
          }
        }
        // ⭐ rsLine rev 5 — an optional `muted` GATE (`scalar:<path>`): while it holds the
        // entry prints in the muted ink (`readout.readoutFallbackValue`).
        if (isPlainObject(e) && e.muted !== undefined) {
          const gate = typeof e.muted === 'string' ? parseReadoutGate(e.muted) : null
          if (!gate || typeof gate.equals === 'string') {
            errors.push(`meta.legendFallback[${i}].muted: expected a readout gate such as 'scalar:<a.b>', got ${fmt(e.muted)}`)
          }
        }
      })
    }
  }
  // ⭐ `meta.paneTable` (UCT RS design round, 2026-11-08): a compact table of
  // payload numbers pinned to the indicator pane's top-right corner. Behavioural
  // (it renders), so checked fail-closed by its own module. `null` reads as absent.
  if (meta.paneTable !== undefined && meta.paneTable !== null) {
    validatePaneTable(meta.paneTable, def, errors, { isValidTf, equalsGateFault })
  }
  // `legendParams` is the one meta field with a BEHAVIOURAL half: it names the
  // inputs the crosshair chip prints in parentheses (`RSI(14)`), so a key that
  // resolves to nothing renders the string "RSI(undefined)" in the readout.
  // Checked like an unresolvable $ref rather than preserved like a document field.
  if (meta.legendParams !== undefined && meta.legendParams !== null) {
    if (!Array.isArray(meta.legendParams) || meta.legendParams.some(k => typeof k !== 'string' || !k)) {
      errors.push(`meta.legendParams: expected an array of input keys, got ${fmt(meta.legendParams)}`)
    } else {
      const declaredInputs = Array.isArray(def && def.inputs) ? def.inputs : []
      const declared = new Set(declaredInputs.map(i => i && i.key))
      for (const k of meta.legendParams) {
        if (!declared.has(k)) {
          errors.push(
            `meta.legendParams: ${fmt(k)} names no declared input — the chip would read ` +
            `"NAME(undefined)". Declared: ${list([...declared].filter(Boolean)) || 'none'}`,
          )
        }
      }
    }
  }
  // ⭐⭐ `nameFrom` IS THE THIRD BEHAVIOURAL META FIELD, and it is checked for the
  // same reason `legendParams` is: it names INPUT KEYS, and a key that resolves to
  // nothing would put an undefined into the one string a member reads on five
  // surfaces at once. `engine/semanticName.js` is its reader and its full account.
  //
  // ⛔ THE STEM MUST BE AN ENUM. The whole claim of the declaration is that the
  // name is the member's own choice READ BACK FROM THE CONTROL THEY MADE IT IN —
  // an option LABEL. A number or a colour has no label, so pointing `stem` at one
  // is an author error whose only symptom is a reader that answers `null` forever.
  if (meta.nameFrom !== undefined && meta.nameFrom !== null) {
    const nfInputs = Array.isArray(def && def.inputs) ? def.inputs : []
    const byKey = new Map(nfInputs.filter((i) => i && i.key).map((i) => [i.key, i]))
    const spec = meta.nameFrom
    if (typeof spec !== 'object' || Array.isArray(spec)) {
      errors.push(`meta.nameFrom: expected {stem, params?}, got ${fmt(spec)}`)
    } else {
      if (typeof spec.stem !== 'string' || !spec.stem) {
        errors.push(`meta.nameFrom.stem: required input key, got ${fmt(spec.stem)}`)
      } else if (!byKey.has(spec.stem)) {
        errors.push(
          `meta.nameFrom.stem: ${fmt(spec.stem)} names no declared input. ` +
          `Declared: ${list([...byKey.keys()]) || 'none'}`,
        )
      } else if (byKey.get(spec.stem).type !== 'enum') {
        errors.push(
          `meta.nameFrom.stem: ${fmt(spec.stem)} is a ${fmt(byKey.get(spec.stem).type)} input — ` +
          `the stem is an enum option's LABEL, so only an enum can supply one.`,
        )
      }
      if (spec.params !== undefined && spec.params !== null) {
        if (!Array.isArray(spec.params) || spec.params.some((k) => typeof k !== 'string' || !k)) {
          errors.push(`meta.nameFrom.params: expected an array of input keys, got ${fmt(spec.params)}`)
        } else {
          for (const k of spec.params) {
            if (!byKey.has(k)) {
              errors.push(
                `meta.nameFrom.params: ${fmt(k)} names no declared input. ` +
                `Declared: ${list([...byKey.keys()]) || 'none'}`,
              )
            }
          }
        }
      }
    }
  }
  // `timeframes` is the other meta field with a BEHAVIOURAL half: it is the ONLY
  // timeframes this indicator exists on, and `engine/eligibility.js` DROPS an
  // instance whose chart is not one of them. A session indicator on a daily bar
  // is not a degraded picture, it is a meaningless one (`VWAP_TFS`,
  // `StockChart.jsx:559`), so this is a gate and not decoration.
  //
  // ⚠️ OMIT THE FIELD to mean "everywhere" — an EMPTY array would mean "nowhere",
  // and the two are one keystroke apart. That is why `[]` is an error rather than
  // a silently-permissive value: an author who writes it meant something, and
  // whichever thing they meant, the schema should not guess.
  if (meta.timeframes !== undefined && meta.timeframes !== null) {
    if (!Array.isArray(meta.timeframes) || !meta.timeframes.length
        || meta.timeframes.some(t => typeof t !== 'string' || !t)) {
      errors.push(
        `meta.timeframes: expected a non-empty array of timeframe codes (the ONLY ones this ` +
        `indicator exists on), got ${fmt(meta.timeframes)}. Omit the field entirely for an ` +
        `indicator that renders everywhere — an empty array would mean "nowhere".`,
      )
    }
  }
  // `presets` is read by the settings dialog's generic preset picker: a named set
  // of input values applied to the CURRENT instance through `setInstanceInput`.
  // Light shape check on the entry — each needs a string `id` and `label` and an
  // object `inputs`. Keys and values inside `inputs` are NOT checked against the
  // declared inputs here: the writer validates every value at apply time and the
  // picker skips an undeclared key with a warning, so a stale preset degrades
  // rather than refusing the whole definition.
  //
  // ⭐⭐ THE THREE NON-INPUT FIELDS ARE BEHAVIOURAL AND FAIL CLOSED (Phase 2a,
  // unit 2a-15; the writer is unit 2a-12's `applyPresetFields`). `visibility`,
  // `dotSize` and `displayTarget` are each handed to a per-instance writer that
  // DROPS a value it cannot take with a `console.warn` — so a preset carrying
  // `dotSize: 'big'` or a visibility over a timeframe code the chart does not
  // have would register, show in the picker, and apply nothing. That is the
  // "validated but inert" failure this schema exists to prevent, and nobody
  // reads a console on a phone. `validatePresetFields` refuses each one by
  // definition id, preset id and field, in the writer's own vocabulary.
  //
  // ⛔ AND A PRESET'S KEY SET IS CLOSED (`PRESET_FIELDS`), unlike `meta.*`
  // itself. `applyPresetFields` reads its three fields BY NAME — `dotsize` or
  // `visibilty` is not forward-compatible data waiting for a reader, it is a
  // typo that silently does nothing; the forward-compatibility half of the
  // asymmetric policy stays with `meta`'s own unknown keys (preserved below).
  if (meta.presets !== undefined && meta.presets !== null) {
    if (!Array.isArray(meta.presets)) {
      errors.push(`meta.presets: expected an array of {id, label, inputs}, got ${fmt(meta.presets)}`)
    } else {
      const seen = new Set()
      meta.presets.forEach((p, i) => {
        if (!isPlainObject(p)) {
          errors.push(`meta.presets[${i}]: expected an object {id, label, inputs}, got ${fmt(p)}`)
          return
        }
        if (!isNonEmptyString(p.id)) {
          errors.push(`meta.presets[${i}].id: required non-empty string, got ${fmt(p.id)}`)
        } else if (seen.has(p.id)) {
          errors.push(`meta.presets[${i}].id: duplicate preset id ${fmt(p.id)}`)
        } else {
          seen.add(p.id)
        }
        if (!isNonEmptyString(p.label)) {
          errors.push(`meta.presets[${i}].label: required non-empty string, got ${fmt(p.label)}`)
        }
        if (p.origin !== undefined && typeof p.origin !== 'string') {
          errors.push(`meta.presets[${i}].origin: expected a string, got ${fmt(p.origin)}`)
        }
        if (!isPlainObject(p.inputs)) {
          errors.push(`meta.presets[${i}].inputs: required object of input values, got ${fmt(p.inputs)}`)
        }
        validatePresetFields(p, i, def, errors)
      })
    }
  }
  // `groupsCollapsed` is read by the settings dialog: the input groups named here
  // open collapsed. Names that match no declared group are inert, so only the
  // shape is checked.
  if (meta.groupsCollapsed !== undefined && meta.groupsCollapsed !== null) {
    if (!Array.isArray(meta.groupsCollapsed) || meta.groupsCollapsed.some((g) => typeof g !== 'string' || !g)) {
      errors.push(`meta.groupsCollapsed: expected an array of group names, got ${fmt(meta.groupsCollapsed)}`)
    }
  }
  // ⭐ UCT RS split, unit U1 — `meta.requiresServer: true` gates the WHOLE
  // definition: every surface that offers indicators to add hides it until the
  // live server lists its id (`serverCompute.isDefinitionOffered`). BEHAVIOURAL,
  // so checked like the input-level flag it extends: `true` or absent (`false`,
  // `'yes'`, `1` would gate nothing and read as a typo), and only on a `server`
  // definition — no row will ever declare a native or ast definition, so the
  // flag there could only hide an indicator forever.
  if (meta.requiresServer !== undefined) {
    if (meta.requiresServer !== true) {
      errors.push(`meta.requiresServer: expected true or absent, got ${fmt(meta.requiresServer)}`)
    } else if (!(isPlainObject(def.compute) && def.compute.kind === 'server')) {
      errors.push(
        `meta.requiresServer: compute.kind is ${fmt(isPlainObject(def.compute) ? def.compute.kind : undefined)}, ` +
        'and only a "server" definition has a live row to declare it, so the definition could never be offered',
      )
    }
  }
  // NOTE: unknown meta.* KEYS are intentionally NOT checked. They are preserved
  // verbatim on the returned def — that is the forward-compatibility half of the
  // asymmetric policy, and the round-trip promise depends on this silence.
}

/**
 * ⭐⭐ `readout[]` — THE ROWS A SERVER-LANE DEFINITION PRINTS IN WORDS (Phase 2a).
 *
 * A top-level field, and a BEHAVIOURAL one: each entry decides what the legend
 * and the pane readout say about a scalar the envelope carried, so it is
 * validated fail-closed like `plots[].legend` — explicitly carved out of the
 * preserve-unknown policy that every other top-level key enjoys. The grammar
 * and the formats are `readoutSchema.js`'s (its header is the full account);
 * this checks a definition against them so a row that could only ever print
 * "undefined" is refused at registration, by index, rather than rendered.
 *
 * Every message names the definition and the entry index, because a readout
 * block is authored once per tenant and read by nobody until a chart draws it.
 *
 * @param {object} def the whole definition (reads `readout`, `id`)
 * @param {Map<string, object>} inputsByKey the declared inputs, for `input:` sources
 * @param {string[]} errors
 */
/**
 * ⭐ UCT RS 3-07 — the equals gate `input:<key>=<value>` (`readoutSchema`'s
 * header). `null` when it is sound, else the reason. Closed on purpose: the key
 * must be a declared ENUM input and the value one of its declared STRING option
 * codes, because the runtime compares by identity and a value no option carries
 * would keep the row closed forever without a word.
 */
function equalsGateFault(gate, inputsByKey) {
  const key = gate.path[0]
  const input = inputsByKey.get(key)
  if (!input) return `${fmt(key)} names no declared input. Declared: ${list([...inputsByKey.keys()]) || 'none'}`
  if (input.type !== 'enum' || !Array.isArray(input.options)) {
    return `the equals form compares an ENUM input with one of its options, and ${fmt(key)} is ${fmt(input.type)}`
  }
  const values = input.options.map(enumOptionValue).filter((v) => typeof v === 'string')
  if (!values.includes(gate.equals)) {
    return `${fmt(gate.equals)} is not one of ${fmt(key)}'s option values: ${list(values.map(fmt)) || 'none'}`
  }
  return null
}

/**
 * ⭐ UCT RS 3-07 — `readout[].action`, what a row offers to DO
 * (`readoutSchema.READOUT_ACTION_KINDS`). Closed vocabulary, closed fields per
 * kind, and an input-naming action must name a declared `string` input: a date
 * picked off the chart, or a reset, is written to a text value, and anything else
 * would be a write the input's own control could not show.
 */
function validateReadoutAction(action, path, who, inputsByKey, errors) {
  const where = `${path}.action`
  if (!isPlainObject(action)) {
    errors.push(`${where}: ${who} — expected {kind, input?}, got ${fmt(action)}`)
    return
  }
  if (!READOUT_ACTION_KINDS.includes(action.kind)) {
    errors.push(`${where}.kind: ${who} — unknown readout action ${fmt(action.kind)} — expected one of: ${list(READOUT_ACTION_KINDS)}`)
    return
  }
  const fields = READOUT_ACTION_FIELDS[action.kind]
  for (const k of Object.keys(action)) {
    if (!fields.includes(k)) {
      errors.push(`${where}.${k}: ${who} — a ${fmt(action.kind)} action carries only ${list(fields)}`)
    }
  }
  if (!fields.includes('input')) return
  if (!isNonEmptyString(action.input)) {
    errors.push(`${where}.input: ${who} — a ${fmt(action.kind)} action names the input it writes, got ${fmt(action.input)}`)
    return
  }
  const input = inputsByKey.get(action.input)
  if (!input) {
    errors.push(
      `${where}.input: ${who} — ${fmt(action.input)} names no declared input. ` +
      `Declared: ${list([...inputsByKey.keys()]) || 'none'}`,
    )
  } else if (input.type !== READOUT_ACTION_INPUT_TYPE) {
    errors.push(
      `${where}.input: ${who} — a ${fmt(action.kind)} action writes a ${fmt(READOUT_ACTION_INPUT_TYPE)} input, ` +
      `and ${fmt(action.input)} is ${fmt(input.type)}`,
    )
  }
}

function validateReadout(def, inputsByKey, errors) {
  const readout = def.readout
  if (readout === undefined || readout === null) return
  const who = `definition ${fmt(def.id)}`
  const SOURCE_HELP = `expected ${READOUT_SOURCE_PREFIXES.map((p) => `${p}:<${p === 'input' ? 'key' : 'path'}>`).join(', ')}`
  if (!Array.isArray(readout)) {
    errors.push(`readout: ${who} — expected an array of readout rows {key, label, source, format}, got ${fmt(readout)}`)
    return
  }
  const seen = new Set()
  readout.forEach((entry, i) => {
    const path = `readout[${i}]`
    if (!isPlainObject(entry)) {
      errors.push(`${path}: ${who} — expected an object {key, label, source, format}, got ${fmt(entry)}`)
      return
    }
    for (const key of Object.keys(entry)) {
      if (!READOUT_ENTRY_FIELDS.includes(key)) {
        errors.push(
          `${path}.${key}: ${who} — unknown readout field — expected one of: ${list(READOUT_ENTRY_FIELDS)}. ` +
          `A readout row decides what the legend prints, so an unknown field fails closed rather than being preserved.`,
        )
      }
    }
    if (!isNonEmptyString(entry.key)) {
      errors.push(`${path}.key: ${who} — required non-empty string, got ${fmt(entry.key)}`)
    } else if (!KEY_RE.test(entry.key)) {
      errors.push(`${path}.key: ${who} — ${fmt(entry.key)} is not a legal key (must match ${KEY_RE})`)
    } else if (seen.has(entry.key)) {
      errors.push(`${path}.key: ${who} — duplicate readout key ${fmt(entry.key)}`)
    } else {
      seen.add(entry.key)
    }
    if (!isNonEmptyString(entry.label)) {
      errors.push(`${path}.label: ${who} — required non-empty string (the member-facing row name), got ${fmt(entry.label)}`)
    }
    // `source` and `when` share one grammar; `input:` must name a declared input
    // for the same reason `meta.legendParams` must — the row would read nothing.
    for (const field of ['source', 'when', 'note']) {
      const v = entry[field]
      if ((field === 'when' || field === 'note') && (v === undefined || v === null)) continue
      if (!isNonEmptyString(v)) {
        errors.push(`${path}.${field}: ${who} — required string, ${SOURCE_HELP}, got ${fmt(v)}`)
        continue
      }
      // ⭐ 3-07 — a `when` may be the equals form instead (`input:view=rotation`).
      if (field === 'when') {
        const gate = parseReadoutGate(v)
        if (gate && typeof gate.equals === 'string') {
          const fault = equalsGateFault(gate, inputsByKey)
          if (fault) errors.push(`${path}.when: ${who} — ${fault}`)
          continue
        }
      }
      const parsed = parseReadoutSource(v)
      if (!parsed) {
        const prefix = v.includes(':') ? v.slice(0, v.indexOf(':')) : v
        errors.push(
          `${path}.${field}: ${who} — ${fmt(v)} is not a readout source` +
          (READOUT_SOURCE_PREFIXES.includes(prefix) ? ` (a dotted path of identifiers must follow the prefix)` : ` — unknown prefix ${fmt(prefix)}`) +
          `; ${SOURCE_HELP}`,
        )
        continue
      }
      if (parsed.kind === 'input') {
        if (parsed.path.length !== 1) {
          errors.push(`${path}.${field}: ${who} — an input source names ONE input key, got ${fmt(v)}`)
        } else if (!inputsByKey.has(parsed.path[0])) {
          errors.push(
            `${path}.${field}: ${who} — ${fmt(parsed.path[0])} names no declared input. ` +
            `Declared: ${list([...inputsByKey.keys()]) || 'none'}`,
          )
        }
      }
    }
    if (!READOUT_FORMATS.includes(entry.format)) {
      errors.push(
        `${path}.format: ${who} — unknown readout format ${fmt(entry.format)} — expected one of: ${list(READOUT_FORMATS)}`,
      )
    }
    if (entry.fallback !== undefined && !isNonEmptyString(entry.fallback)) {
      errors.push(`${path}.fallback: ${who} — expected a non-empty string, got ${fmt(entry.fallback)}`)
    }
    if (entry.chip !== undefined && typeof entry.chip !== 'boolean') {
      errors.push(`${path}.chip: ${who} — expected a boolean, got ${fmt(entry.chip)}`)
    }
    // ⭐ UCT RS 3-08 — `muted` may also be a GATE in the `when` grammar
    // (`scalar:rotation.reason`): the row prints in the quiet ink while it holds,
    // so a reading the server could not make reads as a note, not a value.
    if (entry.muted !== undefined && typeof entry.muted !== 'boolean') {
      const gate = typeof entry.muted === 'string' ? parseReadoutGate(entry.muted) : null
      if (!gate) {
        errors.push(`${path}.muted: ${who} — expected a boolean or a readout gate (${SOURCE_HELP}), got ${fmt(entry.muted)}`)
      } else if (typeof gate.equals === 'string') {
        const fault = equalsGateFault(gate, inputsByKey)
        if (fault) errors.push(`${path}.muted: ${who} — ${fault}`)
      } else if (gate.kind === 'input' && (gate.path.length !== 1 || !inputsByKey.has(gate.path[0]))) {
        errors.push(`${path}.muted: ${who} — ${fmt(entry.muted)} names no declared input`)
      }
    }
    // ⭐ VA2 — `chipWhen` / `chipPrefix` / `band` (UCT RS rating inputs). Each is
    // behavioural, so each fails closed at registration rather than at render.
    if (entry.chipWhen !== undefined) {
      const cw = entry.chipWhen
      if (entry.chip !== true) {
        errors.push(`${path}.chipWhen: ${who} — only a chip row (\`chip: true\`) carries a chip condition`)
      } else if (!isPlainObject(cw) || typeof cw.key !== 'string') {
        errors.push(`${path}.chipWhen: ${who} — expected {key, <comparator>} naming a declared input, got ${fmt(cw)}`)
      } else if (!inputsByKey.has(cw.key)) {
        errors.push(
          `${path}.chipWhen.key: ${who} — ${fmt(cw.key)} names no declared input. ` +
          `Declared: ${list([...inputsByKey.keys()]) || 'none'}`,
        )
      } else {
        const ops = Object.keys(cw).filter((k) => k !== 'key')
        if (ops.length !== 1 || !READOUT_CONDITION_OPS.includes(ops[0])) {
          errors.push(`${path}.chipWhen: ${who} — expected exactly one comparator of: ${list(READOUT_CONDITION_OPS)}, got ${fmt(ops)}`)
        } else if (ops[0] === 'in' && !Array.isArray(cw.in)) {
          errors.push(`${path}.chipWhen.in: ${who} — expected an array of values, got ${fmt(cw.in)}`)
        }
      }
    }
    if (entry.chipPrefix !== undefined && !isNonEmptyString(entry.chipPrefix)) {
      errors.push(`${path}.chipPrefix: ${who} — expected a non-empty word, got ${fmt(entry.chipPrefix)}`)
    }
    if (entry.band !== undefined) {
      const b = entry.band
      if (!isPlainObject(b)) {
        errors.push(`${path}.band: ${who} — expected {source, when?}, got ${fmt(b)}`)
      } else {
        for (const k of Object.keys(b)) {
          if (k !== 'source' && k !== 'when') errors.push(`${path}.band.${k}: ${who} — unknown band field, expected source or when`)
        }
        for (const k of ['source', 'when']) {
          if (k === 'when' && (b.when === undefined || b.when === null)) continue
          if (k === 'when') {
            const gate = parseReadoutGate(b.when)
            if (gate && typeof gate.equals === 'string') {
              const fault = equalsGateFault(gate, inputsByKey)
              if (fault) errors.push(`${path}.band.when: ${who} — ${fault}`)
              continue
            }
          }
          const parsed = parseReadoutSource(b[k])
          if (!parsed) {
            errors.push(`${path}.band.${k}: ${who} — ${fmt(b[k])} is not a readout source; ${SOURCE_HELP}`)
          } else if (parsed.kind === 'input' && (parsed.path.length !== 1 || !inputsByKey.has(parsed.path[0]))) {
            errors.push(`${path}.band.${k}: ${who} — ${fmt(b[k])} names no declared input`)
          }
        }
      }
    }
    if (entry.action !== undefined) validateReadoutAction(entry.action, path, who, inputsByKey, errors)
    if (entry.words !== undefined) {
      if (entry.format !== 'bool') {
        errors.push(`${path}.words: ${who} — only a "bool" row carries a word pair (this row is ${fmt(entry.format)})`)
      } else if (!Array.isArray(entry.words) || entry.words.length !== 2 || entry.words.some((w) => typeof w !== 'string')) {
        errors.push(`${path}.words: ${who} — expected [trueWord, falseWord], two strings, got ${fmt(entry.words)}`)
      }
    }
    if (entry.card !== undefined) {
      if (!isPlainObject(entry.card)) {
        errors.push(`${path}.card: ${who} — expected an object {what, origin, evidence?}, got ${fmt(entry.card)}`)
      } else {
        for (const key of Object.keys(entry.card)) {
          if (!READOUT_CARD_FIELDS.includes(key)) {
            errors.push(`${path}.card.${key}: ${who} — unknown card field — expected one of: ${list(READOUT_CARD_FIELDS)}`)
          }
        }
        for (const key of ['what', 'origin']) {
          if (!isNonEmptyString(entry.card[key])) {
            errors.push(`${path}.card.${key}: ${who} — required non-empty string, got ${fmt(entry.card[key])}`)
          }
        }
        if (entry.card.evidence !== undefined && typeof entry.card.evidence !== 'string') {
          errors.push(`${path}.card.evidence: ${who} — expected a string, got ${fmt(entry.card.evidence)}`)
        }
        // `learn` names a lesson in the APP's Learn map (`lib/deskVideoHref`), not
        // anything the engine holds — so the schema asks only that it is a key
        // at all. A key the map does not know renders no link (`learnHref` → null).
        // `evidenceSource` (unit 2b-09) is a payload path the card reads its measured
        // sentence from. Its GRAMMAR is checked here, at registration: a path that
        // cannot parse would silently fall back to the static line forever, which
        // reads as "nothing measured yet" rather than as the typo it is. An
        // `input:` source is refused too: evidence is the server's, never a knob.
        if (entry.card.evidenceSource !== undefined) {
          const parsed = parseReadoutSource(entry.card.evidenceSource)
          if (!parsed || parsed.kind !== 'scalar') {
            errors.push(`${path}.card.evidenceSource: ${who} — expected a 'scalar:<a.b.c>' or 'payload:<a.b.c>' path, got ${fmt(entry.card.evidenceSource)}`)
          }
        }
        if (entry.card.learn !== undefined && !isNonEmptyString(entry.card.learn)) {
          errors.push(`${path}.card.learn: ${who} — expected a non-empty lesson key (a string the app's Learn map resolves), got ${fmt(entry.card.learn)}`)
        }
      }
    }
  })
  validateReadoutDetails(readout, who, errors)
}

/**
 * ⭐ `readout[].detailOf` — A DETAIL ROW AND THE GLANCE ROW IT EXPLAINS (Phase 2a
 * visual round, item A1). A detail row prints only inside its glance row's card,
 * so the name must resolve to a row that HAS a card, and nesting is ONE level: a
 * glance row is a row without `detailOf`, so a detail row cannot be the parent of
 * another (it has no place of its own in the menu to open a card from). Checked
 * after the per-entry pass because the parent may be declared after the child.
 * A row naming itself is the same "no glance row" fault as a missing name.
 */
function validateReadoutDetails(readout, who, errors) {
  const byKey = new Map()
  for (const e of readout) {
    if (isPlainObject(e) && isNonEmptyString(e.key) && !byKey.has(e.key)) byKey.set(e.key, e)
  }
  readout.forEach((entry, i) => {
    if (!isPlainObject(entry) || entry.detailOf === undefined) return
    const path = `readout[${i}].detailOf`
    const name = entry.detailOf
    if (!isNonEmptyString(name)) {
      errors.push(`${path}: ${who} — expected the key of the glance row this row explains, got ${fmt(name)}`)
      return
    }
    const parent = byKey.get(name)
    if (!parent || parent === entry) {
      errors.push(
        `${path}: ${who} — ${fmt(name)} names no other readout row, so this row could never print. ` +
        `Declared: ${list([...byKey.keys()]) || 'none'}`,
      )
      return
    }
    if (!isPlainObject(parent.card)) {
      errors.push(
        `${path}: ${who} — ${fmt(name)} has no card, and a detail row prints only inside its glance row's card`,
      )
    }
    if (parent.detailOf !== undefined) {
      errors.push(
        `${path}: ${who} — ${fmt(name)} is itself a detail row (detailOf ${fmt(parent.detailOf)}); ` +
        `a detail row explains a GLANCE row, one level deep`,
      )
    }
  })
}

function validatePlacement(placement, errors) {
  if (!isPlainObject(placement)) {
    errors.push(`placement: required object, got ${fmt(placement)}`)
    return
  }
  checkVocabulary(placement.target, PLACEMENT_TARGETS, [], 'placement.target', 'placement target', errors)
  // ⭐ A4 — whether the pane's price scale shows. Absent means `'visible'`, which
  // is every definition that predates the field, so no other pane moves.
  if (placement.axis !== undefined) {
    checkVocabulary(placement.axis, PLACEMENT_AXIS_MODES, [], 'placement.axis', 'placement axis mode', errors)
  }
  // ⭐ UCT RS 3-07 — `ownScale`: on the price pane, draw on an invisible scale of
  // the instance's own in the lowest third under the bars (`placement.ownScaleOf`).
  // Behavioural, so only a real boolean is admitted: a string `'true'` would read
  // as off in the resolver and as on to a reader of the definition.
  if (placement.ownScale !== undefined && typeof placement.ownScale !== 'boolean') {
    errors.push(
      `placement.ownScale: expected a boolean (true draws on its own invisible scale under the bars ` +
      `when the indicator is on the price pane), got ${fmt(placement.ownScale)}`,
    )
  }

  // A pane's DEFAULT height, as a fraction of the chart. Optional; `paneLayout`
  // supplies `DEFAULT_PANE_HEIGHT` when absent. It lives on the definition
  // because a pane height is a per-indicator property — which is what lets a
  // sixteenth indicator cost one definition and zero list edits (plan §A5), and
  // what retires `paneMargins.PANES`' nine `baseH` values into data rather than
  // renaming the table. It is a DEFAULT, not a lock: an instance may carry its
  // own once panes are user-resizable (Phase C).
  //
  // The bound is `0 < h < 1` and it is exclusive at BOTH ends on purpose. `0` is
  // a pane that reserves no space (which is what "not a pane" means, and the
  // placement target already says that); `1` is a pane that takes the whole
  // chart, leaving the price area nothing — the `top + bottom > 1` throw
  // the band arithmetic's shave exists to prevent, arriving from the other side.
  // A string `'0.15'` is rejected like every other behavioural value: coerced, it
  // would multiply as a number in one place and concatenate in another.
  if (placement.pane !== undefined && placement.pane !== null) {
    if (!isPlainObject(placement.pane)) {
      errors.push(`placement.pane: expected an object, got ${fmt(placement.pane)}`)
    } else {
      if (placement.pane.height !== undefined
          && !(isFiniteNumber(placement.pane.height)
               && placement.pane.height > 0 && placement.pane.height < 1)) {
        errors.push(
          `placement.pane.height: expected a finite fraction of the chart in (0, 1) — ` +
          `the pane's default height — got ${fmt(placement.pane.height)}`,
        )
      }
      // ⭐ RS split U3 — `minPx`: the pane's MINIMUM height in pixels, applied
      // after the member's own sizes (`paneStretchPlan`). Optional; absent means
      // no floor beyond the stack's 4 % share, which is every definition before
      // U3. PIXELS, not a fraction, because readability is a property of the
      // screen — so the bound is simply a positive finite number, and a string
      // is refused like every other behavioural value.
      if (placement.pane.minPx !== undefined
          && !(isFiniteNumber(placement.pane.minPx) && placement.pane.minPx > 0)) {
        errors.push(
          `placement.pane.minPx: expected a positive finite number of pixels — ` +
          `the pane's minimum height — got ${fmt(placement.pane.minPx)}`,
        )
      }
    }
  }

  const { scale } = placement
  if (scale === undefined || scale === null) return
  if (!isPlainObject(scale)) {
    errors.push(`placement.scale: expected an object with numeric min/max, got ${fmt(scale)}`)
    return
  }
  for (const k of ['min', 'max']) {
    if (scale[k] !== undefined && !isFiniteNumber(scale[k])) {
      errors.push(`placement.scale.${k}: expected a finite number, got ${fmt(scale[k])}`)
    }
  }
  if (isFiniteNumber(scale.min) && isFiniteNumber(scale.max) && scale.min >= scale.max) {
    errors.push(
      `placement.scale: min must be < max, got min=${fmt(scale.min)} max=${fmt(scale.max)}`,
    )
  }
}

/** Pull the value out of an enum option, accepting the three shapes a caller
 *  might reasonably write — a bare scalar, the `[value, label]` pair shape
 *  `indicatorRegistry` already uses, or `{value, label}`. */
function enumOptionValue(option) {
  if (Array.isArray(option)) return option[0]
  if (isPlainObject(option) && 'value' in option) return option.value
  return option
}

/**
 * Check a VALUE against an input's declared `type`, `options` and bounds.
 *
 * This is where "never coerce" earns its keep: a `type: 'int'` holding `'14'` is
 * a bug, and accepting it would mean the string reaches the compute lane and
 * does string maths there.
 *
 * EXPORTED because two callers must agree exactly, and B2 Task 3 is where that
 * stopped being hypothetical: `validateDefinition` checks an input's DEFAULT
 * with it, and `instances.js::validateInstance` checks a stored instance's
 * OVERRIDE with it. Those are the same question asked about two values, and a
 * second copy of the answer would drift the day someone adds an input type —
 * definitions would accept it and instances would reject it, or worse.
 *
 * Pushes into `errors`; returns nothing. `path` names the value being checked
 * (`inputs[0].default`, `inputs.period`, …) and every message starts with it.
 *
 * @param {object} input  the declared input descriptor (type/options/min/max)
 * @param {unknown} value the value to check
 * @param {string} path   error prefix identifying the value
 * @param {string[]} errors accumulator
 */
export function validateInputValue(input, value, path, errors) {
  const { type } = input
  const d = value

  switch (type) {
    case 'int':
      if (!Number.isInteger(d)) errors.push(`${path}: type "int" requires an integer, got ${fmt(d)}`)
      break
    case 'float':
      if (!isFiniteNumber(d)) errors.push(`${path}: type "float" requires a finite number, got ${fmt(d)}`)
      break
    case 'bool':
      if (typeof d !== 'boolean') errors.push(`${path}: type "bool" requires true or false, got ${fmt(d)}`)
      break
    case 'string':
      if (typeof d !== 'string') {
        errors.push(`${path}: type "string" requires a string, got ${fmt(d)}`)
        break
      }
      // ⭐ UCT RS Phase 3, unit 3-02 — a declared `maxLength` and `pattern` bind
      // every NON-EMPTY value. Empty is always legal: it means "not set".
      if (d === '') break
      if (Number.isInteger(input.maxLength) && d.length > input.maxLength) {
        errors.push(`${path}: ${fmt(d)} is longer than the declared maxLength ${input.maxLength}`)
      }
      if (input.pattern !== undefined) {
        const re = stringPatternRegExp(input.pattern)
        if (!re) errors.push(`${path}: the declared pattern ${fmt(input.pattern)} is not an anchored regex, so no value can be checked against it`)
        else if (!re.test(d)) errors.push(`${path}: ${fmt(d)} does not match the declared pattern ${input.pattern}`)
      }
      break
    // ⭐ PHASE 3 WS-D (runtime documents only — `RUNTIME_INPUT_TYPES`)
    case 'time':
      if (!Number.isInteger(d) || Math.abs(d) > TIME_INPUT_MAX_ABS_MS) {
        errors.push(`${path}: type "time" requires whole milliseconds since 1970 (UTC), got ${fmt(d)}`)
      }
      break
    case 'session':
      if (!isSessionString(d)) {
        errors.push(`${path}: type "session" requires a session such as "0930-1600" or "0930-1600:23456", got ${fmt(d)}`)
      }
      break
    case 'color':
      // Not resolved here — `'token:info'`, `'#ff8100'` and `'rgba(…)'` are all
      // legal at registration; designTokens.resolveToken() adjudicates at render.
      if (!isNonEmptyString(d)) {
        errors.push(`${path}: type "color" requires a non-empty string (a "token:<role>" ref or a raw CSS colour), got ${fmt(d)}`)
      }
      break
    case 'source':
      // The referent set (bar fields plus this-or-another indicator's plot keys)
      // is a binder-time fact — the spec does not lock a v1 enum, so inventing
      // one here would reject definitions the platform is supposed to accept.
      if (!isNonEmptyString(d)) {
        errors.push(`${path}: type "source" requires a non-empty string (a bar field or a "defId.plotKey" handle), got ${fmt(d)}`)
      }
      break
    case 'enum': {
      if (!Array.isArray(input.options) || input.options.length === 0) {
        errors.push(`${path}: type "enum" requires a non-empty options array on the input, got ${fmt(input.options)}`)
        break
      }
      const values = input.options.map(enumOptionValue)
      // Option VALUES must be scalars. Membership below is identity-based, and
      // an array or object option could therefore never match its own default —
      // it would fail with a baffling "[80, 20] is not one of: [80, 20]". A
      // dropdown value is a scalar anyway; rejecting the rest says so out loud
      // instead of failing mysteriously later.
      const nonScalar = values.filter((v) => !['string', 'number', 'boolean'].includes(typeof v))
      if (nonScalar.length) {
        errors.push(
          `${path}: enum option values must be scalars (string, number or boolean), got ${list(nonScalar.map(fmt))} — ` +
          `options are compared by identity, so a non-scalar could never match a value`,
        )
        break
      }
      if (!values.includes(d)) {
        errors.push(`${path}: ${fmt(d)} is not one of the declared options: ${list(values.map(fmt))}`)
      }
      break
    }
    default:
      // Unreachable from validateDefinition: an unknown `type` was already
      // reported and this switch is only entered for vocabulary members.
      // Deliberately silent rather than guessing a shape for a type we refuse.
      break
  }

  // Numeric bounds. A value outside its declared range renders out of range and
  // then snaps the moment a user opens the Style tab — a real bug that only ever
  // shows up in production.
  if ((type === 'int' || type === 'float') && isFiniteNumber(d)) {
    if (isFiniteNumber(input.min) && d < input.min) {
      errors.push(`${path}: ${fmt(d)} is below the declared min ${fmt(input.min)}`)
    }
    if (isFiniteNumber(input.max) && d > input.max) {
      errors.push(`${path}: ${fmt(d)} is above the declared max ${fmt(input.max)}`)
    }
  }
}

/** An input's `default` is just a value, checked by the shared rules above —
 *  plus the one rule that is only about the DEFAULT: it has to exist. */
function validateInputDefault(input, path, errors) {
  if (!Object.prototype.hasOwnProperty.call(input, 'default')) {
    errors.push(
      `${path}.default: required — every input needs a default (it is the value the ` +
      `engine computes with before the user touches anything, and the target of $${input.key || '<key>'} substitution)`,
    )
    return
  }
  validateInputValue(input, input.default, `${path}.default`, errors)
}

function validateInput(input, index, seenKeys, errors, runtimeDoc = false) {
  const path = `inputs[${index}]`
  if (!isPlainObject(input)) {
    errors.push(`${path}: expected an object, got ${fmt(input)}`)
    return
  }

  // key
  if (!isNonEmptyString(input.key)) {
    errors.push(`${path}.key: required non-empty string, got ${fmt(input.key)}`)
  } else if (!KEY_RE.test(input.key)) {
    errors.push(
      `${path}.key: ${fmt(input.key)} is not a legal input key — must match ${KEY_RE} ` +
      `so that "$${input.key}" stays an unambiguous substitution reference`,
    )
  } else if (seenKeys.has(input.key)) {
    errors.push(
      `${path}.key: duplicate input key ${fmt(input.key)} (first declared at inputs[${seenKeys.get(input.key)}]) — ` +
      `"$${input.key}" would be ambiguous`,
    )
  } else {
    seenKeys.set(input.key, index)
  }

  // type — THE FAIL-CLOSED GATE. No fallback branch. Ever.
  // ⭐ PHASE 3 WS-D — a runtime document may also declare `RUNTIME_INPUT_TYPES`.
  const typeOk = checkVocabulary(
    input.type,
    runtimeDoc ? [...INPUT_TYPES, ...RUNTIME_INPUT_TYPES] : INPUT_TYPES,
    runtimeDoc ? RESERVED_INPUT_TYPES.filter((t) => !RUNTIME_INPUT_TYPES.includes(t)) : RESERVED_INPUT_TYPES,
    `${path}.type`, 'input type', errors,
  )

  // default (only meaningful once the type is one we understand)
  if (typeOk) validateInputDefault(input, path, errors)

  // numeric modifiers
  for (const k of ['min', 'max', 'step']) {
    if (input[k] !== undefined && !isFiniteNumber(input[k])) {
      errors.push(`${path}.${k}: expected a finite number, got ${fmt(input[k])}`)
    }
  }
  if (isFiniteNumber(input.min) && isFiniteNumber(input.max) && input.min > input.max) {
    errors.push(`${path}: min must be <= max, got min=${fmt(input.min)} max=${fmt(input.max)}`)
  }
  if (isFiniteNumber(input.step) && input.step <= 0) {
    errors.push(`${path}.step: must be > 0, got ${fmt(input.step)}`)
  }

  // presentation modifiers (spec §3.1: group/inline/tooltip/activeWhen ship v1)
  for (const k of ['label', 'group', 'inline', 'tooltip', 'disabled']) {
    if (input[k] !== undefined && typeof input[k] !== 'string') {
      errors.push(`${path}.${k}: expected a string, got ${fmt(input[k])}`)
    }
  }

  validateTextModifiers(input, path, errors)
}

// ─── the text control's modifiers (UCT RS Phase 3, unit 3-02) ───────────────
//
// ⭐ A `string` input may declare how its text box behaves:
//   - `pattern`: an ANCHORED regex source (`^…$`), checked on every non-empty value
//     (`validateInputValue`) — the server row carries the same source (3-05), so
//     both lanes refuse the same text;
//   - `maxLength`: a whole number 1-64, on every non-empty value;
//   - `case: 'upper'`: the control upper-cases what the member types (a value
//     rule only through `pattern`; the schema does not rewrite a stored value);
//   - `placeholder`: the box's empty-state text, up to 64 characters;
//   - `hint`: the muted line shown under the box when a typed value is refused,
//     up to 120 characters (the control says "Not a valid value" without one);
//   - `optionsSource` (2026-11-12): the name of a server-owned list of choices
//     (`optionsSources.OPTIONS_SOURCES`, e.g. `rsThemes`). The box becomes a
//     searchable chooser on every surface and STORES the chosen entry's value (a
//     stable ID). A name the table does not list is refused: a definition never
//     points a chart at an endpoint of its own choosing.
// ⛔ Only a `string` input takes them: on a number or an enum they would be read
// by nothing, which is a typo, so they are refused by name.
export const TEXT_INPUT_MAX_LENGTH = 64
const TEXT_MODIFIERS = ['pattern', 'maxLength', 'case', 'placeholder', 'hint', 'optionsSource']
const _patternCache = new Map()

/** A declared `pattern` → its RegExp, or null for one that is not an anchored,
 *  compilable source. Memoised: the control asks on every keystroke. */
export function stringPatternRegExp(source) {
  if (typeof source !== 'string') return null
  if (_patternCache.has(source)) return _patternCache.get(source)
  let re = null
  const anchored = source.length >= 2 && source.startsWith('^') && source.endsWith('$') && !source.endsWith(String.raw`\$`)
  if (anchored) {
    try { re = new RegExp(source) } catch { re = null }
  }
  _patternCache.set(source, re)
  return re
}

function validateTextModifiers(input, path, errors) {
  const declared = TEXT_MODIFIERS.filter((k) => input[k] !== undefined)
  if (!declared.length) return
  if (input.type !== 'string') {
    for (const k of declared) {
      errors.push(`${path}.${k}: only a "string" input takes ${k}, and this one is ${fmt(input.type)} — nothing would read it`)
    }
    return
  }
  if (input.pattern !== undefined) {
    if (typeof input.pattern !== 'string' || !input.pattern) {
      errors.push(`${path}.pattern: expected a regex source string, got ${fmt(input.pattern)}`)
    } else if (!stringPatternRegExp(input.pattern)) {
      errors.push(`${path}.pattern: ${fmt(input.pattern)} must be an anchored regex (starting "^", ending "$") that compiles`)
    }
  }
  if (input.maxLength !== undefined
      && (!Number.isInteger(input.maxLength) || input.maxLength < 1 || input.maxLength > TEXT_INPUT_MAX_LENGTH)) {
    errors.push(`${path}.maxLength: expected a whole number from 1 to ${TEXT_INPUT_MAX_LENGTH}, got ${fmt(input.maxLength)}`)
  }
  if (input.case !== undefined && input.case !== 'upper') {
    errors.push(`${path}.case: the one case a text box applies is "upper", got ${fmt(input.case)}`)
  }
  if (input.optionsSource !== undefined && !isOptionsSource(input.optionsSource)) {
    errors.push(`${path}.optionsSource: ${fmt(input.optionsSource)} is not a known list (known: ${list(Object.keys(OPTIONS_SOURCES))})`)
  }
  for (const [k, max] of [['placeholder', 64], ['hint', 120]]) {
    if (input[k] === undefined) continue
    if (typeof input[k] !== 'string') errors.push(`${path}.${k}: expected a string, got ${fmt(input[k])}`)
    else if (input[k].length > max) errors.push(`${path}.${k}: at most ${max} characters, got ${input[k].length}`)
  }
}

// ─── server-gated controls and legacy inputs (UCT RS Phase 3, unit 3-01) ────
//
// ⭐⭐ `requiresServer: true` — on an input, on an enum OPTION, or on a
// `meta.presets[]` entry — means "hide this until the live server row declares
// it" (`serverCompute.serverDeclares`, read by `indicatorRegistry`). It lets a
// control merge ahead of the server half that answers it and stay dark. An enum
// option carries it as a third element, `['CUSTOM', 'Your symbol',
// {requiresServer: true}]`, or as a key of the object form `{value, label,
// requiresServer: true}`.
//
// ⭐ `legacy: true` on an input means "still declared, never rendered": a stored
// instance that carries the key still validates (`instances.js` REFUSES an
// undeclared key, so retiring an input any other way breaks saved layouts), and
// no settings surface draws a control for it.
//
// ⛔ BOTH FAIL CLOSED. Each is `true` or absent; `false`, `'yes'` or `1` is a
// typo that would gate (or un-gate) nothing, so it is refused by name. And the
// combinations that could only ever hide a control forever are refused too:
//   - a gate on a definition the server does not compute (no row will declare it);
//   - a gate on an input the definition never sends (`meta.serverInputs`), since
//     the row declares only what it receives;
//   - an enum whose DEFAULT is a gated option (the select would show a value it
//     does not list until the server answered);
//   - a gated legacy input (it is never rendered, so the gate decides nothing).

/** Is this enum option entry marked `requiresServer`? The ONE reader of the
 *  marker's two spellings; `indicatorRegistry` imports it. */
export function enumOptionRequiresServer(option) {
  if (Array.isArray(option)) return isPlainObject(option[2]) && option[2].requiresServer === true
  return isPlainObject(option) && option.requiresServer === true
}

function validateServerGates(def, inputs, errors) {
  const serverDoc = isPlainObject(def.compute) && def.compute.kind === 'server'
  const sent = isPlainObject(def.meta) && Array.isArray(def.meta.serverInputs) ? def.meta.serverInputs : null
  const kindNote = `compute.kind is ${fmt(isPlainObject(def.compute) ? def.compute.kind : undefined)}, ` +
    `and only a "server" definition has a live row to declare it, so it could never appear`
  inputs.forEach((input, index) => {
    if (!isPlainObject(input)) return
    const path = `inputs[${index}]`
    for (const k of ['requiresServer', 'legacy']) {
      if (input[k] !== undefined && input[k] !== true) {
        errors.push(`${path}.${k}: expected true or absent, got ${fmt(input[k])}`)
      }
    }
    const gated = input.requiresServer === true
    if (gated && input.legacy === true) {
      errors.push(`${path}: a legacy input is never rendered, so requiresServer on it gates nothing — drop one`)
    }
    let gatedOptions = false
    if (input.type === 'enum' && Array.isArray(input.options)) {
      input.options.forEach((option, j) => {
        const at = `${path}.options[${j}]`
        if (Array.isArray(option)) {
          if (option.length > 3) {
            errors.push(`${at}: an option pair is [value, label] or [value, label, {requiresServer: true}], got ${option.length} entries`)
          } else if (option.length === 3) {
            const extra = option[2]
            if (!isPlainObject(extra) || Object.keys(extra).length !== 1 || extra.requiresServer !== true) {
              errors.push(`${at}[2]: expected {requiresServer: true}, got ${fmt(extra)}`)
            }
          }
        } else if (isPlainObject(option) && option.requiresServer !== undefined && option.requiresServer !== true) {
          errors.push(`${at}.requiresServer: expected true or absent, got ${fmt(option.requiresServer)}`)
        }
        if (enumOptionRequiresServer(option)) {
          gatedOptions = true
          if (Object.prototype.hasOwnProperty.call(input, 'default') && enumOptionValue(option) === input.default) {
            errors.push(
              `${at}: the default ${fmt(input.default)} is a requiresServer option — until the server ` +
              `declares it the control would show a value it does not list. Default to an ungated option.`,
            )
          }
        }
      })
    }
    if (!gated && !gatedOptions) return
    const what = gated ? `${path}.requiresServer` : `${path}.options`
    if (!serverDoc) {
      errors.push(`${what}: ${kindNote}`)
    } else if (sent && isNonEmptyString(input.key) && !sent.includes(input.key)) {
      errors.push(
        `${what}: ${fmt(input.key)} is not in meta.serverInputs, so it is never sent and the ` +
        `server row can never declare it — the control would stay hidden forever`,
      )
    }
  })
  // ⭐ UCT RS 3-14 — `plots[].requiresServer: true`: a column only the gated row
  // sends; the inspector offers no Plot style for it until the live row declares
  // every gated input (`indicatorRegistry.isPlotHidden`). On a definition with no
  // gated input it could never appear, so that is refused like the rest.
  const anyGatedInput = inputs.some((i) => isPlainObject(i) && i.requiresServer === true)
  ;(Array.isArray(def.plots) ? def.plots : []).forEach((plot, i) => {
    if (!isPlainObject(plot) || plot.requiresServer === undefined) return
    const at = `plots[${i}].requiresServer`
    if (plot.requiresServer !== true) errors.push(`${at}: expected true or absent, got ${fmt(plot.requiresServer)}`)
    else if (!serverDoc) errors.push(`${at}: ${kindNote}`)
    else if (!anyGatedInput) {
      errors.push(`${at}: the definition declares no requiresServer input, so the live row can never arm it and the plot's style row would stay hidden forever`)
    }
  })
  const presets = isPlainObject(def.meta) && Array.isArray(def.meta.presets) ? def.meta.presets : []
  presets.forEach((p, i) => {
    if (!isPlainObject(p) || p.requiresServer === undefined) return
    if (p.requiresServer !== true) {
      errors.push(`meta.presets[${i}].requiresServer: expected true or absent, got ${fmt(p.requiresServer)}`)
    } else if (!serverDoc) {
      errors.push(`meta.presets[${i}].requiresServer: ${kindNote}`)
    }
  })
}

// ─── a legacy input read as its successor (UCT RS Phase 3, unit 3-08b) ─────
//
// ⭐ `mapsTo: {when, key, value}` on a `legacy: true` input: an instance that
// STORED the legacy key with the value `when`, and stored nothing under `key`,
// is read as `key: value` (`legacyInputs.inputsAsRead`, read-time only — the
// stored instance is never rewritten). A stored successor always wins.
//
// ⛔ FAIL CLOSED, because a wrong mapping silently redraws saved layouts:
//   - only on a legacy input (a live control already says what it means);
//   - exactly the three fields; `key` a declared input, not itself, not legacy;
//   - `when` a legal value of the legacy input and NOT its default (a stored
//     default is not a choice that has a successor);
//   - `value` a legal value of the successor and NOT its default (that maps
//     nothing: the absent successor already reads as its default);
//   - one mapping per successor (two would race on declaration order).
export const LEGACY_MAPS_TO_FIELDS = Object.freeze(['when', 'key', 'value'])

function validateLegacyMaps(inputs, inputsByKey, errors) {
  const targets = new Map()
  inputs.forEach((input, index) => {
    if (!isPlainObject(input) || input.mapsTo === undefined) return
    const path = `inputs[${index}].mapsTo`
    const m = input.mapsTo
    if (input.legacy !== true) {
      errors.push(`${path}: only a legacy input maps onto a successor — declare legacy: true or drop mapsTo`)
      return
    }
    if (!isPlainObject(m)) {
      errors.push(`${path}: expected {when, key, value}, got ${fmt(m)}`)
      return
    }
    const keys = Object.keys(m)
    const extra = keys.filter((k) => !LEGACY_MAPS_TO_FIELDS.includes(k))
    const missing = LEGACY_MAPS_TO_FIELDS.filter((k) => !Object.prototype.hasOwnProperty.call(m, k))
    if (extra.length || missing.length) {
      errors.push(`${path}: expected exactly {when, key, value}` +
        `${missing.length ? `, missing ${list(missing)}` : ''}${extra.length ? `, unknown ${list(extra)}` : ''}`)
      return
    }
    const target = typeof m.key === 'string' ? inputsByKey.get(m.key) : undefined
    if (!target) {
      errors.push(`${path}.key: ${fmt(m.key)} names no declared input (declared input keys: ${list([...inputsByKey.keys()]) || 'none'})`)
      return
    }
    if (m.key === input.key) {
      errors.push(`${path}.key: ${fmt(m.key)} is the legacy input itself`)
      return
    }
    if (target.legacy === true) {
      errors.push(`${path}.key: ${fmt(m.key)} is itself legacy — map onto the input that replaced it`)
      return
    }
    const whenErrors = []
    validateInputValue(input, m.when, `${path}.when`, whenErrors)
    errors.push(...whenErrors)
    if (!whenErrors.length && Object.prototype.hasOwnProperty.call(input, 'default') && m.when === input.default) {
      errors.push(`${path}.when: ${fmt(m.when)} is ${fmt(input.key)}'s default — a stored default is not a choice with a successor`)
    }
    const valueErrors = []
    validateInputValue(target, m.value, `${path}.value`, valueErrors)
    errors.push(...valueErrors)
    if (!valueErrors.length && Object.prototype.hasOwnProperty.call(target, 'default') && m.value === target.default) {
      errors.push(`${path}.value: ${fmt(m.value)} is ${fmt(m.key)}'s default — the mapping would change nothing`)
    }
    if (targets.has(m.key)) {
      errors.push(`${path}.key: ${fmt(m.key)} is already the successor of inputs[${targets.get(m.key)}] — one mapping per successor`)
    } else {
      targets.set(m.key, index)
    }
  })
}

// ─── a text box that names an enum option (UCT RS Phase 3, unit 3-09b) ──────
//
// ⭐ `identityFor: '<enum key>'` on a `string` input: this box is what one of
// that enum's options MEANS. The option is the one its `activeWhen` wakes it
// under (`{key: <enum key>, equals: <option>}`), so the pair is declared once.
// Wherever the enum is printed as identity (`readout.legendIdentityParts`, the
// `meta.legendParams` ` · <value>` grammar) the typed text stands in for the
// option's raw code, and the option's LABEL stands in while the box is empty:
// `UCT RS · SMH`, `UCT RS · Your symbol`, never `UCT RS · CUSTOM`.
//
// ⛔ FAIL CLOSED, because a half-declared pair prints the raw code it exists
// to hide:
//   - only on a `string` input that is not legacy (a legacy box is never typed);
//   - the key names another declared `enum` input that `meta.legendParams`
//     lists (nothing else prints it as identity, so the field would be inert);
//   - the box declares `activeWhen: {key: <that enum>, equals: <option>}`, the
//     option carries a non-empty label (the empty-box text);
//   - one companion per option (two would race on declaration order).
function enumOptionLabel(option) {
  if (Array.isArray(option)) return typeof option[1] === 'string' ? option[1] : null
  if (isPlainObject(option) && typeof option.label === 'string') return option.label
  return null
}

/**
 * ⭐ THE ONE READER OF THE PAIR (unit 3-14). The text an identity value prints:
 * for an `enum` input whose option `raw` has a companion text box (a `string`
 * input declaring `identityFor: <that key>` and `activeWhen: {key, equals: raw}`),
 * the box's typed value, or the option's LABEL while the box is empty; every
 * other value comes back unchanged. Read by `readout` (the chip and the pane
 * suffix) and by `sourceRef.instanceLabel` (the settings list, the Display-in
 * menu), so no surface prints the code `CUSTOM` for "Your symbol".
 */
export function identityTextFor(def, key, raw, inputs) {
  if (typeof raw !== 'string' || !raw || !def || !Array.isArray(def.inputs)) return raw
  const inp = def.inputs.find((i) => i && i.key === key)
  if (!inp || inp.type !== 'enum') return raw
  const companion = def.inputs.find((c) => c && c.identityFor === key && IDENTITY_COMPANION_TYPES.has(c.type)
    && c.activeWhen && typeof c.activeWhen === 'object' && c.activeWhen.key === key && c.activeWhen.equals === raw)
  if (!companion) return raw
  const typed = (inputs && inputs[companion.key] !== undefined) ? inputs[companion.key] : companion.default
  if (typeof typed === 'string' && typed.trim()) {
    // 2026-11-12: a chooser's stored value is an ID; it prints as its label (the
    // loaded list's, else the ID read as words), never as `semiconductor_equipment`.
    if (companion.optionsSource) {
      return optionLabelFor(companion.optionsSource, typed.trim()) || humanizeOptionValue(typed)
    }
    return typed.trim()
  }
  for (const o of (Array.isArray(inp.options) ? inp.options : [])) {
    if (Array.isArray(o) && o[0] === raw) return typeof o[1] === 'string' && o[1] ? o[1] : raw
    if (o && typeof o === 'object' && !Array.isArray(o) && o.value === raw) return typeof o.label === 'string' && o.label ? o.label : raw
  }
  return raw
}

/** The input types that may stand in for an enum option (3-09b: a text box;
 *  2026-11-12: also a second enum, e.g. the RS "Pick a sector" ETF list, whose
 *  stored value is the name printed). */
const IDENTITY_COMPANION_TYPES = new Set(['string', 'enum'])

function validateIdentityFor(def, inputs, inputsByKey, errors) {
  const params = isPlainObject(def.meta) && Array.isArray(def.meta.legendParams) ? def.meta.legendParams : []
  const seen = new Map()
  inputs.forEach((input, index) => {
    if (!isPlainObject(input) || input.identityFor === undefined) return
    const path = `inputs[${index}].identityFor`
    const k = input.identityFor
    if (!isNonEmptyString(k)) {
      errors.push(`${path}: expected the key of the enum input this box names an option of, got ${fmt(k)}`)
      return
    }
    if (!IDENTITY_COMPANION_TYPES.has(input.type)) {
      errors.push(`${path}: only a "string" or "enum" input stands in for an option, and this one is ${fmt(input.type)}`)
      return
    }
    if (input.legacy === true) {
      errors.push(`${path}: a legacy input is never rendered, so nobody types the name it would print — drop one`)
      return
    }
    if (k === input.key) {
      errors.push(`${path}: ${fmt(k)} is the input itself`)
      return
    }
    const target = inputsByKey.get(k)
    if (!target) {
      errors.push(`${path}: ${fmt(k)} names no declared input (declared input keys: ${list([...inputsByKey.keys()]) || 'none'})`)
      return
    }
    if (target.type !== 'enum' || !Array.isArray(target.options)) {
      errors.push(`${path}: ${fmt(k)} is ${fmt(target.type)}, and only an enum's option has a name to stand in for`)
      return
    }
    if (!params.includes(k)) {
      errors.push(`${path}: ${fmt(k)} is not a meta.legendParams entry, so no label prints it and the field reads nothing`)
      return
    }
    const aw = input.activeWhen
    if (!isPlainObject(aw) || aw.key !== k || !Object.prototype.hasOwnProperty.call(aw, 'equals')) {
      errors.push(`${path}: the box must declare activeWhen {key: ${fmt(k)}, equals: <option>} — that names the option it stands in for`)
      return
    }
    const option = target.options.find((o) => enumOptionValue(o) === aw.equals)
    // An `equals` no option carries is already refused by `validateActiveWhen`.
    if (option === undefined) return
    const label = enumOptionLabel(option)
    if (!isNonEmptyString(label)) {
      errors.push(`${path}: the option ${fmt(aw.equals)} carries no label, so an empty box would print the raw code`)
      return
    }
    const slot = `${k}=${JSON.stringify(aw.equals)}`
    if (seen.has(slot)) {
      errors.push(`${path}: the option ${fmt(aw.equals)} of ${fmt(k)} already has a companion at inputs[${seen.get(slot)}] — one per option`)
      return
    }
    seen.set(slot, index)
  })
}

/** `activeWhen` is the JSON-expressible successor to `indicatorRegistry`'s
 *  `showIf` predicate (a function cannot survive a definition round-trip). The
 *  operator grammar is NOT locked in v1, so this checks only the part that is
 *  checkable and dangerous: a condition keyed on an input that does not exist
 *  would silently evaluate to "never show", hiding a control forever. Same class
 *  as an unresolvable $ref, so it gets the same treatment. */
/**
 * ⭐ UCT RS 3-07 — an `activeWhen` keyed on an ENUM input compares against that
 * input's OPTION VALUES, so a value no option carries is a condition that can
 * never (`equals`, `in`) or always (`notEquals`) hold: the same "hides a control
 * forever" class as an unresolvable key, and refused the same way. `null` when
 * sound or not checkable (a non-enum referent, or an operator this does not
 * compare, `gt`/`lt`, keep their v1 latitude).
 */
function activeWhenEnumFault(aw, inputsByKey) {
  const input = inputsByKey.get(aw.key)
  if (!input || input.type !== 'enum' || !Array.isArray(input.options)) return null
  const values = input.options.map(enumOptionValue)
  const known = (v) => values.includes(v)
  for (const op of ['equals', 'notEquals']) {
    if (Object.prototype.hasOwnProperty.call(aw, op) && !known(aw[op])) {
      return `.${op}: ${fmt(aw[op])} is not one of ${fmt(aw.key)}'s option values: ${list(values.map(fmt))}`
    }
  }
  if (Object.prototype.hasOwnProperty.call(aw, 'in')) {
    if (!Array.isArray(aw.in)) return `.in: expected an array of ${fmt(aw.key)}'s option values, got ${fmt(aw.in)}`
    const bad = aw.in.filter((v) => !known(v))
    if (bad.length) return `.in: ${list(bad.map(fmt))} ${bad.length === 1 ? 'is' : 'are'} not among ${fmt(aw.key)}'s option values: ${list(values.map(fmt))}`
  }
  return null
}

function validateActiveWhen(input, index, inputsByKey, errors) {
  const aw = input?.activeWhen
  if (aw === undefined || aw === null) return
  const path = `inputs[${index}].activeWhen`
  if (!isPlainObject(aw)) {
    errors.push(`${path}: expected an object describing the condition, got ${fmt(aw)}`)
    return
  }
  if (typeof aw.key !== 'string') return   // a future shape we do not yet parse — left alone
  if (!inputsByKey.has(aw.key)) {
    errors.push(
      `${path}.key: unresolvable reference ${fmt(aw.key)} — no input declares that key ` +
      `(declared input keys: ${list([...inputsByKey.keys()]) || 'none'})`,
    )
  } else if (aw.key === input.key) {
    errors.push(`${path}.key: ${fmt(aw.key)} refers to its own input — the condition can never be evaluated`)
  } else {
    const fault = activeWhenEnumFault(aw, inputsByKey)
    if (fault) errors.push(`${path}${fault}`)
  }
}

function validatePlot(plot, index, seenKeys, inputsByKey, errors, presentationKey) {
  const path = `plots[${index}]`
  if (!isPlainObject(plot)) {
    errors.push(`${path}: expected an object, got ${fmt(plot)}`)
    return
  }

  // key — the PUBLIC HANDLE. Addressed as `defId.plotKey`, referenced by a
  // `source` input, and it names the compute column, so duplicates are fatal:
  // two plots would fight over one Float64Array.
  if (!isNonEmptyString(plot.key)) {
    errors.push(`${path}.key: required non-empty string, got ${fmt(plot.key)}`)
  } else if (!KEY_RE.test(plot.key)) {
    errors.push(
      `${path}.key: ${fmt(plot.key)} is not a legal plot key — must match ${KEY_RE} ` +
      `so "defId.${plot.key}" addressing stays unambiguous`,
    )
  } else if (seenKeys.has(plot.key)) {
    errors.push(
      `${path}.key: duplicate plot key ${fmt(plot.key)} (first declared at plots[${seenKeys.get(plot.key)}]) — ` +
      `plot keys are the public handles and must be unique`,
    )
  } else {
    seenKeys.set(plot.key, index)
  }

  // style — THE OTHER FAIL-CLOSED GATE. No fallback branch. Ever.
  const styleOk = checkVocabulary(
    plot.style, PLOT_STYLES, RESERVED_PLOT_STYLES, `${path}.style`, 'plot style', errors,
  )

  // ⭐ C3A — the glyph an event column draws. Checked here, beside the style it
  // depends on, so a marker and the style that permits it are ONE refusal rather
  // than two a member meets on separate save attempts.
  validateMarker(plot, path, errors)

  // ⭐ 2026-09-26 — `plots[].displace`: WHERE A VALUE IS DRAWN, never what it IS.
  // Pine's `plot(x, offset = -N)` draws bar i's value at bar i - N. The binder
  // applies it at draw time; the column (scan, alerts, `source` references) keeps
  // the value on the bar that computed it.
  // ⛔ NEGATIVE ONLY. A rightward displacement is an exact identity with a bar offset
  // in the TREE (`x[N]`), which is where the translator puts it; a positive value
  // here would shift a column that has already been shifted.
  if (plot.displace !== undefined
      && !(Number.isInteger(plot.displace) && plot.displace < 0)) {
    errors.push(
      `${path}.displace: expected a negative whole number of bars (a leftward displacement), got ` +
      `${fmt(plot.displace)}. A rightward displacement belongs in the tree as a bar offset ` +
      `(\`x[N]\`), never here — carrying it on the plot too would draw it twice as far.`,
    )
  }
  // ⭐ rsLine rev 5 (2026-11-08) — `plots[].autoscaleInclude: {min, max}`: a range the
  // plot's own autoscale always WIDENS to include while the plot has data on screen
  // (guides at fixed levels stay in view: the RS Rating's 80 and 90). It never
  // clips, and a plot with no data in view contributes nothing, so a series the
  // server blanks under another reading cannot reframe that reading's scale.
  if (plot.autoscaleInclude !== undefined) {
    const r = plot.autoscaleInclude
    if (!(isPlainObject(r) && Number.isFinite(r.min) && Number.isFinite(r.max) && r.min < r.max
          && Object.keys(r).every((k) => k === 'min' || k === 'max'))) {
      errors.push(`${path}.autoscaleInclude: expected {min, max} with finite min < max, got ${fmt(r)}`)
    }
  }
  // `plots[].displaceFrom` — the displacement's relation to ONE declared parameter,
  // `scale * value + add`, so a parameter edit moves the drawing with the maths.
  if (plot.displaceFrom !== undefined) {
    const f = plot.displaceFrom
    const ok = isPlainObject(f) && isNonEmptyString(f.param)
      && (f.scale === 1 || f.scale === -1) && Number.isInteger(f.add)
    if (!ok) {
      errors.push(
        `${path}.displaceFrom: expected {param: <parameter id>, scale: 1 | -1, add: <whole number>}, ` +
        `got ${fmt(f)}`,
      )
    }
  }

  // ─ substitutable fields (spec §3.1: color, width, levels; `lineStyle`,
  //   `colorUp` and `colorDown` are substituted further down, beside the
  //   vocabulary and the colour modes they belong to) ─

  if (plot.color !== undefined) {
    const colorRef = refKeyOf(plot.color)
    const color = substitute(plot.color, inputsByKey, `${path}.color`, errors, 'color')
    if (color !== REF_FAILED) {
      noteRef(plot, 'color', colorRef)
      if (!isNonEmptyString(color)) {
        errors.push(
          `${path}.color: expected a non-empty colour string (a "token:<role>" ref or a raw CSS ` +
          `colour)${plot.color !== color ? ` after substituting ${fmt(plot.color)}` : ''}, got ${fmt(color)}`,
        )
      }
      plot.color = color
    }
  }

  if (plot.width !== undefined) {
    const widthRef = refKeyOf(plot.width)
    const width = substitute(plot.width, inputsByKey, `${path}.width`, errors, 'width')
    if (width !== REF_FAILED) {
      noteRef(plot, 'width', widthRef)
      if (!isFiniteNumber(width) || width <= 0) {
        errors.push(
          `${path}.width: expected a finite number > 0` +
          `${plot.width !== width ? ` after substituting ${fmt(plot.width)}` : ''}, got ${fmt(width)}`,
        )
      }
      // ⭐ ABOVE THE CEILING IS DRAWN AT THE CEILING, NEVER REFUSED. No UCT door
      // produces one (`builderInputs.pineLineWidth` clamps; the server refuses a save
      // that introduces one and clamps a copy), so only a stored row predating the
      // ceiling, or a hand-crafted one, reaches here — and refusing it would stop a
      // member's indicator drawing at all. Same width the server's copy clamp stores
      // (`presentation_schema.clamp_plot_widths`), held by `line_width_cap.json`.
      plot.width = isFiniteNumber(width) && width > LINE_WIDTH_HARD_MAX ? LINE_WIDTH_HARD_MAX : width
    }
  }

  if (plot.levels !== undefined) {
    // Two substitution shapes are attempted: the WHOLE array from one input
    // (`levels: "$bands"`), or per-element (`levels: ["$hi", 50, "$lo"]`).
    //
    // PER-ELEMENT IS THE ONLY REACHABLE FORM IN v1, and that is worth stating:
    // no v1 input type produces an array default (int/float → number, bool →
    // boolean, enum → a scalar option, string/color/source → string), so
    // `levels: "$bands"` cannot resolve to an array until a list-shaped input
    // type ships. The whole-value branch is kept anyway because it turns that
    // dead end into a precise error ("expected an array after substituting
    // "$bands", got 14") instead of a shrug.
    const levels = substitute(plot.levels, inputsByKey, `${path}.levels`, errors, 'levels')
    if (levels !== REF_FAILED) {
      if (!Array.isArray(levels)) {
        errors.push(
          `${path}.levels: expected an array of numbers` +
          `${plot.levels !== levels ? ` after substituting ${fmt(plot.levels)}` : ''}, got ${fmt(levels)}`,
        )
      } else {
        const levelRefs = levels.map(refKeyOf)
        if (levelRefs.some(Boolean)) noteRef(plot, 'levels', levelRefs)
        const resolved = levels.map((lvl, i) => {
          const v = substitute(lvl, inputsByKey, `${path}.levels[${i}]`, errors, null)
          if (v === REF_FAILED) return lvl
          if (!isFiniteNumber(v)) {
            errors.push(
              `${path}.levels[${i}]: expected a finite number` +
              `${lvl !== v ? ` after substituting ${fmt(lvl)}` : ''}, got ${fmt(v)}`,
            )
          }
          return v
        })
        plot.levels = resolved
      }
    }
  }

  // An `hlines` plot with nothing to draw is a plot key that produces no line —
  // it registers, renders nothing, and the author never learns why.
  if (styleOk && plot.style === 'hlines' && !(Array.isArray(plot.levels) && plot.levels.length > 0)) {
    errors.push(`${path}.levels: style "hlines" requires a non-empty levels array, got ${fmt(plot.levels)}`)
  }

  // ─ the two colours `colorMode: 'sign'` and `'column:<key>'` need ─
  //
  // SUBSTITUTABLE since 2026-11-05 (`SUBSTITUTABLE_PLOT_FIELDS` names them; spec
  // §3.1 carries the same sentence) and validated exactly like `color`
  // otherwise. `validateColorModes` is what makes them REQUIRED under `'sign'`
  // and `'column:'`; the loop below is what stops `colorUp: 3` registering.
  // ⚰️ This said "NOT substitutable … the spec locks at color/width/levels"
  // — true until UCT RS's Phase preset needed a member-pickable pair.
  // ⭐ An N-way palette: two or more colours, each validated like `color`.
  if (plot.colorPalette !== undefined) {
    const pal = plot.colorPalette
    if (!Array.isArray(pal) || pal.length < 2 || !pal.every(isNonEmptyString)) {
      errors.push(`${path}.colorPalette: expected an array of two or more colour strings, got ${fmt(pal)}`)
    } else if (typeof plot.colorMode !== 'string' || !plot.colorMode.startsWith('column:')) {
      errors.push(`${path}.colorPalette: a palette is read through a column, so colorMode must be "column:<key>", got ${fmt(plot.colorMode)}`)
    }
  }
  // ⭐⭐ C37 — A GRADIENT: two static endpoint colours, and the named column
  // holds each bar's position between them (Pine's `color.from_gradient`, drawn
  // by `pool.columnColorsForPlot` + `binder.pointColour` through the one measured
  // curve, `runtime/colours.js::fromGradient`). `transparency` is the whole
  // number a `color.new(<gradient>, t)` SET on the result — exact, never truncated
  // (a fractional one paints its own alpha byte, as TradingView's does).
  if (plot.colorGradient !== undefined) {
    const g = plot.colorGradient
    const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)
    if (!isPlainObject(g) || !hex(g.from) || !hex(g.to)) {
      errors.push(`${path}.colorGradient: expected {from, to} as "#RRGGBB" or "#RRGGBBAA" colours, got ${fmt(g)}`)
    } else if (g.transparency !== undefined
      && !(isFiniteNumber(g.transparency) && g.transparency >= 0 && g.transparency <= 100)) {
      errors.push(`${path}.colorGradient.transparency: expected a number 0-100, got ${fmt(g.transparency)}`)
    } else if (typeof plot.colorMode !== 'string' || !plot.colorMode.startsWith('column:')) {
      errors.push(`${path}.colorGradient: a gradient is read through a column, so colorMode must be "column:<key>", got ${fmt(plot.colorMode)}`)
    }
  }
  // ⭐⭐ RT6 — A COLOUR THE RUNTIME LANE COMPUTED BAR BY BAR: the named column
  // holds each bar's packed colour (`pool.packedPointColour`), `transparency` the
  // STYLE transparency the call wrote, folded into an opaque colour only.
  if (plot.colorPacked !== undefined) {
    const p = plot.colorPacked
    if (!isPlainObject(p)) {
      errors.push(`${path}.colorPacked: expected an object, got ${fmt(p)}`)
    } else if (p.transparency !== undefined
      && !(Number.isInteger(p.transparency) && p.transparency >= 0 && p.transparency <= 100)) {
      errors.push(`${path}.colorPacked.transparency: expected a whole number 0-100, got ${fmt(p.transparency)}`)
    } else if (typeof plot.colorMode !== 'string' || !plot.colorMode.startsWith('column:')) {
      errors.push(`${path}.colorPacked: a computed colour is read through a column, so colorMode must be "column:<key>", got ${fmt(plot.colorMode)}`)
    }
  }
  // ⭐ Same order as `lineStyle` below: substitute FIRST, then judge the
  // RESOLVED value, so `colorUp: '$lineUpColor'` is checked on the colour it
  // becomes. A ref that fails to resolve is already reported by `substitute`.
  for (const field of ['colorUp', 'colorDown']) {
    if (plot[field] === undefined) continue
    const ref = refKeyOf(plot[field])
    const colour = substitute(plot[field], inputsByKey, `${path}.${field}`, errors, field)
    if (colour === REF_FAILED) continue
    noteRef(plot, field, ref)
    if (!isNonEmptyString(colour)) {
      errors.push(
        `${path}.${field}: expected a non-empty colour string (the colour bars on that side of ` +
        `zero are drawn in)${plot[field] !== colour ? ` after substituting ${fmt(plot[field])}` : ''}, ` +
        `got ${fmt(colour)}`,
      )
    }
    plot[field] = colour
  }

  // ─ enumerated presentation fields ─

  // Substitutable since B3 Task 8 — see SUBSTITUTABLE_PLOT_FIELDS. The order
  // matters: substitute FIRST, then check the RESOLVED value against the
  // vocabulary, so `lineStyle: '$lineStyle'` is judged on what it becomes rather
  // than on the reference string (which is in no vocabulary and would be a
  // guaranteed error). A ref that fails to resolve is already reported by
  // `substitute`; there is nothing left to vet, so the vocabulary check is
  // skipped rather than run on a sentinel.
  if (plot.lineStyle !== undefined) {
    const styleRef = refKeyOf(plot.lineStyle)
    const lineStyle = substitute(plot.lineStyle, inputsByKey, `${path}.lineStyle`, errors, 'lineStyle')
    if (lineStyle !== REF_FAILED) {
      noteRef(plot, 'lineStyle', styleRef)
      checkVocabulary(lineStyle, PLOT_LINE_STYLES, [], `${path}.lineStyle`, 'line style', errors)
      plot.lineStyle = lineStyle
    }
  }
  // `legend` — the crosshair chip this plot contributes. See LEGEND_FIELDS.
  if (plot.legend !== undefined && plot.legend !== null) {
    if (!isPlainObject(plot.legend)) {
      errors.push(`${path}.legend: expected an object, got ${fmt(plot.legend)}`)
    } else {
      for (const key of Object.keys(plot.legend)) {
        if (!LEGEND_FIELDS.includes(key)) {
          errors.push(
            `${path}.legend.${key}: unknown legend field — expected one of: ${list(LEGEND_FIELDS)}. ` +
            `Behavioural fields fail closed (§3.1): a chip nobody renders is worse than a rejected definition.`,
          )
        }
      }
      if (plot.legend.label !== undefined && typeof plot.legend.label !== 'string') {
        errors.push(`${path}.legend.label: expected a string, got ${fmt(plot.legend.label)}`)
      }
      if (plot.legend.decimals !== undefined
          && (!Number.isInteger(plot.legend.decimals) || plot.legend.decimals < 0 || plot.legend.decimals > 10)) {
        errors.push(`${path}.legend.decimals: expected an integer 0..10, got ${fmt(plot.legend.decimals)}`)
      }
      if (plot.legend.hide !== undefined && typeof plot.legend.hide !== 'boolean') {
        errors.push(`${path}.legend.hide: expected true or false, got ${fmt(plot.legend.hide)}`)
      }
      if (plot.legend.showValue !== undefined && typeof plot.legend.showValue !== 'boolean') {
        errors.push(`${path}.legend.showValue: expected true or false, got ${fmt(plot.legend.showValue)}`)
      }

    }
  }
  // ─── the per-plot repaint surface: a WINDOW is declarable, a BADGE is not ───
  //
  // ⭐⭐ THE OWNER'S RULING (decision record §4) IS PER PLOT: `ichimoku` is
  // `non-repainting` on four columns and something else on the fifth, and a
  // per-definition badge "cannot express this without lying in one direction or
  // the other". These two clauses are what makes the ruling expressible, and the
  // asymmetry between them is the entire design.
  //
  // ⛔ `plots[].forward` — HOW FAR AHEAD OF ITS OWN INDEX THIS COLUMN READS, in
  // bars. A FACT about the maths, in the same units and the same three forms
  // `ast/closedTable.json` declares per function (`n >= 0`, or `"unbounded"`).
  // `ast/lint.js` turns it into a badge through `modeFromReach`; it is the only
  // thing a hand-written compute has ever been able to tell that linter, and
  // record §3.1 already writes down what the declaration costs — *"a compute
  // whose real window is wider than its declaration would be branded on the
  // declaration and the linter would be wrong"*.
  //
  // ⛔ `plots[].repaint` — REFUSED, BY NAME, AND THIS IS A HOLE BEING CLOSED
  // RATHER THAN A RULE BEING INVENTED. Phase D Task 15 measured it: a
  // `plots[].repaint` was **accepted and ignored** — preserved by the
  // unknown-KEY policy, read by nothing, and therefore a badge an author could
  // write that no user would ever see and no gate would ever check. That is the
  // `styleOverrides`/`legendParams` shape this phase exists to retire, and on the
  // one field the brand is sold on. A badge is the LINTER'S ANSWER, never an
  // author's claim, so the field a plot may write is the one the linter reads.
  if (plot.forward !== undefined) {
    const fw = plot.forward
    const ok = fw === FORWARD_UNBOUNDED || (Number.isInteger(fw) && fw >= 0)
    if (!ok) {
      errors.push(
        `${path}.forward: expected a non-negative integer (how many bars AHEAD of its own index ` +
        `this column reads) or ${fmt(FORWARD_UNBOUNDED)}, got ${fmt(fw)}. Omit the field for a ` +
        `column whose window nobody has measured — omitting it means "undecided", and 0 means ` +
        `"measured, reads nothing ahead". Those are different claims and the schema will not ` +
        `guess which one an unreadable value meant.`,
      )
    }
  }
  if (Object.prototype.hasOwnProperty.call(plot, 'repaint')) {
    errors.push(
      `${path}.repaint — a plot may not declare a repaint badge. The badge is the linter's ` +
      `MEASUREMENT (docs/decisions/2026-08-06-machine-repaint-linter.md §5), and a field an author ` +
      `fills in by hand is the audited metadata that record exists to replace. Declare ` +
      `${path}.forward — the number of bars ahead of its own index this column reads — and ` +
      `ast/lint.js derives the badge from it.`,
    )
  }
  // ⛔ `plots[].freshness` — REFUSED, BY NAME, THE IDENTICAL CLAUSE ONE FIELD
  // OVER AND FOR THE IDENTICAL REASON. A badge is the linter's MEASUREMENT, and
  // a field an author fills in by hand is the audited metadata this apparatus
  // exists to replace. Phase D Task 15 measured what happens otherwise: a
  // `plots[].repaint` was **accepted and ignored** — preserved by the
  // unknown-KEY policy, read by nothing — so an author could write a claim no
  // user would see and no gate would check. There is no `plots[].forward`
  // analogue here to point at either: `forward` exists because a HAND-WRITTEN
  // compute can tell the linter the one fact it cannot derive, and freshness is
  // derived from the TREE's leaves, which only an `ast` definition has.
  if (Object.prototype.hasOwnProperty.call(plot, 'freshness')) {
    errors.push(
      `${path}.freshness — a plot may not declare a freshness badge. The badge is ` +
      `ast/freshness.js's MEASUREMENT, read off the table-declared scalars the tree names, and a ` +
      `field an author fills in by hand is exactly as false as a hand-set repaint badge. Declare ` +
      `nothing here; \`nativeRegistry.validateAstLane\` requires \`meta.freshness\` on the "ast" ` +
      `lane and refuses a disagreement in both directions.`,
    )
  }
  if (plot.role !== undefined) {
    checkVocabulary(plot.role, PLOT_ROLES, [], `${path}.role`, 'plot role', errors)
  }
  if (plot.label !== undefined && typeof plot.label !== 'string') {
    errors.push(`${path}.label: expected a string, got ${fmt(plot.label)}`)
  }
  if (plot.precision !== undefined && (!Number.isInteger(plot.precision) || plot.precision < 0)) {
    errors.push(`${path}.precision: expected an integer >= 0 (display decimals), got ${fmt(plot.precision)}`)
  }
  // `opacity` names a step in the designTokens ALPHA ramp. It is NOT enumerated
  // here on purpose: duplicating that ramp's key list would create two lists to
  // keep in sync, and this module stays dependency-free. The binder resolves it.
  if (plot.opacity !== undefined
      && !isNonEmptyString(plot.opacity)
      && !(isFiniteNumber(plot.opacity) && plot.opacity >= 0 && plot.opacity <= 1)) {
    errors.push(
      `${path}.opacity: expected an ALPHA ramp step name (e.g. "band", "solid") or a number in [0, 1], got ${fmt(plot.opacity)}`,
    )
  }

  // ─ v2: `fill` (the schema half; the renderer is W6's) and `hidden` ─
  //
  // Shape only, here. WHICH plot `fill.with` may name is a cross-section
  // question (`validateFills`), asked once every plot key is known. `hidden`
  // is a boolean and nothing else: a hidden plot is COMPUTED and never drawn
  // (the binder skips it in pass one; the column still reaches the alert seam
  // and the scan), so a value that is not exactly true/false is not "sort of
  // hidden" — it is refused.
  if (plot.fill !== undefined && (!isPlainObject(plot.fill) || !isNonEmptyString(plot.fill.with))) {
    errors.push(
      `${path}.fill: expected {with: "<plotKey>"} naming the plot this one fills to, got ${fmt(plot.fill)}`,
    )
  }
  // ⭐ 2026-10-01 — `sparse`: this plot is BLANK BY DESIGN on some bars
  // (SuperTrend's up and down halves, each drawn only while its trend holds). A
  // sparse connected line is drawn as one render series per valued run — the
  // `gapRuns` split fundamentals already use — so it BREAKS at a blank instead of
  // being bridged by a straight segment; the binder hands the legend its per-bar
  // answer (`valueAt`), and the legend omits its valueless chip (one chip per
  // instance always kept, so a hidden one can still be shown).
  if (plot.sparse !== undefined && typeof plot.sparse !== 'boolean') {
    errors.push(`${path}.sparse: expected true or false (a plot blank by design on some bars), got ${fmt(plot.sparse)}`)
  }
  if (plot.hidden !== undefined && typeof plot.hidden !== 'boolean') {
    errors.push(
      `${path}.hidden: expected true or false (a hidden plot is COMPUTED and never drawn), got ${fmt(plot.hidden)}`,
    )
  }
  // And never HIDDEN on a guide: an `hlines` plot returns no column, so there is
  // nothing to compute and nothing to hide. Keeping `hidden ⇒ data-bearing`
  // true by construction is what lets the binder's pass-one skip be one line.
  // ⚠️ `=== true`, not "declared": `hidden: false` on a guide claims nothing —
  // it is the default written down — and the sentence below does not describe it.
  if (plot.hidden === true && styleOk && plot.style === 'hlines') {
    errors.push(
      `${path}.hidden: an "hlines" plot is a guide — it returns no column, so there is nothing to ` +
      `compute and nothing to hide; drop the plot instead of hiding it`,
    )
  }
  // ⭐ A6 — `plots[].restyle: false` is the plot's OPT-OUT from the Plot style
  // control: the inspector offers no style row for it. A sparse dot column
  // restyled as a line draws nothing, so a dropdown there would lie. Behavioural
  // (it decides what the inspector offers), so anything but a boolean fails closed;
  // `true` is the default written down.
  if (plot.restyle !== undefined && typeof plot.restyle !== 'boolean') {
    errors.push(
      `${path}.restyle: expected true or false (false = the inspector offers no Plot style for this plot), ` +
      `got ${fmt(plot.restyle)}`,
    )
  }
  // ⭐ UCT RS split, U2 — `plots[].endLabel`: a small tag at the plot's last finite
  // point (`RS 96`, MarketSurge's line-end rating). Declared per plot, drawn by
  // the surface from the host series' own coordinates; fail-closed in `endLabel.js`.
  if (plot.endLabel !== undefined) validateEndLabel(plot.endLabel, `${path}.endLabel`, inputsByKey.keys(), errors)
  validatePlotActiveWhen(plot, path, inputsByKey, errors, presentationKey)
}

/**
 * ⭐ A2 — `plots[].activeWhen`: a guide that draws only under one input state (the
 * RS Mansfield view's zero line, `{key: 'showMansfield', equals: true}`). The SAME
 * grammar as `inputs[].activeWhen` and read by the same evaluator
 * (`indicatorRegistry.evalActiveWhen`), so there is one condition language. It is
 * admitted on an `hlines` guide ONLY: a guide is static, so whether it draws is a
 * presentation fact; a data plot's visibility is the server's (it blanks the
 * column), and a second switch over the same pixels would be a second authority.
 * The key must name a declared input, for the reason `validateActiveWhen` gives.
 */
/**
 * ⭐ UCT RS split, U7 (2026-11-09) — THE ONE EXCEPTION, AND WHY IT IS SOUND. A
 * data plot of a SERVER definition may carry a condition keyed on a PRESENTATION
 * input: one the definition never sends (`meta.serverInputs` does not list it),
 * so the server cannot blank the column for it and the member's own switch is
 * the only authority over those pixels — exactly the `fill.activeWhen` rule
 * (design round, 2026-11-08). The slim RS Line's `rsMa` draws only while
 * `showAverage` holds. A condition keyed on a SERVER input is still refused: the
 * server already blanks that column, and a second switch over it would be a
 * second authority. `presentationKey` is `(key) => boolean`, computed by the
 * caller from the definition; absent, nothing is excepted (the pre-U7 answer).
 */
function validatePlotActiveWhen(plot, path, inputsByKey, errors, presentationKey) {
  const aw = plot.activeWhen
  if (aw === undefined || aw === null) return
  const where = `${path}.activeWhen`
  if (plot.style !== 'hlines') {
    const key = isPlainObject(aw) && typeof aw.key === 'string' ? aw.key : null
    const excepted = !!(key && typeof presentationKey === 'function' && presentationKey(key))
    if (!excepted) {
      errors.push(
        `${where}: only an "hlines" guide carries a condition — a data plot draws what its column holds, ` +
        `and the compute blanks that column when the plot is off (got style ${fmt(plot.style)})`,
      )
      return
    }
  }
  if (!isPlainObject(aw) || typeof aw.key !== 'string') {
    errors.push(`${where}: expected {key, equals} naming a declared input, got ${fmt(aw)}`)
    return
  }
  if (!inputsByKey.has(aw.key)) {
    errors.push(
      `${where}.key: unresolvable reference ${fmt(aw.key)} — no input declares that key ` +
      `(declared input keys: ${list([...inputsByKey.keys()]) || 'none'})`,
    )
  }
  if (!Object.prototype.hasOwnProperty.call(aw, 'equals')) {
    errors.push(`${where}: expected an \`equals\` value — the guide's condition is one input state`)
  } else if (inputsByKey.has(aw.key)) {
    const fault = activeWhenEnumFault(aw, inputsByKey)
    if (fault) errors.push(`${where}${fault}`)
  }
}

/** ⭐⭐ W4-T13 - A CANDLE / BAR ROW NAMES THE COLUMNS IT IS DRAWN FROM.
 *
 *  `candles` / `ohlcBars` on a document row mean "draw open, high, low and close", and the row's
 *  own column is the CLOSE: `ohlc` names the other three (`{open, high, low}`, plot keys of this
 *  document) and `ohlcColors` the colour columns (`{body, wick, border}` for a candle, `{body}`
 *  for a bar; each a plot key whose column holds a packed colour, `na` where the script's colour
 *  is `na`). A candle that named no columns would register happily and draw an empty series, the
 *  failure this schema exists to prevent, so the declaration is REQUIRED, and it is FORBIDDEN on
 *  any other style (two renderers over one row). */
function validateOhlc(plots, columnKeys, errors) {
  plots.forEach((plot, index) => {
    if (!isPlainObject(plot)) return
    const path = `plots[${index}]`
    const isOhlc = OHLC_DEF_STYLES.includes(plot.style)
    if (!isOhlc) {
      for (const f of ['ohlc', 'ohlcColors']) {
        if (plot[f] !== undefined) {
          errors.push(`${path}.${f}: only a "candles" or "ohlcBars" plot names OHLC columns, this one is ${fmt(plot.style)}`)
        }
      }
      return
    }
    const refOk = (v, p) => {
      if (!isNonEmptyString(v)) { errors.push(`${p}: expected a plot key, got ${fmt(v)}`); return }
      if (v === plot.key) { errors.push(`${p}: ${fmt(v)} is this plot's own column (its close); name another`); return }
      if (!columnKeys.has(v)) {
        errors.push(`${p}: ${fmt(v)} references a column no plot declares (available: ${list([...columnKeys]) || 'none'})`)
      }
    }
    if (!isPlainObject(plot.ohlc)) {
      errors.push(`${path}.ohlc: style ${fmt(plot.style)} requires {open, high, low} naming three plot keys, got ${fmt(plot.ohlc)}`)
    } else {
      for (const k of Object.keys(plot.ohlc)) {
        if (!['open', 'high', 'low'].includes(k)) errors.push(`${path}.ohlc.${k}: unknown part (expected open, high, low)`)
      }
      for (const k of ['open', 'high', 'low']) refOk(plot.ohlc[k], `${path}.ohlc.${k}`)
    }
    if (plot.ohlcColors !== undefined) {
      if (!isPlainObject(plot.ohlcColors)) {
        errors.push(`${path}.ohlcColors: expected an object, got ${fmt(plot.ohlcColors)}`)
      } else {
        const parts = OHLC_COLOUR_PARTS[plot.style]
        for (const k of Object.keys(plot.ohlcColors)) {
          if (!parts.includes(k)) errors.push(`${path}.ohlcColors.${k}: unknown part for ${fmt(plot.style)} (expected ${list(parts)})`)
          else refOk(plot.ohlcColors[k], `${path}.ohlcColors.${k}`)
        }
      }
    }
  })
}

/** `colorMode` is checked after ALL plots and events are known because its
 *  parametric form `column:<key>` references a compute column, and columns are
 *  exactly the plot keys plus the event keys (spec §4). */
function validateColorModes(plots, columnKeys, errors) {
  plots.forEach((plot, index) => {
    if (!isPlainObject(plot) || plot.colorMode === undefined) return
    const path = `plots[${index}].colorMode`
    const mode = plot.colorMode
    if (typeof mode !== 'string') {
      errors.push(`${path}: expected a string, got ${fmt(mode)}`)
      return
    }
    // `'sign'` means "colour every point by whether its value is above or below
    // zero", which takes TWO colours the plot has to name. Same rule, and the
    // same reason, as `band` requiring `edges`: without them the mode is
    // unrenderable, so a definition that declares it and stops registers happily
    // and then draws one flat colour — which is precisely the MACD histogram
    // defect this requirement was added to make impossible. `color` is not a
    // substitute: it is the SERIES colour, and a signed plot never uses it.
    if (mode === 'sign') {
      const missing = ['colorUp', 'colorDown'].filter(f => !isNonEmptyString(plot[f]))
      if (missing.length) {
        errors.push(
          `${path}: colour mode "sign" colours each point by the sign of its value, so the plot ` +
          `must declare both colorUp and colorDown — missing ${list(missing)}`,
        )
      }
      return
    }
    if (COLOR_MODES.includes(mode)) return
    if (!mode.startsWith('column:')) {
      errors.push(
        `${path}: unknown colour mode ${fmt(mode)} — expected one of: ${list(COLOR_MODES)}, ` +
        `or "column:<key>" naming a returned column.`,
      )
      return
    }
    // ⭐⭐ C1: NO LONGER INERT. `pool.columnColorsForPlot` + `binder.toPoints`
    // draw this mode per point, colouring by whether the named column is
    // non-zero on that bar. It is how a Pine `color = cond ? a : b` survives
    // import — 49 of the frozen 60 scripts colour from an expression.
    const col = mode.slice('column:'.length)
    if (!columnKeys.has(col)) {
      errors.push(
        `${path}: ${fmt(mode)} references column ${fmt(col)}, which no plot or event declares ` +
        `(available columns: ${list([...columnKeys]) || 'none'})`,
      )
      return
    }
    // ⛔ THE SAME TWO COLOURS, FOR THE SAME REASON AS `sign`. A per-point mode
    // with nothing to alternate between registers happily and then draws one
    // flat colour — which is the exact "declared it and stopped" defect the
    // `sign` branch above exists to make impossible. Reusing `colorUp`/
    // `colorDown` rather than inventing a second spelling keeps one vocabulary
    // for "the two colours a per-point mode needs".
    // ⭐⭐ OR A PALETTE: the column then holds which entry each bar uses — an
    // N-way Pine colour chain. Two ways to say "what to alternate between", and a
    // plot must say exactly one of them.
    if (plot.colorPalette !== undefined) {
      if (plot.colorUp !== undefined || plot.colorDown !== undefined) {
        errors.push(`${path}: declare colorPalette OR colorUp/colorDown for ${fmt(mode)}, not both`)
      }
      if (plot.colorGradient !== undefined) {
        errors.push(`${path}: declare colorPalette OR colorGradient for ${fmt(mode)}, not both`)
      }
      if (plot.colorPacked !== undefined) {
        errors.push(`${path}: declare colorPalette OR colorPacked for ${fmt(mode)}, not both`)
      }
      return
    }
    // ⭐⭐ RT6 — OR A COMPUTED COLOUR: the column IS the colour. A fourth way to
    // say what the column holds; a plot says exactly one.
    if (plot.colorPacked !== undefined) {
      if (plot.colorUp !== undefined || plot.colorDown !== undefined || plot.colorGradient !== undefined) {
        errors.push(`${path}: declare colorPacked alone for ${fmt(mode)} (not with colorUp/colorDown or colorGradient)`)
      }
      return
    }
    // ⭐⭐ C37 — OR A GRADIENT: the column then holds the bar's position between
    // the two endpoints. A third way to say "what the column picks from", and
    // again a plot says exactly one.
    if (plot.colorGradient !== undefined) {
      if (plot.colorUp !== undefined || plot.colorDown !== undefined) {
        errors.push(`${path}: declare colorGradient OR colorUp/colorDown for ${fmt(mode)}, not both`)
      }
      return
    }
    const missing = ['colorUp', 'colorDown'].filter((f) => !isNonEmptyString(plot[f]))
    if (missing.length) {
      errors.push(
        `${path}: colour mode ${fmt(mode)} colours each point by whether column ${fmt(col)} is ` +
        `non-zero, so the plot must declare both colorUp and colorDown (or a colorPalette, or a colorGradient) — ` +
        `missing ${list(missing)}`,
      )
    }
  })
}

/**
 * `plots[].edges` — the band's bounding columns. Cross-section, like colorMode,
 * because an edge may name a plot declared LATER in the array.
 *
 * WHY THIS EXISTS (B2 Task 2 carry-in a): `band` was in the style vocabulary
 * with nothing saying WHICH columns bound it. A band is the one v1 style whose
 * meaning lives in other columns, so without `edges` a `band` plot registers
 * successfully and is unrenderable — the definition simply doesn't contain the
 * information. Bollinger and Donchian are exactly this shape (a centre column
 * between two edge columns) and are the reason it is needed now.
 *
 * THE SHAPE: a band plot's OWN key is its centre column — the value it plots
 * like any other line — and `edges: {upper, lower}` names two OTHER declared
 * plots. The edges stay first-class plots rather than becoming anonymous
 * sub-columns because today each is its own series with its own line style
 * (BB's edges are dashed and its middle solid; Donchian's are the other way
 * round), and a definition that couldn't say that couldn't reproduce the chart.
 *
 * An edge must not be an `hlines` plot: guides are static levels and produce no
 * column, so a band bounded by one bounds nothing. That is the "validate that
 * those columns exist" half — existence here means "declares a column", not
 * merely "is a key someone wrote down".
 */
function validateBandEdges(plots, errors) {
  const styleByKey = new Map()
  for (const p of plots) {
    if (isPlainObject(p) && isNonEmptyString(p.key) && !styleByKey.has(p.key)) {
      styleByKey.set(p.key, p.style)
    }
  }
  const declared = () => list([...styleByKey.keys()]) || 'none'

  plots.forEach((plot, index) => {
    if (!isPlainObject(plot)) return
    const path = `plots[${index}]`
    const isBand = plot.style === 'band'
    const { edges } = plot

    if (!isBand) {
      if (edges !== undefined) {
        errors.push(
          `${path}.edges: only a "band" plot has edges — plots[${index}] is style ${fmt(plot.style)}, ` +
          `so its edges would be carried around and never drawn`,
        )
      }
      return
    }

    if (!isPlainObject(edges)) {
      errors.push(
        `${path}.edges: style "band" requires edges: {upper: "<plotKey>", lower: "<plotKey>"} naming the ` +
        `two columns that bound it, got ${fmt(edges)} — without them the band has nothing to draw between`,
      )
      return
    }

    for (const side of ['upper', 'lower']) {
      const ref = edges[side]
      if (!isNonEmptyString(ref)) {
        errors.push(`${path}.edges.${side}: required non-empty plot key, got ${fmt(ref)}`)
        continue
      }
      if (ref === plot.key) {
        errors.push(
          `${path}.edges.${side}: ${fmt(ref)} is the band's own key — a band cannot bound itself`,
        )
        continue
      }
      if (!styleByKey.has(ref)) {
        errors.push(
          `${path}.edges.${side}: ${fmt(ref)} names no declared plot (declared plot keys: ${declared()})`,
        )
        continue
      }
      if (styleByKey.get(ref) === 'hlines') {
        errors.push(
          `${path}.edges.${side}: ${fmt(ref)} is an "hlines" plot — guides are static levels and return ` +
          `no column, so they cannot bound a band`,
        )
      }
    }

    if (isNonEmptyString(edges.upper) && edges.upper === edges.lower) {
      errors.push(
        `${path}.edges: upper and lower are both ${fmt(edges.upper)} — a band between one column and ` +
        `itself has zero width`,
      )
    }
  })
}

/**
 * `plots[].fill: { with }` — the SCHEMA half of a fill between two plots. Spec §6
 * gives the RENDERER to W6 (a series primitive painting the polygon between plot
 * A's and plot B's values per visible bar; `BaselineSeries` cannot, it fills to
 * a constant). Until then the field is validated, carried and cross-checked,
 * and drawn by nothing — exactly as `colorMode: 'column:<key>'` is today.
 *
 * ⛔ VALIDATED-BUT-INERT IS A DECLARED STATE, NOT AN ACCIDENT, and the thing
 * that makes that sentence true is `defSchema.test.js`'s *"fill is
 * VALIDATED-BUT-INERT until W6"* block, not this comment: a source probe over
 * every engine module (the list DERIVED from the directory) asserting none of
 * them reads the field, plus the other half — the schema CARRIES it. So W6
 * wiring the renderer turns a green test red, which is a lane being told, and
 * a comment claiming inertness while a renderer quietly consumed the field
 * could not survive. ⚠️ Written this way because the first draft of this
 * paragraph asserted a test that did not exist yet (caught in review) — the
 * same over-claim the `treesHash` import comment above was corrected for.
 *
 * The refusals are the ways a fill can have no area: its own key (one edge), a
 * guide (an `hlines` plot returns no column, so no second edge), a key nothing
 * declares — and the mirror, a fill declared ON a guide, which has no FIRST
 * edge. A HIDDEN plot is a legal `with`: hidden is computed, so its edge exists.
 */
/**
 * One input condition in the inputs' `activeWhen` grammar (`{key, equals}` and
 * the other READOUT_CONDITION_OPS comparators), for a field that gates a
 * PRESENTATION on the member's own switch (`plots[].fill.activeWhen`,
 * `plots[].derive.activeWhen`). Fail closed: no key, an undeclared key, no
 * comparator, or an enum value that is not one of the input's options.
 */
function validateInputCondition(aw, where, inputsByKey, errors) {
  if (!isPlainObject(aw) || typeof aw.key !== 'string' || !aw.key) {
    errors.push(`${where}: expected {key, equals} naming a declared input, got ${fmt(aw)}`)
    return
  }
  if (!inputsByKey.has(aw.key)) {
    errors.push(`${where}.key: ${fmt(aw.key)} names no declared input (declared: ${list([...inputsByKey.keys()]) || 'none'})`)
    return
  }
  const ops = Object.keys(aw).filter((k) => k !== 'key')
  if (ops.length !== 1 || !READOUT_CONDITION_OPS.includes(ops[0])) {
    errors.push(`${where}: expected exactly one comparator of ${list(READOUT_CONDITION_OPS)}, got ${fmt(aw)}`)
    return
  }
  const fault = activeWhenEnumFault(aw, inputsByKey)
  if (fault) errors.push(`${where}${fault}`)
}

/**
 * ⭐ `plots[].derive: {from, where, activeWhen?}` (UCT RS design round,
 * 2026-11-08) — a column the CLIENT derives from two columns the compute already
 * returned: `from`'s value on every bar where `where` is > 0, NaN elsewhere, and
 * no column at all while `activeWhen` fails (`derivedColumns.js`). It is how an
 * event the server sends as 0/1 (`crossUp`) becomes a glyph that rides the line:
 * a 0/1 column drawn `inBar` would sit at 1 on a scale near 0.25.
 *
 * Fail closed: only a `markers` plot derives (a derived line would be a second
 * authority over a server column); only on the SERVER lane, the one lane whose
 * columns arrive whole and are aligned in one place (`serverColumnsFor`); `from`
 * names a declared data plot that is not this one and not itself derived;
 * `where` is a column name; unknown fields are refused.
 */
function validateDerives(def, plots, errors, inputsByKey) {
  const serverLane = isPlainObject(def && def.compute) && def.compute.kind === 'server'
  const byKey = new Map()
  for (const p of plots) if (isPlainObject(p) && isNonEmptyString(p.key) && !byKey.has(p.key)) byKey.set(p.key, p)
  plots.forEach((plot, index) => {
    if (!isPlainObject(plot) || plot.derive === undefined) return
    const path = `plots[${index}].derive`
    const d = plot.derive
    if (!isPlainObject(d)) { errors.push(`${path}: expected {from, where, activeWhen?}, got ${fmt(d)}`); return }
    for (const k of Object.keys(d)) {
      if (!DERIVE_FIELDS.includes(k)) errors.push(`${path}.${k}: unknown field — expected one of: ${list(DERIVE_FIELDS)}`)
    }
    if (!serverLane) {
      errors.push(`${path}: a derived column is built where server columns are aligned (\`serverColumnsFor\`), so only a compute.kind "server" definition may declare one`)
    }
    if (plot.style !== 'markers') {
      errors.push(`${path}: only a "markers" plot derives its column (got style ${fmt(plot.style)}) — a derived line would be a second authority over a column the compute owns`)
    }
    const from = byKey.get(d.from)
    if (!isNonEmptyString(d.from) || !from) {
      errors.push(`${path}.from: ${fmt(d.from)} names no declared plot`)
    } else if (d.from === plot.key) {
      errors.push(`${path}.from: a plot cannot derive from itself`)
    } else if (from.style === 'hlines') {
      errors.push(`${path}.from: ${fmt(d.from)} is a guide and returns no column`)
    } else if (from.derive !== undefined) {
      errors.push(`${path}.from: ${fmt(d.from)} is itself derived — derive from a column the compute returns`)
    }
    if (typeof d.where !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(d.where)) {
      errors.push(`${path}.where: expected the name of a 0/1 event column, got ${fmt(d.where)}`)
    }
    if (d.activeWhen !== undefined) validateInputCondition(d.activeWhen, `${path}.activeWhen`, inputsByKey, errors)
  })
}

/**
 * ⭐ `rescale: {input, off, to, anchor, at, plots, timeframes}` (2026-11-12) — the
 * drawn columns multiplied by one factor per envelope so the line reads like a
 * rating (`rescale.js`). Fail closed: only on the SERVER lane (the one lane whose
 * columns arrive whole and are aligned in one place); `input` is a declared enum
 * input that is NOT a server input (the scale is presentation and must never key
 * the fetch) and defaults to `off`, so every saved chart draws as before; every
 * other option maps, in `to`, to a payload `scalar:` path; `anchor` names a
 * declared line plot among `plots`; `at` is a `scalar:` path (the rating's date);
 * `plots` are declared plots with a column; `timeframes` is a non-empty subset of
 * D/W/M; unknown fields are refused.
 */
function validateRescale(def, plots, errors, inputsByKey) {
  if (!def || def.rescale === undefined) return
  const path = 'rescale'
  const r = def.rescale
  if (!isPlainObject(r)) { errors.push(`${path}: expected {${RESCALE_FIELDS.join(', ')}}, got ${fmt(r)}`); return }
  for (const k of Object.keys(r)) {
    if (!RESCALE_FIELDS.includes(k)) errors.push(`${path}.${k}: unknown field — expected one of: ${list(RESCALE_FIELDS)}`)
  }
  if (!(isPlainObject(def.compute) && def.compute.kind === 'server')) {
    errors.push(`${path}: a rating scale multiplies columns where server columns are aligned (\`serverColumnsFor\`), so only a compute.kind "server" definition may declare one`)
  }
  const input = isNonEmptyString(r.input) ? inputsByKey.get(r.input) : null
  const options = input && Array.isArray(input.options) ? input.options.map(enumOptionValue) : []
  if (!input || input.type !== 'enum') {
    errors.push(`${path}.input: ${fmt(r.input)} names no declared enum input`)
  } else {
    const sent = isPlainObject(def.meta) && Array.isArray(def.meta.serverInputs) ? def.meta.serverInputs : []
    if (sent.includes(r.input)) {
      errors.push(`${path}.input: ${fmt(r.input)} is a server input — the scale is presentation and must never key the fetch`)
    }
    if (!options.includes(r.off)) errors.push(`${path}.off: ${fmt(r.off)} is not an option of ${fmt(r.input)}`)
    else if (input.default !== r.off) {
      errors.push(`${path}.off: ${fmt(r.input)} must default to ${fmt(r.off)}, so every saved chart draws exactly as before`)
    }
  }
  if (!isPlainObject(r.to)) {
    errors.push(`${path}.to: expected {<option>: 'scalar:<path>'}, got ${fmt(r.to)}`)
  } else {
    for (const [k, v] of Object.entries(r.to)) {
      const parsed = parseReadoutSource(v)
      if (!parsed || parsed.kind !== 'scalar') errors.push(`${path}.to.${k}: expected a payload \`scalar:<path>\`, got ${fmt(v)}`)
      if (input && !options.includes(k)) errors.push(`${path}.to.${k}: ${fmt(k)} is not an option of ${fmt(r.input)}`)
      if (k === r.off) errors.push(`${path}.to.${k}: the off option scales nothing`)
    }
    for (const o of options) {
      if (o !== r.off && !Object.prototype.hasOwnProperty.call(r.to, o)) errors.push(`${path}.to: option ${fmt(o)} names no rating to scale to`)
    }
  }
  const at = parseReadoutSource(r.at)
  if (!at || at.kind !== 'scalar') errors.push(`${path}.at: expected a payload \`scalar:<path>\` naming the rating's date, got ${fmt(r.at)}`)
  const byKey = new Map()
  for (const p of plots) if (isPlainObject(p) && isNonEmptyString(p.key) && !byKey.has(p.key)) byKey.set(p.key, p)
  const keys = Array.isArray(r.plots) ? r.plots : null
  if (!keys || !keys.length) {
    errors.push(`${path}.plots: expected a non-empty list of the plots drawn in the line's units, got ${fmt(r.plots)}`)
  } else {
    for (const k of keys) {
      const p = byKey.get(k)
      if (!p) errors.push(`${path}.plots: ${fmt(k)} names no declared plot`)
      else if (p.style === 'hlines') errors.push(`${path}.plots: ${fmt(k)} is a guide and returns no column`)
    }
  }
  const anchor = byKey.get(r.anchor)
  if (!anchor || anchor.style !== 'line') errors.push(`${path}.anchor: ${fmt(r.anchor)} names no declared line plot`)
  else if (keys && !keys.includes(r.anchor)) errors.push(`${path}.anchor: ${fmt(r.anchor)} must be among the plots it scales`)
  const tfs = Array.isArray(r.timeframes) ? r.timeframes : null
  if (!tfs || !tfs.length || tfs.some((t) => !RESCALE_TIMEFRAMES.includes(t))) {
    errors.push(`${path}.timeframes: expected a non-empty list of ${list(RESCALE_TIMEFRAMES)}, got ${fmt(r.timeframes)}`)
  }
  if (r.precision !== undefined && !(Number.isInteger(r.precision) && r.precision >= 0 && r.precision <= 8)) {
    errors.push(`${path}.precision: expected the axis decimals while scaled, a whole number 0 to 8, got ${fmt(r.precision)}`)
  }
}

/**
 * ⭐ `placement.axisWhen` (2026-11-12) — an input condition (the `activeWhen`
 * grammar) under which the definition NEEDS its numbers read: while it holds, the
 * automatic destination is the definition's own pane (`displayTarget.
 * resolveDisplayTarget`) and a declared `axis: 'hidden'` is lifted there
 * (`placement.axisHiddenOf`). A member's own explicit destination still wins.
 */
function validateAxisWhen(def, errors, inputsByKey) {
  const p = def && isPlainObject(def.placement) ? def.placement : null
  if (!p || p.axisWhen === undefined) return
  validateInputCondition(p.axisWhen, 'placement.axisWhen', inputsByKey, errors)
}

/**
 * ⭐ `plots[].liveTail` (RS split, unit U2b, 2026-11-09) — the FORMING bar's cell
 * of a server column recomputed on the client while the cached envelope's history
 * is served as it is (`liveTail.js`):
 *
 *   {kind: 'ratio', benchmark: 'scalar:<path>', scale?}   last = close / benchClose × scale
 *   {kind: 'ma', of: <ratio plot>, length, type?}         the average's exact one-step continuation
 *
 * Fail closed: only on the SERVER lane (the one lane whose last cell is a cached
 * value); only on a plot that draws a VALUE (never a guide, which has no column,
 * nor a marker, whose column is an event); the benchmark is a payload `scalar:`
 * path (an `input:` would be the REQUESTED benchmark — `SECTOR` — not the ticker
 * the server resolved it to); `of` names a declared `ratio` tail that is not this
 * plot; `length` is a whole number ≥ 1 or an `input:` key of a declared `int` /
 * `float` input; `type` is EMA / SMA or an `input:` key of a declared enum whose
 * every option is one of them (both averages are linear in their newest term, so
 * the step is exact — a third kind would be a guess); unknown fields are refused.
 */
function validateLiveTails(def, plots, errors, inputsByKey) {
  const serverLane = isPlainObject(def && def.compute) && def.compute.kind === 'server'
  const byKey = new Map()
  for (const p of plots) if (isPlainObject(p) && isNonEmptyString(p.key) && !byKey.has(p.key)) byKey.set(p.key, p)
  const inputSource = (v) => {
    const parsed = parseReadoutSource(v)
    return parsed && parsed.kind === 'input' && parsed.path.length === 1 ? parsed.path[0] : null
  }
  plots.forEach((plot, index) => {
    if (!isPlainObject(plot) || plot.liveTail === undefined) return
    const path = `plots[${index}].liveTail`
    const lt = plot.liveTail
    if (!isPlainObject(lt)) { errors.push(`${path}: expected {kind, …}, got ${fmt(lt)}`); return }
    if (!LIVE_TAIL_KINDS.includes(lt.kind)) {
      errors.push(`${path}.kind: ${fmt(lt.kind)} is not a live-tail kind — expected one of: ${list(LIVE_TAIL_KINDS)}`)
      return
    }
    const fields = LIVE_TAIL_FIELDS[lt.kind]
    for (const k of Object.keys(lt)) {
      if (!fields.includes(k)) errors.push(`${path}.${k}: unknown field for kind ${fmt(lt.kind)} — expected one of: ${list(fields)}`)
    }
    if (!serverLane) {
      errors.push(`${path}: a live tail moves the last cell of a CACHED server column (\`serverColumnsFor\`), so only a compute.kind "server" definition may declare one`)
    }
    if (plot.style === 'hlines' || plot.style === 'markers') {
      errors.push(`${path}: a live tail moves a VALUE — a ${fmt(plot.style)} plot has no value to move (a guide returns no column; a marker's column is an event)`)
    }
    if (lt.kind === 'ratio') {
      const parsed = parseReadoutSource(lt.benchmark)
      if (!parsed || parsed.kind !== 'scalar') {
        errors.push(`${path}.benchmark: expected a payload \`scalar:<path>\` naming the RESOLVED benchmark ticker, got ${fmt(lt.benchmark)}`)
      }
      if (lt.scale !== undefined && !(Number.isFinite(lt.scale) && lt.scale > 0)) {
        errors.push(`${path}.scale: expected a finite number > 0, got ${fmt(lt.scale)}`)
      }
      return
    }
    // kind: 'ma'
    const of = byKey.get(lt.of)
    if (!isNonEmptyString(lt.of) || !of) {
      errors.push(`${path}.of: ${fmt(lt.of)} names no declared plot`)
    } else if (lt.of === plot.key) {
      errors.push(`${path}.of: a plot cannot continue from itself`)
    } else if (!isPlainObject(of.liveTail) || of.liveTail.kind !== 'ratio') {
      errors.push(`${path}.of: ${fmt(lt.of)} declares no \`liveTail: {kind: 'ratio'}\` — an average is continued from a LIVE ratio, never a cached one`)
    }
    if (Number.isInteger(lt.length) && lt.length >= 1) {
      // a literal length
    } else {
      const key = inputSource(lt.length)
      const spec = key ? inputsByKey.get(key) : null
      if (!spec || !['int', 'float'].includes(spec.type)) {
        errors.push(`${path}.length: expected a whole number ≥ 1 or \`input:<key>\` of a declared "int" / "float" input, got ${fmt(lt.length)}`)
      }
    }
    if (lt.type !== undefined) {
      const literal = typeof lt.type === 'string' && LIVE_TAIL_MA_TYPES.includes(lt.type.toUpperCase())
      if (!literal) {
        const key = inputSource(lt.type)
        const spec = key ? inputsByKey.get(key) : null
        const options = spec && spec.type === 'enum' && Array.isArray(spec.options)
          ? spec.options.map((o) => (Array.isArray(o) ? o[0] : (isPlainObject(o) && 'value' in o ? o.value : o)))
          : null
        const allKnown = !!options && options.length > 0
          && options.every((v) => typeof v === 'string' && LIVE_TAIL_MA_TYPES.includes(v.toUpperCase()))
        if (!allKnown) {
          errors.push(`${path}.type: expected ${list(LIVE_TAIL_MA_TYPES)} or \`input:<key>\` of a declared enum whose every option is one of them, got ${fmt(lt.type)}`)
        }
      }
    }
  })
}

function validateFills(plots, errors, inputsByKey = new Map()) {
  const styleByKey = new Map()
  for (const p of plots) {
    if (isPlainObject(p) && isNonEmptyString(p.key) && !styleByKey.has(p.key)) styleByKey.set(p.key, p.style)
  }
  plots.forEach((plot, index) => {
    if (!isPlainObject(plot) || !isPlainObject(plot.fill) || !isNonEmptyString(plot.fill.with)) return
    const path = `plots[${index}].fill`
    if (plot.style === 'hlines') {
      errors.push(
        `${path}: an "hlines" plot returns no column, so there is no edge to fill FROM — declare the ` +
        `fill on the data plot that owns the column`,
      )
      return
    }
    // ⭐⭐ `colorUpInput` / `colorDownInput`: the `color` input a band's hue is the
    // member's pick of (`binder.bandColoursFor`). A name no colour input declares
    // would be a knob into nothing, so it is refused.
    for (const side of ['colorUpInput', 'colorDownInput']) {
      const k = plot.fill[side]
      if (k === undefined) continue
      const spec = typeof k === 'string' ? inputsByKey.get(k) : null
      if (!spec || spec.type !== 'color') {
        errors.push(`${path}.${side}: ${fmt(k)} names no declared "color" input`)
      }
    }
    // ⭐ `fill.activeWhen` (UCT RS design round, 2026-11-08): the band draws only
    // while this input condition holds — a PRESENTATION switch (the member's
    // "Shade vs average"), so the columns never move and the server never hears
    // of it. The inputs' condition grammar, the key a declared input.
    if (plot.fill.activeWhen !== undefined) {
      validateInputCondition(plot.fill.activeWhen, `${path}.activeWhen`, inputsByKey, errors)
    }
    const other = plot.fill.with
    if (other === plot.key) {
      errors.push(`${path}.with: ${fmt(other)} is this plot's own key — a fill between a line and itself has no area`)
    } else if (!styleByKey.has(other)) {
      errors.push(`${path}.with: ${fmt(other)} names no declared plot (declared: ${list([...styleByKey.keys()]) || 'none'})`)
    } else if (styleByKey.get(other) === 'hlines') {
      errors.push(
        `${path}.with: ${fmt(other)} is an "hlines" plot — a guide returns no column, so there is no ` +
        `second edge to fill to`,
      )
    }
  })
}

/**
 * ⭐⭐ B1 — `paints`: a Pine `bgcolor(…)` (the bar's background, behind the
 * series of the script's pane) or `barcolor(…)` (the chart's own candles), one
 * entry per call the translator carried. The colour is said the way a plot's
 * is — a static `color` (+ `opacity`), or `colorMode: "column:<key>"` with
 * `colorUp`/`colorDown`, a `colorPalette`, or a `colorGradient` — so the
 * renderer reads it through `pool.columnColorsForPlot`, the reader a plot uses.
 *
 * ⛔ OPTIONAL, and absent on every document that predates it. A paint with
 * nothing to draw is refused: a `kind` this renderer does not know, no colour at
 * all, or a column no plot declares — each would register and draw nothing.
 */
export const PAINT_KINDS = Object.freeze(['bgcolor', 'barcolor'])
/** ⭐⭐ DIV-4 — `compute.runtimeColours = { source, at, keys }`: colours a HOST
 *  document reads from the per-bar run (`memberPaneDefinition::runtimeReadPaints`).
 *  Only on an `ast` definition; `keys[k]` names the column `at[k]` lands in, and a
 *  key is never also a plot's. Returns the keys a paint may name (none when absent
 *  or malformed). */
function validateRuntimeColours(compute, plotKeyIndex, errors) {
  const rc = compute && compute.runtimeColours
  if (rc === undefined) return []
  const at = 'compute.runtimeColours'
  if (!compute || compute.kind !== 'ast') {
    errors.push(`${at}: only an "ast" definition reads colours from the per-bar run, got kind ${fmt(compute && compute.kind)}`)
    return []
  }
  if (!isPlainObject(rc) || !isNonEmptyString(rc.source) || !Array.isArray(rc.at) || !Array.isArray(rc.keys)
      || rc.at.length === 0 || rc.at.length !== rc.keys.length) {
    errors.push(`${at}: expected {source, at, keys} with one key per value, got ${fmt(rc)}`)
    return []
  }
  const keys = []
  for (const [i, k] of rc.keys.entries()) {
    if (!isNonEmptyString(k) || keys.includes(k) || plotKeyIndex.has(k)) {
      errors.push(`${at}.keys[${i}]: expected a unique key no plot declares, got ${fmt(k)}`)
      return []
    }
    const spec = rc.at[i]
    if (!isPlainObject(spec) || !Number.isInteger(spec.line) || !Number.isInteger(spec.column)
        || spec.kind !== 'colour' || !isPlainObject(spec.node)) {
      errors.push(`${at}.at[${i}]: expected a colour asked for at a statement ({line, column, node, kind: "colour"}), got ${fmt(spec)}`)
      return []
    }
    keys.push(k)
  }
  return keys
}

/** ⭐⭐ ENGINE 53 — the fields `compute.runtimeObjects` may carry. CLOSED: anything else is
 *  refused, so a hand-posted document cannot smuggle a field a later reader would trust. */
export const RUNTIME_OBJECTS_FIELDS = Object.freeze(['source', 'outputs', 'runtimeLanguage', 'runtimeFrontend',
  'runtimeIr', 'runtimeOutputSignature', 'sites', 'programSha256', 'programGraphSha256'])

/** ⭐⭐ ENGINE 53 — `compute.runtimeObjects = { source, outputs, ...runtimeVersionStamp }`:
 *  the RUN HALF of a host document whose object program lost drawings
 *  (`memberPaneDefinition::hostPartialRunHalf`, drawn by `nativeRegistry.js::withRunHalf`).
 *  The rules, mirrored rule for rule by the server (`presentation_schema._check_runtime_objects`,
 *  one fixture both suites read: `tests/fixtures/runtime_objects_schema.json`):
 *    · only on an `ast` definition;
 *    · `source` a non-empty string; `outputs` an object mapping a DECLARED plot key to a
 *      whole-number run output index, no index named twice (the column rail compares each);
 *    · the version stamp, when present: `runtimeLanguage` a non-empty string,
 *      `runtimeFrontend` / `runtimeIr` positive whole numbers, `runtimeOutputSignature` an
 *      array of strings that names every mapped index;
 *    · ⭐ ENGINE 54 — `sites`, when present: an object mapping a host create site id (`s<n>`) to
 *      the source call both lanes name it by (`<line>:<column>`, `objectProgram.objectSiteKey`);
 *      `programSha256` / `programGraphSha256`, when present: 64 lowercase hex
 *      (`runHalfProgram.js`; the bind refuses a run half whose stamp is absent or wrong);
 *    · no other field.
 *  @param {object} compute  the definition's `compute`
 *  @param {Set<string>|Map<string, any>} plotKeys the declared plot keys
 *  @returns {string[]} errors (empty when absent or valid) */
export function runtimeObjectsErrors(compute, plotKeys) {
  const ro = compute && compute.runtimeObjects
  if (ro === undefined) return []
  const at = 'compute.runtimeObjects'
  if (!compute || compute.kind !== 'ast') {
    return [`${at}: only an "ast" definition draws its objects from the per-bar run, got kind ${fmt(compute && compute.kind)}`]
  }
  if (!isPlainObject(ro)) return [`${at}: expected {source, outputs, ...stamp}, got ${fmt(ro)}`]
  const errors = []
  const extra = Object.keys(ro).filter((k) => !RUNTIME_OBJECTS_FIELDS.includes(k))
  if (extra.length) errors.push(`${at}: unknown field(s) ${list(extra.map(fmt))}`)
  if (!isNonEmptyString(ro.source)) errors.push(`${at}.source: expected the script the run runs, a non-empty string, got ${fmt(ro.source)}`)
  // ⛔ ONE DOCUMENT, ONE SCRIPT: beside run-read colours (`compute.runtimeColours`) the two
  // runs read the same source, or the served stamp and the bind could each answer for a
  // different script.
  const rc = compute.runtimeColours
  if (isPlainObject(rc) && rc.source !== undefined && rc.source !== ro.source) {
    errors.push(`${at}.source: is not the script compute.runtimeColours.source reads; one document runs one script`)
  }
  if (!isPlainObject(ro.outputs)) {
    errors.push(`${at}.outputs: expected an object mapping a plot key to a run output index, got ${fmt(ro.outputs)}`)
  } else {
    const seen = new Set()
    for (const [k, idx] of Object.entries(ro.outputs)) {
      if (!plotKeys.has(k)) errors.push(`${at}.outputs.${k}: names no declared plot`)
      if (!(Number.isInteger(idx) && idx >= 0)) {
        errors.push(`${at}.outputs.${k}: expected a whole-number run output index, got ${fmt(idx)}`)
      } else if (seen.has(idx)) {
        errors.push(`${at}.outputs.${k}: run output ${idx} is named by two plots`)
      } else seen.add(idx)
    }
  }
  if (ro.runtimeLanguage !== undefined && !isNonEmptyString(ro.runtimeLanguage)) {
    errors.push(`${at}.runtimeLanguage: expected a non-empty string, got ${fmt(ro.runtimeLanguage)}`)
  }
  for (const f of ['runtimeFrontend', 'runtimeIr']) {
    if (ro[f] !== undefined && !(Number.isInteger(ro[f]) && ro[f] >= 1)) errors.push(`${at}.${f}: expected a positive whole number, got ${fmt(ro[f])}`)
  }
  if (ro.sites !== undefined) {
    if (!isPlainObject(ro.sites)) {
      errors.push(`${at}.sites: expected an object mapping a create site to its source call, got ${fmt(ro.sites)}`)
    } else {
      for (const [k, v] of Object.entries(ro.sites)) {
        if (!/^s\d+$/.test(k)) errors.push(`${at}.sites.${k}: a create site is named s<n>`)
        if (typeof v !== 'string' || !/^\d+:\d+$/.test(v)) errors.push(`${at}.sites.${k}: expected a source call <line>:<column>, got ${fmt(v)}`)
      }
    }
  }
  for (const f of ['programSha256', 'programGraphSha256']) {
    if (ro[f] !== undefined && !(typeof ro[f] === 'string' && /^[0-9a-f]{64}$/.test(ro[f]))) {
      errors.push(`${at}.${f}: expected 64 lowercase hex, got ${fmt(ro[f])}`)
    }
  }
  const sig = ro.runtimeOutputSignature
  if (sig !== undefined) {
    if (!Array.isArray(sig) || !sig.every((x) => typeof x === 'string')) {
      errors.push(`${at}.runtimeOutputSignature: expected an array of strings, got ${fmt(sig)}`)
    } else if (isPlainObject(ro.outputs)) {
      for (const [k, idx] of Object.entries(ro.outputs)) {
        if (Number.isInteger(idx) && idx >= sig.length) errors.push(`${at}.outputs.${k}: run output ${idx} is past the signature's ${sig.length} outputs`)
      }
    }
  }
  return errors
}

function validatePaints(paints, columnKeys, errors) {
  if (paints === undefined) return
  if (!Array.isArray(paints)) {
    errors.push(`paints: expected an array, got ${fmt(paints)}`)
    return
  }
  const isColour = (v) => isNonEmptyString(v)
  paints.forEach((p, i) => {
    const path = `paints[${i}]`
    if (!isPlainObject(p)) { errors.push(`${path}: expected an object, got ${fmt(p)}`); return }
    if (!PAINT_KINDS.includes(p.kind)) {
      errors.push(`${path}.kind: expected one of ${list(PAINT_KINDS)}, got ${fmt(p.kind)}`)
    }
    if (p.title !== undefined && typeof p.title !== 'string') errors.push(`${path}.title: expected a string, got ${fmt(p.title)}`)
    if (p.line !== undefined && !(Number.isInteger(p.line) && p.line > 0)) errors.push(`${path}.line: expected a positive whole number, got ${fmt(p.line)}`)
    if (p.opacity !== undefined && !(isFiniteNumber(p.opacity) && p.opacity >= 0 && p.opacity <= 1)) {
      errors.push(`${path}.opacity: expected a number in [0, 1], got ${fmt(p.opacity)}`)
    }
    if (p.color !== undefined && !isColour(p.color)) errors.push(`${path}.color: expected a colour string, got ${fmt(p.color)}`)
    // ⭐ F1 — render-time placement (`binder.js::paintRenderColours`).
    if (p.offset !== undefined && !Number.isInteger(p.offset)) errors.push(`${path}.offset: expected a whole number, got ${fmt(p.offset)}`)
    if (p.showLast !== undefined && !(Number.isInteger(p.showLast) && p.showLast >= 0)) errors.push(`${path}.showLast: expected a non-negative whole number, got ${fmt(p.showLast)}`)
    if (p.colorMode === undefined) {
      if (!isColour(p.color)) errors.push(`${path}: a paint must declare a colour (color, or colorMode "column:<key>")`)
      return
    }
    if (typeof p.colorMode !== 'string' || !p.colorMode.startsWith('column:')) {
      errors.push(`${path}.colorMode: expected "column:<key>", got ${fmt(p.colorMode)}`)
      return
    }
    const col = p.colorMode.slice('column:'.length)
    if (!columnKeys.has(col)) {
      errors.push(`${path}.colorMode: ${fmt(p.colorMode)} references column ${fmt(col)}, which no plot declares`)
    }
    const ways = [
      isColour(p.colorUp) && isColour(p.colorDown),
      Array.isArray(p.colorPalette) && p.colorPalette.length >= 2 && p.colorPalette.every(isColour),
      isPlainObject(p.colorGradient) && isColour(p.colorGradient.from) && isColour(p.colorGradient.to),
      // ⭐ RT6 — a colour the runtime lane computed bar by bar (`pool.packedPointColour`)
      isPlainObject(p.colorPacked),
    ].filter(Boolean).length
    if (ways !== 1) {
      errors.push(`${path}: colorMode ${fmt(p.colorMode)} needs exactly one of colorUp/colorDown, a colorPalette of two or more colours, a colorGradient, or a colorPacked`)
    }
    if (isPlainObject(p.colorPacked) && p.colorPacked.transparency !== undefined
      && !(Number.isInteger(p.colorPacked.transparency) && p.colorPacked.transparency >= 0 && p.colorPacked.transparency <= 100)) {
      errors.push(`${path}.colorPacked.transparency: expected a whole number 0-100, got ${fmt(p.colorPacked.transparency)}`)
    }
  })
}

/**
 * The data-bearing plots and `compute.trees` are ONE key set, in both
 * directions. A plot with no tree is a column nothing ever fills (the
 * `plots[].repaint` shape: declarable and inert); a tree with no plot is
 * computed for nobody. `hlines` plots are guides — they return no column and
 * own no tree — and a HIDDEN plot is still data-bearing: it is computed and
 * merely not drawn (A1's 0/1 scan plot), so it needs its tree like any other.
 *
 * Runs only on the `ast` lane with an object-shaped map; a map of any other
 * shape has already been refused by `validateTrees`, and a second report here
 * would be one defect under two names.
 */
function validateTreesAgainstPlots(compute, plots, errors) {
  if (!isPlainObject(compute) || compute.kind !== 'ast' || !isPlainObject(compute.trees)) return
  const dataKeys = plots
    .filter((p) => isPlainObject(p) && isNonEmptyString(p.key) && p.style !== 'hlines')
    .map((p) => p.key)
  const treeKeys = Object.keys(compute.trees)
  for (const k of dataKeys) {
    if (!treeKeys.includes(k)) {
      errors.push(
        `plots: data-bearing plot ${fmt(k)} has no tree in compute.trees (${list(treeKeys)}) — a plot ` +
        `with no tree is a key nothing ever fills`,
      )
    }
  }
  for (const k of treeKeys) {
    if (!dataKeys.includes(k)) {
      errors.push(
        `compute.trees.${k}: names no data-bearing plot (plots: ${list(dataKeys) || 'none'}) — a tree ` +
        `with no plot is computed for nobody`,
      )
    }
  }
}

/**
 * The DECLARATION half of an event: its key's shape, its uniqueness, and that it
 * does not collide with a plot.
 *
 * ⛔ THE OTHER HALF IS NOT HERE, AND CANNOT BE. Spec §3.1 says an event's key
 * MUST match a returned column valued `{0, 1, NaN}` — which is a claim about
 * what COMPUTE returns, and `validateDefinition` is a pure function of one
 * definition that never runs a compute lane (it has to validate a `server`- or
 * `ast`-kind definition this client cannot execute at all). So the column half
 * is enforced at REGISTRATION, in `nativeRegistry.registerDefinitions`, which
 * runs the definition's compute over a canned probe series and checks every
 * event column's domain. See `EVENT_COLUMN_DOMAIN` above.
 *
 * ⚠️ Until Phase C Task 4 NOTHING checked it. `columnKeys` read `def.plots` only,
 * so an event was declarable and inert — a definition could name three events,
 * return no column for any of them, and register cleanly.
 */
function validateEvent(event, index, seenKeys, plotKeys, errors) {
  const path = `events[${index}]`
  if (!isPlainObject(event)) {
    errors.push(`${path}: expected an object, got ${fmt(event)}`)
    return
  }
  if (!isNonEmptyString(event.key)) {
    errors.push(`${path}.key: required non-empty string, got ${fmt(event.key)}`)
    return
  }
  if (!KEY_RE.test(event.key)) {
    errors.push(`${path}.key: ${fmt(event.key)} is not a legal event key — must match ${KEY_RE}`)
    return
  }
  if (seenKeys.has(event.key)) {
    errors.push(
      `${path}.key: duplicate event key ${fmt(event.key)} (first declared at events[${seenKeys.get(event.key)}])`,
    )
  } else {
    seenKeys.set(event.key, index)
  }
  // Events and plots share ONE namespace: compute returns one column per
  // plot/event key (spec §4), so a collision means two producers of one array.
  if (plotKeys.has(event.key)) {
    errors.push(
      `${path}.key: ${fmt(event.key)} collides with plots[${plotKeys.get(event.key)}].key — ` +
      `plots and events share one column namespace, so the key can only belong to one of them`,
    )
  }
  if (event.label !== undefined && typeof event.label !== 'string') {
    errors.push(`${path}.label: expected a string, got ${fmt(event.label)}`)
  }
}

// ─── The entry point ─────────────────────────────────────────────────────────

/**
 * Validate an indicator definition and return it with `$<inputKey>` references
 * resolved.
 *
 * PURE. No I/O, no clock, no globals, and it never throws — a malformed
 * definition is DATA about a problem, not an exception, because this runs on the
 * registration path where one bad catalog entry must not take down the chart.
 *
 * On success the returned `def` is a DEEP CLONE of the argument (the caller's
 * object is never mutated) with:
 *   - `plots[].color` / `.width` / `.levels` substituted from input defaults,
 *   - every other field — including unknown ones — preserved verbatim.
 *
 * No key is invented on the way out: a definition that omitted `events` gets no
 * `events: []` bolted on, so a round-trip is a round-trip.
 *
 * @param {unknown} def
 * @returns {{ok: true, def: object} | {ok: false, errors: string[]}}
 */
/**
 * Resolve every `source` input's default against the REGISTRY.
 *
 * Separate from `validateDefinition` because it is the one check that is not a
 * pure function of a single definition: `'rsi.rsi'` is valid or invalid
 * depending on what else is registered. `validateDefinition` stayed
 * registry-free (it runs before anything is registered, including on the
 * definition being registered), so this is the second pass a registry runs once
 * every definition's columns are known. B2 Task 2 carry-in (b).
 *
 * A `source` naming a column that does not exist is the same class of failure as
 * an unresolvable `$ref`: the indicator computes over SOMETHING, and letting it
 * quietly fall back to `close` would change the numbers an alert fires on.
 *
 * @param {object} def — an already-validated definition.
 * @param {(defId: string) => string[]|null} resolveColumns — the column keys a
 *        definition returns, or null when that definition is unknown.
 * @returns {string[]} errors (empty when every referent resolves).
 */
export function validateSourceReferents(def, resolveColumns) {
  const errors = []
  const inputs = Array.isArray(def?.inputs) ? def.inputs : []

  inputs.forEach((input, i) => {
    if (!isPlainObject(input) || input.type !== 'source') return
    const path = `inputs[${i}].default`
    const ref = input.default
    if (!isNonEmptyString(ref)) return   // already reported by validateDefinition

    if (SOURCE_BAR_FIELDS.includes(ref)) return

    const dot = ref.indexOf('.')
    if (dot < 0) {
      errors.push(
        `${path}: source ${fmt(ref)} is neither a bar field (${list(SOURCE_BAR_FIELDS)}) nor a ` +
        `"defId.plotKey" handle — a source that resolves to nothing would silently compute over the wrong series`,
      )
      return
    }

    const defId = ref.slice(0, dot)
    const plotKey = ref.slice(dot + 1)
    const columns = resolveColumns ? resolveColumns(defId) : null
    if (!Array.isArray(columns)) {
      errors.push(
        `${path}: source ${fmt(ref)} names definition ${fmt(defId)}, which is not registered`,
      )
      return
    }
    if (!columns.includes(plotKey)) {
      errors.push(
        `${path}: source ${fmt(ref)} names column ${fmt(plotKey)}, which definition ${fmt(defId)} ` +
        `does not declare (its columns: ${list(columns) || 'none'})`,
      )
    }
  })

  return errors
}

/**
 * ⭐⭐ C3B — `definition.objects`, THE GRAPHICAL-OBJECT PROGRAM.
 *
 * A definition may carry a lifecycle program beside its columns. It is
 * OPTIONAL: 14 of the frozen 60 draw no objects at all and must stay
 * byte-identical, so an absent field is not an error and an absent field is not
 * an empty program either.
 *
 * ⛔⛔ WHICH FORM IS LEGAL DEPENDS ON THE DOCUMENT, and getting this backwards
 * is how the C2C compaction would be lost in silence:
 *
 *   V1 (inlined, `compute.trees`)  →  the program is UNBOUND. Its `{v:'tree'}`
 *       references index its OWN `trees` array, which is the only place those
 *       expressions live — carrying them is necessary, not wasteful.
 *   V2 (`compute.graph`)           →  the program is BOUND. Its references are
 *       node indices into the shared graph, and a `trees` array beside them
 *       would be a SECOND copy of every expression the graph already holds.
 *
 * So this refuses a bound program on a V1 document (its node indices point at a
 * table that is not there) and an unbound one on a V2 document (a duplicate
 * store). Either way the failure is named, not silent.
 */
function validateObjectProgramField(def, errors) {
  const program = def.objects
  if (program === undefined || program === null) return
  try {
    assertObjectProgram(program)
  } catch (err) {
    errors.push(`objects: ${err && err.message ? err.message : String(err)}`)
    return
  }
  const graph = def.compute && def.compute.graph
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes.length : null
  const treeRefs = treeRefsReferenced(program)
  const nodeRefs = graphNodesReferenced(program)
  const trees = Array.isArray(program.trees) ? program.trees : null

  if (nodes === null) {
    // ── the V1 form ───────────────────────────────────────────────────────
    if (nodeRefs.length) {
      errors.push(
        `objects: ${nodeRefs.length} graph node reference(s) on a document that carries no graph — `
        + 'a bound program indexes a node table that is not here',
      )
    }
    if (treeRefs.length && !trees) {
      errors.push(
        'objects.trees: the program references its own trees but carries none — '
        + `[${treeRefs.join(', ')}] index nothing`,
      )
    }
    if (trees) {
      const over = treeRefs.filter((i) => i >= trees.length)
      if (over.length) {
        errors.push(
          `objects.trees: reference(s) [${over.join(', ')}] are past the end of a ${trees.length}-tree list`,
        )
      }
    }
    return
  }

  // ── the V2 form ─────────────────────────────────────────────────────────
  if (trees) {
    errors.push(
      'objects.trees: a program stored beside a graph is BOUND to it and carries no trees of its own — '
      + 'keeping them would put a second copy of every expression in the document, which is the '
      + 'compaction C2C exists to protect',
    )
  }
  if (treeRefs.length) {
    errors.push(
      `objects: ${treeRefs.length} unbound {v:"tree"} reference(s) on a graph document — `
      + 'the intermediate form a translator emits must be bound before it is stored',
    )
  }
  const bad = nodeRefs.filter((n) => n >= nodes)
  if (bad.length) {
    errors.push(
      `objects: node reference(s) [${bad.join(', ')}] are past the end of a ${nodes}-node graph — `
      + 'a dangling reference renders as NaN, which draws an object at zero and explains nothing',
    )
  }
}

export function validateDefinition(def) {
  try {
    const errors = []

    if (!isPlainObject(def)) {
      return { ok: false, errors: [`definition: expected an object, got ${fmt(def)}`] }
    }

    // Work on a clone from the first line: substitution WRITES, and mutating the
    // caller's object would make this function impure and the failure path
    // destructive (a rejected definition would come back half-substituted).
    const out = deepClone(def)

    // ─ identity ─
    if (out.schemaVersion !== SCHEMA_VERSION) {
      errors.push(
        `schemaVersion: expected ${SCHEMA_VERSION}, got ${fmt(out.schemaVersion)} — ` +
        `this client cannot safely interpret another schema major`,
      )
    }
    if (!isNonEmptyString(out.id)) {
      errors.push(`id: required non-empty string (the stable handle), got ${fmt(out.id)}`)
    } else if (!ID_RE.test(out.id)) {
      errors.push(
        `id: ${fmt(out.id)} is not a legal definition id — must match ${ID_RE} ` +
        `(no dots: plots are addressed as "${out.id}.<plotKey>")`,
      )
    }
    // Presentation version. Alerts/screens/ledger pin against `defId@version`
    // freely (spec §3.1), so it must be orderable.
    if (!Number.isInteger(out.version) || out.version < 1) {
      errors.push(`version: required integer >= 1 (the presentation version), got ${fmt(out.version)}`)
    }

    // ⛔⛔ THE DOCUMENT'S OWN DECLARED INPUTS GO TO THE READ DOOR (W1b.5), AND
    // THE DEFECT THIS CLOSES IS A STORED ONE, NOT A MISSING WARNING.
    // `letPrepass.prepareSource` refuses `let period = 5` beside a declared
    // input `period` — but ONLY when it is handed the scope, and until now
    // nothing on the save path handed it one. So the pre-pass silently rewrote
    // every `period` to `(5)`, the tree agreed with the source, rule 2 was
    // satisfied, and the document SAVED WITH ITS DECLARED KNOB INERT: a member
    // turns the setting and nothing moves. `editor/completions.js` was already
    // passing the scope, so the completion popup refused text this validator
    // accepted — one grammar with two readings, and the stricter one sat where
    // it could not stop a save.
    //
    // ⛔ IT IS `declaredInputs(out)`, THE SAME READER `lintDefinition` USES, not
    // a key list built here. And it runs BEFORE `validateInput` on purpose: a
    // malformed input row is reported by its own validator, while
    // `declaredInputs` skips anything without a usable string `key`, so a bad
    // row can only make the scope SMALLER — never invent a shadow.
    validateCompute(out.compute, errors, declaredInputs(out))
    validateMeta(out.meta, out, errors)
    validatePlacement(out.placement, errors)

    // ─ inputs ─
    const inputsByKey = new Map()
    const inputKeyIndex = new Map()
    if (out.inputs !== undefined && !Array.isArray(out.inputs)) {
      errors.push(`inputs: expected an array, got ${fmt(out.inputs)}`)
    }
    const inputs = Array.isArray(out.inputs) ? out.inputs : []
    const runtimeDoc = isPlainObject(out.compute) && out.compute.kind === 'runtime'
    inputs.forEach((input, i) => validateInput(input, i, inputKeyIndex, errors, runtimeDoc))
    // Built from every input that declared a usable key, INCLUDING ones that
    // failed another check — so a bad `type` yields one error, not that plus a
    // cascade of bogus "unresolvable $ref" noise pointing at the same input.
    inputs.forEach((input) => {
      if (isPlainObject(input) && isNonEmptyString(input.key) && !inputsByKey.has(input.key)) {
        inputsByKey.set(input.key, input)
      }
    })
    inputs.forEach((input, i) => validateActiveWhen(input, i, inputsByKey, errors))
    // ⭐ UCT RS PHASE 3 (unit 3-01) — `requiresServer` and `legacy`.
    validateServerGates(out, inputs, errors)
    // ⭐ UCT RS PHASE 3 (unit 3-08b) — a legacy input's `mapsTo` successor.
    validateLegacyMaps(inputs, inputsByKey, errors)
    // ⭐ UCT RS PHASE 3 (unit 3-09b) — a text box that names an enum option.
    validateIdentityFor(out, inputs, inputsByKey, errors)

    // ─ readout (Phase 2a) — behavioural, fail-closed, carved out of preserve-unknown ─
    validateReadout(out, inputsByKey, errors)

    // ─ plots (substitution happens here, in-place on the clone) ─
    const plotKeyIndex = new Map()
    if (out.plots !== undefined && !Array.isArray(out.plots)) {
      errors.push(`plots: expected an array, got ${fmt(out.plots)}`)
    }
    const plots = Array.isArray(out.plots) ? out.plots : []
    // ⭐ U7 — a presentation input of a server definition: declared, and NOT in
    // `meta.serverInputs` (the list the fetch is keyed by), so the server never
    // hears of it. `validatePlotActiveWhen` says what it excepts and why.
    const sentKeys = isPlainObject(out.compute) && out.compute.kind === 'server'
      && isPlainObject(out.meta) && Array.isArray(out.meta.serverInputs) ? out.meta.serverInputs : null
    const presentationKey = sentKeys
      ? (key) => inputsByKey.has(key) && !sentKeys.includes(key)
      : null
    plots.forEach((plot, i) => validatePlot(plot, i, plotKeyIndex, inputsByKey, errors, presentationKey))

    // ─ events ─
    const eventKeyIndex = new Map()
    if (out.events !== undefined && !Array.isArray(out.events)) {
      errors.push(`events: expected an array, got ${fmt(out.events)}`)
    }
    const events = Array.isArray(out.events) ? out.events : []
    events.forEach((event, i) => validateEvent(event, i, eventKeyIndex, plotKeyIndex, errors))

    // ─ cross-section checks ─
    validateColorModes(plots, new Set([...plotKeyIndex.keys(), ...eventKeyIndex.keys()]), errors)
    validateBandEdges(plots, errors)
    validateOhlc(plots, new Set([...plotKeyIndex.keys(), ...eventKeyIndex.keys()]), errors)
    validateFills(plots, errors, inputsByKey)
    validateDerives(out, plots, errors, inputsByKey)
    validateLiveTails(out, plots, errors, inputsByKey)
    validateRescale(out, plots, errors, inputsByKey)
    validateAxisWhen(out, errors, inputsByKey)
    validateTreesAgainstPlots(out.compute, plots, errors)
    validateObjectProgramField(out, errors)
    // ⭐ DIV-4 — a paint may also read a colour column the per-bar run computes
    // (`compute.runtimeColours`, `nativeRegistry.js::withRuntimeColours`).
    const rtColourKeys = validateRuntimeColours(out.compute, plotKeyIndex, errors)
    // ⭐ ENGINE 53 — a host document's run half (`compute.runtimeObjects`).
    errors.push(...runtimeObjectsErrors(out.compute, plotKeyIndex))
    validatePaints(out.paints, new Set([...plotKeyIndex.keys(), ...eventKeyIndex.keys(), ...rtColourKeys]), errors)

    // A definition with no plots and no events returns no columns: it computes
    // something and hands it to nobody. Far more often this is a `plots` array
    // lost in transit than a deliberate choice.
    if (plots.length === 0 && events.length === 0) {
      errors.push(
        `plots: a definition must declare at least one plot or one event — ` +
        `with neither it produces no columns and renders nothing`,
      )
    }

    if (errors.length) return { ok: false, errors }
    return { ok: true, def: out }
  } catch (err) {
    // The contract is "never throws". A defect in this validator must surface as
    // a rejected definition, not as an exception that takes the chart with it.
    return {
      ok: false,
      errors: [`definition: validator raised unexpectedly (${err && err.message ? err.message : String(err)})`],
    }
  }
}
