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
import { runtimeRepaintOf } from '../../engine/runtime/runtimeRepaint'
import { runtimeKillOf, runtimeNotGradedOf } from '../../engine/runtimeKill'

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

// ─── ⭐⭐ RT9 — A HOST-ATTACHED SCRIPT WHOSE DRAWINGS THE HOST LANE LOST ──────────
//
// A script whose PLOTS translate attaches on the host lane and never reaches the
// runtime lane — so when the host object program loses drawings (atr-support-and-
// resistance: four extend/break loops over a float array, `guard:loop` →
// every zone lost), the member got the plots and none of the zones, while the
// runtime lane builds the same script with all of them (RT5's direct run agrees
// with TradingView on RDDT).
//
// ⛔ THE PLOTS STAY THE HOST'S, every one, never swapped. The document carries the
// script beside its trees (`objectsRun`, `runtime/runtimeObjects.js`) and its
// drawings come from ONE run of it on the chart's bars WHEN that run computes —
// otherwise from the host program exactly as before (`nativeRegistry.objectsRunFor`).
// Offered only when the host's drawing picture is KNOWN incomplete (`hostDrawingLoss`)
// and only under the runtime document's own gates: the per-member stage (the caller
// asks `runtimePaneEnabled`), the kill list, the starter allowlist, a statable
// repaint class, a build WITH its drawings, no request of other bars, no unsettled
// `na` condition.

/** Why the host lane's drawing picture of this script is incomplete, or null.
 *  ⭐ Each is a loss the host translation DECLARED: the whole program withheld for
 *  a lost removal (`paneObjectsGate`), a program that kept none of the steps it
 *  attempted, or a create call it could not carry (`objectDiagnostics.lostCreates`). */
export function hostDrawingLoss(t) {
  const d = (t && t.objectDiagnostics) || {}
  if (!(Number.isInteger(d.attemptedOps) && d.attemptedOps > 0)) return null
  const gate = paneObjectsGate(t)
  if (!gate.draw) return 'withheld'
  if (!((t.objects && t.objects.ops) || []).length) return 'empty'
  if (Array.isArray(d.lostCreates) && d.lostCreates.length) return 'lost-creates'
  return null
}

/**
 * ⭐⭐ RT9 — may this host document carry its script for a run to draw its objects?
 *
 * @returns {null | {ok: false, code: string, why: string} | {ok: true, loss: string, repaint: object}}
 *   null when the host lane's drawing picture is not known incomplete
 */
export function hybridObjectsOf({ source, t }) {
  const loss = hostDrawingLoss(t)
  if (!loss) return null
  const no = (code, why) => ({ ok: false, code, why })
  const killed = runtimeKillOf({ source })
  if (killed) return no('runtime:killed', killed)
  const ungraded = runtimeNotGradedOf({ source })
  if (ungraded) return no('runtime:not-yet-graded', ungraded)
  const repaint = runtimeRepaintOf(source)
  if (!repaint.ok) return no('runtime:repaint-unstated', repaint.why)
  const probe = probeRuntimeProgram(source, { objectsInRun: true })
  if (!probe.ok) {
    const r = probe.refusal || {}
    return no(r.guard || 'runtime', `${r.guard || 'runtime'}${r.message ? ` — ${r.message}` : ''}`)
  }
  if (!(probe.objectOps > 0)) return no('runtime:nothing-drawn', 'the run lowers no drawing call')
  if (probe.requests > 0) return no('runtime:request', 'a `request.security` reads bars this run is not handed')
  if (probe.naTests > 0) return no('runtime:na-test', 'a condition can read `na` in a way not matched to TradingView for this version')
  return { ok: true, loss, repaint }
}
