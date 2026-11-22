// app/src/components/chart/engine/runtime/tradeMarkers.js
//
// ─── ⭐⭐ W9-T12 — A STRATEGY'S TRADE MARKERS, FROM THE RUN'S RECORD ─────────────────
//
// The renderer primitive for the markers TradingView draws on a strategy's chart: an arrow at
// each order fill with the order's id (or comment) and its signed size. Pure: the run's
// `strategy` record (`strategyRecord.js`, design 3.2) in, markers out. No fill is recomputed
// here: every time, price, size and id is the broker's (`broker.js`), read off the record
// (design rule 3: one record feeds the values, the markers, the report and the server).
//
// ⛔⛔ WHAT IS REFERENCE AND WHAT IS HYPOTHESIS. What a marker is ABOUT is the record's: the
// fill's bar time, price, direction, size, order id and comment. How it LOOKS (shape, colour,
// text format, placement, how fills on one bar share a marker) is stated exactly by no source
// the repo holds, so every such choice is a NAMED HYPOTHESIS in `MARKER_LOOK_HYPOTHESES`, to be
// settled by capture row W9-MK1 (`w9-mk1-markers.pine`: the strategy source's `graphics()` and
// `properties().state()`).
//
// ⛔⛔ PIN BEFORE SERVE (ruling D1, design rule 2). The look serves only when the committed
// ledger pins `MARKER_RULE` (`pinned(rule)`, asked HERE, when markers are asked for). Until
// W9-MK1 pins it, the member door REFUSES BY NAME (`runtime:strategy-unpinned`, naming the rule
// and capture row W9-MK1, with a member sentence) and draws nothing: a guessed look is a silent
// wrong picture (design rule 1). Tests pass `isPinned` (a predicate, like `broker.js`'s
// `data.isPinned` and `brokerReport.js`), never a second argument to `pinned`; the member door
// (`memberTradeMarkers`) passes neither.
//
// ⭐ `MARKER_RULE` IS A PRESENTATION RULE (`brokerRules.js::PRESENTATION_RULES`, the one authority
// over its id and capture row), never an emulator rule. The ledger may name it (T1 rail:
// `isLedgerRuleId`), so pinning W9-MK1 is the ledger entry plus the `SCRIPT_ENGINE_VERSION` bump
// (design rule 7) and nothing else.
//
// ⛔ AN INDICATOR HAS NO RECORD AND GETS NO MARKERS: `null`, never a refusal (a sentence about a
// backtest on a chart that ran none would be a sentence about nothing).
//
// ⛔ A MARKER SET IS NEVER SHOWN WITH A FILL MISSING (design rule 1): a record the markers cannot
// read whole (its shape, a fill after `asOfBar`, a fill with no order in the log) refuses whole.
//
// ⭐⭐ W9-T7-F1 — EACH FILL IS FOUND THROUGH THE ORDER LOG'S OWN LINK (`orders[].opened` / `closed`, the
// trades each order opened or closed), never by matching ids and times. Its label is the order's comment,
// else its id (R6, every order command's `comment`: "the Strategy Tester and the chart show this text for the
// order instead of" the id). ⛔ An exit TradingView names itself (`strategy.close`, `close_all`, a reversal:
// `strategyRecord.js::exitIdOf` is null) with no comment, or an order whose comment the script computes, has
// no label the record knows: the set refuses whole by name (`MARKER_UNLABELLED_GUARD`), never a guessed name.

import { pinned } from './brokerPins.js'
import { UNPINNED_GUARD, MARKER_RULE, PRESENTATION_RULES } from './brokerRules.js'
import { STRATEGY_WINDOW_HISTORY, runtimeStrategyOf, strategyRecordShapeErrors, exitIdOf, orderLabelOf, exitLabelUnstated } from './strategyRecord.js'
import { toRenderState } from '../objectRenderState.js'

/** The presentation rule the markers rest on, and the capture row that pins it (design 5.2),
 *  both read from the one table (`brokerRules.js`). */
