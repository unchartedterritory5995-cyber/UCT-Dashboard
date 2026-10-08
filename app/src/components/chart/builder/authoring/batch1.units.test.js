// BATCH 1 — the pure pieces: the session mirror, the member-name helpers, the receipt
// and the TC2000 look-alike. ASKED / CLAIMED / DID per case.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  readSession, writeSession, clearSession, _resetSessions, _simulateReload, isRestorable,
  STORAGE_KEY, PERSIST_TTL_MS, PERSIST_HISTORY, chartScope, createKey,
} from './conversationSessions'
import { STATE_CONTRACT, newAuthoringState } from './authoringState'
import { soleCueName, memberCueNames } from './derivedName'
import { renamePatch, withMemberName } from './memberNamePatch'
import { validatePatchShape } from './patchValidate'
import { saveReceipt } from '../studio/saveOutcomeReceipt'
import { detectDialect, parsePcf } from '../../engine/ast/pcf'
import { inspectSource } from '../PineBox'

const snap = (over = {}) => ({ state: { ...newAuthoringState(), ...over }, transcript: [{ id: 0, role: 'member', text: 'hi' }], acked: false })

beforeEach(() => { _resetSessions() })

describe('the session mirror (sessionStorage)', () => {
  it('holds the same contract as the authoring state (it is inlined to keep the toolbar chunk light)', () => {
    expect(STATE_CONTRACT).toBe('uct.authoring.state/1')
    expect(isRestorable(snap())).toBe(true)
  })
  it('ASKED a persisted write then a reload · DID come back marked recovered; an unpersisted (ConverseBox) one does not', () => {
    writeSession('create:a', snap(), { persist: true })
    writeSession('new:b', snap())
    _simulateReload()
    expect(readSession('create:a')).toMatchObject({ recovered: true })
    expect(readSession('new:b')).toBeNull()
  })
  it('expires after the TTL and is forgotten', () => {
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now)
    writeSession('create:a', snap(), { persist: true })
    spy.mockReturnValue(now + PERSIST_TTL_MS + 1)
    _simulateReload()
    expect(readSession('create:a')).toBeNull()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    spy.mockRestore()
  })
  it('trims the undo stack it carries, keeps at most 8 drafts, and clearSession ends both copies', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ revision: i, working: null, intent: null, requests: {}, assumptions: [], questions: [] }))
    writeSession('create:a', snap({ history }), { persist: true })
    _simulateReload()
    expect(readSession('create:a').state.history).toHaveLength(PERSIST_HISTORY)
    for (let i = 0; i < 12; i += 1) writeSession(`create:k${i}`, snap(), { persist: true })
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)).entries).toHaveLength(8)
    clearSession('create:k11')
    _simulateReload()
    expect(readSession('create:k11')).toBeNull()
    expect(readSession('create:k10')).not.toBeNull()
  })
  it('refuses shapes it cannot open', () => {
    expect(isRestorable(null)).toBe(false)
    expect(isRestorable({ state: { contract: 'x' }, transcript: [] })).toBe(false)
    expect(isRestorable({ ...snap(), transcript: [{ role: 'system' }] })).toBe(false)
    expect(isRestorable({ ...snap({ revision: -1 }) })).toBe(false)
  })
  it('a chart scope is stable for one chart id, opaque, and distinct per chart', () => {
    expect(chartScope('widget-7')).toBe(chartScope('widget-7'))
    expect(chartScope('widget-7')).not.toBe(chartScope('widget-8'))
    expect(chartScope('widget-7')).toMatch(/^c_[0-9a-f]{8}$/)
    expect(chartScope(null)).toBeNull()
    expect(createKey(chartScope('AAPL drill'))).not.toContain('AAPL')
  })
})

