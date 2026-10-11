// PHASE 1 — INTELLIGENCE, AUTONOMY & EXECUTION (docs/agent/PHASE1-INTELLIGENCE.md).
//
// The PRIMARY ACCEPTANCE CASE, end to end through the real panel, planner, composer, runtime and
// receipts, with the model SCRIPTED (no paid call) as the plan a correct model returns from this
// manifest:
//   "Make me a watchlist of all software stocks over $10 that trade over $10 million in daily
//    dollar volume, and open it in my workspace."
// …and its failure / recovery / follow-up / Undo variants. Every number checked below is computed
// HERE from the fixture universe, independently of the code under test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { _resetScreenerCache, loadMeta, FILL_MAX } from './capabilities/screener'
import { _resetLastCreated } from './capabilities/watchlist'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

// ── the fixture market: 1,500 stocks, a real FMP-style industry taxonomy, one session's bars ──
const INDUSTRIES = ['Software - Application', 'Software - Infrastructure', 'Semiconductors', 'Banks - Regional', 'Biotechnology']
const UNIVERSE = Array.from({ length: 1500 }, (_, i) => ({
  ticker: `S${String(i).padStart(4, '0')}`,
  industry: i % 7 === 6 ? null : INDUSTRIES[i % INDUSTRIES.length],      // some rows unclassified
  price: 4 + (i % 40),                                                    // the SNAPSHOT price (may differ)
  close: 3 + ((i * 7) % 45) + 0.5,                                        // the SESSION close
  volume: 50_000 + ((i * 13) % 900) * 1_000,                              // the SESSION volume
}))
const SESSION = '2026-10-09'
const isSoftware = (r) => r.industry === 'Software - Application' || r.industry === 'Software - Infrastructure'
const EXPECTED = UNIVERSE.filter(r => isSoftware(r) && r.close > 10 && r.close * r.volume > 10_000_000).map(r => r.ticker)

let calls, turnsQueue, sessionDown, total
beforeEach(() => {
  _resetScreenerCache()
  _resetLastCreated()
  try { localStorage.clear() } catch { /* */ }
  calls = []; turnsQueue = []; sessionDown = false; total = null
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') {
      return json({ fields: [
        { key: 'price', label: 'Price', type: 'range', unit: '$', category: 'descriptive' },
        { key: 'dollar_vol_30d', label: 'Dollar Volume (30d)', type: 'range', unit: '$', category: 'descriptive' },
        { key: 'sector', label: 'Sector', type: 'enum', category: 'descriptive' },
        { key: 'industry', label: 'Industry', type: 'enum', category: 'descriptive' },
      ] })
    }
    if (url === '/api/screener/fields?options=1') {
      const classified = UNIVERSE.filter(r => r.industry).length
      return json({ options: {
        industry: { values: [...INDUSTRIES].sort(), with_value: classified, total: UNIVERSE.length },
        sector: { values: ['Financial Services', 'Healthcare', 'Technology'], with_value: classified, total: UNIVERSE.length },
      } })
    }
    if (url === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (url === '/api/screener/scan') {
      const ok = (r, f) => (f.op === 'in' ? f.values.includes(r[f.key]) : f.op === 'gt' ? r[f.key] > f.min : true)
      const rows = UNIVERSE.filter(r => body.filters.every(f => ok(r, f)))
      const start = (body.page - 1) * body.page_size
      return json({ total: total ?? rows.length, rows: rows.slice(start, start + body.page_size).map(r => ({ ticker: r.ticker })), snapshot_date: '2026-10-10' })
    }
    if (url === '/api/agent/session-stats') {
      if (sessionDown) return json({ session: null, rows: {}, missing: body.symbols, error: "the latest session's market data isn't available right now" })
      const rows = {}
      for (const t of body.symbols) {
        const r = UNIVERSE.find(x => x.ticker === t)
        if (r) rows[t] = { close: r.close, volume: r.volume, dollar_volume: r.close * r.volume }
      }
      return json({ session: SESSION, rows, missing: [] })
    }
    if (url === '/api/agent/turn') {
      const next = turnsQueue.shift()
      return json({ conversationId: 'ac_1', envelope: typeof next === 'function' ? next(body) : next, usage: { research_calls: 0, citations: [] } })
    }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/ticker-search')) return json({ results: [] })
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const refOf = (body, key) => body.context[key][0].ref
// The plan a correct model returns for the acceptance request (refs read from the context it was sent).
const SOFTWARE_PLAN = (body, { name = 'Software Over $10', industry = ['software'] } = {}) => env('propose', [
  { action: 'screener.run', target: refOf(body, 'screener'), args: {
    filters: [
      { field: 'industry', op: 'in', value: null, max: null, values: industry },
      { field: 'price', op: 'gt', value: 10, max: null, values: null },
      { field: 'dollar_volume_1d', op: 'gt', value: 10_000_000, max: null, values: null },
    ], sort_field: null, sort_dir: null, mode: 'new', show: null, as: 's1' } },
  { action: 'watchlist.create', target: refOf(body, 'watchlistLibrary'), args: { name, as: 'w1' } },
  { action: 'watchlist.add', target: 'w1', args: { symbols: { from: 's1', top: null } } },
  { action: 'watchlist.open', target: refOf(body, 'board'), args: { list: 'w1' } },
], 'Using the latest completed session’s close and dollar volume.')
const REQUEST = 'Make me a watchlist of all software stocks over $10 that trade over $10 million in daily dollar volume, and open it in my workspace.'

const WL_WIDGET = { id: 'wl-w', type: 'watchlist', x: 18, y: 0, w: 6, h: 20, opts: { watchKey: 'user:m1', watchName: 'Momentum', watchTab: 'mine' } }
const CHART = { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 }
async function mount(widgets = [CHART, WL_WIDGET]) {
  const board = makeBoard(widgets, { A: 'AAPL' }, { watchlists: [{ id: 'm1', name: 'Momentum', symbols: ['NVDA'] }] })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  await loadMeta()
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => {
    await waitFor(() => expect(box.disabled).toBe(false))
    fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' })
  }
  return { ...board, say }
}
const turnCalls = () => calls.filter(c => c[1] === '/api/agent/turn').length
const writes = (state) => state.server.calls.filter(c => c[0] !== 'GET')
const transcript = () => screen.getByTestId('agent-transcript').textContent
const settle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 8000 })

