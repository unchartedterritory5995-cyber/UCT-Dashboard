// app/src/components/chart/engine/infoValueResolve.js
//
// ─── ⭐⭐ P1 — READING AN INFO VALUE: THE CHART'S OWN NUMBER, OR AN HONEST STATE ─
//
// `resolveInfoValue(cs, ref, env)` answers what the header should print for one
// stored reference (`infoValues.js`). It computes NOTHING:
//
//   · THE VALUE IS THE BINDER'S. It is `binding.lastValue` of the binding the
//     chart already drew for `bindingKey(instanceId, plotKey)` — the SAME field the
//     legend's off-cursor readout prints (`readout.chipsFrom`'s developing-bar
//     fallback, `binder.lastPointValue`). No second evaluator, no second "latest"
//     reader, no duplicated math: if the chart did not compute it, there is no
//     number to print.
//   · "LATEST LEGITIMATE VALUE" = THE NEWEST BAR'S VALUE, AND ONLY IF IT IS FINITE.
//     `lastPointValue` reads the LAST point, which is whitespace (no value) when
//     the newest bar is NaN/UNKNOWN. That is printed as UNKNOWN ('—') — never a
//     stale earlier value walked back to, and never 0. (Decision recorded in the
//     P1 info report.)
//   · THE GATE DECIDES FIRST. `evaluability(def, plotKey, 'info-value', ctx)` —
//     the one shared authority. A refusal prints the refusal (guard + sentence),
//     not a number; a pending sym fetch prints pending. Then the chart's own
//     dynamic refusals (`binder.columnErrorsOf`: budget, block runs, runtime stops).
//   · A BROKEN REFERENCE IS BROKEN. Severed by a delete, instance gone, definition
//     not installed, output no longer declared — each is an explicit `broken`
//     state. ⛔ It is never repaired here, and never looked up by display name.
//   · FORMAT IS PRESENTATION. It is applied after the value is read and never
//     reaches a compute memo; `yesno` on a non-truth output falls back to `auto`.

import { evaluability, STATUS, GATE_GUARDS } from './evaluability'
import { isTruthType } from './outputType'
import { engineChips, chipValueText } from './readout'
import { infoValuesOf, liveInstanceOf } from './infoValues'

export const INFO_VALUE_STATES = Object.freeze({
  VALUE: 'value',             // a finite latest value, formatted
  UNKNOWN: 'unknown',         // computed, but the newest bar has no value — '—'
  UNAVAILABLE: 'unavailable', // no column on this chart right now (hidden / not yet computed)
  PENDING: 'pending',         // the gate is waiting on data (a sym fetch)
  REFUSED: 'refused',         // the gate or the chart refused this output here
  BROKEN: 'broken',           // the reference no longer points at an installed output
})

export const INFO_VALUE_GUARDS = Object.freeze({
  DELETED: 'info-value:deleted',
  INSTANCE_MISSING: 'info-value:instance-missing',
  DEFINITION_MISSING: 'info-value:definition-missing',
  OUTPUT_MISSING: 'info-value:output-missing',
  HIDDEN: 'info-value:hidden',
  NOT_COMPUTED: 'info-value:not-computed',
})

const UNKNOWN_TEXT = '—'

/** May `key` of `def` be referenced at all? A declared DATA plot (a guide carries
 *  no value; a native `events[]` key is never bound as a series, so it could only
 *  ever print "unavailable"). */
export function infoValueOutputExists(def, key) {
  const plot = (def && Array.isArray(def.plots) ? def.plots : []).find((p) => p && p.key === key)
  return !!plot && plot.style !== 'hlines'
}

const resolveDefOf = (env) => {
  if (env && typeof env.defOf === 'function') return env.defOf
  const r = env && env.registry
  if (r && typeof r.getDefinition === 'function') return (id) => r.getDefinition(id)
  if (typeof r === 'function') return r
  return () => null
}

function defLabel(def, plotKey) {
  const name = (def && def.meta && def.meta.name) || (def && def.name) || (def && def.id) || 'Indicator'
  const dataPlots = (def && Array.isArray(def.plots) ? def.plots : []).filter((p) => p && p.style !== 'hlines')
  return dataPlots.length > 1 ? `${name} · ${plotKey}` : name
}

function formatValue(value, chip, plot, type, format) {
  if (format === 'yesno' && isTruthType(type) && (value === 0 || value === 1)) return value === 1 ? 'Yes' : 'No'
  if (chip) return chipValueText(chip)
  const legend = (plot && plot.legend) || {}
  return chipValueText({ value, decimals: legend.decimals, compact: legend.compact === true })
}

/**
 * @param {object} cs    the chart's settings (the instance list is read from it)
 * @param {{instanceId,plotKey,format,severed?}} ref a stored reference
 * @param {object} env
 *   `defOf` | `registry` — definition lookup;
 *   `bindings` — `binder.bindings()` (the chart's drawn series);
 *   `columnErrorsOf` — `binder.columnErrorsOf`;
 *   `gateCtx` — `{tf, secondary, exchangeOf, symbol}` for `evaluability`;
 *   `instances` — the normalised instance list (labels / formats), optional.
 * @returns {{instanceId, plotKey, format, state, text, label, value?, type?, guard?, reason?}}
 */
