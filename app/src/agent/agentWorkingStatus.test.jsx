// The panel header's status comes from real execution: "UCT Agent is working" while a website write is in flight, "typing"
// while busy otherwise, "Online" when idle. Through the REAL panel, useAgent, routing, runtime and Undo on the fixture board;
// each write is held at the chart kind's own commit, so the header is read DURING the write. No model call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, act, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getTargetKind } from './capabilities'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { AuthContext } from '../context/AuthContext'
import { commitPlan } from './runtime'
import { _resetAgentConfig } from './agentClient'
import { _resetKnowledgeForTest } from './capabilities/knowledge'
import { isWorking, mark, subscribeWorking, traceEnd, traceStart, turnEnd, turnStart, _resetTurns } from './trace'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('./runtime', async (orig) => {
  const real = await orig()
  return { ...real, commitPlan: vi.fn(real.commitPlan) }
})
import AgentPanel from './AgentPanel'
import useAgent from './useAgent'

registerBuiltins()
const realCommitPlan = (await vi.importActual('./runtime')).commitPlan

beforeEach(() => {
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); commitPlan.mockImplementation(realCommitPlan); cleanup(); traceEnd('test'); _resetTurns() })

const status = () => screen.getByTestId('agent-status').textContent
const idle = () => waitFor(() => { expect(screen.queryByTestId('agent-typing')).toBeNull(); expect(status()).toBe('Online') }, { timeout: 10000 })

/** Hold every chart write at the kind's commit: `at()` is how many are waiting, `release()` lets the oldest through. */
function holdWrites() {
  const kind = getTargetKind('chart')
  const real = kind.commit
  const held = []
  vi.spyOn(kind, 'commit').mockImplementation(async (...args) => {
    await new Promise(res => held.push(res))
    return real.apply(kind, args)
  })
  return { at: () => held.length, release: () => held.shift()() }
}

/** The same, one level up, for a plan of any kind: every commitPlan waits for its `release()`. */
function holdPlans() {
  const held = []
  commitPlan.mockImplementation(async (...args) => {
    await new Promise(res => held.push(res))
    return realCommitPlan(...args)
  })
  return { at: () => held.length, release: () => held.shift()() }
}

function fixture(ids = ['c1']) {
  const board = makeBoard(ids.map((id, i) => ({ id, type: 'chart', x: i * 12, y: 0, w: 12, h: 10, color: 'N', opts: { tf: 'D', settings: mergeChartSettings(null) } })),
    Object.fromEntries(ids.map((id, i) => [`N:${id}`, ['SPY', 'QQQ'][i]])))
  const h = { ...board.host, epoch: () => 1, charts: { ...board.host.charts, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null }, persist: async () => ({ ok: true }) }
  return { board, h }
}

const panel = (h) => render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)

