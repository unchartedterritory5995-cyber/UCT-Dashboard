// OPTIONS FLOW: EVERY FILTER THE WIDGET HAS (pl-exec, owner product decision 2026-11-07; supersedes round 3's Calls-Only refusal).
// The real Charts Options Flow widget (pages/charts/widgets/OptionsFlowWidget.jsx) has exactly these controls, all in its opts
// and all already registry rows (widgets/widgetControls.js `optionsflow`, registry paramsSchema `lead` / `scope`):
//   Min premium  filters.minPrem  All 0 · $250K · $500K · $1M          Calls / Puts  filters.cp    All · Calls C · Puts P
//   Print type   filters.type     Any · Sweep SWEEP · Block BLOCK       Direction     filters.dir   All · Bull BULL · Bear BEAR
//   View         lead             Tape · Biggest · Sentiment            Scope         scope         Market · the linked symbol
// Each family through widget.setOption, through the REAL panel with routing v2: the request reaches the model with the widget's
// controls and WITHOUT the Screener (so the server's F-16 text check, which only runs when screener.run is in the routed manifest,
// never sees it), the plan lands in the widget's opts exactly as its chip writes them, the receipt names the filter and both
// values, Undo puts it back. Combos land together; an informational question changes nothing; a value the widget has no chip
// for is refused honestly. Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted plans).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
const config = async (on) => {
  const base = globalThis.fetch
  globalThis.fetch = async (url, init) => (url === '/api/agent/config'
    ? new Response(JSON.stringify({ conversations: [], routing_v2: on }), { status: 200, headers: { 'content-type': 'application/json' } }) : base(url, init))
  localStorage.setItem('uct.agent.routingV2', on ? '1' : '0')
  _resetAgentConfig()
  await loadAgentConfig()
}
// routing v2 (the admins' live path); the same file run with routing v1 also passed (2026-11-07, LOCAL)
beforeEach(async () => { p = setupPanel(); await config(true) })
afterEach(async () => { cleanup(); await config(false); localStorage.clear() })

const w = (id, type, x, y, opts = {}) => ({ id, type, x, y, w: 6, h: 10, color: 'N', opts })
const set = (key, value) => ({ action: 'widget.setOption', target: 'board', args: { widget: 'of', key, value } })
const optsOf = (board) => board.state.widgets.find(x => x.id === 'of').opts
const firstTurn = () => p.st.calls.find(c => c[1] === '/api/agent/turn')?.[2] || null
function mount(opts = {}) {
  const [[chart], syms] = ONE('NVDA')
  return p.mount([{ ...chart, w: 18 }, w('of', 'optionsflow', 18, 0, opts)], syms)
}

// [the member's words, the plan, the opts path, the value the chip writes, the receipt]
const FAMILIES = [
  ['only show puts in the options flow', [set('callPut', 'Puts')], 'filters.cp', 'P', /calls \/ puts is now Puts \(was All\)/],
  ['options flow: calls only', [set('callPut', 'C')], 'filters.cp', 'C', /calls \/ puts is now Calls/],
  ['just sweeps on the flow widget', [set('printType', 'sweeps')], 'filters.type', 'SWEEP', /print type is now Sweep \(was Any\)/],
  ['show block prints only in options flow', [set('printType', 'Block')], 'filters.type', 'BLOCK', /print type is now Block/],
  ['options flow, bearish only', [set('direction', 'bearish')], 'filters.dir', 'BEAR', /direction is now Bear \(was All\)/],
  ['set the options flow minimum premium to a million', [set('minPremium', 1000000)], 'filters.minPrem', 1000000, /minimum premium is now \$1M \(was All\)/],
  ['options flow premium floor 250k', [set('minPremium', '$250K')], 'filters.minPrem', 250000, /minimum premium is now \$250K/],
  ['switch the options flow to the biggest view', [set('lead', 'Biggest')], 'lead', 'biggest', /view is now Biggest \(was Tape\)/],
  ['options flow for the linked symbol only', [set('scope', 'symbol')], 'scope', 'symbol', /scope is now the linked symbol \(was Market\)/],
]
const at = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o)

