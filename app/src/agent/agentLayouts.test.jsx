import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { manifestFor, buildContext, getCapability } from './capabilities'
import { registerBuiltins } from './builtins'
import { planOps, collectTargets } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
const CTX = { surface: 'charts' }

// Two of the member's own layouts with DIFFERENT boards, a prebuilt, the built-in
// default, and three similar names.
const ENTRIES = [
  { id: 'uct-default', name: 'UCT Default', scope: 'global' },
  { id: 5, name: '1-Chart', scope: 'global' },
  { id: 11, name: 'Agent Test', scope: 'user' },
  { id: 12, name: 'Intraday Scan', scope: 'user' },
  { id: 13, name: 'Momentum', scope: 'user' },
  { id: 14, name: 'Momentum 2', scope: 'user' },
  { id: 15, name: 'Momentum Swing', scope: 'user' },
]
const BOARDS = {
  11: [{ id: 'a-left', type: 'chart', x: 0, y: 0, w: 12, h: 20 }, { id: 'a-right', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'B' }],
  12: [{ id: 'i-one', type: 'chart', x: 0, y: 0, w: 12, h: 20 }, { id: 'i-two', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'B' }],
}
const lib = (over = {}) => makeBoard(BOARDS[11], { A: 'AAPL', B: 'MSFT' }, { layouts: { entries: ENTRIES, boards: BOARDS, active: 11, ...over } })

const plan = (host, ops) => planOps(collectTargets(host, ['layouts', 'chart', 'workspace']), ops, {}, CTX)
const fastOps = (host, text) => {
  const f = fastParse(text, { host })
  return f && f.kind === 'ops' ? f.ops.map(o => ({ ...o, target: 'layouts' })) : null
}

describe('layout awareness (read-only)', () => {
  it('the catalog is compact context: names, ids, kinds, which is open — no layout JSON', () => {
    const { host } = lib()
    const { context, refMap } = buildContext(host, CTX)
    const L = context.layouts[0]
    expect(refMap[L.ref]).toEqual({ kind: 'layouts', ref: 'layouts' })
    expect(L.open).toEqual({ id: '11', name: 'Agent Test' })
    expect(L.layouts).toContainEqual({ id: '12', name: 'Intraday Scan', kind: 'yours' })
    expect(L.layouts).toContainEqual({ id: '5', name: '1-Chart', kind: 'prebuilt' })
    expect(L.layouts).toContainEqual({ id: 'uct-default', name: 'UCT Default', kind: 'built-in' })
    expect(JSON.stringify(L)).not.toMatch(/widgets|chartSettings/)
  })
  it('"what layout am I on" / "what layouts do I have" answer locally from real state', () => {
    const { host, state } = lib()
    const before = JSON.stringify(state)
    const cur = fastParse('What layout am I on?', { host })
    expect(cur.ops[0].action).toBe('layout.current')
    const snap = host.layouts.snapshot()
    expect(getCapability('layout.current').answer({ ref: 'layouts', ...snap }, {})).toBe('You\'re on “Agent Test” (yours).')
    const list = fastParse('what layouts do I have', { host })
    expect(list.ops[0].action).toBe('layout.list')
    const text = getCapability('layout.list').answer({ ref: 'layouts', ...snap }, {})
    expect(text).toBe('Yours: Agent Test (open), Intraday Scan, Momentum, Momentum 2, Momentum Swing\nPrebuilt: 1-Chart\nBuilt-in: UCT Default')
    expect(JSON.stringify(state)).toBe(before)
    // The model can ROUTE to the queries too, so its answer is UCT's real list, never its own reading.
    const names = manifestFor(CTX).map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['layout.open', 'layout.saveAs', 'layout.rename', 'layout.list', 'layout.current']))
  })
})

