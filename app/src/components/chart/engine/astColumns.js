// app/src/components/chart/engine/astColumns.js
//
// ─── ⭐⭐ THE HOST LANE'S VALUES, HOST-NEUTRAL (`compute.kind: 'ast'`) ───────────────────────
//
// What `nativeRegistry.computeFor` computes for an `ast` document: the member's settings written
// in (`specializeSymbols`, `specializeParams`), a `calc_bars_count` window, the bind-time fold, the
// other-symbol and lower-timeframe decisions, `interpret` per tree, and every by-name withholding
// it records on the column map. MOVED HERE UNCHANGED from `nativeRegistry.js` (HEADLESS, R6), which
// imports it back and re-exports every name it exported before, so no importer moved.
//
// ⛔ WHY IT MOVED: the server bundle (`runtime/serverEntry.js`) may not reach the chart registry
// (`tools/pine_runtime_closure.mjs`: it fetches, reads build flags and per-tab lists), and the
// headless export (`headlessCompute.js`) computes a document's values in that bundle. One compute,
// two callers: the chart composes this with the run-read parts that answer to its tab's gates
// (`nativeRegistry.astRunExtras`); the headless export composes it with none and says so.
// ⛔ ONE ADDITION, INERT ON THE CHART: `ctx.workSink` reaches every `interpret` here as
// `opts.workSink`, where the evaluator counts its node evaluations (`interpret.js::evalNode`).
// No chart sets it, so the chart's `interpret` options are the ones they were.
import { interpret, listingSeedIsUnpinned } from './ast/interpret'
import { ENGINE_ERROR, isRefusal } from './ast/parse'
import { foldBound, bindConstsFor } from './ast/bind'
import {
  otherSymbolRefusalOfTree, isOtherSymbolRefusal, colourReaderRefusal, colourReaderMessage, plotValueIsNaLiteral,
  withChartNewestDay,
} from './otherSymbols'
import { resolveLowerTf } from './lowerTf'
import { blockRunsRefusal, BLOCK_RUNS_GUARD } from './blockRuns'
import { chartStaticRefusals, otherSymbolsDecision } from './evaluability'
import { semanticsOptsFor } from './definitionSemantics'
import { inputsAsRead } from './legacyInputs.js'
import { specializeParams } from './paramInputs.js'
import { specializeSymbols } from './symbolInputs.js'
import { calcBarsWindowOf, windowContext, widenToChart, withCalcBarsRecord, calcBarsWindowReport,
  CALC_BARS_REQUEST_GUARD, calcBarsRequestSentence } from './calcBarsWindow.js'
import { RUNTIME_OBJECTS_KEY } from './runtime/runtimeObjects'
import { runtimeOvernightOf } from './runtime/overnightTail.js'

/** ⭐ HEADLESS (R6) — the caller's evaluation counter, as `interpret` reads it (`opts.workSink`).
 *  `{}` without one: the options every chart hands are unchanged. */
const workSinkOf = (ctx) => (ctx && ctx.workSink ? { workSink: ctx.workSink } : {})
/** ⭐⭐ U-DAILY (e96) — the daily bars a daily read (`tf` of D) is computed on, as `interpret` reads them
 *  (`opts.frames.D = {bars, symbols, newestFinal, place}`, built by the binder: `dailyReadSupply.js`). `{}` without
 *  one: every other chart's options are unchanged, and a daily read there is withheld by name. */
const dailyFramesOf = (ctx) => (ctx && ctx.dailyFrame ? { frames: { D: ctx.dailyFrame } } : {})

/**
 * The ONE data-bearing plot key an `ast` definition declares.
 *
 * ⛔ READ OFF `def.plots`, NOT `columnKeys(def)`, AND THE DIFFERENCE IS LOAD-
 * BEARING. `columnKeys` is the union of plots and EVENTS. If this read that
 * union, an `ast` definition that declared an event would compute its event key
 * instead of its plot — a column with the wrong name, full of the right numbers.
 * Reading the plots means an `ast` definition's events simply never come back,
 * and `validateEventColumns` — which already refuses a definition whose event
 * names no returned column — refuses it BY NAME at registration. One guard, at
 * the door it was built for, rather than a second one bolted on here.
 */
export function astPlotKey(def) {
  const plots = Array.isArray(def?.plots) ? def.plots : []
  const keys = plots
    .filter(p => p && p.style !== 'hlines' && typeof p.key === 'string')
    .map(p => p.key)
  return keys
}

/**
 * The definition's tree MAP, or `null` for the single-tree (pre-W1b) shape.
 *
 * ⛔ ONE PREDICATE, TWO CALLERS, ON PURPOSE. `astColumnsFor` and
 * `validateAstLane` both branch on "does this document carry trees", and they
 * must branch identically or a document could validate down one shape and
 * compute down the other — the second-authority-over-one-value defect this repo
 * names most often. Anything that is not a plain object is `null` here and takes
 * the single-tree path in BOTH; `defSchema.validateTrees` is what refuses the
 * malformed map by name, and it runs first.
 */
export function astTrees(def) {
  const trees = def && def.compute && def.compute.trees
  return (trees && typeof trees === 'object' && !Array.isArray(trees)) ? trees : null
}

/**
 * Compute an `ast` definition: ONE TREE, ONE COLUMN — as many of each as the
 * document declares.
 *
 * `interpret` returns a single `Float64Array` of `bars.length` — the columnar
 * contract already, with no adaptation to do — so the only question this
 * function answers is WHICH KEY each one goes under.
 *
 * ⭐ TWO SHAPES, ONE RULE (W1b). A document carrying `compute.trees` names a
 * tree PER PLOT and gets a column per plot. A document without one carries a
 * single tree in `compute.ast` and must declare exactly one data plot —
 * `validateUserDefinitions` refuses a second, and the throw below is the
 * backstop for a definition that reached `computeFor` without passing through
 * that door. The second shape is every definition saved before W1b, and it
 * computes byte-identically to the way it did then.
 *
 * ⛔ IT DOES NOT CATCH. `interpret` throws `TableRefusal` for anything the table
 * refuses and a plain `RangeError` for a tree that overflows; relabelling either
 * as "computed nothing" is the wrong-door defect this phase has now found four
 * times. A refusal must reach the caller as the refusal it is.
 */
/** The key every partial-compute result carries its reasons under.
 *  ⛔ NON-ENUMERABLE, AND THAT IS THE WHOLE DESIGN. Every consumer of a column
 *  map walks it with `Object.keys` (the binder's `for (const plotKey of
 *  Object.keys(cols))` is the one that matters), and a visible extra key would
 *  become a phantom plot on every chart. */
const COLUMN_ERRORS = '__columnErrors'

/** Attach the per-column reasons to a column map without widening its key set. */
export function withColumnErrors(out, errors) {
  if (errors && Object.keys(errors).length) {
    Object.defineProperty(out, COLUMN_ERRORS, { value: Object.freeze(errors), enumerable: false })
  }
  return out
}

