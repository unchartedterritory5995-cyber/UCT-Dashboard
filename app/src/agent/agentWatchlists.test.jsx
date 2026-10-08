import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { manifestFor, buildContext, getCapability } from './capabilities'
import { registerBuiltins } from './builtins'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
const CTX = { surface: 'charts' }
const KNOWN = new Set(['RKLB', 'PLTR', 'ASTS', 'NVDA', 'AMD', 'AVGO', 'TSM', 'TSLA', 'AAPL', 'MSFT', 'META'])

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(url).startsWith('/api/ticker-search')) {
      const q = new URL(url, 'http://x').searchParams.get('q')
      return json({ results: KNOWN.has(q) ? [{ ticker: q }] : [] })
    }
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

// Momentum is on the board (a Watchlist widget shows it); Swing and Long Term are not.
const LISTS = [
  { id: 'm1', name: 'Momentum', symbols: ['NVDA', 'TSLA', 'META', 'AAPL'], notes: { TSLA: 'earnings 10/22' } },
  { id: 's1', name: 'Swing', symbols: ['MSFT'] },
  { id: 'l1', name: 'Long Term', symbols: [] },
  { id: 'k1', name: 'Copied', symbols: ['AMD'], origin: { mode: 'link' } },
]
const lib = (lists = LISTS, widgets = [{ id: 'wl-w', type: 'watchlist', x: 18, y: 0, w: 6, h: 20, opts: { watchKey: 'user:m1' } }]) => makeBoard(widgets, { A: 'AAPL' }, { watchlists: lists })

const KINDS = ['watchlist', 'watchlistLibrary', 'chart', 'workspace']
async function plan(host, ops) {
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(host, KINDS), ops, env, CTX), env }
}
const symsOf = (state, id) => state.server.lists.find(l => l.id === id).items.map(i => i.sym)
const fastOps = (host, text) => { const f = fastParse(text, { host }); return f && f.kind === 'ops' ? f.ops : null }

describe('read awareness', () => {
  it('compact context: own lists with ids/refs, sizes, symbols, which one a widget shows; read-only flagged', () => {
    const { host } = lib()
    const { context, refMap } = buildContext(host, CTX)
    const m = context.watchlists.find(l => l.name === 'Momentum')
    expect(m).toMatchObject({ count: 4, symbols: ['NVDA', 'TSLA', 'META', 'AAPL'], shownInWidget: ['on the board'] })
    expect(refMap[m.ref]).toEqual({ kind: 'watchlist', ref: 'm1' })
    expect(context.watchlists.find(l => l.name === 'Copied').readOnly).toMatch(/linked/)
    expect(refMap[context.watchlistLibrary[0].ref]).toEqual({ kind: 'watchlistLibrary', ref: 'watchlists' })
  })
  it('"what watchlists do I have" / "what\'s in Momentum" are answered from the real lists, no mutation', () => {
    const { host, state } = lib()
    const before = JSON.stringify(state.server.lists)
    const list = fastParse('What watchlists do I have?', { host }).ops[0]
    expect(list.action).toBe('watchlist.list')
    expect(getCapability('watchlist.list').answer(collectTargets(host, ['watchlistLibrary']).get('watchlists').snap))
      .toBe('Your watchlists: Momentum (4) — showing, Swing (1), Long Term (0), Copied (1)')
    const show = fastParse("What's in Momentum?", { host }).ops[0]
    expect(show).toMatchObject({ action: 'watchlist.show', target: 'm1' })
    expect(getCapability('watchlist.show').answer(host.watchlists && collectTargets(host, ['watchlist']).get('m1').snap))
      .toBe('“Momentum” (4): NVDA, TSLA, META, AAPL')
    expect(JSON.stringify(state.server.lists)).toBe(before)
  })
})

