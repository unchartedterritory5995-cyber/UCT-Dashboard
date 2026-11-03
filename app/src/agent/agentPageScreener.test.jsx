// W2-C1 — the Agent on /screener: the page host (pageHosts.buildScreenerPageHost) through the real panel.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

import AgentPanel from './AgentPanel'
import { buildScreenerPageHost } from './hosts/pageHosts'

const SAVED = [{ id: 's1', name: 'Breakout', spec: { filters: [{ key: 'price', op: 'gt', value: 10 }] } }, { id: 's2', name: 'Pullback', spec: { filters: [] } }]
const STARTERS = [{ id: 'st1', name: 'Momentum Leaders', spec: { filters: [] } }]

function makePage({ current = { id: 's1', name: 'Breakout', kind: 'saved' }, rows = [{ ticker: 'NVDA' }, { ticker: 'AMD' }, { ticker: 'PLTR' }], total = 3, edited = false } = {}) {
  const page = { current, rows, total, edited, filters: ['price'], applied: [] }
  const host = buildScreenerPageHost({
    read: () => ({ rows: page.rows, total: page.total, current: page.current, filters: page.filters, edited: page.edited }),
    saved: () => ({ saved: SAVED, starters: STARTERS }),
    applyScreen: (spec, item) => { page.applied.push(item); page.current = { id: item.id, name: item.name, kind: item.kind }; page.edited = false },
    refreshSaved: () => {},
    location: () => '/screener',
    navigate: () => {},
  })
  return { page, host }
}

let turns
let turnBodies
beforeEach(() => {
  turns = []
  turnBodies = []
  try { localStorage.clear() } catch { /* */ }
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = vi.fn(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn') { turnBodies.push(body); const next = turns.shift(); return json({ conversationId: 'ac_1', turnId: 1, envelope: typeof next === 'function' ? next(body) : next, usage: { citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    if (String(url).startsWith('/api/screener/saved-screens')) return json({ saved: SAVED, starters: STARTERS })
    if (String(url).startsWith('/api/screener/fields')) return json({ fields: [{ key: 'price', label: 'Price', type: 'number', unit: '$' }] })
    return json({})
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const env = (disposition, ops = [], reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}
const mount = (host) => render(<AgentPanel host={host} surface="screener" onClose={() => {}} />)

describe('UCT Agent on /screener (W2-C1)', () => {
  it('READ: "what screen is on this page?" answers from the page itself — no model call', async () => {
    const { host } = makePage()
    mount(host)
    type('what screen is on this page?')
    await screen.findAllByText(/The page shows Breakout — 3 matches/)
    expect(screen.getAllByText(/First on screen: NVDA, AMD, PLTR/).length).toBeGreaterThan(0)
    expect(turnBodies).toHaveLength(0)
  })

  it('WRITE: "open my Pullback screen" goes through the page\'s own door, receipts, and Undo puts the previous screen back', async () => {
    const { page, host } = makePage()
    mount(host)
    type('open my Pullback screen')
    const receipt = await screen.findByTestId('agent-receipt')
    expect(receipt.textContent).toContain('Opened “Pullback” on the Screener page (was “Breakout”)')
    expect(page.applied.map(i => i.id)).toEqual(['s2'])
    expect(page.current.id).toBe('s2')
    expect(turnBodies).toHaveLength(0)
    type('undo that')
    await screen.findByText(/Undid: Opened “Pullback”/)
    expect(page.applied.map(i => i.id)).toEqual(['s2', 's1'])
    expect(page.current.id).toBe('s1')
  })

  it('MODEL: an unknown screen name is refused with the real names; the manifest is this page\'s (no chart controls, the queries, the page writes)', async () => {
    const { page, host } = makePage()
    mount(host)
    turns.push((body) => env('apply', [{ action: 'screener.openSaved', target: body.context.screenerPage[0].ref, args: { screen: 'Gap Ups' } }]))
    type('open the gap ups screen please')
    await screen.findByText(/I couldn't find a saved screen called “Gap Ups” \(your screens: Breakout, Pullback, Momentum Leaders\)/)
    expect(page.applied).toHaveLength(0)
    // routed to the screener group (its words): the page's own capabilities ride with the engine's
    const names = turnBodies[0].capabilities.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['screener.page', 'screener.openSaved', 'screener.runSaved', 'screener.saveAs', 'agent.capabilities']))
    expect(names.some(n => n.startsWith('chart.') || n.startsWith('widget.') || n.startsWith('layout.') || n.startsWith('journal.'))).toBe(false)
    expect(turnBodies[0].context.surface).toBe('screener')
    expect(turnBodies[0].context.screenerPage[0]).toMatchObject({ screen: 'Breakout', matches: 3, firstRows: ['NVDA', 'AMD', 'PLTR'], canOpen: true })
    // a message nothing routes: the whole surface's manifest — the queries offered everywhere, no chart control
    await screen.findByText('Online')
    turns.push(env('answer', [], 'hi'))
    type('hello there')
    await screen.findByText('hi')
    const all = turnBodies[1].capabilities.map(c => c.name)
    expect(all).toEqual(expect.arrayContaining(['screener.page', 'screener.openSaved', 'stock.profile', 'news.latest', 'breadth.show', 'guide.explain', 'app.open', 'agent.capabilities']))
    expect(all.some(n => n.startsWith('chart.') || n.startsWith('widget.') || n.startsWith('layout.') || n.startsWith('journal.') || n.startsWith('calendar.'))).toBe(false)
  })

  it('HONEST: a layout without a door (no applyScreen) offers no way to open a screen', async () => {
    const page = { current: null, rows: [], total: null }
    const host = buildScreenerPageHost({ read: () => page, saved: () => ({ saved: SAVED, starters: [] }), location: () => '/screener' })
    mount(host)
    turns.push((body) => env('apply', [{ action: 'screener.openSaved', target: body.context.screenerPage[0].ref, args: { screen: 's1' } }]))
    type('open the breakout screen on this page')
    await screen.findByText(/This Screener layout has no door I can open a screen through/)
  })

  it('a chart phrase on this page is not claimed by the fast path (no chart here) — it goes to the model', async () => {
    const { host } = makePage()
    mount(host)
    turns.push(env('answer', [], 'There is no chart on this page — open Charts for that.'))
    type('switch this chart to weekly')
    await screen.findByText(/There is no chart on this page/)
    expect(turnBodies).toHaveLength(1)
  })
})
