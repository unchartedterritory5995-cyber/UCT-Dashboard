// W2-C1 — the Agent on /breadth: a READ-ONLY page host; the breadth data capabilities work here as on /charts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

import AgentPanel from './AgentPanel'
import { buildBreadthPageHost } from './hosts/pageHosts'
import { describeBreadthPage } from './capabilities/breadthPage'

function makePage(over = {}) {
  const page = { tab: 'breadth', days: 90, topDate: '2026-11-02', rowCount: 62, columns: ['A20', 'A50', 'A200', 'NH', 'NL'], live: true, loading: false, ...over }
  return { page, host: buildBreadthPageHost({ read: () => page, location: () => '/breadth', navigate: () => {} }) }
}

let turns
let turnBodies
let fetched
beforeEach(() => {
  turns = []
  turnBodies = []
  fetched = []
  try { localStorage.clear() } catch { /* */ }
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = vi.fn(async (url, init) => {
    fetched.push(String(url))
    const body = init?.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn') { turnBodies.push(body); const next = turns.shift(); return json({ conversationId: 'ac_1', turnId: 1, envelope: typeof next === 'function' ? next(body) : next, usage: { citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    if (String(url).startsWith('/api/agent/breadth/dates')) return json({ today_et: '2026-11-03', latest_finalized: { us: '2026-11-02', nyse: '2026-11-02', nasdaq: '2026-11-02', uct: '2026-11-02' } })
    if (String(url).startsWith('/api/agent/breadth')) return json({ text: 'US breadth 2026-11-02 (final): 41.2% above the 50-day' })
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
const mount = (host) => render(<AgentPanel host={host} surface="breadth" onClose={() => {}} />)

describe('UCT Agent on /breadth (W2-C1)', () => {
  it('READ: "what does this page show?" is answered from the page — no model call', async () => {
    const { host } = makePage()
    mount(host)
    type('what does this page show?')
    await screen.findAllByText(/the daily breadth sheet showing the last 90 days, newest session 2026-11-02/)
    expect(screen.getAllByText(/62 session rows are on the sheet, columns: A20, A50, A200, NH, NL/).length).toBeGreaterThan(0)
    expect(turnBodies).toHaveLength(0)
  })

  it('the page host is read only: the manifest offers the breadth reads and no write on this page', async () => {
    const { host } = makePage()
    mount(host)
    turns.push(env('answer', [], 'ok'))
    type('hello there')
    await screen.findByText('ok')
    const caps = turnBodies[0].capabilities
    const names = caps.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['breadth.page', 'breadth.show', 'breadth.history', 'stock.profile', 'app.open']))
    expect(caps.filter(c => c.name.startsWith('breadth.')).every(c => c.query)).toBe(true)
    expect(names.some(n => n.startsWith('chart.') || n.startsWith('widget.') || n.startsWith('screener.openSaved') || n.startsWith('journal.'))).toBe(false)
    expect(turnBodies[0].context.surface).toBe('breadth')
    expect(turnBodies[0].context.breadthPage[0]).toMatchObject({ tab: 'breadth', days: 90, topDate: '2026-11-02', rows: 62 })
  })

  it('DATA: the model routes a reading to breadth.show, which reads /api/agent/breadth here exactly as on /charts', async () => {
    const { host } = makePage()
    mount(host)
    turns.push((body) => env('apply', [{ action: 'breadth.show', target: body.context.breadth[0].ref, args: { mode: 'value', universe: 'us', metrics: ['pct_above_50sma'], date: null, compare_date: null, start: null, end: null, basis: null, side: null, sessions: null } }], 'Here is the reading.'))
    type('how is US breadth looking now?')
    await screen.findByText(/41\.2% above the 50-day/)
    expect(fetched.some(u => u.startsWith('/api/agent/breadth') && !u.includes('/dates'))).toBe(true)
  })

  it('other tabs are described honestly (no sheet to read)', () => {
    expect(describeBreadthPage({ tab: 'charts' })).toBe("You're on Data Charts of the Breadth page.")
    expect(describeBreadthPage({ tab: 'breadth', loading: true, rowCount: 0 })).toMatch(/still loading/)
    expect(describeBreadthPage(null)).toMatch(/not available here/)
  })
})