describe('the member\'s name', () => {
  it.each([
    ['Call it Swing Line', 'Swing Line'],
    ['Okay, rename it to Momentum Pulse.', 'Momentum Pulse'],
    ['Please name it “RSI Trend”', 'RSI Trend'],
    ['now call it Swing Line', 'Swing Line'],
  ])('a naming-only message: %s', (words, name) => expect(soleCueName(words)).toBe(name))
  it.each([
    'Make it 28 and call it Swing Line',
    'call it Swing Line and colour it red',
    'Add a 20 EMA',
    'What would you call it?',
  ])('NOT naming-only: %s', (words) => expect(soleCueName(words)).toBeNull())
  it('two names are not one instruction', () => expect(soleCueName('call it A, then name it B')).toBeNull())

  it('the rename patch is a valid envelope; the member\'s name is appended / corrects the model\'s; never on a create', () => {
    const st = { revision: 3 }
    const p = renamePatch(st, 'Swing Line')
    expect(validatePatchShape(p).ok).toBe(true)
    expect(p).toMatchObject({ baseRevision: 3, ops: [{ op: 'rename_definition', name: 'Swing Line' }] })
    const env = { contract: p.contract, baseRevision: 3, ops: [{ op: 'set_slot', slot: 'value#1', value: 28 }] }
    expect(withMemberName(env, 'make it 28 and call it Swing Line').ops.at(-1)).toEqual({ op: 'rename_definition', name: 'Swing Line' })
    const theirs = { ...env, ops: [...env.ops, { op: 'rename_definition', name: 'RSI 28' }] }
    expect(withMemberName(theirs, 'make it 28 and call it Swing Line').ops.filter((o) => o.op === 'rename_definition')).toEqual([{ op: 'rename_definition', name: 'Swing Line' }])
    const create = { ...env, ops: [{ op: 'create', name: 'EMA 21', outputs: [] }] }
    expect(withMemberName(create, 'call it Swing Line')).toBe(create)
    expect(withMemberName(env, 'make it 28')).toBe(env)
    expect(memberCueNames('rename this to my rsi')).toEqual(['my rsi'])
  })
})

describe('the receipt', () => {
  const doc = { meta: { name: 'RSI 28' }, version: 3 }
  it('complete only when every step succeeded', () => {
    const r = saveReceipt({ storedDoc: doc, created: false, outcomes: [{ kind: 'chart', ok: true, text: 'The chart redraws it with the new version.' }] })
    expect(r).toMatchObject({ status: 'complete', title: 'Changes saved', version: 3 })
    expect(r.items[0]).toEqual({ kind: 'definition', ok: true, text: '“RSI 28” is saved as version 3.' })
  })
  it('a failed step makes it partial and says how many', () => {
    const r = saveReceipt({ storedDoc: doc, created: true, outcomes: [
      { kind: 'chart', ok: false, text: 'Saved. No chart is open here, so it was not added to one.' },
      { kind: 'alert', ok: false, text: 'Alert …: refused' }] })
    expect(r.status).toBe('partial')
    expect(r.title).toBe('Saved — 2 steps did not complete')
    expect(r.items.filter((i) => !i.ok)).toHaveLength(2)
  })
})

describe('TC2000 RSI / WRSI', () => {
  it('ASKED RSI14 > 70 in the import box · DID read as TC2000 and refused with the WRSI spelling written out', () => {
    expect(detectDialect('RSI14 > 70')).toBe('pcf')
    const e = parsePcf('RSI14 > 70')
    expect(e).toMatchObject({ ok: false, guard: 'pcf:name', token: 'RSI14' })
    expect(e.error).toMatch(/not Wilder's RSI/)
    expect(e.error).toMatch(/`WRSI14`$/)
    const r = inspectSource('RSI14.1 > 70', 'auto')
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/`WRSI14\.1`/)
  })
  it('the suggested spelling works, and the native lower-case scalar is untouched', () => {
    expect(inspectSource('WRSI14 > 70', 'auto').ok).toBe(true)
    expect(detectDialect('rsi14 > 70')).toBe('native')
    expect(detectDialect('rsi(close, 14) > 70')).toBe('native')
  })
})