export function resolveInfoValue(cs, ref, env = {}) {
  const base = { instanceId: ref.instanceId, plotKey: ref.plotKey, format: ref.format || 'auto', severed: ref.severed === true }
  const broken = (guard, reason, label) => ({ ...base, state: INFO_VALUE_STATES.BROKEN,
    text: 'unavailable', label: label || `Unavailable · ${ref.plotKey}`, guard, reason })

  if (ref.severed === true) {
    return broken(INFO_VALUE_GUARDS.DELETED,
      'The indicator this value read was deleted. Remove this value, or point it at another output.')
  }
  const inst = liveInstanceOf(cs, ref.instanceId)
  if (!inst) {
    return broken(INFO_VALUE_GUARDS.INSTANCE_MISSING,
      'The indicator this value read is no longer on this chart.')
  }
  const def = resolveDefOf(env)(inst.defId)
  if (!def) {
    return broken(INFO_VALUE_GUARDS.DEFINITION_MISSING,
      'The indicator this value read is not installed (it was removed or refused at install).')
  }
  const label = defLabel(def, ref.plotKey)
  if (!infoValueOutputExists(def, ref.plotKey)) {
    return broken(INFO_VALUE_GUARDS.OUTPUT_MISSING,
      'The output this value read is no longer part of the indicator.', `${label} · unavailable`)
  }

  // ── THE SHARED GATE ───────────────────────────────────────────────────────
  const framedBinding = (Array.isArray(env.bindings) ? env.bindings : [])
    .find((b) => b && b.instanceId === ref.instanceId && b.plotKey === ref.plotKey)
  const gate = evaluability(def, ref.plotKey, 'info-value',
    { ...(env.gateCtx || {}), framed: !!(framedBinding && framedBinding.frame) })
  const type = gate.type
  if (gate.status === STATUS.REFUSED) {
    if (gate.guard === GATE_GUARDS.UNDECLARED) {
      return broken(INFO_VALUE_GUARDS.OUTPUT_MISSING, gate.reason, `${label} · unavailable`)
    }
    return { ...base, label, type, state: gate.pending ? INFO_VALUE_STATES.PENDING : INFO_VALUE_STATES.REFUSED,
      text: gate.pending ? '…' : 'n/a', guard: gate.guard, reason: gate.reason }
  }

  // ── THE CHART'S OWN DYNAMIC REFUSALS (budget, block runs, runtime stops) ──
  const errs = typeof env.columnErrorsOf === 'function' ? env.columnErrorsOf(ref.instanceId) : undefined
  const err = errs && errs[ref.plotKey]
  if (err) {
    return { ...base, label, type, state: INFO_VALUE_STATES.REFUSED, text: 'n/a',
      guard: err.guard, reason: err.message }
  }

  if (inst.hidden === true) {
    return { ...base, label, type, state: INFO_VALUE_STATES.UNAVAILABLE, text: UNKNOWN_TEXT,
      guard: INFO_VALUE_GUARDS.HIDDEN, reason: 'The indicator is hidden, so it is not computed on this chart.' }
  }
  if (!framedBinding) {
    return { ...base, label, type, state: INFO_VALUE_STATES.UNAVAILABLE, text: UNKNOWN_TEXT,
      guard: INFO_VALUE_GUARDS.NOT_COMPUTED, reason: 'This output has no value on this chart yet.' }
  }

  // ── THE BINDER'S NUMBER — one formatting pipeline (`readout.chipsFrom`) ────
  const chips = engineChips([framedBinding], null, env.registry || resolveDefOf(env),
    Array.isArray(env.instances) ? env.instances : (cs.indicatorInstances || []))
  const chip = chips.find((c) => c.instanceId === ref.instanceId && c.plotKey === ref.plotKey) || null
  let value = framedBinding.lastValue
  if (typeof value === 'function') { try { value = value() } catch { value = undefined } }
  if (!Number.isFinite(value)) {
    return { ...base, label: (chip && chip.label) || label, type, state: INFO_VALUE_STATES.UNKNOWN,
      text: UNKNOWN_TEXT, reason: 'The newest bar has no value for this output (unknown).' }
  }
  const plot = (def.plots || []).find((p) => p && p.key === ref.plotKey)
  return { ...base, label: (chip && chip.label) || label, type, state: INFO_VALUE_STATES.VALUE, value,
    text: formatValue(value, chip, plot, type, base.format),
    ...(gate.status === STATUS.DISCLOSED && gate.note ? { reason: gate.note } : {}) }
}

/** Every stored info value of `cs`, resolved, in stored order. */
export function resolveInfoValues(cs, env = {}) {
  return infoValuesOf(cs).map((ref) => resolveInfoValue(cs, ref, env))
}
