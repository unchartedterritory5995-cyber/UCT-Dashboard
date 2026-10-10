// app/src/components/chart/builder/repaintWarning.test.js — S6 repaint-warning remediation
//
// ⛔ S6 (2026-10-10): `pivothigh(high, 5, 5)` was acknowledged as "reads a bar ahead". The warning
// must state the window the ENGINE measured (`lintRepaint().forward`), from ONE builder
// (`authoring/repaintWarning.js`), on every surface: the readback line (= the Agent's `ackText`),
// the save refusal, the member's save error, and the approval-bound Save. Real engine, real draft
// store, real save path; only the model reply and the server are stand-ins.
import { describe, it, expect, beforeEach } from 'vitest'
import { readback } from './authoring'
import { lintRepaint, lintDefinition } from '../engine/ast/lint'
import { ackSentence, ackCheckboxText, ackRequiredText, barsAhead, repaintWarningItems } from './authoring/repaintWarning'
import { memberSaveError } from './authoring/memberWords'
import { storeConversation } from './conversationSave'
import { _simulateReload, STORAGE_KEY, readSession } from './authoring/conversationSessions'
import { AUTHORING_REASONS as R, openDraft, draftTurn, draftStatus, saveDraft } from './agentAuthoring'

const PATCH = 'uct.authoring.patch/1'
const series = (name) => ({ type: 'series', name })
const call = (name, ...args) => ({ type: 'call', name, args })
const num = (value) => ({ type: 'num', value })
const pivotHigh = (l, r) => call('pivothigh', series('high'), num(l), num(r))
const pivotLow = (l, r) => call('pivotlow', series('low'), num(l), num(r))
const ema20 = call('ema', series('close'), num(20))

/** A model that creates ONE indicator with the given outputs. */
const creating = (name, outputs) => async ({ state }) => ({ ok: true, disposition: 'change', turn: 'patch', reply: '',
  envelope: { contract: PATCH, baseRevision: state.revision, assumptions: [], disposition: 'change',
    ops: [{ op: 'create', name, placement: 'price', outputs }] } })

let stored, server
const fakeSave = async (doc, defId, _x, opts) => {
  const id = defId || 'u_aaaaaaaa5e6a'
  const version = defId ? (opts?.baseVersion || 0) + 1 : 1
  const row = { def_id: id, version, rev: 1 }
  server.set(id, { ...row, definition: { ...doc, id, version } })
  stored.push({ doc, defId, opts })
  return { ok: true, row }
}
const ctxOf = (over = {}) => ({
  canAuthor: true, sym: 'SPY', tf: 'D', definitionRows: [...server.values()],
  store: (s, o) => storeConversation(s, { ...o, save: fakeSave }),
  readBack: async (id) => server.get(id) || null,
  ...over,
})
async function drafted(name, outputs) {
  const ref = openDraft({ create: true, chartRef: 'w-spy' }, ctxOf()).draftRef
  const t = await draftTurn(ref, `build ${name}`, { expectedRevision: 0 }, ctxOf({ converse: creating(name, outputs) }))
  expect(t.ok, JSON.stringify(t)).toBe(true)
  return ref
}

beforeEach(() => {
  stored = []; server = new Map()
  _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
})

describe('the shared builder — words from a measured window, never a guessed one', () => {
  it('counts bars; anything that is not a whole positive window is said without a count', () => {
    expect([barsAhead(5), barsAhead(1), barsAhead(0), barsAhead('unbounded'), barsAhead('unknown'), barsAhead(2.5)])
      .toEqual([5, 1, null, null, null, null])
    expect(ackSentence('PH', 5)).toBe('PH reads 5 bars ahead, so its latest 5 values can change until 5 more bars close — confirm below before saving')
    expect(ackSentence('PH', 1)).toBe('PH reads 1 bar ahead, so its latest value can change until the next bar closes — confirm below before saving')
    expect(ackSentence('PH', 'unbounded')).not.toMatch(/\d/)
    expect(ackSentence('PH', 'unbounded')).toMatch(/confirm below before saving$/)
    // the forming-period sentence is unchanged, byte for byte
    expect(ackSentence('Weekly', null, true)).toBe('Weekly reads the period still forming (so far this week or month), so it changes until that period closes — it repaints; confirm below before saving')
  })
  it('the checkbox and the refusal list each output with its own window', () => {
    const items = repaintWarningItems([{ key: 'a', name: 'PH', forward: 5 }, { key: 'b', name: 'PL', forward: 1 }], ['a', 'b'])
    expect(ackCheckboxText(items)).toBe("I understand PH isn't final until 5 more bars close; PL isn't final until the next bar closes.")
    expect(ackRequiredText(items)).toBe("Tick the confirmation box first — PH isn't final until 5 more bars close; PL isn't final until the next bar closes.")
    expect(ackCheckboxText([])).toBe('')
  })
})

