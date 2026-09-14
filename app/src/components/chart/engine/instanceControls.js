// app/src/components/chart/engine/instanceControls.js
//
// ─── THE WRITE PATH FOR A FLIPPED INDICATOR ─────────────────────────────────
//
// Pure `(cs, …) → cs'`. No React, no preferences hook, no persistence: every
// caller already has a settings object and a way to hand one back
// (`onUpdateSettings` in the toolbar, `handleUpdateChartSettings` for the
// keyboard toggles), and threading a writer through them would give the engine
// two ways to save.
//
// ─── WHY THE LEGACY SECTION IS STILL WRITTEN ────────────────────────────────
//
// Flip B makes the INSTANCE the READ authority for the chart. It does NOT make
// `cs.indicators` dead data. So every write here goes to BOTH — the instance,
// and a write-through MIRROR.
//
// ⚠️ THE REASONS BELOW WERE RE-MEASURED AT B4 AND TWO OF THE ORIGINAL FOUR WERE
// FALSE. This note used to name "the alert evaluator, `IndicatorAlertPopover`,
// the screener, the `?indicators=` render route and any tab still running an
// older build". The popover **never** read this section — not before B4's
// alert-catalog task and not after; it renders `GET /api/indicator-alerts/catalog`
// and writes an alert row. The evaluator does not read chart settings either: it
// takes its parameters from the alert row's `params_json` and its bars from
// `bars_sqlite` (`api/services/indicator_alert_evaluator.py`). And no screener
// reads it at all. The mirror is still load-bearing; the justification was not.
//
// WHO ACTUALLY READS `cs.indicators.<id>` TODAY, each one checked:
//   · `StockChart`'s ten un-migrated render blocks — `indicatorData` gates every
//     one of them on `cs.indicators[id].enabled`. This is the big one, and it is
//     why a flipped id's mirror still has to move: a definition leaves the flip
//     set the day its block comes back.
//   · ⭐ NOT THE PANE LAYOUT, ANY MORE — B5 Task 12. This line read
//     *"`computePaneMargins`, through `paneMarginsProjection.csForPaneMargins`
//     — the band layout is keyed off `cs.indicators[key].enabled`"*. Flip C
//     deleted both modules: `paneLayout.computePaneLayout` reads the INSTANCE
//     LIST, so a mirror write reaches the geometry through the instance the
//     writer already updated, and there is no projection to keep honest.
//   · the settings surfaces — `ChartSettingsModal` / `ChartToolbar` rows resolve
//     `{kind:'indicator', key}` to `settings.indicators[key]`.
//   · the `?indicators=` render route (`pages/ChartRender.jsx`), which merges a
//     PARTIAL legacy blob through `mergeSettingsOverride` and carries no
//     instances at all.
//   · any tab still running an older build — `chart_settings` is one server-side
//     blob and an old bundle writes only this half of it.
//
// ⛔ AND THE "STALE PERIOD" MECHANISM THE OLD NOTE DESCRIBED DOES NOT EXIST. It
// claimed that without the mirror, "turn RSI off" leaves an RSI alert evaluating
// against a section that still says `enabled: true` with a stale period. Alerts
// do not read this section in either direction, so no write here can arm or
// disarm one. What the mirror really buys is a single, testable invariant —
// **the mirror always agrees with the instance** — which is what keeps the five
// readers above from disagreeing with the chart, and which
// `instanceControls.test.js` asserts on both sides of every write.
//
// The reverse direction is already handled: `migrateLegacyToInstances` projects a
// legacy toggle into an instance at read time, so a write from an un-migrated
// surface still reaches the chart.
//
// ─── WHY OFF IS A TOMBSTONE ─────────────────────────────────────────────────
//
// Removing the instance is undone by the very next read. The migrator would see
// the mirror… except the mirror is cleared too — but a GRID CELL whose snapshot
// predates the delete names the instance in full on its next unrelated write, and
// `mergeSettingsOverride`'s union-by-id puts it straight back. Only a persisting
// marker survives that (B2 Task 5's resurrect test). Reversal is an explicit
// re-add, which `mergeSettingsOverride` already understands.

import { validateInputValue } from './defSchema'
import { legacyInstanceId, newInstanceId, stackRank } from './instances'
import { instanceTombstone, isInstanceTombstone } from '../instanceShape'
import { getDefinition } from './nativeRegistry'
import { resolveDisplayTarget, isWritableDisplayTarget, legacyVolumeTarget } from './displayTarget'
import { wouldCycle, severReferencesTo, parsePaneOfTarget } from './sourceRef'
import { PLOT_STYLES, resolvePlotStyle, DOT_SIZES, DEFAULT_DOT_SIZE,
         CANDLE_COLOR_KEYS, resolveCandleColors } from './presentation'

function resolveRegistry(registry) {
  if (typeof registry === 'function') return (id) => registry(id)
  if (registry && typeof registry.getDefinition === 'function') return (id) => registry.getDefinition(id)
  return () => null
}

