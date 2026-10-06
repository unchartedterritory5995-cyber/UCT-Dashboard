// P2 truth matrix, slice "ui" — THE CONVERSATIONAL SAVE PATH FEEDS THE EXISTING
// CONSUMER DOORS (no model calls; the store and the alert API are stubs).
//
// The UI (`ConverseBox`) saves through `conversationSave.js`:
//   prepareSave → saveUserDefinition → installUserDefinitions → addInstance
//   → infoValueDoor.requestInfoValue / triggerPolicy.signalAlertRequest + create.
// These cases pin what that path DID against the shipped P1 doors. Each case
// states ASKED / CLAIMED / DID and its class.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseFormula } from '../ast/parse'
import * as registry from '../nativeRegistry'
import { removeInstance, setIndicatorEnabled } from '../instanceControls'
import { infoValuesOf } from '../infoValues'
import { resolveInfoValue, INFO_VALUE_STATES, INFO_VALUE_GUARDS } from '../infoValueResolve'
import { newAuthoringState, applyTurn, compactView } from '../../builder/authoring'
import { storeConversation, attachConversation, armConversationAlerts } from '../../builder/conversationSave'

const P = (src) => parseFormula(src).ast
const C = 'uct.authoring.patch/1'
const env = (s, ops) => ({ contract: C, baseRevision: s.revision, ops, assumptions: [] })
const CTX = { gateCtx: { tf: 'D', symbol: 'SPY' } }
const turn = (s, ops) => {
  const out = applyTurn(s, env(s, ops), CTX)
  expect(out.result.status, JSON.stringify(out.result.errors)).toBe('applied')
  return out.state
}
/** A stub store with the real one's answer shape: the server mints the id. */
function stubStore(id = 'u_0000000000a1') {
  const calls = []
  const save = async (doc, defId, telemetry, options) => {
    calls.push({ doc, defId, telemetry, options })
    return { ok: true, row: { def_id: defId || id, version: defId ? doc.version : 1, rev: 1, semantics: 2 } }
  }
  save.calls = calls
  return save
}
const SETTINGS = Object.freeze({ indicatorInstances: [], indicators: {} })

beforeEach(() => registry.clearUserDefinitions())
afterEach(() => registry.clearUserDefinitions())

describe('P2 ui — item 18: a conversational info value is a REFERENCE, and deleting its source severs it', () => {
  it('18 ASKED "show me the RSI value" then deleted the indicator; CLAIMED a header value bound to that installed output; DID add {instanceId, plotKey, format} via the existing door, and the delete door severed it (BROKEN info-value:deleted, no stale number) (EXACT / UNKNOWN→explicit)', async () => {
    let s = newAuthoringState({ lineage: 'auth_00000000ui18' })
    s = turn(s, [{ op: 'create', name: 'RSI', outputs: [{ key: 'rsi', tree: P('rsi(close, 14)') }] }])
    s = turn(s, [{ op: 'request_info_value', output: 'rsi', format: 'auto' }])
    const save = stubStore()
    const stored = await storeConversation(s, { save })
    expect(stored.ok).toBe(true)
    expect(save.calls).toHaveLength(1)
    const att = attachConversation({ storedDoc: stored.storedDoc, created: stored.created, requests: stored.requests, settings: SETTINGS })
    const refs = infoValuesOf(att.settings)
    // the stored reference is the P1 contract and nothing else — no tree, no formula copy
    expect(refs).toEqual([{ instanceId: att.instanceId, plotKey: 'rsi', format: 'auto' }])
    expect(att.outcomes.find((o) => o.kind === 'info_value')).toMatchObject({ ok: true })
    const live = resolveInfoValue(att.settings, refs[0], { registry })
    expect(live.state).not.toBe(INFO_VALUE_STATES.BROKEN)

    // DELETE through the shipped door → severed, kept visible, never reconnected
    const del = removeInstance(att.settings, att.instanceId, registry)
    expect(infoValuesOf(del)).toEqual([{ instanceId: att.instanceId, plotKey: 'rsi', format: 'auto', severed: true }])
    const r = resolveInfoValue(del, infoValuesOf(del)[0], { registry })
    expect(r).toMatchObject({ state: INFO_VALUE_STATES.BROKEN, guard: INFO_VALUE_GUARDS.DELETED, text: 'unavailable' })
    expect(r.value).toBeUndefined()
    // and the definition-level delete door severs it too
    const off = setIndicatorEnabled(att.settings, stored.storedDoc.id, false, registry)
    expect(infoValuesOf(off)[0].severed).toBe(true)
  })

  it('18x ASKED an info value on an output that the conversation later REMOVED before save; DID cancel the request with the output, so nothing dangling is requested (EXACT)', async () => {
    let s = newAuthoringState()
    s = turn(s, [{ op: 'create', name: 'Two', outputs: [{ key: 'value', tree: P('close > sma(close, 20)') }, { key: 'rsi', tree: P('rsi(close, 14)') }] }])
    s = turn(s, [{ op: 'request_info_value', output: 'rsi', format: 'auto' }])
    s = turn(s, [{ op: 'remove_output', output: 'rsi' }])
    expect(s.requests.infoValues).toEqual([])
    const stored = await storeConversation(s, { save: stubStore() })
    const att = attachConversation({ storedDoc: stored.storedDoc, created: true, requests: stored.requests, settings: SETTINGS })
    expect(infoValuesOf(att.settings)).toEqual([])
  })
})