describe('watchlist.add', () => {
  it('ADD BATCH: all tickers checked, one write, receipt from the real list, one Undo removes exactly those', async () => {
    const { host, state } = lib()
    const ops = fastOps(host, 'Add RKLB, PLTR and ASTS to Momentum')
    expect(ops).toEqual([{ action: 'watchlist.add', target: 'm1', args: { symbols: ['RKLB', 'PLTR', 'ASTS'] } }])
    const { p, env } = await plan(host, ops)
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('apply')
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    expect(res.lines).toEqual(['Added RKLB, PLTR and ASTS to “Momentum”'])
    expect(symsOf(state, 'm1')).toEqual(['NVDA', 'TSLA', 'META', 'AAPL', 'RKLB', 'PLTR', 'ASTS'])
    expect(state.server.calls.filter(c => c[0] === 'POST')).toHaveLength(1)          // one bulk write
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(symsOf(state, 'm1')).toEqual(['NVDA', 'TSLA', 'META', 'AAPL'])
  })
  it('DUPLICATE: never added twice; the receipt says what really happened', async () => {
    const { host, state } = lib()
    const { p, env } = await plan(host, [{ action: 'watchlist.add', target: 'm1', args: { symbols: ['NVDA', 'AMD'] } }])
    const res = await commitPlan(host, p, { env })
    expect(res.lines).toEqual(['Added AMD to “Momentum” · NVDA was already there'])
    expect(symsOf(state, 'm1').filter(s => s === 'NVDA')).toHaveLength(1)
    const again = await plan(host, [{ action: 'watchlist.add', target: 'm1', args: { symbols: ['NVDA'] } }])
    expect(again.p.changed).toBe(false)
    expect(again.p.noops).toEqual(['NVDA is already in “Momentum”'])
  })
  it('INVALID ticker in a batch: nothing is added (all or nothing)', async () => {
    const { host, state } = lib()
    const { p } = await plan(host, [{ action: 'watchlist.add', target: 'm1', args: { symbols: ['RKLB', 'ZZZZQ', 'PLTR'] } }])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toBe('UCT has no symbol “ZZZZQ” — nothing was added.')
    expect(symsOf(state, 'm1')).toEqual(['NVDA', 'TSLA', 'META', 'AAPL'])
    expect(state.server.calls).toHaveLength(0)
  })
  it('TARGETING: a name resolves to the real list; "my watchlist" only when exactly one list is showing; else the model asks', () => {
    const { host } = lib()
    expect(fastOps(host, 'add NVDA to swing')[0].target).toBe('s1')
    expect(fastOps(host, 'add RKLB to my watchlist')[0].target).toBe('m1')                 // the one on the board
    const two = lib(LISTS, [
      { id: 'a', type: 'watchlist', x: 0, y: 0, w: 6, h: 20, opts: { watchKey: 'user:m1' } },
      { id: 'b', type: 'watchlist', x: 18, y: 0, w: 6, h: 20, opts: { watchKey: 'user:s1' } },
    ])
    expect(fastParse('add RKLB to my watchlist', { host: two.host })).toBeNull()
    expect(fastParse('add RKLB to Banana', { host })).toBeNull()                        // missing → model, never guessed
  })
  it('a list NAMED "… Watchlist" resolves on the fast path (show / add / remove / rename), with or without the word', () => {
    const { host } = lib([...LISTS, { id: 'a1', name: 'Agent Test Watchlist', symbols: ['NVDA'] }])
    expect(fastOps(host, "What's in Agent Test Watchlist?")).toEqual([{ action: 'watchlist.show', target: 'a1', args: { as: null } }])
    expect(fastOps(host, 'Add AMD to Agent Test Watchlist')[0].target).toBe('a1')
    expect(fastOps(host, 'Remove NVDA from Agent Test Watchlist')[0].target).toBe('a1')
    expect(fastOps(host, 'Rename Agent Test Watchlist to Scratch')[0]).toMatchObject({ target: 'a1', args: { name: 'Scratch' } })
    expect(fastOps(host, "what's in my momentum watchlist")[0].target).toBe('m1')
  })
  it('a big batch is proposed first; a linked list is read-only', async () => {
    const { host } = lib()
    const many = ['RKLB', 'PLTR', 'ASTS', 'AMD', 'AVGO', 'TSM', 'MSFT', 'AAPL', 'META', 'NVDA', 'TSLA']
    const { p } = await plan(host, [{ action: 'watchlist.add', target: 'l1', args: { symbols: many } }])
    expect(decideMode('apply', p)).toBe('propose')
    const ro = await plan(host, [{ action: 'watchlist.add', target: 'k1', args: { symbols: ['NVDA'] } }])
    expect(ro.p.refusals[0].reason).toMatch(/can't be edited here — it is linked/)
  })
  it('the list changed since the plan → refused at write time, nothing written', async () => {
    const { host, state } = lib()
    const { p, env } = await plan(host, [{ action: 'watchlist.add', target: 'm1', args: { symbols: ['RKLB'] } }])
    state.manual('m1', wl => wl.items.push({ id: 'x9', sym: 'PLTR', notes: '' }))
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(false)
    expect(symsOf(state, 'm1')).toEqual(['NVDA', 'TSLA', 'META', 'AAPL', 'PLTR'])
  })
  it('STALE UNDO is delta-aware: other manual edits are kept; a removed Agent row blocks it', async () => {
    const { host, state } = lib()
    const { p, env } = await plan(host, [{ action: 'watchlist.add', target: 'm1', args: { symbols: ['RKLB', 'PLTR'] } }])
    const res = await commitPlan(host, p, { env })
    state.manual('m1', wl => wl.items.push({ id: 'x9', sym: 'MSFT', notes: '' }))       // unrelated manual add
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(symsOf(state, 'm1')).toEqual(['NVDA', 'TSLA', 'META', 'AAPL', 'MSFT'])          // MSFT kept
    const two = await plan(host, [{ action: 'watchlist.add', target: 'm1', args: { symbols: ['RKLB'] } }])
    const res2 = await commitPlan(host, two.p, { env: two.env })
    state.manual('m1', wl => { wl.items = wl.items.filter(i => i.sym !== 'RKLB') })     // member removed it by hand
    const u = await undoEntry(host, res2.undo)
    expect(u.ok).toBe(false)
  })
})

describe('watchlist.remove', () => {
  it('removes exactly the symbol; Undo restores it in its old place WITH its notes', async () => {
    const { host, state } = lib()
    const ops = fastOps(host, 'Remove TSLA from Momentum')
    const { p, env } = await plan(host, ops)
    expect(decideMode('apply', p)).toBe('apply')
    const res = await commitPlan(host, p, { env })
    expect(res.lines).toEqual(['Removed TSLA from “Momentum”'])
    expect(symsOf(state, 'm1')).toEqual(['NVDA', 'META', 'AAPL'])
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(symsOf(state, 'm1')).toEqual(['NVDA', 'TSLA', 'META', 'AAPL'])
    expect(state.server.lists[0].items[1].notes).toBe('earnings 10/22')
  })
  it('Undo of a remove refuses once the list was edited (it would rewrite the order)', async () => {
    const { host, state } = lib()
    const { p, env } = await plan(host, fastOps(host, 'take TSLA off momentum'))
    const res = await commitPlan(host, p, { env })
    state.manual('m1', wl => wl.items.reverse())
    expect((await undoEntry(host, res.undo)).ok).toBe(false)
    expect(symsOf(state, 'm1')).toEqual(['AAPL', 'META', 'NVDA'])
  })
  it('a symbol that is not there is said honestly', async () => {
    const { host } = lib()
    const { p } = await plan(host, [{ action: 'watchlist.remove', target: 'm1', args: { symbols: ['AMD'] } }])
    expect(p.refusals[0].reason).toBe('AMD isn\'t in “Momentum”.')
  })
})

describe('watchlist.create (+ populate)', () => {
  const createPlan = (name = 'AI Leaders') => [
    { action: 'watchlist.create', target: 'watchlists', args: { name, as: 'new1' } },
    { action: 'watchlist.add', target: 'new1', args: { symbols: ['NVDA', 'AMD', 'AVGO', 'TSM'] } },
  ]
  it('ONE proposal, ONE transaction: created and filled; no workspace change; no member Undo', async () => {
    const { host, state } = lib()
    const widgetsBefore = JSON.stringify(state.widgets)
    const { p, env } = await plan(host, createPlan())
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines).toEqual(['Created the watchlist “AI Leaders”', 'Added NVDA, AMD, AVGO and TSM to “AI Leaders”'])
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    const made = state.server.lists.find(l => l.name === 'AI Leaders')
    expect(made.items.map(i => i.sym)).toEqual(['NVDA', 'AMD', 'AVGO', 'TSM'])
    expect(res.undo).toBeNull()
    expect(JSON.stringify(state.widgets)).toBe(widgetsBefore)
  })
  it('an existing name (any case) is refused before anything is written', async () => {
    const { host, state } = lib()
    const { p } = await plan(host, createPlan('momentum'))
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/already have a watchlist named “Momentum”/)
    expect(state.server.calls).toHaveLength(0)
  })
  it('if filling the new list fails, the new list is taken back — no mysterious empty list', async () => {
    const { host, state } = lib()
    state.server.failOn = (m, path) => m === 'POST' && path.endsWith('/items/bulk')
    const { p, env } = await plan(host, createPlan())
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(false)
    expect(res.compensated).toBe(true)
    expect(state.server.lists.some(l => l.name === 'AI Leaders')).toBe(false)
  })
})