describe('⭐ the readback states the ENGINE’s window (lintRepaint.forward), per output', () => {
  it('pivothigh(high, 5, 5) → 5 bars (the S6 case)', async () => {
    expect(lintRepaint(pivotHigh(5, 5)).forward).toBe(5)
    const ref = await drafted('Pivots', [{ key: 'ph', label: 'Pivot high', tree: pivotHigh(5, 5) }])
    const st = draftStatus(ref, ctxOf())
    expect(st.needsAck).toEqual(['ph'])
    const name = st.readback.outputs.find((o) => o.key === 'ph').name
    expect(st.ackText).toEqual([`${name} reads 5 bars ahead, so its latest 5 values can change until 5 more bars close — confirm below before saving`])
    expect(st.ackText.join(' ')).not.toMatch(/a bar ahead/)
  })
  it('pivothigh(high, 5, 1) → 1 bar', async () => {
    expect(lintRepaint(pivotHigh(5, 1)).forward).toBe(1)
    const ref = await drafted('Quick pivot', [{ key: 'ph', label: 'Quick pivot', tree: pivotHigh(5, 1) }])
    const st = draftStatus(ref, ctxOf())
    const name = st.readback.outputs.find((o) => o.key === 'ph').name
    expect(st.ackText).toEqual([`${name} reads 1 bar ahead, so its latest value can change until the next bar closes — confirm below before saving`])
  })
  it('mixed outputs: each repainting output its own window, in output order; the clean one says nothing', async () => {
    const ref = await drafted('Mixed', [
      { key: 'ph', label: 'Swing high', tree: pivotHigh(5, 5) },
      { key: 'avg', label: 'EMA 20', tree: ema20 },
      { key: 'pl', label: 'Swing low', tree: pivotLow(3, 1) },
    ])
    const st = draftStatus(ref, ctxOf())
    expect(st.needsAck).toEqual(['ph', 'pl'])
    const nameOf = (k) => st.readback.outputs.find((o) => o.key === k).name
    expect(st.ackText).toEqual([
      `${nameOf('ph')} reads 5 bars ahead, so its latest 5 values can change until 5 more bars close — confirm below before saving`,
      `${nameOf('pl')} reads 1 bar ahead, so its latest value can change until the next bar closes — confirm below before saving`,
    ])
    expect(st.ackText.join(' ')).not.toContain(nameOf('avg'))
    // every count is the engine's own measurement of THAT output's tree
    const rb = st.readback
    for (const a of rb.ack) {
      const out = rb.outputs.find((o) => o.key === a.key)
      expect(a.forward).toBe(out.forward)
    }
  })
  it('a window carried through other maths is still the measured one (sma of a 4-bar pivot)', async () => {
    const tree = call('sma', pivotHigh(4, 4), num(3))
    const measured = lintRepaint(tree).forward
    expect(barsAhead(measured)).toBeGreaterThanOrEqual(4)
    const ref = await drafted('Smoothed pivot', [{ key: 'sp', label: 'Smoothed pivot', tree }])
    const st = draftStatus(ref, ctxOf())
    expect(st.ackText).toEqual([ackSentence(st.readback.outputs[0].name, measured)])
  })
  it('non-repainting formulas: no acknowledgement anywhere, Save needs none', async () => {
    const ref = await drafted('EMA 20', [{ key: 'e', label: 'EMA 20', tree: ema20 }])
    const st = draftStatus(ref, ctxOf())
    expect(st.needsAck).toEqual([])
    expect(st.ackText).toEqual([])
    expect(st.lines.join(' ')).not.toMatch(/confirm below before saving/)
    expect((await saveDraft(ref, { expectedRevision: 1 }, ctxOf())).ok).toBe(true)
    expect(stored[0].opts?.previewAcked).toBeFalsy()
  })
})

