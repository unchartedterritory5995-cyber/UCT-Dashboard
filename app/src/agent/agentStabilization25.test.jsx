// AGENT STABILIZATION (after the p25 real-model batch, 11/14 — docs/agent/PHASE2.md).
// The three real-model misses were all unnecessary questions:
//   "Show me my strongest stocks."   → routing sent no Screener actions (need_groups: screener)
//   "now only the ones above $50"    → followed from the first
//   "Switch to my trading layout."   → the model asked "Which layout?" with ONE layout matching
// Fixes: strength phrases route to the Screener (never the bare word); ONE layout resolver for
// opening, on every path (instant, model-planned, approved) — one match opens, several ask.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { selectGroups } from './routing'
import { fastParse } from './fastPath'
import { layoutCandidates } from './capabilities/layout'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
const groups = (t) => selectGroups(t).priority

describe('1 · strength phrases route to the Screener (no reroute call), the bare word never does', () => {
  it.each([
    'Show me my strongest stocks.',
    'show me the weakest stocks',
    'what are the best stocks right now',
    'find the best semiconductor stocks',
    'top performing stocks this month',
    'my strongest names',
    'the worst performers today',
    'highest-rated stocks',
    'who are the market leaders',
    'sort them by relative strength',
  ])('%s → screener', (t) => expect(groups(t)).toContain('screener'))

  it.each([
    'what is the best chart theme',
    'make the top-right chart weekly',
    "what's the best way to draw a trendline",
    'switch to the strongest color',
    'top of the chart',
    'show me the best layout',
  ])('%s → NOT screener', (t) => expect(groups(t)).not.toContain('screener'))
})

const withLayouts = (names, active = null) => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' }, {
  layouts: { entries: names.map((name, i) => ({ id: i + 1, name })), boards: Object.fromEntries(names.map((_, i) => [i + 1, []])), active },
})

describe('2 · ONE layout resolver for opening', () => {
  const E = [{ id: 1, name: 'Main Trading' }, { id: 2, name: 'Swing Setups' }, { id: 3, name: 'Day Trading' }]
  it('id or exact name → that one; words → every layout holding them; nothing → []', () => {
    expect(layoutCandidates(E, '2').map(e => e.name)).toEqual(['Swing Setups'])
    expect(layoutCandidates(E, 'Main Trading').map(e => e.name)).toEqual(['Main Trading'])
    expect(layoutCandidates(E, 'my swing layout').map(e => e.name)).toEqual(['Swing Setups'])
    expect(layoutCandidates(E, 'trading').map(e => e.name)).toEqual(['Main Trading', 'Day Trading'])
    expect(layoutCandidates(E, 'earnings')).toEqual([])
  })
  it('rename / delete keep the EXACT-name rule (the loose match is for opening only)', () => {
    const { host } = withLayouts(['Main Trading', 'Swing Setups'])
    expect(fastParse('rename my trading layout to X', { host })).toBeNull()
    expect(fastParse('delete my trading layout', { host })).toBeNull()
  })
  it('"open NVDA" never opens a layout by a partial word', () => {
    const { host } = withLayouts(['NVDA Earnings'])
    const f = fastParse('open NVDA', { host })
    expect(f?.ops?.[0]?.action).not.toBe('layout.open')
  })
})

// ── through the real panel: the instant path, the MODEL path and approval all resolve alike ──
let calls, envelopes
beforeEach(() => {
  calls = []; envelopes = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push(String(url))
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') {
      const body = JSON.parse(init.body)
      const next = envelopes.shift()
      return json({ conversationId: 'c', envelope: typeof next === 'function' ? next(body) : next, usage: {} })
    }
    return json(url === '/api/agent/record' ? { conversationId: 'c' } : { conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

async function mount(names, active = null) {
  const board = withLayouts(names, active)
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await waitFor(() => expect(box.disabled).toBe(false)); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { ...board, say }
}
const opened = (state) => state.layouts.calls.filter(c => c[0] === 'open').map(c => c[1])
const turns = () => calls.filter(c => c === '/api/agent/turn').length
const layoutsRef = (b) => b.context.layouts[0].ref
const openPlan = (words) => (b) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops: [{ action: 'layout.open', target: layoutsRef(b), args: { layout: words } }] })

describe('2 · the original failed request, every path', () => {
  it('INSTANT: "Switch to my trading layout." with one match opens it — no question, no model call', async () => {
    const { state, say } = await mount(['Main Trading', 'Swing Setups'])
    await say('Switch to my trading layout.')
    await waitFor(() => expect(opened(state)).toEqual([1]))
    expect(turns()).toBe(0)
    expect(screen.queryByTestId('agent-question')).toBeNull()
  })
  it('MODEL-PLANNED: the model passes the member\'s words ("trading") — UCT resolves the one match and opens it', async () => {
    const { state, say } = await mount(['Main Trading', 'Swing Setups'])
    envelopes.push(openPlan('trading'))
    await say('could you flip me over to the trading one')
    await waitFor(() => expect(opened(state)).toEqual([1]))
    expect(screen.queryByTestId('agent-question')).toBeNull()
  })
  it('MODEL-PLANNED, ambiguous: two layouts match → ONE question with the real names; picking one opens exactly it', async () => {
    const { state, say } = await mount(['Main Trading', 'Day Trading', 'Swing Setups'])
    envelopes.push(openPlan('trading'))
    await say('could you flip me over to the trading one')
    const q = await screen.findByTestId('agent-question')
    expect(q.textContent).toMatch(/Which layout — “Main Trading” or “Day Trading”\?/)
    expect(opened(state)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Day Trading' }))
    await waitFor(() => expect(opened(state)).toEqual([2]))              // Day Trading is id 2
  })
  it('INSTANT, ambiguous: the same question (same resolver) — never the first match', async () => {
    const { state, say } = await mount(['Main Trading', 'Day Trading'])
    await say('switch to my trading layout')
    await screen.findByTestId('agent-question')
    expect(opened(state)).toEqual([])
    expect(turns()).toBe(0)
  })
  it('UNKNOWN: words that match no layout are refused, nothing opens', async () => {
    const { state, say } = await mount(['Main Trading', 'Swing Setups'])
    envelopes.push(openPlan('earnings'))
    await say('open my earnings board')
    await waitFor(() => expect(screen.getByTestId('agent-transcript').textContent).toMatch(/isn't in your layout list/))
    expect(opened(state)).toEqual([])
  })
  it('an exact id from the model still opens directly (existing behaviour)', async () => {
    const { state, say } = await mount(['Main Trading', 'Swing Setups'])
    envelopes.push(openPlan('2'))
    await say('go to swing please')
    await waitFor(() => expect(opened(state)).toEqual([2]))
  })
})
