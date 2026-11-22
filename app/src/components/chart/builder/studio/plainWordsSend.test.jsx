// app/src/components/chart/builder/studio/plainWordsSend.test.jsx
//
// SEND WHAT THE MEMBER TYPED (2026-11-16). The Indicators window's own plain-words box, submitted
// by the member, sends its words as Create Indicator's first turn: a chart reaches a preview in
// two actions (open the window; type and press Enter). Each promise is failable here:
//   * `send: true` on the seeded door makes exactly ONE request, with the member's words;
//   * without it nothing is sent (the Agent's rule, unchanged: `agentOpener.test.jsx`);
//   * UCT Agent's door cannot carry the flag (`agentOpenOpts`, and the pane uses it);
//   * a draft kept for the chart still wins: restored, nothing sent.
import { createRef } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import ChartToolbar from '../../ChartToolbar'
import { mergeChartSettings } from '../../chartDefaults'
import { AuthContext } from '../../../../context/AuthContext'
import { setCreateIndicatorFlag, CREATE_INDICATOR_FLAG_KEY } from './createIndicatorFlag'
import { writeSession, clearSession, createKey, chartScope } from '../authoring/conversationSessions'
import { newAuthoringState } from '../authoring/authoringState'
import { sendSeedFrom, agentOpenOpts } from '../agentSeams'
import PANE_SRC from '../../pane/ChartPane.jsx?raw'
import WINDOW_SRC from '../../ChartSettingsIndicators.jsx?raw'

const CHART = 'w-plain-words-send-test'
const WORDS = 'Distance from the 50-day average, in ATRs'

function mount() {
  const ref = createRef()
  render(
    <AuthContext.Provider value={{ isPaid: true, user: { id: 1, role: 'admin' }, loading: false }}>
      <ChartToolbar
        ref={ref}
        activeTool="cursor"
        setActiveTool={() => {}}
        chartId={CHART}
        chartSettings={mergeChartSettings(null)}
        onUpdateSettings={vi.fn()}
        onStudioPreview={vi.fn()}
      />
    </AuthContext.Provider>,
  )
  return { ref }
}
const converseCalls = (spy) => spy.mock.calls.filter((c) => /\/converse/.test(String(c[0])))
const bodyOf = (call) => { try { return JSON.parse(call[1].body) } catch { return {} } }
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 30)) }) }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  try { localStorage.removeItem(CREATE_INDICATOR_FLAG_KEY) } catch { /* */ }
  clearSession(createKey(chartScope(CHART)))
})

describe('the seeded door with send', () => {
  it('sends the words ONCE as the first turn; the box is empty and the words are in the conversation', async () => {
    act(() => { setCreateIndicatorFlag(true) })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))   // never answers
    const t = mount()
    let r
    act(() => { r = t.ref.current.openCreateIndicatorFor({ seed: WORDS, send: true }) })
    expect(r).toEqual({ ok: true, prefilled: true, draft: false, editing: false })
    await screen.findByTestId('create-indicator-input')
    await settle()
    const calls = converseCalls(fetchSpy)
    expect(calls).toHaveLength(1)
    expect(bodyOf(calls[0]).message).toBe(WORDS)
    expect(screen.getByTestId('create-indicator-input').value).toBe('')
    expect(screen.getByTestId('create-indicator').textContent).toContain(WORDS)
  })

  it('CONTROL: the same door without the flag sends nothing and leaves the words in the box', async () => {
    act(() => { setCreateIndicatorFlag(true) })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    const t = mount()
    act(() => { t.ref.current.openCreateIndicatorFor({ seed: WORDS }) })
    const input = await screen.findByTestId('create-indicator-input')
    await settle()
    expect(converseCalls(fetchSpy)).toHaveLength(0)
    expect(input.value).toBe(WORDS)
  })

  it('only the literal true sends: a truthy string or 1 does not', async () => {
    act(() => { setCreateIndicatorFlag(true) })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    const t = mount()
    act(() => { t.ref.current.openCreateIndicatorFor({ seed: WORDS, send: 'true' }) })
    await screen.findByTestId('create-indicator-input')
    await settle()
    expect(converseCalls(fetchSpy)).toHaveLength(0)
  })

  it('a draft kept for this chart still wins: it is restored and nothing is sent', async () => {
    act(() => { setCreateIndicatorFlag(true) })
    writeSession(createKey(chartScope(CHART)), { state: newAuthoringState(), transcript: [{ role: 'member', text: 'make an EMA' }], acked: false })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    const t = mount()
    let r
    act(() => { r = t.ref.current.openCreateIndicatorFor({ seed: WORDS, send: true }) })
    expect(r).toEqual({ ok: true, prefilled: false, draft: true, editing: false })
    await screen.findByTestId('create-indicator-input')
    await settle()
    expect(converseCalls(fetchSpy)).toHaveLength(0)
    expect(screen.getByTestId('create-indicator').textContent).toMatch(/make an EMA/)
  })
})

describe('who may ask for it', () => {
  it('sendSeedFrom: only { send: true }', () => {
    expect(sendSeedFrom({ seed: 'x', send: true })).toBe(true)
    for (const o of [null, undefined, 'send', {}, { send: 1 }, { send: 'true' }, { send: false }]) expect(sendSeedFrom(o)).toBe(false)
  })

  it('agentOpenOpts keeps what UCT Agent gave and drops send', () => {
    expect(agentOpenOpts({ seed: 'RSI', defId: 'u_1', send: true })).toEqual({ seed: 'RSI', defId: 'u_1' })
    expect(agentOpenOpts({ seed: 'RSI' })).toEqual({ seed: 'RSI' })
    expect(agentOpenOpts(null)).toBeNull()
    const given = { seed: 'RSI', send: true }
    agentOpenOpts(given)
    expect(given.send).toBe(true)                               // the caller's object is not changed
  })

  // source rails: comments are stripped first, so a sentence ABOUT the rule is not the rule
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('UCT Agent\'s door in the pane passes its options through agentOpenOpts, and nothing else reaches the toolbar from it', () => {
    const pane = code(PANE_SRC)
    const door = pane.slice(pane.indexOf('openCreateIndicatorFor: (opts = null) => {'))
    expect(door.slice(0, 400)).toMatch(/openCreateIndicatorFor\?\.\(agentOpenOpts\(opts\)\)/)
    expect(door.slice(0, 400)).not.toMatch(/openCreateIndicatorFor\?\.\(opts\)/)
  })

  // Superseded by the owner's 'Option 1' Indicators window (11-16): the window no longer has a plain-words box,
  // so there is no box or example to send from. The door's send path is still covered above.
  it.skip('in the window, the box and its examples ask to send; "Describe it instead" does not', () => {
    const win = code(WINDOW_SRC)
    expect(win).toMatch(/onSubmit=\{\(e\) => \{ e\.preventDefault\(\); describeIt\(describeText, \{ send: true \}\) \}\}/)
    expect(win).toMatch(/describeIt\(ex, \{ send: true \}\)/)
    expect(win).toMatch(/onClick=\{\(\) => describeIt\(query\)\}/)
    // control: the stripper leaves real code in place
    expect(win).toMatch(/const describeIt = /)
  })
})