/** SHIPPED STACK order, as a rank per definition id — the same order the v1→v2
 *  fold seeds (`instances.migrateLegacyToInstances`). It preserves legacy render
 *  order for the five price overlays (`bb`, `vwap`, `sar`, `ichimoku`,
 *  `donchian`), because `SHIPPED_STACK_ORDER`'s tail IS registry order for those
 *  five and the engine draws all its series at one z-position — so a control that
 *  APPENDED would put a newly-enabled Bollinger band above a Donchian channel it
 *  should sit below. An id the registry does not list is not ranked at all.
 *
 *  ⛔ THERE MAY ONLY BE ONE ORDER, AND THAT IS WHY THIS MOVED. A read and a write
 *  that order the same set differently reorder a user's panes on the FIRST toggle
 *  after the migration. B5 Task 9 measured this exact change and the pixel gate
 *  refused it (`engine_three_bands_stacked`, a manifest geometry diff at 0 changed
 *  pixels, 5/5) — under `'bands'`, where all nine oscillators share pane 0.
 *  B5 Task 13 applies it once Flip C gave each of the nine its own pane; the
 *  ranking of the five overlays, which is the only z-order left in pane 0, is
 *  unchanged by it. `instanceControls.test.js` pins the two producers together. */
function stackOrderRank(registry) {
  const defs = (registry && typeof registry.listDefinitions === 'function') ? registry.listDefinitions() : []
  const ids = (Array.isArray(defs) ? defs : []).map(d => d && d.id)
  // Stable: registry order is the base, `stackRank` re-sorts it, and an id the
  // frozen array does not name keeps its registry position among the unranked.
  const ordered = [...ids].sort((a, b) => stackRank(a) - stackRank(b))
  return new Map(ordered.map((id, i) => [id, i]))
}

/** The declared inputs a definition has, keyed. */
function declaredInputs(def) {
  return new Map((def.inputs || []).filter(i => i && typeof i.key === 'string').map(i => [i.key, i]))
}

function isLiveInstance(inst) {
  if (!inst || typeof inst !== 'object') return false
  try { if (isInstanceTombstone(inst)) return false } catch { return false }
  return true
}

/**
 * A raw control value coerced to the type its input declares.
 *
 * `<input type="number">` hands back a STRING and `ChartToolbar.updateIndicator`
 * parses it with a hand-maintained `numFields` set (`:191`). Here the DEFINITION
 * says which are numeric, so there is no second list to keep in sync — and it
 * matters more than it did: a stored `"7"` fails `validateInputValue`, which
 * makes `normalizeInstances` DROP the whole instance and the indicator vanish.
 *
 * ⚠️ A float is NOT accepted where the definition declares an int. `parseInt`
 * would silently make 7.5 into 7 — a control changing the number the user typed.
 * `validateInputValue` would reject 7.5 anyway; refusing here keeps the two
 * answers the same and the refusal honest.
 *
 * Returns `undefined` when the value cannot be coerced, which the caller treats
 * as "reject the write".
 */
function coerce(declared, value) {
  if (!declared) return undefined
  switch (declared.type) {
    case 'int': {
      if (typeof value === 'number') return Number.isInteger(value) ? value : undefined
      if (typeof value !== 'string' || value.trim() === '') return undefined
      const n = Number(value)
      return Number.isInteger(n) ? n : undefined
    }
    case 'float': {
      if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
      if (typeof value !== 'string' || value.trim() === '') return undefined
      const n = Number(value)
      return Number.isFinite(n) ? n : undefined
    }
    case 'bool':
      return typeof value === 'boolean' ? value : undefined
    default:
      return typeof value === 'string' ? value : undefined
  }
}

/** The inputs a fresh instance of `defId` should carry: whatever the legacy
 *  section already says, filtered to keys the definition declares. Same
 *  projection `migrateLegacyToInstances` performs, so an instance created here
 *  and one created by the migrator are byte-identical for any blob the shipped
 *  renderer accepts — pinned by a `JSON.stringify` equality in the test file. */
function inputsFromLegacy(def, section) {
  const out = {}
  for (const [key, declared] of declaredInputs(def)) {
    if (!section || section[key] === undefined) continue
    const v = coerce(declared, section[key])
    if (v === undefined) continue
    const errors = []
    validateInputValue(declared, v, `inputs.${key}`, errors)
    if (!errors.length) out[key] = v
  }
  return out
}

/**
 * `cs` with a new instance list — sorted into SHIPPED STACK order (see
 * `stackOrderRank`) and marked `preset: 'custom'`, which is what every other
 * settings write in `ChartToolbar` does.
 *
 * ⭐ EXPORTED AT PHASE C TASK 12. It is not a new control door — it writes no
 * `cs.indicators.<id>.enabled` and decides nothing about what is on; it is the
 * ONE place an instance list is put back into a settings blob in the shipped
 * order, and per-chart sets need that same order for a list that now contains
 * instances belonging to different charts.
 *
 * ⛔ `scope` IS NOT A SORT KEY. The stack order is what a user's PANES are in;
 * grouping a chart's own instances together would reorder the panes of anyone
 * who ever scoped one. The sort is by definition, exactly as before, and
 * `instancesForChart` filters afterwards — so the panes a chart shows are a
 * SUBSEQUENCE of the global order, never a re-sort of it.
 *
 * Omitting `registry` leaves the list in its incoming order (no definition
 * ranks, `Array.prototype.sort` is stable since ES2019).
 */
