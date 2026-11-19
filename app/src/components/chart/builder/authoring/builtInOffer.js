// app/src/components/chart/builder/authoring/builtInOffer.js
//
// ─── ⭐ AN ANSWER THAT OFFERS AN ACTION: "ADD IT TO THIS CHART" (2026-11-18) ───────────
//
// Some names a member asks Create Indicator for are not formulas at all: they are UCT's own
// built-in indicators (the RS Rating is a rank across every stock, computed by the server). The
// door used to treat such a name as a formula to write. Now it answers by name, with no assistant
// call, and offers the one action that is the real answer: add that built-in to this chart.
//
// THREE RULES, each held by `builtInOffer.test.js`:
//
//   1. ONLY WHAT THIS BUILD CAN ADD IS EVER OFFERED. The window tells the door which of the
//      library's built-in names its own registry offers right now (`offerableBuiltIns`: the same
//      `isDefinitionOffered` question the Indicators list asks, so a definition the live server
//      does not publish is not on the list). The door offers nothing else, and the tap asks the
//      same question again before it writes (`applyOffer`).
//   2. AN OFFER NAMES A LIBRARY BUILT-IN OR IT IS NOTHING. The answer carries an indicator id; the
//      window acts on it only when that id is one of the built-in names it shipped with
//      (`checkedLibrary.json`, `builtIns`). The words on the button are the window's own.
//   3. A RESTORED CONVERSATION OFFERS NOTHING. An offer is for the chart as it stood when the
//      answer arrived; a transcript read back from the session has none (`withoutOffer`).
//
// ─── ⭐ ONE SETTING OF A BUILT-IN (2026-11-19) ──────────────────────────────────────────
//
// VWAP's standard-deviation bands are not a formula and not a second indicator: UCT's Session VWAP
// draws them when its "Std dev bands" setting is on. The library row for such a name carries
// `setting` {input, values}, and its offer carries `inputs` {input: value}.
//
//   4. A SETTING'S OFFER IS THE BUILT-IN WITH THAT SETTING, OR IT IS NOTHING. The window acts on
//      it only when `inputs` names exactly the row's input, one of the row's values, AND that
//      value is an option this window's own registry declares for that input (the words on the
//      button are that option's label there). It is never added WITHOUT the setting: that would be
//      something other than what the answer said. A plain built-in's offer never carries inputs.
//      On a chart that already has the built-in, the tap sets the setting on it (no second copy).

import { BUILT_IN_NAMES } from './checkedLibrary'
import { getDefinition } from '../../engine/nativeRegistry'
import { addInstance, setInstanceInput } from '../../engine/instanceControls'
import { eligibleInstances } from '../../engine/eligibility'

export const OFFER_ADD_BUILT_IN = 'add_built_in'

const rowOf = (indicator) => BUILT_IN_NAMES.find((b) => b && b.indicator === indicator) || null

/**
 * The built-in indicator ids this window can add to a chart right now, for the door.
 * @param {{registry: object, isOffered: Function, canWrite: boolean}} ctx
 */
export function offerableBuiltIns({ registry, isOffered, canWrite = true } = {}) {
  if (!canWrite || !registry || typeof registry.getDefinition !== 'function' || typeof isOffered !== 'function') return []
  return BUILT_IN_NAMES
    .map((b) => b.indicator)
    .filter((id, i, all) => all.indexOf(id) === i)
    .filter((id) => {
      const def = registry.getDefinition(id)
      return !!def && isOffered(def) === true
    })
}

/** What this window's own registry calls a setting and one of its values: {input, value}, or null
 *  when the definition does not declare that input with that option. */
export function settingWords(indicator, key, value) {
  const def = getDefinition(indicator)
  const declared = def && Array.isArray(def.inputs) ? def.inputs.find((i) => i && i.key === key) : null
  const option = declared && Array.isArray(declared.options)
    ? declared.options.find((o) => Array.isArray(o) && o[0] === value) : null
  if (!option || typeof declared.label !== 'string' || typeof option[1] !== 'string') return null
  return { input: declared.label, value: option[1] }
}

/** The one input an offer for this row carries, as [key, value, words], or null when it does not
 *  carry exactly what the row allows. */
function settingOf(row, raw) {
  const setting = row.setting && typeof row.setting === 'object' ? row.setting : null
  const given = raw.inputs
  if (!setting || !given || typeof given !== 'object' || Array.isArray(given)) return null
  const keys = Object.keys(given)
  const value = given[setting.input]
  if (keys.length !== 1 || keys[0] !== setting.input || typeof value !== 'string') return null
  if (!Array.isArray(setting.values) || !setting.values.includes(value)) return null
  const words = settingWords(row.indicator, setting.input, value)
  return words ? [setting.input, value, words] : null
}

/**
 * The offer an answer carries, as the window will show it, or null. Only the indicator id (and,
 * for a setting of a built-in, the one input) is read from the answer; the name and the button's
 * words are the window's own.
 */
