// app/src/components/chart/builder/conversationSave.js
//
// ─── ⭐⭐ P2 — SAVING A CONVERSATION'S WORKING DEFINITION, THROUGH THE SAME DOORS ─
//
// There is NO private AI save path. A conversation's working definition is a
// proposal held client-side; this module hands it to the doors `BuilderSheet`
// already uses, in the same order:
//
//   prepareSave (validateUserDefinitions)  →  saveUserDefinition (server
//   authority: semantics stamp, repaint ack, budget, presentation validation)
//   →  installUserDefinitions (the STORE's id, version, rev and semantics)
//   →  addInstance (create only)  →  the stored consumer requests:
//      info value → infoValueDoor.requestInfoValue (against the INSTALLED instance)
//      alert      → triggerPolicy.signalAlertRequest (a yes/no) or, PHASE 5,
//                   numericAlertRequest (a number) + createIndicatorAlert
//      calculation timeframe (PHASE 5) → instanceControls.setInstanceCalculationTimeframe
//
// Every request gets an outcome that says what happened — added, created, or
// refused with the door's own reason. Nothing claims a value or an alert exists
// when the door that owns it said no.

import { prepareSave } from './authoring/authoringState'
import { draftDefId } from './BuilderSheet'
import { saveUserDefinition } from '../../../hooks/useUserDefinitions'
import { createIndicatorAlert } from '../../../hooks/useIndicatorAlerts'
import * as engineRegistry from '../engine/nativeRegistry'
import { addInstance, setInstanceCalculationTimeframe, setInstanceInput } from '../engine/instanceControls'
import { calcTimeframeLabel } from '../engine/instanceTimeframe'
import { withStoredSemantics } from '../engine/definitionSemantics'
import { signalAlertRequest, policyLabel, numericAlertRequest, numericAlertWords } from '../engine/triggerPolicy'
import { infoValueRefFor, requestInfoValue, addedInstanceId } from './infoValueDoor'
import { chromeInputKeys } from './builderInputs'

/**
 * Validate and store. One call to `saveUserDefinition` at most.
 * @returns {Promise<{ok: true, created: boolean, row, storedDoc, doc, requests}
 *                 | {ok: false, stage: 'validate'|'ack'|'store', error: string}>}
 */
export async function storeConversation(state, { previewAcked = false, draftId = null, save = saveUserDefinition } = {}) {
  const prep = prepareSave(state, { draftId: draftId || draftDefId() })
  if (!prep.doc || prep.errors.length) {
    return { ok: false, stage: 'validate', error: prep.errors.join('\n') || 'The registry refused this definition.' }
  }
  if (prep.needsAck.length && !previewAcked) {
    return { ok: false, stage: 'ack', error: `Tick the acknowledgement first: ${prep.needsAck.join(', ')} reads a bar ahead and is not final until it closes.` }
  }
  // ⭐ PHASE 4 — an EDIT is revision-aware: the store refuses (409) when the
  // definition moved on after this conversation opened it, instead of overwriting.
  const opts = {
    ...(prep.needsAck.length ? { previewAcked: true } : {}),
    ...(prep.defId && Number.isInteger(state.baseVersion) ? { baseVersion: state.baseVersion } : {}),
  }
  const res = await save(prep.doc, prep.defId, null, Object.keys(opts).length ? opts : null)
  if (!res || !res.ok) {
    return { ok: false, stage: res && res.conflict ? 'conflict' : 'store',
      error: (res && res.error) || 'The server refused this definition.' }
  }
  const row = res.row || { def_id: prep.doc.id, version: prep.doc.version, rev: 1 }
  // ⛔ THE STORE'S id / version / rev / semantics — never the draft's guess.
  const storedDoc = withStoredSemantics({
    ...prep.doc,
    id: row.def_id || prep.doc.id,
    ...(Number.isInteger(row.version) ? { version: row.version } : {}),
    compute: { ...prep.doc.compute, ...(Number.isInteger(row.rev) ? { rev: row.rev } : {}) },
  }, row)
  return { ok: true, created: !prep.defId, row, storedDoc, doc: prep.doc, requests: prep.requests }
}

