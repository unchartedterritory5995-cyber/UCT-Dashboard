// CHARTS OUTCOME 3 — watchlists: the state on the fixture server (board.state.server: the real routes' semantics behind
// the REAL buildWatchlistSource), never the panel's cache and never a receipt alone.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor, proposalsNow } from './outcomeHarness'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)

const LISTS = [{ id: 'w1', name: 'Momentum', symbols: ['NVDA', 'TSLA'] }, { id: 'w2', name: 'Earnings', symbols: ['AAPL'] }]
const openLists = (widgets = [chart('c1', 0, 0, 24, 20)], o = {}) => open(widgets, { 'N:c1': 'NVDA' }, { extra: { watchlists: LISTS }, ...o })
const srv = (m) => m.board.state.server
const list = (m, name) => srv(m).lists.find(l => l.name === name) || null
const syms = (m, name) => list(m, name)?.items.map(i => i.sym) ?? null
const names = (m) => srv(m).lists.map(l => l.name).sort()
const wl = (c, name) => must((c.watchlists || []).find(l => l.name === name), `watchlist ${name}`).ref
const libRef = (c) => must(c.watchlistLibrary?.[0]?.ref, 'watchlist library')
const CREATE_WITH = (c, name, symbols) => [{ action: 'watchlist.create', target: libRef(c), args: { name, as: 'new1' } }, { action: 'watchlist.add', target: 'new1', args: { symbols } }]

describe('create with tickers', () => {
  it('nothing exists until Apply; then the list holds exactly those tickers on the server, in order, and the Agent says so', async () => {
    const m = openLists()
    await m.say('create a watchlist called Growth with NVDA and AMD', (c) => CREATE_WITH(c, 'Growth', ['NVDA', 'AMD']))
    expect(proposalsNow()).toHaveLength(1)
    expect(list(m, 'Growth')).toBe(null)
    await m.apply()
    await waitFor(() => expect(syms(m, 'Growth')).toEqual(['NVDA', 'AMD']))
    expect(m.lastReceipt().textContent).toMatch(/Growth/)
    expect(m.lastReceipt().textContent).toMatch(/NVDA and AMD/)
    const out = await m.say('what\'s in Growth?')
    expect(out).toMatch(/“Growth” \(2\): NVDA, AMD/)
  })
  it('a create is not undoable, and "undo" says so: the list and its tickers stay, nothing claims otherwise', async () => {
    const m = openLists()
    await m.say('create a watchlist called Growth with NVDA and AMD', (c) => CREATE_WITH(c, 'Growth', ['NVDA', 'AMD']))
    await m.apply()
    await waitFor(() => expect(syms(m, 'Growth')).toEqual(['NVDA', 'AMD']))
    expect(m.lastReceipt().getAttribute('data-undoable')).not.toBe('true')
    await m.say('undo')
    await waitFor(() => expect(m.p.transcript()).toMatch(/in this session/))
    expect(m.p.transcript()).not.toMatch(/Undid/)
    expect(syms(m, 'Growth')).toEqual(['NVDA', 'AMD'])
  })
  it('the second step fails: the list the first step made is taken back, and no success is claimed', async () => {
    const m = openLists()
    srv(m).failOn = (method, path) => method === 'POST' && path.endsWith('/items/bulk')
    await m.say('create a watchlist called Growth with NVDA and AMD', (c) => CREATE_WITH(c, 'Growth', ['NVDA', 'AMD']))
    await m.apply()
    await waitFor(() => expect(srv(m).calls.some(c => c[0] === 'DELETE')).toBe(true))
    expect(list(m, 'Growth')).toBe(null)
    expect(names(m)).toEqual(['Earnings', 'Momentum'])
    expect(m.p.summaries().join(' ')).not.toMatch(/Created the watchlist/)
  })
  it('a name that exists is refused, nothing is made', async () => {
    const m = openLists()
    const out = await m.say('create a watchlist called momentum', (c) => [{ action: 'watchlist.create', target: libRef(c), args: { name: 'momentum', as: null } }])
    expect(out).toMatch(/already have a watchlist named/)
    expect(srv(m).lists).toHaveLength(2)
  })
})