export { MARKER_RULE }
export const MARKER_CAPTURE = PRESENTATION_RULES[MARKER_RULE].capture
/** The input is not a v1 strategy record the markers can read whole. */
export const MARKER_RECORD_GUARD = 'runtime:strategy-markers-record'
/** Served markers ride the script's own drawings, and this chart is not showing those yet. */
export const MARKER_WITHHELD_GUARD = 'runtime:strategy-markers-withheld'
/** The record does not carry a field every marker needs (the order log, the exit's id): a record from an
 *  engine before W9-T7-F1, which listed both in `unserved`. */
export const MARKER_UNRECORDED_GUARD = 'runtime:strategy-markers-unrecorded'
/** ⭐ W9-T7-F1 — a fill whose label the record does not know (a name TradingView makes up, a computed comment). */
export const MARKER_UNLABELLED_GUARD = 'runtime:strategy-markers-unlabelled'
export const TRADE_MARKERS_SCHEMA = 'uct.strategy-markers/v1'

/** ⭐ THE LOOK, EVERY PIECE OF IT A HYPOTHESIS W9-MK1 SETTLES. One table, so the capture reader
 *  has one list to check and a pin changes one place. `value` is what the drawing code uses. */
export const MARKER_LOOK_HYPOTHESES = Object.freeze({
  'MK-H-FILL': Object.freeze({ value: 'one marker per order fill', what: 'a fill that opens or closes several trades (pyramided entries split by a partial exit, a FIFO exit over several trades) is one marker with the summed size' }),
  'MK-H-GROUP': Object.freeze({ value: 'one label per bar and side, fills in fill order', what: 'fills on the same bar and the same side (a reversal\'s exit and entry) share one label, one text line pair per fill' }),
  'MK-H-SHAPE': Object.freeze({ value: { buy: 'arrowup', sell: 'arrowdown' }, what: 'a buy is an up arrow, a sell a down arrow' }),
  'MK-H-COLOUR': Object.freeze({ value: { entryBuy: '#2962FF', entrySell: '#F23645', exit: '#9C27B0' }, what: 'entry colours by direction, one colour for every exit' }),
  'MK-H-TEXT': Object.freeze({ value: '<comment, else id>\\n<+|-><qty>', what: 'the order\'s comment when it has one, else its id, then the signed size' }),
  'MK-H-QTY': Object.freeze({ value: 'String(qty)', what: 'the size as JavaScript prints it (no thousands separator, no rounding)' }),
  'MK-H-PLACE': Object.freeze({ value: 'at the fill price', what: 'the arrow\'s tip sits at the fill price (not the bar\'s high or low)' }),
  'MK-H-SIZE': Object.freeze({ value: 'small', what: 'the label size' }),
})

const LOOK = Object.freeze({
  shape: MARKER_LOOK_HYPOTHESES['MK-H-SHAPE'].value,
  colour: MARKER_LOOK_HYPOTHESES['MK-H-COLOUR'].value,
  size: MARKER_LOOK_HYPOTHESES['MK-H-SIZE'].value,
})

const dateOf = (t) => (Number.isFinite(t) ? new Date(t * 1000).toISOString().slice(0, 10) : null)
/** ⭐ The `asOfBar` stamp (design 3.2: shown on the markers and in the report). UTC, and says so:
 *  no record carries the symbol's exchange timezone (`strategyRecord.js`, ruling D2's note). */
export function markerStampOf(asOfBar) {
  const d = dateOf(asOfBar)
  return d ? `trades through the closed bar of ${d} (UTC)` : 'no closed bar was run'
}

const refusal = (guard, sentence, extra, asOfBar) => Object.freeze({
  schema: TRADE_MARKERS_SCHEMA, status: 'refused', guard, sentence, asOfBar: asOfBar ?? null, ...extra,
})

/** The sentence a member reads while W9-MK1 is open. */
export const MARKER_UNPINNED_SENTENCE = 'Trade markers are not drawn: how TradingView draws a strategy\'s '
  + `entry and exit markers (shape, colour, text and placement) has not been measured yet (capture row ${MARKER_CAPTURE}). `
  + 'The script\'s plots are not affected.'

/** ⛔ MEMBER SENTENCES SAY WHAT IS MISSING IN WORDS: the field paths and the raw shape errors
 *  stay on the refusal (`fields`, `errors`) for a reader that diagnoses, never in the sentence. */