/** Member number inputs (float / int, not the plots' chrome) whose DEFAULT differs
 *  between the opened definition and the stored one → [key, storedInput][]. */
export function changedInputDefaults(base, stored) {
  const nums = (d) => new Map(((d && d.inputs) || [])
    .filter((x) => x && (x.type === 'float' || x.type === 'int') && typeof x.key === 'string')
    .map((x) => [x.key, x]))
  const before = nums(base)
  const chrome = new Set(((stored && stored.plots) || []).flatMap((p, i) => {
    const k = chromeInputKeys(p, i)
    return [k.color, k.width]
  }))
  const out = []
  for (const [key, x] of nums(stored)) {
    if (chrome.has(key)) continue
    const was = before.get(key)
    if (was && Number.isFinite(x.default) && x.default !== was.default) out.push([key, x])
  }
  return out
}

/**
 * Install the stored document, add it to the chart on a create (the Builder's
 * own behaviour), and fulfil the info-value requests against the INSTALLED
 * instance. Pure over `settings` (returns the next settings; the caller writes).
 * @returns {{settings, instanceId: string|null, installed: boolean, outcomes: object[]}}
 */
export function attachConversation({ storedDoc, created, requests, settings, registry = engineRegistry, base = null }) {
  const outcomes = []
  const { installed, errors } = registry.installUserDefinitions([storedDoc])
  if (errors.length || installed.length !== 1) {
    outcomes.push({ kind: 'chart', ok: false, text: `Saved, but it could not be drawn: ${errors.join('; ') || 'the registry refused it'}.` })
    for (const v of (requests && requests.infoValues) || []) {
      outcomes.push({ kind: 'info_value', plotKey: v.plotKey, ok: false, text: `Header value for ${v.plotKey}: not shown — the definition is not installed.` })
    }
    return { settings, instanceId: null, installed: false, outcomes }
  }
  const id = installed[0].id
  let cs = settings
  let instanceId = null
  if (!settings) {
    outcomes.push({ kind: 'chart', ok: false, text: 'Saved. No chart is open here, so it was not added to one.' })
  } else if (created) {
    const next = addInstance(settings, id, registry)
    instanceId = addedInstanceId(settings, next, id)
    cs = next
    outcomes.push(instanceId
      ? { kind: 'chart', ok: true, text: 'Added to the chart.' }
      : { kind: 'chart', ok: false, text: 'Saved, but it could not be added to the chart.' })
  } else {
    const inst = (settings.indicatorInstances || []).find((i) => i && i.defId === id)
    instanceId = inst ? inst.instanceId : null
    outcomes.push({ kind: 'chart', ok: true, text: instanceId ? 'The chart redraws it with the new version.' : 'Saved. It is not on this chart.' })
  }
  // ⭐ A SETTING THE CONVERSATION CHANGED IS THE MEMBER'S OWN VALUE ON THIS CHART.
  // ⚰️ Measured on prod 2026-10-08 (real model): "Change my risk percentage from 1%
  // to 0.5%" set the definition's DEFAULT to 0.5, while the 1 the member typed lives
  // on this chart's instance — so nothing they could see changed. A member input
  // whose default this edit moved is written to the instance on THIS chart through
  // its own writer (`setInstanceInput`, which refuses what the settings dialog would).
  // Other charts keep their own values.
  if (!created && instanceId && base) {
    for (const [key, to] of changedInputDefaults(base, storedDoc)) {
      const next = setInstanceInput(cs, instanceId, key, to.default, registry)
      const inst = ((next && next.indicatorInstances) || []).find((i) => i && i.instanceId === instanceId)
      const ok = !!inst && inst.inputs && inst.inputs[key] === to.default
      if (ok) cs = next
      outcomes.push({ kind: 'input_value', key, ok,
        text: ok ? `${to.label || key} on this chart: ${to.default}.`
          : `${to.label || key}: the new default is ${to.default}, but this chart's value was not changed.` })
    }
  }
  // ⭐ PHASE 5 — THE WHOLE INDICATOR ON A HIGHER TIMEFRAME: the instance's own
  // calculation-timeframe control, written through its own writer (which refuses
  // what the control would). Applied to the instance this save attached.
  const calc = requests && typeof requests.calculationTimeframe === 'string' ? requests.calculationTimeframe : null
  if (calc && instanceId) {
    const next = setInstanceCalculationTimeframe(cs, instanceId, calc, registry)
    const inst = ((next && next.indicatorInstances) || []).find((i) => i && i.instanceId === instanceId)
    const ok = !!inst && inst.calculationTimeframe === calc
    if (ok) cs = next
    outcomes.push({ kind: 'calc_timeframe', ok,
      text: ok ? `Calculated on the ${calcTimeframeLabel(calc)} timeframe.`
        : `Not calculated on ${calcTimeframeLabel(calc)}: this indicator follows the chart's timeframe here.` })
  } else if (calc) {
    outcomes.push({ kind: 'calc_timeframe', ok: false, text: `Not calculated on ${calcTimeframeLabel(calc)}: it is not on this chart.` })
  }
  for (const v of (requests && requests.infoValues) || []) {
    const req = requestInfoValue(cs, infoValueRefFor({ instanceId, plotKey: v.plotKey, format: v.format || 'auto' }), registry.getDefinition)
    if (req.added) cs = req.settings
    outcomes.push({
      kind: 'info_value', plotKey: v.plotKey, ok: req.added,
      text: req.added ? `Header value for ${v.plotKey}: shown in the chart header.` : `Header value for ${v.plotKey}: not shown — ${req.reason}`,
    })
  }
  return { settings: cs, instanceId, installed: true, outcomes }
}

