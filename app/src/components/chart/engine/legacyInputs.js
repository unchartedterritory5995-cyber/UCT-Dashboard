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

// ─── THE STORED INPUTS AS THE LIVE SERVER READS THEM (UCT RS 3-14) ──────────
//
// ⭐ A ROLLBACK EDGE. With the server row back on v3 (`RS_V3_ENABLED` off), an
// instance stored `view: 'rotation'` under v4 still carries it, but the server
// does not declare `view` and drops it (`registry_defs.resolve_inputs`): it
// draws the RS line. A guide gated on that value (`rotationCentre`, the 100
// line) must not draw over an RS line it does not belong to. So a reader that
// knows what the live row declares reads a stored value the row would DROP as
// not stored — a `requiresServer` input the row does not declare, or a
// `requiresServer` enum option it does not list — and then applies the legacy
// map, exactly as the server does (`showMansfield: true` still reads as the
// Mansfield view a v3 server draws).
//
// `declared === undefined` means "the caller does not know": `inputsAsRead`,
// unchanged. `null` is "nothing declared" (fail closed), as everywhere else.

const GATED = new WeakMap()

function optionGated(option) {
  if (Array.isArray(option)) return !!option[2] && typeof option[2] === 'object' && option[2].requiresServer === true
  return !!option && typeof option === 'object' && option.requiresServer === true
}
function optionValue(option) {
  if (Array.isArray(option)) return option[0]
  if (option && typeof option === 'object' && 'value' in option) return option.value
  return option
}

/** Does this definition mark any input or enum option `requiresServer`? (memoised) */
export function hasServerGate(def) {
  if (!def || typeof def !== 'object') return false
  let g = GATED.get(def)
  if (g !== undefined) return g
  g = (Array.isArray(def.inputs) ? def.inputs : []).some((i) => i && (i.requiresServer === true
    || (Array.isArray(i.options) && i.options.some(optionGated))))
  GATED.set(def, g)
  return g
}

function servedOff(input, value, declared) {
  const inputs = declared && Array.isArray(declared.inputs) ? declared.inputs : []
  if (input.requiresServer === true && !inputs.includes(input.key)) return true
  if (!Array.isArray(input.options)) return false
  const option = input.options.find((o) => optionValue(o) === value)
  if (option === undefined || !optionGated(option)) return false
  const opts = declared && declared.options && typeof declared.options === 'object' ? declared.options[input.key] : null
  return !(Array.isArray(opts) && opts.includes(value))
}

/**
 * An instance's STORED inputs as the live server row reads them: each stored
 * value the row would drop left out, then `inputsAsRead`.
 *
 * @param {object|null} def the definition
 * @param {object|null|undefined} stored the instance's stored inputs
 * @param {object|null|undefined} declared `serverCompute.serverDeclares(def.id)`;
 *   `undefined` = not known here (plain `inputsAsRead`)
 */
export function inputsAsServed(def, stored, declared) {
  if (declared === undefined || !hasServerGate(def)) return inputsAsRead(def, stored)
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return stored
  let out = null
  for (const input of def.inputs) {
    if (!input || typeof input.key !== 'string' || !hasOwn(stored, input.key)) continue
    if (!servedOff(input, stored[input.key], declared)) continue
    if (!out) out = { ...stored }
    delete out[input.key]
  }
  return inputsAsRead(def, out || stored)
}