describe('layout.open', () => {
  it('opens through the dock\'s own open, ACKs the actual active layout, and Undo goes back — no model needed', async () => {
    const { host, state } = lib()
    const ops = fastOps(host, 'Open my Intraday Scan layout')
    expect(ops).toEqual([{ action: 'layout.open', target: 'layouts', args: { layout: '12' } }])
    const p = plan(host, ops)
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('apply')
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(res.lines).toEqual(['Opened “Intraday Scan”'])
    expect(host.layouts.snapshot().active.name).toBe('Intraday Scan')
    expect(state.widgets.map(w => w.id)).toEqual(['i-one', 'i-two'])
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(true)
    expect(host.layouts.snapshot().active.name).toBe('Agent Test')
    expect(state.layouts.calls).toEqual([['open', 12], ['open', 11]])
  })
  it('switch / take me to / go back to all resolve; an exact name wins over similar ones', () => {
    const { host } = lib()
    expect(fastOps(host, 'switch to 1-Chart')[0].args.layout).toBe('5')
    expect(fastOps(host, 'Take me to Intraday Scan.')[0].args.layout).toBe('12')
    expect(fastOps(host, 'go back to UCT Default')[0].args.layout).toBe('uct-default')
    expect(fastOps(host, 'open momentum')[0].args.layout).toBe('13')
  })
  it('AMBIGUOUS or UNKNOWN names are never guessed: the fast path declines (the model clarifies with real names)', () => {
    const { host } = lib({ entries: [...ENTRIES, { id: 16, name: '1-Chart', scope: 'user' }] })
    expect(fastParse('open mom', { host })).toBeNull()
    expect(fastParse('open 1-Chart', { host })).toBeNull()             // a prebuilt AND one of yours
    expect(fastParse('Open Banana Layout', { host })).toBeNull()
    const p = plan(host, [{ action: 'layout.open', target: 'layouts', args: { layout: '999' } }])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toBe("That layout isn't in your layout list.")
  })
  it('opening the layout already open is a no-op, never a reload', () => {
    const { host } = lib()
    const p = plan(host, fastOps(host, 'open agent test'))
    expect(p.changed).toBe(false)
    expect(p.noops).toEqual(['“Agent Test” is already open'])
  })
  it('UNSAVED edits that a switch would discard → proposed, said plainly, and no Undo afterwards', async () => {
    const { host } = lib({ active: 'uct-default', unsaved: true })
    const p = plan(host, fastOps(host, 'open intraday scan'))
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines).toEqual(['Opened “Intraday Scan” — unsaved changes on “UCT Default” are discarded'])
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(res.undo).toBeNull()
  })
  it('opening a layout can\'t share a request with other changes (they would land on the wrong board)', () => {
    const { host } = lib()
    const p = plan(host, [
      { action: 'layout.open', target: 'layouts', args: { layout: '12' } },
      { action: 'chart.setTimeframe', target: 'a-left', args: { timeframe: 'W' } },
    ])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/two steps/)
  })
})

describe('context refresh + board identity', () => {
  it('after a switch the chart targets are the NEW board\'s; an old ref is refused', async () => {
    const { host } = lib()
    expect(host.charts.list().map(c => c.ref)).toEqual(['a-left', 'a-right'])
    await commitPlan(host, plan(host, fastOps(host, 'open intraday scan')))
    expect(host.charts.list().map(c => c.ref)).toEqual(['i-one', 'i-two'])
    const stale = plan(host, [{ action: 'chart.setTimeframe', target: 'a-left', args: { timeframe: 'W' } }])
    expect(stale.ok).toBe(false)
    expect(stale.refusals[0].reason).toBe('That target is not on the workspace.')
    const fresh = plan(host, ['i-one', 'i-two'].map(r => ({ action: 'chart.setTimeframe', target: r, args: { timeframe: 'W' } })))
    expect((await commitPlan(host, fresh)).ok).toBe(true)
  })
  it('an Undo never reaches across a layout switch', async () => {
    const { host } = lib()
    const res = await commitPlan(host, plan(host, [{ action: 'chart.setTimeframe', target: 'a-left', args: { timeframe: 'W' } }]))
    expect(res.ok).toBe(true)
    host.layouts.open({ id: 12 })                                      // the member switches by hand
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(false)
    expect(u.reason).toMatch(/different layout is open/)
  })
  it('a switch Undo is refused once the member has changed the board since', async () => {
    const { host, state } = lib()
    const res = await commitPlan(host, plan(host, fastOps(host, 'open intraday scan')))
    state.widgets = state.widgets.map(w => (w.id === 'i-one' ? { ...w, w: 10 } : w))
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(false)
    expect(host.layouts.snapshot().active.name).toBe('Intraday Scan')
  })
})

