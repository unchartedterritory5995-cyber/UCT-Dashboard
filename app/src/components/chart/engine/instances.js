// app/src/components/chart/engine/instances.js
//
// ─── Indicator INSTANCES: the migrator, the validator, the normaliser ────────
//
// A DEFINITION says what an indicator is. An INSTANCE says "this chart has one
// of those, with these settings, here". The whole engine sits on that split:
// definitions are authored (in this repo now, by a builder later); instances are
// user data that lives in the `chart_settings` blob, gets read by the binder,
// pinned by alerts, and copied between layouts.
//
//   {
//     instanceId: 'legacy:rsi',    // stable handle — bindings, alerts, layouts key off it
//     defId:      'rsi',           // which definition
//     defVersion: 1,               // which version of it this was authored against
//     inputs:     { period: 7 },   // ONLY what the user actually set (see below)
//     placement:  { target: 'pane' },
//     hidden:     false,
//   }
//
// ⛔ THIS MODULE IS PURE AND WRITES NOTHING. It reads a settings blob and
// returns arrays. Nothing here persists, renders, or touches lightweight-charts
// — B2 lands DARK, and a migrator that quietly wrote to a user's blob would be
// the loudest possible violation of that.
//
// ─── WHY `overlays` IS NOT MIGRATED, AND MUST NOT BE ─────────────────────────
//
// The four (now five) moving-average overlays look like the most obvious
// migration candidates in the file and they are the one thing this migrator
// deliberately refuses to touch. `mergeChartSettings` merges `overlays`
// POSITIONALLY and pads to the defaults' length (`chartDefaults.js:79-83` and
// `:353-357`): slot 0 IS "the 9 EMA", slot 4 IS "the 5 SMA", and a stored blob
// written before slot 4 existed is three-quarters of an array that gets topped
// up on read. That INDEX is the identity — it is how every blob ever written
// refers to its own overlays, which is why the comment in `chartDefaults.js`
// says new slots are appended and never inserted.
//
// Giving an overlay an `instanceId` replaces that positional identity with a
// nominal one, and the moment both exist, one of them is a lie: a blob that has
// been migrated and then read by an un-migrated surface (a grid cell, the render
// route, an older tab) would have its overlays merged positionally against the
// engine's copy and drift. Migrating them is B3+, where the legacy render block
// is deleted in the same change and there is only one identity left standing.
//
// ─── AND WHY `volumeProfile` IS NOT MIGRATED EITHER ──────────────────────────
//
// `CHART_DEFAULTS.indicators` has 15 keys; the registry has 14 definitions.
// `volumeProfile` is a canvas overlay with no compute function and no plot style
// that can express it (see the nativeRegistry docstring). It is SKIPPED, not
// emitted-and-dropped: an instance naming a definition that doesn't exist would
// be a validation failure reported to a user who did nothing wrong. B3 keeps the
// legacy canvas path for it.

import {
  PLACEMENT_TARGETS,
  validateInputValue,
  formatValue as fmt,
} from './defSchema'
import {
  getDefinition as getNativeDefinition,
  listDefinitions as listNativeDefinitions,
} from './nativeRegistry'

/** Every migrated instance's id starts with this. It is a namespace, not
 *  decoration: B3 needs to tell "this came from the 15 legacy toggles" from
 *  "the user added this in the new UI", because only the former has a legacy
 *  render block that must be turned off in the same breath. */
export const LEGACY_ID_PREFIX = 'legacy:'

/**
 * The id a legacy indicator migrates to. DETERMINISTIC — a pure function of the
 * defId and nothing else (not the settings, not the clock, not a counter), which
 * is the entire reason re-running the migration is safe.
 */
export function legacyInstanceId(defId) {
  return `${LEGACY_ID_PREFIX}${defId}`
}

// ─── small local helpers ─────────────────────────────────────────────────────

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== ''
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function list(values) {
  return values.join(', ')
}

/**
 * Resolve the registry argument.
 *
 * Two accepted shapes and no more: a bare `(defId) => def|null` lookup, or an
 * object exposing `getDefinition` (which is the nativeRegistry module itself, so
 * `import * as registry` just works). Omitted ⇒ the natives.
 *
 * `listDefinitions` is optional and only affects ORDER — a lookup-only registry
 * makes the migrator fall back to the blob's own key order.
 */
function resolveRegistry(registry) {
  if (!registry) {
    return { get: getNativeDefinition, list: listNativeDefinitions }
  }
  if (typeof registry === 'function') {
    return { get: registry, list: () => [] }
  }
  if (isPlainObject(registry) && typeof registry.getDefinition === 'function') {
    return {
      get: (id) => registry.getDefinition(id),
      list: typeof registry.listDefinitions === 'function' ? () => registry.listDefinitions() : () => [],
    }
  }
  return { get: () => null, list: () => [] }
}

