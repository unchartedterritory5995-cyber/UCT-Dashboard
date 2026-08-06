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
//     scope:      'chart-2',       // ⭐ PHASE C TASK 12 — OPTIONAL, and ABSENT
//   }                              //    IS THE GLOBAL CASE. See below.
//
// ─── `scope`: WHICH CHART, AND WHY ABSENT IS NOT A VALUE ─────────────────────
//
// Spec §5 shipped the instance model with `scope?` and the note *"`scope`
// (chartId) present from day one as data; global default at cutover, per-chart
// + templates flips on in Phase C"*. ⛔ IT WAS NOT PRESENT — B5 shipped the six
// fields above it and nothing else — so Phase C ADDS it, and an addition to a
// shape every production blob already has has exactly one hard requirement:
// **an existing user's blob must not change at all.**
//
// That is why absent means global rather than `scope: 'global'`. A sentinel
// string would have to be WRITTEN into every instance of every stored blob to
// mean what the blob already means, which is a migration with no upside and a
// key-order change in every row. So:
//
//   · ABSENT            → global. Draws on every chart. Every row today.
//   · a non-empty string→ that chart id, and only that chart.
//   · `null`            → MALFORMED, and refused with a reason. It is not the
//                         same as absent: `JSON.stringify` DROPS an `undefined`
//                         value and keeps a `null`, so absent and explicit-
//                         undefined collapse into one stored shape while `null`
//                         survives as a third. Reading it as "global" would make
//                         a stored value mean the same as no value at all.
//
// ⚠️ THE FILTER AND THE VALIDATOR ANSWER DIFFERENT QUESTIONS AND MAY DISAGREE.
// `instanceScope` (below) answers *"which chart does this draw on"* and returns
// `undefined` for anything that is not a non-empty string — i.e. a malformed
// instance keeps drawing everywhere, the direction that does not make an
// indicator vanish inside the paint. `validateInstance` answers *"is this stored
// data well-formed"* and REPORTS the same value, so the user gets a reason.
// Both behaviours are pinned in `__tests__/alertSets.test.js`.
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
// ⭐ B5 TASK 9: `CHART_DEFAULTS.indicators` is now ONE key and it is this one.
// It used to have 15 against the registry's 14 definitions, and the odd one out
// was always `volumeProfile`; the fold retired the other fourteen and left the
// exemption standing alone, which is what makes it a retirement of the
// enumeration rather than a rename of it.
// `volumeProfile` is a canvas overlay with no compute function and no plot style
// that can express it (see the nativeRegistry docstring). It is SKIPPED, not
// emitted-and-dropped: an instance naming a definition that doesn't exist would
// be a validation failure reported to a user who did nothing wrong. B3 keeps the
// legacy canvas path for it. That is not a deferral — see
// `nativeRegistry.CARVED_OUT_INDICATOR_KEYS` for the decision and its expiry
// condition (a `primitive` compute kind, Phase C/D).

import {
  PLACEMENT_TARGETS,
  validateInputValue,
  formatValue as fmt,
} from './defSchema'
import {
  getDefinition as getNativeDefinition,
  listDefinitions as listNativeDefinitions,
} from './nativeRegistry'
import { instanceTombstone, isInstanceTombstone } from '../instanceShape'

// Re-exported so engine code has ONE import for everything instance-shaped. The
// definitions live in `chart/instanceShape.js` — beside `mergeSettingsOverride`,
// which is the only thing that can CREATE a tombstone. ⭐ B5 Task 9 moved them
// there OUT of `chartDefaults`, which now imports this module for the v1→v2
// fold: leaving them where they were made the two files mutually dependent, and
// `usePreferences` (eager, every page) would have dragged the whole registry and
// every `compute*` into the entry chunk through that one import.
export { instanceTombstone, isInstanceTombstone }

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

// ─── scope: the instance-shape half of per-chart sets ────────────────────────

/** The field name, in one place, so the two producers and the two readers below
 *  cannot drift apart on a string literal. */
export const INSTANCE_SCOPE_FIELD = 'scope'

/**
 * Which chart this instance belongs to, or `undefined` for a GLOBAL one.
 *
 * ⛔ NEVER RETURNS A SENTINEL. "Global" is the absence of an answer, not the
 * string `'global'` — see the header. A caller wanting "is this global" asks
 * `instanceScope(inst) === undefined`, which is true for every instance in every
 * blob that exists today and stays true without anything being written.
 *
 * Anything that is not a non-empty string reads as global, deliberately: this
 * runs inside the paint, and the failure direction that matters is the one where
 * a malformed field cannot make an indicator disappear.
 */