/**
 * ⭐⭐ WHY A COLUMN IS MISSING — the structured state C2A.8 asks be preserved.
 *
 * A column map returned by `computeFor` holds only the columns that COMPUTED.
 * This is how a caller learns that a key is absent because it exceeded a limit
 * rather than because the definition never declared it — which are different
 * facts and, without this, indistinguishable.
 *
 * ⛔ IT IS NOT UX. No surface renders it yet, deliberately (C2A.8: "do not build
 * broad new UX in this wave"). It exists so that the day one does, the product
 * can say WHICH output and WHICH limit instead of re-deriving a guess — and so
 * that "the indicator drew nothing" and "one of its seven columns is too
 * expensive" stop being the same observation.
 *
 * @returns {Record<string, {guard: string, message: string}>} possibly empty
 */
export function columnErrors(columns) {
  const e = columns && columns[COLUMN_ERRORS]
  return e || {}
}

// ─── ⭐⭐ C43 — A REACHED `runtime.error` LEAVES NO COLUMN ────────────────────────
//
// TradingView's study holds NOTHING once the script's own `runtime.error` is
// reached on any bar (measured — see `runtimeErrorStop.js`). The evaluator is
// REGISTERED here by that module rather than imported: it reads the object
// lane's warm-up probe, and this module must not pull the object lane into its
// chunk. Unregistered (a caller that computes columns without the object lane
// loaded), every document computes as it always did.
let runtimeErrorStopFn = null
export function registerRuntimeErrorStop(fn) {
  runtimeErrorStopFn = typeof fn === 'function' ? fn : null
}

/** The guard a column refused by the script's own error carries. */
export const RUNTIME_ERROR_GUARD = 'pine:runtime.error'

/** The key a column map carries the stop decision under — non-enumerable for the
 *  reason `__columnErrors` is (a visible key is a phantom plot). */
const RUNTIME_ERROR_STOP = '__runtimeErrorStop'

/** What the script's `runtime.error` calls did on the bars a column map was
 *  computed over: `{reached, bar, sentence, unknown, unread, …}`, or null for a
 *  document that carries none. `unknown` names each call this binding could not
 *  evaluate — the columns are then the unstopped ones, as before C43. */
export function runtimeErrorStopOf(columns) {
  return (columns && columns[RUNTIME_ERROR_STOP]) || null
}

export function withRuntimeErrorStop(out, stop) {
  if (stop) Object.defineProperty(out, RUNTIME_ERROR_STOP, { value: stop, enumerable: false })
  return out
}

/** ⭐ HOST WORKER — the registered `runtime.error` evaluator's answer for these arguments (null with
 *  no evaluator or no stamp): the stop `astColumnsFor` reads. Its own function so the chart can ask
 *  it on the main thread, where the evaluator is registered (`runtimeErrorStop.js`, which reaches
 *  the chart registry), and hand the answer to a worker that computes the values
 *  (`hostLaneWorkerCore.js`). */
export function astRuntimeErrorStop(def, bars, inputs, ctx) {
  return runtimeErrorStopFn && def && def.meta && def.meta.runtimeErrors
    ? runtimeErrorStopFn(def, bars, inputs, ctx)
    : null
}

function astColumnsFor(def, bars, inputs, ctx) {
  return astColumnsGiven(def, bars, inputs, ctx, astRuntimeErrorStop(def, bars, inputs, ctx))
}

/** ⭐ HOST WORKER — `astColumnsFor` with its `runtime.error` stop already decided
 *  (`astRuntimeErrorStop`, same arguments). The ONE body both threads run: the main thread through
 *  `astColumnsFor`, the host lane's worker through `hostLaneWorkerCore.js`. */
export function astColumnsGiven(def, bars, inputs, ctx, stop) {
  if (stop && stop.reached) {
    // ⛔ EVERY COLUMN, AND BY NAME: an absent column with no reason reads as "the
    // definition never declared it" (`columnErrors`).
    const errors = {}
    for (const key of astPlotKey(def)) errors[key] = { guard: RUNTIME_ERROR_GUARD, message: stop.sentence }
    return withRuntimeErrorStop(withColumnErrors({}, errors), stop)
  }
  const out = astColumnsUnstopped(def, bars, inputs, ctx)
  return stop ? withRuntimeErrorStop(out, stop) : out
}

/** ⭐⭐ ENGINE 55 (review F1) — `column:<key>` → `<key>`, or null. */
const colourHelperKeyOf = (mode) => (typeof mode === 'string' && mode.startsWith('column:') ? mode.slice('column:'.length) : null)

/** The name a member reads for a plot: its label, never its key. */
const visiblePlotName = (p) => `\`${(p && (p.label || p.title)) || (p && p.key) || 'a plot'}\``

/** ⭐⭐ ENGINE 55 (review F1) — SERVE, NEVER DEFAULT. A plot whose per-bar COLOUR (`colorMode`) or
 *  band colour (`fill.colorMode`) is read from a helper column the bind REFUSED for another
 *  symbol is refused too, by name, with the helper's guard and code and a sentence naming the
 *  visible plot and the symbol (`otherSymbols.colourReaderRefusal`). ⚰️ The helper was refused
 *  and the plot was not: the binder found no colour column, `pointColour` answered null, and the
 *  series' DEFAULT colour was drawn on every bar — a colour the script never chose.
 *  ⛔ A band's PARTNER (`fill.with`) refused is not this: that partner is a visible plot refused
 *  by name, the band has no edge to draw, and the owner's own line is still exact.
 *  ⛔ A plot whose VALUE is the `na` literal draws nothing on any bar, so its colour is never
 *  seen: it is not refused (`plotValueIsNaLiteral`). */
function refuseColourReaders(def, out, errors) {
  const trees = def && def.compute && def.compute.trees
  for (const p of (def && def.plots) || []) {
    if (!p || typeof p.key !== 'string' || errors[p.key]) continue
    if (trees && plotValueIsNaLiteral(trees[p.key])) continue
    const helpers = [colourHelperKeyOf(p.colorMode), p.fill ? colourHelperKeyOf(p.fill.colorMode) : null]
      .filter((k) => typeof k === 'string' && k && k !== p.key)
    const hit = helpers.map((k) => errors[k]).find(isOtherSymbolRefusal)
    if (!hit) continue
    delete out[p.key]
    errors[p.key] = colourReaderRefusal(visiblePlotName(p), hit)
  }
}

/** ⭐⭐ ENGINE 55 (review F1) — the paints (`bgcolor` / `barcolor`) whose colour is read from a
 *  helper column refused for another symbol, each named for the strip by its kind and line —
 *  never by the hidden helper row that carried the colour. */
export function colourReaderPaintNotices(def, columns) {
  const errs = columnErrors(columns)
  const out = []
  for (const paint of (def && Array.isArray(def.paints) ? def.paints : [])) {
    const key = paint && colourHelperKeyOf(paint.colorMode)
    const e = key ? errs[key] : null
    if (!isOtherSymbolRefusal(e)) continue
    const name = `\`${paint.kind || 'bgcolor'}\`${Number.isInteger(paint.line) ? ` (line ${paint.line})` : ''}`
    out.push({ code: e.code || e.guard, reason: colourReaderMessage(name, e.message) })
  }
  return out
}