async function mount(ids) {
  const { board, h } = fixture(ids)
  const view = panel(h)
  await idle()
  const box = screen.getByLabelText('Message UCT Agent')
  return { board, h, view, send: (t) => { fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) } }
}
/** The model proposes a weekly chart; the member decides on the card. Scripted, no model call. */
function scriptProposal() {
  const real = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    if (url !== '/api/agent/turn') return real(url, init)
    const body = JSON.parse(init.body)
    const op = { action: 'chart.setTimeframe', target: body.context.charts[0].ref, args: { timeframe: 'W' } }
    return new Response(JSON.stringify({ conversationId: 'ac_1', envelope: { disposition: 'propose', reply: 'Here is the plan.', question: null, ops: [op], unsupported_category: null }, usage: { research_calls: 0, citations: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const composerLine = () => screen.getByTestId('agent-typing').textContent
/** Hold the board save. `h.persist` is read when the save runs, so this works on a mounted panel. */
function holdSave(h) {
  const held = []
  h.persist = vi.fn(() => new Promise((res, rej) => held.push({ res, rej })))
  return { at: () => held.length, finish: (r = { ok: true }) => held.shift().res(r), fail: (e) => held.shift().rej(e) }
}
const tf = (board) => board.state.widgets.find(w => w.id === 'c1').opts.tf

const KB = { contract: 'MD-1.0', kind: 'knowledge.search', params_echo: {}, status: 'ok', freshness: 'periodic',
  as_of: '2026-11-01T02:00:00Z', fetched_at: '2026-11-03T05:00:00Z', delay_s: null, stale: false, source: 'uct-brain-pack',
  coverage: { pack_ts: 1761962400, policy_version: 3 }, provider_calls: 0, notes: [],
  data: { method: 'fts', passages: [{ kb_id: 2, title: 'UCT team playbook: VCP', category: 'SETUP', trader: 'UCT Team',
    source: 'the UCT team playbook (distilled, unattributed)', licence: 'team_owned', excerpt: 'Tightening pullbacks on drying volume.' }] } }

/** A scripted model turn: `reply(body)` gives the envelope, or throws for a failed request. No model call. */
function scriptTurn(reply) {
  const real = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    const u = String(url)
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: true, scan: false, data_kinds: ['knowledge.search'] })
    if (u === '/api/agent/data') return json(KB)
    if (u === '/api/agent/turn') {
      const envelope = { reply: '', question: null, ops: [], unsupported_category: null, ...reply(JSON.parse(init.body)) }
      return json({ conversationId: 'ac_1', envelope, usage: { research_calls: 0, citations: [] } })
    }
    return real(url, init)
  })
}
const chartRef = (b) => b.context.charts[0].ref
const weekly = (b, tf = 'W') => ({ action: 'chart.setTimeframe', target: chartRef(b), args: { timeframe: tf } })
const explain = (b) => ({ action: 'playbook.explain', target: b.context.playbook[0].ref, args: { question: 'what is a VCP' } })

describe('the status clears on every path', () => {
  beforeEach(() => { _resetAgentConfig(); _resetKnowledgeForTest() })
  afterEach(() => { _resetAgentConfig(); _resetKnowledgeForTest() })

  it.each([
    ['success', (b) => ({ disposition: 'apply', ops: [weekly(b)] }), { wrote: true, tf: 'W', receipts: 1 }],
    ['mixed change + knowledge', (b) => ({ disposition: 'apply', ops: [weekly(b), explain(b)] }), { wrote: true, tf: 'W', receipts: 1, says: /UCT KB #2/ }],
    ['knowledge only', (b) => ({ disposition: 'apply', ops: [explain(b)] }), { wrote: false, tf: 'D', receipts: 0, says: /UCT KB #2/ }],
    ['refusal', (b) => ({ disposition: 'apply', ops: [weekly(b, '7')] }), { wrote: false, tf: 'D', receipts: 0 }],
    ['approval pending', (b) => ({ disposition: 'propose', reply: 'Here is the plan.', ops: [weekly(b)] }), { wrote: false, tf: 'D', receipts: 0, card: true }],
    ['the turn request failing', () => { throw new Error('offline') }, { wrote: false, tf: 'D', receipts: 0 }],
  ])('%s', async (_, reply, want) => {
    const seen = []
    const off = subscribeWorking(() => seen.push(isWorking()))
    scriptTurn(reply)
    const { board, send } = await mount()
    await waitFor(() => expect(globalThis.fetch.mock.calls.some(c => String(c[0]) === '/api/agent/config')).toBe(true))
    await waitFor(() => expect(screen.getByLabelText('Message UCT Agent').disabled).toBe(false))
    send('set this up for swing trading')
    await waitFor(() => expect(globalThis.fetch.mock.calls.some(c => String(c[0]) === '/api/agent/turn')).toBe(true), { timeout: 8000 })
    await idle()
    off()
    expect(isWorking()).toBe(false)
    expect(seen).toEqual(want.wrote ? [true, false] : [])
    expect(screen.queryByTestId('agent-typing')).toBeNull()
    expect(tf(board)).toBe(want.tf)
    expect(screen.queryAllByTestId('agent-receipt')).toHaveLength(want.receipts)
    if (want.says) expect(transcript()).toMatch(want.says)
    if (want.card) expect(screen.getByRole('button', { name: 'Apply' }).disabled).toBe(false)
  }, 20000)
})

describe('working signal (agent/trace.js)', () => {
  it('follows the commit and Undo marks with no trace or turn open, and tells subscribers once per change', () => {
    const fn = vi.fn()
    const off = subscribeWorking(fn)
    expect(isWorking()).toBe(false)
    mark('commit:start')
    mark('commit:start')
    expect(isWorking()).toBe(true)
    mark('prepared')                               // any other mark leaves it alone
    mark('commit:end')                             // the write landed; its save is still to come
    expect(isWorking()).toBe(true)
    mark('persist', 'ok')
    expect(isWorking()).toBe(false)
    mark('undo:start')
    expect(isWorking()).toBe(true)
    mark('undo:end')
    expect(isWorking()).toBe(false)
    expect(fn).toHaveBeenCalledTimes(4)
    off()
    mark('commit:start')
    mark('persist', 'ok')
    expect(fn).toHaveBeenCalledTimes(4)
  })
  it('a commit that never reaches its persist mark is cleared by traceEnd, and by turnEnd', () => {
    traceStart('t')
    mark('commit:start')
    traceEnd('done')
    expect(isWorking()).toBe(false)
    mark('commit:start')                           // no trace open: traceEnd still clears
    traceEnd('done')
    expect(isWorking()).toBe(false)
    turnStart('send')
    mark('commit:start')
    turnEnd()
    expect(isWorking()).toBe(false)
    mark('commit:start')                           // no turn open: turnEnd still clears
    turnEnd()
    expect(isWorking()).toBe(false)
  })
  it('a subscriber that throws never breaks a write', () => {
    const off = subscribeWorking(() => { throw new Error('reader') })
    expect(() => { mark('commit:start'); mark('persist', 'ok') }).not.toThrow()
    off()
  })
})

describe('the panel header during real execution', () => {
  it('a single command: Online → working during the write → Online after the receipt', async () => {
    const hold = holdWrites()
    const { board, send } = await mount()
    expect(status()).toBe('Online')
    send('change the timeframe to weekly')
    await waitFor(() => expect(hold.at()).toBe(1))
    expect(status()).toBe('UCT Agent is working')
    expect(composerLine()).toBe('UCT Agent is working')
    hold.release()
    await idle()
    expect(screen.getAllByTestId('agent-receipt')).toHaveLength(1)
    expect(tf(board)).toBe('W')
  }, 20000)

  it('a multi-step plan: working during EACH step\'s write, then Online once', async () => {
    const hold = holdPlans()
    const { send } = await mount()
    send('put the 9 and 20 ema on this chart, then make the fast one green and the slow one yellow')
    const finished = () => /All 2 steps done/.test(screen.getByTestId('agent-transcript').textContent)
    let writes = 0
    for (;;) {
      await waitFor(() => { if (!hold.at() && !finished()) throw new Error('waiting') }, { timeout: 8000 })
      if (!hold.at()) break
      expect(status()).toBe('UCT Agent is working')
      writes += 1
      hold.release()
      await waitFor(() => expect(isWorking() && hold.at() === 0).toBe(false), { timeout: 8000 })
    }
    await idle()
    expect(writes).toBeGreaterThanOrEqual(2)
  }, 30000)

  it('a refused write: back to Online, never stuck on working', async () => {
    const kind = getTargetKind('chart')
    let enter
    const reached = new Promise(res => { enter = res })
    let refuse
    vi.spyOn(kind, 'commit').mockImplementation(() => new Promise((_, rej) => { refuse = rej; enter() }))
    const { send } = await mount()
    send('change the timeframe to weekly')
    await reached
    await waitFor(() => expect(status()).toBe('UCT Agent is working'))
    refuse(new Error('nope'))
    await idle()
    expect(isWorking()).toBe(false)
    expect(screen.getByTestId('agent-transcript').textContent).toMatch(/nope/)
  }, 20000)

  it('commitPlan itself throwing (it never reaches persist): working clears, and the turn ends idle', async () => {
    const { h } = fixture()
    const { result } = renderHook(() => useAgent({ host: h }))
    let during = null
    commitPlan.mockImplementationOnce(async () => { during = isWorking(); throw new Error('boom') })
    await act(async () => { await expect(result.current.send('change the timeframe to weekly')).rejects.toThrow('boom') })
    expect(during).toBe(true)
    expect(isWorking()).toBe(false)
    expect(result.current.busy).toBe(false)
  }, 20000)

  it('Undo: working during the restore write, then Online', async () => {
    const { board, send } = await mount()
    send('change the timeframe to weekly')
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt')).toHaveLength(1), { timeout: 8000 })
    await idle()
    expect(tf(board)).toBe('W')
    const hold = holdWrites()
    send('undo')
    await waitFor(() => expect(hold.at()).toBe(1), { timeout: 8000 })
    expect(status()).toBe('UCT Agent is working')
    hold.release()
    await idle()
    expect(tf(board)).toBe('D')
  }, 20000)

  it('a refused Undo (nothing to undo) never shows working and ends Online', async () => {
    const seen = []
    const off = subscribeWorking(() => seen.push(isWorking()))
    const { send } = await mount()
    send('undo')
    await waitFor(() => expect(screen.getByTestId('agent-transcript').textContent).toMatch(/nothing of mine to undo/))
    await idle()
    off()
    expect(seen).toEqual([])
  }, 20000)

  it('busy with no write in flight is still "typing"', async () => {
    let answer
    globalThis.fetch = vi.fn((url) => {
      if (url === '/api/agent/turn') return new Promise(res => { answer = res })
      return Promise.resolve(new Response('{"conversations":[]}', { status: 200, headers: { 'content-type': 'application/json' } }))
    })
    const { send } = await mount()
    send('what do you think of breadth lately and why does it matter')
    await waitFor(() => expect(status()).toBe('typing'))
    expect(composerLine()).toBe('UCT Agent is typing…')
    expect(isWorking()).toBe(false)
    answer(new Response(JSON.stringify({ conversationId: 'ac_1', envelope: { disposition: 'answer', reply: 'ok', question: null, ops: [], unsupported_category: null }, usage: { research_calls: 0, citations: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await idle()
  }, 20000)

  it('a commit\'s save: header and composer stay on working until the save ends, then Online', async () => {
    const { h, send } = await mount()
    const save = holdSave(h)
    send('change the timeframe to weekly')
    await waitFor(() => expect(save.at()).toBe(1), { timeout: 8000 })
    // the write is done and read back: its receipt is up, saying so; nothing else about the turn has ended
    expect(screen.getByTestId('agent-receipt').getAttribute('data-saving')).toBe('true')
    expect(status()).toBe('UCT Agent is working')
    expect(composerLine()).toBe('UCT Agent is working')
    save.finish()
    await idle()
    expect(screen.getAllByTestId('agent-receipt')).toHaveLength(1)
  }, 20000)

  it.each([
    ['refused', (save) => save.finish({ ok: false, reason: 'not-saved' })],
    ['rejected', (save) => save.fail(new Error('network'))],
  ])('a commit\'s save that is %s: never stuck on working', async (_, end) => {
    const { h, send } = await mount()
    const save = holdSave(h)
    send('change the timeframe to weekly')
    await waitFor(() => expect(save.at()).toBe(1), { timeout: 8000 })
    expect(status()).toBe('UCT Agent is working')
    end(save)
    await idle()
    expect(isWorking()).toBe(false)
    expect(transcript()).toMatch(/not saved/i)
  }, 20000)

  it('Undo\'s save is NOT covered (it runs in useAgent.js, after undo:end): typing until it ends, then Online', async () => {
    const { h, send } = await mount()
    send('change the timeframe to weekly')
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt')).toHaveLength(1), { timeout: 8000 })
    await idle()
    const save = holdSave(h)
    send('undo')
    await waitFor(() => expect(save.at()).toBe(1), { timeout: 8000 })
    await waitFor(() => expect(status()).toBe('typing'))
    expect(composerLine()).toBe('UCT Agent is typing…')
    save.finish()
    await idle()
  }, 20000)

  it('partial failure, multi-step: step 1 lands, step 2 fails, and the header ends Online with the partial said', async () => {
    commitPlan.mockImplementationOnce(realCommitPlan)
    commitPlan.mockImplementationOnce(async () => ({ ok: false, lines: [], failed: [{ label: 'Chart', reason: 'did not take effect' }], undo: null }))
    const { send } = await mount()
    send('put the 9 and 20 ema on this chart, then make the fast one green and the slow one yellow')
    await waitFor(() => expect(transcript()).toMatch(/Done 1 of 2 steps, then stopped/), { timeout: 8000 })
    await idle()
    expect(isWorking()).toBe(false)
    expect(transcript()).not.toMatch(/All 2 steps done/)
  }, 20000)

  it('partial failure, compound write: the second chart fails, the first is taken back, and the header ends Online', async () => {
    const kind = getTargetKind('chart')
    const real = kind.commit
    let writes = 0
    const during = []
    vi.spyOn(kind, 'commit').mockImplementation(async (...args) => {
      writes += 1
      during.push(isWorking())
      if (writes === 2) throw new Error('nope')
      return real.apply(kind, args)
    })
    const { board, send } = await mount(['c1', 'c2'])
    send('change all the charts to weekly')
    await waitFor(() => expect(transcript()).toMatch(/nope/), { timeout: 8000 })
    await idle()
    expect(during.length).toBeGreaterThanOrEqual(3)     // both writes, and the write that takes the first back
    expect(during.every(Boolean)).toBe(true)
    expect(isWorking()).toBe(false)
    expect(board.state.widgets.map(w => w.opts.tf)).toEqual(['D', 'D'])
  }, 20000)

  it('partial failure, Undo: the second restore fails, the failure is said, and the header ends Online', async () => {
    const { send } = await mount(['c1', 'c2'])
    send('change all the charts to weekly')
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt')).toHaveLength(1), { timeout: 8000 })
    await idle()
    const kind = getTargetKind('chart')
    const real = kind.commit
    let writes = 0
    vi.spyOn(kind, 'commit').mockImplementation(async (...args) => {
      writes += 1
      if (writes === 2) throw new Error('nope')
      return real.apply(kind, args)
    })
    send('undo')
    await waitFor(() => expect(transcript()).toMatch(/could not be undone \(nope\)\. Already restored/), { timeout: 8000 })
    await idle()
    expect(isWorking()).toBe(false)
  }, 20000)

  it('approval, Apply: working during the approved write, then Online', async () => {
    const hold = holdWrites()
    scriptProposal()
    const { board, send } = await mount()
    send('set this up for swing trading')
    const apply = await screen.findByRole('button', { name: 'Apply' })
    await waitFor(() => expect(apply.disabled).toBe(false))
    expect(status()).toBe('Online')
    fireEvent.click(apply)
    await waitFor(() => expect(hold.at()).toBe(1), { timeout: 8000 })
    expect(status()).toBe('UCT Agent is working')
    hold.release()
    await idle()
    expect(tf(board)).toBe('W')
  }, 20000)

  it('cancelled, Dismiss on the card: nothing is written and working never shows', async () => {
    const seen = []
    const off = subscribeWorking(() => seen.push(isWorking()))
    scriptProposal()
    const { board, send } = await mount()
    send('set this up for swing trading')
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' })
    await waitFor(() => expect(dismiss.disabled).toBe(false))
    fireEvent.click(dismiss)
    await idle()
    off()
    expect(seen).toEqual([])
    expect(tf(board)).toBe('D')
  }, 20000)

  it('cancelled, New chat during a write: the write is not abortable, so working stays true until it really ends', async () => {
    const hold = holdWrites()
    const { send } = await mount()
    send('change the timeframe to weekly')
    await waitFor(() => expect(hold.at()).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(status()).toBe('UCT Agent is working')
    hold.release()
    await idle()
    expect(isWorking()).toBe(false)
  }, 20000)

  it('cancelled, panel closed during a write: a reopened panel shows the real state, then Online', async () => {
    const hold = holdWrites()
    const { h, view, send } = await mount()
    send('change the timeframe to weekly')
    await waitFor(() => expect(hold.at()).toBe(1))
    view.unmount()
    panel(h)
    expect(status()).toBe('UCT Agent is working')
    hold.release()
    await idle()
    expect(isWorking()).toBe(false)
  }, 20000)
})
