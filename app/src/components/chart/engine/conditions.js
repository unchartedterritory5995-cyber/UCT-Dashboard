import { parseFormula } from './ast/parse'
import { treeYieldsBool } from './ast/pine'
import { interpret, maxLookback } from './ast/interpret'
import { parseSource, barFieldSeries } from './sourceRef'
import { chartEvaluability, namesIn } from './operandCapability'
import { bindingKey } from './pool'
import { signalColumn } from './definitionSignal'

// ─── A CONDITION IS DATA ────────────────────────────────────────────────────
//
// ⭐⭐ IT IS NOT A CANDLE-COLOUR FEATURE, A MARKER FEATURE OR A BACKGROUND
// FEATURE. A condition answers ONE question — *what is true on this bar?* — and
// hands back TRUE / FALSE / UNKNOWN per bar. Visual ACTIONS consume that answer.
// Slingshot evaluates ONCE and feeds an orange candle and a blue dot; EMA9 >
// EMA20 evaluates once and feeds a green background. Later the same column can
// feed an alert or a label without anybody rebuilding the formula.
//
// ⛔⛔ AND ALMOST NONE OF THIS IS NEW MACHINERY, WHICH IS THE POINT. The audit
// found the pieces already shipped and load-bearing:
//
//   · `ast/parse.js` + `ast/interpret.js` — ONE parser, ONE evaluator, a closed
//     grammar table, a budget, a repaint linter and three import dialects.
//   · `closedTable.json::operators` already declares `yields: 'bool'` on `>`,
//     `<`, `>=`, `<=`, `==`, `!=`, `&&`, `||` and `!`. **The engine has always
//     produced boolean series** — a condition is a 0/1 column, and `_booleans`
//     says so in the manifest itself.
//   · `ast/pine.js::treeYieldsBool` is the ONE static "is this a condition"
//     resolver, derived from the manifest rather than a hand-list of operators.
//   · `builder/toCondition.js` already turns a numeric column into a condition
//     for the SCAN lane, and refuses a numeric tree by name.
//
// So this module adds a MODEL and a COLUMN TYPE, not a second formula engine.
//
// ⭐ THE SOURCE REFERENCE LANGUAGE IS ALSO REUSED, UNCHANGED. A condition may
// bind named series to another indicator's OUTPUT with the very same
// `'@instanceId::plotKey'` string the Moving Average takes — see
// `sourceRef.js`. That is what makes `EMA9 > EMA20` a real dependency rather
// than a formula that recomputes its own averages: the edge is the same edge,
// the sort is the same sort (`orderByDependency`), and invalidation is the same
// object identity.
//
// ⛔ AND IT COST THE GRAMMAR NOTHING. `interpret` already seeds `scope[name]`
// from the caller's `inputs` — it simply refused anything that was not a finite
// number, with a comment saying why. A COLUMN is the one other thing this table
// already understands (`TABLE.series` seeds Float64Arrays into the same scope),
// so binding a source is a widening of an existing deliberate rule and not a
// node type, not a vocabulary and not a second walker for Python to learn.

/** The three values a condition column may hold, in a `Uint8Array`.
 *
 * ⭐ ONE BYTE PER BAR — 10 KB for a 10,000-bar chart, versus 80 KB for a
 * `Float64Array` and versus ten thousand React objects, which is the shape this
 * app has been bitten by before. Three values, not two, because "false" and "we
 * cannot say yet" are different answers: a 20-period average has no opinion on
 * bar 3, and painting bar 3 as *not* matching would be a claim nobody made.
 *
 * ⛔ NOT `NaN`-IN-A-FLOAT-COLUMN, which is how `events[]` spells the same idea.
 * That shape is right there — it is the domain the registration gate enforces
 * (`defSchema.EVENT_COLUMN_DOMAIN`) — and it is right for a column a DEFINITION
 * returns, because the definition's compute is a black box that has to hand back
 * one array type. A condition is evaluated by this module, for this module, so it
 * can afford the tighter representation.
 */
export const COND_FALSE = 0
export const COND_TRUE = 1
export const COND_UNKNOWN = 2

/** A stable id for a new condition. Opaque, and never derived from the NAME —
 *  renaming "Inside Bar" to "Inside Candle" must not orphan its actions. */
let _seq = 0
export function newConditionId() {
  _seq += 1
  return `cond:${Date.now().toString(36)}:${_seq}`
}