function astColumnsUnstopped(def, bars, inputs, ctx) {
  const keys = astPlotKey(def)
  const trees = astTrees(def)
  // ⭐⭐ C29 — a document folded at another chart period does not answer here
  // (`periodReads.js`): every column is refused by name, none drawn off the
  // other period's constants.
  // ⭐⭐ P0 — A READ BELOW THE CHART (`ltf`) IN A DOCUMENT THAT IS NOT A PINE
  // TRANSLATION IS REFUSED BY NAME, per plot. Its supply (`lowerTfFor`) is built
  // from the member door's stamp and its admission rules (`lower-tf:expression`,
  // `lowerTf.js`) are checked by the Pine translator — neither exists for a
  // typed formula, so it was accepted and starved: all-NaN, no report.
  // ⭐ P0 0F — a plot that reads a current-only scalar is refused by name
  // (`chartScalars.js`), never drawn as the 0 a comparison makes of its hole.
  // ⭐⭐ P1 — ALL THREE ARE DECIDED BY THE SHARED GATE (`evaluability.js::
  // chartStaticRefusals`), so `evaluability(def, key, 'chart', ctx)` and this
  // compute can never disagree about a pre-compute refusal. `whole` = the
  // document computes nothing here; `staticWhy` = per plot (period > ltf > scalar).
  const { whole, perKey: staticWhy } = chartStaticRefusals(def, ctx)
  if (whole) return withColumnErrors({}, whole)
  // ⭐⭐ THE BIND STAGE. One symbolic definition, folded per (symbol, timeframe)
  // into the integers THIS binding needs. `Uncharted Volume` line 233's
  // `timeframe.isweekly ? 5 : 20` becomes 5 on a weekly binding and 20 on a
  // daily one — measured against the vendor on 2026-09-10 (job B: `fold==sma20`
  // on 400/400 daily bars, `fold==sma5` on 400/400 weekly).
  // ⛔ COMPUTE-SCOPED AND DISCARDED. `foldBound` returns a NEW tree and mutates
  // nothing, and `bound` is a local — the SAVED definition stays symbolic, which
  // is the only thing that keeps the next binding free to fold it differently.
  // ⛔ AN UNFOLDABLE LENGTH IS LEFT EXACTLY AS IT WAS, never guessed: the window
  // check downstream then refuses the member's own expression, naming the field
  // that stopped it. An unknown timeframe folds NOTHING — `timeframeFlags`
  // returns null rather than a default, because a guessed `isdaily` is a
  // confident wrong length.
  const bindConsts = bindConstsFor({ tf: ctx && ctx.tf, inputs, symbol: ctx && ctx.symbol })
  const bound = (tree) => foldBound(tree, bindConsts)
  // ⭐⭐ C26 — which other symbols this binding may read, decided ONCE for every
  // tree of the document (`otherSymbolsFor`).
  const other = otherSymbolsFor(def, withChartNewestDay(ctx, bars))   // ⭐ RS RATING L11 PR 2: the bind reads no bars
  // ⭐⭐ C41 — which lower-timeframe codes this binding may read, decided ONCE for
  // every tree of the document (`lowerTfFor`). Null for a document that reads none.
  const lower = lowerTfFor(def, ctx)
  // ⭐⭐ W1b — MANY TREES, ONE COLUMN EACH. `interpret` runs once PER PLOT and the
  // result is keyed by the plot, which is the whole of the multi-plot lane: the
  // MACD's three lines are three trees, not one column reshaped. The single-tree
  // path below is untouched, so a document saved before today computes the same
  // bytes through the same call.
  //
  // ⛔ A PLOT WITH NO TREE IS REFUSED BY THE PLOT'S NAME, NOT LEFT TO
  // `interpret`. `defSchema.validateTreesAgainstPlots` already refuses the
  // key-set disagreement in both directions, so a definition that walked through
  // `validateUserDefinitions` cannot arrive here short a tree — but `computeFor`
  // takes a definition object from ANY caller (which is the reason the
  // "computes ONE column" throw below has always existed), and handing
  // `interpret` an `undefined` tree would surface as a parse-shaped error about
  // a node, blaming the formula for a document defect.
  if (trees) {
    const out = {}
    const errors = {}
    // ⭐⭐ C2C.11 — ONE MEMO FOR THE WHOLE DOCUMENT'S COLUMNS, CREATED HERE AND
    // DROPPED HERE. A multi-plot import computes one consensus expression and
    // plots several views of it (C2A: 77-84% of a real document's counted nodes
    // are repeated subtrees), and until now every view paid for the whole thing
    // again because `interpret`'s own memo is scoped to one tree.
    //
    // ⛔ ITS LIFETIME IS THIS CALL. The columns it holds were computed against
    // THESE bars and THESE inputs; a memo that outlived the pass would serve
    // stale numbers with nothing red anywhere. It is a local, never a module
    // cache, and it is not keyed — so there is nothing to invalidate and no way
    // to forget to.
    //
    // ⚠️ IT ONLY PAYS WHEN THE TREES ACTUALLY SHARE NODES, which is what a
    // document stored as a shared graph gives (its expansion materialises each
    // distinct node once). On an inlined document every lookup misses and the
    // cost is one Map probe per self-free node.
    const crossMemo = new Map()
    // ⭐ C36 — why a plot's `time(<timeframe>)` is withheld on this chart, per plot.
    const clock = {}
    // ⭐ ENGINE 56 — plot key → Map(code → 0/1 column): the bars a per-bar witness mask
    // withheld by name (`interpret.js::spreadWitnessMask`), read by `withheldBarsReport`
    const withheldBars = {}
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(trees, key)) {
        throw new Error(
          `computeFor: plot ${JSON.stringify(key)} of ${JSON.stringify(def?.id)} has no tree in ` +
          `compute.trees (${Object.keys(trees).join(', ') || 'none'}) — a plot with no tree is a key ` +
          `nothing ever fills.`,
        )
      }
      // ⚠️ SAME ARGUMENTS AS THE SINGLE-TREE CALL BELOW, INCLUDING `ctx.tf` AND
      // THE `undefined` SCALARS — see that call's comments. One budget covers
      // every tree because the budget is the DOCUMENT's (`compute.budget`), and
      // a map over `interpret` that dropped it would run every plot uncapped.
      //
      // ⛔⛔ ONE COLUMN'S FAILURE IS ONE COLUMN'S FAILURE (C2A).
      //
      // ⚰️ MEASURED ON A REAL SCRIPT. `mid_engagement__14-master-line-lite`
      // declares 7 columns. Three of them — Consensus and the two bands —
      // compute cleanly at the 5,000 bars a chart loads (4,945 finite values
      // each, 6-20 ms). The other four are `accum` recurrences whose
      // `bars × warmup` exceeds `MAX_RECURRENCE_STEPS`, and they refuse.
      //
      // This loop had no `try`. The fourth tree threw, the loop unwound,
      // `computeFor` threw, and the binder's `attempt(...)` caught it and
      // `continue`d PAST THE WHOLE INSTANCE — so all seven plots drew nothing.
      // Measured through this very function: OK at 1, 2 and 3 columns; throws
      // from the 4th on. Three good columns were erased by a fourth.
      //
      // ⛔ THE BUDGET WAS NEVER SHARED. Each `interpret` call is capped on its
      // own tree; nothing accumulates across siblings. The loss was CONTAINMENT,
      // and the two are worth telling apart: a shared budget would mean the
      // document is too big, and it is not — one column of it is.
      //
      // ⛔ A FAILED COLUMN IS ABSENT, NOT ALL-NaN. `hasAnyFinite` already reads
      // an absent key as "no data" and gives the plot no series, so absence
      // needs no new handling anywhere; a 5,000-long NaN array per failed column
      // would allocate for nothing and read as a column that computed.
      // The REASON is preserved instead — see `columnErrors`.
      // ⭐ C29 — only the plots that folded the other period's value are refused.
      // ⭐ P1 — the period / ltf / scalar refusal of THIS plot (`chartStaticRefusals`).
      if (staticWhy.has(key)) {
        errors[key] = staticWhy.get(key)
        continue
      }
      // ⭐⭐ ENGINE 55 — a plot that reads a ticker this binding REFUSED (settled, not
      // pending) is refused BY NAME with the bind's code and sentence, never computed
      // into an all-`na` column (`otherSymbols.js::otherSymbolRefusalOfTree`).
      const symWhy = otherSymbolRefusalOfTree(trees[key], other)
      if (symWhy) {
        errors[key] = symWhy
        continue
      }
      try {
        out[key] = interpret(bound(trees[key]), bars, inputs, def.compute.budget,
          // ⛔ `newestBarIsForming` IS READ THE SAME WAY `tf` IS, and fails closed
          // the same way. `ctx` absent -> `null` -> UNKNOWN -> the four
          // CLOCK_REALTIME columns blank. `false` would assert SETTLED.
          undefined, { tf: ctx && ctx.tf,
            newestBarIsForming: (ctx && ctx.newestBarIsForming) ?? null,
            ...listingOptsFor(def, ctx),
            ...semanticsOptsFor(def),
            ...(barIndexAbsoluteFor(def, ctx) ? { barIndexAbsolute: true } : {}), ...(varOriginAbsoluteFor(def) ? { varOriginAbsolute: true } : {}),
            ...(other ? { symbols: other.symbols } : {}),
            ...(lower ? { lowerTf: lower.supply } : {}), crossMemo, ...dailyFramesOf(ctx),
            ...workSinkOf(ctx), chartClockSink: (clock[key] = new Map()), withheldBarsSink: (withheldBars[key] = new Map()) })
      } catch (err) {
        // ⛔ A CRASH IS NOT A REFUSAL. `|| 'compute:error'` gave EVERY
        // exception a guard name, so a TypeError inside a walker was
        // indistinguishable from the table declining to compute a column.
        errors[key] = isRefusal(err)
          ? { guard: err.guard, message: String(err.message) }
          : { status: ENGINE_ERROR, engineError: (err && err.name) || 'Error',
            message: String((err && err.message) || err) }
        continue
      }
      // ⭐⭐ C48 — a plot that reads a call in a block that may not run on every
      // bar (`blockRuns.js`): its guard is computed over THESE bars, and where
      // the block runs after a bar it skipped the plot is refused by name —
      // never drawn off the every-bar number. Same budget, same options, same
      // memo as the plot's own tree (the guard is a subtree of it).
      // ⛔ AFTER the plot's own tree, never before it: a plot that cannot be
      // computed at all keeps ITS reason (`interpret:bind-time-text` on a chart
      // whose symbol is not resolved, `symbolThread.test.js`) — the guard is a
      // subtree of that tree, and asked first it failed the same way and the
      // member was told about blocks instead of about the symbol.
      const runsWhy = blockRunsRefusal(def, key, (tree) => interpret(bound(tree), bars, inputs, def.compute.budget,
        undefined, { tf: ctx && ctx.tf,
          newestBarIsForming: (ctx && ctx.newestBarIsForming) ?? null,
          ...listingOptsFor(def, ctx),
          ...semanticsOptsFor(def),
          ...(other ? { symbols: other.symbols } : {}), crossMemo, ...dailyFramesOf(ctx),
          ...workSinkOf(ctx), chartClockSink: new Map() }))
      if (runsWhy) {
        delete out[key]
        delete clock[key]
        delete withheldBars[key]
        errors[key] = { guard: BLOCK_RUNS_GUARD, message: runsWhy }
      }
    }
    refuseColourReaders(def, out, errors)
    return withWithheldBars(withLowerTf(withChartClock(withOtherSymbols(withColumnErrors(out, errors), other), clock), lower), withheldBars)
  }
  if (keys.length !== 1) {
    throw new Error(
      `computeFor: an "ast" definition computes ONE column and definition ` +
      `${JSON.stringify(def?.id)} declares ${keys.length} data-bearing plots ` +
      `(${keys.join(', ') || 'none'}). One formula is one series; a second plot would be a ` +
      `key nothing ever fills.`,
    )
  }
  // ⭐ `ctx.tf` IS THREADED (closed table v2). `computeFor` has had the timeframe
  // all along and dropped it here, which was harmless while the table held
  // nothing that needed one. It now holds four: `isintraday`, `isdaily`,
  // `isweekly` and `ismonthly` are answerable ONLY from what the caller knows,
  // and `interpret` fails them CLOSED (not-computable) when nobody says. So the
  // cost of not passing it is not a crash — it is a member's session filter that
  // silently never fires, which is the quietest failure this lane has.
  //
  // ⚠️ `undefined` FOR BUDGET'S NEIGHBOURS, NOT `{}`. `scalars` is genuinely
  // absent on the chart lane (a chart draws one symbol's bars; the scalar map is
  // the scan lane's), and spelling it `{}` would turn "no scalars were offered"
  // into "an empty scalar map was", which seeds every declared scalar NaN by a
  // different route and reads identically at the call site.
  // ⭐ P0 0F — see the per-plot branch above (`chartScalars.js`).
  if (staticWhy.has(keys[0])) return withColumnErrors({}, { [keys[0]]: staticWhy.get(keys[0]) })
  // ⭐⭐ ENGINE 55 — the single tree's settled other-symbol refusal, by name.
  const soleSymWhy = otherSymbolRefusalOfTree(def.compute.ast, other)
  if (soleSymWhy) return withOtherSymbols(withColumnErrors({}, { [keys[0]]: soleSymWhy }), other)
  const clock = { [keys[0]]: new Map() }
  const soleWithheld = { [keys[0]]: new Map() }
  const sole = interpret(bound(def.compute.ast), bars, inputs, def.compute.budget,
    undefined, { tf: ctx && ctx.tf,
      newestBarIsForming: (ctx && ctx.newestBarIsForming) ?? null,
      ...listingOptsFor(def, ctx),
      ...semanticsOptsFor(def),
      ...(barIndexAbsoluteFor(def, ctx) ? { barIndexAbsolute: true } : {}), ...(varOriginAbsoluteFor(def) ? { varOriginAbsolute: true } : {}),
      ...(other ? { symbols: other.symbols } : {}),
      ...(lower ? { lowerTf: lower.supply } : {}), ...dailyFramesOf(ctx),
      ...workSinkOf(ctx), chartClockSink: clock[keys[0]], withheldBarsSink: soleWithheld[keys[0]] })
  // ⭐ C48 — the single-tree document's own block-run check (`blockRuns.js`),
  // AFTER its tree computed (a tree that cannot keeps its own reason, above).
  const soleRunsWhy = blockRunsRefusal(def, keys[0], (tree) => interpret(bound(tree), bars, inputs, def.compute.budget,
    undefined, { tf: ctx && ctx.tf,
      newestBarIsForming: (ctx && ctx.newestBarIsForming) ?? null,
      ...listingOptsFor(def, ctx),
      ...semanticsOptsFor(def),
      ...(barIndexAbsoluteFor(def, ctx) ? { barIndexAbsolute: true } : {}), ...(varOriginAbsoluteFor(def) ? { varOriginAbsolute: true } : {}),
      ...(other ? { symbols: other.symbols } : {}),
      ...(lower ? { lowerTf: lower.supply } : {}), ...dailyFramesOf(ctx),
      ...workSinkOf(ctx), chartClockSink: new Map() }))
  if (soleRunsWhy) return withColumnErrors({}, { [keys[0]]: { guard: BLOCK_RUNS_GUARD, message: soleRunsWhy } })
  return withWithheldBars(withLowerTf(withChartClock(withOtherSymbols({ [keys[0]]: sole }, other), clock), lower), soleWithheld)
}