export function withInstances(cs, instances, registry) {
  const order = stackOrderRank(registry)
  const sorted = [...instances].sort((a, b) =>
    (order.get(a && a.defId) ?? 1e9) - (order.get(b && b.defId) ?? 1e9))
  return { ...cs, indicatorInstances: sorted, preset: 'custom' }
}

/**
 * Turn one indicator on or off.
 *
 * OFF tombstones EVERY live instance of the definition, not just `legacy:<id>` —
 * a settings row is per-DEFINITION at v1, and leaving a second instance drawing
 * would make `isIndicatorEnabled` re-check the box the user just cleared.
 *
 * ON revives `legacy:<id>` if it is already there and live (so a user's edited
 * period is not rebuilt from the blob), otherwise builds the instance the
 * migrator would have built.
 *
 * @param {object} cs merged chart settings
 * @param {string} defId
 * @param {boolean} enabled
 * @param {object|Function} registry
 * @returns {object} the next settings blob, or `cs` UNCHANGED when the write is refused
 */
export function setIndicatorEnabled(cs, defId, enabled, registry) {
  const def = resolveRegistry(registry)(defId)
  if (!def || !cs || typeof cs !== 'object') return cs

  const list = Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
  const id = legacyInstanceId(defId)
  const indicators = { ...(cs.indicators || {}) }
  indicators[defId] = { ...(indicators[defId] || {}), enabled }

  if (!enabled) {
    const next = list.map(i => (isLiveInstance(i) && i.defId === defId ? instanceTombstone(i.instanceId) : i))
    // Nothing stored yet, but the legacy toggle may still be projecting one in at
    // read time — the tombstone is what stops the migrator putting it straight back.
    if (!next.some(i => i && i.instanceId === id)) next.push(instanceTombstone(id))
    return { ...withInstances(cs, next, registry), indicators }
  }

  const prev = list.find(i => i && typeof i === 'object' && i.instanceId === id)
  const rest = list.filter(i => !i || typeof i !== 'object' || i.instanceId !== id)
  const revived = (prev && isLiveInstance(prev))
    ? prev
    : {
        instanceId: id,
        defId,
        ...(Number.isInteger(def.version) ? { defVersion: def.version } : {}),
        inputs: inputsFromLegacy(def, cs.indicators && cs.indicators[defId]),
        ...(placementFor(def, defId, cs) ? { placement: placementFor(def, defId, cs) } : {}),
        hidden: false,
      }
  return { ...withInstances(cs, [...rest, revived], registry), indicators }
}

/** The LIVE instance under `instanceId`, or null. A tombstone is not an
 *  instance: every door below refuses one rather than reviving it. */
export function findInstance(cs, instanceId) {
  const list = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  return list.find(i => isLiveInstance(i) && i.instanceId === instanceId) || null
}

/**
 * Hide or show ONE instance.
 *
 * `hidden` is REMOVE-and-rebind, not park: `pool.planBindings` drops a hidden
 * instance and the binder calls `removeSeries`, which under `paneMode() ===
 * 'panes'` drops the pane synchronously. That is the shipped decision
 * (`__tests__/hiddenIsRemovedNotParked.test.js`) and this door does not change it.
 *
 * ⛔ IT DOES NOT TOUCH THE MIRROR. `isIndicatorEnabled` counts a hidden instance
 * as ON — `Alt+Shift+I` declutters the chart and must not uncheck every box —
 * so writing `indicators[defId].enabled = false` here would make the checkbox
 * disagree with the reader on the very next paint.
 */
export function setInstanceHidden(cs, instanceId, hidden, registry) {
  if (!cs || typeof cs !== 'object' || typeof hidden !== 'boolean') return cs
  if (!findInstance(cs, instanceId)) return cs
  const next = cs.indicatorInstances.map(i =>
    (i && i.instanceId === instanceId) ? { ...i, hidden } : i)
  return withInstances(cs, next, registry)
}

/**
 * Remove ONE instance, leaving its siblings drawing.
 *
 * ⭐ THE MIRROR IS "AT LEAST ONE LIVE INSTANCE", NOT "THE ONE I JUST DELETED".
 * `cs.indicators.<id>.enabled` is read by the `?indicators=` render route and by
 * `mergeSettingsOverride`, neither of which knows about instances. Clearing it
 * while a sibling still draws would tell those two readers RSI is off while the
 * chart draws it — the exact disagreement the write-through mirror exists to
 * prevent.
 */
