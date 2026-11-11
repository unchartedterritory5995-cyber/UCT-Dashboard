// EXECUTION, ROUND 5 (pl-exec) — the remaining P0s through the REAL panel (panelHarness), the model scripted where a model is asked.
//   C1-011  the timeframe keys' repeat-press cycle, said: one rung up / down the keys' own order (TF_ORDER), from the chart's own
//           timeframe; the ends are said, never wrapped
// Held-out phrasings (agentExecHeldOut5) are said as written; the TUNE ones are this file's own.
// Evidence: LOCAL native Windows Node, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { TF_STEP_HELD_OUT } from './agentExecHeldOut5.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const one = (tf) => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { tf, settings: bareSettings() } }], { 'N:c': 'NVDA' }]
const tfOf = (b) => b.state.widgets.find(w => w.id === 'c').opts.tf || 'D'

const TUNE = [
  { text: 'go up one timeframe', from: 'D', to: 'W' }, { text: 'next timeframe', from: '15', to: '30' },
  { text: 'previous timeframe', from: 'W', to: 'D' }, { text: 'step down a timeframe', from: '5', to: '1' },
]
describe('C1-011: one rung up or down the timeframe keys\' order', () => {
  it.each([...TUNE, ...TF_STEP_HELD_OUT].map(c => [c.text, c]))('%s: the chart moves one rung; Undo puts it back', async (_t, c) => {
    const { say, board } = p.mount(...one(c.from))
    // a phrasing no instant reader claims goes to the model, which says the step the same way
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts[0].ref, args: { timeframe: c.to === tfStep(c.from, +1) ? 'next' : 'previous' } }]))
    const out = await say(c.text)
    expect(tfOf(board), out).toBe(c.to)
    await say('undo')
    expect(tfOf(board)).toBe(c.from)
  }, 30000)
  it.each([['go up one timeframe', 'M', /Monthly is already the longest/], ['previous timeframe', '1', /1 min.* is already the shortest|is already the shortest/]])('NEGATIVE at the end of the ladder, "%s" on %s: said, nothing changes', async (t, from, why) => {
    const { say, board } = p.mount(...one(from))
    // (an instant step that cannot run is left to the model, as every refused instant read is; its plan says the same step)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts[0].ref, args: { timeframe: /up/.test(t) ? 'next' : 'previous' } }]))
    expect(await say(t)).toMatch(why)
    expect(tfOf(board)).toBe(from)
  }, 30000)
})
const ORDER = ['1', '5', '15', '30', '60', 'D', 'W', 'M']
function tfStep(tf, d) { return ORDER[ORDER.indexOf(tf) + d] }

// C3-216 / C3-217 (round 5): a chart's Company Info panel, as its tab strip and its collapse chevron set it (opts.dock, the
// product's own normalizeDock / setFeatureOpen), offered only while the chart HAS the panel. Model scripted from the request.
import { normalizeDock } from '../pages/charts/widgets/chartDock'
describe('the Company Info panel on a chart', () => {
  const withDock = (dock) => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: bareSettings(), ...(dock ? { dock } : {}) } }], { 'N:c': 'NVDA' }]
  const dockOf = (b) => normalizeDock(b.state.widgets.find(w => w.id === 'c').opts.dock)
  const op = (key, value) => (body) => p.env('apply', [{ action: 'widget.setOption', target: body.context.board[0].ref, args: { widget: 'c', key, value } }])
  it('C3-216 "show the ownership tab on the company panel": the panel shows that tab; Undo goes back', async () => {
    const { say, board } = p.mount(...withDock({ company: true, open: true, tab: 'overview' }))
    p.st.envelopes.push(op('companyTab', 'ownership'))
    const out = await say('show the ownership tab on the company panel')
    expect(dockOf(board).tab, out).toBe('ownership')
    await say('undo')
    expect(dockOf(board).tab).toBe('overview')
  }, 30000)
  it.each([['collapse the company panel', false, true], ['open the company info panel', true, false]])('C3-217 "%s": the panel is %s; it stays added; Undo restores it', async (text, to, from) => {
    const { say, board } = p.mount(...withDock({ company: true, open: from }))
    p.st.envelopes.push(op('companyOpen', to))
    const out = await say(text)
    expect([dockOf(board).open, dockOf(board).company], out).toEqual([to, true])
    await say('undo')
    expect(dockOf(board).open).toBe(from)
  }, 30000)
  it('NEGATIVE: a chart without the panel refuses (adding it is the Add to Chart menu’s), nothing changes', async () => {
    const { say, board } = p.mount(...withDock(null))
    p.st.envelopes.push(op('companyOpen', true))
    expect(await say('open the company panel')).toMatch(/no Company Info panel/)
    expect(dockOf(board).company).toBe(false)
  }, 30000)
})

// C3-065 (round 6): a Watchlist widget on the member's Flagged list, as the picker's Flagged row sets it (watchKey 'flagged');
// held-out phrasings from agentExecHeldOut6. Undo puts the list it showed back.
import { FLAGGED_HELD_OUT } from './agentExecHeldOut6.test.js'
describe('the Flagged list in a Watchlist widget', () => {
  it.each(FLAGGED_HELD_OUT.map(c => [c.text]))('"%s": the widget shows Flagged; Undo goes back', async (text) => {
    const { say, board } = p.mount([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'N', opts: { settings: bareSettings() } },
      { id: 'wl', type: 'watchlist', x: 12, y: 0, w: 12, h: 20, color: 'N', opts: { watchKey: 'user:w1', watchName: 'Momentum', watchTab: 'mine' } }], { 'N:c': 'NVDA' })
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'widget.setOption', target: body.context.board[0].ref, args: { widget: 'wl', key: 'source', value: 'flagged' } }]))
    const out = await say(text)
    const wl = () => board.state.widgets.find(w => w.id === 'wl').opts
    expect([wl().watchKey, wl().watchName], out).toEqual(['flagged', 'Flagged'])
    await say('undo')
    expect([wl().watchKey, wl().watchName]).toEqual(['user:w1', 'Momentum'])
  }, 30000)
})