/** The list, normalised. Anything malformed is DROPPED rather than thrown over:
 *  one bad row in a settings blob must not take the chart down with it. */
export function normaliseConditions(cs) {
  const raw = cs && Array.isArray(cs.conditions) ? cs.conditions : []
  const out = []
  const seen = new Set()
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue
    if (typeof c.id !== 'string' || !c.id || seen.has(c.id)) continue
    // ⭐⭐ TWO VALID FORMS, AND THE SECOND IS WHY THIS TEST MOVED.
    //
    //   LEGACY INLINE   { formula, bindings }   — may name chart instances
    //                                              (`@instanceId::plotKey`), follows
    //                                              them, lives only in this blob.
    //   DEFINITION-BACKED { definitionId }      — the durable boolean user
    //                                              definition owns the formula.
    //
    // ⛔ A DEFINITION-BACKED ROW HAS NO FORMULA OF ITS OWN, so requiring one
    // dropped it silently — the condition would vanish from the chart with nothing
    // saying why. A row must carry ONE of the two, and carrying neither is what is
    // malformed.
    const hasFormula = typeof c.formula === 'string' && !!c.formula.trim()
    const hasDefinition = typeof c.definitionId === 'string' && !!c.definitionId.trim()
    if (!hasFormula && !hasDefinition) continue
    seen.add(c.id)
    out.push({
      id: c.id,
      // ⛔ CANONICAL WHEN PRESENT. A definition-backed condition's truth is the
      // DEFINITION's; any `formula` still on the row is a non-authoritative
      // compatibility copy and nothing reads it for evaluation or for editing.
      definitionId: hasDefinition ? c.definitionId.trim() : null,
      name: typeof c.name === 'string' && c.name.trim() ? c.name : 'Condition',
      formula: hasFormula ? c.formula : '',
      // ⚠️ `enabled` DEFAULTS TO TRUE, and absence is the default's spelling.
      // Additive persistence: a row written before an `enabled` key existed is on.
      enabled: c.enabled !== false,
      bindings: (c.bindings && typeof c.bindings === 'object' && !Array.isArray(c.bindings))
        ? { ...c.bindings } : {},
      actions: Array.isArray(c.actions) ? c.actions.filter((a) => a && typeof a === 'object') : [],
    })
  }
  return out
}

/**
 * A condition, shaped as an INSTANCE so the shipped dependency sort can carry it.
 *
 * ⭐⭐ NO SECOND SCHEDULER, WHICH PART 8 ASKS FOR BY NAME. `orderByDependency` is
 * Kahn's algorithm over `{instanceId, defId, inputs}` rows whose definition
 * declares `type: 'source'` inputs — it never asks what KIND of thing a row is.
 * So a condition with two bound series is just another node with two edges, and
 * `RSI → MA(RSI) → (RSI > MA(RSI)) → actions` sorts itself.
 */
export function conditionInstance(cond) {
  return {
    instanceId: cond.id,
    defId: `__condition__${cond.id}`,
    hidden: false,
    inputs: { ...cond.bindings },
  }
}

/** The synthetic definition for one condition — the `source` inputs it binds.
 *  Built from the BINDINGS the user made, so a condition that binds nothing is a
 *  definition with no inputs and therefore no edges. */
export function conditionDef(cond) {
  return {
    id: `__condition__${cond.id}`,
    inputs: Object.keys(cond.bindings || {}).map((key) => ({
      key, type: 'source', default: 'close',
    })),
  }
}

/** `defId → definition` for a list of conditions, for `orderByDependency`. */
export function conditionDefOf(conditions) {
  const byDefId = new Map()
  for (const c of conditions) byDefId.set(`__condition__${c.id}`, conditionDef(c))
  return (defId) => byDefId.get(defId) || null
}

// ─── VALIDATION ─────────────────────────────────────────────────────────────

/**
 * Does this text answer a condition's question?
 *
 * ⛔⛔ A NUMERIC FORMULA IS REFUSED, NOT COERCED (Part 44). `<tree> != 0` over a
 * price column is true for every symbol trading above zero, so admitting `rsi`
 * as a condition would colour every candle on the chart and say nothing. This is
 * the same gate `builder/toCondition.js` puts in front of the SCAN lane, asked
 * through the same resolver — `treeYieldsBool`, which reads the manifest's
 * `yields` rather than a hand-list of comparison operators.
 *
 * @returns {{ok: true, ast: object} | {ok: false, reason: string}}
 */