describe('PRIMARY ACCEPTANCE — software screen → new watchlist → filled with EVERY match → opened in the workspace', () => {
  it('one model call; one approval card for the whole objective; the full result set (not 50, not 100); opened in the Watchlist widget', async () => {
    const { state, say } = await mount()
    turnsQueue.push(SOFTWARE_PLAN)
    await say(REQUEST)
    const card = await screen.findByTestId('agent-proposal', {}, { timeout: 4000 })
    // The card is the WHOLE plan, in pending words, with no symbol guessed and nothing written yet.
    expect(card.textContent).toContain('Industry: Software - Application, Software - Infrastructure')
    expect(card.textContent).toContain('Close (latest session) > $10')
    expect(card.textContent).toContain('Dollar Volume (latest session) > $10M')
    expect(card.textContent).toContain('(latest completed session)')
    expect(card.textContent).toContain('Create the watchlist “Software Over $10”')
    expect(card.textContent).toContain('Add all of its results to “Software Over $10”')
    expect(card.textContent).toContain('Open “Software Over $10” in the Watchlist')
    expect(writes(state)).toHaveLength(0)
    expect(calls.filter(c => c[1] === '/api/screener/scan')).toHaveLength(0)
    expect(turnCalls()).toBe(1)

    await say('do it')
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt').length).toBe(2), { timeout: 8000 })
    expect(turnCalls()).toBe(1)                                       // approval + execution: no model call

    // The engine was asked ONLY for the software industries (price moved to the session close),
    // and read in full: every page.
    const scans = calls.filter(c => c[1] === '/api/screener/scan').map(c => c[2])
    expect(scans[0].filters).toEqual([{ key: 'industry', op: 'in', values: ['Software - Application', 'Software - Infrastructure'] }])
    const candidates = UNIVERSE.filter(isSoftware).length
    expect(scans).toHaveLength(Math.ceil(candidates / 500))
    const asked = calls.filter(c => c[1] === '/api/agent/session-stats').flatMap(c => c[2].symbols)
    expect(asked).toHaveLength(candidates)

    // The list: EXACTLY the independent answer, in the engine's order — more than the old 50 / 100 caps.
    expect(EXPECTED.length).toBeGreaterThan(100)
    const made = state.server.lists.find(l => l.name === 'Software Over $10')
    expect(made.items.map(i => i.sym)).toEqual(EXPECTED)
    expect(state.server.calls.filter(c => c[0] === 'POST' && c[1].endsWith('/items/bulk'))).toHaveLength(1)

    // Opened in the board's Watchlist widget through its own opts (the ?openWatchlist= door's write).
    expect(state.widgets.find(w => w.id === 'wl-w').opts).toMatchObject({ watchKey: `user:${made.id}`, watchName: 'Software Over $10', watchTab: 'mine' })

    // Receipts say what UCT did, with the real numbers and the session used.
    const [main, opened] = screen.getAllByTestId('agent-receipt').map(r => r.textContent)
    expect(main).toContain(`on ${SESSION}: ${EXPECTED.length} matches`)
    expect(main).toContain(`Industry is known for ${UNIVERSE.filter(r => r.industry).length.toLocaleString()} of the 1,500 stocks`)
    expect(main).toContain('Created the watchlist “Software Over $10”')
    expect(main).toContain(`Added ${EXPECTED.length} stocks to “Software Over $10”`)
    expect(opened).toContain('Opened “Software Over $10” in the Watchlist')
    expect(transcript()).not.toMatch(/how many|which software|up to 50/i)
  })

  it('NO Watchlist widget on the board: one is added in empty space, born showing the new list; Undo closes exactly it', async () => {
    const { state, say } = await mount([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }])
    turnsQueue.push(SOFTWARE_PLAN)
    await say(REQUEST)
    await screen.findByTestId('agent-proposal', {}, { timeout: 4000 })
    await say('do it')
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt').length).toBe(2), { timeout: 8000 })
    const made = state.server.lists.find(l => l.name === 'Software Over $10')
    const added = state.widgets.filter(w => w.type === 'watchlist')
    expect(added).toHaveLength(1)
    expect(added[0].opts).toMatchObject({ watchKey: `user:${made.id}` })
    expect(screen.getAllByTestId('agent-receipt')[1].textContent).toContain('Opened “Software Over $10” in a new Watchlist widget')
    await settle()
    await say('undo')
    await waitFor(() => expect(state.widgets.some(w => w.type === 'watchlist')).toBe(false), { timeout: 4000 })
    expect(state.widgets.map(w => w.id)).toEqual(['c1'])
    expect(state.server.lists.some(l => l.name === 'Software Over $10')).toBe(true)     // Undo never deletes a list
  })

  it('NO room and no Watchlist widget: said BEFORE anything runs; the list is still made and filled; nothing pretends it opened', async () => {
    const { state, say } = await mount([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20 }])
    turnsQueue.push(SOFTWARE_PLAN)
    await say(REQUEST)
    const card = await screen.findByTestId('agent-proposal', {}, { timeout: 4000 })
    expect(transcript()).toContain('not this part: There\'s no Watchlist widget on this board and no empty space for one')
    expect(card.textContent).not.toContain('Open “Software Over $10”')
    await say('do it')
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt').length).toBe(1), { timeout: 8000 })
    await settle()
    expect(state.server.lists.find(l => l.name === 'Software Over $10').items).toHaveLength(EXPECTED.length)
    expect(transcript()).not.toContain('Opened “Software Over $10”')
  })

  it('PARTIAL FAILURE: the open step fails after the list was made — the list and its stocks are KEPT, never re-created, and the member is told exactly what happened', async () => {
    const { state, say } = await mount()
    turnsQueue.push(SOFTWARE_PLAN)
    await say(REQUEST)
    await screen.findByTestId('agent-proposal', {}, { timeout: 4000 })
    state.failApplyBoard = true                                        // the board refuses the open
    await say('do it')
    await waitFor(() => expect(transcript()).toContain('was still created and filled'), { timeout: 8000 })
    const lists = state.server.lists.filter(l => l.name === 'Software Over $10')
    expect(lists).toHaveLength(1)
    expect(lists[0].items).toHaveLength(EXPECTED.length)
    expect(transcript()).toContain('say “open Software Over $10” to try again')
    expect(state.widgets.find(w => w.id === 'wl-w').opts.watchKey).toBe('user:m1')
    // Recovery with the existing capability: the fast path (no model call) re-opens the SAME list.
    state.failApplyBoard = false
    const t = turnCalls()
    await settle()
    await say('open Software Over $10')
    await waitFor(() => expect(state.widgets.find(w => w.id === 'wl-w').opts.watchKey).toBe(`user:${lists[0].id}`), { timeout: 4000 })
    expect(turnCalls()).toBe(t)
    expect(state.server.lists.filter(l => l.name === 'Software Over $10')).toHaveLength(1)
  })
})