export const MARKER_UNRECORDED_SENTENCE = 'Trade markers are not drawn: each marker is labelled with the order '
  + "that filled, and this backtest does not keep a log of its orders yet. The script's plots are not affected."
export const MARKER_RECORD_SENTENCE = "Trade markers are not drawn: this backtest's list of trades could not be read "
  + "in full, and markers are never shown with a trade missing. The script's plots are not affected."
export const MARKER_UNLABELLED_SENTENCE = 'Trade markers are not drawn: each marker is labelled with its order\'s '
  + 'comment or name, and for at least one fill here that label is not known (a name TradingView gives a closing '
  + "order itself, or a comment the script computes). The script's plots are not affected."

export const MARKER_WITHHELD_SENTENCE = "Trade markers are not drawn: they are drawn together with the script's "
  + "own drawings, and this chart is not showing those yet. The script's plots are not affected."

/** ⭐ W9-T12 r2 (N1) — THE OUTCOME EQUALS THE PICTURE. When the layer the served markers ride is
 *  cleared (the host drawings withheld, or a render that failed), the published outcome is this
 *  refusal, never `ok` over an empty pane. A non-`ok` outcome passes through unchanged. */
export function markersWithheldWith(result) {
  if (!result || result.status !== 'ok') return result
  return refusal(MARKER_WITHHELD_GUARD, MARKER_WITHHELD_SENTENCE, {}, result.asOfBar)
}

const sideOf = (role, dir) => ((role === 'entry') === (dir === 'long') ? 'buy' : 'sell')

/**
 * The markers of one run, or why there are none.
 *
 * @param {object|null} record  the run's `strategy` record (`strategyRecord.js`), or null
 * @param {{isPinned?: (rule: string) => boolean}} [opts]  TESTS ONLY: the pin predicate
 * @returns {null | {status: 'refused', guard, sentence, asOfBar, ...}
 *               | {status: 'ok', asOfBar, stamp, markers: Array}}
 */
export function tradeMarkersOf(record, opts = {}) {
  if (record === null || record === undefined) return null
  const errs = strategyRecordShapeErrors(record)
  const asOfBar = record && record.window ? record.window.asOfBar : null
  if (errs.length) {
    return refusal(MARKER_RECORD_GUARD, MARKER_RECORD_SENTENCE, { errors: errs.slice() }, asOfBar)
  }
  // ⭐⭐ D1: the look is asked of the committed ledger, at the moment markers are asked for
  const isPinned = typeof opts.isPinned === 'function' ? opts.isPinned : (id) => pinned(id)
  if (!isPinned(MARKER_RULE)) {
    return refusal(UNPINNED_GUARD, MARKER_UNPINNED_SENTENCE, { rule: MARKER_RULE, capture: MARKER_CAPTURE }, asOfBar)
  }
  const unserved = record.unserved || {}
  const missing = ['orders', 'trades.exitId'].filter((k) => Object.prototype.hasOwnProperty.call(unserved, k))
  if (missing.length) {
    return refusal(MARKER_UNRECORDED_GUARD, MARKER_UNRECORDED_SENTENCE,
      { fields: missing, owners: missing.map((k) => unserved[k]) }, asOfBar)
  }
  // ⭐ W9-T7-F1: the order that opened / closed each trade, by the log's own link
  const opener = new Map()
  const closer = new Map()
  for (const o of record.orders) {
    for (const n of o.opened) opener.set(n, o)
    for (const n of o.closed) closer.set(n, o)
  }
  const fills = new Map()
  const bad = []
  const unlabelled = []
  const addFill = (role, t, order, time, price) => {
    if (!order || order.status !== 'filled' || order.fillTime !== time || !Number.isFinite(price)) {
      bad.push(`trade ${t.n} ${role} has no filled order`); return
    }
    if (asOfBar === null || time > asOfBar) { bad.push(`trade ${t.n} ${role} after asOfBar`); return }
    // the id of this fill: an entry's own; an exit's `exitIdOf` (null when TradingView names it); and the text
    // shown for it (`orderLabelOf`, the one authority the report's trade list reads too)
    const id = role === 'entry' ? order.id : exitIdOf(order)
    const label = orderLabelOf(order, role)
    if (label === null) {
      unlabelled.push(`trade ${t.n} ${role} (order ${order.n}, ${!order.commentRecorded ? 'a computed comment' : exitLabelUnstated(order, role) ? 'a reversing entry' : 'no stated name'})`)
      return
    }
    // one marker per order fill (MK-H-FILL): a fill closing or opening several trades is one marker
    const key = `${role}|${order.n}|${time}|${price}|${t.dir}`
    let f = fills.get(key)
    if (!f) {
      f = { role, id, time, price, dir: t.dir, side: sideOf(role, t.dir), qty: 0, trades: [], comment: order.comment, label }
      fills.set(key, f)
    }
    f.qty += t.qty
    f.trades.push(t.n)
  }
  for (const t of record.trades) {
    addFill('entry', t, opener.get(t.n), t.entryTime, t.entryPrice)
    if (!t.open) addFill('exit', t, closer.get(t.n), t.exitTime, t.exitPrice)
  }
  if (bad.length) {
    return refusal(MARKER_RECORD_GUARD, MARKER_RECORD_SENTENCE, { errors: bad }, asOfBar)
  }
  if (unlabelled.length) {
    return refusal(MARKER_UNLABELLED_GUARD, MARKER_UNLABELLED_SENTENCE, { fills: unlabelled }, asOfBar)
  }
  // fill order: by bar time, an exit before an entry on the same bar (a fill closes before it opens)
  const markers = [...fills.values()].sort((a, b) => (a.time - b.time)
    || ((a.role === 'exit' ? 0 : 1) - (b.role === 'exit' ? 0 : 1)) || (a.trades[0] - b.trades[0]))
    .map((f, i) => Object.freeze({ ...f, n: i + 1, trades: Object.freeze(f.trades.slice()) }))
  return Object.freeze({ schema: TRADE_MARKERS_SCHEMA, status: 'ok', asOfBar, stamp: markerStampOf(asOfBar),
    markers: Object.freeze(markers) })
}

