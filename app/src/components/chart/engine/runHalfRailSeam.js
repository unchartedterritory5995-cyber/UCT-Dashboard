// app/src/components/chart/engine/runHalfRailSeam.js
//
// ─── ⭐⭐ ENGINE 54 — THE RUN HALF'S OBJECT RAIL, REGISTERED, A LEAF ─────────────────────
//
// The object rail (`runHalfObjectRail.js`) evaluates the HOST object program to compare it
// with the run's drawings, so it needs the object reader (`objectColumns.js`), the object
// evaluator (`objectRuntime.js`) and the render state (`objectRenderState.js`). The bind that
// asks it lives in `nativeRegistry.js`, which `objectColumns.js` imports: an import the other
// way would be a cycle through the whole chart door. So, as `objectRuntimeSeam.js` does for the
// runtime lane's values, the slot lives here, in a module that imports nothing: the rail module
// writes it on import (`binder.js` imports it, so every chart has it) and the bind reads it.
//
// ⛔ AN UNREGISTERED RAIL IS A REFUSAL, NEVER A PASS: `withRunHalf` refuses
// `run-half:rail-not-loaded` and the host picture stays.
let _rail = null

/** Register the object rail: `(args) => {ok: true, compared} | {ok: false, code}`. */
export function registerRunHalfObjectRail(fn) {
  _rail = typeof fn === 'function' ? fn : null
}

/** The registered object rail, or null. */
export function registeredRunHalfObjectRail() {
  return _rail
}

// ─── THE PART 2 HOOK: EVIDENCE FOR A RUN HALF WITH NOTHING COMPARABLE ─────────────────
//
// A run half whose host draws none of the run's drawings (the verdict `removes`, or a family
// the host withholds whole) has nothing the object rail can compare: `run-half:no-comparable-
// objects`. Capability admission (engine-53 plan, Part 2) may admit such a script on recorded
// evidence instead: the objects-v2 grade of the RUN's drawings against TradingView, MATCH, with
// the runtime pane on, on at least `RUN_HALF_EVIDENCE_MIN_CAPTURES` distinct captures. Nothing
// sets this list in production today (no caller outside the tests), so every such script is
// refused. ⛔ Evidence is per script (sha256 of the Pine source) and never per family.
export const RUN_HALF_EVIDENCE_MIN_CAPTURES = 2
let _evidence = new Map()

/** Replace the evidence list: `[{sha256, captures: [{capture, verdict, objectsV2, runtimeOn}]}]`. */
export function setRunHalfObjectEvidence(list) {
  const next = new Map()
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(e.sha256)) continue
    next.set(e.sha256.toLowerCase(), Array.isArray(e.captures) ? e.captures.slice() : [])
  }
  _evidence = next
}

/** Is this script (by source sha256) admitted without a comparable object? Only on
 *  `RUN_HALF_EVIDENCE_MIN_CAPTURES` or more DISTINCT captures, each an objects-v2 MATCH of the
 *  run's drawings with the runtime pane on. */
export function runHalfEvidenceAdmits(sha256) {
  if (_admitEveryForGrade) return true
  const caps = typeof sha256 === 'string' ? _evidence.get(sha256.toLowerCase()) : null
  if (!caps) return false
  const seen = new Set()
  for (const c of caps) {
    if (!c || typeof c.capture !== 'string' || !c.capture) continue
    if (c.verdict !== 'MATCH' || c.objectsV2 !== true || c.runtimeOn !== true) continue
    seen.add(c.capture)
  }
  return seen.size >= RUN_HALF_EVIDENCE_MIN_CAPTURES
}

// ⭐⭐ RS RATING L8 — THE RUNTIME-ON GRADE IS THE EVIDENCE, SO IT GRADES EVERY RUN HALF.
// The evidence above IS a runtime-on objects-v2 grade of the RUN's drawings. That lane already
// grades every script as an admitted member would see it (`__allowEveryRuntimeScriptForTests`,
// the starter allowlist not applied: an upper bound), because the allowlist is derived FROM its
// verdicts; the run-half evidence is derived from the same verdicts, so the lane admits every
// run half the same way, or the evidence could never be produced (a refused run half has its
// drawings never graded). ⛔ Rails and the vendor harness's runtime-on lane ONLY: never set by a
// member surface; production admits by `setRunHalfObjectEvidence` alone.
let _admitEveryForGrade = false
/** Rails / the runtime-on harness lane only. */
export function __admitEveryRunHalfForTests() { _admitEveryForGrade = true }
/** Rails only. */
export function __resetRunHalfAdmissionForTests() { _admitEveryForGrade = false }