export function removeInstance(cs, instanceId, registry) {
  const inst = findInstance(cs, instanceId)
  if (!inst) return cs
  const defId = inst.defId
  const next = cs.indicatorInstances.map(i =>
    (i && i.instanceId === instanceId) ? instanceTombstone(instanceId) : i)
  const indicators = { ...(cs.indicators || {}) }
  if (!next.some(i => isLiveInstance(i) && i.defId === defId)) {
    indicators[defId] = { ...(indicators[defId] || {}), enabled: false }
  }
  return { ...withInstances(cs, next, registry), indicators }
}

/**
 * Set one input on ONE instance.
 *
 * Same validation as `setIndicatorInput` and for the same reason — an input the
 * definition does not declare, or a value it would reject, produces an instance
 * `normalizeInstances` then DROPS, i.e. an indicator that silently disappears on
 * the next paint. Refused writes return `cs` by IDENTITY so the caller can skip
 * persisting.
 *
 * ⛔ IT DOES NOT WRITE THE MIRROR **WHILE A SIBLING EXISTS**. The mirror is per
 * DEFINITION and cannot carry two instances' periods; writing one of them there
 * would make the settings row and the `?indicators=` route show a number no line
 * on the chart is drawn with. That objection is right, and it is kept — but it
 * needs a sibling to bite, and it was being applied unconditionally.
 *
 * 🔴 WHAT THAT COST. With ONE instance the mirror was not ambiguous, just STALE,
 * and the mirror is what survives a blob round trip: `controlDoorCensus.test.js`
 * records that dropping `indicatorInstances` — "which is what a share link, a
 * preset and a reset all do" — leaves the read-time migrator rebuilding from the
 * mirror alone. `setIndicatorEnabled(…, false)` also tombstones the instance, and
 * a tombstone is minimal ON PURPOSE (`instanceShape.js:51`), so turning an
 * indicator off and on rebuilds `inputs` from the mirror too. An edit made here
 * therefore vanished on a toggle, a share link, a preset and a reset alike.
 * Measured in production 2026-08-14 (WMT 1D): MACD Fast set to 33 in this dialog,
 * toggled off and on from the Indicators list, reopened at **20** — the value the
 * GLOBAL modal had written into the mirror long before. Three doors, three
 * different answers for one number.
 *
 * So the mirror write is conditioned on exactly the case the objection does not
 * cover: the sole live instance of a definition, and that instance being the
 * legacy one the migrator projects back to. Rail:
 * `__tests__/instanceInputSurvivesTheMirror.test.js`, which pins BOTH halves —
 * the survival, and the sibling cases where the mirror must stay untouched.
 */
export function setInstanceInput(cs, instanceId, key, value, registry) {
  const inst = findInstance(cs, instanceId)
  if (!inst) return cs
  const def = resolveRegistry(registry)(inst.defId)
  if (!def) return cs
  const declared = declaredInputs(def).get(key)
  if (!declared) return cs
  const coerced = coerce(declared, value)
  if (coerced === undefined) return cs
  const errors = []
  validateInputValue(declared, coerced, `inputs.${key}`, errors)
  if (errors.length) return cs

  const next = cs.indicatorInstances.map(i => (
    i && i.instanceId === instanceId ? { ...i, inputs: { ...(i.inputs || {}), [key]: coerced } } : i
  ))
  const out = withInstances(cs, next, registry)

  // Counted AFTER `withInstances` normalizes, so a sibling it drops cannot
  // suppress a mirror write that is in fact unambiguous.
  const live = (out.indicatorInstances || []).filter(i => isLiveInstance(i) && i.defId === inst.defId)
  if (live.length !== 1 || instanceId !== legacyInstanceId(inst.defId)) return out

  const indicators = { ...(out.indicators || {}) }
  indicators[inst.defId] = { ...(indicators[inst.defId] || {}), [key]: coerced }
  return { ...out, indicators }
}

/**
 * Add ANOTHER instance of a definition already on the chart.
 *
 * The new instance carries the definition's DECLARED defaults rather than a copy
 * of a sibling's inputs: "another RSI" that arrives identical to the one already
 * there draws a second line exactly on top of the first, which reads as nothing
 * having happened. `stackRank` gives siblings an equal rank and
 * `Array.prototype.sort` is stable (ES2019), so `withInstances` preserves the
 * order they were added in.
 *
 * ⛔ IT ALSO SETS THE MIRROR ON. A user can reach this only for a definition that
 * is already drawing, but the blob a grid cell hands back may not say so, and an
 * instance list that draws while the mirror says OFF is the disagreement above in
 * the other direction.
 *
 * ⭐ EXPORTED WITH NO CALLER. Nothing in `app/src` reaches this until the
 * duplicate-indicator surface lands; `controlDoorCensus.test.js` asserts that
 * absence rather than assuming it.
 */