/** One marker's text lines (MK-H-TEXT, MK-H-QTY): the fill's label (`strategyRecord.js::orderLabelOf`, its
 *  comment else its id), then the signed size. */
export function markerText(m) {
  return `${m.label}\n${m.side === 'buy' ? '+' : '-'}${String(m.qty)}`
}

/**
 * ⭐⭐ THE DRAWING: served markers as label objects of the generic render state's input
 * (`objectRenderState.js::toRenderState`, `family: 'label'`, `xloc: 'bar_time'`), so they are
 * placed by the chart's one bar clock and painted by the one canvas. Every look value comes
 * from `MARKER_LOOK_HYPOTHESES`. Reached by a member only once `tradeMarkersOf` serves, which
 * it does only when W9-MK1 is pinned.
 */
export function tradeMarkerObjects(result) {
  if (!result || result.status !== 'ok') return []
  const groups = new Map()
  for (const m of result.markers) {
    const k = `${m.time}|${m.side}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(m)
  }
  const out = []
  for (const [k, ms] of groups) {
    const first = ms[0]
    const colour = first.role === 'exit' ? LOOK.colour.exit
      : first.side === 'buy' ? LOOK.colour.entryBuy : LOOK.colour.entrySell
    out.push({
      id: `mk:${k}`,
      family: 'label',
      props: {
        x: first.time * 1000,   // `xloc.bar_time` is milliseconds; the record is seconds
        xloc: 'bar_time',
        // MK-H-PLACE: the first fill's price (one bar, one side: the fills of a group)
        y: first.price,
        yloc: 'price',
        style: LOOK.shape[first.side],
        color: colour,
        textcolor: colour,
        size: LOOK.size,
        textalign: 'center',
        text: ms.map(markerText).join('\n'),
        tooltip: `${result.stamp}`,
      },
    })
  }
  return out
}

/**
 * ⭐ W9-T12 r2 (N2) — served markers JOINED to the host program's render state, as one picture:
 * their labels appended, their ids and their bars appended IN STEP (`liveIds[i]` was born on
 * `createdBars[i]`), and a marker the chart cannot place counted in `dropped` / `unplaced`, so the
 * member's drawing note (`objectRenderNotice.js`) counts it like any dropped drawing.
 *
 * @returns {{state, liveIds: Array, createdBars: Array}} the inputs unchanged when there is nothing to add
 */
export function joinMarkersToState(state, liveIds, createdBars, markLive, { bars, tf, theme } = {}) {
  if (!state || !Array.isArray(markLive) || !markLive.length) return { state, liveIds, createdBars }
  const m = toRenderState(markLive, { bars, tf, theme })
  const placed = new Map(m.labels.map((l) => [l.id, l.x]))
  const barAt = new Map((bars || []).map((b, i) => [b.t, i]))
  const plus = (a, b) => {
    const out = { ...(a || {}) }
    for (const [k, v] of Object.entries(b || {})) out[k] = (Number.isFinite(out[k]) ? out[k] : 0) + v
    return out
  }
  return {
    state: {
      ...state,
      labels: (state.labels || []).concat(m.labels),
      dropped: plus(state.dropped, m.dropped),
      unplaced: plus(state.unplaced, m.unplaced),
      ...(state.counts ? { counts: { ...state.counts, label: (state.counts.label || 0) + m.labels.length } } : {}),
    },
    liveIds: (liveIds || []).concat(markLive.map((o) => o.id)),
    createdBars: (createdBars || []).concat(markLive.map((o) => (placed.has(o.id) && barAt.has(placed.get(o.id))
      ? barAt.get(placed.get(o.id)) : null))),
  }
}

/** ⭐ The documents that can carry a record: a runtime document stamped with the strategy window
 *  (`memberPaneDefinition.js`, possible only with the broker gate on). Every indicator is false. */
export const drawsTradeMarkers = (def) => !!(def && def.compute && def.compute.kind === 'runtime'
  && def.meta && def.meta.runtimeHistory === STRATEGY_WINDOW_HISTORY)

/** ⭐⭐ THE MEMBER DOOR: the run's record off its column record, asked of the committed ledger.
 *  ⛔ No pin argument, ever: the test-only path is `tradeMarkersOf(record, { isPinned })`. */
export function memberTradeMarkers(cols) {
  return tradeMarkersOf(runtimeStrategyOf(cols))
}

// ─── the outcome a member surface reads (the report panel, T13b) ───────────────────────────
//
// ⭐ SCOPED BY BINDER, THEN BY INSTANCE (as `objectRenderNotice.js`): one instance id can be drawn
// by several binders at once (a grid cell, a workspace widget, a popup), so an instance-only key
// let chart A's sync or teardown overwrite or erase chart B's outcome. An absent scope is `''`.
// ⭐ EMITS ONLY ON A CHANGE BY VALUE: `tradeMarkersOf` builds a fresh object every sync, so an
// identity check would re-render a listener on every sync with nothing changed.

/** scope → instanceId → `{ result, key }` */
const published = new Map()
const listeners = new Set()
const valueKey = (r) => JSON.stringify(r)
const emit = (instanceId, scope) => {
  for (const fn of [...listeners]) { try { fn(instanceId, scope) } catch { /* a listener never breaks the chart */ } }
}

/** Record (or clear, with null) one instance's marker outcome in one binder's scope. */
export function publishTradeMarkers(instanceId, result, scope = '') {
  if (!instanceId) return
  const sc = scope || ''
  const own = published.get(sc)
  const had = own ? own.get(instanceId) : undefined
  if (!result) {
    if (!had) return
    own.delete(instanceId)
    if (!own.size) published.delete(sc)
    emit(instanceId, sc)
    return
  }
  const key = valueKey(result)
  if (had && had.key === key) return
  if (own) own.set(instanceId, { result, key })
  else published.set(sc, new Map([[instanceId, { result, key }]]))
  emit(instanceId, sc)
}
/** One instance's outcome in one binder's scope, or null. */
export function tradeMarkersFor(instanceId, scope = '') {
  const own = published.get(scope || '')
  const hit = own ? own.get(instanceId) : undefined
  return hit ? hit.result : null
}
/** ⭐ Subscribe; returns the unsubscribe. */
export function onTradeMarkersChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }
/** ⛔ TEST SEAM. */
export function resetTradeMarkers() { published.clear(); listeners.clear() }
