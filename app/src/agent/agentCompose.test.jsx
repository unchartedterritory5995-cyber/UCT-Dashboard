import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { refsOf, checkRefs } from './compose'
import { _resetScreenerCache, loadMeta } from './capabilities/screener'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

// A 30-row fixture universe the fixture engine filters/sorts like /api/screener/scan.
const UNIVERSE = Array.from({ length: 30 }, (_, i) => ({ ticker: `T${String(i + 1).padStart(2, '0')}`, adr_pct: 4 + i * 0.3, price: 5 + i * 3 }))
let calls, envelopes, scanResponder
beforeEach(() => {
  _resetScreenerCache()
  try { localStorage.clear() } catch { /* */ }
  calls = []; envelopes = []
  scanResponder = null
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') return json({ fields: [{ key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%' }, { key: 'price', label: 'Price', type: 'range', unit: '$' }] })
    if (url === '/api/screener/saved-screens') return json({ saved: [{ id: 7, name: 'Momentum Screen', spec: { filters: [{ key: 'adr_pct', op: 'gt', min: 10 }] } }], starters: [] })
    if (url === '/api/screener/scan') {
      if (scanResponder) return scanResponder(body, json)
      const ok = (r, f) => (f.op === 'gt' ? r[f.key] > f.min : f.op === 'lt' ? r[f.key] < f.max : true)
      let rows = UNIVERSE.filter(r => body.filters.every(f => ok(r, f)))
      if (body.sort?.key && body.sort.key in UNIVERSE[0]) rows = [...rows].sort((a, b) => (body.sort.dir === 'asc' ? 1 : -1) * (a[body.sort.key] - b[body.sort.key]))
      return json({ total: rows.length, rows: rows.slice(0, body.page_size), snapshot_date: '2026-10-07' })
    }
    if (url === '/api/agent/turn') return json({ conversationId: 'ac_1', envelope: envelopes.shift(), usage: { research_calls: 0, citations: [] } })
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/ticker-search')) return json({ results: [] })      // nothing the model typed is a ticker here
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const SCREEN = (extra = {}) => ({ action: 'screener.run', target: 's', args: { filters: [{ field: 'adr_pct', op: 'gt', value: 5, max: null }, { field: 'price', op: 'gt', value: 10, max: null }], sort_field: null, sort_dir: null, mode: 'new', show: null, as: 'screen1', ...extra } })
const turns = () => calls.filter(c => c[1] === '/api/agent/turn').length
const scans = () => calls.filter(c => c[1] === '/api/screener/scan')
const LISTS = [{ id: 'm1', name: 'Momentum', symbols: ['T05', 'T06'] }]

