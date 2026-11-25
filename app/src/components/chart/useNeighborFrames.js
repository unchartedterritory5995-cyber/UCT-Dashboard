// app/src/components/chart/useNeighborFrames.js
//
// ─── ⭐⭐ NEIGHBOR FRAMES: ONE CHART PREPARES THE ROWS AROUND ITS SYMBOL (2026-11-20) ─────────────────────
//
// After a chart paints a symbol that a linked list is centred on (`neighborFrames.publishScanNeighbors`),
// this asks the chart's own questions of the next rows' bars in idle time (±1 first, then ±2):
//
//   1. the bars the chart would hold for that row: the store's base snapshot, read as the chart reads it
//      (`legacyBars`), then its session filter (`chartDerived.sessionBarsOf`);
//   2. the per-bar arrays the chart derives from them (candles, closes, volume, its average, the HVC set),
//      through the SAME functions and the SAME signatures the chart's memos use (`recipes`, built by the
//      chart each render);
//   3. the indicator columns and their points (`binder.prepare`).
//
// Each answer is filed under the very array it was computed from (`neighborFrames.deriveFrom`, the
// binder's prepared store), so when the member arrives the chart's memos and its binder find them, or,
// if the row changed meanwhile, compute exactly as before. Nothing here writes to the chart or makes a
// request. ⚠️ It does touch the bar store's bookkeeping: reading a row's base snapshot marks it used (the
// registry's LRU), and while a row is watched for new bars (`registry.subscribe`, a listener without a life
// cycle: no hydrate, no request) the registry will not evict it (the list's hold pins those rows anyway).
// A server-lane compute notes its ask (see `binder.prepare`).
//
// ⛔ Off unless `neighborFramesOn()`, the chart reads the bar store (`BARSTORE`) and the browser has a real idle
// signal (`idleSupported`); otherwise the hook returns before touching anything (the store is never created).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getBarStore } from '../../data/barStore/index'
import { BARSTORE } from './barStoreSwitch'
import { legacyBars, newestBarIsFormingOf } from '../../data/barStore/adapter'
import { STATUS } from '../../data/barStore/types'
import { chartKeyFor } from './useBarSnapshotBars'
import { sessionBarsOf, ohlcBaseOf, closeDataOf, volDataOf, volMaDataOf, computeHVC, volExtremesOf } from './chartDerived'
import { toHeikinAshi } from './indicators'
import {
  neighborFramesOn, scanNeighborsFor, subscribeScanNeighbors, scheduleIdle, cancelIdleFor,
  deriveFrom, hasDerived, identitySig, stableSig, chartTimesFor, nfCount, idleSupported, linkDerivedSource,
} from './neighborFrames'

/** The statuses a chart paints its snapshot as it stands (useBarSnapshotBars `PAINTS`). */
const PAINTS = new Set([STATUS.CONTEXT, STATUS.CURRENT, STATUS.UPDATING])
/** The rows prepared at all: ahead 1, behind 1, ahead 2 (the order `publishScanNeighbors` keeps). A row two
 *  BEHIND is not: a reversal is one row, and every prepared row is megabytes held (`binder.PREPARED_BARS_MAX`). */
export const PREPARE_RANKS = 3
/** The rows whose POINTS are made too (the nearest: points are the largest thing prepared). */
export const POINTS_RANKS = 2
/** A neighbour row whose bars change is prepared again this long after the last change. */
export const REPREPARE_MS = 120

/** The empty HVC set every flag-on chart shares (a fresh `new Set()` per memo would name nothing). */
export const EMPTY_HVC = Object.freeze(new Set())

/**
 * The derived arrays of one bars array, through the chart's own recipes. ONE implementation for the chart
 * (StockChart's memos call these) and the preparer, so the two can never derive differently.
 */