/** Copy an instance one level deep, preserving fields this module doesn't know
 *  about. Same forward-compatibility posture as `defSchema`'s document half: an
 *  instance written by a newer client round-trips through this one intact. */
function cloneInstance(inst) {
  if (!isPlainObject(inst)) return inst
  const out = { ...inst }
  if (isPlainObject(inst.inputs)) out.inputs = { ...inst.inputs }
  if (isPlainObject(inst.placement)) out.placement = { ...inst.placement }
  return out
}

// ─── the migrator ────────────────────────────────────────────────────────────

/**
 * Project the 15 legacy indicator toggles onto engine instances.
 *
 * PURE: reads `cs`, returns a new array, mutates nothing (the blob's own objects
 * are never handed back by reference).
 *
 * WHAT IT READS
 *   `cs.indicators`               the 15 keyed sections — `enabled` plus params
 *   `cs.indicatorInstances`       instances that already exist (passed through)
 *   `cs.volumeOverlayIndicators`  the "render this oscillator inside the volume
 *                                 pane" list, which is a PLACEMENT fact
 *
 * WHAT IT RETURNS
 *   The FULL instance list for the blob: every existing instance first, in its
 *   existing order, then one newly-migrated instance per enabled legacy
 *   indicator that doesn't already have one. That union is what makes
 *   `migrate({...cs, indicatorInstances: migrate(cs)})` a fixed point — the
 *   idempotency the whole scheme rests on — and it is also what stops a
 *   re-migration from resetting an instance the user has since edited.
 *
 * WHAT IT NEVER DOES
 *   It never REMOVES an instance, including one whose legacy toggle has since
 *   gone false. Pre-B3 the legacy toggle is still the thing that renders, so
 *   removal would be deciding a cutover question this task does not own; the
 *   engine is dark, so a stale instance draws nothing either way.
 *
 * INPUTS ARE A PROJECTION, NOT A SNAPSHOT
 *   Only keys that (a) the blob actually declares and (b) the definition
 *   declares as inputs are carried. `enabled` never is — an instance's
 *   EXISTENCE is what "enabled" meant. Two consequences, both deliberate:
 *     · a legacy field no definition declares (a removed setting, a typo, a
 *       half-shipped experiment) is dropped, which changes nothing because the
 *       shipped renderer ignores it too;
 *     · an input the blob doesn't mention is NOT pinned to today's default, it
 *       is simply absent, and the definition default supplies it at compute
 *       time. That matches what the legacy renderer does today (it reads
 *       `cs.indicators.rsi.period`, which `mergeChartSettings` filled in from
 *       `CHART_DEFAULTS`) — so "unset means current default" is preserved
 *       rather than frozen.
 *
 * ORDER is registry order, not `Object.keys` order, so two blobs with the same
 * indicators produce byte-identical output regardless of how they were
 * serialised.
 *
 * @param {object} cs        a chart_settings blob, raw or merged
 * @param {object|Function} [registry]
 * @returns {object[]} instances
 */
export function migrateLegacyToInstances(cs, registry) {
  const reg = resolveRegistry(registry)

  const existing = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  const out = existing.map(cloneInstance)
  const taken = new Set(
    out.filter(i => isPlainObject(i) && isNonEmptyString(i.instanceId)).map(i => i.instanceId),
  )

  const legacy = isPlainObject(cs?.indicators) ? cs.indicators : null
  if (!legacy) return out

  const volumeOverlay = new Set(
    Array.isArray(cs?.volumeOverlayIndicators) ? cs.volumeOverlayIndicators : [],
  )

  const registryOrder = reg.list().map(d => d && d.id).filter(isNonEmptyString)
  const defIds = registryOrder.length
    ? registryOrder.filter(id => hasOwn(legacy, id))
    : Object.keys(legacy)

  for (const defId of defIds) {
    const section = legacy[defId]
    if (!isPlainObject(section) || section.enabled !== true) continue

    const instanceId = legacyInstanceId(defId)
    if (taken.has(instanceId)) continue

    // No definition ⇒ not migratable (volumeProfile). Skipped, never emitted as
    // an instance that validation would then have to drop.
    const def = reg.get(defId)
    if (!def) continue

    const inputs = {}
    for (const declared of (Array.isArray(def.inputs) ? def.inputs : [])) {
      if (!isPlainObject(declared) || !isNonEmptyString(declared.key)) continue
      const key = declared.key
      if (key === 'enabled') continue
      if (!hasOwn(section, key)) continue
      if (section[key] === undefined) continue
      inputs[key] = section[key]
    }

    const inst = { instanceId, defId, inputs, hidden: false }
    if (Number.isInteger(def.version)) inst.defVersion = def.version

    // Placement. The definition's declared target, except that a PANE
    // oscillator listed in `volumeOverlayIndicators` renders on the volume
    // pane's left axis instead of its own stacked band — `StockChart.jsx:5457`
    // (`indTarget`). Only pane-target definitions can be moved that way: the
    // toolbar offers the choice for the nine oscillators only
    // (`ChartToolbar.jsx:370`), and `computePaneMargins` stacks exactly those
    // nine. Honouring the list for a price overlay would invent a placement no
    // shipped code path can produce.
    const declaredTarget = def.placement?.target
    if (isNonEmptyString(declaredTarget)) {
      inst.placement = {
        target: declaredTarget === 'pane' && volumeOverlay.has(defId) ? 'volume' : declaredTarget,
      }
    }

    // Field order matches the documented instance shape rather than the order
    // they happened to be assigned in.
    out.push({
      instanceId: inst.instanceId,
      defId: inst.defId,
      ...(inst.defVersion !== undefined ? { defVersion: inst.defVersion } : {}),
      inputs: inst.inputs,
      ...(inst.placement ? { placement: inst.placement } : {}),
      hidden: inst.hidden,
    })
    taken.add(instanceId)
  }

  return out
}