export function liveOffer(raw) {
  if (!raw || typeof raw !== 'object' || raw.kind !== OFFER_ADD_BUILT_IN) return null
  const row = typeof raw.indicator === 'string' ? rowOf(raw.indicator) : null
  if (!row) return null
  const plain = { kind: OFFER_ADD_BUILT_IN, indicator: row.indicator, name: row.builtInName, label: `Add ${row.builtInName} to this chart` }
  if (!row.setting) return raw.inputs === undefined ? plain : null
  const got = settingOf(row, raw)
  if (!got) return null
  const [key, value, words] = got
  return { ...plain, inputs: { [key]: value }, label: `Add ${row.builtInName} with ${words.input}: ${words.value} to this chart` }
}

/** A transcript entry with no offer on it (a restored conversation, a taken offer). */
export function withoutOffer(entry) {
  if (!entry || typeof entry !== 'object' || !('offer' in entry)) return entry
  const { offer: _dropped, ...rest } = entry
  return rest
}

/** The instances of this definition on the chart (and not removed), oldest first. */
function onChart(settings, defId) {
  const list = settings && Array.isArray(settings.indicatorInstances) ? settings.indicatorInstances : []
  return list.filter((inst) => inst && inst.defId === defId && inst.removed !== true)
}

/** A sentence for a built-in that does not draw on the chart's timeframe (the chart's own
 *  eligibility rule decides), or ''. With no timeframe handed in, nothing is said. */
function whereItDraws(name, inst, registry, tf) {
  if (tf === undefined || tf === null || !inst) return ''
  const hidden = eligibleInstances([inst], registry, { tf: String(tf) }).hidden
  return hidden.some((h) => h.reason === 'timeframe')
    ? ` ${name} does not draw on this timeframe: it will show when the chart is on one it does.` : ''
}

/**
 * The tap. Asks again whether this build offers the indicator, then makes the same write the
 * Indicators list makes for a first add (and, for a setting of a built-in, the same write its
 * settings panel makes). Never throws; writes nothing itself.
 * @returns {{ok: true, next: object, line: string} | {ok: false, line: string}}
 */
export function applyOffer(offer, { settings, registry, isOffered, tf } = {}) {
  const live = liveOffer(offer)
  if (!live) return { ok: false, line: 'That could not be added from here.' }
  const def = registry && typeof registry.getDefinition === 'function' ? registry.getDefinition(live.indicator) : null
  if (!def || typeof isOffered !== 'function' || isOffered(def) !== true) {
    return { ok: false, line: `${live.name} is not offered on this chart right now, so nothing was added.` }
  }
  if (!settings || typeof settings !== 'object') return { ok: false, line: 'This chart cannot be changed from here, so nothing was added.' }
  const there = onChart(settings, live.indicator)[0] || null

  if (!live.inputs) {
    if (there) return { ok: false, line: `${live.name} is already on this chart.` }
    const next = addInstance(settings, live.indicator, registry)
    if (next === settings) return { ok: false, line: `${live.name} could not be added to this chart.` }
    // (a built-in that draws only on some timeframes, Historical Volatility on daily and up, say: the line says so
    // when this chart is not on one, by the chart's own eligibility rule, instead of an add that shows nothing)
    const added = onChart(next, live.indicator).pop() || null
    return { ok: true, next: { ...next, preset: 'custom' }, line: `Added ${live.name} to this chart.${whereItDraws(live.name, added, registry, tf)}` }
  }

  // ⭐ rule 4: the built-in WITH the setting, or nothing
  const [key, value] = Object.entries(live.inputs)[0]
  const words = settingWords(live.indicator, key, value)
  const says = `${words.input}: ${words.value}`
  const has = (cs, instanceId) => {
    const inst = onChart(cs, live.indicator).find((i) => i.instanceId === instanceId)
    return inst && inst.inputs && inst.inputs[key] === value ? inst : null
  }
  if (there) {
    if (has(settings, there.instanceId)) return { ok: false, line: `${live.name} is already on this chart with ${says}.` }
    const next = setInstanceInput(settings, there.instanceId, key, value, registry)
    const now = has(next, there.instanceId)
    if (!now) return { ok: false, line: `${live.name} is on this chart, and its ${words.input} setting could not be changed from here.` }
    const hiddenNote = now.hidden === true ? ' It is hidden on this chart: show it from the Indicators list.' : ''
    return {
      ok: true, next: { ...next, preset: 'custom' },
      line: `${live.name} was already on this chart. Its ${words.input} setting is now ${words.value}.${hiddenNote}${whereItDraws(live.name, now, registry, tf)}`,
    }
  }
  const added = addInstance(settings, live.indicator, registry)
  const fresh = added === settings ? null : onChart(added, live.indicator).pop() || null
  const next = fresh ? setInstanceInput(added, fresh.instanceId, key, value, registry) : settings
  const now = fresh ? has(next, fresh.instanceId) : null
  if (!now) return { ok: false, line: `${live.name} could not be added with ${says}, so nothing was added.` }
  return {
    ok: true, next: { ...next, preset: 'custom' },
    line: `Added ${live.name} to this chart with ${says}.${whereItDraws(live.name, now, registry, tf)}`,
  }
}