describe('honest limits — refused with the real reason, nothing written', () => {
  it('more matches than one request carries: refused with the real count — never a silent first-N', async () => {
    const { state, say } = await mount()
    total = FILL_MAX + 250                                            // the engine says 1,250 candidates
    turnsQueue.push((body) => env('propose', [
      { action: 'screener.run', target: refOf(body, 'screener'), args: { filters: [{ field: 'price', op: 'gt', value: 1, max: null, values: null }], sort_field: null, sort_dir: null, mode: 'new', show: null, as: 's1' } },
      { action: 'watchlist.create', target: refOf(body, 'watchlistLibrary'), args: { name: 'Everything', as: 'w1' } },
      { action: 'watchlist.add', target: 'w1', args: { symbols: { from: 's1', top: null } } },
    ]))
    await say('put every stock over $1 in a new watchlist')
    await screen.findByTestId('agent-proposal', {}, { timeout: 4000 })
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/that's 1,250 stocks — more than the 1,000 I put in one request/), { timeout: 8000 })
    expect(state.server.lists.some(l => l.name === 'Everything')).toBe(false)
    expect(writes(state)).toHaveLength(0)
  })
  it('a word that matches no industry is refused with the REAL industry names (never guessed)', async () => {
    await loadMeta()
    const { loadOptions } = await import('./capabilities/screener')
    await loadOptions()
    const a = await getCapability('screener.run').answer(null, { filters: [{ field: 'industry', op: 'in', value: null, max: null, values: ['softwear'] }], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null })
    expect(a).toMatch(/the Screener has no Industry matching “softwear” \(it has Software - Application, Software - Infrastructure/)
    expect(calls.filter(c => c[1] === '/api/screener/scan')).toHaveLength(0)
  })
  it('"software" asked as a SECTOR is matched where it lives (Industry) and said so', async () => {
    await loadMeta()
    const { loadOptions } = await import('./capabilities/screener')
    await loadOptions()
    const a = await getCapability('screener.run').answer(null, { filters: [{ field: 'sector', op: 'in', value: null, max: null, values: ['software'] }], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null })
    expect(a.text).toContain('“software” is an Industry, so I matched it there')
    expect(calls.find(c => c[1] === '/api/screener/scan')[2].filters).toEqual([{ key: 'industry', op: 'in', values: ['Software - Application', 'Software - Infrastructure'] }])
  })
  it('the session data is unavailable: nothing is created, and the reason is said', async () => {
    const { state, say } = await mount()
    sessionDown = true
    turnsQueue.push(SOFTWARE_PLAN)
    await say(REQUEST)
    await screen.findByTestId('agent-proposal', {}, { timeout: 4000 })
    await say('do it')
    await waitFor(() => expect(transcript()).toContain("the latest session's market data isn't available right now"), { timeout: 8000 })
    expect(writes(state)).toHaveLength(0)
  })
})

describe('approval, duplicates and follow-ups', () => {
  it('a second "do it" never creates a second list (the approval was used once)', async () => {
    const { state, say } = await mount()
    turnsQueue.push(SOFTWARE_PLAN)
    await say(REQUEST)
    await screen.findByTestId('agent-proposal', {}, { timeout: 4000 })
    await say('do it')
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt').length).toBe(2), { timeout: 8000 })
    await settle()
    await say('do it')
    await waitFor(() => expect(transcript()).toContain('There is no proposal waiting'))
    expect(state.server.lists.filter(l => l.name === 'Software Over $10')).toHaveLength(1)
  })
  it('a list name already in use is refused before anything runs (never appended to silently)', async () => {
    const { state, say } = await mount()
    turnsQueue.push((body) => SOFTWARE_PLAN(body, { name: 'Momentum' }))
    await say(REQUEST)
    await waitFor(() => expect(transcript()).toContain('You already have a watchlist named “Momentum”'), { timeout: 4000 })
    expect(writes(state)).toHaveLength(0)
  })
  it('"open the watchlist you just made" resolves from the preceding workflow — fast path, no model call', async () => {
    const { state, say } = await mount([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20 }])
    turnsQueue.push(SOFTWARE_PLAN)
    await say(REQUEST)
    await screen.findByTestId('agent-proposal', {}, { timeout: 4000 })
    await say('do it')
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt').length).toBe(1), { timeout: 8000 })
    await settle()
    // The member makes room (closes the chart), then asks for the list just made.
    state.widgets = []
    const t = turnCalls()
    await say('open the watchlist you just made')
    const made = state.server.lists.find(l => l.name === 'Software Over $10')
    await waitFor(() => expect(state.widgets.find(w => w.type === 'watchlist')?.opts?.watchKey).toBe(`user:${made.id}`), { timeout: 4000 })
    expect(turnCalls()).toBe(t)
  })
  it('the open step is undoable: "undo" puts the widget\'s previous list back', async () => {
    const { state, say } = await mount()
    turnsQueue.push(SOFTWARE_PLAN)
    await say(REQUEST)
    await screen.findByTestId('agent-proposal', {}, { timeout: 4000 })
    await say('do it')
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt').length).toBe(2), { timeout: 8000 })
    await settle()
    await say('undo')
    await waitFor(() => expect(state.widgets.find(w => w.id === 'wl-w').opts.watchKey).toBe('user:m1'), { timeout: 4000 })
  })
})