describe('layout.saveAs', () => {
  it('a new, unique name is PROPOSED, then saved through createOnly; it becomes the open layout; no Undo', async () => {
    const { host, state } = lib()
    const ops = fastOps(host, 'Save this setup as Earnings Watch')
    expect(ops).toEqual([{ action: 'layout.saveAs', target: 'layouts', args: { name: 'Earnings Watch' } }])
    const p = plan(host, ops)
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines).toEqual(['Saved this workspace as a new layout “Earnings Watch” (now open)'])
    expect(state.layouts.calls).toEqual([])
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(host.layouts.snapshot().active.name).toBe('Earnings Watch')
    expect(res.undo).toBeNull()
  })
  it('an EXISTING name (any case) is refused before any write — never overwritten', () => {
    const { host, state } = lib()
    const p = plan(host, fastOps(host, 'save this as momentum'))
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toBe('You already have a layout named “Momentum” — I won\'t overwrite it. Pick another name.')
    expect(state.layouts.calls).toEqual([])
  })
  it('a name taken AFTER the plan (another tab) is caught at commit — still nothing replaced', async () => {
    const { host, state } = lib()
    const p = plan(host, fastOps(host, 'save this as Earnings Watch'))
    state.layouts.entries = [...state.layouts.entries, { id: 77, name: 'Earnings Watch', scope: 'user' }]
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(false)
    expect(state.layouts.calls.some(c => c[0] === 'saveAs')).toBe(false)
  })
})

describe('layout.rename', () => {
  it('your own layout: proposed, renamed by id, and Undo renames it back', async () => {
    const { host } = lib()
    const p = plan(host, fastOps(host, 'Rename Agent Test to Swing Trading'))
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines).toEqual(['Renamed “Agent Test” to “Swing Trading”'])
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(host.layouts.snapshot().entries.find(e => e.id === 11).name).toBe('Swing Trading')
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(host.layouts.snapshot().entries.find(e => e.id === 11).name).toBe('Agent Test')
  })
  it('prebuilt / built-in layouts and taken names are refused', () => {
    const { host } = lib()
    expect(plan(host, fastOps(host, 'rename 1-Chart to Mine')).refusals[0].reason).toMatch(/only your own layouts/)
    expect(plan(host, fastOps(host, 'rename Agent Test to Momentum')).refusals[0].reason).toMatch(/won't overwrite/)
  })
})

describe('a stored proposal never runs on a different board', () => {
  let records
  beforeEach(() => {
    records = []
    try { localStorage.clear() } catch { /* */ }
    globalThis.fetch = vi.fn(async (url, init) => {
      const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url === '/api/agent/record') { records.push(JSON.parse(init.body)); return json({ conversationId: 'ac_1' }) }
      return json({ conversations: [] })
    })
  })
  afterEach(() => { vi.restoreAllMocks() })
  const type = (text) => {
    const box = screen.getByLabelText('Message UCT Agent')
    fireEvent.change(box, { target: { value: text } })
    fireEvent.keyDown(box, { key: 'Enter' })
  }
  it('proposal on Agent Test → member switches to another layout by hand → "do it" refuses, nothing changes', async () => {
    const { host, state } = lib()
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('make both charts weekly')
    await screen.findByTestId('agent-proposal')
    await act(async () => { host.layouts.open({ id: 12 }) })          // manual switch (think: Main Trading)
    const board = JSON.stringify(state.widgets)
    type('do it')
    await screen.findByText(/different layout is open now/)
    expect(JSON.stringify(state.widgets)).toBe(board)
    expect(state.widgets.every(w => !w.opts.tf)).toBe(true)
  })
  it('a fast layout question is answered without the model', async () => {
    const { host } = lib()
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('which layout am I on')
    await screen.findByText('You\'re on “Agent Test” (yours).')
    await waitFor(() => expect(records.length).toBe(1))
    expect(globalThis.fetch.mock.calls.some(([u]) => u === '/api/agent/turn')).toBe(false)
  })
})

