// app/src/components/chart/engine/legacyInputs.js
//
// ─── A LEGACY INPUT, READ AS ITS SUCCESSOR (UCT RS Phase 3, unit 3-08b) ─────
//
// `legacy: true` (defSchema, unit 3-01) keeps a retired input DECLARED so a
// stored instance carrying it still validates, and no surface renders it. When
// a newer input took over its meaning, the retired one may also say so:
//
//   { key: 'showMansfield', type: 'bool', default: false, legacy: true,
//     mapsTo: { when: true, key: 'view', value: 'mansfield' } }
//
// reads "an instance that STORED `showMansfield: true` and stored NO `view` is
// read as `view: 'mansfield'`".
//
// ⭐ ONE RULE: the successor is genuinely absent from the stored instance, or
// nothing happens. A stored successor always wins, whatever it says, so a
// member who picked the RS line by hand on a Trend instance gets the RS line.
// An instance that never stored the legacy key is untouched too: its default
// is not a choice anybody made.
//
// ⛔ READ-TIME ONLY. `inputsAsRead` never writes: it hands back the SAME object
// when nothing maps, and a fresh shallow copy when something does. Member data
// is never migrated in place; the stored instance is byte-identical after any
// number of renders, and a later writer stores only the key the member edits.
//
// ⭐ WHO CALLS IT: every reader that turns an instance's STORED inputs into the
// values it acts on (stored value, else the declared default) calls this on the
// stored object first: `nativeRegistry.resolveInputs` (the compute and its
// fetch key), `readout.resolvedInputsOf` (detectPreset, the readout's scalars
// key, the sibling disambiguators), `readoutSchema`'s input reader (readout
// `when` / `muted` / `chipWhen` gates, the pane label's `legendFallback`),
// `pool.plotActiveFor` (a plot's `activeWhen`), and `indicatorRegistry`'s
// `fieldsForInstance` / `drawnValues` (the settings form, Chart Data, their
// preset pickers). It is idempotent: a second pass finds the successor present.
//
// The shape is validated fail-closed by `defSchema.validateLegacyMaps`, so this
// reader trusts it and stays a no-import leaf (pool, readout and readoutSchema
// all sit under it without a cycle).

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** Per definition: the `[legacyKey, mapsTo]` pairs it declares (usually none). */
const MAPS = new WeakMap()

function mapsOf(def) {
  if (!def || typeof def !== 'object') return []
  let maps = MAPS.get(def)
  if (maps) return maps
  maps = []
  for (const input of Array.isArray(def.inputs) ? def.inputs : []) {
    const m = input && input.legacy === true ? input.mapsTo : null
    if (m && typeof m === 'object' && typeof input.key === 'string' && typeof m.key === 'string') {
      maps.push([input.key, m])
    }
  }
  MAPS.set(def, maps)
  return maps
}

/**
 * An instance's STORED inputs as the readers read them: each declared legacy
 * `mapsTo` applied where the legacy key is stored with the `when` value and the
 * successor is not stored (absent or `undefined`, the readers' own "not set").
 *
 * @param {object|null} def the definition
 * @param {object|null|undefined} stored the instance's stored inputs
 * @returns {object|null|undefined} `stored` itself when nothing maps, else a
 *   shallow copy carrying the successor value
 */
export function inputsAsRead(def, stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return stored
  const maps = mapsOf(def)
  if (!maps.length) return stored
  let out = null
  for (const [legacyKey, m] of maps) {
    if (!hasOwn(stored, legacyKey) || stored[legacyKey] !== m.when) continue
    if (hasOwn(stored, m.key) && stored[m.key] !== undefined) continue
    if (!out) out = { ...stored }
    out[m.key] = m.value
  }
  return out || stored
}
