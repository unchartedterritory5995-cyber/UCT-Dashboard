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

/** Plot styles buildable in v1 (spec §3.1).
 *
 *  `band` gets a rule the others don't need, added in B2 Task 2 when Bollinger
 *  and Donchian became definitions: a band is the only style whose meaning
 *  depends on OTHER columns, so it must say which ones. See `plots[].edges`
 *  and `validateBandEdges` below. */
export const PLOT_STYLES = Object.freeze([
  'line', 'stepline', 'histogram', 'area', 'baseline', 'hlines', 'markers', 'band',
])

/** Schema-reserved plot styles — renderer lands later. Same distinct-message
 *  treatment as RESERVED_INPUT_TYPES.
 *
 *  `cross` — LWC 5.2 draws circle/square/arrowUp/arrowDown markers only, and
 *  its point markers are circles; a cross marker needs W6's series primitives.
 *  Until then it is refused with the later-phase sentence, never coerced to
 *  `markers` (which is what "circles" already is). */
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
export const COMPUTE_KINDS = Object.freeze(['native', 'server', 'ast', 'script'])

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
export const LEGEND_FIELDS = Object.freeze(['label', 'decimals', 'hide'])

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
 * `column:<key>` is different in kind: NO SHIPPED DEFINITION DECLARES IT, so
 * there is nothing to drop. It is here because the reference-integrity check
 * below (does that column exist?) is the expensive half and is cheap to keep
 * true, and because a per-point colour column is how B3's first bar-colouring
 * indicator will express itself. `pool.signColorsForPlot` returns null for it and
 * says so; the series renders in its own colour, which is the correct v1
 * behaviour for a mode with no consumer.
 *
 * The day a definition declares one, `signColorsForPlot` and `binder.toPoints`
 * are the two places that must learn it — and a test asserting per-point colours
 * is the thing to write first. Until then: validated, inert, and deliberate.
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
 */
export const SUBSTITUTABLE_PLOT_FIELDS = Object.freeze(['color', 'width', 'levels', 'lineStyle'])

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

/**
 * @param {unknown} meta
 * @param {object} def the whole definition — `legendParams` names INPUT keys, so
 *        this is the one meta field that cannot be checked from `meta` alone.
 * @param {string[]} errors
 */
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
  // NOTE: unknown meta.* KEYS are intentionally NOT checked. They are preserved
  // verbatim on the returned def — that is the forward-compatibility half of the
  // asymmetric policy, and the round-trip promise depends on this silence.
}

function validatePlacement(placement, errors) {
  if (!isPlainObject(placement)) {
    errors.push(`placement: required object, got ${fmt(placement)}`)
    return
  }
  checkVocabulary(placement.target, PLACEMENT_TARGETS, [], 'placement.target', 'placement target', errors)

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
    } else if (placement.pane.height !== undefined
               && !(isFiniteNumber(placement.pane.height)
                    && placement.pane.height > 0 && placement.pane.height < 1)) {
      errors.push(
        `placement.pane.height: expected a finite fraction of the chart in (0, 1) — ` +
        `the pane's default height — got ${fmt(placement.pane.height)}`,
      )
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
      if (typeof d !== 'string') errors.push(`${path}: type "string" requires a string, got ${fmt(d)}`)
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

function validateInput(input, index, seenKeys, errors) {
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
  const typeOk = checkVocabulary(
    input.type, INPUT_TYPES, RESERVED_INPUT_TYPES, `${path}.type`, 'input type', errors,
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
}

/** `activeWhen` is the JSON-expressible successor to `indicatorRegistry`'s
 *  `showIf` predicate (a function cannot survive a definition round-trip). The
 *  operator grammar is NOT locked in v1, so this checks only the part that is
 *  checkable and dangerous: a condition keyed on an input that does not exist
 *  would silently evaluate to "never show", hiding a control forever. Same class
 *  as an unresolvable $ref, so it gets the same treatment. */
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
  }
}

function validatePlot(plot, index, seenKeys, inputsByKey, errors) {
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

  // ─ substitutable fields (spec §3.1: color, width, levels) ─

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
      plot.width = width
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

  // ─ the two colours `colorMode: 'sign'` needs ─
  //
  // NOT substitutable ($-refs stay confined to SUBSTITUTABLE_PLOT_FIELDS, which
  // the spec locks at color/width/levels) and validated exactly like `color`
  // otherwise. `validateColorModes` is what makes them REQUIRED under `'sign'`;
  // this half is what stops `colorUp: 3` registering.
  for (const field of ['colorUp', 'colorDown']) {
    if (plot[field] === undefined) continue
    if (!isNonEmptyString(plot[field])) {
      errors.push(
        `${path}.${field}: expected a non-empty colour string (the colour bars on that side of ` +
        `zero are drawn in), got ${fmt(plot[field])}`,
      )
    }
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
    // Reachable, checked — and deliberately inert at render time in v1. See the
    // note on COLOR_MODES: no shipped definition declares `column:<key>`, so
    // there is no author declaration being dropped here. Keeping the reference
    // check true costs nothing and is what makes the mode safe to start using.
    const col = mode.slice('column:'.length)
    if (!columnKeys.has(col)) {
      errors.push(
        `${path}: ${fmt(mode)} references column ${fmt(col)}, which no plot or event declares ` +
        `(available columns: ${list([...columnKeys]) || 'none'})`,
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
function validateFills(plots, errors) {
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
    inputs.forEach((input, i) => validateInput(input, i, inputKeyIndex, errors))
    // Built from every input that declared a usable key, INCLUDING ones that
    // failed another check — so a bad `type` yields one error, not that plus a
    // cascade of bogus "unresolvable $ref" noise pointing at the same input.
    inputs.forEach((input) => {
      if (isPlainObject(input) && isNonEmptyString(input.key) && !inputsByKey.has(input.key)) {
        inputsByKey.set(input.key, input)
      }
    })
    inputs.forEach((input, i) => validateActiveWhen(input, i, inputsByKey, errors))

    // ─ plots (substitution happens here, in-place on the clone) ─
    const plotKeyIndex = new Map()
    if (out.plots !== undefined && !Array.isArray(out.plots)) {
      errors.push(`plots: expected an array, got ${fmt(out.plots)}`)
    }
    const plots = Array.isArray(out.plots) ? out.plots : []
    plots.forEach((plot, i) => validatePlot(plot, i, plotKeyIndex, inputsByKey, errors))

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
    validateFills(plots, errors)
    validateTreesAgainstPlots(out.compute, plots, errors)

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