describe('layout.delete — your own, never the open one, proposed, re-checked, no Undo', () => {
  const del = (layout) => ({ action: 'layout.delete', target: 'layouts', args: { layout } })
  it('a non-open own layout: proposed; Apply deletes exactly that id through the dock; no Undo', async () => {
    const { host, state } = lib()
    const p = plan(host, [del('13')])
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines).toEqual(['Deleted the layout “Momentum” (permanent)'])
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(res.undo).toBeNull()
    expect(state.layouts.calls).toEqual([['remove', 13]])
    expect(state.layouts.entries.map(e => e.name)).not.toContain('Momentum')
    expect(state.layouts.entries.map(e => e.name)).toEqual(expect.arrayContaining(['Momentum 2', 'Momentum Swing']))
  })
  it.each([
    ['11', /is the layout open now — open another layout first/],
    ['5', /is a prebuilt layout — only your own layouts can be deleted/],
    ['uct-default', /is a built-in layout/],
    ['999', /isn't in your layout list/],
  ])('refused before any write: %s', (id, re) => {
    const { host, state } = lib()
    const p = plan(host, [del(id)])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(re)
    expect(state.layouts.calls).toEqual([])
  })
  it('STALE: renamed elsewhere / already gone / now open → refused at Apply; a server refusal is reported', async () => {
    const a = lib(); const pa = plan(a.host, [del('13')])
    a.state.layouts.entries = a.state.layouts.entries.map(e => (e.id === 13 ? { ...e, name: 'Momentum (old)' } : e))
    expect((await commitPlan(a.host, pa)).failed[0].reason).toMatch(/changed since I read it|changed while I was working/)
    expect(a.state.layouts.calls).toEqual([])
    const b = lib(); const pb = plan(b.host, [del('13')])
    b.state.layouts.entries = b.state.layouts.entries.filter(e => e.id !== 13)
    expect((await commitPlan(b.host, pb)).failed[0].reason).toMatch(/already gone|changed while I was working/)
    expect(b.state.layouts.calls).toEqual([])
    const c = lib(); const pc = plan(c.host, [del('13')])
    c.state.layouts.activeId = 13
    expect((await commitPlan(c.host, pc)).failed[0].reason).toMatch(/is open now|changed while I was working/)
    expect(c.state.layouts.calls).toEqual([])
    const d = lib(); const pd = plan(d.host, [del('13')])
    d.state.layouts.failRemove = true
    const rd = await commitPlan(d.host, pd)
    expect(rd.ok).toBe(false)
    expect(rd.failed[0].reason).toMatch(/Delete failed/)
    expect(d.state.layouts.entries.some(e => e.id === 13)).toBe(true)
  })
})

describe('layout.delete — a change only the SERVER knew is caught by the Apply-time re-read', () => {
  it('renamed in another tab (seen only on refresh) → refused, nothing deleted', async () => {
    const { host, state } = lib()
    const p = plan(host, [{ action: 'layout.delete', target: 'layouts', args: { layout: '13' } }])
    state.layouts.onRefresh = () => { state.layouts.entries = state.layouts.entries.map(e => (e.id === 13 ? { ...e, name: 'Momentum Keep' } : e)) }
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/that layout changed since I read it/)
    expect(state.layouts.calls).toEqual([])
  })
})

describe('layout.duplicate — a create-only copy of the stored layout', () => {
  const dup = (layout, name) => ({ action: 'layout.duplicate', target: 'layouts', args: { layout, name } })
  it('default name "<name> copy"; a copy of a prebuilt becomes your own; never opened; proposed', async () => {
    const { host, state } = lib()
    const p = plan(host, [dup('12', null)])
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines).toEqual(['Copied “Intraday Scan” to a new layout “Intraday Scan copy”'])
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(state.layouts.calls).toEqual([['duplicate', 12, 'Intraday Scan copy']])
    expect(state.layouts.activeId).toBe(11)
    const p2 = plan(host, [dup('12', null)])
    expect(p2.lines[0]).toMatch(/“Intraday Scan copy 2”/)
  })
  it('an existing name is refused at plan AND (made elsewhere meanwhile) at Apply — never overwritten', async () => {
    expect(plan(lib().host, [dup('12', 'Momentum')]).refusals[0].reason).toMatch(/already have a layout named “Momentum” — I won't overwrite it/)
    const { host, state } = lib()
    const p = plan(host, [dup('12', 'Breakout Setup')])
    state.layouts.entries = [...state.layouts.entries, { id: 77, name: 'Breakout Setup', scope: 'user' }]
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/already have a layout named “Breakout Setup”|changed while I was working/)
    expect(state.layouts.calls).toEqual([])
  })
})

describe('layout.duplicate fast path', () => {
  it('"make a copy of my Intraday Scan" → duplicate with the default name; a new name or an unknown layout goes to the model', () => {
    const { host } = lib()
    expect(fastOps(host, 'make a copy of my Intraday Scan')).toEqual([{ action: 'layout.duplicate', target: 'layouts', args: { layout: '12', name: null } }])
    expect(fastOps(host, 'duplicate the Intraday Scan layout')).toEqual([{ action: 'layout.duplicate', target: 'layouts', args: { layout: '12', name: null } }])
    expect(fastOps(host, 'make a copy of my Nonexistent')).toBeNull()
  })
})