export function addInstance(cs, defId, registry) {
  const def = resolveRegistry(registry)(defId)
  if (!def || !cs || typeof cs !== 'object') return cs
  const list = Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
  const inputs = {}
  for (const [key, declared] of declaredInputs(def)) {
    if (declared.default !== undefined) inputs[key] = declared.default
  }
  const added = {
    instanceId: newInstanceId(defId, list),
    defId,
    ...(Number.isInteger(def.version) ? { defVersion: def.version } : {}),
    inputs,
    ...(placementFor(def, defId, cs) ? { placement: placementFor(def, defId, cs) } : {}),
    hidden: false,
  }
  const indicators = { ...(cs.indicators || {}) }
  indicators[defId] = { ...(indicators[defId] || {}), enabled: true }
  return { ...withInstances(cs, [...list, added], registry), indicators }
}

/**
 * The placement the MIGRATOR would give this definition — its declared target,
 * except that a PANE oscillator listed in `volumeOverlayIndicators` renders on
 * the volume pane's left axis instead of its own stacked band
 * (`StockChart.indTarget`). Duplicating the rule rather than exporting the
 * migrator's is the thing the byte-identity test in `instanceControls.test.js`
 * exists to catch drifting.
 */
function placementFor(def, defId, cs) {
  const target = def.placement?.target
  if (typeof target !== 'string' || !target) return null
  const overlaid = Array.isArray(cs?.volumeOverlayIndicators) && cs.volumeOverlayIndicators.includes(defId)
  return { target: target === 'pane' && overlaid ? 'volume' : target }
}

/**
 * Set one input on one indicator.
 *
 * ⚠️ IT DOES NOT SWITCH THE INDICATOR ON. Typing into the period box beside an
 * unchecked checkbox must not add the indicator to the chart — a control doing
 * something the user did not ask for is the same defect class as one doing
 * nothing. The value still lands in the legacy MIRROR, so switching the
 * indicator on afterwards adopts it (`inputsFromLegacy`).
 *
 * When the indicator IS on, the instance is written — creating it if the blob
 * says the indicator is on but no instance exists yet (the realistic crossover
 * blob: a user who enabled RSI before Flip B shipped).
 *
 * Refuses — returning `cs` untouched — a key the definition does not declare or
 * a value it would reject. Storing either produces an instance
 * `normalizeInstances` then DROPS, i.e. an indicator that silently disappears
 * on the next paint. defSchema's line applies verbatim: a chart that refuses to
 * change is a bug report; a chart that loses an indicator is a support ticket
 * with no answer in it.
 */
export function setIndicatorInput(cs, defId, key, value, registry) {
  const def = resolveRegistry(registry)(defId)
  if (!def || !cs || typeof cs !== 'object') return cs
  const declared = declaredInputs(def).get(key)
  if (!declared) return cs
  const coerced = coerce(declared, value)
  if (coerced === undefined) return cs
  const errors = []
  validateInputValue(declared, coerced, `inputs.${key}`, errors)
  if (errors.length) return cs

  const indicators = { ...(cs.indicators || {}) }
  indicators[defId] = { ...(indicators[defId] || {}), [key]: coerced }

  // Switched off ⇒ the mirror alone. `isIndicatorEnabled`'s rules, applied with
  // the flip set that always matters here: this writer only ever runs for a
  // flipped id.
  if (!isIndicatorEnabled(cs, defId, ONE_FLIPPED)) return { ...cs, indicators, preset: 'custom' }

  const withInstance = setIndicatorEnabled(cs, defId, true, registry)
  const id = legacyInstanceId(defId)
  const instances = (withInstance.indicatorInstances || []).map(i => (
    i && i.instanceId === id ? { ...i, inputs: { ...(i.inputs || {}), [key]: coerced } } : i
  ))
  return { ...withInstances(withInstance, instances, registry), indicators }
}

/** A one-element stand-in so `setIndicatorInput` can ask `isIndicatorEnabled`
 *  the FLIPPED question without allocating a Set per keystroke. `has` is the
 *  only method that predicate calls. */
const ONE_FLIPPED = Object.freeze({ has: () => true })

/**
 * Is this indicator on? ONE answer for every control surface, so a checkbox, a
 * keyboard shortcut and the settings panel can never disagree about it.
 *
 * For a FLIPPED id it models the same three rules the read-time migrator does,
 * because that is what decides whether the chart draws a line:
 *
 *   · a LIVE instance of the definition wins — including a hidden one, because
 *     `Alt+Shift+I` declutters the chart and must not unchecked every box;
 *   · a TOMBSTONE on `legacy:<id>` blocks the legacy projection — this is the
 *     "I turned it off and it came back" rule, from the reader's side;
 *   · otherwise the legacy toggle projects, exactly as
 *     `migrateLegacyToInstances` projects it into an instance the chart draws.
 *
 * ⚠️ THE THIRD RULE IS NOT OPTIONAL. Without it the crossover blob — toggle on,
 * no stored instance, which is every user's blob on the day Flip B ships — reads
 * "off" at the checkbox while the chart draws the indicator.
 */