async function mount(lists = LISTS) {
  const board = makeBoard([], { A: 'AAPL' }, { watchlists: lists })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  await loadMeta()
  const box = screen.getByLabelText('Message UCT Agent')
  const say = (t) => { fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { ...board, say }
}
// The model's refs: the screener entry and the watchlist library get these context refs.
const S = 's1'; const LIB = 'w3'; const MOM = 'w2'

describe('Screener → Watchlist: one interpretation, deterministic apply', () => {
  it('NEW LIST: proposal names the query + rule (no symbols); Apply screens fresh, creates and fills with the actual top 20 in order — 0 model calls on Apply', async () => {
    const { state, say } = await mount()
    envelopes.push(env('propose', [
      { ...SCREEN(), target: S },
      { action: 'watchlist.create', target: LIB, args: { name: 'High ADR', as: 'new1' } },
      { action: 'watchlist.add', target: 'new1', args: { symbols: { from: 'screen1', top: 20 } } },
    ]))
    say('Find stocks with ADR above 5% and price above $10, then put the top 20 in a watchlist called High ADR.')
    const card = await screen.findByTestId('agent-proposal')
    expect(card.textContent).toContain('Screen for ADR % > 5% · Price > $10 — run fresh when you apply')
    expect(card.textContent).toContain('Create the watchlist “High ADR”')     // pending wording on the card
    expect(card.textContent).not.toContain('Created the watchlist')
    expect(card.textContent).toContain('Add the top 20 of its results to “High ADR”')
    expect(card.textContent).not.toMatch(/T\d\d/)                                        // no guessed symbols
    expect(scans()).toHaveLength(0)
    expect(state.server.lists.some(l => l.name === 'High ADR')).toBe(false)
    const t = turns()
    say('do it')
    const receipt = await screen.findByTestId('agent-receipt', {}, { timeout: 4000 })
    expect(turns()).toBe(t)                                                              // Apply: no model call
    expect(scans()).toHaveLength(1)
    const made = state.server.lists.find(l => l.name === 'High ADR')
    const expected = UNIVERSE.filter(r => r.adr_pct > 5 && r.price > 10).slice(0, 20).map(r => r.ticker)
    expect(made.items.map(i => i.sym)).toEqual(expected)                                 // the engine's own order
    expect(receipt.textContent).toContain('Screened ADR % > 5% · Price > $10: 26 matches')
    expect(receipt.textContent).toContain('Created the watchlist “High ADR”')
    expect(receipt.textContent).toContain('Added 20 stocks to “High ADR”')
    expect(receipt.textContent).not.toContain('Undo')                                    // creation has no Undo
    expect(calls.some(c => String(c[1]).startsWith('/api/ticker-search'))).toBe(false)   // trusted Screener output
  })
  it('EXISTING LIST + duplicates: only new rows added; receipt says so; Undo removes exactly those', async () => {
    const { state, say } = await mount([{ id: 'm1', name: 'Momentum', symbols: ['T04', 'T05'] }])
    envelopes.push(env('propose', [
      { ...SCREEN({ filters: [{ field: 'adr_pct', op: 'gt', value: 4.5, max: null }] }), target: S },
      { action: 'watchlist.add', target: MOM, args: { symbols: { from: 'screen1', top: 10 } } },
    ]))
    say('Find stocks with ADR above 4.5% and add the top 10 to Momentum.')
    await screen.findByTestId('agent-proposal')
    expect(state.server.lists[0].items.map(i => i.sym)).toEqual(['T04', 'T05'])
    say('do it')
    const receipt = await screen.findByTestId('agent-receipt', {}, { timeout: 4000 })
    expect(receipt.textContent).toContain('Added 8 stocks to “Momentum” · T04 and T05 were already there')
    expect(state.server.lists[0].items.map(i => i.sym)).toEqual(['T04', 'T05', 'T03', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12'])
    say('undo')
    await screen.findByText(/^Undid:/, {}, { timeout: 4000 })
    expect(state.server.lists[0].items.map(i => i.sym)).toEqual(['T04', 'T05'])          // pre-existing rows untouched
  })
  it('an explicit SORT decides "top" — the engine\'s first N under that sort', async () => {
    const { state, say } = await mount()
    envelopes.push(env('propose', [
      { ...SCREEN({ filters: [{ field: 'adr_pct', op: 'gt', value: 5, max: null }], sort_field: 'adr_pct', sort_dir: 'desc' }), target: S },
      { action: 'watchlist.add', target: MOM, args: { symbols: { from: 'screen1', top: 3 } } },
    ]))
    say('Find ADR above 5%, sort by ADR highest first, add the top 3 to Momentum.')
    await screen.findByTestId('agent-proposal')
    say('do it')
    await screen.findByTestId('agent-receipt', {}, { timeout: 4000 })
    expect(scans()[0][2].sort).toEqual({ key: 'adr_pct', dir: 'desc' })
    expect(state.server.lists[0].items.map(i => i.sym).slice(-3)).toEqual(['T30', 'T29', 'T28'])
  })
  it('FEWER than N: all the matches are used, said honestly; ZERO: nothing created', async () => {
    const { state, say } = await mount()
    envelopes.push(env('propose', [
      { ...SCREEN({ filters: [{ field: 'price', op: 'gt', value: 80, max: null }] }), target: S },
      { action: 'watchlist.create', target: LIB, args: { name: 'Few', as: 'new1' } },
      { action: 'watchlist.add', target: 'new1', args: { symbols: { from: 'screen1', top: 20 } } },
    ]))
    say('find price above 80 and put the top 20 in a watchlist called Few')
    await screen.findByTestId('agent-proposal')
    say('do it')
    const r = await screen.findByTestId('agent-receipt', {}, { timeout: 4000 })
    expect(r.textContent).toContain('Screened Price > $80: 4 matches')
    expect(r.textContent).toContain('Added T27, T28, T29 and T30 to “Few”')
    envelopes.push(env('propose', [
      { ...SCREEN({ filters: [{ field: 'price', op: 'gt', value: 9999, max: null }] }), target: S },
      // refs are minted per turn: "Few" now holds w3, so the library is w4
      { action: 'watchlist.create', target: 'w4', args: { name: 'Nothing', as: 'new1' } },
      { action: 'watchlist.add', target: 'new1', args: { symbols: { from: 'screen1', top: 20 } } },
    ]))
    say('find price above 9999 and put the top 20 in a watchlist called Nothing')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal')).toHaveLength(2))
    say('do it')
    await screen.findByText(/No stocks matched Price > \$9999, so I didn't create or change anything\./, {}, { timeout: 4000 })
    expect(state.server.lists.some(l => l.name === 'Nothing')).toBe(false)
  })
  it('NAME COLLISION: refused before a proposal; a list of that name appearing before Apply → refused, nothing created', async () => {
    const { state, say } = await mount([{ id: 'm1', name: 'High ADR', symbols: [] }])
    envelopes.push(env('propose', [
      { ...SCREEN(), target: S },
      { action: 'watchlist.create', target: LIB, args: { name: 'high adr', as: 'new1' } },
      { action: 'watchlist.add', target: 'new1', args: { symbols: { from: 'screen1', top: 20 } } },
    ]))
    say('find ADR > 5 and put the top 20 in a watchlist called high adr')
    await screen.findByText(/already have a watchlist named “High ADR”/, {}, { timeout: 4000 })
    expect(scans()).toHaveLength(0)
    // …and the race: the name is free at proposal, taken by Apply
    envelopes.push(env('propose', [
      { ...SCREEN(), target: S },
      { action: 'watchlist.create', target: LIB, args: { name: 'Race', as: 'new1' } },
      { action: 'watchlist.add', target: 'new1', args: { symbols: { from: 'screen1', top: 5 } } },
    ]))
    say('find ADR > 5 and put the top 5 in a watchlist called Race')
    await screen.findByTestId('agent-proposal')
    state.server.lists.push({ id: 'zz', name: 'Race', items: [] })                      // created elsewhere
    say('do it')
    await screen.findByText(/already have a watchlist named “Race”/, {}, { timeout: 4000 })
    expect(state.server.lists.filter(l => l.name === 'Race')).toHaveLength(1)
  })
  it('INVALID field → refused before any proposal; SCREENER error at apply → no watchlist write', async () => {
    const { state, say } = await mount()
    envelopes.push(env('propose', [
      { ...SCREEN({ filters: [{ field: 'adr_pcx', op: 'gt', value: 5, max: null }] }), target: S },
      { action: 'watchlist.add', target: MOM, args: { symbols: { from: 'screen1', top: 5 } } },
    ]))
    say('find adr_pcx > 5 and add the top 5 to Momentum')
    await screen.findByText(/the Screener has no field “adr_pcx”/, {}, { timeout: 4000 })
    expect(screen.queryByTestId('agent-proposal')).toBeNull()
    envelopes.push(env('propose', [
      { ...SCREEN(), target: S },
      { action: 'watchlist.add', target: MOM, args: { symbols: { from: 'screen1', top: 5 } } },
    ]))
    say('find ADR > 5 and add the top 5 to Momentum')
    await screen.findByTestId('agent-proposal')
    scanResponder = (_b, json) => json({ detail: 'The screener snapshot is rebuilding' }, 503)
    say('do it')
    await screen.findByText(/rebuilding/, {}, { timeout: 4000 })
    expect(state.server.calls.filter(c => c[0] !== 'GET')).toHaveLength(0)
  })
  it('WATCHLIST write error after creating → the new list is taken back (no partial state)', async () => {
    const { state, say } = await mount()
    state.server.failOn = (m, path) => m === 'POST' && path.endsWith('/items/bulk')
    envelopes.push(env('propose', [
      { ...SCREEN(), target: S },
      { action: 'watchlist.create', target: LIB, args: { name: 'Broken', as: 'new1' } },
      { action: 'watchlist.add', target: 'new1', args: { symbols: { from: 'screen1', top: 5 } } },
    ]))
    say('find ADR > 5 and put the top 5 in a watchlist called Broken')
    await screen.findByTestId('agent-proposal')
    say('do it')
    await screen.findByText(/nothing was left changed/, {}, { timeout: 4000 })
    expect(state.server.lists.some(l => l.name === 'Broken')).toBe(false)
  })
  it('FOLLOW-UP: a screen, then "put the top 3 in Momentum" uses the LAST screen (re-run fresh at apply)', async () => {
    const { state, say } = await mount()
    envelopes.push(env('apply', [{ ...SCREEN({ as: null }), target: S }]))
    say('Show me stocks with ADR above 5% and price above $10')
    await screen.findByTestId('agent-result-table')
    envelopes.push(env('propose', [{ action: 'watchlist.add', target: MOM, args: { symbols: { from: 'lastScreen', top: 3 } } }]))
    say('Put the top 3 in Momentum.')
    const card = await screen.findByTestId('agent-proposal')
    expect(card.textContent).toContain('Use your last screen (ADR % > 5% · Price > $10) — run fresh when you apply')
    const before = scans().length
    say('do it')
    await screen.findByTestId('agent-receipt', {}, { timeout: 4000 })
    expect(scans().length).toBe(before + 1)
    expect(state.server.lists[0].items.map(i => i.sym)).toEqual(['T05', 'T06', 'T07'])          // T05, T06 already there
  })
  it('SAVED SCREEN → list, by its real id', async () => {
    const { state, say } = await mount()
    envelopes.push(env('propose', [
      { action: 'screener.runSaved', target: S, args: { screen: '7', show: null, as: 'screen1' } },
      { action: 'watchlist.add', target: MOM, args: { symbols: { from: 'screen1', top: 2 } } },
    ]))
    say('Run my Momentum Screen and add the top 2 to Momentum')
    const card = await screen.findByTestId('agent-proposal')
    expect(card.textContent).toContain('Run your screen “Momentum Screen” — fresh when you apply')
    say('do it')
    await screen.findByTestId('agent-receipt', {}, { timeout: 4000 })
    expect(scans()[0][2].filters).toEqual([{ key: 'adr_pct', op: 'gt', min: 10 }])
    expect(state.server.lists[0].items.map(i => i.sym).slice(-2)).toEqual(['T22', 'T23'])
  })
})

describe('the dataflow seam stays narrow', () => {
  it('only { from, top } is a reference; nothing else, no paths', () => {
    const add = (v) => [{ action: 'watchlist.add', target: 'w1', args: { symbols: v } }]
    expect(refsOf(add({ from: 'screen1', top: 5 }))).toHaveLength(1)
    expect(refsOf(add({ from: 'screen1', top: 5, path: 'rows.0.secret' }))).toHaveLength(0)
    expect(refsOf(add({ from: 'screen1.rows', top: 5 }))).toHaveLength(1)
    expect(checkRefs(add({ from: 'screen1.rows', top: 5 }))).toMatch(/isn't a result I can use/)
    expect(checkRefs(add({ from: 'screen9', top: 5 }))).toMatch(/isn't a result I can use/)
    expect(checkRefs([{ action: 'watchlist.add', target: MOM, args: { symbols: { from: 'screen1', top: 5 } } }, { ...SCREEN() }])).toBeNull()   // order-free: producers always run first at apply (prod model lists the consumer first)
  })
})
