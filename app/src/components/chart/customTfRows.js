// app/src/components/chart/customTfRows.js
//
// ─── ⭐ A CUSTOM TIMEFRAME'S ROWS, FILED UNDER THE BASE ROWS THEY ARE RESAMPLED FROM (2026-11-27, key-task budget) ───
//
// A custom timeframe (4h, 2h, 45m, 2D... anything `timeframes.isNativeTf` refuses) is built on the client: the chart
// reads its NATIVE base key (60m for 4h and 2h, 15m for 45m, `timeframes.resampleSpec`) and resamples those rows
// (`utils/resampleBars.resampleForSpec`). The chart's hook did that in a `useMemo` (useBarSnapshotBars `_customBars`), so
// every switch made a NEW array, and every derived value of the chart (session filter, candles, closes, volume, its
// average, the HVC set, the binder's columns and points) is filed by the identity of the array it came from: none of the
// next row's could be prepared before the key, and the neighbour frames were switched off for custom timeframes.
// Measured (ab-rerun-20261126 4h-B3, one 4h chart, 6 traced presses, timer natives removed): a 31.4 ms key task holding
// the resample 2.9 ms, the base rows' legacy copy 1.2, the derived arrays 1.7, the binder's compute 3.4 (server columns
// aligned to 4h) and 3.7 of GC, where a native 1m + 15m board's two charts hold 18.4 ms in all.
//
// `deriveCustomTf` is that resample, filed (`neighborFrames.deriveFrom`) under the base rows and their row
// (`linkDerivedSource`), so the chart's hook and the idle preparer of the rows around it (useNeighborFrames.prepareRow)
// ask ONE question and get ONE array: the same function over the same rows and the same spec, the same numbers. A base
// array the preparer never saw (deeper history landed, a new answer) simply misses and is resampled as before.
// With the neighbour frames off this is exactly the old `resampleForSpec(all, spec)`, nothing filed.
//
// ⛔ A LEAF BESIDE neighborFrames.js: useBarSnapshotBars and useNeighborFrames both import it (useNeighborFrames imports
// useBarSnapshotBars, so the derivation cannot live in either without a cycle).

import { resample, resampleForSpec } from '../../utils/resampleBars'
import { resampleSpec } from './timeframes'
import { neighborFramesOn, deriveFrom, linkDerivedSource, stableSig } from './neighborFrames'

/** The spec a chart on `tf` resamples its base with (null for a native timeframe): the hook's `_customSpec`. */
export function customSpecOf(tf, showExtended) {
  return resampleSpec(String(tf), { extended: !!showExtended })
}

/**
 * The custom timeframe's rows from the base rows `all` (`resampleForSpec(all, spec)`), filed under `all` with the
 * neighbour frames on: the same (`all`, spec) asked again returns the same array.
 * @param {object[]} all   the base key's rows as the chart reads them (`adapter.legacyBars(snapshot)`)
 * @param {object} spec    `customSpecOf(tf, showExtended)` (a plain object: it is the signature)
 */
export function deriveCustomTf(all, spec) {
  if (!neighborFramesOn() || !Array.isArray(all) || !spec) return resampleForSpec(all, spec)
  const out = deriveFrom(all, 'customTf', stableSig(spec), () => resampleForSpec(all, spec))
  linkDerivedSource(out, all)
  return out
}

/**
 * ⭐ (2026-11-27, review of #2922, N2) A WEEKLY OR MONTHLY CHART WHOSE OWN KEY IS STILL EMPTY shows the same-frame
 * resample of the held DAILY rows (useBarSnapshotBars `_aggBars`). Filed under those daily rows like a custom timeframe,
 * so the double buffer can prove a shadow's W/M bars are the ones the store would give now (useDoubleBuffer.barsNowFor).
 * With the neighbour frames off, exactly the old `resample(daily, 'D', tf)`.
 */
export function deriveWmFromDaily(daily, tf) {
  if (!neighborFramesOn() || !Array.isArray(daily)) return resample(daily, 'D', tf)
  const out = deriveFrom(daily, 'wmFromDaily', stableSig(String(tf)), () => resample(daily, 'D', tf))
  linkDerivedSource(out, daily)
  return out
}