export function isIndicatorEnabled(cs, defId, flippedIds) {
  const legacyOn = cs?.indicators?.[defId]?.enabled === true
  if (!flippedIds || typeof flippedIds.has !== 'function' || !flippedIds.has(defId)) return legacyOn

  const list = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  for (const inst of list) {
    if (isLiveInstance(inst) && inst.defId === defId) return true
  }
  const id = legacyInstanceId(defId)
  const blocked = list.some(i => {
    if (!i || typeof i !== 'object' || i.instanceId !== id) return false
    try { return isInstanceTombstone(i) } catch { return false }
  })
  return blocked ? false : legacyOn
}


// ─── PART E · THE CANONICAL PRESENTATION AND PLACEMENT WRITERS ─────────────
//
// ⭐⭐ THESE ARE WRITERS, NOT A SECOND STATE OWNER. Every one of them goes
// through `withInstances` exactly like the writers above it, mutates ONE
// instance by id, and returns a new settings object — so presentation and
// placement live in the same instance list, under the same persistence, as
// everything else. Universal Data needs to say "this copy draws as candles" and
// "this copy sits in QQQ's pane"; saying it anywhere but here would be a second
// mutation path for the same state, which is how two answers to "which copy did
// the user mean" get built.
//
// ⛔ NOTHING ELSE IN THIS FILE MOVED. The originating branch also rewrote
// `removeInstance`, `setInstanceHidden` and a legacy-volume helper; those are
// existing master behaviour with their own rails and are deliberately not taken
// here — this addition is purely additive.

/**
 * Where this indicator's OWN pane sits relative to the candles.
 *
 * ⭐⭐ PURELY ADDITIVE, AND THAT IS THE WHOLE BACKWARD-COMPATIBILITY STORY.
 * `normalizeInstances` spreads `placement` wholesale and `validateInstance`
 * checks only `placement.target`, so `position` needs no schema change, no
 * migration and no write-on-load. Every saved chart in production carries none,
 * reads as `undefined`, and lands BELOW price exactly where it always did.
 *
 * ⛔ `'below'` IS WRITTEN AS A DELETION, not as a stored value. Storing it would
 * make "the default" and "explicitly the default" two different blobs that mean
 * one thing, and the first template saved from a chart that had merely been
 * toggled back and forth would carry a key the shipped default does not. Absent
 * IS below; that is the invariant the read side already depends on.
 *
 * @param {'above'|'below'} position
 */
export function setInstancePanePosition(cs, instanceId, position, registry) {
  if (!cs || typeof cs !== 'object') return cs
  if (position !== 'above' && position !== 'below') return cs
  const inst = findInstance(cs, instanceId)
  if (!inst) return cs
  const next = cs.indicatorInstances.map((i) => {
    if (!i || i.instanceId !== instanceId) return i
    const placement = { ...(i.placement || {}) }
    if (position === 'above') placement.position = 'above'
    else delete placement.position
    // An empty placement is dropped entirely, for the same reason `below` is not
    // stored: a blob carrying `placement: {}` is not the blob a fresh chart writes.
    return Object.keys(placement).length ? { ...i, placement } : (() => {
      const { placement: _drop, ...rest } = i
      return rest
    })()
  })
  return withInstances(cs, next, registry)
}

/**
 * Set ONE instance's plot style.
 *
 * ⭐ PRESENTATION LIVES IN ITS OWN KEY, not in `placement`. Where an indicator
 * draws and how it draws are separate questions with separate controls and
 * separate defaults, and folding them into one object is how they start being
 * changed together by accident — the exact mistake `setInstanceDisplayTarget`
 * exists to avoid between `target` and `position`.
 *
 * ⛔ THE DEFAULT DELETES, like every other optional key here. `'line'` removes
 * `presentation.plotStyle` and then `presentation` itself if nothing else is
 * left, so a chart that has never touched the control is byte-identical to one
 * that set the style back.
 */
export function setInstancePlotStyle(cs, instanceId, style, registry, plotKey) {
  if (!cs || typeof cs !== 'object') return cs
  if (!PLOT_STYLES.includes(style)) return cs
  const inst = findInstance(cs, instanceId)
  if (!inst) return cs

  // ⭐⭐ THE DEFAULT IS THE DEFINITION'S, NOT `'line'`, AND THAT IS WHY "DELETE
  // TO RESET" HAS TO ASK. MACD's histogram output ships as a HISTOGRAM; deleting
  // its override must return it to a histogram, not flatten it to a line. So
  // "back to default" is "what `resolvePlotStyle` says with this entry removed",
  // which is the definition's shape — and the key is deleted only when the value
  // asked for IS that shape. One representation of the default, per output,
  // without a second table saying what each default is.
  const defaultFor = (key) => {
    const def = resolveRegistry(registry)(inst.defId)
    const plots = (def && Array.isArray(def.plots)) ? def.plots : []
    const plot = key ? plots.find((p) => p && p.key === key) : null
    const bare = { ...inst, presentation: undefined }
    return resolvePlotStyle(bare, plot || null)
  }

  const next = cs.indicatorInstances.map((i) => {
    if (!i || i.instanceId !== instanceId) return i
    const presentation = { ...(i.presentation || {}) }

    if (typeof plotKey === 'string' && plotKey) {
      // ── ONE OUTPUT ──
      const plots = { ...(presentation.plots || {}) }
      const entry = { ...(plots[plotKey] || {}) }
      if (style === defaultFor(plotKey)) delete entry.style
      else entry.style = style
      if (Object.keys(entry).length) plots[plotKey] = entry
      else delete plots[plotKey]
      if (Object.keys(plots).length) presentation.plots = plots
      else delete presentation.plots
    } else {
      // ── THE WHOLE INSTANCE ── the single-output shape POC D shipped, kept so
      // an RSI that stored `plotStyle` keeps meaning what it meant.
      if (style === defaultFor(null)) delete presentation.plotStyle
      else presentation.plotStyle = style
    }

    return Object.keys(presentation).length ? { ...i, presentation } : (() => {
      const { presentation: _drop, ...rest } = i
      return rest
    })()
  })
  return withInstances(cs, next, registry)
}

