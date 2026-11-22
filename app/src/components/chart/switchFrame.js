// app/src/components/chart/switchFrame.js
//
// ─── ⭐⭐ buildFrame: A SYMBOL'S PER-BAR ARRAYS, WITHOUT A RENDER (imperative switch, stage 2; 2026-11-21) ───────
//
// docs/charts/imperative-switch-design.md §3.2. The imperative switch paints a symbol from OUTSIDE React, so it
// needs the arrays StockChart's memos would derive for that symbol, before any render of it exists. This is that
// chain, and ONLY that chain, on the plain path:
//
//     base snapshot ─ legacyBars ─▶ bars ─ deriveSession ─▶ sessionBars (= filteredBars = sessionAppliedBars)
//         ─ deriveDisplay ─▶ displayBars ─▶ ohlcBase / closeData      (and, off the session bars:) hvcSet,
//         volData, volMaData
//
// ⛔ ONE IMPLEMENTATION OF EVERY STEP. Each array comes from the function the chart's memo calls and the
// neighbour-frames preparer calls (`useNeighborFrames.derive*`), with the chart's own `recipes` object (built by
// the chart each render: what each step reads besides the bars, and its signature). Every answer is filed under
// the IDENTITY of the array it was computed from, so:
//   • a row the preparer already prepared is all lookups here: the same arrays, no copy, no recompute;
//   • the chart's memos, when the render of that symbol comes, find what this filed (or what the preparer did).
// So the frame the switch paints and the frame React would have painted are the same objects, not two results
// that happen to agree. `switchFrame.test.js` holds that, and holds each step equal to the memo's own function.
//
// ⛔ PURE: no store access, no chart, no request, no clock. The caller reads the snapshot; this never asks.
// ⛔ CHART CHUNK ONLY: imported by StockChart's switch controller. Never from a generic hook or the entry.
//
// WHAT THIS DOES NOT BUILD (stage 3 composes these beside it, or falls back to the React path):
//   • `ohlcData`. The memo paints `ohlcBase.slice()` plus a per-symbol tail: the session-preview recolour and the
//     load-anchor whitespace / today's seed (StockChart's `ohlcData` memo). The frame carries `ohlcBase`, the
//     filed array the copy is made from.
//   • anything off the plain path (replay, an override, a custom timeframe, an exact range, a session candle, an
//     ECON id), the legacy overlays and comparison, and every per-symbol layer (markers, price lines, sources).

import { legacyBars, newestBarIsFormingOf } from '../../data/barStore/adapter'
import { STATUS } from '../../data/barStore/types'
import {
  deriveSession, deriveDisplay, deriveHvc, deriveOhlcBase, deriveClose, deriveVol, deriveVolMa, deriveVolExtremes,
} from './useNeighborFrames'

/** The statuses a chart paints its snapshot as it stands (useBarSnapshotBars `PAINTS`, useNeighborFrames `PAINTS`). */
const PAINTS = new Set([STATUS.CONTEXT, STATUS.CURRENT, STATUS.UPDATING])
/** No volume average (the memo returns a fresh `[]`: a blank pane, or a period under 2). */
const NO_VOL_MA = Object.freeze([])

/** Why a frame was not built. A census: the controller reports the reason and takes the React path. */
export const NO_FRAME = Object.freeze({
  RECIPES: 'recipes',        // the chart has no recipes (neighbour frames off) or they are incomplete
  NOT_PLAIN: 'not-plain',    // replay, override, custom timeframe, exact range, session candle
  SNAPSHOT: 'snapshot',      // no snapshot for the key
  STATUS: 'status',          // a snapshot the chart would not paint as it stands (provisional, empty, unavailable)
  EMPTY: 'empty',            // no bars, or none in this session view
})
const no = (why) => ({ ok: false, why })

/**
 * The frame of one symbol: its per-bar arrays, by the chart's own recipes.
 *
 * @param {object|null} snapshot  the bar store's base snapshot of the symbol's key (`store.getBaseSnapshot`)
 * @param {{sym: string, tf: string, showExtended?: boolean}} view  whose frame this is (carried into the frame)
 * @param {object|null} recipes   the chart's recipes (`_nfRecipes` in StockChart: adjustTime, session, heikinAshi,
 *                                hvcOn, ohlc, close, vol, volMa, plain)
 * @returns {{ok: true, sym, tf, bars, sessionBars, filteredBars, sessionAppliedBars, displayBars, ohlcBase,
 *            closeData, hvcSet, volData, volMaData, newestBarIsForming} | {ok: false, why: string}}
 */
export function buildFrame(snapshot, view, recipes) {
  const r = recipes
  if (!r || !r.session || !r.ohlc || !r.close || !r.vol || !r.volMa || typeof r.adjustTime !== 'function') return no(NO_FRAME.RECIPES)
  if (!r.plain) return no(NO_FRAME.NOT_PLAIN)
  if (!snapshot) return no(NO_FRAME.SNAPSHOT)
  if (!PAINTS.has(snapshot.status)) return no(NO_FRAME.STATUS)
  const bars = legacyBars(snapshot)
  if (!bars || !bars.length) return no(NO_FRAME.EMPTY)
  // the chart's own chain, in the chart's own order (StockChart: sessionBars → filteredBars → sessionAppliedBars
  // → displayBars); on the plain path the middle three are one array (`_nfRecipes.plain` says so)
  const sessionBars = deriveSession(bars, r)
  if (!sessionBars || !sessionBars.length) return no(NO_FRAME.EMPTY)
  const displayBars = deriveDisplay(sessionBars, r)
  const ohlcBase = deriveOhlcBase(displayBars, r)
  const closeData = deriveClose(displayBars, r)
  const hvcSet = deriveHvc(sessionBars, r)
  // ⭐ A CHART THAT MARKS ITS VOLUME EXTREMES IS BUILT (`vol.on` false: the idle preparer skips it, this does not).
  // Every /charts pane marks them (`PANE_LOOK.markVolumeExtremes`), so refusing them refused every pane chart.
  // The mark is a function of the bars alone here: the framed year that could exclude it (`entryDate`,
  // `exitDate`) is one the controller refuses to carry (FRAME_RULES). `deriveVolExtremes` is the chart's own rule.
  const volExtremes = r.vol.on ? null : deriveVolExtremes(sessionBars, null, null)
  const volData = deriveVol(sessionBars, hvcSet, volExtremes, r)
  const volMaData = r.volMa.on ? deriveVolMa(sessionBars, r) : NO_VOL_MA
  return {
    ok: true,
    sym: view ? view.sym : undefined,
    tf: view ? view.tf : undefined,
    bars,
    sessionBars,
    filteredBars: sessionBars,
    sessionAppliedBars: sessionBars,
    displayBars,
    ohlcBase,
    closeData,
    hvcSet,
    volData,
    volMaData,
    newestBarIsForming: newestBarIsFormingOf(snapshot),
  }
}
