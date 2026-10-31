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
// ⛔ THE DECISION IS NARROW ON PURPOSE:
//   · the host object program would draw NOTHING here (absent, empty, or
//     withheld for a lost removal) — RT5;
//   · OR (WS-E) the host program draws, and either it LOST some of the script's
//     drawings (`assessObjectLoss` verdict other than `clean`) or the value build
//     cannot stand without the drawings it dropped (below);
//   · AND the run builds WITH its drawings (`probeRuntimeProgram({objectsInRun})`)
//     and lowered at least one drawing operation.
// Otherwise the door behaves exactly as before: a CLEAN host program keeps
// drawing the host program's objects, untouched.
//
// ⭐⭐ PHASE 3 WS-E — WHY A HOST PROGRAM THAT DRAWS IS NOT ALWAYS THE ANSWER.
// The value build hands every drawing call to the host object program
// (`objectTrees: []`). The host program evaluates a drawing only where its
// columnar values can say when and where it stands, so a drawing guarded by
// `var` state, made in a loop, held in a variable and read back with a getter, is
// DROPPED there (`objectLoss` counts it, the member reads "n of m drawing
// elements aren't supported yet"). Two shapes, both measured on the runtime-on
// census (WS-0 baseline):
//   1. the value build REFUSES at `runtime:object-op`: a drawing the host program
//      did not take has nowhere to go — 4 sample scripts declined on exactly that,
//      each with a host program that draws, so the run that can draw them was never
//      tried;
//   2. the value build SUCCEEDS and the document drew the host program's PARTIAL
//      picture, disclosed as such (2 sample scripts at the baseline:
//      aetheredge-smart-money-flow, nadaraya-watson-combine — neither has a capture
//      yet) while the run executes every drawing call the script makes, bar by bar,
//      in source order — TradingView's own model.
// In both the run's drawings replace the host program's. The run's store
// withholds by name any family whose answer no capture settles (`objectStore.js`),
// so the replacement is never a guess presented as a drawing.
//
// ⛔ A CLEAN host program is never replaced: it already draws everything the
// script draws, and the vendor harness grades it.
import { paneObjectsGate } from '../../engine/ast/paneGate'
import { probeRuntimeProgram } from '../../engine/runtime/runtimeColumns'

/** The value build's refusal that only the drawing build can answer. */
export const VALUE_BUILD_DRAWING_GUARD = 'runtime:object-op'

/**
 * @returns {{probe: object}|{probe: null, why: string|null, guard?: string, valueProbe?: object}}
 *   the objects-in-run probe to use for this document, or why the door keeps
 *   the host lane's way (with the value build's probe when it was already run,
 *   so the caller never builds the same program twice).
 */
export function runtimeOwnObjectsOf({ source, t }) {
  const gate = paneObjectsGate(t)
  const hostDraws = gate.draw && !!(t && t.objects && (t.objects.ops || []).length)
  let valueProbe = null
  let refusedForDrawing = true
  if (hostDraws) {
    valueProbe = probeRuntimeProgram(source)
    refusedForDrawing = !valueProbe.ok && (valueProbe.refusal || {}).guard === VALUE_BUILD_DRAWING_GUARD
    const hostPartial = !!(gate.loss && gate.loss.verdict !== 'clean')
    if (!refusedForDrawing && !hostPartial) return { probe: null, why: null, valueProbe }
  }
  const probe = probeRuntimeProgram(source, { objectsInRun: true })
  const keepHost = { probe: null, why: null, ...(valueProbe ? { valueProbe } : {}) }
  if (!probe.ok) {
    // ⛔ A partial host picture whose value build stands keeps that picture: the
    // run that would replace it cannot be built, and a decline would take away a
    // drawing the member has today.
    if (!refusedForDrawing) return keepHost
    const r = probe.refusal || {}
    return {
      probe: null,
      guard: r.guard || 'runtime',
      why: `${r.guard || 'runtime'}${r.message ? ` — ${r.message}` : ''}`,
      ...(valueProbe ? { valueProbe } : {}),
    }
  }
  if (!(probe.objectOps > 0)) return keepHost
  return { probe }
}