/**
 * Set ONE output's dot size (or the instance's, with no `plotKey`).
 *
 * Same delete-the-default rule as every other optional key here, and the same
 * per-output-over-instance shape as the style — one seam, two properties.
 */
export function setInstanceDotSize(cs, instanceId, size, registry, plotKey) {
  if (!cs || typeof cs !== 'object') return cs
  if (!Object.prototype.hasOwnProperty.call(DOT_SIZES, size)) return cs
  if (!findInstance(cs, instanceId)) return cs
  const next = cs.indicatorInstances.map((i) => {
    if (!i || i.instanceId !== instanceId) return i
    const presentation = { ...(i.presentation || {}) }
    if (typeof plotKey === 'string' && plotKey) {
      const plots = { ...(presentation.plots || {}) }
      const entry = { ...(plots[plotKey] || {}) }
      if (size === DEFAULT_DOT_SIZE) delete entry.dotSize
      else entry.dotSize = size
      if (Object.keys(entry).length) plots[plotKey] = entry
      else delete plots[plotKey]
      if (Object.keys(plots).length) presentation.plots = plots
      else delete presentation.plots
    } else if (size === DEFAULT_DOT_SIZE) delete presentation.dotSize
    else presentation.dotSize = size
    return Object.keys(presentation).length ? { ...i, presentation } : (() => {
      const { presentation: _drop, ...rest } = i
      return rest
    })()
  })
  return withInstances(cs, next, registry)
}

/**
 * One candle output's up or down colour.
 *
 * ⭐ THE SAME SHAPE `setInstanceDotSize` WRITES, deliberately: a style-specific
 * property lives beside the style in `presentation.plots[plotKey]`, and the
 * writer DELETES it when the member returns to the chart's own colour. A saved
 * chart therefore carries candle colours only where somebody changed one — the
 * rule every other presentation key here already follows.
 *
 * ⛔ THE DEFAULT IS THE CALLER'S, because it is the CHART's. `cs.candles.upColor`
 * is what the member's own candles wear, and a secondary instrument should match
 * it until they say otherwise; a constant here would be a second palette.
 *
 * @param {'upColor'|'downColor'} which
 * @param {string} color   the chosen colour
 * @param {string} fallback the chart's colour for `which` — an equal value deletes
 */
export function setInstanceCandleColor(cs, instanceId, which, color, registry, plotKey, fallback) {
  if (!cs || typeof cs !== 'object') return cs
  if (!CANDLE_COLOR_KEYS.includes(which)) return cs
  if (typeof color !== 'string' || !color) return cs
  if (!findInstance(cs, instanceId)) return cs
  const next = cs.indicatorInstances.map((i) => {
    if (!i || i.instanceId !== instanceId) return i
    const presentation = { ...(i.presentation || {}) }
    // ⚠️ ABSENT `plotKey` MEANS THE INSTANCE LEVEL, exactly as `setInstanceDotSize`
    // and `setInstancePlotStyle` treat it — a single-output row does not name its
    // one output, and a second convention for candle colours would put a member's
    // style and their colours in two different places on one instance.
    if (typeof plotKey === 'string' && plotKey) {
      const plots = { ...(presentation.plots || {}) }
      const entry = { ...(plots[plotKey] || {}) }
      if (color === fallback) delete entry[which]
      else entry[which] = color
      if (Object.keys(entry).length) plots[plotKey] = entry
      else delete plots[plotKey]
      if (Object.keys(plots).length) presentation.plots = plots
      else delete presentation.plots
    } else if (color === fallback) delete presentation[which]
    else presentation[which] = color
    return Object.keys(presentation).length ? { ...i, presentation } : (() => {
      const { presentation: _drop, ...rest } = i
      return rest
    })()
  })
  return withInstances(cs, next, registry)
}

