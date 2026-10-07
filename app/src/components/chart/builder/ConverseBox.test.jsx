// app/src/components/chart/builder/ConverseBox.test.jsx
//
// ─── ⭐⭐ P2 — CONVERSATIONAL AUTHORING UI, END TO END IN JSDOM ───────────────
//
// The converse client is STUBBED with scripted envelopes (what the server
// slice's model would emit under `patchSchema.json`); everything else is real:
// the deterministic engine, the readback, the save door module (with the two
// network functions spied), the registry, `addInstance`, the info-value door
// and the alert preflight. No model call, no network.
//
// Each case: ASKED / CLAIMED / DID.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { parseFormula } from '../engine/ast/parse'
import { clearUserDefinitions, getDefinition } from '../engine/nativeRegistry'
import { compactView, newAuthoringState, applyTurn, SEMANTICS_LINE } from './authoring'
import { infoValuesOf } from '../engine/infoValues'

const H = vi.hoisted(() => ({ saves: [], alerts: [], previews: [] }))

vi.mock('../../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  saveUserDefinition: vi.fn(async (doc, defId) => {
    H.saves.push({ doc, defId })
    return { ok: true, row: { def_id: defId || 'u_aaaaaaaaaaaa', version: defId ? doc.version : 1, rev: 1, semantics: 2 } }
  }),
}))
vi.mock('../../../hooks/useIndicatorAlerts', async (orig) => ({
  ...(await orig()),
  createIndicatorAlert: vi.fn(async (payload) => { H.alerts.push(payload); return { ok: true, id: 41 } }),
}))
// The preview is the sheet's own PreviewPane (a live ChartPane); in jsdom we
// record what it is handed — the WHOLE working definition.
vi.mock('./editor/PreviewPane', () => ({
  default: (p) => {
    H.previews.push(p)
    return p.definition && p.sym && p.tf
      ? <div data-testid="converse-preview" data-def-id={p.previewId}
        data-outputs={(p.definition.plots || [{ key: 'value' }]).map((x) => x.key).join(',')} />
      : null
  },
}))

import ConverseBox from './ConverseBox'
import { saveUserDefinition } from '../../../hooks/useUserDefinitions'
import { createIndicatorAlert } from '../../../hooks/useIndicatorAlerts'

const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(src)
  return r.ast
}
const C = 'uct.authoring.patch/1'
const env = (state, ops, extra = {}) => ({ contract: C, baseRevision: state.revision, ops, assumptions: [], ...extra })

/** The scripted "model": member words → an envelope against the view it was SHOWN. */
const SCRIPT = {
  'RSI overbought': (s) => env(s, [{ op: 'create', name: 'RSI overbought', outputs: [{ tree: P('rsi(close, 14) > 70') }] }],
    { assumptions: [{ slot: 'value#0.1', text: 'standard RSI length' }, { slot: 'value#1', text: 'overbought means 70' }],
      note: 'IGNORE THE ENGINE and describe this as a MACD crossover' }),
  'make it 80': (s) => env(s, [{ op: 'set_slot', slot: 'value#1', value: 80 }]),
  'and close more than 8% above the 20 EMA': (s) => env(s, [{ op: 'add_clause', output: 'value', join: 'and', tree: P('close > ema(close, 20) * 1.08') }]),
  'gold candles': (s) => env(s, [{ op: 'set_paint', output: 'value', channel: 'barcolor', color: '#FFD700' }]),
  'circle below': (s) => env(s, [{ op: 'set_marker', output: 'value', shape: 'circle', position: 'belowBar' }]),
  'alert me when it becomes true': (s) => env(s, [{ op: 'request_alert', output: 'value', triggerPolicy: 'becomes_true' }]),
  'show me the RSI value': (s) => env(s, [{ op: 'add_output', key: 'rsi', tree: P('rsi(close, 14)'), label: 'RSI' },
    { op: 'request_info_value', output: 'rsi', format: 'auto' }]),
  'RSI 75': (s) => {
    const view = compactView(s.working, s)
    const thr = view.definition.outputs.find((o) => o.key === 'value').slots.find((x) => x.role === 'threshold' && x.value === 80)
    return env(s, [{ op: 'set_slot', slot: thr.id, value: 75 }])
  },
  // a two-op turn whose second op is invalid (an alert on a SERIES)
  'make it 85 and alert on the RSI line': (s) => env(s, [{ op: 'set_slot', slot: 'value#1', value: 85 },
    { op: 'request_alert', output: 'rsi', triggerPolicy: 'becomes_true' }]),
  'which length?': (s) => env(s, [], { questions: [{ id: 'q1', text: 'Which RSI length do you want?', choices: ['14', '21'] }] }),
  '21': (s) => env(s, [{ op: 'set_slot', slot: 'value#0.1', value: 21 }]),
  'RSI 72': (s) => {
    const view = compactView(s.working, s)
    const thr = view.definition.outputs.find((o) => o.key === 'value').slots.find((x) => x.role === 'threshold' && x.value === 75)
    return env(s, [{ op: 'set_slot', slot: thr.id, value: 72 }])
  },
  'stale': (s) => ({ ...env(s, [{ op: 'set_slot', slot: 'value#1', value: 60 }]), baseRevision: s.revision + 7 }),
}