describe('rename, compound, compact-mode manifest', () => {
  it('rename: proposed, by id, collision refused, Undo renames back', async () => {
    const { host, state } = lib()
    const { p, env } = await plan(host, fastOps(host, 'Rename Swing to Swing Trades'))
    expect(decideMode('apply', p)).toBe('propose')
    const res = await commitPlan(host, p, { env })
    expect(res.lines).toEqual(['Renamed the watchlist “Swing” to “Swing Trades”'])
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(state.server.lists.find(l => l.id === 's1').name).toBe('Swing')
    expect((await plan(host, [{ action: 'watchlist.rename', target: 's1', args: { name: 'MOMENTUM' } }])).p.refusals[0].reason).toMatch(/already have a watchlist named “Momentum”/)
  })
  it('two lists in one request: a proposal, each list gets only its own symbols', async () => {
    const { host, state } = lib()
    const { p, env } = await plan(host, [
      { action: 'watchlist.add', target: 'm1', args: { symbols: ['RKLB'] } },
      { action: 'watchlist.add', target: 's1', args: { symbols: ['AMD'] } },
    ])
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines).toEqual(['Added RKLB to “Momentum”', 'Added AMD to “Swing”'])
    await commitPlan(host, p, { env })
    expect(symsOf(state, 'm1')).toContain('RKLB')
    expect(symsOf(state, 's1')).toEqual(['MSFT', 'AMD'])
  })
  it('the manifest now carries >10 actions; watchlist args are closed schemas the server can check', () => {
    const m = manifestFor(CTX)
    expect(m.length).toBeGreaterThan(10)
    const add = m.find(c => c.name === 'watchlist.add')
    expect(add.args.properties.symbols.anyOf).toEqual([
      { type: 'array', items: { type: 'string' } },
      { type: 'object', properties: { from: { type: 'string' }, top: { type: ['integer', 'null'] } }, required: ['from', 'top'], additionalProperties: false },
    ])
    expect(add.args).toMatchObject({ type: 'object', required: ['symbols'], additionalProperties: false })
    expect(m.map(c => c.name)).toEqual(expect.arrayContaining(['watchlist.list', 'watchlist.show', 'watchlist.create', 'watchlist.remove', 'watchlist.rename']))
  })
  it('a saved-list proposal is NOT voided by a layout switch (it names the list, not the board)', async () => {
    const { host, state } = makeBoard([], { A: 'AAPL' }, {
      watchlists: LISTS,
      layouts: { entries: [{ id: 11, name: 'A' }, { id: 12, name: 'B' }], boards: { 11: [], 12: [] }, active: 11 },
    })
    render(<AgentPanel host={host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    fireEvent.change(box, { target: { value: 'Add RKLB, PLTR, ASTS, AMD, AVGO, TSM, MSFT, AAPL, META, NVDA and TSLA to Long Term' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByTestId('agent-proposal')
    host.layouts.open({ id: 12 })
    fireEvent.change(box, { target: { value: 'do it' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByTestId('agent-receipt', {}, { timeout: 4000 })
    await waitFor(() => expect(symsOf(state, 'l1')).toHaveLength(11))
  })
})
