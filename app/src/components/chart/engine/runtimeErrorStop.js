// app/src/components/chart/engine/runtimeErrorStop.js
//
// ─── ⭐⭐ C43 — A REACHED `runtime.error` DRAWS NOTHING ───────────────────────────
//
// MEASURED on TradingView 2026-09-30 (probe `vw-runtime-error.pine`, AMEX:SPY 1D):
// with the script's own validation reached on bar 100 the study holds NOTHING —
// 0 data rows, 0 labels, 0 lines, `isFailed` — although the error is on one bar
// and 100 bars ran before it; the pane is empty and the status reads
// *"Error on bar {bar_index}: UCTPROBE stop at bar 100"* under the title
// "User-defined error" (`tests/fixtures/vendor/runtime/vw-runtime-error-reached-
// spy-1d-2026-09-30.json`). With the validation NOT reached the study is the
// ordinary one (4,800 rows, 50 labels — `vw-runtime-error-spy-1d-2026-09-30`).
//
// ⚰️ Until C43 the host lane had no reading of `runtime.error` at all: a script
// whose validation fires at a member's own settings was DRAWN here while
// TradingView shows an error and an empty pane.
//
// The translation stamps every `runtime.error` it can place on the document
// (`meta.runtimeErrors`, `pine.js::runtimeErrorSitesOf`): the conditions each call
// stands under, as trees. This module evaluates them over the chart's bars with
// the member's own inputs — the same `interpret`, fold and inputs the plot beside
// them is computed with — and answers ONE of three things:
//
//   reached   some bar satisfies every condition of a call → the whole indicator
//             draws nothing (`nativeRegistry.astColumnsFor` returns no column,
//             `objectColumns.objectReaderFor` no drawing) and the member reads the
//             script's own message;
//   not       every condition of every placed call is KNOWN false on every bar →
//             the indicator is drawn exactly as before (byte-identical);
//   unknown   a call whose conditions cannot be said here — a bar inside a
//             recurrence's warm-up, a setting folded at a value the member has
//             since changed, a chart period other than the one a period read was
//             folded at, a tree that refuses. ⛔ NEVER GUESSED: the indicator is
//             drawn as it is today and the call is NAMED (`unknown`).
//
// ⛔ A CONDITION IS THREE-VALUED PER BAR. `NaN` is Pine's `na`, which an `if`
// takes as false; a bar the warm-up curtain withholds (`objectColumns.unknownMask`,
// the object lane's own probe) is neither. A known-false condition settles its bar
// whatever the others are.
//
// ⛔⛔ AND THIS CHART MAY NOT HOLD THE BARS TRADINGVIEW RAN. The error is reached
// on ANY bar of TradingView's history, and unless the series is stated to start
// at the listing bar (`historyFromListing`, C12w) the chart holds only the end of
// it. So, off the listing:
//   * a factor that reads NO bar (settings, the chart's timeframe) is the same on
//     every bar anywhere — false, the call is not reached, exactly; and with
//     `barstate.isfirst` as the only other factor it is reached on TradingView's
//     first bar, exactly (the validation idiom: `if barstate.isfirst and <the
//     settings are invalid>`);
//   * `barstate.islast` names the newest bar, which both hold — a call anchored
//     on it is decided by that one bar;
//   * `bar_index` / `barstate.isfirst` read as a VALUE, and a window still
//     warming up, are this chart's and not TradingView's — unknown;
//   * a bar on which every condition is known to hold is reached on TradingView
//     too (it ran that bar) — the stop is exact, its bar number is not said;
//   * "not reached on the bars this chart holds" proves nothing about the bars
//     before them — unknown, named, drawn as today.
//
// ⭐ REGISTERED INTO `nativeRegistry`, NEVER IMPORTED BY IT — the same rule the
// object runtime's values follow (`objectColumns.registerObjectRuntimeValues`):
// the plot lane must not pull the object lane into its own chunk. `objectColumns`
// imports this module, and the binder imports `objectColumns`, so every pane has
// it; a caller that computes columns without the object lane loaded gets the
// unstopped columns, as before.
import { interpret, periodAnchorMask, maxLookback } from './ast/interpret'
import { timeframeFlags } from '../indicators'
import { foldBound } from './ast/bind'
import { unknownMask } from './objectColumns'
import { defaultNumberText } from './objectRuntime'
import {
  resolveInputs, bindConstsFor, historyFromListingFor, registerRuntimeErrorStop,
} from './nativeRegistry'
import { periodValuesDiffer } from './periodReads'
import { runtimeErrorWords } from './runtimeErrorText'