export function validateConditionFormula(formula, bindings) {
  if (typeof formula !== 'string' || !formula.trim()) {
    return { ok: false, reason: 'a condition needs a formula' }
  }
  const parsed = parseFormula(formula)
  if (!parsed.ok || !parsed.ast) {
    return { ok: false, reason: parsed.error || 'this formula does not read back' }
  }
  // A bound name is a SERIES the table has never heard of, so it cannot be
  // type-resolved by the manifest. `treeYieldsBool` sees it as an ordinary
  // series read, which is exactly right: `a > b` yields bool whatever `a` is.
  let bool = false
  try { bool = !!treeYieldsBool(parsed.ast) } catch { bool = false }
  if (!bool) {
    return {
      ok: false,
      reason: 'a condition must answer true or false — compare it to something '
        + '(for example `rsi(close, 14) > 70`)',
    }
  }
  if (bindings && typeof bindings === 'object') {
    for (const key of Object.keys(bindings)) {
      if (!parseSource(bindings[key])) {
        return { ok: false, reason: `the source bound to \`${key}\` cannot be read` }
      }
    }
  }
  // ⛔⛔ NO SILENT DEAD CONDITIONS. `interpret` seeds every table-declared SCALAR
  // as NaN when no `scalars` are passed, and a chart never passes any — it draws
  // one symbol from bars, not a `screener_rows` row. Measured before this guard
  // existed: `adr_pct > 5` validated, saved, and was FALSE on 300 of 300 bars with
  // `error: null`. A member would have built a regime band that can never paint and
  // been told nothing. The screener lane is untouched: those columns are perfectly
  // valid there, and this refusal is a CONSUMER capability, not a verdict on them.
  const runnable = chartEvaluability(parsed.ast)
  if (!runnable.ok) return { ok: false, reason: runnable.reason }
  return { ok: true, ast: parsed.ast }
}

// ─── EVALUATION ─────────────────────────────────────────────────────────────

/**
 * Resolve one condition's bound series to columns.
 *
 * ⭐ THE SAME TWO KINDS `sourceRef` ALREADY KNOWS: a bar field, or another
 * instance's OUTPUT. `columnOf` is the binder's map, so an output is the very
 * array its producer computed — which is what makes invalidation identity.
 *
 * @returns {{series: object, missing: string[]}}
 */
export function resolveBindings(cond, bars, columnOf) {
  const series = {}
  const missing = []
  for (const [key, ref] of Object.entries(cond.bindings || {})) {
    const parsed = parseSource(ref)
    if (!parsed) { missing.push(key); continue }
    if (parsed.kind === 'bar') { series[key] = barFieldSeries(bars, parsed.field); continue }
    const col = columnOf ? columnOf(bindingKey(parsed.instanceId, parsed.plotKey)) : null
    if (!col) { missing.push(key); continue }
    series[key] = col
  }
  return { series, missing }
}

/**
 * Evaluate one condition into a `Uint8Array` of TRUE / FALSE / UNKNOWN.
 *
 * ⛔ IT RETURNS `null` RATHER THAN AN ALL-FALSE COLUMN when the formula refuses
 * or a bound source is missing. All-false is a CLAIM — "this never happened" —
 * and the two states a member needs to tell apart are "it did not fire" and
 * "this is not currently answerable". The consumers draw nothing for `null` and
 * the settings row says why.
 *
 * @param {object} cond      a normalised condition
 * @param {object[]} bars
 * @param {Function} columnOf  bindingKey → column, from the binder
 * @returns {{column: Uint8Array|null, error: string|null, missing: string[]}}
 */
/**
 * A numeric column → the {FALSE, TRUE, UNKNOWN} verdict column.
 *
 * ⭐ SHARED BY BOTH CONDITION FORMS ON PURPOSE. The inline and the
 * definition-backed branch differ only in where the numbers come from; a second
 * copy of this loop is how "unknown" would come to mean two things.
 */
function packColumn(raw, n, warm, unavailable = null) {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (i < warm || (unavailable !== null && unavailable[i])) { out[i] = COND_UNKNOWN; continue }
    const v = raw[i]
    // ⛔ `Number.isFinite`, NOT `!Number.isNaN` — an `Infinity` from a division
    // is not a verdict either, and reading it as TRUE would fire a rule on the
    // one bar whose arithmetic blew up.
    out[i] = !Number.isFinite(v) ? COND_UNKNOWN : (v !== 0 ? COND_TRUE : COND_FALSE)
  }
  return out
}

