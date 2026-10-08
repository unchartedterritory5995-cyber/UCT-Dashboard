// BATCH 1 — MEMBER EXPERIENCE AND RELIABILITY: the acceptance set, deterministic.
//
// The model is scripted; everything else is the product (engine, readback, registry,
// the real panel and hook, the save doors with the network spied). A page RELOAD is
// simulated the only honest way available here: the panel is unmounted, the module's
// in-memory session map is dropped (`_simulateReload`) and this tab's sessionStorage
// is kept — exactly what a browser reload does to them.
// ASKED / CLAIMED / DID per case.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { STUDIO_PREVIEW_DEF_ID } from './chartPreview'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'
import {
  _resetSessions, _simulateReload, createKey, editKey, readSession, STORAGE_KEY, chartScope,
} from '../authoring/conversationSessions'
import { applyPatch } from '../authoring'
import { parseFormula } from '../../engine/ast/parse'
import SaveReceipt from './SaveReceipt'

const H = vi.hoisted(() => ({ saves: [], alert: { ok: true } }))
vi.mock('../../../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  saveUserDefinition: vi.fn(async (doc, defId) => {
    H.saves.push({ doc, defId })
    return { ok: true, row: { def_id: defId || 'u_aaaaaaaaaaaa', version: doc.version, rev: 1, semantics: 2 } }
  }),
}))
vi.mock('../../../../hooks/useIndicatorAlerts', async (orig) => ({
  ...(await orig()),
  createIndicatorAlert: vi.fn(async () => H.alert),
}))

import CreateIndicatorPanel from './CreateIndicatorPanel'

const C = 'uct.authoring.patch/1'
const GATE = { tf: 'D', symbol: 'AAPL' }
const previewTree = () => JSON.stringify(registry.getDefinition(STUDIO_PREVIEW_DEF_ID) || null)
const lastUct = () => [...document.querySelectorAll('[data-role="uct"]')].at(-1)
const logText = () => [...document.querySelectorAll('[data-testid="create-indicator-log"] li')].map((l) => l.textContent)
const panel = () => screen.getByTestId('create-indicator')

function mount({ key = createKey('s_b1'), converse = null, editRow = null, settings = mergeChartSettings({}) } = {}) {
  const spy = vi.fn(converse || scriptedConverse)
  const writes = []
  const previews = []
  const onClose = vi.fn()
  render(
    <CreateIndicatorPanel settings={settings} onChange={(n) => writes.push(n)} sym="AAPL" tf="D"
      onPreview={(inst, opts) => previews.push({ inst, opts })} onClose={onClose} converse={spy}
      sessionKey={key} editRow={editRow} />,
  )
  return { spy, writes, previews, onClose }
}
async function say(text) {
  fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
  await act(async () => {})
}
async function clickSave() {
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-save')) })
  await act(async () => {})
}
function reload() { cleanup(); _simulateReload() }

/** A stored EMA definition (as the store serves it), `version` given. */
function storedEma(version, id = 'u_0a1b2c3d4e5f') {
  const r = applyPatch(null, { contract: C, baseRevision: 0, ops: [{ op: 'create', name: 'EMA 20', placement: 'price',
    outputs: [{ key: 'value', label: 'EMA 20', tree: { type: 'call', name: 'ema', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 20 }] } }] }] }, { gateCtx: GATE })
  if (r.status !== 'applied') throw new Error(JSON.stringify(r.errors))
  return { ...r.definition, id, version }
}

/** The overnight calculator (member inputs), stored as version 1. */
function storedCalculator(id = 'u_0b1b2c3d4e5f') {
  const KEYS = ['account', 'riskPct', 'entry', 'stop']
  const P = (src) => parseFormula(src, { inputs: KEYS }).ast
  const r = applyPatch(null, { contract: C, baseRevision: 0, ops: [{ op: 'create', name: 'Position size', placement: 'price',
    inputs: [{ key: 'account', label: 'Account size', default: 0, min: 0 }, { key: 'riskPct', label: 'Risk %', default: 1, min: 0, max: 100, step: 0.25 },
      { key: 'entry', label: 'Entry price', default: 0, min: 0 }, { key: 'stop', label: 'Stop price', default: 0, min: 0 }],
    outputs: [{ key: 'shares', tree: P('floor(account * riskPct / 100 / abs(entry - stop))') }] }] }, { gateCtx: GATE })
  if (r.status !== 'applied') throw new Error(JSON.stringify(r.errors))
  return { ...r.definition, id, version: 1 }
}

beforeEach(() => { H.saves.length = 0; H.alert = { ok: true }; _resetSessions() })
afterEach(() => { cleanup(); registry.clearUserDefinitions(); _resetSessions() })