export { RUNTIME_ERROR_TITLE, tradingViewErrorText } from './runtimeErrorText'

const stampOf = (def) => {
  const s = def && def.meta && def.meta.runtimeErrors
  return s && Array.isArray(s.stops) && s.stops.length ? s : null
}

/** The literal a manifest locator points at in the document's CURRENT trees, or
 *  undefined when it cannot be read (a graph-form document, a detached locator). */
function literalAt(def, loc) {
  const compute = (def && def.compute) || {}
  let node = loc && loc.treeIndex != null && compute.trees
    ? compute.trees[loc.treeIndex]
    : compute.ast
  for (const step of (loc && Array.isArray(loc.astPath) ? loc.astPath : [])) {
    if (node === null || node === undefined) return undefined
    node = node[step]
  }
  if (typeof node === 'number') return node
  if (node && typeof node === 'object' && node.type === 'num') return node.value
  return undefined
}

/** Why this stop cannot be evaluated on this binding, or null when it can. */
function notEvaluable(stop, def, inputs, ctx) {
  for (const name of stop.live || []) {
    if (!Object.prototype.hasOwnProperty.call(inputs, name)) {
      return `it reads the setting \`${name}\`, which this document does not carry`
    }
  }
  const manifest = (def && def.compute && def.compute.paramManifest) || {}
  for (const f of stop.folded || []) {
    if (!f || typeof f.name !== 'string') continue
    // ⛔ A value folded into the conditions is the one the TRANSLATION saw. If the
    // member holds a control for that setting and has moved it, the conditions
    // were not evaluated at their value — unknown, never the default's answer.
    if (Object.prototype.hasOwnProperty.call(inputs, f.name)) {
      if (f.value === null || !Object.is(Number(inputs[f.name]), f.value)) {
        return `it reads the setting \`${f.name}\` at ${f.value === null ? 'a value this chart cannot compare' : f.value}, and this pane holds ${inputs[f.name]}`
      }
      continue
    }
    for (const entry of Object.values(manifest)) {
      if (!entry || entry.sourceName !== f.name) continue
      for (const loc of entry.locators || []) {
        const now = literalAt(def, loc)
        if (now === undefined || f.value === null || !Object.is(now, f.value)) {
          return `it reads the setting \`${f.name}\` at ${f.value === null ? 'a value this chart cannot compare' : f.value}, and the document now holds ${now === undefined ? 'a value that cannot be read back' : now}`
        }
      }
    }
  }
  if (stop.period && periodValuesDiffer(stop.period, ctx && ctx.tf)) {
    return `it reads the chart's period, translated at \`${stop.period.base}\`, and this chart is \`${String(ctx && ctx.tf)}\``
  }
  return null
}

/** The names the bind settles from the chart's own timeframe (`timeframeFlags`). */
const FLAG_NAMES = Object.keys(timeframeFlags('D') || {})
/** The series whose VALUE depends on where the chart's history starts. */
const ORIGIN_SERIES = ['barindex', 'isfirst']

const mergeMask = (a, b) => {
  if (!a) return b || null
  if (!b) return a
  const out = new Uint8Array(Math.max(a.length, b.length))
  for (let i = 0; i < out.length; i += 1) out[i] = (a[i] || b[i]) ? 1 : 0
  return out
}

