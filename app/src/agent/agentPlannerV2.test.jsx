// PLANNER v2 — the browser step executor (Wave 1 A-05, agent/steps.js) through the REAL panel (panelHarness),
// against a SCRIPTED step server (testing/stepServer.js: the model is the script). Pins: each step runs through the
// existing executor with a receipt and its result goes back; a confirm-risk step shows the ordinary card and the
// turn pauses until "do it" (resume with the receipt) or "no" (resume with a refusal); a refused step reports
// `refused` and changes nothing; "undo all of that" reverts every applied step of the turn across its pause; an
// isolated query result never leaves the browser as a value; the v1 path is untouched when the config says v1.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, TWO } from './testing/panelHarness'
import { installStepServer } from './testing/stepServer'
import { _resetAgentConfig } from './agentClient'
import { outcomeOf } from './steps'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p, srv
beforeEach(() => { _resetAgentConfig(); p = setupPanel() })
afterEach(() => { srv?.uninstall?.(); vi.restoreAllMocks(); cleanup() })

const LISTS = [{ id: 'wl1', name: 'Swing', symbols: ['AAPL'] }]
const refIn = (c, key, i = 0) => { const s = c.body.context[key]; return Array.isArray(s) ? s[i].ref : s.ref }
const chart = (c, i = 0) => refIn(c, 'charts', i)
const tfOf = (board, id) => board.state.widgets.find(w => w.id === id)?.opts?.tf || 'D'
// the panel is idle AND the scripted stream has closed
const settled = async () => { await waitFor(() => { if (screen.queryByTestId('agent-typing') || srv.stream) throw new Error('busy') }, { timeout: 10000 }) }

