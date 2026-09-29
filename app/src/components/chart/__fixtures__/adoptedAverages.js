// app/src/components/chart/__fixtures__/adoptedAverages.js
//
// ─── TEST SUPPORT: the four default moving averages are INSTANCES now ────────
//
// Since `maAdoption.js` (2026-09-28) every `mergeChartSettings` answer carries the
// member's `cs.overlays` averages as `movingAverage` instances `ovl:<i>`. Suites
// written before that measure SOMETHING ELSE — the v1→v2 fold, a preset, the
// binder's series count for an RSI — and assumed a default chart held no engine
// instance. These two helpers let such a suite say what it means:
//
//   · `NO_DEFAULT_AVERAGES` — a settings fragment whose four default slots are
//     member-deleted, so the chart has no average at all (the fold tombstones
//     them). For a suite measuring the engine with NOTHING ELSE drawn.
//   · `withoutAdopted(list)` — the instance list minus the adopted `ovl:<i>`
//     entries (live or tombstoned). For a suite asserting an exact list of the
//     instances IT put there.
//
// ⛔ Test-only. Nothing in `app/src` outside a test may import this.

import { CHART_DEFAULTS } from '../chartDefaults'

export const NO_DEFAULT_AVERAGES = Object.freeze({
  overlays: CHART_DEFAULTS.overlays.map((o) => ({ ...o, removed: true })),
})

export const isAdoptedId = (id) => typeof id === 'string' && /^ovl:\d+$/.test(id)

export function withoutAdopted(list) {
  return (Array.isArray(list) ? list : []).filter((i) => !(i && isAdoptedId(i.instanceId)))
}

/** `blob` with every default average deleted — merged OVER the caller's own keys
 *  only where the caller did not set `overlays` itself. */
export function noDefaultAverages(blob) {
  const b = blob && typeof blob === 'object' ? blob : {}
  return Object.prototype.hasOwnProperty.call(b, 'overlays') ? b : { ...NO_DEFAULT_AVERAGES, ...b }
}