/** ⭐⭐ C41 — the lower-timeframe codes THIS binding may read
 *  (`engine/lowerTf.js::resolveLowerTf`), or null when the document reads none.
 *  Only the member door's Pine documents write an `ltf` node; the codes are its
 *  stamp (`meta.lowerTf`), so a document that reads none costs one property read.
 *  `ctx.lowerTf` is the chart's OWN symbol at each store timeframe
 *  (`useLowerTfSources`); `ctx.tf` the chart's — or the frame's — timeframe. */
export function lowerTfFor(def, ctx) {
  if (!def || !def.meta || def.meta.recurrenceOrigin !== PINE_RECURRENCE_ORIGIN) return null
  if (!Array.isArray(def.meta.lowerTf) || !def.meta.lowerTf.length) return null
  return resolveLowerTf(def, {
    tf: ctx && ctx.tf,
    lowerTf: ctx && ctx.lowerTf,
    framed: !!(ctx && ctx.framed),
  })
}

/** The key a column map carries its lower-timeframe decision under —
 *  non-enumerable, like `__otherSymbols`. */
const LOWER_TF = '__lowerTf'

function withLowerTf(out, lower) {
  if (lower) {
    Object.defineProperty(out, LOWER_TF, {
      value: Object.freeze({ served: lower.served, refused: lower.refused }), enumerable: false,
    })
  }
  return out
}