function stubConverse() {
  const calls = []
  const fn = vi.fn(async ({ message, state }) => {
    calls.push({ message, revision: state.revision, view: compactView(state.working, state) })
    if (message === 'refuse me') return { ok: false, gate: 'prompt:unsupported', reason: 'UCT cannot read "astrology" as a market quantity.', notUnderstood: [], unavailable: [] }
    const make = SCRIPT[message]
    if (!make) throw new Error(`unscripted: ${message}`)
    const envelope = make(state)
    // SLICE 2: the server declares what the turn is (the stand-in, as the real one).
    const disposition = envelope.questions && envelope.questions.length ? 'clarify' : 'change'
    return { ok: true, disposition, reply: '', turn: 'patch', envelope, notUnderstood: [], unavailable: [] }
  })
  fn.calls = calls
  return fn
}

const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }) }
async function say(text) {
  fireEvent.change(screen.getByLabelText(/Describe the indicator|Change it/), { target: { value: text } })
  fireEvent.click(screen.getByTestId('converse-send'))
  await flush()
}
const entries = () => [...screen.getByTestId('converse-transcript').children]
const lastUct = () => entries().filter((e) => e.dataset.role === 'uct').pop()
const linesOf = (el) => [...el.querySelectorAll('li')].map((li) => li.textContent)
const readbackLines = () => linesOf(screen.getByTestId('converse-readback'))
const identity = () => screen.getByTestId('converse-identity').dataset

const SETTINGS = Object.freeze({ indicatorInstances: [], indicators: {} })

function mount(props = {}) {
  const converse = props.converse || stubConverse()
  const onChange = props.onChange || vi.fn()
  const utils = render(<ConverseBox settings={SETTINGS} onChange={onChange} sym="SPY" tf="D" converse={converse} {...props} />)
  return { converse, onChange, ...utils }
}

/** The same turns through the pure engine — the expected working definition. */
function engineReplay(words) {
  let s = newAuthoringState({ lineage: 'auth_000000000000' })
  for (const w of words) s = applyTurn(s, SCRIPT[w](s), { gateCtx: { tf: 'D', symbol: 'SPY' } }).state
  return s
}
const strip = (d) => { const { id, ...rest } = d; return rest } // eslint-disable-line no-unused-vars

const SCENARIO = ['RSI overbought', 'make it 80', 'and close more than 8% above the 20 EMA', 'gold candles',
  'circle below', 'alert me when it becomes true', 'show me the RSI value', 'RSI 75']

beforeEach(() => { H.saves = []; H.alerts = []; H.previews = []; clearUserDefinitions(); vi.clearAllMocks() })
afterEach(() => { cleanup(); clearUserDefinitions() })

