// UCT Agent — NL Intent N2: typo-tolerant names (layouts, watchlists, saved screens, templates).
// One clear match → used for safe actions; a tie → asked; high-impact actions → STRICT and confirmed.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { getCapability, buildContext } from './capabilities'
import { planOps, collectTargets } from './executor'
import { matchName, editDistance } from './nl/match'
import { loadSaved } from './capabilities/screener'
import { makeBoard } from './__fixtures__/board'
import { protectionRefusal } from './protectedLayouts'

registerBuiltins()
const LAYOUTS = [
  { id: 1, name: 'Swing Board', scope: 'user' }, { id: 2, name: 'Day Trading', scope: 'user' },
  { id: 3, name: 'Earnings Week', scope: 'user' }, { id: 4, name: 'Main Trading', scope: 'user' },
]
const LISTS = [{ id: 'm1', name: 'Momentum', symbols: ['NVDA'] }, { id: 's1', name: 'Swing', symbols: ['TSLA'] }, { id: 'e1', name: 'Earnings Plays', symbols: [] }]
const board = (layouts = LAYOUTS, lists = LISTS) => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 }], { A: 'NVDA' }, { layouts: { entries: layouts, boards: {}, active: 1 }, watchlists: lists })
const fast = (text, host) => { const f = fastParse(text, { host }); return f?.kind === 'ops' ? f.ops.map(o => ({ action: o.action, args: o.args, ...(o.target ? { target: o.target } : {}) })) : f }

describe('matchName', () => {
  it('exact (normalized), one clear typo, a tie, nothing', () => {
    const names = ['Swing Board', 'Day Trading', 'Earnings Week']
    expect(matchName('swing board', names)).toEqual({ kind: 'exact', name: 'Swing Board' })
    expect(matchName('swng board', names)).toEqual({ kind: 'fuzzy', name: 'Swing Board', distance: 1 })
    expect(matchName('earnigns week', names)).toEqual({ kind: 'fuzzy', name: 'Earnings Week', distance: 1 })
    expect(matchName('swing', names).kind).toBe('none')                   // a different rule (word subset), not a typo
    expect(matchName('nvda', names).kind).toBe('none')
    expect(matchName('swinf', ['Swing', 'Swine']).kind).toBe('several')   // a tie is never guessed
  })
  it('short words and numbers are exact only; strict allows one edit on 5+ letter words', () => {
    expect(matchName('swig', ['Swing']).kind).toBe('fuzzy')               // 4 letters: 1 edit (safe)
    expect(matchName('swig', ['Swing'], { level: 'strict' }).kind).toBe('none')
    expect(matchName('momentm', ['Momentum'], { level: 'strict' }).kind).toBe('fuzzy')
    expect(matchName('day', ['Dax']).kind).toBe('none')                   // 3 letters: exact only
    expect(matchName('list 2', ['List 3']).kind).toBe('none')             // numbers never corrected
    expect(editDistance('earnigns', 'earnings')).toBe(1)                  // a transposition is one edit
  })
})