/** ⭐ C41 — which lower-timeframe codes a computed column map was served, and
 *  which were refused and why: `{served, refused: [{code, refusal, reason}]}`, or null. */
export function lowerTfReport(columns) {
  return (columns && columns[LOWER_TF]) || null
}

/** ⭐⭐ C26 — the other symbols THIS binding may read (`engine/otherSymbols.js`),
 *  or null when the document reads none.
 *
 *  ⭐⭐ P0 — EVERY DOCUMENT THAT READS ONE IS DECIDED HERE. A Pine translation by
 *  its recorded spellings (`resolveOtherSymbols`); any other document — a formula
 *  a member typed — by our store's ticker (`resolveFormulaSymbols`): served when
 *  its bars are in hand, refused by name otherwise.
 *  ⚰️ Until P0 a non-Pine `sym` "kept the unsupplied answer it always had":
 *  all-NaN, no report, never fetched — a definition accepted and starved. */
export function otherSymbolsFor(def, ctx) {
  // ⭐ P1 — the gate's decision, verbatim (`evaluability.js::otherSymbolsDecision`).
  return otherSymbolsDecision(def, ctx)
}

/** The key a column map carries its other-symbol decision under — non-enumerable
 *  for the same reason `__columnErrors` is (a visible key is a phantom plot). */
const OTHER_SYMBOLS = '__otherSymbols'

function withOtherSymbols(out, other) {
  if (other) {
    Object.defineProperty(out, OTHER_SYMBOLS, {
      value: Object.freeze({ served: other.served, refused: other.refused }), enumerable: false,
    })
  }
  return out
}

/** ⭐ C26 — which other symbols a computed column map was served, and which were
 *  refused and why: `{served, refused: [{ticker, code, reason}]}`, or null. */
export function otherSymbolReport(columns) {
  return (columns && columns[OTHER_SYMBOLS]) || null
}

/** ⭐ ENGINE 56 — the key a column map carries its per-bar witness withholdings under,
 *  non-enumerable like `__chartClock`: plot key → `{code: Float64Array(0/1)}`. */
const WITHHELD_BARS = '__withheldBars'
function withWithheldBars(out, byKey) {
  const rows = {}
  for (const [key, codes] of Object.entries(byKey || {})) {
    if (codes && codes.size) rows[key] = Object.freeze(Object.fromEntries(codes))
  }
  if (Object.keys(rows).length) {
    Object.defineProperty(out, WITHHELD_BARS, { value: Object.freeze(rows), enumerable: false })
  }
  return out
}
/** ⭐ ENGINE 56 — the bars each plot was withheld on by a per-bar witness code (A3's
 *  `pine:bool-na-unwitnessed`, S4-2's `pine:tie-unwitnessed`): `{[plotKey]: {[code]: 0/1
 *  column}}`, or null. The vendor harness reads it so a withheld bar is graded "not
 *  compared", never as the `na` the column holds there. */
export function withheldBarsReport(columns) {
  return (columns && columns[WITHHELD_BARS]) || null
}

/** The key a column map carries its `time(<timeframe>)` withholdings under —
 *  non-enumerable for the reason `__columnErrors` is. */
const CHART_CLOCK = '__chartClock'

/** `byKey`: plot key → Map(code → sentence), filled by `interpret` through
 *  `opts.chartClockSink` (`interpret.js::periodAnchorMask` is the ONE place the
 *  decision is made). Folded to one row per code, naming the plots it covers. */