/**
 * Move ONE instance to a different display target.
 *
 * ⭐⭐ TARGET AND OWN-PANE POSITION ARE SEPARATE CONCEPTS, AND THIS IS WHERE THAT
 * IS ENFORCED. `placement.position` ('above' / absent) says where the indicator
 * sits WHEN IT HAS ITS OWN PANE; `placement.target` says whether it has one at
 * all. Overlaying RSI onto Volume must not erase the fact that the user had put
 * it above Price, or sending it back to its own pane would silently demote it to
 * the default — a preference destroyed by a round trip nobody thought of as
 * destructive. So this function touches `target` and nothing else.
 *
 * ⛔ `'pane'` DELETES THE KEY rather than writing it, for the same reason
 * `setInstancePanePosition` deletes `position` for `'below'`: the default must
 * have exactly one representation, or two charts that look identical stop
 * comparing equal.
 *
 * ⚠️ THE LEGACY LIST IS KEPT IN STEP — on this explicit action ONLY. The toolbar
 * checkbox still reads and writes `cs.volumeOverlayIndicators`, so leaving it
 * behind would give the same chart two visible controls that disagree. This is
 * not the "migrate on load" that `displayTarget.js` forbids: nothing is written
 * unless a user moves an indicator.
 */
export function setInstanceDisplayTarget(cs, instanceId, target, registry) {
  if (!cs || typeof cs !== 'object') return cs
  if (!isWritableDisplayTarget(target)) return cs
  // ⛔⛔ NOTHING MAY BE ITS OWN GUEST (P2.3). `@<self>` is a WRITABLE-looking
  // target — the grammar cannot tell whose id it is — and storing it is not a
  // harmless no-op that resolves back to "own pane": `paneFollowerKeys` would
  // stop counting this instance as an owner, so `orderedPaneKeys` would allocate
  // no pane, and `placement.js` would then fail closed on the pane it is
  // following. The series would disappear with nothing anywhere reporting why.
  // Refused by IDENTITY, like every other rejected write here: the caller's test
  // is `next !== cs`.
  if (parsePaneOfTarget(target) === instanceId) return cs
  const inst = findInstance(cs, instanceId)
  if (!inst) return cs
  const defId = inst.defId

  // ⛔ THE LEGACY MIRROR IS KEYED BY DEFINITION, so only a definition the legacy
  // list could ever have named is written to it. `volumeOverlayIndicators` holds
  // DEF ids, which means one entry moves EVERY instance of that definition — fine
  // for the shipped oscillators it was built for (one RSI, one MFI), wrong for a
  // definition users instantiate many times. Sending `MA(Volume)` to the volume
  // pane must not also send `MA(RSI)` there. The canonical `placement.target`
  // carries the whole meaning; the mirror is compatibility, not storage.
  const lookup = resolveRegistry(registry)
  const mirrorsLegacy = ((lookup(defId) || getDefinition(defId))?.placement?.target) === 'pane'
  const legacy = Array.isArray(cs.volumeOverlayIndicators) ? cs.volumeOverlayIndicators : []
  const wantsVolume = target === 'volume'
  const inLegacy = legacy.includes(defId)
  let volumeOverlayIndicators = legacy
  if (!mirrorsLegacy) volumeOverlayIndicators = legacy
  else if (wantsVolume && !inLegacy) volumeOverlayIndicators = [...legacy, defId]
  else if (!wantsVolume && inLegacy) volumeOverlayIndicators = legacy.filter((x) => x !== defId)

  // ⭐ "BACK TO DEFAULT" IS WHAT THE RESOLVER SAYS WITH NO OVERRIDE, not the
  // literal `'pane'`. For most definitions those are the same sentence; for a
  // DERIVED one they are not — `MA(RSI)`'s default is RSI's PANE, so deleting the
  // key makes it FOLLOW its source, and `'pane'` is a real override meaning "give
  // it one of its own". Asking the resolver is what keeps one answer.
  //
  // ⛔⛔ ASKED WITH THIS DEFINITION OUT OF THE LEGACY LIST ENTIRELY — not with the
  // list as it arrived, and not with the list this write leaves behind. The
  // legacy entry is the OLD way of saying the same thing, and letting it answer
  // here means "volume is already the default, so write nothing", which is how
  // the CANONICAL `placement.target` would quietly never get written and the
  // whole POC C decision would reverse itself. The default is what the definition
  // and the SOURCE say — the two things a user has not overridden.
  const bare = { ...inst, placement: { ...(inst.placement || {}), target: undefined } }
  const defaultTarget = resolveDisplayTarget(bare, {
    ...cs, volumeOverlayIndicators: legacy.filter((x) => x !== defId),
  })

  const next = cs.indicatorInstances.map((i) => {
    if (!i || i.instanceId !== instanceId) return i
    const placement = { ...(i.placement || {}) }
    if (target === defaultTarget) delete placement.target
    else placement.target = target
    return Object.keys(placement).length ? { ...i, placement } : (() => {
      const { placement: _drop, ...rest } = i
      return rest
    })()
  })

  return { ...withInstances(cs, next, registry), volumeOverlayIndicators }
}