describe('1–3 · draft persistence and recovery', () => {
  it('1 ASKED create a draft over 3 turns (one a question), reload · CLAIMED the exact draft and transcript come back, marked recovered, preview drawn · DID (EXACT)', async () => {
    const key = createKey(chartScope('widget-7'))
    mount({ key })
    await say('Add a 20 EMA')
    await say('What does this indicator do?')
    await say('Make it 50')
    const before = { lines: logText(), tree: previewTree(), lineage: panel().dataset.lineage, revision: panel().dataset.revision }
    expect(before.tree).toContain('"value":50')

    reload()
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeFalsy()        // the page is gone
    const { spy } = mount({ key: createKey(chartScope('widget-7')) })        // same chart id → same key
    expect(screen.getByTestId('create-indicator-restored').dataset.recovered).toBe('true')
    expect(screen.getByTestId('create-indicator-restored').textContent).toMatch(/before the page reloaded/)
    expect(logText()).toEqual(before.lines)
    expect(panel().dataset.lineage).toBe(before.lineage)
    expect(panel().dataset.revision).toBe(before.revision)
    expect(previewTree()).toBe(before.tree)                                   // the same working definition draws
    expect(spy).not.toHaveBeenCalled()                                         // recovery is free
    expect(H.saves).toHaveLength(0)
    // …and it still works: undo walks back through the recovered history
    await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-undo')) })
    expect(previewTree()).toContain('"value":20')
  })

  it('1b ASKED an ANSWER-ONLY conversation, reload · CLAIMED it is not lost · DID', async () => {
    mount()
    await say('What does this indicator do?')
    const lines = logText()
    reload()
    mount()
    expect(logText()).toEqual(lines)
  })

  it('2 ASKED edit a stored definition (v2), reload, reopen v2 · CLAIMED the unsaved edit is recovered against the same base · DID', async () => {
    const def = storedEma(2)
    registry.installUserDefinitions([def])
    const editRow = { def_id: def.id, version: 2, definition: def }
    mount({ key: editKey(def.id), editRow })
    await say('Make it 50')
    expect(panel().dataset.dirty).toBe('true')
    reload()
    registry.installUserDefinitions([def])
    mount({ key: editKey(def.id), editRow })
    expect(panel().dataset.dirty).toBe('true')
    expect(screen.getByTestId('create-indicator-restored').dataset.recovered).toBe('true')
    expect(previewTree()).toContain('"value":50')
    expect(H.saves).toHaveLength(0)
  })

  it('3 ASKED the same edit draft, but the definition was saved elsewhere since (now v3) · CLAIMED NOT restored, the member is told, nothing newer is overwritten · DID (REFUSAL)', async () => {
    const v2 = storedEma(2)
    registry.installUserDefinitions([v2])
    mount({ key: editKey(v2.id), editRow: { def_id: v2.id, version: 2, definition: v2 } })
    await say('Make it 50')
    reload()
    const v3 = storedEma(3)
    registry.installUserDefinitions([v3])
    mount({ key: editKey(v3.id), editRow: { def_id: v3.id, version: 3, definition: v3 } })
    const note = screen.getByTestId('create-indicator-draft-dropped')
    expect(note.dataset.reason).toBe('stale')
    expect(note.textContent).toMatch(/version 2.*now version 3/)
    expect(screen.queryByTestId('create-indicator-restored')).toBeNull()
    expect(panel().dataset.dirty).toBe('false')                              // opened as v3 is
    expect(previewTree()).toContain('"value":20')
    expect(readSession(editKey(v3.id))).toBeNull()                            // the stale draft is gone
    expect(H.saves).toHaveLength(0)
  })

  it('3b ASKED malformed / unavailable storage · CLAIMED authoring starts clean and never throws · DID', async () => {
    sessionStorage.setItem(STORAGE_KEY, '{not json')
    mount()
    await say('Add a 20 EMA')
    expect(previewTree()).toContain('"value":20')
    cleanup()
    // a structurally wrong snapshot is refused, not opened
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, entries: [[createKey('s_b1'), { savedAt: Date.now(), snapshot: { state: { contract: 'nope' }, transcript: [] } }]] }))
    _simulateReload()
    mount()
    expect(screen.queryByTestId('create-indicator-restored')).toBeNull()
    cleanup()
    // storage that THROWS (blocked site data): still works, in memory
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const spySet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    try {
      _simulateReload()
      mount()
      await say('Add a 20 EMA')
      expect(previewTree()).toContain('"value":20')
    } finally { spy.mockRestore(); spySet.mockRestore() }
  })

  it('3c ASKED a persisted draft whose working definition the registry now refuses · CLAIMED dropped with a note, never drawn · DID', async () => {
    mount()
    await say('Add a 20 EMA')
    reload()
    const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY))
    raw.entries[0][1].snapshot.state.working.plots = 'broken'
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(raw))
    mount()
    expect(screen.getByTestId('create-indicator-draft-dropped').dataset.reason).toBe('invalid')
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeFalsy()
  })
})

