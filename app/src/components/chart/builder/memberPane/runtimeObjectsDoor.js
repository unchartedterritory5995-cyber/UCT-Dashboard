// app/src/components/chart/builder/memberPane/runtimeObjectsDoor.js
//
// ─── ⭐⭐ RT5 — WHEN A RUNTIME DOCUMENT DRAWS ITS OWN OBJECTS ──────────────────
//
// O1 measured the wall: `runtimeLaneDefinition` took its drawings from the HOST
// object program only, so a script whose drawings the host lane cannot follow
// (collections, UDTs, methods, loop values, a function's own state) drew nothing
// through the runtime fallback either. The run already EXECUTES those drawing
// calls; since RT5 it can keep what they make (`runtime/objectStore.js`).
//
// ⛔ THE DECISION IS NARROW ON PURPOSE, so nothing the door already draws moves:
//   · the host object program would draw NOTHING here (absent, empty, or
//     withheld for a lost removal) — a document that draws the host lane's
//     objects keeps doing exactly that;
//   · the run builds WITH its drawings (`probeRuntimeProgram({objectsInRun})`)
//     and lowered at least one drawing operation.
// Otherwise the door behaves exactly as before.
import { paneObjectsGate } from '../../engine/ast/paneGate'
import { probeRuntimeProgram } from '../../engine/runtime/runtimeColumns'

/**
 * @returns {{probe: object}|{probe: null, why: string|null}} the objects-in-run
 *   probe to use for this document, or why the door keeps the host lane's way.
 */
export function runtimeOwnObjectsOf({ source, t }) {
  const gate = paneObjectsGate(t)
  const hostDraws = gate.draw && !!(t && t.objects && (t.objects.ops || []).length)
  if (hostDraws) return { probe: null, why: null }
  const probe = probeRuntimeProgram(source, { objectsInRun: true })
  if (!probe.ok) {
    const r = probe.refusal || {}
    return { probe: null, guard: r.guard || 'runtime', why: `${r.guard || 'runtime'}${r.message ? ` — ${r.message}` : ''}` }
  }
  if (!(probe.objectOps > 0)) return { probe: null, why: null }
  return { probe }
}