describe('Options Flow: each filter family through the widget\'s own control', () => {
  it.each(FAMILIES)('"%s": the chip is set, the receipt says which, Undo puts it back', async (text, ops, path, value, receipt) => {
    const { say, board } = mount({})
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(p.env('apply', ops))
    const out = await say(text)
    const body = firstTurn()
    expect(body, 'the model was asked').toBeTruthy()
    const caps = body.capabilities.map(c => c.name)
    expect(caps).toContain('widget.setOption')
    // the server's F-16 text check runs only when screener.run is routed: it is not, so it never replaces this plan
    expect(caps).not.toContain('screener.run')
    expect(at(optsOf(board), path), out).toEqual(value)
    expect(out).toMatch(receipt)
    expect(out).not.toMatch(/can't screen|Screener page|filter chips on the widget itself/)
    await say('undo')
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)

  it('a combination lands together, each filter named: puts, sweeps, $500K, bearish', async () => {
    const { say, board } = mount({})
    p.st.envelopes.push(p.env('apply', [set('callPut', 'P'), set('printType', 'SWEEP'), set('minPremium', 500000), set('direction', 'BEAR')]))
    const out = await say('options flow: bearish put sweeps over 500k only')
    expect(optsOf(board).filters).toEqual({ minPrem: 500000, cp: 'P', type: 'SWEEP', dir: 'BEAR' })
    for (const r of [/calls \/ puts is now Puts/, /print type is now Sweep/, /minimum premium is now \$500K/, /direction is now Bear/]) expect(out).toMatch(r)
    await say('undo')
    expect(optsOf(board).filters ?? null).toBe(null)
  }, 40000)

  it('a filter already set the way asked: nothing changes, and it says so', async () => {
    const { say, board } = mount({ filters: { minPrem: 0, cp: 'P', type: 'all', dir: 'all' } })
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(p.env('apply', [set('callPut', 'Puts')]))
    const out = await say('only puts on the options flow')
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(out).toMatch(/already/i)
  }, 40000)

  it('clearing back to all: "show calls and puts again on the flow"', async () => {
    const { say, board } = mount({ filters: { minPrem: 0, cp: 'C', type: 'all', dir: 'all' } })
    p.st.envelopes.push(p.env('apply', [set('callPut', 'both')]))
    const out = await say('show calls and puts again on the options flow')
    expect(optsOf(board).filters.cp).toBe('all')
    expect(out).toMatch(/calls \/ puts is now All \(was Calls\)/)
  }, 40000)
})

describe('Options Flow: what is not a filter change', () => {
  it.each([['what does the options flow widget show?'], ['what are sweeps in options flow'], ['how do i read the flow tape']])('informational "%s": nothing on the widget changes', async (text) => {
    const { say, board } = mount({})
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(p.env('answer', [], { reply: 'It lists options prints as they happen.' }))
    await say(text)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)
  it.each([
    ['options flow minimum premium $2 million', set('minPremium', 2000000), /minimum premium|minPremium/],
    ['only show spreads on the options flow', set('printType', 'SPREAD'), /printType|print type/],
    ['options flow: neutral prints only', set('direction', 'NEUTRAL'), /direction/],
  ])('a value the widget has no chip for, "%s": refused honestly, nothing changes', async (text, op, names) => {
    const { say, board } = mount({})
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(p.env('apply', [op]))
    const out = await say(text)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(out).toMatch(names)
    expect(out).toMatch(/can be|isn't|not/i)
  }, 40000)
  it('with NO Options Flow widget on the board, a flow screen is still refused under F-16 (unchanged)', async () => {
    const [[chart], syms] = ONE('NVDA')
    const { say } = p.mount([{ ...chart, w: 18 }], syms)
    expect(await say('only show calls on the options flow')).toMatch(/can't screen on options-flow/)
    expect(p.turns()).toBe(0)
  }, 40000)
})