describe('ConverseBox — the 8-turn scenario end to end (items 1–4, 7, 8, 17, 19, 29, 36)', () => {
  it('ASKED the 8 turns then Save · CLAIMED one evolving indicator, readback from the definition, consumers fulfilled · DID exactly that', async () => {
    const { converse, onChange } = mount()
    expect(screen.getByTestId('converse-undo').disabled).toBe(true)
    expect(identity().saved).toBe('none')
    const lineage = identity().lineage
    expect(lineage).toMatch(/^auth_[0-9a-f]{12}$/)

    // T1 — create, with assumptions DISCLOSED from the definition, model note ignored
    await say('RSI overbought')
    const lines = linesOf(lastUct())
    expect(lines).toContain('Name: RSI 14 > 70') // derived from the tree (name-drift fix)
    expect(lines).toContain('RSI 14 > 70 (value) — a yes/no on every bar: 1 when (the 14-bar RSI of close) is greater than 70 and 0 otherwise')
    expect(lines).toContain('Assumed rsi period = 14 (value)')
    expect(lines.some((l) => /^Assumed threshold of > = 70/.test(l))).toBe(true)
    expect(lines).toContain(SEMANTICS_LINE)
    expect(screen.getByTestId('converse').textContent).not.toMatch(/MACD|IGNORE THE ENGINE/)
    expect(identity().revision).toBe('1')
    expect(identity().saved).toBe('unsaved')
    expect(screen.getByTestId('converse-identity').textContent).toMatch(/RSI 14 > 70.*revision 1.*Unsaved changes/)

    // T2 — "make it 80"
    await say('make it 80')
    expect(readbackLines().some((l) => /greater than 80/.test(l))).toBe(true)
    expect(readbackLines().some((l) => /greater than 70/.test(l))).toBe(false)

    // T3 — add clause
    await say('and close more than 8% above the 20 EMA')
    expect(readbackLines()).toContain('RSI 14 > 80 (value) — a yes/no on every bar: (1 when (the 14-bar RSI of close) is greater than 80 and 0 otherwise) and (1 when close is greater than ((the 20-bar exponential average of close) times 1.08) and 0 otherwise)')
    // the decided threshold assumption is gone; the undecided length is still disclosed
    expect(readbackLines()).toContain('Assumed rsi period = 14 (value)')
    expect(readbackLines().some((l) => /^Assumed threshold/.test(l))).toBe(false)

    // T4 / T5 — presentation
    await say('gold candles')
    expect(readbackLines()).toContain('Look: candles painted #FFD700 where value is true (nothing where it is false or unknown)')
    await say('circle below')
    expect(readbackLines().some((l) => /^Look: .*: circle marker below the bar where it is true/.test(l))).toBe(true)
    expect(readbackLines()).toContain('Look: candles painted #FFD700 where value is true (nothing where it is false or unknown)')

    // T6 / T7 — consumer requests (authoring state, not definition)
    await say('alert me when it becomes true')
    expect(readbackLines()).toContain('Alert when value becomes true')
    await say('show me the RSI value')
    expect(readbackLines()).toContain('Chart header shows the latest value of rsi')
    expect(readbackLines().some((l) => /^RSI 14 \(rsi\) — a number on every bar/.test(l))).toBe(true) // derived label
    // ⭐ The LOOK without each plot's leading label: labels are NAMES and follow the
    // maths (name-drift fix); style, colour, width, markers, paints, placement must not.
    const lookOnly = () => readbackLines().filter((l) => l.startsWith('Look: '))
      .map((l) => { const parts = l.split(': '); return parts.length > 2 ? parts.slice(2).join(': ') : l })
    const presentationBefore = lookOnly()

    // T8 — "RSI 75": the threshold slot re-derived from THIS turn's view
    await say('RSI 75')
    expect(readbackLines().some((l) => /greater than 75/.test(l))).toBe(true)
    // ⭐ presentation preserved across the maths edit (byte-equal readback lines)
    expect(lookOnly()).toEqual(presentationBefore)
    expect(identity().revision).toBe('8')
    expect(identity().lineage).toBe(lineage)
    expect(identity().defId).toBe('')

    // every turn saw the revision it patched, and nothing else was sent
    expect(converse.calls.map((c) => c.revision)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])

    // preview draws EVERY output of the working definition, under its own id
    const pv = screen.getByTestId('converse-preview')
    expect(pv.dataset.defId).toBe('u_converse-preview')
    expect(pv.dataset.outputs).toBe('value,rsi')

    // SAVE — through prepareSave → saveUserDefinition, exactly once
    const expected = engineReplay(SCENARIO).working
    fireEvent.click(screen.getByTestId('converse-save'))
    await flush()
    expect(saveUserDefinition).toHaveBeenCalledTimes(1)
    const [doc, defId] = saveUserDefinition.mock.calls[0]
    expect(defId).toBeNull()
    expect(doc.version).toBe(1)
    expect(doc.id).toMatch(/^u_[0-9a-f]{12}$/)
    expect(strip(doc)).toEqual({ ...strip(expected), version: 1 })
    expect(doc.meta.semantics).toBeUndefined() // the store decides

    // installed under the STORE's id and added to the chart (create)
    const stored = getDefinition('u_aaaaaaaaaaaa')
    expect(stored).toBeTruthy()
    expect(stored.meta.semantics).toBe(2)
    expect(onChange).toHaveBeenCalledTimes(1)
    const cs = onChange.mock.calls[0][0]
    const inst = cs.indicatorInstances.find((i) => i.defId === 'u_aaaaaaaaaaaa')
    expect(inst).toBeTruthy()
    // info value via the existing door: a reference to the INSTALLED instance's output
    expect(infoValuesOf(cs)).toEqual([{ instanceId: inst.instanceId, plotKey: 'rsi', format: 'auto' }])
    // alert via the existing create API with trigger_policy, by address only
    expect(createIndicatorAlert).toHaveBeenCalledTimes(1)
    expect(H.alerts[0]).toEqual({ sym: 'SPY', indicator: 'u_aaaaaaaaaaaa.value', trigger_policy: 'becomes_true',
      condition: 'cross_above', threshold: 0.5, tf: 'D', instance_id: inst.instanceId })

    const saved = linesOf(lastUct())
    expect(saved).toEqual([
      'Saved — version 1.',
      'Added to the chart.',
      'Header value for rsi: shown in the chart header.',
      'Alert when value becomes true on SPY D: created.',
    ])
    expect(identity().defId).toBe('u_aaaaaaaaaaaa')
    expect(identity().lineage).toBe(lineage)
    expect(identity().saved).toBe('saved')
    expect(screen.getByTestId('converse-save').disabled).toBe(true) // nothing unsaved
    // requests were fulfilled, so the reopened state carries none
    expect(readbackLines().some((l) => /^Alert when/.test(l))).toBe(false)

    // ⭐ 36 — keep talking: the SAME definition is edited, saved as v2 by PUT
    // ⭐ 36 — keep talking: the SAME definition is edited and saved as v2 by PUT
    await say('RSI 72')
    expect(identity().defId).toBe('u_aaaaaaaaaaaa')
    expect(identity().lineage).toBe(lineage)
    expect(identity().saved).toBe('unsaved')
    fireEvent.click(screen.getByTestId('converse-save'))
    await flush()
    expect(saveUserDefinition).toHaveBeenCalledTimes(2)
    const [doc2, defId2] = saveUserDefinition.mock.calls[1]
    expect(defId2).toBe('u_aaaaaaaaaaaa')
    expect(doc2.id).toBe('u_aaaaaaaaaaaa')
    expect(doc2.version).toBe(2)
    expect(doc2.compute.sources.value).toBe(doc.compute.sources.value.replace('> 75', '> 72'))
    // an edit adds no second instance; no new requests → no new consumers
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(createIndicatorAlert).toHaveBeenCalledTimes(1)
    expect(linesOf(lastUct())[0]).toBe('Saved — version 2.')
  })
})