describe('P2 ui — item 36: ONE definition across N conversational turns and saves', () => {
  it('36 ASKED 8 turns, save, 1 more turn, save; CLAIMED one evolving indicator; DID one lineage, one stored id, v1 POST then v2 PUT through the existing door, the alert armed by ADDRESS on the stored id (EXACT)', async () => {
    let s = newAuthoringState({ lineage: 'auth_00000000ui36' })
    s = turn(s, [{ op: 'create', name: 'RSI overbought', outputs: [{ tree: P('rsi(close, 14) > 70') }] }])
    s = turn(s, [{ op: 'set_slot', slot: 'value#1', value: 80 }])
    s = turn(s, [{ op: 'add_clause', output: 'value', join: 'and', tree: P('close > ema(close, 20) * 1.08') }])
    s = turn(s, [{ op: 'set_paint', output: 'value', channel: 'barcolor', color: '#FFD700' }])
    s = turn(s, [{ op: 'set_marker', output: 'value', shape: 'circle', position: 'belowBar' }])
    s = turn(s, [{ op: 'request_alert', output: 'value', triggerPolicy: 'becomes_true' }])
    s = turn(s, [{ op: 'add_output', key: 'rsi', tree: P('rsi(close, 14)'), label: 'RSI' }, { op: 'request_info_value', output: 'rsi', format: 'auto' }])
    const thr = compactView(s.working, s).definition.outputs.find((o) => o.key === 'value').slots.find((x) => x.role === 'threshold' && x.value === 80)
    s = turn(s, [{ op: 'set_slot', slot: thr.id, value: 75 }])
    expect(s.revision).toBe(8)
    const draftId = s.working.id

    const save = stubStore('u_0000000000b2')
    const first = await storeConversation(s, { save })
    expect(save.calls[0].defId).toBeNull() // POST
    expect(save.calls[0].doc.version).toBe(1)
    expect(first.storedDoc.id).toBe('u_0000000000b2') // the STORE's id, not the draft's
    expect(first.storedDoc.id).not.toBe(draftId)
    const att = attachConversation({ storedDoc: first.storedDoc, created: true, requests: first.requests, settings: SETTINGS })
    const alertCalls = []
    const alerts = await armConversationAlerts({ storedDoc: first.storedDoc, requests: first.requests, sym: 'SPY', tf: 'D',
      instanceId: att.instanceId, create: async (p) => { alertCalls.push(p); return { ok: true, id: 1 } } })
    expect(alerts).toEqual([{ kind: 'alert', plotKey: 'value', ok: true, text: 'Alert when value becomes true on SPY D: created.' }])
    expect(alertCalls[0]).toEqual({ sym: 'SPY', indicator: 'u_0000000000b2.value', trigger_policy: 'becomes_true',
      condition: 'cross_above', threshold: 0.5, tf: 'D', instance_id: att.instanceId })
    expect(JSON.stringify(alertCalls[0])).not.toMatch(/ast|rsi\(|ema\(/) // address only, no tree copy

    // the UI reopens from the store's row, SAME lineage, and keeps talking
    const { openAuthoringState } = await import('../../builder/authoring')
    let s2 = openAuthoringState(first.storedDoc, { defId: first.storedDoc.id, version: first.storedDoc.version, lineage: s.lineage })
    expect(s2.lineage).toBe('auth_00000000ui36')
    const thr2 = compactView(s2.working, s2).definition.outputs.find((o) => o.key === 'value').slots.find((x) => x.role === 'threshold' && x.value === 75)
    s2 = turn(s2, [{ op: 'set_slot', slot: thr2.id, value: 72 }])
    const second = await storeConversation(s2, { save })
    expect(save.calls).toHaveLength(2)
    expect(save.calls[1].defId).toBe('u_0000000000b2') // PUT, same identity
    expect(save.calls[1].doc.id).toBe('u_0000000000b2')
    expect(save.calls[1].doc.version).toBe(2)
    expect(second.created).toBe(false)
    // presentation survived the reopen + maths edit, byte for byte
    expect(save.calls[1].doc.paints).toEqual(save.calls[0].doc.paints)
    expect(save.calls[1].doc.plots.find((p) => p.key === 'value').marker).toEqual(save.calls[0].doc.plots.find((p) => p.key === 'value').marker)
    // the stamp the store decided is carried, never authored by the client
    expect(save.calls[0].doc.meta.semantics).toBeUndefined()
    expect(save.calls[1].doc.meta.semantics).toBe(2)
  })

  it('36r ASKED an alert on a SERIES at save time (a forged request bypassing the engine); DID refuse it at the browser preflight with the gate reason — no create call (REFUSAL)', async () => {
    let s = newAuthoringState()
    s = turn(s, [{ op: 'create', name: 'RSI', outputs: [{ key: 'rsi', tree: P('rsi(close, 14)') }] }])
    const stored = await storeConversation(s, { save: stubStore('u_0000000000c3') })
    registry.installUserDefinitions([stored.storedDoc])
    const calls = []
    const out = await armConversationAlerts({ storedDoc: stored.storedDoc, requests: { alerts: [{ plotKey: 'rsi', triggerPolicy: 'becomes_true' }] },
      sym: 'SPY', tf: 'D', create: async (p) => { calls.push(p); return { ok: true } } })
    expect(calls).toEqual([])
    expect(out[0].ok).toBe(false)
    expect(out[0].text).toMatch(/^Alert when rsi becomes true: refused — .*number on every bar/)
  })
})
