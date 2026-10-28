// UCT Agent × Indicators A1 — the TWO-UNDO compatibility the A1 integration report asked the Agent to prove
// (docs/indicators/a1/A1-INTEGRATION-REPORT-2026-10-25.md §4 (a)–(c), A1-INTERIM-UNDO-CONTRACT.md), through the
// REAL Agent panel and A1's REAL member history (indicatorHistoryStore + IndicatorUndoToast) on one chart:
//   (a) an Agent proposal is waiting, the member presses A1's Undo, then "do it" → refused (binding drift),
//       nothing written
//   (b) NL-1 "undo that" after a member A1 Undo → only the Agent's own entry is undone; the member's history
//       is untouched
//   (c) Ctrl+Z typed in the Agent's message box never fires A1's indicator Undo (while the toast is showing)
// The two histories stay SEPARATE (owner, Charts operator P1): neither records, nor undoes, the other's change.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { adoptOverlayAverages } from '../components/chart/maAdoption'
import * as R from '../components/chart/engine/nativeRegistry'
import { setInstanceHidden } from '../components/chart/engine/instanceControls'
import { recordIndicatorChange, peekIndicatorHistory, _resetIndicatorHistoryForTests } from '../components/chart/indicatorHistoryStore'
import IndicatorUndoToast from '../components/chart/IndicatorUndoToast'
import { AuthContext } from '../context/AuthContext'
import { registerBuiltins } from './builtins'
import { setOwnedDefinitionSource, _resetProposedPlans } from './capabilities/indicatorEdits'
import { NL1_KEY } from './nl1/interpreter'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const SURFACE = 'chart:c1'
let turns, script, server
const answer = (o) => ({ conversationId: 'c1', envelope: { disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, correction: null, ...o }, usage: {} })
beforeEach(() => {
  turns = []
  server = { stream: false, nl1: false }
  script = () => answer({ reply: 'ok' })
  _resetAgentConfig(); _resetIndicatorHistoryForTests()
  setOwnedDefinitionSource(() => []); _resetProposedPlans()
  try { localStorage.clear(); sessionStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn' || url === '/api/agent/turn/stream') { const b = JSON.parse(init.body); turns.push(b); return json(await script(b)) }
    if (url === '/api/agent/record') return json({ conversationId: 'c1' })
    if (url === '/api/agent/config') return json(server)
    if (String(url).startsWith('/api/user-definitions')) return json({ definitions: [] })
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const load = (cs) => { const m = mergeChartSettings(JSON.stringify(cs || {})); return adoptOverlayAverages(m) || m }
// ONE chart (c1, QQQ) — the default averages ovl:0…ovl:3 — shared by the Agent's host and A1's toast
function makeChart() {
  const store = { c1: {} }
  const read = (ref) => (ref in store ? { ref, label: 'Chart (QQQ)', position: null, symbol: 'QQQ', tf: 'D', stored: store[ref], cs: load(store[ref]), linkedCount: 0 } : null)
  const host = {
    charts: {
      list: () => Object.keys(store).map(read), read,
      commit: (ref, patch) => { if ('settings' in patch) store[ref] = JSON.parse(JSON.stringify(patch.settings)); return true },
      canManageIndicators: () => true, canCreateIndicator: () => true,
    },
    // the server holds what this tab holds (another tab is not part of these cases)
    widgetInSync: async () => ({ ok: true }),
    persist: async () => ({ ok: true }),
    otherWidgets: () => [],
  }
  return { store, host }
}
const inst = (store, id) => load(store.c1).indicatorInstances.find(i => i.instanceId === id)
const hidden = (store, id) => inst(store, id)?.hidden === true

function mount({ store, host }) {
  const Toast = () => <IndicatorUndoToast surfaceKey={SURFACE} chartId="c1" cs={load(store.c1)} write={(next) => { store.c1 = JSON.parse(JSON.stringify(next)) }} />
  const toast = render(<Toast />)
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true, user: { id: 1, role: 'admin' }, loading: false }}>
        <AgentPanel host={host} onClose={() => {}} />
      </AuthContext.Provider>
    </SWRConfig>,
  )
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => {
    await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
    fireEvent.change(box, { target: { value: t } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
    await waitFor(() => expect(document.querySelector('[data-testid=agent-typing]')).toBeNull(), { timeout: 8000 })
  }
  // the MEMBER hides an average by hand: the chart's own write + A1's record (what the legend's eye does)
  const memberHide = (id) => {
    const before = load(store.c1)
    store.c1 = JSON.parse(JSON.stringify(setInstanceHidden(before, id, true, R)))
    act(() => { recordIndicatorChange(SURFACE, before, load(store.c1), { labelOf: () => 'EMA', origin: 'c1' }) })
    toast.rerender(<Toast />)
  }
  const refresh = () => toast.rerender(<Toast />)
  return { box, say, memberHide, refresh, transcript: () => screen.getByTestId('agent-transcript').textContent }
}
const ixe = (body) => (body.context.indicatorEdits || [])[0]?.ref

describe('A1 × Agent — two separate Undo histories, each refusing what the other changed', () => {
  it('(a) a waiting Agent proposal + the member\'s A1 Undo + "do it" → refused, nothing written', async () => {
    const c = makeChart()
    const m = mount(c)
    m.memberHide('ovl:1')                                                    // member: hide the EMA 20 (A1-recorded)
    expect(hidden(c.store, 'ovl:1')).toBe(true)
    // the Agent proposes removing the SMA 200 (indicator.remove is always a proposal)
    script = (body) => answer({ disposition: 'propose', ops: [{ action: 'indicator.remove', target: ixe(body), args: { instance: 'ovl:3' } }] })
    await m.say('take the 200 off this chart')
    await screen.findByTestId('agent-proposal')
    expect(inst(c.store, 'ovl:3')).toBeTruthy()
    // the member presses A1's Undo on the chart's toast: their hide is undone (the chart's indicators changed)
    fireEvent.click(screen.getByRole('button', { name: /^Undo$/ }))
    m.refresh()
    expect(hidden(c.store, 'ovl:1')).toBe(false)
    const before = JSON.stringify(c.store.c1)
    await m.say('do it')
    await waitFor(() => expect(m.transcript()).toMatch(/changed since I showed it to you|no longer what I showed you/))
    expect(JSON.stringify(c.store.c1)).toBe(before)                         // nothing written
    expect(inst(c.store, 'ovl:3')).toBeTruthy()
    // and the member's history still holds their own entry, now redoable — the Agent never touched it
    expect(peekIndicatorHistory(SURFACE).future).toHaveLength(1)
  })

  it('(b) NL-1: "undo that" after a member A1 Undo reverses ONLY the Agent\'s own change', async () => {
    server = { ...server, nl1: true }; localStorage.setItem(NL1_KEY, '1'); await loadAgentConfig()
    const c = makeChart()
    const m = mount(c)
    // the Agent hides the SMA 50 (its own Undo entry)
    script = (body) => answer({ disposition: 'apply', ops: [{ action: 'indicator.hide', target: ixe(body), args: { instance: 'ovl:2' } }] })
    await m.say('hide the 50 on this chart')
    await waitFor(() => expect(hidden(c.store, 'ovl:2')).toBe(true))
    expect(peekIndicatorHistory(SURFACE).past).toHaveLength(0)              // an Agent write is never on the member's history
    // the member hides the EMA 20 by hand, then undoes it with A1's Undo
    m.memberHide('ovl:1')
    fireEvent.click(screen.getByRole('button', { name: /^Undo$/ }))
    m.refresh()
    expect(hidden(c.store, 'ovl:1')).toBe(false)
    const memberHistory = JSON.stringify(peekIndicatorHistory(SURFACE))
    const calls = turns.length
    await m.say('undo that')                                                 // NL-1's exact lane: no model call
    await waitFor(() => expect(hidden(c.store, 'ovl:2')).toBe(false))
    expect(turns.length).toBe(calls)
    expect(hidden(c.store, 'ovl:1')).toBe(false)                            // the member's state is left as THEY left it
    expect(JSON.stringify(peekIndicatorHistory(SURFACE))).toBe(memberHistory)
  })

  it('(c) Ctrl+Z typed in the Agent\'s message box never fires A1\'s indicator Undo — on the chart it does', async () => {
    const c = makeChart()
    const m = mount(c)
    await waitFor(() => expect(m.box.disabled).toBe(false))                 // the panel has settled
    m.memberHide('ovl:1')
    expect(screen.getByRole('button', { name: /^Undo$/ })).toBeTruthy()       // the toast is showing: its Ctrl+Z is live
    m.box.focus()
    fireEvent.keyDown(m.box, { key: 'z', code: 'KeyZ', ctrlKey: true })
    m.refresh()
    expect(hidden(c.store, 'ovl:1')).toBe(true)                             // still hidden: the text box keeps its own undo
    expect(peekIndicatorHistory(SURFACE).past).toHaveLength(1)
    // positive control: with focus OFF the Agent's box (the keyboard registry reads document.activeElement),
    // the same keys on the chart DO undo the member's change
    act(() => { m.box.blur() })
    fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', ctrlKey: true })
    m.refresh()
    expect(hidden(c.store, 'ovl:1')).toBe(false)
  })
})
