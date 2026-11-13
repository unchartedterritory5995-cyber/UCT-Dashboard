// app/src/components/chart/engine/runtime/runtimeObjects.js
//
// ─── ⭐⭐ RT5 — WHERE A RUN'S DRAWINGS RIDE, AND THE ONE READER OF THEM ───────
//
// A runtime document that draws its own objects (`compute.objects === true`,
// minted by `memberPaneDefinition::runtimeLaneDefinition`) gets them from the
// SAME run that computes its columns (`runtimeColumns.computeRuntimeColumns`):
// one execution, both answers, so a drawing can never come from a different run
// than the plot beside it.
//
// ⛔ THIS MODULE IMPORTS NOTHING. The binder and the vendor harness read the
// payload through `runtimeObjectsOf`, and neither may pull the runtime lane into
// a bundle that never opens a runtime pane.
//
// The payload is attached to the column record as a NON-ENUMERABLE property —
// the shape `nativeRegistry` already uses for `columnErrors` and the reached
// `runtime.error` — so every reader that walks a column map's keys sees columns
// and nothing else.

export const RUNTIME_OBJECTS_KEY = '__runtimeObjects'

/** Attach `payload` (plain data: `objectStore.finish()` + `pineVersion`). */
export function withRuntimeObjects(out, payload) {
  if (out && typeof out === 'object' && payload) {
    Object.defineProperty(out, RUNTIME_OBJECTS_KEY, { value: payload, enumerable: false, configurable: true })
  }
  return out
}

/** The run's drawings from a column record, or null. */
export function runtimeObjectsOf(cols) {
  if (!cols || typeof cols !== 'object') return null
  const p = cols[RUNTIME_OBJECTS_KEY]
  return p && typeof p === 'object' && Array.isArray(p.live) && p.status !== 'WITHHELD' ? p : null
}

/** A run that owned its drawings and withheld them by name: `{guard, reason}`, or null. */
export function runtimeObjectsWithheldOf(cols) {
  const p = cols && typeof cols === 'object' ? cols[RUNTIME_OBJECTS_KEY] : null
  return p && p.status === 'WITHHELD' ? { guard: p.guard, reason: p.reason } : null
}

/** Does this definition draw objects from its own run? */
export const drawsRuntimeObjects = (def) => !!(def && def.compute
  && def.compute.kind === 'runtime' && def.compute.objects === true)

/** ⭐ UIE PHASE 2 — where a run's withheld WARM-UP rides (`runtimeColumns.js::
 *  computeOffListing`): the same non-enumerable shape, so a column walk never sees it. */
export const RUNTIME_WARMUP_KEY = '__runtimeWarmup'

/** The warm-up a run withheld: `{ withheldBars, shift }` (bars [0, withheldBars) are
 *  `NaN` because their values depend on where the chart starts), or null. */
export function runtimeWarmupOf(cols) {
  const w = cols && typeof cols === 'object' ? cols[RUNTIME_WARMUP_KEY] : null
  return w && typeof w === 'object' ? w : null
}

// ─── ⭐⭐ ENGINE 53 — THE RUN HALF OF A HOST DOCUMENT ─────────────────────────────
//
// A host (`ast`) document whose object program lost some of its drawings may carry
// `compute.runtimeObjects` (`memberPaneDefinition::hostPartialRunHalf`): the same
// script, run bar by bar, makes its drawings complete. Its plots stay the host's; the
// run is asked only for its drawings, and only where it is proved to be the same
// computation on THIS chart (`nativeRegistry.js::withRunHalf`, the column rail). What
// the run decided rides beside the columns, non-enumerable, as every other record here.

/** Where the run half's state rides on a host document's column record. */
export const RUN_HALF_KEY = '__runHalf'

/** The run-half states. `served`: the run's drawings replace the host program's on this
 *  chart. `pending`: the run is in flight (the object layer draws nothing meanwhile, never
 *  the host picture then a swap). `refused`: the host picture stays, and the member is
 *  told why the complete one is not shown. */
export const RUN_HALF_STATES = Object.freeze(['served', 'pending', 'refused'])

/** Attach `{state, code}` to a column record (plain data). */
export function withRunHalfState(out, record) {
  if (out && typeof out === 'object' && record && RUN_HALF_STATES.includes(record.state)) {
    Object.defineProperty(out, RUN_HALF_KEY, { value: Object.freeze({ ...record }), enumerable: false, configurable: true })
  }
  return out
}

/** The run half's state on a column record, or null (a document without one). */
export function runHalfOf(cols) {
  const r = cols && typeof cols === 'object' ? cols[RUN_HALF_KEY] : null
  return r && typeof r === 'object' && RUN_HALF_STATES.includes(r.state) ? r : null
}

/** Does this definition carry a run half (an `ast` document with `compute.runtimeObjects`)? */
export const carriesRunHalf = (def) => !!(def && def.compute
  && def.compute.kind === 'ast' && def.compute.runtimeObjects && typeof def.compute.runtimeObjects === 'object')