describe('planner v2: steps through the real panel', () => {
  it('each step runs through the existing executor, its receipt goes back as the step result, the final reply is shown', async () => {
    srv = installStepServer(p, [
      (c) => ({ action: 'chart.setTimeframe', target: chart(c, 0), args: { timeframe: 'W' } }),
      (c) => ({ action: 'chart.setTimeframe', target: chart(c, 1), args: { timeframe: '5' } }),
      { reply: 'Both charts are set.' },
    ])
    const { say, board } = p.mount(...TWO(), { watchlists: LISTS })
    const out = await say('tune the cadence on both panels for me')
    await settled()
    expect(p.turns()).toBe(0)                                                     // never v1's /api/agent/turn
    expect(srv.bodies).toHaveLength(1)
    expect(srv.bodies[0]).toMatchObject({ message: 'tune the cadence on both panels for me', planner: 'v2', routing: null, manifestVersion: 1 })
    expect(srv.bodies[0].capabilities.length).toBeGreaterThan(60)                 // the FULL manifest, no routing
    expect(tfOf(board, 'cl')).toBe('W')
    expect(tfOf(board, 'cr')).toBe('5')
    expect(srv.results.map(r => [r.id, r.status])).toEqual([['s1', 'done'], ['s2', 'done']])
    expect(srv.results[0].receipt).toMatch(/weekly/i)
    expect(srv.results[1].receipt).toMatch(/5/)
    expect(p.summaries()).toHaveLength(2)                                         // one receipt per step
    expect(out).toContain('Both charts are set.')
    expect(srv.events.map(e => e.t)).toEqual(['step', 'step', 'final'])
  }, 30000)

  it('a confirm-risk step shows the ordinary card and PAUSES the turn; "do it" resumes it with the receipt', async () => {
    srv = installStepServer(p, [
      (c) => ({ action: 'chart.setTimeframe', target: chart(c, 0), args: { timeframe: 'W' } }),
      (c) => ({ action: 'watchlist.create', target: refIn(c, 'watchlistLibrary'), args: { name: 'Momentum Review', as: null }, mode: 'propose' }),
      (c) => ({ action: 'chart.setTimeframe', target: chart(c, 1), args: { timeframe: 'M' } }),
      { reply: 'All set.' },
    ])
    const { say, board } = p.mount(...TWO(), { watchlists: LISTS })
    const out = await say('curate a momentum review collection and retune both panels')
    await settled()
    expect(p.proposals()).toHaveLength(1)                                         // the card, as every proposal
    expect(srv.results.map(r => r.status)).toEqual(['done', 'proposed'])
    expect(srv.events.map(e => e.t)).toEqual(['step', 'step', 'paused', 'final'])
    expect(board.state.server.lists.map(l => l.name)).toEqual(['Swing'])            // nothing created yet
    expect(tfOf(board, 'cr')).toBe('D')                                             // the step after the card has not run
    expect(out).not.toContain('All set.')
    const out2 = await say('do it')
    await settled()
    expect(board.state.server.lists.map(l => l.name)).toEqual(['Swing', 'Momentum Review'])
    expect(srv.resumes).toHaveLength(1)
    expect(srv.resumes[0]).toMatchObject({ turnId: 'v2_test1', id: 's2', status: 'done' })
    expect(srv.resumes[0].receipt).toMatch(/Momentum Review/)
    expect(tfOf(board, 'cr')).toBe('M')                                             // the rest of the turn ran after the approval
    expect(srv.results.map(r => r.status)).toEqual(['done', 'proposed', 'done'])
    expect(out2).toContain('All set.')
  }, 30000)

  it('"no" on the card resumes the turn with a refusal; nothing was created', async () => {
    srv = installStepServer(p, [
      (c) => ({ action: 'watchlist.create', target: refIn(c, 'watchlistLibrary'), args: { name: 'Momentum Review', as: null }, mode: 'propose' }),
      { reply: 'Okay, nothing was created.' },
    ])
    const { say, board } = p.mount(...TWO(), { watchlists: LISTS })
    await say('curate a momentum review collection')
    await settled()
    expect(p.proposals()).toHaveLength(1)
    await say('no')
    await settled()
    expect(srv.resumes).toHaveLength(1)
    expect(srv.resumes[0]).toMatchObject({ id: 's1', status: 'refused' })
    expect(board.state.server.lists.map(l => l.name)).toEqual(['Swing'])
    expect(p.transcript()).toContain('Okay, nothing was created.')
  }, 30000)

  it('"undo all of that" reverts every applied step of the turn, across its pause, newest first', async () => {
    srv = installStepServer(p, [
      (c) => ({ action: 'chart.setTimeframe', target: chart(c, 0), args: { timeframe: 'W' } }),
      (c) => ({ action: 'watchlist.create', target: refIn(c, 'watchlistLibrary'), args: { name: 'Momentum Review', as: null }, mode: 'propose' }),
      (c) => ({ action: 'chart.setType', target: chart(c, 1), args: { type: 'bars' } }),
      { reply: 'Done.' },
    ])
    const { say, board } = p.mount(...TWO(), { watchlists: LISTS })
    await say('retune the left panel, curate a momentum review collection, restyle the right one')
    await settled()
    await say('do it')
    await settled()
    expect(tfOf(board, 'cl')).toBe('W')
    expect(board.host.charts.read('cr').cs.chartType).toBe('bars')
    const out = await say('undo all of that')
    expect(out).toContain('Took back all 2 changes from your last request.')
    expect(tfOf(board, 'cl')).toBe('D')
    expect(board.host.charts.read('cr').cs.chartType).not.toBe('bars')
    expect(board.state.server.lists.map(l => l.name)).toEqual(['Swing', 'Momentum Review'])   // no Undo for a created list (as its manifest says)
  }, 40000)

  it('a FRESH message typed while a card waits starts its own Undo group; "do it" afterwards still joins the paused turn\'s', async () => {
    srv = installStepServer(p, [
      (c) => ({ action: 'chart.setTimeframe', target: chart(c, 0), args: { timeframe: 'W' } }),
      (c) => ({ action: 'watchlist.create', target: refIn(c, 'watchlistLibrary'), args: { name: 'Momentum Review', as: null }, mode: 'propose' }),
      // the fresh message's turn (the paused one is abandoned by it)
      (c) => ({ action: 'chart.setType', target: chart(c, 1), args: { type: 'bars' } }),
      { reply: 'Bars on the right.' },
    ])
    const { say, board } = p.mount(...TWO(), { watchlists: LISTS })
    await say('retune the left panel and curate a momentum review collection')
    await settled()
    expect(p.proposals()).toHaveLength(1)
    expect(tfOf(board, 'cl')).toBe('W')
    await say('restyle the right panel instead')                                   // a new request while the card waits
    await settled()
    expect(board.host.charts.read('cr').cs.chartType).toBe('bars')
    const out = await say('undo all of that')
    expect(out).not.toMatch(/Took back all/)                                       // ONE change in the fresh message's group…
    expect(board.host.charts.read('cr').cs.chartType).not.toBe('bars')             // …reverted
    expect(tfOf(board, 'cl')).toBe('W')                                            // the paused turn's change is NOT in that group
  }, 40000)

  it('a step the planner refuses reports `refused` and changes nothing; the model is told', async () => {
    srv = installStepServer(p, [
      (c) => ({ action: 'chart.setTimeframe', target: chart(c, 0), args: { timeframe: '7' } }),
      { reply: 'That timeframe is not available.' },
    ])
    const { say, board } = p.mount(...TWO(), { watchlists: LISTS })
    const out = await say('7 minute chart')
    await settled()
    expect(srv.results).toHaveLength(1)
    expect(srv.results[0].status).toBe('refused')
    expect(srv.results[0].refusal).toMatch(/didn't change anything|isn't an option|7/)
    expect(tfOf(board, 'cl')).toBe('D')
    expect(out).toContain('That timeframe is not available.')
  }, 30000)

  it('an isolated (local-only) query result never leaves the browser as a value', () => {
    const bodies = [{ outcome: 'US: 73.5% above the 50-day', outcomeData: { kind: 'answered', actions: ['breadth.show'], local: true } }]
    expect(outcomeOf(bodies, { action: 'breadth.show' })).toEqual({ status: 'query', result: null, isolated: true })
    expect(outcomeOf(bodies, { action: 'breadth.show' }).result).toBeNull()
    expect(outcomeOf([{ outcome: '42 stocks match', outcomeData: { kind: 'answered', actions: ['screener.run'] } }], { action: 'screener.run' }))
      .toEqual({ status: 'query', result: '42 stocks match' })
    expect(outcomeOf([{ outcome: 'Switched to weekly', outcomeData: { kind: 'applied' } }], null)).toEqual({ status: 'done', receipt: 'Switched to weekly' })
    expect(outcomeOf([], null).status).toBe('refused')
  })

  it('the config says v1: the model path is v1, byte for byte (no stream, no step server)', async () => {
    srv = installStepServer(p, [{ reply: 'never' }], { planner: 'v1' })
    const { say } = p.mount(...TWO(), { watchlists: LISTS })
    const out = await say('what distinguishes an exponential average from a simple one?')
    expect(p.turns()).toBe(1)                                                     // v1's /api/agent/turn
    expect(srv.bodies).toEqual([])
    expect(out).toContain('«the model was asked»')
  }, 30000)
})