describe('4–5 · visible save outcomes', () => {
  it('4 ASKED create + Add to Chart · CLAIMED one save, a COMPLETE receipt (saved + added) handed to the close · DID (EXACT)', async () => {
    const { onClose, writes } = mount()
    await say('Add a 20 EMA')
    await clickSave()
    expect(H.saves).toHaveLength(1)
    expect(writes).toHaveLength(1)
    const { receipt } = onClose.mock.calls[0][0]
    expect(receipt.status).toBe('complete')
    expect(receipt.items.map((i) => [i.kind, i.ok])).toEqual([['definition', true], ['chart', true]])
    expect(receipt.items[0].text).toBe('“EMA 20” is saved to your indicators.')
    expect(receipt.title).toBe('Indicator saved and added')
    expect(readSession(createKey('s_b1'))).toBeNull()                         // the draft ended
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('5 ASKED save with an alert the server REFUSES · CLAIMED saved AND the alert failure, status partial, never "complete" · DID (EXACT)', async () => {
    H.alert = { ok: false, error: 'You have reached your alert limit.' }
    let turn = 0
    const converse = async (args) => {
      turn += 1
      if (turn === 1) return scriptedConverse(args)
      return { ok: true, disposition: 'change', reply: '', turn: 'patch', notUnderstood: [], unavailable: [],
        envelope: { contract: C, baseRevision: args.state.revision, disposition: 'change',
          ops: [{ op: 'request_alert', output: 'value', triggerPolicy: 'becomes_true' }] } }
    }
    const { onClose } = mount({ converse })
    await say('Build an RSI overbought signal')
    await say('Alert me when it fires')
    await clickSave()
    expect(H.saves).toHaveLength(1)
    const { receipt } = onClose.mock.calls[0][0]
    expect(receipt.status).toBe('partial')
    expect(receipt.title).toBe('Saved — one step did not complete')
    const alert = receipt.items.find((i) => i.kind === 'alert')
    expect(alert.ok).toBe(false)
    expect(alert.text).toMatch(/^Alert when .* refused by the server — You have reached your alert limit\./)
    expect(alert.text).not.toMatch(/when value /)                             // named, not keyed
    expect(receipt.items.find((i) => i.kind === 'definition').ok).toBe(true)
  })

  it('5b ASKED the alert service THROWS (network) · CLAIMED still saved; the alert is the failed step · DID', async () => {
    const { createIndicatorAlert } = await import('../../../../hooks/useIndicatorAlerts')
    createIndicatorAlert.mockImplementationOnce(async () => { throw new Error('Failed to fetch') })
    let turn = 0
    const converse = async (args) => {
      turn += 1
      if (turn === 1) return scriptedConverse(args)
      return { ok: true, disposition: 'change', reply: '', turn: 'patch', notUnderstood: [], unavailable: [],
        envelope: { contract: C, baseRevision: args.state.revision, disposition: 'change',
          ops: [{ op: 'request_alert', output: 'value', triggerPolicy: 'becomes_true' }] } }
    }
    const { onClose } = mount({ converse })
    await say('Build an RSI overbought signal')
    await say('Alert me when it fires')
    await clickSave()
    const { receipt } = onClose.mock.calls[0][0]
    expect(receipt.status).toBe('partial')
    expect(receipt.items.find((i) => i.kind === 'alert')).toMatchObject({ ok: false })
  })

  it('4/5 ASKED the receipt card · CLAIMED complete = status (auto-fades), partial = alert that stays, each step marked · DID', () => {
    const onDismiss = vi.fn()
    const partial = { status: 'partial', title: 'Saved — one step did not complete', items: [
      { kind: 'definition', ok: true, text: '“RSI overbought” is saved to your indicators.' },
      { kind: 'alert', ok: false, text: 'Alert when RSI 14 > 70 becomes true: refused by the server — limit.' }] }
    render(<SaveReceipt receipt={partial} onDismiss={onDismiss} />)
    const card = screen.getByTestId('save-receipt')
    expect(card.getAttribute('role')).toBe('alert')
    expect([...card.querySelectorAll('li')].map((l) => l.dataset.ok)).toEqual(['true', 'false'])
    fireEvent.click(screen.getByTestId('save-receipt-dismiss'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    cleanup()
    vi.useFakeTimers()
    try {
      const done = vi.fn()
      render(<SaveReceipt receipt={{ status: 'complete', title: 'Changes saved', items: [{ kind: 'definition', ok: true, text: 'x' }] }} onDismiss={done} />)
      expect(screen.getByTestId('save-receipt').getAttribute('role')).toBe('status')
      act(() => { vi.advanceTimersByTime(6100) })
      expect(done).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
})

describe('6 · accurate edit previews', () => {
  it('6 ASKED edit the calculator: "Change my risk to 0.5%" while THIS chart holds 1% · CLAIMED the preview draws 0.5 BEFORE Save; nothing is written; Save writes 0.5 to this chart · DID (EXACT)', async () => {
    const def = storedCalculator()
    registry.installUserDefinitions([def])
    const inst = { instanceId: `inst:${def.id}:1`, defId: def.id, inputs: { account: 100000, riskPct: 1, entry: 50, stop: 48 } }
    const settings = mergeChartSettings({ indicatorInstances: [inst], indicators: { [def.id]: { enabled: true } } })
    const converse = async ({ state }) => ({ ok: true, disposition: 'change', reply: '', turn: 'patch', notUnderstood: [], unavailable: [],
      envelope: { contract: C, baseRevision: state.revision, disposition: 'change',
        ops: [{ op: 'set_input', input: { key: 'riskPct', label: 'Risk %', default: 0.5 } }] } })
    const { previews, writes, onClose } = mount({ key: editKey(def.id), editRow: { def_id: def.id, version: 1, definition: def }, settings, converse })
    const first = previews.filter((p) => p.inst).at(-1)
    expect(first.inst.inputs.riskPct).toBe(1)                                   // opened: the chart's own value
    await say('Change my risk percentage from 1% to 0.5%')
    const after = previews.filter((p) => p.inst).at(-1)
    expect(after.inst.inputs).toMatchObject({ account: 100000, riskPct: 0.5, entry: 50, stop: 48 })
    expect(after.opts).toEqual({ replaces: def.id })
    expect(writes).toHaveLength(0)
    expect(H.saves).toHaveLength(0)
    expect(registry.getDefinition(def.id).inputs.find((x) => x.key === 'riskPct').default).toBe(1)   // saved def untouched

    // 9 (edit) — UNDO restores the chart's own value in the preview, still nothing written
    await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-undo')) })
    expect(previews.filter((p) => p.inst).at(-1).inst.inputs.riskPct).toBe(1)
    expect(panel().dataset.dirty).toBe('false')
    await say('Change my risk percentage from 1% to 0.5%')
    await clickSave()
    const saved = writes.at(-1).indicatorInstances.find((i) => i.instanceId === inst.instanceId)
    expect(saved.inputs.riskPct).toBe(0.5)                                      // preview == save
    expect(onClose.mock.calls[0][0].receipt.status).toBe('complete')
  })
})

describe('7 · reliable conversational renaming', () => {
  it('7 ASKED EMA 20 → "Make it 50" → "Call it Swing Line" (turn 3) · CLAIMED renamed with NO model call, same lineage, one revision, one undo step · DID (EXACT)', async () => {
    const { spy } = mount()
    await say('Add a 20 EMA')
    await say('Make it 50')
    const lineage = panel().dataset.lineage
    const rev = Number(panel().dataset.revision)
    await say('Call it Swing Line')
    expect(spy).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('create-indicator-name').textContent).toBe('Swing Line')
    expect(lastUct().textContent).toMatch(/Renamed to “Swing Line”/)
    expect(panel().dataset.lineage).toBe(lineage)
    expect(Number(panel().dataset.revision)).toBe(rev + 1)
    expect(previewTree()).toContain('"value":50')                                // the maths is untouched
    await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-undo')) })
    expect(screen.getByTestId('create-indicator-name').textContent).not.toBe('Swing Line')
    expect(previewTree()).toContain('"value":50')
  })

  it('7b ASKED "Make it 21 and call it Trend Line" · CLAIMED BOTH applied in one turn (the name rides in the model\'s envelope) · DID', async () => {
    mount()
    await say('Add a 20 EMA')
    const rev = Number(panel().dataset.revision)
    await say('Make it 21 and call it Trend Line')
    expect(previewTree()).toContain('"value":21')
    expect(screen.getByTestId('create-indicator-name').textContent).toBe('Trend Line')
    expect(Number(panel().dataset.revision)).toBe(rev + 1)
  })

  it('7c ASKED a name, but the model renames to its own suggestion · CLAIMED the member\'s words win · DID', async () => {
    let turn = 0
    const converse = async (args) => {
      turn += 1
      if (turn === 1) return scriptedConverse(args)
      // the scripted model's own "make it 30", plus a rename to ITS suggestion
      const res = await scriptedConverse({ ...args, message: 'make it 30' })
      return { ...res, envelope: { ...res.envelope, ops: [...res.envelope.ops, { op: 'rename_definition', name: 'EMA 30' }] } }
    }
    mount({ converse })
    await say('Add a 20 EMA')
    await say('Make it 30 and call it Swing Line')
    expect(screen.getByTestId('create-indicator-name').textContent).toBe('Swing Line')
    expect(previewTree()).toContain('"value":30')
  })

  it('7d ASKED rename while EDITING a stored definition, then Save · CLAIMED the same stored id, version +1, the new name · DID', async () => {
    const def = storedEma(4)
    registry.installUserDefinitions([def])
    const settings = mergeChartSettings({ indicatorInstances: [{ instanceId: `inst:${def.id}:1`, defId: def.id, inputs: {} }], indicators: { [def.id]: { enabled: true } } })
    const { spy, onClose } = mount({ key: editKey(def.id), editRow: { def_id: def.id, version: 4, definition: def }, settings })
    await say('Rename it to Momentum Pulse')
    expect(spy).not.toHaveBeenCalled()
    await clickSave()
    expect(H.saves).toHaveLength(1)
    expect(H.saves[0].defId).toBe(def.id)
    expect(H.saves[0].doc).toMatchObject({ id: def.id, version: 5, meta: expect.objectContaining({ name: 'Momentum Pulse' }) })
    expect(onClose.mock.calls[0][0].receipt.items[0].text).toBe('“Momentum Pulse” is saved as version 5.')
  })
})

describe('8–9 · questions never mutate; cancel never touches the saved definition', () => {
  it('8 ASKED a question mid-edit · CLAIMED same preview, same revision, still clean, persisted transcript grows · DID', async () => {
    const def = storedEma(2)
    registry.installUserDefinitions([def])
    mount({ key: editKey(def.id), editRow: { def_id: def.id, version: 2, definition: def } })
    const tree = previewTree(); const rev = panel().dataset.revision
    await say('Why would someone use this?')
    expect(lastUct().dataset.kind).toBe('answer')
    expect(previewTree()).toBe(tree)
    expect(panel().dataset.revision).toBe(rev)
    expect(panel().dataset.dirty).toBe('false')
    expect(readSession(editKey(def.id)).transcript.some((t) => t.kind === 'answer')).toBe(true)
  })

  it('9 ASKED change then Discard an edit · CLAIMED no save, the stored definition is byte-identical, the draft is gone (memory and storage) · DID', async () => {
    const def = storedEma(2)
    registry.installUserDefinitions([def])
    const stored = JSON.stringify(registry.getDefinition(def.id))
    const { onClose } = mount({ key: editKey(def.id), editRow: { def_id: def.id, version: 2, definition: def } })
    await say('Make it 50')
    fireEvent.click(screen.getByTestId('create-indicator-cancel'))
    fireEvent.click(screen.getByTestId('create-indicator-discard-confirm'))
    expect(onClose).toHaveBeenCalled()
    expect(H.saves).toHaveLength(0)
    expect(JSON.stringify(registry.getDefinition(def.id))).toBe(stored)
    expect(readSession(editKey(def.id))).toBeNull()
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('choices: a clarify question keeps its choice buttons across an answer turn, and a change clears them', async () => {
    let turn = 0
    const converse = async (args) => {
      turn += 1
      if (turn === 1) return scriptedConverse(args)
      if (turn === 2) return { ok: true, disposition: 'clarify', reply: '', turn: 'question', notUnderstood: [], unavailable: [],
        envelope: { contract: C, baseRevision: args.state.revision, ops: [], disposition: 'clarify', questions: [{ id: 'q1', text: 'Shorter or longer?', choices: ['Make it 10', 'Make it 50'] }] } }
      return scriptedConverse(args)
    }
    mount({ converse })
    await say('Add a 20 EMA')
    await say('change the length')
    expect(screen.getByTestId('create-indicator-choices').textContent).toMatch(/Make it 50/)
    await say('What does this indicator do?')
    expect(lastUct().dataset.kind).toBe('answer')
    expect(screen.getByTestId('create-indicator-choices').textContent).toMatch(/Make it 50/)   // kept
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make it 50' })) })
    await act(async () => {})
    expect(previewTree()).toContain('"value":50')
    expect(screen.queryByTestId('create-indicator-choices')).toBeNull()                         // answered by a change
  })
})