function withChartClock(out, byKey) {
  const rows = new Map()
  for (const [key, reasons] of Object.entries(byKey || {})) {
    for (const [code, reason] of reasons) {
      if (!rows.has(code)) rows.set(code, { code, reason, plots: [] })
      rows.get(code).plots.push(key)
    }
  }
  if (rows.size) {
    Object.defineProperty(out, CHART_CLOCK, {
      value: Object.freeze({ withheld: Object.freeze([...rows.values()]) }), enumerable: false,
    })
  }
  return out
}

/** ⭐⭐ C36 — WHY EVERY BAR OF A PLOT THAT READS `time(<timeframe>)` IS WITHHELD
 *  ON THIS CHART: `{withheld: [{code, reason, plots}]}`, or null when nothing is.
 *  The codes and sentences are `interpret.js::CHART_CLOCK_WITHHELD`'s — a chart
 *  that is not daily, daily bars that include a weekend, a chart timeframe no
 *  capture measured. The binder publishes it to the member's disclosure strip
 *  (`chartClockNotice.js`); the vendor harness prints it as a note. Modelled on
 *  `otherSymbolReport`: the decision rides on the columns it was made for. */
export function chartClockReport(columns) {
  const own = (columns && columns[CHART_CLOCK]) || null
  // ⭐⭐ CBC-FMT — a `calc_bars_count` window says so on the same strip ("computed on its
  // last N bars", and the newest bar while it is withheld), in either lane.
  const win = calcBarsWindowReport(columns)
  // ⭐⭐ (coordinator ruling 2026-11-20) — and an overnight tail the run was cut before (`runtime/overnightTail.js`)
  const night = runtimeOvernightOf(columns)
  if (!win && !night) return own
  const rows = [...((win && win.rows) || []), ...((night && night.rows) || [])]
    .map((r) => ({ code: r.code, reason: r.reason, plots: [] }))
  return Object.freeze({ withheld: Object.freeze([...((own && own.withheld) || []), ...rows]) })
}

/** ⭐⭐ C12w — THE DECLARATION A DOCUMENT MAKES ABOUT ITS RECURRENCES. The Pine
 *  member door (`memberPaneDefinition`) stamps it; nothing else does. */
export const PINE_RECURRENCE_ORIGIN = 'pine'

/** Whether the listing exception (ruling R-W) applies to THIS document on THIS
 *  bar series: `interpret`'s `historyFromListing`.
 *
 *  Two facts, both required, and neither inferred:
 *   - the CALLER states the series starts at the symbol's first-ever bar
 *     (`ctx.historyFromListing === true` — `StockChart` derives it from the
 *     listing date, the vendor harness from the capture's `startsAtBar0`);
 *   - the DOCUMENT declares its `accum` recurrences are Pine translations
 *     (`meta.recurrenceOrigin === 'pine'`).
 *
 *  ⛔ WHY THE SECOND ONE EXISTS. `accum` is shared by three translators and only
 *  one of them means "carried since the first bar". TC2000's `CountTrue(b, x)`
 *  (`pcf.js`) IS a window of `x` bars — run from bar 0 it would count the whole
 *  history, a different indicator. A document that says nothing is left exactly
 *  as it was.
 *  ⛔ Absent, `false`, or anything but `true` on either side means NO. */
export function historyFromListingFor(def, ctx) {
  return !!(ctx && ctx.historyFromListing === true
    && def && def.meta && def.meta.recurrenceOrigin === PINE_RECURRENCE_ORIGIN)
}

/** ⭐⭐ F1 — the listing facts `interpret` reads, as ONE spread: the listing
 *  (`historyFromListingFor`) and, with it, whether this document's Pine version
 *  reads an `na` `?:` test as false (`meta.naConditionFalse`, written by the
 *  member door from `interpret.js::naConditionIsFalse`; `interpret.js::
 *  pineTernaryFor`). Off the listing, or for a document that does not declare
 *  it, nothing changes. */
export function listingOptsFor(def, ctx) {
  if (!historyFromListingFor(def, ctx)) {
    // ⭐⭐ (2026-11-20) the listing FACT where it is not served (W / M): only the notes read it, for a true sentence
    return ctx && ctx.listingStart === true && def && def.meta && def.meta.recurrenceOrigin === PINE_RECURRENCE_ORIGIN
      ? { listingStart: true } : {}
  }
  return { historyFromListing: true,
    ...(def.meta.naConditionFalse === true ? { naConditionFalse: true } : {}),
    ...(listingSeedUnpinnedFor(def) ? { listingSeedUnpinned: true } : {}) }
}

/** ⭐⭐ W34-I4b — does this document's Pine version leave bar 0's history
 *  unpinned (`interpret.js::listingSeedIsUnpinned`: v1/v2, or no `//@version`)?
 *  Read from the door's own stamp (`meta.pineVersion`, null for a script with no
 *  pragma), and ONLY from a stamped document (`meta.doorVersion`): an unstamped
 *  one cannot say which version it was, and — the convention every listing fact
 *  here follows — a document that says nothing is left exactly as it was. */
export function listingSeedUnpinnedFor(def) {
  const meta = def && def.meta
  if (!meta || !Number.isInteger(meta.doorVersion) || !('pineVersion' in meta)) return false
  return listingSeedIsUnpinned(meta.pineVersion)
}

/** ⭐⭐ C45 — DOES THIS DOCUMENT'S `barindex` MEAN PINE'S `bar_index`?
 *
 *  Pine's `bar_index` counts from the first bar of the symbol's history; the
 *  engine's `barindex` leaf counts from the first bar it is handed. A document
 *  the Pine member door built claims TradingView's number, so off the listing a
 *  value that depends on the count is withheld (`interpret.js::barIndexMask`).
 *  A formula a member typed in the formula language reads `barindex` by ITS
 *  declared sentence ("the bar's position in the series") and is not touched.
 *
 *  ⛔ The same declaration `historyFromListingFor` reads, and for the same
 *  reason: the tree cannot say which translator wrote it. A document that says
 *  nothing (saved before C12w, or from another translator) is left as it was.
 *
 *  ⭐ ONE OTHER FACT ANSWERS IT, AND ONLY A CALLER CAN STATE IT:
 *  `ctx.barIndexFromFirstBar === true` — the series' first bar IS the bar
 *  TradingView counts as 0. The listing implies it on a daily chart
 *  (`historyFromListing`, which `interpret` asks itself); nothing else a member
 *  surface holds does — on an intraday chart TradingView's bar 0 is the first bar
 *  ITS plan loaded, which this product cannot know. So no member surface states
 *  it (`StockChart` does not, railed). The vendor harness does, for a capture
 *  whose OWN `bar_index` control row reads 0..n-1 on its bars: there the fact is
 *  the vendor's own print, and the count is graded instead of withheld.
 *  ⛔ It says nothing about the listing: no seed is lifted, no history read is
 *  served by it. Absent, `false`, or anything but `true` means NO. */