/** bars → Map(binding key → result): one evaluation serves the plot lane and the
 *  object lane of the same pass. ⛔ Its lifetime is the bars array's. */
const MEMO = new WeakMap()

/**
 * Does a `runtime.error` of this document's script stop it on these bars?
 *
 * @param {object} def a definition document (the member door's)
 * @param {Array}  bars the chart's bars
 * @param {object} [instanceInputs] the instance's inputs (merged over the defaults here)
 * @param {object} [ctx] `{tf, symbol, newestBarIsForming, historyFromListing}`
 * @returns {null | {reached: boolean, bar?: number, barKnown?: boolean, line?: number,
 *   message?: string|null, sentence?: string, title?: string,
 *   unknown: {line: number|null, why: string}[], unread: object[]}}
 *   `null` when the document carries no placed `runtime.error`.
 */
export function runtimeErrorStopFor(def, bars, instanceInputs, ctx = {}) {
  const stamp = stampOf(def)
  if (!stamp || !Array.isArray(bars) || !bars.length) return null
  const inputs = resolveInputs(def, instanceInputs)
  const fromListing = historyFromListingFor(def, ctx)
  let key
  try {
    key = JSON.stringify([def.id, def.version, inputs, ctx && ctx.tf, (ctx && ctx.newestBarIsForming) ?? null,
      fromListing, ctx && ctx.symbol ? [ctx.symbol.ticker, ctx.symbol.exchange] : null,
      (def.compute && def.compute.treesHash) || (def.compute && def.compute.fn) || null])
  } catch { key = null }
  let byKey = MEMO.get(bars)
  if (key !== null && byKey && byKey.has(key)) return byKey.get(key)

  const bindConsts = bindConstsFor({ tf: ctx && ctx.tf, inputs, symbol: ctx && ctx.symbol })
  const budget = def.compute && def.compute.budget
  const iopts = {
    tf: ctx && ctx.tf,
    newestBarIsForming: (ctx && ctx.newestBarIsForming) ?? null,
    ...(fromListing ? { historyFromListing: true } : {}),
  }
  const crossMemo = new Map()
  const probeMemos = new Map()
  const n = bars.length
  const unknown = []
  let hit = null
  for (const stop of stamp.stops) {
    const why = notEvaluable(stop, def, inputs, ctx)
    if (why) { unknown.push({ line: stop.line ?? null, why }); continue }
    try {
      const guards = (stop.guards || []).map((g) => {
        const tree = foldBound(g.ast, bindConsts)
        return { g, tree, col: interpret(tree, bars, inputs, budget, undefined, { ...iopts, crossMemo }) }
      })
      const satisfied = (g, v) => {
        const truthy = typeof v === 'number' && v === v && v !== 0
        return g.negate ? !truthy : truthy
      }
      // a factor that reads no bar: settings and the chart's own timeframe only
      const invariant = ({ g }) => g.barCalls !== true
        && (g.series || []).every((nm) => Object.prototype.hasOwnProperty.call(inputs, nm) || FLAG_NAMES.includes(nm))
      const bare = ({ g }, name) => !g.negate && g.ast && g.ast.type === 'series' && g.ast.name === name
      const readsOrigin = ({ g }) => (g.series || []).some((nm) => ORIGIN_SERIES.includes(nm))
      const fixed = guards.filter(invariant)
      const moving = guards.filter((x) => !invariant(x))
      // ⭐ one bar-free factor known false: the call is reached on no bar, anywhere
      if (fixed.some((x) => !satisfied(x.g, x.col[0]))) continue
      // ⭐ the validation idiom: every other factor holds, on TradingView's first bar
      if (!moving.length || (moving.length === 1 && bare(moving[0], 'isfirst'))) {
        if (!hit || hit.bar > 0) hit = { bar: 0, stop, unknownBefore: 0, barKnown: true }
        continue
      }
      // 1 = every condition so far is KNOWN satisfied · 0 = one is KNOWN not ·
      // 2 = none is known not, and at least one cannot be said
      const state = new Uint8Array(n).fill(1)
      for (const x of moving) {
        const { g, tree, col } = x
        let mask = unknownMask(tree, col, bars, inputs, budget, { ...iopts, probeBase: crossMemo }, probeMemos)
        let anchors
        try { anchors = periodAnchorMask(tree, bars, inputs, budget, undefined, iopts) } catch { anchors = new Uint8Array(n).fill(1) }
        mask = mergeMask(mask, anchors)
        // off the listing, this chart's bar count and its warm-up are not TradingView's
        let warm = 0
        if (!fromListing) {
          if (readsOrigin(x)) warm = n
          else { try { warm = Math.min(n, Math.max(0, maxLookback(tree) || 0)) } catch { warm = n } }
        }
        for (let i = 0; i < n; i += 1) {
          if (state[i] === 0) continue
          if (i < warm || (mask && mask[i] === 1)) { state[i] = 2; continue }
          if (!satisfied(g, col[i])) state[i] = 0
        }
      }
      let first = -1
      let unknownBefore = 0
      let unknownBars = 0
      for (let i = 0; i < n; i += 1) {
        if (state[i] === 2) { unknownBars += 1; if (first < 0) unknownBefore += 1 }
        if (state[i] === 1 && first < 0) first = i
      }
      if (first >= 0) {
        if (!hit || first < hit.bar) hit = { bar: first, stop, unknownBefore, barKnown: fromListing && unknownBefore === 0 }
      } else if (moving.some((x) => bare(x, 'islast'))) {
        // anchored on the newest bar, which this chart and TradingView both hold
        if (state[n - 1] === 2) unknown.push({ line: stop.line ?? null, why: 'its condition cannot be said on the newest bar (a value this chart does not hold the history for)' })
      } else if (unknownBars) {
        unknown.push({ line: stop.line ?? null, why: `its condition cannot be said on ${unknownBars} of ${n} bars${fromListing ? ' (a value still warming up)' : ' (this chart does not hold the history before them)'}` })
      } else if (!fromListing) {
        unknown.push({ line: stop.line ?? null, why: 'it is not reached on the bars this chart holds, and the chart does not hold the history before them' })
      }
    } catch (err) {
      unknown.push({
        line: stop.line ?? null,
        why: `its condition did not compute here (${(err && err.guard) || (err && err.name) || 'error'}): ${String((err && err.message) || err).slice(0, 160)}`,
      })
    }
  }

  let result
  if (hit) {
    // the script's own message, said with the bar's values
    let message = null
    if (Array.isArray(hit.stop.message)) {
      try {
        message = hit.stop.message.map((p) => {
          if (typeof p.s === 'string') return p.s
          const col = interpret(foldBound(p.n, bindConsts), bars, inputs, budget, undefined, { ...iopts, crossMemo })
          const v = col[hit.bar]
          if (typeof v !== 'number' || v !== v) throw new Error('na')
          return defaultNumberText(v)
        }).join('')
      } catch { message = null }
    }
    // ⛔ THE BAR NUMBER IS TRADINGVIEW'S ONLY WHERE OUR BAR 0 IS ITS BAR 0 — a
    // series stated to start at the listing bar, with no earlier bar unknown — or
    // where the call names the first bar itself (`hit.barKnown`).
    const barKnown = hit.barKnown === true
    result = {
      reached: true,
      bar: hit.bar,
      barKnown,
      line: hit.stop.line ?? null,
      message,
      ...runtimeErrorWords({ message, bar: hit.bar, barKnown }),
      unknown,
      unread: stamp.unread || [],
    }
  } else {
    result = { reached: false, unknown, unread: stamp.unread || [] }
  }
  if (key !== null) {
    if (!byKey) { byKey = new Map(); MEMO.set(bars, byKey) }
    byKey.set(key, result)
  }
  return result
}

registerRuntimeErrorStop(runtimeErrorStopFor)
