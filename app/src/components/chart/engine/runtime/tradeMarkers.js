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
// ⛔ PINNING W9-MK1 IS ONE LEDGER ENTRY PLUS ITS NAME: the T1 rail (`w9T1Broker.test.js`) holds
// the ledger to `BROKER_RULE_IDS`, so the coordinator merge that pins `MARKER_RULE` also names it
// there (or widens that rail to `MARKER_RULE`). Until then the ledger cannot hold it, and the
// markers refuse.
//
// ⛔ AN INDICATOR HAS NO RECORD AND GETS NO MARKERS: `null`, never a refusal (a sentence about a
// backtest on a chart that ran none would be a sentence about nothing).
//
// ⛔ A MARKER SET IS NEVER SHOWN WITH A FILL MISSING (design rule 1): a record the markers cannot
// read whole (its shape, a fill after `asOfBar`, a fill with no order in the log) refuses whole.

import { pinned } from './brokerPins.js'
import { UNPINNED_GUARD } from './brokerRules.js'
import { STRATEGY_WINDOW_HISTORY, runtimeStrategyOf, strategyRecordShapeErrors } from './strategyRecord.js'

/** The presentation rule the markers rest on, and the capture row that pins it (design 5.2). */
export const MARKER_RULE = 'MK-LOOK'
export const MARKER_CAPTURE = 'W9-MK1'
/** The input is not a v1 strategy record the markers can read whole. */
export const MARKER_RECORD_GUARD = 'runtime:strategy-markers-record'
/** The record does not carry a field every marker needs (the order log, the exit's id). */
export const MARKER_UNRECORDED_GUARD = 'runtime:strategy-markers-unrecorded'
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
    return refusal(MARKER_RECORD_GUARD, 'Trade markers are not drawn: the backtest record could not be read whole '
      + `(${errs.slice(0, 3).join(', ')}).`, { errors: errs.slice() }, asOfBar)
  }
  // ⭐⭐ D1: the look is asked of the committed ledger, at the moment markers are asked for
  const isPinned = typeof opts.isPinned === 'function' ? opts.isPinned : (id) => pinned(id)
  if (!isPinned(MARKER_RULE)) {
    return refusal(UNPINNED_GUARD, MARKER_UNPINNED_SENTENCE, { rule: MARKER_RULE, capture: MARKER_CAPTURE }, asOfBar)
  }
  const unserved = record.unserved || {}
  const missing = ['orders', 'trades.exitId'].filter((k) => Object.prototype.hasOwnProperty.call(unserved, k))
  if (missing.length) {
    return refusal(MARKER_UNRECORDED_GUARD, 'Trade markers are not drawn: each marker names its order, and the '
      + `backtest record does not carry ${missing.join(' and ')} yet.`,
    { fields: missing, owners: missing.map((k) => unserved[k]) }, asOfBar)
  }
  const orders = Array.isArray(record.orders) ? record.orders : []
  const fills = new Map()
  const bad = []
  const addFill = (role, t, id, time, price) => {
    if (typeof id !== 'string' || !Number.isFinite(price)) { bad.push(`trade ${t.n} ${role}`); return }
    if (asOfBar === null || time > asOfBar) { bad.push(`trade ${t.n} ${role} after asOfBar`); return }
    const key = `${role}|${id}|${time}|${price}|${t.dir}`
    let f = fills.get(key)
    if (!f) {
      const order = orders.find((o) => o && o.id === id && o.status === 'filled' && o.fillTime === time)
      if (!order) { bad.push(`trade ${t.n} ${role} has no filled order ${id}`); return }
      f = { role, id, time, price, dir: t.dir, side: sideOf(role, t.dir), qty: 0, trades: [],
        comment: typeof order.comment === 'string' && order.comment !== '' ? order.comment : null }
      fills.set(key, f)
    }
    f.qty += t.qty
    f.trades.push(t.n)
  }
  for (const t of record.trades) {
    addFill('entry', t, t.entryId, t.entryTime, t.entryPrice)
    if (!t.open) addFill('exit', t, t.exitId, t.exitTime, t.exitPrice)
  }
  if (bad.length) {
    return refusal(MARKER_RECORD_GUARD, 'Trade markers are not drawn: the backtest record could not be read whole '
      + `(${bad.slice(0, 3).join(', ')}).`, { errors: bad }, asOfBar)
  }
  // fill order: by bar time, an exit before an entry on the same bar (a fill closes before it opens)
  const markers = [...fills.values()].sort((a, b) => (a.time - b.time)
    || ((a.role === 'exit' ? 0 : 1) - (b.role === 'exit' ? 0 : 1)) || (a.trades[0] - b.trades[0]))
    .map((f, i) => Object.freeze({ ...f, n: i + 1, trades: Object.freeze(f.trades.slice()) }))
  return Object.freeze({ schema: TRADE_MARKERS_SCHEMA, status: 'ok', asOfBar, stamp: markerStampOf(asOfBar),
    markers: Object.freeze(markers) })
}

/** One marker's text lines (MK-H-TEXT, MK-H-QTY). */
export function markerText(m) {
  return `${m.comment !== null ? m.comment : m.id}\n${m.side === 'buy' ? '+' : '-'}${String(m.qty)}`
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

/** ⭐ The documents that can carry a record: a runtime document stamped with the strategy window
 *  (`memberPaneDefinition.js`, possible only with the broker gate on). Every indicator is false. */
export const drawsTradeMarkers = (def) => !!(def && def.compute && def.compute.kind === 'runtime'
  && def.meta && def.meta.runtimeHistory === STRATEGY_WINDOW_HISTORY)

/** ⭐⭐ THE MEMBER DOOR: the run's record off its column record, asked of the committed ledger.
 *  ⛔ No pin argument, ever: the test-only path is `tradeMarkersOf(record, { isPinned })`. */
export function memberTradeMarkers(cols) {
  return tradeMarkersOf(runtimeStrategyOf(cols))
}

// ─── the outcome a member surface reads (the report panel, T13b): per chart instance ─────────
const published = new Map()
const listeners = new Set()
export function publishTradeMarkers(instanceId, result) {
  const had = published.has(instanceId)
  if (result) published.set(instanceId, result)
  else if (had) published.delete(instanceId)
  else return
  for (const fn of listeners) { try { fn(instanceId) } catch { /* a listener never breaks the chart */ } }
}
export function tradeMarkersFor(instanceId) { return published.get(instanceId) || null }
export function onTradeMarkersChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export function resetTradeMarkers() { published.clear(); listeners.clear() }
