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
// ⭐⭐ PARITY UNIT LF (2026-11-18) — AND A CLEAN host program is replaced too, but never TAKEN AWAY:
// the run's drawings are the document's, the clean program rides beside them (`hostFallback`), and it is
// drawn instead whenever the run holds back a family it draws (`runtimeObjects.js::drawsRunObjectsOn`).
// ⚰️ This said "a CLEAN host program is never replaced: it already draws everything the script draws";
// it did, but then the run's drawings were never graded on such a script, and capability admission
// (`obj:linefill`) needs graded RUN-drawn captures.
import { paneObjectsGate } from '../../engine/ast/paneGate'
import { probeRuntimeProgram } from '../../engine/runtime/runtimeColumns'

/** The value build's refusal that only the drawing build can answer. */
export const VALUE_BUILD_DRAWING_GUARD = 'runtime:object-op'
/** ⭐ W3W4-D2 — the value build's OTHER refusal that only the drawing build can answer.
 *  The value build hands every drawing to the host object program (`objectTrees: []`) and
 *  lowers none of it, so a script that only draws has nothing to plot THERE and refuses
 *  `runtime:no-output` — whatever the drawing build says. That word is the value build's,
 *  not the script's: the drawing build (`objectsInRun`) is the one that holds the drawings,
 *  and its refusal (or its lowered count) is the answer. One predicate for the door and
 *  the census, so the two cannot drift. */
export const VALUE_BUILD_NOTHING_GUARD = 'runtime:no-output'
export const valueBuildDefersToDrawing = (guard) => guard === VALUE_BUILD_DRAWING_GUARD || guard === VALUE_BUILD_NOTHING_GUARD

/** ⭐ DRAW-1 — did the host object program lose a CREATE (a `create` drop key of any family, or a
 *  create dropped for its guard or for a strategy value), by the object pass's own counters? */
export function hostLostCreates(t) {
  const reasons = (t && t.objectDiagnostics && t.objectDiagnostics.dropReasons) || {}
  // (a drop KEY, `<kind>:<op>`, never a guard code: split rather than spelled whole)
  return Object.keys(reasons).some((k) => {
    if (!(reasons[k] > 0)) return false
    const [kind, op] = k.split(':')
    return kind === 'create' || ((kind === 'guard' || kind === 'strategy') && op === 'create')
  })
}

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
  let windowed = false
  let replaced = null
  if (hostDraws) {
    valueProbe = probeRuntimeProgram(source)
    refusedForDrawing = !valueProbe.ok && valueBuildDefersToDrawing((valueProbe.refusal || {}).guard)
    const hostPartial = !!(gate.loss && gate.loss.verdict !== 'clean')
    // ⭐ WS-E review M1 — `calc_bars_count`: the run takes the chart's last N bars and
    // nothing on the host side does, so a host program would draw over the WHOLE chart
    // beside plots drawn over the window. The run's own drawings (the same window) are
    // asked for, and a host program is never carried for such a document.
    // ⭐⭐ CBC-FMT — the declaration's own count, as the translation read it (`pine.js::
    // declarationCalcBars`); a `request.security(calc_bars_count = …)` argument is not one.
    windowed = Number.isInteger(t && t.calcBarsCount)
    if (!refusedForDrawing && !hostPartial && !windowed) {
      // ⭐⭐ PARITY UNIT LF (2026-11-18, coordinator ruling) — A CLEAN HOST PROGRAM NO LONGER DRAWS A
      // RUNTIME DOCUMENT'S OBJECTS ON ITS OWN. The run executes every drawing call the script makes, in
      // source order, on every bar (TradingView's model: `line.new`, "Creates new line object."), so
      // when it builds WITH its drawings and lowers at least one, its drawings are the document's
      // (`compute.objects: true`), and its graded captures are evidence of the RUN's drawings. The host
      // program rides beside them (`hostFallback`): the binder and the harness draw it instead
      // whenever the run holds back a family it draws (`runtimeObjects.js::drawsRunObjectsOn`), so no
      // member loses a drawing the host program showed. Otherwise the host program keeps drawing,
      // exactly as before.
      // ⛔ NOT A STRATEGY: its trade markers are merged into the HOST program's picture on the host path
      // (W9-T12, `w9T12MarkersDoor.test.js`), and strategy serving is owner-gated (U-STRAT), so a
      // strategy's clean host program keeps drawing its objects, exactly as before.
      if (t && t.declaration === 'strategy') return { probe: null, why: null, valueProbe }
      const runOwn = probeRuntimeProgram(source, { objectsInRun: true })
      if (runOwn && runOwn.ok && runOwn.objectOps > 0) return { probe: runOwn, hostFallback: true, valueProbe }
      return { probe: null, why: null, valueProbe }
    }
    if (hostPartial && gate.loss) replaced = { dropped: gate.loss.dropped, attempted: gate.loss.attempted }
  }
  const probe = probeRuntimeProgram(source, { objectsInRun: true })
  // `hostWithheld`: the caller must not carry the host program (a windowed document)
  const keepHost = { probe: null, why: null, ...(valueProbe ? { valueProbe } : {}), ...(windowed ? { hostWithheld: true } : {}) }
  if (!probe.ok) {
    const r = probe.refusal || {}
    // ⛔ A partial host picture whose value build stands keeps that picture: the
    // run that would replace it cannot be built, and a decline would take away a
    // drawing the member has today.
    // ⛔⛔ DRAW-1 (2026-11-16) — UNLESS THAT PICTURE LOST A CREATE. This door is the
    // fallback for a script the HOST lane refused, so the member had no picture from it
    // today; a host program that lost a `*.new` (and still carries the deletes and moves
    // written around it) draws a different SET of objects, not a smaller one. Measured:
    // trend-levels-chartprime (12 creates lost to `pine:window`) graded runtime-on
    // DIVERGE on both committed captures once its `label(na)` casts let it reach here.
    // Declined with the drawing build's own refusal, by name.
    if (!refusedForDrawing && hostLostCreates(t)) {
      return {
        probe: null,
        guard: r.guard || 'runtime',
        why: `${r.guard || 'runtime'}${r.message ? ` — ${r.message}` : ''}; the host lane's drawing of this `
          + 'script lost some of the drawings it makes, so it is not drawn in their place',
        declineHostPartial: true,
        ...(valueProbe ? { valueProbe } : {}),
      }
    }
    if (!refusedForDrawing) return keepHost
    return {
      probe: null,
      guard: r.guard || 'runtime',
      why: `${r.guard || 'runtime'}${r.message ? ` — ${r.message}` : ''}`,
      ...(valueProbe ? { valueProbe } : {}),
    }
  }
  if (!(probe.objectOps > 0)) return keepHost
  return { probe, ...(replaced ? { replacedPartialHost: replaced } : {}) }
}