// (deriveSession / deriveDisplay file what they make under the row it came from: neighborFrames.linkDerivedSource)
export function deriveSession(bars, r) {
  const out = deriveFrom(bars, 'session', r.session.sig, () => sessionBarsOf(bars, r.session.p))
  linkDerivedSource(out, bars)
  return out
}
export function deriveDisplay(sessionApplied, r) {
  if (!(r.heikinAshi && sessionApplied?.length)) return sessionApplied
  const out = deriveFrom(sessionApplied, 'heikinAshi', '', () => toHeikinAshi(sessionApplied))
  linkDerivedSource(out, sessionApplied)
  return out
}
export function deriveHvc(filtered, r) {
  return r.hvcOn && filtered?.length > 20 ? deriveFrom(filtered, 'hvc', '', () => computeHVC(filtered)) : EMPTY_HVC
}
export function deriveOhlcBase(display, r) {
  return deriveFrom(display, 'ohlcBase', r.ohlc.sig, () => ohlcBaseOf(display, r.ohlc.sunrise, r.adjustTime, chartTimesFor(display, r.adjustTime)))
}
export function deriveClose(display, r) {
  return deriveFrom(display, 'close', r.close.sig, () => closeDataOf(display, r.close.p, r.adjustTime, chartTimesFor(display, r.adjustTime)))
}
export function deriveVol(sessionApplied, hvcSet, volExtremes, r) {
  const sig = `${r.vol.sig}|hvc${identitySig(hvcSet)}|vx${identitySig(volExtremes)}`
  return deriveFrom(sessionApplied, 'vol', sig, () => volDataOf(sessionApplied, r.vol.p, hvcSet, volExtremes, r.adjustTime, chartTimesFor(sessionApplied, r.adjustTime)))
}
/**
 * The chart's volume recipe (`p`: chartDerived.volDataOf's plain values; `at`: the adjustTime signature).
 * ⭐ (2026-11-23, next-row chart walks, item ii) PREPARED WHETHER OR NOT THE CHART MARKS THE HIGHEST-VOLUME BAR. It was
 * `on: !markVolumeExtremes`: the preparer could not know the chart's `volExtremes` (a fresh object per chart memo) and
 * the volume is filed under that object's identity, so a chart with the /charts look (pane/paneLook.js
 * `markVolumeExtremes: true`) built its volume at every press. The extremes are filed now too (`deriveVolExtremes`),
 * so the preparer and the arriving chart name the same object. (`markVolumeExtremes` stays a parameter: the call
 * sites read as before.)
 */
export function volRecipeOf(p, at, markVolumeExtremes) {   // eslint-disable-line no-unused-vars
  return { on: true, p, sig: `${stableSig(p)}|at${at}` }
}
/** The chart's highest-volume-ever recipe (`markVolumeExtremes`, and the year it is shown in). */
export function volExtremesRecipeOf(markVolumeExtremes, entryDate, exitDate) {
  const on = !!markVolumeExtremes
  const a = entryDate ?? null, b = exitDate ?? null
  return { on, entryDate: a, exitDate: b, sig: stableSig([a, b]) }
}
/** StockChart `volExtremes` (chartDerived.volExtremesOf), or null when the chart does not mark it: filed under the bars
 *  it was computed from, so the preparer's and the chart's are ONE object (the volume's signature names it). */
export function deriveVolExtremes(filtered, r) {
  if (!r.vx || !r.vx.on || !filtered?.length) return null
  return deriveFrom(filtered, 'volExtremes', r.vx.sig, () => volExtremesOf(filtered, r.vx.entryDate, r.vx.exitDate))
}
export function deriveVolMa(sessionApplied, r) {
  return deriveFrom(sessionApplied, 'volMa', r.volMa.sig, () => volMaDataOf(sessionApplied, r.volMa.period, r.adjustTime, chartTimesFor(sessionApplied, r.adjustTime)))
}

/**
 * One row, prepared: a generator for the idle queue (each `yield` a pause point).
 * @param {string} sym   the row's symbol
 * @param {number} rank  0 = the next row ahead, 1 = the row behind, 2/3 = two away
 * @param {object} c     `{recipes, view, engineRef}` read at run time (the chart's latest)
 */