describe('layout.create — a new EMPTY layout, created before anything else, board untouched', () => {
  const create = (name) => ({ action: 'layout.create', target: 'layouts', args: { name } })
  it('proposed; Apply creates exactly that row (create-only) and reads it back; the board and the open layout are untouched; Undo deletes it', async () => {
    const { host, state } = lib()
    const board = JSON.stringify(state.widgets)
    const p = plan(host, [create('Research')])
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines[0]).toMatch(/^Created a new empty layout “Research” — your current board is unchanged \(say “open Research” to switch to it\)$/)
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(state.layouts.calls).toEqual([['create', 'Research']])
    expect(JSON.stringify(state.widgets)).toBe(board)
    expect(state.layouts.activeId).toBe(11)
    const back = await undoEntry(host, res.undo)
    expect(back.ok).toBe(true)
    expect(state.layouts.entries.some(e => e.name === 'Research')).toBe(false)
  })
  it('the fast path: "create a new blank layout called Swing Trading"', () => {
    const { host } = lib()
    expect(fastOps(host, 'create a new blank layout called Swing Trading')).toEqual([{ action: 'layout.create', target: 'layouts', args: { name: 'Swing Trading' } }])
    expect(fastOps(host, 'start a fresh layout called Research')).toEqual([{ action: 'layout.create', target: 'layouts', args: { name: 'Research' } }])
  })
  it('duplicate / invalid names refused before any write; a name taken elsewhere meanwhile or a server refusal → nothing claimed, board untouched', async () => {
    expect(plan(lib().host, [create('Momentum')]).refusals[0].reason).toMatch(/already have a layout named “Momentum”/)
    expect(plan(lib().host, [create('   ')]).refusals[0].reason).toMatch(/needs a name/)
    expect(plan(lib().host, [create('x'.repeat(61))]).refusals[0].reason).toMatch(/at most 60/)
    const a = lib(); const pa = plan(a.host, [create('Research')])
    a.state.layouts.onRefresh = () => { a.state.layouts.entries = [...a.state.layouts.entries, { id: 88, name: 'Research', scope: 'user' }] }
    const ra = await commitPlan(a.host, pa)
    expect(ra.ok).toBe(false)
    expect(a.state.layouts.calls).toEqual([])
    const b = lib(); const board = JSON.stringify(b.state.widgets); const pb = plan(b.host, [create('Research')])
    b.state.layouts.failCreate = true
    const rb = await commitPlan(b.host, pb)
    expect(rb.ok).toBe(false)
    expect(rb.failed[0].reason).toMatch(/Save failed/)
    expect(JSON.stringify(b.state.widgets)).toBe(board)
  })
  it('Undo is refused once the new layout was opened (it is in use now)', async () => {
    const { host, state } = lib()
    const res = await commitPlan(host, plan(host, [create('Research')]))
    state.layouts.activeId = state.layouts.entries.find(e => e.name === 'Research').id
    const back = await undoEntry(host, res.undo)
    expect(back.ok).toBe(false)
    expect(state.layouts.entries.some(e => e.name === 'Research')).toBe(true)
  })
})

describe('Batch 3 benchmark fixes — deterministic phrasing', () => {
  it('"make a blank layout called Research and switch to it" → create only (switching stays a separate step)', () => {
    const { host } = lib()
    expect(fastOps(host, 'Make a blank layout called Research and switch to it')).toEqual([{ action: 'layout.create', target: 'layouts', args: { name: 'Research' } }])
  })
  it('"duplicate my Intraday Scan and call it Morning Prep" → the EXACT source, the given name', () => {
    const { host } = lib()
    expect(fastOps(host, 'Duplicate my Intraday Scan and call it Morning Prep')).toEqual([{ action: 'layout.duplicate', target: 'layouts', args: { layout: '12', name: 'Morning Prep' } }])
    expect(fastOps(host, 'copy Intraday Scan as Scan 2')).toEqual([{ action: 'layout.duplicate', target: 'layouts', args: { layout: '12', name: 'Scan 2' } }])
    expect(fastOps(host, 'duplicate my Nonexistent and call it X')).toBeNull()
  })
})