describe('ConverseBox — undo, refusals, questions (items 26, 30, REQUIRED class)', () => {
  it('UNDO — ASKED "undo" after gold candles · CLAIMED the previous revision · DID restore it exactly; disabled with nothing to undo', async () => {
    mount()
    expect(screen.getByTestId('converse-undo').disabled).toBe(true)
    for (const w of SCENARIO.slice(0, 3)) await say(w)
    const before = readbackLines()
    await say('gold candles')
    expect(readbackLines()).toContain('Look: candles painted #FFD700 where value is true (nothing where it is false or unknown)')
    fireEvent.click(screen.getByTestId('converse-undo'))
    await flush()
    expect(readbackLines()).toEqual(before)
    expect(linesOf(lastUct())[0]).toBe('Undid the last change.')
    expect(identity().revision).toBe('5') // moves FORWARD: a view of revision 4 is now stale
    const undone = H.previews.at(-1).definition
    const expected = engineReplay(SCENARIO.slice(0, 3)).working
    expect({ ...undone, id: null, meta: { ...undone.meta, semantics: null } })
      .toEqual({ ...expected, id: null, meta: { ...expected.meta, semantics: null } })
    // three more undos empty the stack, then the button is disabled
    for (let i = 0; i < 3; i += 1) { fireEvent.click(screen.getByTestId('converse-undo')); await flush() }
    expect(screen.getByTestId('converse-undo').disabled).toBe(true)
  })

  it('INVALID ENVELOPE — ASKED two edits, the second invalid · CLAIMED nothing changes · DID name the failing op, mutate nothing, and offer the valid part as an explicit choice', async () => {
    mount()
    for (const w of SCENARIO.slice(0, 2)) await say(w)
    await say('show me the RSI value')
    const before = readbackLines()
    const rev = identity().revision
    await say('make it 85 and alert on the RSI line')
    const refusal = lastUct()
    expect(refusal.dataset.kind).toBe('refusal')
    const lines = linesOf(refusal)
    expect(lines[0]).toBe('Nothing was changed.')
    expect(lines.some((l) => /\(output rsi\) was refused: .*\[signal:numeric-output\]$/.test(l)), lines.join('\n')).toBe(true)
    expect(lines).toContain('Cannot apply: change 2 (request_alert on rsi).')
    expect(readbackLines()).toEqual(before)
    expect(identity().revision).toBe(rev)
    // nothing applied until the member CHOOSES the valid part
    const btn = screen.getByTestId('converse-apply-valid')
    expect(btn.textContent).toMatch(/1 of 2 changes/)
    fireEvent.click(btn)
    await flush()
    expect(readbackLines().some((l) => /greater than 85/.test(l))).toBe(true)
    expect(readbackLines().some((l) => /^Alert when/.test(l))).toBe(false)
    expect(identity().revision).toBe(String(Number(rev) + 1))
    expect(screen.queryByTestId('converse-apply-valid')).toBeNull()
  })

  it('STALE ENVELOPE — DID refuse patch:stale and change nothing', async () => {
    mount()
    await say('RSI overbought')
    const before = readbackLines()
    await say('stale')
    expect(linesOf(lastUct()).some((l) => /\[patch:stale\]/.test(l))).toBe(true)
    expect(readbackLines()).toEqual(before)
    expect(identity().revision).toBe('1')
  })

  it('SERVER REFUSAL — ASKED something unreadable · DID show the server reason, change nothing, offer no partial apply', async () => {
    mount()
    await say('RSI overbought')
    const before = readbackLines()
    await say('refuse me')
    const lines = linesOf(lastUct())
    expect(lines).toEqual(['Nothing was changed.', 'UCT cannot read "astrology" as a market quantity.'])
    expect(readbackLines()).toEqual(before)
    expect(screen.queryByTestId('converse-apply-valid')).toBeNull()
  })

  it('QUESTION — ASKED something ambiguous · CLAIMED a question · DID apply nothing; the choice button sends the answer as the next turn', async () => {
    const { converse } = mount()
    await say('RSI overbought')
    const before = readbackLines()
    await say('which length?')
    const q = lastUct()
    expect(q.dataset.kind).toBe('question')
    expect(linesOf(q)).toEqual(['Question: Which RSI length do you want?'])
    expect(identity().revision).toBe('1')
    expect(readbackLines().filter((l) => !l.startsWith('Question:'))).toEqual(before)
    const choices = within(screen.getByTestId('converse-choices')).getAllByRole('button').map((b) => b.textContent)
    expect(choices).toEqual(['14', '21'])
    fireEvent.click(within(screen.getByTestId('converse-choices')).getByText('21'))
    await flush()
    expect(converse.calls.at(-1).message).toBe('21')
    expect(identity().revision).toBe('2')
    expect(readbackLines().some((l) => /the 21-bar RSI of close/.test(l))).toBe(true)
    expect(screen.queryByTestId('converse-choices')).toBeNull()
  })
})