export function* prepareRow(sym, rank, c) {
  const r = c.recipes()
  const v = c.view()
  if (!r || !v || !r.plain || !BARSTORE) return
  const store = getBarStore()
  const key = chartKeyFor({ sym, resolvedTf: v.tf, showExtended: v.showExtended, replayCutoff: null, hasOverride: false })
  if (!key || !store.registry.has(key)) { nfCount('barsSkipped'); return }
  const snap = store.getBaseSnapshot(key)
  if (!snap || !PAINTS.has(snap.status)) { nfCount('barsSkipped'); return }
  const all = legacyBars(snap)
  if (!all || !all.length) { nfCount('barsSkipped'); return }
  yield
  // the chart's own chain, in the chart's own order (StockChart: sessionBars → filteredBars → sessionAppliedBars → displayBars)
  const filtered = deriveSession(all, r)
  if (!filtered || !filtered.length) return
  yield
  const display = deriveDisplay(filtered, r)
  if (display !== filtered) yield
  // one chart time per bar first (its own piece), then each array over it
  chartTimesFor(display, r.adjustTime)
  yield
  if (!hasDerived(display, 'ohlcBase', r.ohlc.sig)) { deriveOhlcBase(display, r); yield }
  if (!hasDerived(display, 'close', r.close.sig)) { deriveClose(display, r); yield }
  const hvc = deriveHvc(filtered, r)
  yield
  // the volume under the very extremes the arriving chart will name (null when it does not mark them)
  if (r.vol.on) { deriveVol(filtered, hvc, deriveVolExtremes(filtered, r), r); yield }
  if (r.volMa.on) { deriveVolMa(filtered, r); yield }
  nfCount('barsPrepared')
  const binder = c.engineRef.current ? c.engineRef.current.binder : null
  if (binder && typeof binder.prepare === 'function') {
    yield* binder.prepare({ bars: filtered, sym, newestBarIsForming: newestBarIsFormingOf(snap), points: rank < POINTS_RANKS })
  }
}

/**
 * The chart's half: after it paints `sym`, prepare the rows a list published around it, and again when a
 * list publishes later or one of those rows' bars changes.
 * @param {{on: boolean, sym: string, tf: string, showExtended: boolean, engineRef: object, recipes: object|null}} o
 */
export function useNeighborFrames({ on, sym, tf, showExtended, engineRef, recipes }) {
  const [owner] = useState(() => ({}))   // this chart, as the idle queue's owner
  // what a queued piece reads when it runs: this chart's LATEST recipes and view (written after each commit)
  const recipesRef = useRef(recipes)
  const viewRef = useRef({ tf, showExtended })
  useLayoutEffect(() => {
    recipesRef.current = recipes
    viewRef.current = { tf, showExtended }
  })
  const live = !!(on && BARSTORE && neighborFramesOn() && idleSupported() && sym && tf && recipes && recipes.plain)
  useEffect(() => {
    if (!live) return undefined
    const symU = String(sym).toUpperCase()
    const store = getBarStore()
    const ctx = { recipes: () => recipesRef.current, view: () => viewRef.current, engineRef }
    let alive = true
    let raf = 0
    let timer = null
    let watched = []
    const unwatch = () => { for (const off of watched) { try { off() } catch { /* gone */ } } watched = [] }
    const schedule = () => {
      if (!alive) return
      cancelIdleFor(owner)
      const order = scanNeighborsFor(symU).slice(0, PREPARE_RANKS)
      order.forEach((n, rank) => scheduleIdle(owner, rank, prepareRow(n, rank, ctx)))
      // ⭐ a row whose bars change after it was prepared (its deeper history landed) is prepared again
      unwatch()
      for (const n of order) {
        const v = viewRef.current
        const key = chartKeyFor({ sym: n, resolvedTf: v.tf, showExtended: v.showExtended, replayCutoff: null, hasOverride: false })
        if (!key || !store.registry.has(key)) continue
        watched.push(store.registry.subscribe(key, () => {
          if (timer != null) clearTimeout(timer)
          timer = setTimeout(() => { timer = null; schedule() }, REPREPARE_MS)
        }, { wake: 'base' }))
      }
    }
    // after THIS paint: the frame the member is waiting for goes first
    raf = requestAnimationFrame(() => { raf = 0; schedule() })
    const offScan = subscribeScanNeighbors((c) => { if (c === symU && !raf) schedule() })
    return () => {
      alive = false
      if (raf) cancelAnimationFrame(raf)
      if (timer != null) clearTimeout(timer)
      offScan()
      unwatch()
      cancelIdleFor(owner)
    }
  }, [live, sym, tf, showExtended, engineRef, owner])
}