/** ⭐⭐ 2026-11-09 — DOES THIS DOCUMENT'S `accum` MEAN A PINE `var`, SET ON THE
 *  SYMBOL'S FIRST BAR? The declaration `historyFromListingFor` reads
 *  (`meta.recurrenceOrigin === 'pine'`). Off the listing such a `var` that still
 *  holds what it held before the loaded bars is withheld by name
 *  (`interpret.js::varOriginMask`); a formula's own `accum(…, W)` is a window by
 *  its declared sentence and is not touched. ⛔ Unlike `barIndexAbsoluteFor`,
 *  `ctx.barIndexFromFirstBar` does not lift it: that fact names TradingView's bar
 *  0, and the bounded window still re-seeds 250 bars back on every bar. */
export function varOriginAbsoluteFor(def) {
  return !!(def && def.meta && def.meta.recurrenceOrigin === PINE_RECURRENCE_ORIGIN)
}

export function barIndexAbsoluteFor(def, ctx) {
  return !!(def && def.meta && def.meta.recurrenceOrigin === PINE_RECURRENCE_ORIGIN)
    && !(ctx && ctx.barIndexFromFirstBar === true)
}

/** Merge a caller's inputs over the definition's declared defaults. */
// ⭐⭐ EXPORTED FOR THE OBJECT LANE (C3B-CLOSE item 6), NOT COPIED INTO IT.
// `objectColumns.objectReaderFor` needs exactly this merge — declared defaults
// under the instance's overrides — to evaluate an object's coordinate the way
// the plot beside it is evaluated. A second copy there would be a second
// authority over one value, and the two would disagree the first time a default
// rule moved (`lesson_a_second_authority_over_one_value`).
export function resolveInputs(def, inputs) {
  const out = {}
  for (const input of def?.inputs || []) {
    if (input && typeof input.key === 'string') out[input.key] = input.default
  }
  // ⭐ 3-08b: a stored legacy input reads as its successor where the successor
  // was never stored (`legacyInputs.inputsAsRead`; read-time, never written back).
  const stored = inputsAsRead(def, inputs)
  if (stored) {
    for (const [k, v] of Object.entries(stored)) {
      if (v !== undefined) out[k] = v
    }
  }
  return out
}

/**
 * ⭐⭐ THE SCALARS A TREE READS: `resolveInputs`, with every TEXT enum handed over
 * as its option's INDEX.
 *
 * A tree has no strings (`pine.js::enumCompare` writes `kind == 1` for Pine's
 * `kind == "SMA"`), so an `enum` input whose options are text reaches it as the
 * position of the member's pick. The INSTANCE keeps the text — what the dropdown
 * shows and what `defSchema` validates — and only the evaluation scope sees the
 * number.
 *
 * ⭐⭐ ONE RULE, SHARED WITH THE SERVER (`api/services/alert_user_series._inputs_for`),
 * pinned by ONE fixture both suites read (`tests/fixtures/enum_input_parity.json`):
 *   • a value that IS one of the options → that option's index;
 *   • anything else — unknown text, a number, null, a boolean — → the DEFAULT's index;
 *   • a default that is not among the options → index 0. (Pine refuses to compile
 *     such a script, so the door never mints one; this guards a hand-made document.)
 * ⚰️ An unknown value used to pass through as text, the tree compared text with a
 * number, and EVERY `kind == i` was false — the script's else arm, which the server
 * did not agree with (it took the default).
 * ⛔ Only for the TREE lanes: a native's enum (`lineStyle: 'dashed'`) is text its
 * compute reads as text, and `resolveInputs` stays exactly what it was.
 */
export function enumIndexOf(input, value) {
  const opts = Array.isArray(input && input.options) ? input.options.map((o) => (Array.isArray(o) ? o[0] : o)) : []
  if (!opts.length || !opts.every((o) => typeof o === 'string')) return null
  const at = typeof value === 'string' ? opts.indexOf(value) : -1
  if (at >= 0) return at
  const def = opts.indexOf(input.default)
  return def >= 0 ? def : 0
}

export function treeScalars(def, scalars) {
  let out = scalars
  for (const input of def?.inputs || []) {
    if (!input || input.type !== 'enum' || typeof input.key !== 'string') continue
    const i = enumIndexOf(input, scalars[input.key])
    if (i === null) continue
    if (out === scalars) out = { ...scalars }
    out[input.key] = i
  }
  return out
}

/** The guard a parameter setting the door would refuse carries (`paramInputs.js`). */
export const PARAM_SETTING_GUARD = 'setting:param-refused'
/** ⭐ SETTINGS PARITY (symbol): a member's choice of a symbol setting no binding can serve. */
export const SYMBOL_SETTING_GUARD = 'setting:symbol-refused'

/** The run-read parts a caller adds to an `ast` document's values (`nativeRegistry.astRunExtras`:
 *  the run-read colours and the run half). None by default: the values alone. */
const NO_EXTRAS = (def, out) => out

// ⭐ THE AST LANE (Phase D Task 8): `nativeRegistry.computeFor`'s `ast` branch, moved here unchanged.
// It is DISPATCHED ON THE KIND (`computeLane.js`) AND **BEFORE** THE `NATIVE_COMPUTE` LOOKUP —
// exactly where Task 13 put the server lane, and for the same reason one level sharper. An `ast`
// definition's `compute.fn` is its `astHash`: a 71-character `sha256:…` string that has no entry in
// `NATIVE_COMPUTE` and never will. Placed AFTER the lookup, the registry's throw fires first and an
// `ast` definition can never draw — a lane that registers, validates, budgets and lints, and then
// renders nothing. The throw is right for a native that lost its function and wrong for a definition
// that never had one.
export function astLaneColumns(def, bars, inputs, ctx, extras = NO_EXTRAS) {
  const plan = astLanePlan(def, bars, inputs, ctx)
  if (plan.done) return plan.done
  const out = astColumnsFor(plan.def, plan.valueRows, plan.scalars, plan.valueCtx)
  return astLaneFinish(plan, out, inputs, ctx, extras)
}

/**
 * ⭐⭐ HOST WORKER — `astLaneColumns` IN ITS THREE PARTS, so the middle one (the VALUES,
 * `astColumnsFor`, which is where a host document's time goes) can be computed on another thread
 * (`hostLaneAsync.js`) while the two around it stay on the chart's: what `astLaneColumns` does,
 * in the order it does it, split and nothing else.
 *
 * `astLanePlan` → `{done}` (a whole answer that computes nothing: a refused setting, a windowed
 * request) or `{def, rows, win, valueRows, valueCtx, scalars}`: the document the member's settings
 * specialised, the rows and context its values are computed over, and the scalars they read.
 * `astLaneFinish(plan, out, …)` → the run-read parts (`extras`) and, for a window, the widening and
 * its record, over the values `out`.
 */
