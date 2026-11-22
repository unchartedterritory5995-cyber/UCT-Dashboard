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
// ⭐⭐ PARITY UNIT 1 (`objects`, 2026-11-18) — a host document that DRAWS an object program of its own
// no longer needs this hook for the drawings its program lost: those are the run's to draw on the run
// half's own gates (`runHalfObjectRail.js`, the lost-drawings rule). This hook still decides a host with
// NO object program (a lost removal, every drawing lost), and a run drawing that names no call.
export const RUN_HALF_EVIDENCE_MIN_CAPTURES = 2
let _evidence = new Map()

/** Replace the evidence list: `[{sha256, admission?, substituted?, captures: [{capture, verdict,
 *  objectsV2, runtimeOn, substituted?}]}]` (the `run_half_evidence` key of the kill read). */
export function setRunHalfObjectEvidence(list) {
  const next = new Map()
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(e.sha256)) continue
    next.set(e.sha256.toLowerCase(), {
      ...(Object.prototype.hasOwnProperty.call(e, 'admission')
        ? { admission: e.admission, substituted: e.substituted } : {}),
      captures: Array.isArray(e.captures) ? e.captures.slice() : [],
    })
  }
  _evidence = next
}

// ⭐⭐ RS RATING L9 — THE L7 SUBSTITUTED PATH, NEVER A LOOSER RULE. A stock capture of a script
// reading `syminfo.industry` can at best grade MATCH_SUBSTITUTED (the industry is UCT data), so a
// record on the substituted path (`admission: 'substituted'`, `substituted: [names]`) counts
// MATCH_SUBSTITUTED captures whose OWN names are exactly the record's; a record without
// `admission` still counts MATCH only. Mirrors `runtime_definitions.py::run_half_entry_admits`
// (the server serves only what it admits); both answer every case of
// tests/fixtures/ast/run_half_evidence_parity.json, so the two cannot drift.
const ADMISSION_SUBSTITUTED = 'substituted'

/** A non-empty list of distinct non-empty names, sorted; null otherwise (`rollout_gate.py::
 *  _pine_substituted_names`). */
function substitutedNames(v) {
  if (!Array.isArray(v) || !v.length || !v.every((n) => typeof n === 'string' && n)) return null
  if (new Set(v).size !== v.length) return null
  return v.slice().sort().join('\u0000')
}

/** The rule over ONE served entry (`{admission?, substituted?, captures}`). */
export function runHalfEntryAdmits(entry) {
  if (!entry || typeof entry !== 'object') return false
  let want
  let names = null
  if (entry.admission === undefined || entry.admission === null) {
    want = 'MATCH'
  } else if (entry.admission === ADMISSION_SUBSTITUTED) {
    want = 'MATCH_SUBSTITUTED'
    names = substitutedNames(entry.substituted)
    if (names === null) return false
  } else {
    return false
  }
  const seen = new Set()
  for (const c of Array.isArray(entry.captures) ? entry.captures : []) {
    // ⭐ SETTINGS PARITY (2c) — a capture taken at moved settings (`inputs`) is evidence for THOSE
    // settings (`runHalfSettingsEntryAdmits`), never for the author's defaults
    if (capturedAtSettings(c)) continue
    if (captureCounts(c, want, names)) seen.add(c.capture)
  }
  return seen.size >= RUN_HALF_EVIDENCE_MIN_CAPTURES
}

/** The record's path: `{want, names}`, or null when nothing on it can count. */
function entryPath(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (entry.admission === undefined || entry.admission === null) return { want: 'MATCH', names: null }
  if (entry.admission !== ADMISSION_SUBSTITUTED) return null
  const names = substitutedNames(entry.substituted)
  return names === null ? null : { want: 'MATCH_SUBSTITUTED', names }
}

/** One capture counts on the record's path (the rule `runHalfEntryAdmits` states). */
function captureCounts(c, want, names) {
  if (!c || typeof c.capture !== 'string' || !c.capture) return false
  if (c.verdict !== want || c.runtimeOn !== true) return false
  if (names !== null && substitutedNames(c.substituted) !== names) return false
  // objects-v2 MATCH; or, ON THE SUBSTITUTED PATH ONLY, objects-v2 MATCH_SUBSTITUTED naming exactly
  // the record's inputs (`objectsV2Substituted`; coordinator ruling 2026-11-15, after owner ruling (a))
  return c.objectsV2 === true || (names !== null && substitutedNames(c.objectsV2Substituted) === names)
}

/** A capture taken with at least one setting moved off the author's default (`inputs`: Pine name -> value). */
function capturedAtSettings(c) {
  return !!(c && c.inputs && typeof c.inputs === 'object' && !Array.isArray(c.inputs) && Object.keys(c.inputs).length)
}

/**
 * ⭐⭐ SETTINGS PARITY (2c) — THE RULE FOR A RUN HALF AT A MEMBER'S SETTINGS. The run rebuilds
 * the script with the member's value as the literal the author would have typed, so the
 * question per setting is whether a run with THAT setting moved has been graded against
 * TradingView. A moved setting (a Pine name) is admitted when at least
 * `RUN_HALF_EVIDENCE_MIN_CAPTURES` distinct captures that count on the record's path
 * (`captureCounts`) were taken with that setting moved (`inputs` names it). Every moved setting
 * must be admitted; the answer names the ones that are not. Mirrors
 * `runtime_definitions.py::run_half_settings_admits`; both answer every `settings` case of
 * tests/fixtures/ast/run_half_evidence_parity.json.
 * @returns {{ok: boolean, missing: string[]}}
 */
export function runHalfSettingsEntryAdmits(entry, moved) {
  const keys = Array.isArray(moved) ? [...new Set(moved.filter((k) => typeof k === 'string' && k))].sort() : []
  if (!keys.length) return { ok: true, missing: [] }
  const path = entryPath(entry)
  if (!path) return { ok: false, missing: keys }
  const byKey = new Map(keys.map((k) => [k, new Set()]))
  for (const c of Array.isArray(entry.captures) ? entry.captures : []) {
    if (!capturedAtSettings(c) || !captureCounts(c, path.want, path.names)) continue
    for (const k of Object.keys(c.inputs)) if (byKey.has(k)) byKey.get(k).add(c.capture)
  }
  const missing = keys.filter((k) => byKey.get(k).size < RUN_HALF_EVIDENCE_MIN_CAPTURES)
  return { ok: missing.length === 0, missing }
}

/** Is this script's run half admitted at these moved settings (Pine names)? */
export function runHalfSettingsAdmitted(sha256, moved) {
  if (_admitEveryForGrade) return { ok: true, missing: [] }
  const entry = typeof sha256 === 'string' ? _evidence.get(sha256.toLowerCase()) : null
  const keys = Array.isArray(moved) ? moved : []
  if (!entry) return { ok: keys.length === 0, missing: [...new Set(keys)].sort() }
  return runHalfSettingsEntryAdmits(entry, keys)
}

/** Is this script (by source sha256) admitted without a comparable object? Only on
 *  `RUN_HALF_EVIDENCE_MIN_CAPTURES` or more DISTINCT captures, each an objects-v2 MATCH of the
 *  run's drawings with the runtime pane on, graded on the record's own path
 *  (`runHalfEntryAdmits`). */
export function runHalfEvidenceAdmits(sha256) {
  if (_admitEveryForGrade) return true
  const entry = typeof sha256 === 'string' ? _evidence.get(sha256.toLowerCase()) : null
  return entry ? runHalfEntryAdmits(entry) : false
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