export function instanceScope(inst) {
  if (!isPlainObject(inst)) return undefined
  let v
  try { v = inst[INSTANCE_SCOPE_FIELD] } catch { return undefined }  // booby-trapped getter
  return isNonEmptyString(v) ? v : undefined
}

/**
 * A COPY of `inst` scoped to `chartId` — or, with a null/empty `chartId`, a copy
 * with the scope REMOVED.
 *
 * ⚠️ `scope` IS APPENDED LAST, ALWAYS, and re-scoping moves it to the end rather
 * than editing it in place. Field order is what a stored blob's bytes are: every
 * other key keeps the position it already had, so a diff of a user's
 * `chart_settings` shows one added key and nothing else. (`cloneInstance` and
 * the migrator's own emitter both document the same rule.)
 *
 * ⛔ CLEARING DELETES THE KEY. Setting it to `undefined` would leave a key that
 * `JSON.stringify` drops on the way out and `merge()` skips on the way in — the
 * half-deletion shape B5 Task 4 shipped, which every output-reading test passed.
 */
export function scopeInstance(inst, chartId) {
  if (!isPlainObject(inst)) return inst
  const out = {}
  for (const key of Object.keys(inst)) {
    if (key === INSTANCE_SCOPE_FIELD) continue
    out[key] = inst[key]
  }
  if (isNonEmptyString(chartId)) out[INSTANCE_SCOPE_FIELD] = chartId
  return out
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

// ─── the order the fold seeds, ONCE ──────────────────────────────────────────
//
// ⭐⭐ B5 TASK 9. The migrator used to emit in REGISTRY order, which was fine
// while an instance list decided nothing a user could see. It decides pane order
// at Flip C (`engine/paneLayout.orderedPaneKeys` walks the instance list), and
// the settings blob stops carrying `cs.indicators` in this same commit — so the
// order every existing user's panes are in today exists in exactly one place
// after this, and it is the array below.
//
// ✅ AND B5 TASK 13 APPLIES IT — IN THE SEED, WHICH IS THE ONE PLACE THAT KEEPS
// EVERY READER OF THE LIST AGREEING. Task 12 measured that Flip C shipped WITHOUT
// it: `orderedPaneKeys` walks the instance list, the fold seeded that list in
// REGISTRY order, and nothing in between sorted by `stackRank`, so an existing
// user's pane order came out `rsi, macd, stoch, atr, mfi, cci, williamsR, adx,
// obv` while their bands read the array below. On a chart with `rsi + macd +
// stoch` those disagree — `rsi, macd, stoch` after against `rsi, stoch, macd`
// today — and the owner's answer was "ship the cutover, PRESERVING TODAY'S". So
// `migrateLegacyToInstances` below emits this order, and `instanceControls`'
// writer agrees with it (one order, two producers).
//
// ⛔ WHY THE SEED AND NOT A SORT INSIDE `computePaneLayout`. The layout is not the
// only reader of the list: the legend prints in BINDING order, which walks the
// same list, and `legendFromDefinitions.test.jsx` pins the two together. Sorting
// panes by `stackRank` inside the layout would give the panes back their order and
// leave the legend in registry order — a disagreement no pixel case can see,
// because no parity case hovers. Seeding the list itself moves every reader at
// once.
//
// ⛔ AND TASK 9's Z-ORDER REFUSAL IS ANSWERED RATHER THAN IGNORED — see the note
// at `migrateLegacyToInstances`. It was measured under `'bands'`, where all nine
// oscillators share pane 0 with the five price overlays and insertion order is
// z-order. Under `'panes'` the nine each own a pane, and the five overlays are
// the TAIL of this array in registry order, so their relative insertion order —
// the only z-order that survives — is byte-identical.
//
// ⛔ IT WAS DERIVED FROM `computePaneMargins`, AND AT TASK 12 IT IS INLINED —
// which is what the ⏭️ note that stood here asked for, in the same words:
// *"INLINE the array this produces at that moment — do not re-derive it from
// anything else, because the shipped stack order stops existing the day that
// file does and the seeded instance order becomes its only record."*
//
// `paneMargins.js` was "consumed, never modified" for five phases and Flip C
// retires it. Its `PANES` list inserted keys bottom-of-the-chart first, so the
// nine below are that list REVERSED — the order a user's panes are in today,
// top to bottom — and they are followed by the five price overlays in registry
// order.
//
// ⛔ RE-DERIVING THIS FROM THE REGISTRY WOULD BE WRONG, NOT MERELY DIFFERENT.
// Registry order for the nine is `rsi, macd, stoch, atr, mfi, cci, williamsR,
// adx, obv`; the shipped stack order is what is written below. They differ, and
// the difference is every existing user's pane order.
//
// ⚠️ PANE IDS FIRST, then price overlays in REGISTRY order. Registry order IS
// legacy z-order for the five price overlays (`instanceControls.registryRank`),
// and LWC z-stacks by insertion order, so their relative order may not move.
// Pane ids sit on their own price scales / panes, so theirs may.
//
// A definition added after this froze is APPENDED rather than dropped — the
// array below is the historical record, not the catalogue, and
// `instances.test.js` asserts every registered id appears exactly once.
const FROZEN_SHIPPED_STACK_ORDER = [
  // the nine stacked oscillators, TOP-TO-BOTTOM
  'rsi', 'stoch', 'mfi', 'williamsR', 'cci', 'macd', 'adx', 'atr', 'obv',
  // the five price overlays, in REGISTRY order
  'bb', 'vwap', 'sar', 'ichimoku', 'donchian',
]

function computeShippedStackOrder() {
  const known = listNativeDefinitions().map(d => d && d.id).filter(isNonEmptyString)
  const frozen = FROZEN_SHIPPED_STACK_ORDER.filter(id => known.includes(id))
  const rest = known.filter(id => !frozen.includes(id))
  return Object.freeze([...frozen, ...rest])
}

/** The order a v1 blob's indicators are seeded into `indicatorInstances`:
 *  the nine stacked panes TOP-TO-BOTTOM, then the five price overlays in
 *  registry order. Exported so a test can measure it — and so the ONE record of
 *  the retired stack order has a name. */
export const SHIPPED_STACK_ORDER = computeShippedStackOrder()

/** Rank of a definition id in `SHIPPED_STACK_ORDER`; an unranked id sinks. */
export function stackRank(defId) {
  const i = SHIPPED_STACK_ORDER.indexOf(defId)
  return i === -1 ? 1e9 : i
}

// ─── the migrator ────────────────────────────────────────────────────────────

/**
 * Project the legacy indicator toggles onto engine instances.
 *
 * PURE: reads `cs`, returns a new array, mutates nothing (the blob's own objects
 * are never handed back by reference).
 *
 * WHAT IT READS
 *   `cs.indicators`               the legacy keyed sections — `enabled` plus
 *                                 params. ⭐ After B5 Task 9 a MERGED blob has
 *                                 only `volumeProfile` here, so the live callers
 *                                 are `mergeChartSettings`' own fold (which
 *                                 hands it the RAW stored section) and the
 *                                 `mergeSettingsOverride` lane, which is not an
 *                                 allow-list and can still inject one
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
 * ORDER is `SHIPPED_STACK_ORDER`, not `Object.keys` order, so two blobs with the
 * same indicators produce byte-identical output regardless of how they were
 * serialised — and so a migrated user's panes come out in the order their BANDS
 * are in today. ⛔ B5 Task 9 tried this and the pixel gate refused it under
 * `'bands'`; B5 Task 13 applies it because Flip C removed the reason. See the
 * note at `defIds` below for why the z-order it moved cannot move any more.
 *
 * @param {object} cs        a chart_settings blob, raw or merged
 * @param {object|Function} [registry]
 * @returns {object[]} instances
 */
export function migrateLegacyToInstances(cs, registry) {
  const reg = resolveRegistry(registry)

  const existing = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  const out = existing.map(cloneInstance)
  // A TOMBSTONE COUNTS AS TAKEN. Deleting an indicator does not flip its legacy
  // toggle (the toggle is what the pre-B3 renderer still reads), so on the very
  // next read the migrator would see `enabled: true` with no live instance and
  // helpfully put it back — "I turned it off and it came back on refresh".
  // Reserving the id is what stops that; a test pins it.
  const taken = new Set(
    out.filter(i => isPlainObject(i) && isNonEmptyString(i.instanceId)).map(i => i.instanceId),
  )

  const legacy = isPlainObject(cs?.indicators) ? cs.indicators : null
  if (!legacy) return out

  const volumeOverlay = new Set(
    Array.isArray(cs?.volumeOverlayIndicators) ? cs.volumeOverlayIndicators : [],
  )

  // ⛔⭐ SHIPPED STACK ORDER — AND B5 TASK 9 MEASURED A REASON IT COULD NOT BE,
  // WHICH FLIP C RETIRED. The seed order is what the pane layout reads for PANE
  // order, so Task 9 emitted `SHIPPED_STACK_ORDER` here and the pixel gate refused
  // it: `engine_three_bands_stacked` reported a MANIFEST GEOMETRY diff at
  // **0 changed pixels**, 5/5 runs,
  //
  //     panes[0].series[2].scaleId: 'cci' -> 'williamsR'
  //     panes[0].series[3].scaleId: 'williamsR' -> 'cci'
  //
  // because this list is also the order the binder calls `addSeries` in, and
  // INSERTION ORDER IS Z-ORDER. Both those series were in **pane 0** — under
  // `'bands'` every oscillator is, alongside the five price overlays — and "0 px
  // with a geometry change" is the one shape this gate treats as a lie by
  // construction.
  //
  // ⭐ UNDER `'panes'` THAT DIFF CANNOT ARISE, AND IT IS STRUCTURE RATHER THAN
  // LUCK. The nine pane-target definitions each own a pane, so no two of them are
  // ever z-stacked against each other; the only series still sharing pane 0 are
  // the candles, the volume band and the five PRICE OVERLAYS — and the overlays
  // are the TAIL of `SHIPPED_STACK_ORDER`, in registry order, so their relative
  // insertion order is unchanged by this sort. B5 Task 13 re-ran the gate to prove
  // it rather than assert it: `engine_price_overlay_zorder` (all five, no pane) is
  // the case that would have caught a z-order move.
  //
  // ⚠️ STABLE SORT, DELIBERATELY. `stackRank` sinks an id it does not rank to
  // 1e9, and `Array.prototype.sort` has been stable since ES2019 — so a definition
  // registered after the array froze keeps REGISTRY order among its peers instead
  // of landing wherever the comparator's tie-break felt like.
  const registryOrder = reg.list().map(d => d && d.id).filter(isNonEmptyString)
  const defIds = registryOrder.length
    ? registryOrder.filter(id => hasOwn(legacy, id)).sort((a, b) => stackRank(a) - stackRank(b))
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
    // (`ChartToolbar.jsx:370`), and the pane layout stacks exactly those nine.
    // Honouring the list for a price overlay would invent a placement no
    // shipped code path can produce.
    const declaredTarget = def.placement?.target
    if (isNonEmptyString(declaredTarget)) {
      inst.placement = {
        target: declaredTarget === 'pane' && volumeOverlay.has(defId) ? 'volume' : declaredTarget,
      }
    }

    // Field order matches the documented instance shape rather than the order
    // they happened to be assigned in.
    //
    // ⭐ PHASE C TASK 12 — AND THERE IS NO `scope` HERE, WHICH IS THE POINT.
    // A legacy toggle is a GLOBAL fact: `cs.indicators.rsi.enabled` was never
    // about one chart, and the blob it came from has no chart id in it to be
    // about one. So the seed emits the same six fields it emitted before this
    // task, in the same order, and the strongest available form of "key order
    // is unchanged in every stored blob" is that the key is never written.
    // `__tests__/alertSets.test.js` asserts it across the whole fixture corpus,
    // including the genuine production capture.
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

    // ─ scope (PHASE C TASK 12) ─
    //
    // ⛔ THE ONLY THREE ANSWERS ARE "ABSENT", "A CHART ID" AND "MALFORMED", and
    // `null` is the third one. It has to be, because it is the one of the three
    // serialisations that SURVIVES `JSON.stringify` while an absent key and an
    // explicit `undefined` collapse into each other — so reading `null` as
    // "global" would give a stored value the same meaning as no value, and a
    // client that wrote it would never learn it had done nothing.
    if (hasOwn(inst, INSTANCE_SCOPE_FIELD) && inst[INSTANCE_SCOPE_FIELD] !== undefined) {
      if (!isNonEmptyString(inst[INSTANCE_SCOPE_FIELD])) {
        errors.push(
          `scope: expected a chart id (a non-empty string), got ${fmt(inst[INSTANCE_SCOPE_FIELD])} — ` +
          `an ABSENT scope is what "this indicator is on every chart" means, so there is no ` +
          `null, no empty string and no sentinel: omit the key`,
        )
      }
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
 * TOMBSTONES GET THEIR OWN BUCKET. `{instanceId, deleted: true}` is a normal part
 * of the stored data (see `chartDefaults.instanceTombstone`), so it is neither
 * KEPT — it has no definition to render — nor DROPPED, because `dropped` means
 * "something went wrong and here is why" and filling it with routine records is
 * how that bucket stops being worth reading. It is `removed`. A tombstone is not
 * run through `validateInstance` at all: it has no `defId` by design, and asking
 * an instance validator about a record of a non-instance would only ever produce
 * a misleading error.
 *
 * @param {unknown} list  `cs.indicatorInstances`, whatever it turned out to be
 * @param {object|Function} [registry]
 * @returns {{kept: object[], removed: object[], dropped: {inst: unknown, reason: string, errors: string[]}[]}}
 */
export function normalizeInstances(list, registry) {
  const kept = []
  const removed = []
  const dropped = []

  // Absent is normal — most blobs have no instances at all. Not a finding.
  if (list === null || list === undefined) return { kept, removed, dropped }

  if (!Array.isArray(list)) {
    const errors = [`indicatorInstances: expected an array, got ${fmt(list)}`]
    return { kept, removed, dropped: [{ inst: list, reason: errors[0], errors }] }
  }

  const seenIds = new Set()
  for (const inst of list) {
    let isTombstone = false
    try { isTombstone = isInstanceTombstone(inst) } catch { /* booby-trapped getter */ }
    if (isTombstone) {
      // The id is the only thing a tombstone has to say. Without one it names
      // nothing and cannot be honoured by any merge — that IS a defect.
      let id = null
      try { id = inst.instanceId } catch { /* fall through to the error below */ }
      if (isNonEmptyString(id)) {
        removed.push(inst)
      } else {
        const errors = [
          `instanceId: required non-empty string on a removal record ` +
          `({instanceId, deleted: true}) — a tombstone without an id names nothing, ` +
          `got ${fmt(id)}`,
        ]
        dropped.push({ inst, reason: errors[0], errors })
      }
      continue
    }

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

  return { kept, removed, dropped }
}

// ─── ownership: which legacy render blocks must stand down ───────────────────

/**
 * The definition ids the ENGINE is the authority for on this chart.
 *
 * ⛔ THE CROSSOVER PROBLEM THIS SOLVES. Under Flip A the engine renders into the
 * SAME band, on the SAME price scale, as the legacy block it replaces — and that
 * band's geometry came from `computePaneMargins`, which read
 * `cs.indicators[key].enabled`. So the legacy toggle had to stay ON for the
 * layout to be identical, and if the legacy toggle is on then the legacy block
 * draws too. Two RSI lines on one scale is not a parity result; it is a
 * different picture that happens to contain the right one.
 *
 * The answer is ownership, per indicator: an instance of definition `X` means
 * "the engine draws X here", and X's legacy block guards on
 * `!engineOwned.has('X')`. That is the same shape B3 uses for real — it adds the
 * guard to one more block per indicator it migrates, and deletes the block
 * outright when the last surface has flipped.
 *
 * ─── THE THREE RULES, AND WHY EACH ONE FAILS THE WAY IT DOES ────────────────
 *
 *  · A HIDDEN instance still OWNS its definition. `planBindings` skips a hidden
 *    instance, so the engine draws nothing — and if hiding also handed authority
 *    back, the legacy block would light up and the indicator the user just hid
 *    would still be on the chart. Ownership is authority, not paint.
 *
 *  · A defId THE REGISTRY DOES NOT KNOW owns nothing. The binder cannot draw an
 *    instance with no definition (it `continue`s past it), so silencing the
 *    legacy block on its behalf would erase the indicator entirely. Fail toward
 *    the path that still renders.
 *
 *  · A TOMBSTONE (`{instanceId, deleted: true}`) owns nothing — it has no
 *    `defId`, and it is a record that an instance is GONE. `normalizeInstances`
 *    already routes those to `removed`, but this function re-checks rather than
 *    trusting its caller to have filtered, because the cost of being wrong here
 *    is an indicator that silently disappears.
 *
 * PURE, allocation-light, and safe on garbage: anything that is not a usable
 * instance is skipped rather than throwing, because this runs inside the paint.
 *
 * @param {unknown} instances  normalised instances (`normalizeInstances().kept`)
 * @param {object|Function} [registry]
 * @returns {Set<string>} definition ids whose legacy render block must stand down
 */
export function engineOwnedDefIds(instances, registry) {
  const owned = new Set()
  if (!Array.isArray(instances)) return owned
  const reg = resolveRegistry(registry)

  for (const inst of instances) {
    if (!isPlainObject(inst)) continue
    let tombstone = false
    try { tombstone = isInstanceTombstone(inst) } catch { /* booby-trapped getter */ }
    if (tombstone) continue
    if (!isNonEmptyString(inst.instanceId)) continue
    if (!isNonEmptyString(inst.defId)) continue
    let def = null
    try { def = reg.get(inst.defId) } catch { /* a registry that throws owns nothing */ }
    if (!def) continue
    owned.add(inst.defId)
  }

  return owned
}