describe('rename, add, remove, as one conversation (the deterministic phrases, no model)', () => {
  it('rename then add then remove then Undo: each step is on the server, and the renamed list is found by its NEW name', async () => {
    const m = openLists()
    await m.say('rename Momentum to Leaders')
    expect(proposalsNow()).toHaveLength(1)
    expect(names(m)).toEqual(['Earnings', 'Momentum'])
    await m.say('do it')
    await waitFor(() => expect(names(m)).toEqual(['Earnings', 'Leaders']))
    expect(m.lastReceipt().textContent).toMatch(/“Momentum” to “Leaders”/)
    await m.say('add AMD to Leaders')
    await waitFor(() => expect(syms(m, 'Leaders')).toEqual(['NVDA', 'TSLA', 'AMD']))
    await m.say('remove TSLA from Leaders')
    await waitFor(() => expect(syms(m, 'Leaders')).toEqual(['NVDA', 'AMD']))
    await m.say('undo')
    await waitFor(() => expect(syms(m, 'Leaders')).toEqual(['NVDA', 'TSLA', 'AMD']))
    await m.say('undo')
    await waitFor(() => expect(syms(m, 'Leaders')).toEqual(['NVDA', 'TSLA']))
    await m.say('undo')
    await waitFor(() => expect(names(m)).toEqual(['Earnings', 'Momentum']))
    expect(m.p.turns()).toBe(0)
  })
  it('the natural follow-up: "add AMD to it" after the list was created goes to the list just made', async () => {
    const m = openLists()
    await m.say('create a watchlist called Growth with NVDA', (c) => CREATE_WITH(c, 'Growth', ['NVDA']))
    await m.apply()
    await waitFor(() => expect(syms(m, 'Growth')).toEqual(['NVDA']))
    await m.say('add AMD to it', (c) => [{ action: 'watchlist.add', target: wl(c, 'Growth'), args: { symbols: ['AMD'] } }])
    await waitFor(() => expect(syms(m, 'Growth')).toEqual(['NVDA', 'AMD']))
    expect(syms(m, 'Momentum')).toEqual(['NVDA', 'TSLA'])
  })
  it('"add AMD to my watchlist": the list the Watchlist widget on this board shows, with no model', async () => {
    const widgets = [chart('c1', 0, 0, 18, 20), { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20, color: 'A', opts: { watchKey: 'user:w2' } }]
    const m = openLists(widgets)
    await m.say('add AMD to my watchlist')
    await waitFor(() => expect(syms(m, 'Earnings')).toEqual(['AAPL', 'AMD']))
    expect(syms(m, 'Momentum')).toEqual(['NVDA', 'TSLA'])
    expect(m.p.turns()).toBe(0)
  })
  it('a list edited elsewhere after the plan is not overwritten', async () => {
    const m = openLists()
    await m.say('rename Momentum to Leaders')
    m.board.state.manual('w1', (l) => { l.items.push({ id: 'manual', sym: 'ZZZ', notes: '' }) })
    await m.say('do it')
    await m.p.idle()
    expect(syms(m, 'Momentum') || syms(m, 'Leaders')).toContain('ZZZ')
  })
  it('a ticker UCT does not know refuses the whole add', async () => {
    const m = openLists()
    const base = globalThis.fetch
    globalThis.fetch = async (u, i) => (/ticker-search\?q=QQQQX/i.test(String(u)) ? new Response('{"results":[]}', { status: 200 }) : base(u, i))
    await m.say('add AMD and QQQQX to Momentum')
    expect(syms(m, 'Momentum')).toEqual(['NVDA', 'TSLA'])
    expect(m.p.transcript()).toMatch(/QQQQX/)
  })
})

describe('delete asks first, and is permanent', () => {
  it('the proposal names the list and its size and says permanent; Dismiss keeps it; Apply deletes it on the server; no Undo', async () => {
    const m = openLists()
    const DEL = (c) => [{ action: 'watchlist.delete', target: wl(c, 'Momentum'), args: {} }]
    await m.say('delete the Momentum watchlist', DEL)
    expect(proposalsNow()).toHaveLength(1)
    expect(proposalsNow()[0].textContent).toMatch(/“Momentum”/)
    expect(proposalsNow()[0].textContent).toMatch(/2 stocks/)
    expect(proposalsNow()[0].textContent).toMatch(/permanent/i)
    await m.dismiss()
    expect(list(m, 'Momentum')).not.toBe(null)
    await m.say('delete the Momentum watchlist', DEL)
    await m.apply()
    await waitFor(() => expect(list(m, 'Momentum')).toBe(null))
    expect(m.lastReceipt().getAttribute('data-undoable')).not.toBe('true')
    expect(m.lastReceipt().textContent).toMatch(/Deleted the watchlist “Momentum”/)
    const out = await m.say('what are my watchlists')
    expect(out).not.toMatch(/Momentum/)
    const undo = await m.say('undo')
    expect(undo).not.toMatch(/Undid/)
    expect(list(m, 'Momentum')).toBe(null)
  })
  it('"delete the one I just made": the list this session created is named by the request', async () => {
    const m = openLists()
    await m.say('create a watchlist called Growth with NVDA', (c) => CREATE_WITH(c, 'Growth', ['NVDA']))
    await m.apply()
    await waitFor(() => expect(syms(m, 'Growth')).toEqual(['NVDA']))
    // no mark on the list itself: the planner has last_change, and the receipt UCT recorded (the history the next turn reads)
    const recorded = JSON.stringify(m.p.st.calls.filter(x => x[1] === '/api/agent/record').map(x => x[2]))
    await m.say('delete the one I just made', (c) => {
      expect(c.conversation_memory.last_change).toContain('watchlist.create')
      return [{ action: 'watchlist.delete', target: must((c.watchlists || []).find(l => recorded.includes(`“${l.name}”`)), 'the list named in the record').ref, args: {} }]
    })
    await m.apply()
    await waitFor(() => expect(list(m, 'Growth')).toBe(null))
    expect(names(m)).toEqual(['Earnings', 'Momentum'])
  })
  it('a list a Watchlist widget on this board shows is refused, and stays', async () => {
    const widgets = [chart('c1', 0, 0, 18, 20), { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20, color: 'A', opts: { watchKey: 'user:w1' } }]
    const m = openLists(widgets)
    const out = await m.say('delete the Momentum watchlist', (c) => [{ action: 'watchlist.delete', target: wl(c, 'Momentum'), args: {} }])
    expect(out).toMatch(/showing in a Watchlist widget/)
    expect(m.pending()).toBe(0)
    expect(list(m, 'Momentum')).not.toBe(null)
  })
})