describe('⭐ one warning across draft → approval → save → persisted metadata', () => {
  it('the status, the proposal binding, the refusal, the member error and the stored badge agree', async () => {
    const ref = await drafted('Pivots', [{ key: 'ph', label: 'Pivot high', tree: pivotHigh(5, 5) }])
    const st = draftStatus(ref, ctxOf())
    // the readback line IS the ackText (one source), and the summary carries it verbatim
    expect(st.lines).toEqual(expect.arrayContaining(st.ackText))
    // an unacknowledged save: needs-ack with the SAME sentences
    expect(await saveDraft(ref, { expectedRevision: 1 }, ctxOf())).toMatchObject({ ok: false, reason: R.NEEDS_ACK, detail: { ackText: st.ackText } })
    // the conversation save door's refusal and the member's words name the same window
    const refused = await storeConversation(readSession(ref.key).state, { save: fakeSave })
    expect(refused).toMatchObject({ ok: false, stage: 'ack' })
    const name = st.readback.outputs.find((o) => o.key === 'ph').name
    expect(refused.error).toBe(`Tick the confirmation box first — ${name} isn't final until 5 more bars close.`)
    expect(memberSaveError(refused).text).toBe(refused.error)
    // approval-bound (F6): the shown sentences must be the current ones
    expect(await saveDraft(ref, { expectedRevision: 1, acknowledged: true, ackText: ['Pivot high reads a bar ahead, so it can change until that bar closes — confirm below before saving'] }, ctxOf()))
      .toMatchObject({ ok: false, reason: R.NEEDS_ACK, detail: { ackText: st.ackText, changed: true } })
    expect(stored).toHaveLength(0)
    const saved = await saveDraft(ref, { expectedRevision: 1, acknowledged: true, ackText: st.ackText.slice() }, ctxOf())
    expect(saved.ok, JSON.stringify(saved)).toBe(true)
    expect(stored).toHaveLength(1)
    expect(stored[0].opts).toMatchObject({ previewAcked: true })
    // the persisted document: the badge the server stores is measured from the SAME trees,
    // and its per-plot window is the one the member acknowledged
    const doc = stored[0].doc
    const rows = lintDefinition(doc).plots.filter((p) => p.mode === 'preview-repaints')
    expect(rows.map((p) => p.forward)).toEqual([5])
    expect(doc.meta.repaint).toBe('preview-repaints')
  })
  it('omitting ackText keeps today’s behaviour (contract /1 stays compatible)', async () => {
    const ref = await drafted('Pivots', [{ key: 'ph', label: 'Pivot high', tree: pivotHigh(5, 5) }])
    expect((await saveDraft(ref, { expectedRevision: 1, acknowledged: true }, ctxOf())).ok).toBe(true)
  })
  it('a clean draft: an approval that showed no warning still saves; one that showed a warning does not', async () => {
    const ref = await drafted('EMA 20', [{ key: 'e', label: 'EMA 20', tree: ema20 }])
    expect(await saveDraft(ref, { expectedRevision: 1, ackText: ['x — confirm below before saving'] }, ctxOf()))
      .toMatchObject({ ok: false, reason: R.NEEDS_ACK, detail: { ackText: [], changed: true } })
    expect((await saveDraft(ref, { expectedRevision: 1, ackText: [] }, ctxOf())).ok).toBe(true)
  })
})

describe('readback() direct — the field every surface reads', () => {
  it('exposes ack items next to needsAck, and an empty list for nothing / a refused draft', () => {
    expect(readback(null).ack).toEqual([])
  })
})