/**
 * Which bars a BOUND SOURCE has no number for — or `null` when none do.
 *
 * ⭐⭐ UNKNOWN IS NOT FALSE, AND A BOUND SOURCE IS WHERE THE TWO GOT MERGED.
 * `maxLookback('a > 50')` is **0** — the tree names a binding, not a function with
 * a window — so nothing masked the head. Meanwhile the bound RSI column is `NaN`
 * for its first 14 bars, and `NaN > 50` resolves to **0** by design (the table
 * pins a comparison against NaN at FALSE, which is Pine's rule and the one the
 * scan lane is tested against). So a finite `0` arrived at `packColumn` and was
 * read as "evaluated, and false" on bars where nothing had been evaluated at all.
 *
 * The same condition written standalone — `rsi(close, 14) > 50` — reports UNKNOWN
 * over that head, because `maxLookback` can see the `rsi` call. Two spellings of
 * one idea, two different truth columns. This is what closes that.
 *
 * ⛔ ONLY THE NAMES THE FORMULA ACTUALLY READS. A condition may carry a binding it
 * no longer uses (`b` left over after an edit); masking on that one's warm-up
 * would call bars unknown that the formula has a perfectly good answer for.
 *
 * ⚠️ AND IT IS PER-BAR, NOT A LEADING HEAD. A bound source can go non-finite in
 * the middle of a series, and "the condition could not be meaningfully evaluated"
 * is equally true there — `trueRuns` already treats UNKNOWN as breaking a run
 * rather than extending one, so a mid-series gap draws as a gap.
 */
function unavailableFromSources(series, ast, n) {
  const used = new Set(namesIn(ast))
  let mask = null
  for (const [key, col] of Object.entries(series || {})) {
    if (!used.has(key) || !col) continue
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(col[i])) continue
      if (mask === null) mask = new Uint8Array(n)
      mask[i] = 1
    }
  }
  // ⭐ `null` WHEN NOTHING IS UNAVAILABLE, so the overwhelmingly common case —
  // a self-contained formula, or a fully warm source — allocates nothing and
  // `packColumn`'s inner test short-circuits on identity.
  return mask
}

