// INTEGRATION: Response Experience × Natural Language Intelligence (2026-10-12) — the combined panel.
// The owner's acceptance list, end to end through the real panel (scripted model, mocked routes):
//   a misspelled command → the correct concise receipt; an ambiguous command asks; "add it to
//   momentum" never adds the ticker IT; a valid selected chart takes a bare timeframe command and the
//   receipt NAMES it; a stale selection asks; a company name resolves to its ticker; restored results
//   and receipts come back with no empty container.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { _resetGrounding } from './nl/tickers'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const SEARCH = {
  NVIDIA: [{ ticker: 'NVDA', name: 'NVIDIA Corporation', type: 'stock' }, { ticker: 'NVDL', name: 'GraniteShares 2x Long NVDA Daily ETF', type: 'etf' }],
}
let turns, records
beforeEach(() => {
  turns = []; records = []
  _resetGrounding()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') {
      turns.push(JSON.parse(init.body))
      return json({ conversationId: 'c1', envelope: { disposition: 'answer', reply: 'Which stock do you mean by “it”?', question: null, ops: [], unsupported_category: null }, usage: {} })
    }
    if (url === '/api/agent/record') { records.push(JSON.parse(init.body)); return json({ conversationId: 'c1' }) }
    if (String(url).startsWith('/api/ticker-search')) {
      const q = new URL(url, 'http://x').searchParams.get('q')?.toUpperCase()
      return json({ results: SEARCH[q] || [] })
    }
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

function mount({ charts = 1, selected = null, lists = null } = {}) {
  const ws = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }]
  if (charts > 1) ws.push({ id: 'c2', type: 'chart', x: 12, y: 0, w: 12, h: 20 })
  const b = makeBoard(ws, { A: 'AAPL' }, lists ? { watchlists: lists } : {})
  // the chart the member last CLICKED (Context 1B): marked on the snapshot, as host.js does
  const sel = (c) => (c && selected && c.ref === selected ? { ...c, selected: true } : c)
  const { list, read } = b.host.charts
  b.host.charts = { ...b.host.charts, list: () => list().map(sel), read: (id) => sel(read(id)), selected: () => (selected && read(selected) ? selected : null) }
  render(<AgentPanel host={b.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 }); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { ...b, say }
}
const tf = (b, id) => b.state.widgets.find(w => w.id === id).opts?.tf || 'D'
const emptyContainers = () => {
  const t = document.querySelector('[data-testid="agent-transcript"]')
  return [...t.querySelectorAll('[class*="agentRow"]')].filter(r => {
    const c = r.querySelector('[class*="bubble"], [data-testid=agent-result], [data-testid=agent-receipt], [data-testid=agent-proposal], [data-testid=agent-question]')
    return !c || !c.textContent.trim()
  }).length
}

describe('the combined panel: NL resolution × response presentation', () => {
  it('a MISSPELLED command → the right change and a concise receipt (no model call)', async () => {
    const b = mount()
    await b.say('swtich to weeky')
    const r = await screen.findByTestId('agent-receipt', {}, { timeout: 6000 })
    expect(r.textContent).toMatch(/^Switched timeframe to Weekly/)
    expect(tf(b, 'c1')).toBe('W')
    expect(turns).toHaveLength(0)
    expect(emptyContainers()).toBe(0)
  })

  it('an AMBIGUOUS command (two charts, none selected) asks — nothing changes', async () => {
    const b = mount({ charts: 2 })
    await b.say('switch to weekly')
    const q = await screen.findByTestId('agent-question', {}, { timeout: 6000 })
    expect(q.textContent).toMatch(/Which chart\?/)
    expect([tf(b, 'c1'), tf(b, 'c2')]).toEqual(['D', 'D'])
    expect(screen.queryByTestId('agent-receipt')).toBeNull()
  })

  it('"add it to momentum" never adds the ticker IT', async () => {
    const b = mount({ lists: [{ id: 'm1', name: 'Momentum', symbols: ['NVDA'] }] })
    await b.say('add it to momentum')
    await waitFor(() => expect(turns.length + records.length).toBeGreaterThan(0), { timeout: 6000 })
    const syms = b.state.server.lists.find(l => l.name === 'Momentum').items.map(i => i.sym)
    expect(syms).not.toContain('IT')
    expect(screen.queryByTestId('agent-receipt')).toBeNull()
  })

  it('a VALID selected chart takes a bare timeframe command — and the receipt NAMES it', async () => {
    const b = mount({ charts: 2, selected: 'c2' })
    await b.say('switch to weekly')
    const r = await screen.findByTestId('agent-receipt', {}, { timeout: 6000 })
    expect([tf(b, 'c1'), tf(b, 'c2')]).toEqual(['D', 'W'])
    expect(r.textContent).toMatch(/Switched timeframe to Weekly/)
    expect(r.textContent).toMatch(/the chart you last clicked/)
    expect(r.textContent).toMatch(/c2/)
  })

  it('a STALE selection (the clicked chart is gone) asks instead of guessing', async () => {
    const b = mount({ charts: 2, selected: 'c9' })
    await b.say('switch to weekly')
    expect((await screen.findByTestId('agent-question', {}, { timeout: 6000 })).textContent).toMatch(/Which chart\?/)
    expect([tf(b, 'c1'), tf(b, 'c2')]).toEqual(['D', 'D'])
  })

  it('a COMPANY NAME resolves to its ticker (never the leveraged ETF); the receipt names the company', async () => {
    const b = mount()
    await b.say('pull up nvidia')
    const r = await screen.findByTestId('agent-receipt', {}, { timeout: 6000 })
    expect(r.textContent).toMatch(/NVDA \(NVIDIA Corporation\)/)
    expect(b.host.charts.read('c1').symbol).toBe('NVDA')
  })

  it('a receipt from a corrected command is saved with its lines, so it restores as a receipt card', async () => {
    const b = mount()
    await b.say('swtich to weeky')
    await waitFor(() => expect(records.some(r => r.outcomeData?.kind === 'applied')).toBe(true), { timeout: 6000 })
    const row = records.find(r => r.outcomeData?.kind === 'applied')
    expect(row.outcomeData.lines[0]).toMatch(/^Switched timeframe to Weekly/)
  })
})
