// UCT Agent — a plan that changes nothing is never proposed. A `noop` on a `risk: 'confirm'` capability used to offer an Apply
// card with nothing to apply ("clear" on an empty list); the member is told plainly instead, and nothing is written.
// The REAL panel (AgentPanel → useAgent → planner → policy) with a scripted model. No network, no paid call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { getCapability } from './capabilities'
import { collectTargets, planOps, prepareOps } from './executor'
import { decideMode } from './policy'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

let script
const env = (o) => ({ conversationId: 'c1', envelope: { disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, ...o }, usage: {} })
beforeEach(() => {
  script = () => env({ reply: 'ok' })
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    if (u === '/api/agent/turn' || u === '/api/agent/turn/stream') return json(script(body))
    if (u === '/api/agent/record') return json({ conversationId: 'c1' })
    if (u === '/api/agent/config') return json({ stream: false })
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const board = () => makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 18, h: 20, opts: { tf: 'D' } }], { A: 'NVDA' }, {
  watchlists: [{ id: 'e1', name: 'Empty', symbols: [] }, { id: 's1', name: 'Swing', symbols: ['TSLA'] }],
})
const listRef = (body, name) => (body.context.watchlists || []).find(l => l.name === name)?.ref
const op = (action, target, args = {}) => ({ action, target, args })
const ops = (disposition, ...list) => env({ disposition, ops: list, reply: 'Here is the plan.' })
const items = (b, id) => b.state.server.lists.find(l => l.id === id).items.map(i => i.sym)
function mount(host) {
  render(<AgentPanel host={host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => {
    await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
    fireEvent.change(box, { target: { value: t } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
    await waitFor(() => expect(document.querySelector('[data-testid=agent-typing]')).toBeNull(), { timeout: 8000 })
  }
  return { say, transcript: () => screen.getByTestId('agent-transcript').textContent }
}
const noCard = () => {
  expect(screen.queryByTestId('agent-proposal')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
}

describe('decideMode: nothing to change means nothing to approve', () => {
  const realPlan = async (host, list) => planOps(collectTargets(host, ['watchlist']), list, await prepareOps(list), { surface: 'charts' })
  it('a confirm-risk noop, whoever suggested what', async () => {
    const { host } = board()
    expect(getCapability('watchlist.clear').risk).toBe('confirm')
    const p = await realPlan(host, [op('watchlist.clear', 'e1')])
    expect(p.ok).toBe(true)
    expect(p.changed).toBe(false)
    expect(p.noops).toEqual(['“Empty” is already empty'])
    expect(decideMode('apply', p)).toBe('apply')
    expect(decideMode('propose', p)).toBe('apply')
  })
  it('⛔ the same capability with something to do still needs approval, on every suggestion', async () => {
    const { host } = board()
    const p = await realPlan(host, [op('watchlist.clear', 's1')])
    expect(p.changed).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    expect(decideMode('propose', p)).toBe('propose')
  })
  it('an irreversible change still needs approval; a model `propose` of a real local change is still a proposal', async () => {
    const { host } = board()
    expect(decideMode('apply', await realPlan(host, [op('watchlist.delete', 's1')]))).toBe('propose')
    const local = { changed: true, plans: [] }
    expect(decideMode('propose', local)).toBe('propose')
    expect(decideMode('apply', local)).toBe('apply')
  })
  it('a plan that does not say it is unchanged is not treated as unchanged', () => {
    expect(decideMode('propose', { plans: [] })).toBe('propose')
  })
})

describe('through the real panel: what the member sees', () => {
  it.each(['apply', 'propose'])('watchlist.clear on an empty list (model says %s): told so, no card, nothing written', async (disposition) => {
    const b = board()
    const { say, transcript } = mount(b.host)
    script = (body) => ops(disposition, op('watchlist.clear', listRef(body, 'Empty')))
    await say('empty my empty watchlist')
    await waitFor(() => expect(transcript()).toMatch(/Nothing to change — “Empty” is already empty\./))
    noCard()
    expect(items(b, 'e1')).toEqual([])
    expect(items(b, 's1')).toEqual(['TSLA'])
  })
  it.each(['apply', 'propose'])('watchlist.rename to the name it has (model says %s): told so, no card', async (disposition) => {
    const b = board()
    const { say, transcript } = mount(b.host)
    script = (body) => ops(disposition, op('watchlist.rename', listRef(body, 'Swing'), { name: 'Swing' }))
    await say('call my swing list the same thing')
    await waitFor(() => expect(transcript()).toMatch(/Nothing to change/))
    noCard()
    expect(b.state.server.lists.find(l => l.id === 's1').name).toBe('Swing')
  })
  it('after a noop there is nothing waiting: "do it" runs nothing', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    script = (body) => ops('propose', op('watchlist.clear', listRef(body, 'Empty')))
    await say('empty my empty watchlist')
    await waitFor(() => expect(transcript()).toMatch(/Nothing to change/))
    script = () => env({ reply: 'Nothing is waiting.' })
    await say('do it')
    noCard()
    expect(items(b, 's1')).toEqual(['TSLA'])
  })
  it('a list with something in it still gets its card, and only Apply clears it', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    script = (body) => ops('propose', op('watchlist.clear', listRef(body, 'Swing')))
    await say('empty my swing watchlist')
    await waitFor(() => expect(transcript()).toMatch(/Clear all 1 stock from “Swing”/))
    expect(screen.getAllByTestId('agent-proposal')).toHaveLength(1)
    expect(items(b, 's1')).toEqual(['TSLA'])
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(items(b, 's1')).toEqual([]))
  })
  it('a noop beside a real change: the change keeps its one card and nothing runs before Apply', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    script = (body) => ops('propose', op('watchlist.clear', listRef(body, 'Empty')), op('watchlist.clear', listRef(body, 'Swing')))
    await say('empty both lists')
    await waitFor(() => expect(transcript()).toMatch(/Clear all 1 stock from “Swing”/))
    expect(screen.getAllByTestId('agent-proposal')).toHaveLength(1)
    expect(items(b, 's1')).toEqual(['TSLA'])
  })
})