export function evaluateCondition(cond, bars, columnOf, registry) {
  const n = Array.isArray(bars) ? bars.length : 0

  // ─── THE DEFINITION-BACKED FORM ───────────────────────────────────────────
  //
  // ⭐⭐ ONE AUTHORED TRUTH, READ — NOT RE-AUTHORED. A durable condition owns no
  // formula; the user definition does. So this branch does not parse, does not
  // build a second tree and does not run a second evaluator — it asks the registry
  // for the column it already computes for that definition, and hands it to the
  // same warm-up and packing every inline condition goes through. The actions
  // downstream (candle colour, marker, background) cannot tell the two apart, and
  // that is the point.
  //
  // ⛔ AND THERE IS NO FALLBACK TO A COMPATIBILITY FORMULA. A row may still carry
  // the text it was promoted from; it is not authoritative, and reading it when the
  // definition is missing would be exactly the "two editable truths" this model
  // exists to prevent — the chart would quietly shade on the OLD maths.
  if (cond && cond.definitionId) {
    if (!registry || typeof registry.getDefinition !== 'function') {
      return { column: null, error: 'Source unavailable', missing: [cond.definitionId] }
    }
    const def = registry.getDefinition(cond.definitionId)
    if (!def) return { column: null, error: 'Source unavailable', missing: [cond.definitionId] }
    let cols
    try {
      cols = registry.computeFor(def, bars, undefined, undefined)
    } catch (err) {
      return { column: null, error: String(err && err.message ? err.message : err), missing: [] }
    }
    // ⛔ THE SIGNAL PLOT, NOT WHICHEVER KEY THE REGISTRY BUILT FIRST. The alert
    // lane addresses `compute.scanPlot`; a chart that shaded on plot 1 instead
    // would disagree with the alert armed on the very same condition, and both
    // would look right from where they stand.
    const raw = signalColumn(def, cols)
    if (!raw) return { column: null, error: 'Source unavailable', missing: [cond.definitionId] }
    // ⚠️ THE WARM-UP IS THE DEFINITION'S TREE'S, asked of the same static
    // `maxLookback` an inline condition asks — so "cannot say yet" means the same
    // thing in both forms, and an UNKNOWN head can never read as a false→true edge.
    let warm = 0
    try { warm = maxLookback(def.compute && def.compute.ast) } catch { warm = 0 }
    if (!Number.isInteger(warm) || warm < 0) warm = 0
    return { column: packColumn(raw, n, warm), error: null, missing: [] }
  }

  const check = validateConditionFormula(cond.formula, cond.bindings)
  if (!check.ok) return { column: null, error: check.reason, missing: [] }

  const { series, missing } = resolveBindings(cond, bars, columnOf)
  if (missing.length) {
    return { column: null, error: 'Source unavailable', missing }
  }

  let raw
  try {
    // ⭐ THE BOUND COLUMNS RIDE `inputs`, which `interpret` already seeds into
    // its scope by name. Nothing else is passed: no scalars (a chart draws one
    // symbol) and no budget override (the default caps a member's formula).
    raw = interpret(check.ast, bars, series)
  } catch (err) {
    return { column: null, error: String(err && err.message ? err.message : err), missing: [] }
  }

  // ⭐⭐ THE WARM-UP IS TAKEN FROM THE TREE, NOT FROM THE ANSWER, AND IT HAS TO
  // BE — MEASURED.
  //
  // `close > sma(close, 20)` returns **0** on bar 0, not `NaN`: this engine
  // resolves a comparison against `na` to FALSE, which is Pine's rule and the
  // rule the SCAN lane has always been tested against (`pine.naGuard`,
  // `pine.boolcast`). Right for a scan — a symbol with no 20-bar history does not
  // pass a filter — and wrong for a CHART, where "did not match" and "cannot say
  // yet" are drawn the same and mean different things.
  //
  // ⛔ SO IT IS ASKED OF `maxLookback`, THE ENGINE'S OWN STATIC ANALYSIS — the
  // one the repaint linter and the budget already read — rather than re-derived
  // from a hand-list of which functions warm up. A twelfth function is covered on
  // the day it lands.
  //
  // ⚠️ AND IT IS CONSERVATIVE BY AT MOST ONE BAR. A lookback of 20 counts the
  // current bar for `sma(close, 20)` (first finite value at index 19) and does
  // not for `high[1]` (first answerable at index 1), so taking `i < lookback`
  // uniformly can call ONE genuinely-answerable bar unknown at the far-left edge.
  // That is the safe direction: saying "we cannot tell" where we could have told
  // costs a bar of ink; the other way round states a verdict nobody computed.
  let warm = 0
  try { warm = maxLookback(check.ast) } catch { warm = 0 }
  if (!Number.isInteger(warm) || warm < 0) warm = 0

  // ⭐⭐ AND THE BOUND SOURCES' OWN WARM-UP, WHICH THE TREE CANNOT SEE. See
  // `unavailableFromSources`: this is what makes `a > 50` with `a = RSI(14)` and
  // `rsi(close, 14) > 50` report the same UNKNOWN head.
  return {
    column: packColumn(raw, n, warm, unavailableFromSources(series, check.ast, n)),
    error: null,
    missing: [],
  }
}

/**
 * Contiguous TRUE runs, as `[startIndex, endIndexInclusive]` pairs.
 *
 * ⭐⭐ THIS IS THE WHOLE OF PART 28, AND IT IS WHY A BACKGROUND IS CHEAP. A
 * regime that is true for 4,000 bars is ONE rectangle, not four thousand. The
 * shipped `sessionShadingPrimitive` already derives session bands exactly this
 * way and paints one `fillRect` per band; this is the same derivation over a
 * condition column instead of a clock.
 *
 * ⚠️ `UNKNOWN` BREAKS A RUN, it does not extend one. A warm-up gap in the middle
 * of a regime is a gap in what we can say, and bridging it would paint a claim
 * across bars the formula had no answer for.
 */
export function trueRuns(column) {
  const out = []
  if (!column || typeof column.length !== 'number') return out
  let start = -1
  for (let i = 0; i < column.length; i++) {
    const on = column[i] === COND_TRUE
    if (on && start < 0) start = i
    else if (!on && start >= 0) { out.push([start, i - 1]); start = -1 }
  }
  if (start >= 0) out.push([start, column.length - 1])
  return out
}