describe('layouts', () => {
  it('a typo in a layout name opens it (instant); a model-planned typo resolves the same way', () => {
    const { host } = board()
    expect(fast('open swng board', host)).toEqual([{ action: 'layout.open', args: { layout: '1' } }])
    expect(fast('open earnigns week', host)).toEqual([{ action: 'layout.open', args: { layout: '3' } }])
    expect(fast('switch to my day tradng layout', host)).toEqual([{ action: 'layout.open', args: { layout: '2' } }])
    expect(getCapability('layout.open').resolveArgs({ layout: 'swng board' }, host)).toEqual({ args: { layout: '1' } })
  })
  it('a tie is ASKED with the real names, never guessed', () => {
    const { host } = board([{ id: 7, name: 'Swing Setup', scope: 'user' }, { id: 8, name: 'Swing Setups', scope: 'user' }])
    const f = fast('open swing setupp', host)
    expect(f).toEqual([{ action: 'layout.open', args: { layout: 'swing setupp' } }])
    expect(getCapability('layout.open').resolveArgs({ layout: 'swing setupp' }, host)).toEqual({ ask: {
      arg: 'layout', text: 'Which layout — “Swing Setup” or “Swing Setups”?', choices: [{ ref: '7', label: 'Swing Setup' }, { ref: '8', label: 'Swing Setups' }],
    } })
  })
  it('nothing close → no guess (the check refuses / the model decides); exact names and "previous" still win', () => {
    const { host } = board()
    expect(fast('open nvda', host)).toBeNull()
    expect(getCapability('layout.open').resolveArgs({ layout: 'blah blah' }, host)).toBeNull()
    expect(fast('open day trading', host)).toEqual([{ action: 'layout.open', args: { layout: '2' } }])
  })
  it('HIGH-IMPACT rename / copy: strict (one edit, 5+ letters) and still a proposal naming the real layout', () => {
    const { host } = board()
    const r = fast('rename earnigns week to Earnings', host)
    expect(r?.[0]?.action).toBe('layout.rename')
    expect(fast('rename swng board to X', host)).toBeNull()               // "swng" is 4 letters: not under strict
    expect(fast('make a copy of earnigns week called EW2', host)?.[0]?.action).toBe('layout.duplicate')
    expect(getCapability('layout.rename').risk).toBe('confirm')          // proposed, never applied silently
  })
  it('a protected layout reached through a typo is still protected', () => {
    const { host } = board([...LAYOUTS])
    const ops = fast('rename main tradingg to Old', host)
    expect(ops?.[0]?.action).toBe('layout.rename')
    const p = planOps(collectTargets(host, ['layouts']), ops.map(o => ({ ...o, target: 'layouts' })), {}, { surface: 'charts' })
    expect(protectionRefusal(host, p, ops)).toMatch(/“Main Trading” is a protected layout — UCT Agent never renames or deletes it/)
  })
})

describe('watchlists', () => {
  it('safe actions take one clear typo match: add, open, show, remove', () => {
    const { host } = board()
    expect(fast('add nvda to my swig list', host)).toEqual([{ action: 'watchlist.add', args: { symbols: ['NVDA'] }, target: 's1' }])
    expect(fast('open my momentm watchlist', host)?.[0]?.action).toBe('watchlist.open')
    expect(fast('take tsla off swng', host)).toEqual([{ action: 'watchlist.remove', args: { symbols: ['TSLA'] }, target: 's1' }])
  })
  it('rename is strict; a tie or nothing close → no instant action', () => {
    const { host } = board()
    expect(fast('rename momentm to Mo', host)?.[0]).toEqual({ action: 'watchlist.rename', args: { name: 'Mo' }, target: 'm1' })
    expect(fast('rename swig to Sw', host)).toBeNull()
    const tie = board(LAYOUTS, [{ id: 'a', name: 'Swing', symbols: [] }, { id: 'b', name: 'Swine', symbols: [] }])
    expect(fast('add nvda to swinf', tie.host)).toBeNull()
  })
  it('deleting a list has no instant phrase at all: always the model, always a proposal', () => {
    const { host } = board()
    expect(fast('delete my swng list', host)).toBeNull()
    const del = getCapability('watchlist.delete')
    expect(del.reversible === false || del.risk === 'confirm').toBe(true)
  })
})

describe('saved screens and templates', () => {
  beforeAll(async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ saved: [{ id: 41, name: 'Breakout', spec: {} }, { id: 42, name: 'Tight Base', spec: {} }], starters: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await loadSaved({ force: true })
  })
  it('running a saved screen (read-only) takes one clear typo match', () => {
    const { host } = board()
    expect(fast('run my breakuot screen', host)).toEqual([{ action: 'screener.runSaved', args: { screen: '41', show: null, as: null } }])
    expect(fast('run my tight bsae screen', host)?.[0]?.args?.screen).toBe('42')
  })
  it('a template (replaces indicators: high impact) is never applied on a guess — “Did you mean …?”', () => {
    const { host } = board()
    host.prefs = { read: () => ({ chart_templates: JSON.stringify([{ name: 'Swing Setup', settings: { chartType: 'candles' } }, { name: 'Day Setup', settings: {} }]) }) }
    buildContext(host, { surface: 'charts' })                              // the provider reads the member's templates
    const r = getCapability('chart.applyTemplate').resolveArgs({ template: 'swing setp' })
    expect(r).toEqual({ ask: { arg: 'template', text: 'Did you mean your template “Swing Setup”?', choices: [{ ref: 'Swing Setup', label: 'Swing Setup' }] } })
    expect(getCapability('chart.applyTemplate').resolveArgs({ template: 'Swing Setup' })).toBeNull()
    expect(getCapability('chart.applyTemplate').resolveArgs({ template: 'zzz' })).toBeNull()
  })
})