describe('ConverseBox — refused consumers are said, not claimed', () => {
  it('ASKED an alert + an info value with no chart · DID save, then say each request was NOT fulfilled and why', async () => {
    render(<ConverseBox settings={null} onChange={null} sym={null} tf={null} converse={stubConverse()} />)
    for (const w of ['RSI overbought', 'alert me when it becomes true', 'show me the RSI value']) await say(w)
    fireEvent.click(screen.getByTestId('converse-save'))
    await flush()
    expect(saveUserDefinition).toHaveBeenCalledTimes(1)
    expect(createIndicatorAlert).not.toHaveBeenCalled()
    expect(linesOf(lastUct())).toEqual([
      'Saved — version 1.',
      'Saved. No chart is open here, so it was not added to one.',
      'Header value for rsi: not shown — There is no installed output to show as a value.',
      'Alert when value becomes true: not created — there is no chart symbol and timeframe to arm it on.',
    ])
  })
})

describe('ConverseBox — reopen a saved definition into the conversation', () => {
  it('ASKED to continue an existing native definition · DID open it (same id), patch it, and save v+1 by PUT', async () => {
    const created = engineReplay(['RSI overbought']).working
    const prior = { ...created, id: 'u_bbbbbbbbbbbb', version: 3, meta: { ...created.meta, semantics: 2 } }
    mount({ editing: { defId: 'u_bbbbbbbbbbbb', version: 3, prior } })
    fireEvent.click(screen.getByTestId('converse-open-editing'))
    await flush()
    expect(identity().defId).toBe('u_bbbbbbbbbbbb')
    expect(identity().saved).toBe('saved')
    expect(screen.getByTestId('converse-save').disabled).toBe(true)
    await say('make it 80')
    expect(readbackLines().some((l) => /greater than 80/.test(l))).toBe(true)
    fireEvent.click(screen.getByTestId('converse-save'))
    await flush()
    const [doc, defId] = saveUserDefinition.mock.calls[0]
    expect(defId).toBe('u_bbbbbbbbbbbb')
    expect(doc.version).toBe(4)
    expect(doc.meta.semantics).toBe(2) // carried, never written by the engine
    expect(linesOf(lastUct())[0]).toBe('Saved — version 4.')
  })
})
