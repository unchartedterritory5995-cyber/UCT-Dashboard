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

// ─── ⭐⭐ RT9 — A HOST DOCUMENT WHOSE DRAWINGS COME FROM A RUN (one document, two sources) ──
//
// The member door attaches a script on the HOST lane whenever its plots translate,
// and the runtime lane never sees it — so a script whose plots translate and whose
// drawing program the host lane withholds (atr-support-and-resistance: four
// extend/break loops over a float array, every zone lost) drew its plots and NO
// drawing, while the runtime lane builds the same script with every drawing (RT5).
//
// Such a document keeps its HOST compute (`compute.kind: 'ast'`, every plot the
// host's own tree — never swapped) and carries the script beside it:
//
//   objectsRun: { kind: 'runtime', source: <the Pine>, repaint: <class>,
//                 trees: <the host compute's identity at mint>, inputs: [<script input keys>] }
//
// Its drawings come from ONE run of that source with its own drawings
// (`objectsRunDefinition`, computed through the registry exactly as a drawing-only
// runtime document is, `runtimeColumns.js`), so RT4's ruling holds by construction:
// no run, no drawing. The host object program (`def.objects`, when the host kept
// one) stays on the document and is what a chart draws wherever that run does not
// (off the listing, a moved setting, the lane off for this member, a withheld run):
// exactly the pre-RT9 picture. ⛔ ONE source of drawings per PAINT, never the host's
// beside the run's (`nativeRegistry.objectsRunFor` decides; the binder obeys).

/** The plot key a hybrid run's refusal is filed under (it maps no plot). */
export const OBJECTS_RUN_KEY = '__objectsRun'

/** The guard a hybrid document's drawings carry when they are not drawn here. */
export const OBJECTS_RUN_GUARD = 'runtime:objects-run'

/** `def.objectsRun` when this is a host document whose drawings come from a run. */
export function objectsRunOf(def) {
  const r = def && def.compute && def.compute.kind === 'ast' ? def.objectsRun : null
  return r && typeof r === 'object' && r.kind === 'runtime' && typeof r.source === 'string' && r.source
    ? r : null
}

/** ⭐⭐ RT9 (Q1 ruling) — the script inputs a run HONOURS when a member moves them:
 *  a key the source binds as `key = input.int(…)` or `key = input.float(…)` — the
 *  numeric inputs the runtime lane reads by bound name (`Resolver.inputValues`,
 *  `memberNumber`, the author's own bounds refused by name). ⛔ Nothing else: a
 *  colour input is folded at its default in the run, a bool rides the host as a
 *  0/1 number the run does not read, and a generic `input(…)` is not named here —
 *  a move of any of those still withholds the drawings by name. Graded: the
 *  hybrid rail moves atr-support-and-resistance's `mult` and the run's boxes equal
 *  a hand replay of the script at that value (`atrSrReplay.js`, itself equal to
 *  TradingView's RDDT capture at the default). */
const _honoured = new WeakMap()
export function honouredInputsOf(run) {
  if (!run || typeof run !== 'object') return new Set()
  const hit = _honoured.get(run)
  if (hit) return hit
  const out = new Set()
  for (const k of Array.isArray(run.inputs) ? run.inputs : []) {
    if (typeof k !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue
    const re = new RegExp(String.raw`^[ \t]*(?:var[ \t]+)?(?:(?:int|float)[ \t]+)?` + k + String.raw`[ \t]*=[ \t]*input\.(?:int|float)[ \t]*\(`, 'm')
    if (re.test(String(run.source || ''))) out.add(k)
  }
  _honoured.set(run, out)
  return out
}

/** The member's moved values the run honours: `{key: number}` for every honoured
 *  key whose instance value differs from its declared default, else `{}`. */
function movedHonoured(def, run, inputs) {
  const honoured = honouredInputsOf(run)
  const out = {}
  for (const spec of def.inputs || []) {
    if (!spec || !honoured.has(spec.key) || !inputs) continue
    if (!Object.prototype.hasOwnProperty.call(inputs, spec.key)) continue
    const v = inputs[spec.key]
    if (JSON.stringify(v) === JSON.stringify(spec.default)) continue
    out[spec.key] = v
  }
  return out
}

const _runDefs = new WeakMap()
/** The drawing-only runtime document ONE run of the hybrid's source is: no plot, its
 *  objects its own (`compute.objects`), from the listing (R-W, as every fallback
 *  document), keyed by the source's hash and the honoured inputs it is given, so a
 *  re-saved source or a moved setting is a new run. */
export function objectsRunDefinition(def, inputs) {
  const run = objectsRunOf(def)
  if (!run) return null
  const given = movedHonoured(def, run, inputs)
  const sig = JSON.stringify(Object.keys(given).sort().map((k) => [k, given[k]]))
  let perDef = _runDefs.get(def)
  if (!perDef) { perDef = new Map(); _runDefs.set(def, perDef) }
  const hit = perDef.get(sig)
  if (hit) return hit
  const hash = (def.meta && typeof def.meta.runtimeSourceHash === 'string' && def.meta.runtimeSourceHash) || 'unhashed'
  const made = {
    id: `${def.id}#objects`,
    version: def.version,
    compute: {
      kind: 'runtime', fn: `runtime:objects:${hash}:${sig}`, rev: 1, source: run.source, outputs: {}, objects: true,
      ...(Object.keys(given).length ? { inputs: given } : {}),
    },
    meta: { runtimeHistory: 'listing', objectsRunFor: def.id, runtimeSourceHash: hash },
  }
  perDef.set(sig, made)
  return made
}

/**
 * Why a hybrid document's run may NOT draw on this instance, or null.
 *
 * ⛔ A host document is edited two ways — an instance input, and a parameter edit
 * that rewrites a tree (`applyParamEdit`). A parameter edit always withholds (the
 * run was minted beside the trees it no longer matches). An instance input the run
 * honours (`honouredInputsOf`) is handed to the run; any other moved script input
 * withholds, so plots at one setting never sit beside drawings at another.
 */
export function objectsRunWithheldOn(def, inputs) {
  const run = objectsRunOf(def)
  if (!run) return null
  if (def.meta && typeof def.meta.objectsRunWithheld === 'string') {
    return { guard: OBJECTS_RUN_GUARD, message: def.meta.objectsRunWithheld }
  }
  const trees = (def.compute && (def.compute.treesHash || def.compute.fn)) || null
  if (run.trees !== trees) {
    return { guard: 'runtime:objects-settings', message: "a setting of this script was changed from its default in a way its drawings' run cannot follow, so they are not drawn beside plots at another setting" }
  }
  // Only the SCRIPT's own inputs (`run.inputs`, named at mint); a plot's style knob
  // (its colour, its width) moves no value the run computes.
  const scriptKeys = new Set(Array.isArray(run.inputs) ? run.inputs : [])
  const honoured = honouredInputsOf(run)
  const declared = new Map((def.inputs || []).filter((i) => i && scriptKeys.has(i.key)).map((i) => [i.key, i.default]))
  for (const [k, v] of Object.entries(inputs || {})) {
    if (!declared.has(k) || honoured.has(k)) continue
    if (JSON.stringify(v) !== JSON.stringify(declared.get(k))) {
      return { guard: 'runtime:objects-settings', message: `the setting \`${k}\` was changed from its default, and this script's drawings are made by a run that cannot take that setting, so they are not drawn beside plots at another setting` }
    }
  }
  return null
}
