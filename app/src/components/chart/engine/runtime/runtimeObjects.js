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