/**
 * Arm each requested alert through the shared browser preflight and the
 * existing create API. The server is the authority; its words are shown.
 * @returns {Promise<object[]>} outcomes
 */
export async function armConversationAlerts({ storedDoc, requests, sym, tf: chartTf, instanceId = null, create = createIndicatorAlert }) {
  const outcomes = []
  // ⭐ PHASE 5 — an indicator calculated on a higher timeframe ALERTS on that
  // timeframe's closed bars: the numbers the member watches are those, not the chart's.
  const tf = requests && typeof requests.calculationTimeframe === 'string' && chartTf
    ? requests.calculationTimeframe : chartTf
  for (const a of (requests && requests.alerts) || []) {
    const numeric = typeof a.condition === 'string'
    const what = numeric
      ? `Alert when ${a.plotKey} ${numericAlertWords(a.condition, a.threshold)}`
      : `Alert when ${a.plotKey} ${String(policyLabel(a.triggerPolicy) || a.triggerPolicy).toLowerCase()}`
    if (!sym || !tf) {
      outcomes.push({ kind: 'alert', plotKey: a.plotKey, ok: false, text: `${what}: not created — there is no chart symbol and timeframe to arm it on.` })
      continue
    }
    const req = numeric
      ? numericAlertRequest({ def: storedDoc, key: a.plotKey, condition: a.condition, threshold: a.threshold, sym, tf, ctx: { tf, symbol: sym } })
      : signalAlertRequest({ def: storedDoc, key: a.plotKey, policy: a.triggerPolicy, sym, tf, ctx: { tf, symbol: sym } })
    if (!req.ok) {
      outcomes.push({ kind: 'alert', plotKey: a.plotKey, ok: false, text: `${what}: refused — ${req.gate.reason || req.gate.guard || 'not allowed here'}` })
      continue
    }
    const payload = instanceId ? { ...req.payload, instance_id: instanceId } : req.payload
    const res = await create(payload)
    outcomes.push(res && res.ok
      ? { kind: 'alert', plotKey: a.plotKey, ok: true, text: `${what} on ${payload.sym} ${tf}: created.` }
      : { kind: 'alert', plotKey: a.plotKey, ok: false, text: `${what}: refused by the server — ${(res && res.error) || 'no reason given'}` })
  }
  return outcomes
}
