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
import { legacyInstanceId, stackRank } from './instances'
import { instanceTombstone, isInstanceTombstone } from '../instanceShape'

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