// ─── the validator ───────────────────────────────────────────────────────────

/**
 * Validate ONE instance against the registry.
 *
 * This is the element validation B1's settings passthrough deliberately left
 * open: `mergeChartSettings` accepts `indicatorInstances` as "an array, or
 * nothing" (`chartDefaults.js:394`) so that a read-merge-write from an
 * un-migrated surface could never destroy engine data, and left checking the
 * ELEMENTS to B2. This is that.
 *
 * PURE, and it NEVER THROWS — an invalid instance is data about a problem, not
 * an exception, because this runs on the read path where one bad element must
 * not take the chart down.
 *
 * WHAT IS AN ERROR, AND WHY EACH ONE
 *   · no `instanceId`      — the handle bindings, alerts and layouts key off
 *   · duplicate id         — two instances would fight over one binding slot
 *                            (needs `ctx.seenIds`; one instance alone cannot
 *                            know about another)
 *   · unknown `defId`      — an instance of an indicator that does not exist
 *   · an input key the definition does not declare — THE SUBTLE ONE. It is
 *     rejected rather than ignored because ignoring it means the engine computes
 *     with the DEFAULT while the stored blob says something else, and that
 *     number feeds alerts and the screener. defSchema's line applies verbatim:
 *     a chart that refuses to draw is a bug report; a chart that draws the wrong
 *     thing is a wrong trade.
 *   · an input violating its declared type / options / min / max — checked by
 *     `defSchema.validateInputValue`, the SAME function that checks a
 *     definition's own defaults, so the two can never disagree.
 *   · an unknown `placement.target`, or a non-boolean `hidden`
 *
 * WHAT IS DELIBERATELY *NOT* AN ERROR
 *   A `defVersion` that differs from the registered definition's `version`.
 *   `version` is the PRESENTATION version; the maths is pinned by the
 *   definition's `compute.rev`, which lives in the definition and not in the
 *   instance. Making a mismatch fatal would mean the first version bump silently
 *   deleted every user's indicator, which is a far worse failure than rendering
 *   it with the version this client has. The field is still type-checked, and
 *   what to DO about a bump is a B3+ migration policy decision.
 *
 * @param {unknown} inst
 * @param {object|Function} [registry]
 * @param {{seenIds?: Set<string>}} [ctx] list context; without it, duplicate-id
 *        cannot be and is not reported.
 * @returns {{ok: true, inst: object} | {ok: false, errors: string[]}}
 */
