// layout.saveAs fast path must not claim "save … as the default on <chart/symbol>" (a chart's default,
// not a layout called "the default"). The REAL AgentPanel, fetch mocked, no paid calls: those sentences
// reach the model; explicit layout saves stay instant exactly as on master.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

const ENTRIES = [
  { id: 'uct-default', name: 'UCT Default', scope: 'global' },
  { id: 11, name: 'Agent Test', scope: 'user' },
  { id: 13, name: 'Momentum Old', scope: 'user' },
]
const ONE = [{ id: 'c-one', type: 'chart', x: 0, y: 0, w: 24, h: 20 }]
const TWO = [{ id: 'c-left', type: 'chart', x: 0, y: 0, w: 12, h: 20 }, { id: 'c-right', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'B' }]
const BOARDS = {
  'one chart (TSLA)': [ONE, { A: 'TSLA' }],
  'two charts (TSLA + NVDA)': [TWO, { A: 'TSLA', B: 'NVDA' }],
}
const build = (widgets, syms, withLayouts) => makeBoard(widgets, syms, withLayouts
  ? { layouts: { entries: ENTRIES, boards: { 11: widgets }, active: 11 } }
  : {})

const MODEL_REPLY = 'MODEL-REPLY-SENTINEL'
let turns
beforeEach(() => {
  turns = 0
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (url === '/api/agent/turn') {
      turns += 1
      return json({ conversationId: 'ac_1', envelope: { disposition: 'answer', reply: MODEL_REPLY, question: null, ops: [], unsupported_category: null }, usage: { research_calls: 0, citations: [] } })
    }
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

const DEFAULT_ASKS = ['save it as the default on the tsla chart', 'save as default on TSLA']

for (const [label, [widgets, syms]] of Object.entries(BOARDS)) {
  for (const withLayouts of [true, false]) {
    describe(`${label}, ${withLayouts ? 'WITH' : 'WITHOUT'} a layouts source`, () => {
      for (const text of DEFAULT_ASKS) {
        it(`"${text}" is not claimed by the layout fast path — the model reads it`, async () => {
          const { host, state } = build(widgets, syms, withLayouts)
          const f = fastParse(text, { host })
          expect(f?.ops?.some(o => o.action === 'layout.saveAs')).not.toBe(true)
          render(<AgentPanel host={host} onClose={() => {}} />)
          type(text)
          await screen.findByText(MODEL_REPLY)
          expect(turns).toBe(1)
          expect(screen.queryByTestId('agent-proposal')).toBeNull()
          expect(screen.queryByText(/Save this workspace as a new layout/)).toBeNull()
          expect(screen.queryByText(/nothing on this workspace/i)).toBeNull()
          expect(state.layouts?.calls || []).toEqual([])
        })
      }
      if (withLayouts) {
        for (const [text, name] of [['save this layout as Swing', 'Swing'], ['save it as Momentum', 'Momentum'],
          ['save it as Thrust Days', 'Thrust Days'], ['save this layout as default', 'default']]) {
          it(`control: "${text}" is still an instant layout save proposal (no model call)`, async () => {
            const { host } = build(widgets, syms, true)
            const f = fastParse(text, { host })
            expect(f.ops.map(o => [o.action, o.args])).toEqual([['layout.saveAs', { name }]])
            render(<AgentPanel host={host} onClose={() => {}} />)
            type(text)
            await screen.findByTestId('agent-proposal')
            expect(screen.getByTestId('agent-proposal').textContent).toContain(`“${name}”`)
            await waitFor(() => expect(globalThis.fetch.mock.calls.some(([u]) => u === '/api/agent/record')).toBe(true))
            expect(turns).toBe(0)
          })
        }
        // AUDIT asked for "save the workspace as Momentum Swing" as an instant control. On master the matcher's subject
        // list has "this workspace" but not "the workspace", so master sends it to the model. This PR keeps that. The
        // rail pins it: no false claim, one model turn.
        it('pin: "save the workspace as Momentum Swing" is not fast on master or here; it reaches the model', async () => {
          const text = 'save the workspace as Momentum Swing'
          const { host } = build(widgets, syms, true)
          expect(fastParse(text, { host })).toBeNull()
          render(<AgentPanel host={host} onClose={() => {}} />)
          type(text)
          await screen.findByText(MODEL_REPLY)
          expect(turns).toBe(1)
          expect(screen.queryByTestId('agent-proposal')).toBeNull()
        })
      }
    })
  }
}

describe('layout.saveAs fast matcher — explicit layout words keep master behaviour', () => {
  const { host } = build(ONE, { A: 'TSLA' }, true)
  const nameOf = (t) => fastParse(t, { host })?.ops?.find(o => o.action === 'layout.saveAs')?.args?.name ?? null
  it('explicit layout wording still saves a layout, even named "default"', () => {
    expect(nameOf('save this layout as default')).toBe('default')
    expect(nameOf('save this workspace as Swing')).toBe('Swing')
    expect(nameOf('save this as Momentum')).toBe('Momentum')
    expect(nameOf('Save this setup as Earnings Watch')).toBe('Earnings Watch')
  })
  it('default-shaped names and chart / symbol targets without layout words are left to the model', () => {
    for (const t of ['save it as the default', 'save as default', 'save this as my default', 'save it as Momentum on TSLA',
      'save it as Swing for the nvda chart', 'save as default for $NVDA']) expect(nameOf(t)).toBeNull()
  })
})
