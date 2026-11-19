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

/** The families a host object program creates (loop bodies included). */
function programFamilies(program) {
  const out = new Set()
  const walk = (ops) => {
    for (const op of ops || []) {
      if (!op) continue
      if (op.k === 'create' && typeof op.family === 'string') out.add(op.family)
      if (Array.isArray(op.body)) walk(op.body)
    }
  }
  walk(program && program.ops)
  return out
}

/** The input keys a document's own rows read as Style knobs (a plot's colour and width), deep: a stored
 *  document spells each `"$key"`, and an installed one has substituted it and records it under `$refs`
 *  (`defSchema.js::noteRef`, `{field: key}`, a `levels` ref an array). */
function styleKeysOf(def) {
  const out = new Set()
  const addRef = (r) => {
    if (typeof r === 'string') out.add(r)
    else if (Array.isArray(r)) r.forEach(addRef)
  }
  const walk = (v) => {
    if (typeof v === 'string') { if (v.length > 1 && v[0] === '$') out.add(v.slice(1)) } else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === '$refs' && x && typeof x === 'object') Object.values(x).forEach(addRef)
        else walk(x)
      }
    }
  }
  walk(def && def.plots)
  return out
}

/**
 * ⭐⭐ PARITY UNIT LF — HAS THE MEMBER MOVED ONE OF THE SCRIPT'S OWN SETTINGS OFF THE AUTHOR'S DEFAULT?
 * The script's settings are the document's inputs that no row reads as a Style knob (`styleKeysOf`): those
 * are what the run is rebuilt with, and what a host program translated at mint cannot follow. A key the
 * instance does not carry is at its default. Colours compare without case (`#B2B5BE` is `#b2b5be`).
 */
export function scriptSettingsMoved(def, inputs) {
  if (!inputs || typeof inputs !== 'object' || !def || !Array.isArray(def.inputs)) return false
  const style = styleKeysOf(def)
  for (const spec of def.inputs) {
    if (!spec || typeof spec.key !== 'string' || style.has(spec.key)) continue
    if (!Object.prototype.hasOwnProperty.call(inputs, spec.key)) continue
    const v = inputs[spec.key]
    const d = spec.default
    const same = typeof v === 'string' && typeof d === 'string' ? v.toLowerCase() === d.toLowerCase() : v === d
    if (!same) return true
  }
  return false
}

/**
 * ⭐⭐ PARITY UNIT LF (2026-11-18) — DOES THIS INSTANCE DRAW THE RUN'S OBJECTS ON THESE COLUMNS?
 *
 * A runtime document whose host object program was CLEAN now draws the run's own drawings
 * (`runtimeObjectsDoor.js::runtimeOwnObjectsOf`, `hostFallback`), and carries that host program
 * beside them (`definition.objects`). ⛔ A CHANGE NEVER TAKES AWAY WHAT A MEMBER SEES: the run's
 * store holds back by name a family whose answer no capture settles (`objectStore.js`), and the host
 * program drew that family. So whenever the run withholds its drawings whole, or holds back a family
 * the host program draws, THIS chart draws the host program instead, exactly as before the change.
 * A run still in flight (no record yet) is the run's branch: the layer stays empty until it lands
 * (never the host picture first and a swap after). A document with no host program beside the run
 * (every other run-owned document) is unchanged: the run's objects, whatever it holds back.
 * The binder and the vendor harness both ask THIS, so the graded picture is the drawn one.
 *
 * ⛔ THE HOST PROGRAM IS THE AUTHOR'S-SETTINGS PICTURE. It was translated once, at mint, with every input
 * at its default, so it follows none of the member's settings (measured: inside-bar-range with
 * `lineColor` set draws the run's lines in that colour and the host program's in the author's
 * #b2b5be). So once the member has moved one of the SCRIPT's own settings (`scriptSettingsMoved`,
 * given the instance's `inputs`), the host program is never drawn: the run's picture is, exactly as
 * for a run-owned document with no program beside it (a family it holds back stays held back by name,
 * a run withheld whole draws nothing and says why). A stand-in drawn at settings the member did not
 * choose would be a wrong drawing.
 */
export function drawsRunObjectsOn(def, cols, inputs = null) {
  if (!drawsRuntimeObjects(def)) return false
  const program = def && def.objects
  if (!program || !Array.isArray(program.ops) || !program.ops.length) return true
  if (scriptSettingsMoved(def, inputs)) return true
  if (!cols || typeof cols !== 'object') return true
  const p = cols[RUNTIME_OBJECTS_KEY]
  if (!p || typeof p !== 'object') return true
  if (p.status === 'WITHHELD') return p.pending === true
  const fams = programFamilies(program)
  // (the run half's own reading of a family held back: any key of `withheld`, `nativeRegistry.js::withRunHalf`)
  return !Object.keys(p.withheld || {}).some((fam) => fams.has(fam))
}

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