export function validateInstance(inst, registry, ctx) {
  try {
    if (!isPlainObject(inst)) {
      return { ok: false, errors: [`instance: expected an object, got ${fmt(inst)}`] }
    }

    const errors = []
    const reg = resolveRegistry(registry)

    // ─ instanceId ─
    const id = inst.instanceId
    if (!isNonEmptyString(id)) {
      errors.push(
        `instanceId: required non-empty string — it is the stable handle a binding, an alert ` +
        `and a saved layout all key off, got ${fmt(id)}`,
      )
    } else if (ctx && ctx.seenIds instanceof Set && ctx.seenIds.has(id)) {
      errors.push(
        `instanceId: duplicate ${fmt(id)} — two instances sharing an id would fight over one ` +
        `series and one binding slot, and an alert pinned to it could not say which it meant`,
      )
    }

    // ─ defId ─
    let def = null
    if (!isNonEmptyString(inst.defId)) {
      errors.push(`defId: required non-empty string (the definition this instantiates), got ${fmt(inst.defId)}`)
    } else {
      def = reg.get(inst.defId)
      if (!def) {
        errors.push(
          `defId: ${fmt(inst.defId)} names no registered definition — an instance of an ` +
          `indicator that does not exist can only ever render nothing`,
        )
      }
    }

    // ─ defVersion (type only — see the docstring) ─
    if (inst.defVersion !== undefined && inst.defVersion !== null) {
      if (!Number.isInteger(inst.defVersion) || inst.defVersion < 1) {
        errors.push(
          `defVersion: expected an integer >= 1 (the definition version this was authored ` +
          `against), got ${fmt(inst.defVersion)}`,
        )
      }
    }

    // ─ hidden ─
    if (inst.hidden !== undefined && inst.hidden !== null && typeof inst.hidden !== 'boolean') {
      errors.push(`hidden: expected true or false, got ${fmt(inst.hidden)}`)
    }

    // ─ placement ─
    if (inst.placement !== undefined && inst.placement !== null) {
      if (!isPlainObject(inst.placement)) {
        errors.push(`placement: expected an object, got ${fmt(inst.placement)}`)
      } else if (inst.placement.target !== undefined && !PLACEMENT_TARGETS.includes(inst.placement.target)) {
        errors.push(
          `placement.target: unknown target ${fmt(inst.placement.target)} — expected one of: ` +
          `${list(PLACEMENT_TARGETS)}. An instance may legally OVERRIDE its definition's target ` +
          `(a user moving an overlay into its own pane), but only to a target the binder knows.`,
        )
      }
    }

    // ─ inputs ─
    if (inst.inputs !== undefined && inst.inputs !== null) {
      if (!isPlainObject(inst.inputs)) {
        errors.push(`inputs: expected an object keyed by input key, got ${fmt(inst.inputs)}`)
      } else if (def) {
        const declaredByKey = new Map()
        for (const declared of (Array.isArray(def.inputs) ? def.inputs : [])) {
          if (isPlainObject(declared) && isNonEmptyString(declared.key) && !declaredByKey.has(declared.key)) {
            declaredByKey.set(declared.key, declared)
          }
        }
        for (const key of Object.keys(inst.inputs)) {
          const declared = declaredByKey.get(key)
          if (!declared) {
            errors.push(
              `inputs.${key}: definition ${fmt(def.id)} declares no input ${fmt(key)} ` +
              `(declared: ${list([...declaredByKey.keys()]) || 'none'}) — the engine would compute ` +
              `with the default while the stored blob says otherwise`,
            )
            continue
          }
          const value = inst.inputs[key]
          if (value === undefined) continue   // absent, not wrong: the default applies
          validateInputValue(declared, value, `inputs.${key}`, errors)
        }
      }
    }

    if (errors.length) return { ok: false, errors }
    return { ok: true, inst }
  } catch (err) {
    // The contract is "never throws". A defect in here — or a booby-trapped
    // getter on a blob deserialised from who-knows-where — must surface as a
    // rejected instance, not as an exception that takes the chart with it.
    return {
      ok: false,
      errors: [`instance: validator raised unexpectedly (${err && err.message ? err.message : String(err)})`],
    }
  }
}

// ─── the normaliser ──────────────────────────────────────────────────────────

/**
 * Split a stored instance list into what survives and what does not.
 *
 * NEVER THROWS, and — the point of the whole function — never drops anything
 * SILENTLY. Every rejected element comes back with the instance and a reason, so
 * "my RSI disappeared" has an answer sitting in the return value instead of
 * being a mystery. A dropped instance is a support ticket; a dropped instance
 * with no reason is an unanswerable one.
 *
 * FIRST WINS on a duplicate id. Arbitrary but it has to be one or the other, and
 * keeping the first preserves the order the user built.
 *
 * @param {unknown} list  `cs.indicatorInstances`, whatever it turned out to be
 * @param {object|Function} [registry]
 * @returns {{kept: object[], dropped: {inst: unknown, reason: string, errors: string[]}[]}}
 */
export function normalizeInstances(list, registry) {
  const kept = []
  const dropped = []

  // Absent is normal — most blobs have no instances at all. Not a finding.
  if (list === null || list === undefined) return { kept, dropped }

  if (!Array.isArray(list)) {
    const errors = [`indicatorInstances: expected an array, got ${fmt(list)}`]
    return { kept, dropped: [{ inst: list, reason: errors[0], errors }] }
  }

  const seenIds = new Set()
  for (const inst of list) {
    let result
    try {
      result = validateInstance(inst, registry, { seenIds })
    } catch (err) {
      result = {
        ok: false,
        errors: [`instance: validation raised unexpectedly (${err && err.message ? err.message : String(err)})`],
      }
    }
    if (result.ok) {
      kept.push(inst)
      try { seenIds.add(inst.instanceId) } catch { /* validated above; belt and braces */ }
    } else {
      dropped.push({ inst, reason: result.errors.join('; '), errors: result.errors })
    }
  }

  return { kept, dropped }
}