export function astLanePlan(def, bars, inputs, ctx) {
  const rows = Array.isArray(bars) ? bars : []
  // ⭐ SETTINGS PARITY (2a): the instance's parameter settings (`param<N>` inputs) are
  // written into the literals they stand for (`paramInputs.specializeParams`), memoised per
  // value set, so this pane computes the tree its member chose. A value the door would refuse
  // is refused by name on every column, never computed.
  // ⭐ SETTINGS PARITY (symbol): the instance's choice of each symbol setting (`symbolInputs.js`), then its
  // parameter settings. A choice no binding can serve is refused by name on every column, never fetched.
  const symbols = specializeSymbols(def, inputs)
  if (!symbols.ok) {
    return { done: withColumnErrors({}, Object.fromEntries(astPlotKey(def).map((k) => [k, { guard: SYMBOL_SETTING_GUARD, message: symbols.message }]))) }
  }
  def = symbols.def
  const special = specializeParams(def, inputs)
  if (special && special.refused) {
    const message = `${special.refused}: the chart does not compute a setting the indicator's own bounds refuse`
    return { done: withColumnErrors({}, Object.fromEntries(astPlotKey(def).map((k) => [k, { guard: PARAM_SETTING_GUARD, message }]))) }
  }
  def = special
  // ⭐⭐ CBC-FMT — `calc_bars_count`: THE ONE SEAM where the host lane takes its window
  // (`engine/calcBarsWindow.js`). Every caller of `computeFor` (the binder, the object
  // lane, the vendor harness) inherits it; a chart of N bars or fewer, and every document
  // without the stamp, takes the path below unchanged.
  //
  // ⭐⭐ CBC-FMT — AN `ast` DOCUMENT'S COLUMNS OVER ITS `calc_bars_count` WINDOW.
  // The run is the ordinary one (`astColumnsFor`, then the run-read colours and the run
  // half, exactly as `computeFor` composes them) over the window's rows, told its first bar
  // is the history's first bar and TradingView's `bar_index` 0 (`windowContext`, both
  // witnessed). Its columns are widened back to the chart (`NaN` before the window) and
  // carry the window's record (`astLaneFinish`). Three things the window does not witness are
  // withheld or refused BY NAME, never computed as if they were (`barstate.isfirst`,
  // `last_bar_index` and a history read are witnessed: the slice computes them as TradingView
  // does, S10):
  //   · a request of other bars (`meta.calcBarsRequest`, or a `sym` / `ltf` / higher-
  //     timeframe read): every plot is refused (`CALC_BARS_REQUEST_GUARD`);
  //   · the newest bar while it may be forming (`withCalcBarsRecord`).
  const win = calcBarsWindowOf(def, rows)
  if (win && calcBarsRequests(def)) {
    const errors = {}
    for (const key of astPlotKey(def)) errors[key] = { guard: CALC_BARS_REQUEST_GUARD, message: calcBarsRequestSentence(win.count) }
    return { done: withCalcBarsRecord(withColumnErrors({}, errors), win, ctx, RUNTIME_OBJECTS_KEY) }
  }
  const scalars = treeScalars(def, resolveInputs(def, inputs))
  return win
    ? { def, rows, win, valueRows: win.rows, valueCtx: windowContext(ctx), scalars }
    : { def, rows, win: null, valueRows: rows, valueCtx: ctx, scalars }
}

/** ⭐⭐ HOST WORKER — the second half of `astLaneColumns` (see `astLanePlan`): the values `out`
 *  of `plan`, with the run-read parts and, for a `calc_bars_count` window, the widening and its
 *  record. `ctx` is the CHART's context (the window's own is `plan.valueCtx`). */
export function astLaneFinish(plan, out, inputs, ctx, extras = NO_EXTRAS) {
  // ⭐⭐ ENGINE 53 / DIV-4 — the run-read colours and the run half, when the caller hands them
  // (`nativeRegistry.astRunExtras`); the headless export hands none (`headlessCompute.js`).
  if (!plan.win) return extras(plan.def, out, plan.rows, inputs, ctx)
  const ran = extras(plan.def, out, plan.win.rows, inputs, plan.valueCtx)
  return withCalcBarsRecord(widenToChart(ran, plan.win.cut, RUNTIME_OBJECTS_KEY), plan.win, ctx, RUNTIME_OBJECTS_KEY)
}

// ─── ⭐⭐ HOST WORKER — THE RECORDS A VALUES MAP CARRIES BESIDE ITS COLUMNS ───────────────────────
//
// `astColumnsFor` attaches its reasons NON-ENUMERABLY (a visible key is a phantom plot), and a
// structured clone (a worker's `postMessage`) copies only enumerable properties. So the records
// cross the boundary as plain data (`astSideRecordsOf`) and are re-attached on the other side
// (`withAstSideRecords`) EXACTLY as the helpers above attach them: the same keys, non-enumerable,
// frozen to the same depth. ⛔ ONE TABLE, every key a `with*` helper above defines on a values map;
// `hostLaneWorker.rail.test.js` reads this file and fails on a `defineProperty(out, KEY` that is
// not in it.
const freezeRows = (v) => Object.freeze(Object.fromEntries(Object.entries(v).map(([k, r]) => [k, Object.freeze(r)])))
export const AST_SIDE_RECORDS = Object.freeze({
  [COLUMN_ERRORS]: (v) => Object.freeze(v),
  [RUNTIME_ERROR_STOP]: (v) => v,
  [LOWER_TF]: (v) => Object.freeze(v),
  [OTHER_SYMBOLS]: (v) => Object.freeze(v),
  [WITHHELD_BARS]: freezeRows,
  [CHART_CLOCK]: (v) => Object.freeze({ ...v, withheld: Object.freeze(v.withheld) }),
})

/** The non-enumerable records a values map carries, as one plain object (null when none). */
export function astSideRecordsOf(out) {
  let sides = null
  for (const key of Object.keys(AST_SIDE_RECORDS)) {
    if (out && Object.prototype.hasOwnProperty.call(out, key)) (sides = sides || {})[key] = out[key]
  }
  return sides
}

/** Re-attach `astSideRecordsOf`'s records to a values map, as `astColumnsFor` attached them. */
export function withAstSideRecords(out, sides) {
  for (const [key, value] of Object.entries(sides || {})) {
    const shape = AST_SIDE_RECORDS[key]
    if (shape) Object.defineProperty(out, key, { value: shape(value), enumerable: false })
  }
  return out
}

/** Does a windowed document request other bars? The door's stamp (the source's own
 *  `request.*`, the identity included) or a tree that reads them. */
function calcBarsRequests(def) {
  if (def.meta && (def.meta.calcBarsRequest === true
    || (Array.isArray(def.meta.otherSymbols) && def.meta.otherSymbols.length)
    || (Array.isArray(def.meta.lowerTf) && def.meta.lowerTf.length))) return true
  const trees = astTrees(def)
  const all = trees ? Object.values(trees) : [def.compute.ast]
  const stack = [...all]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (n.type === 'sym' || n.type === 'ltf' || n.type === 'tf' || n.type === 'tf_live') return true
    if (Array.isArray(n.args)) for (const a of n.args) stack.push(a)
  }
  return false
}
