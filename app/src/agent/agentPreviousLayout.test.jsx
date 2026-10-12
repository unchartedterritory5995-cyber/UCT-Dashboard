// UCT Agent — Context & Awareness, Slice 1A: "the previous layout" (capabilities/layout.js).
// The end-to-end rails (real ChartsWorkspace + Dock + panel) are in
// pages/charts/ChartsWorkspace.previousLayout.test.jsx; these pin the resolution rules.
import { describe, it, expect } from 'vitest'
import { buildContext, getCapability } from './capabilities'
import { registerBuiltins } from './builtins'
import { planOps, collectTargets } from './executor'
import { fastParse } from './fastPath'
import { isPrevious, backPhrase } from './capabilities/layout'
import { makeBoard } from './__fixtures__/board'

registerBuiltins()
const CTX = { surface: 'charts' }
const ENTRIES = [
  { id: 'uct-default', name: 'UCT Default', scope: 'global' },
  { id: 11, name: 'Main Trading', scope: 'user' },
  { id: 12, name: 'Swing Board', scope: 'user' },
  { id: 13, name: 'Macro Board', scope: 'user' },
]
// a library whose host reports this tab's trail (`recent`), as ChartsWorkspace's ref does
function lib({ active = 12, recent = [{ id: 11, name: 'Main Trading' }], entries = ENTRIES } = {}) {
  const b = makeBoard([], { A: 'AAPL' }, { layouts: { entries, boards: {}, active } })
  const base = b.host.layouts.snapshot
  b.host.layouts = { ...b.host.layouts, snapshot: () => ({ ...base(), recent }) }
  return b
}
const open = getCapability('layout.open')
const fastOps = (host, text) => { const f = fastParse(text, { host }); return f && f.kind === 'ops' ? f.ops : null }

describe('"previous" is a whole phrase, never a substring', () => {
  it.each([
    'previous', 'the previous layout', 'my last layout', 'last', 'the other one', 'prior layout',
    'the layout I was just on', 'the one I was using', 'the layout before this one', 'the one I had open before',
  ])('%s → previous', (p) => expect(isPrevious(p)).toBe(true))
  it.each(['Back Test', 'trading back', 'previous swing', 'Last Week', 'my swing layout', 'back'])('%s → not previous', (p) => expect(isPrevious(p)).toBe(false))
  it('fast phrases: the reported sentence (with its "Okay, now" lead-in) and its variants', () => {
    const { host } = lib()
    for (const t of ['Okay, now switch back to the previous layout', 'switch back to the previous layout', 'go back to my last layout',
      'take me back to the layout I was just on', 'open the previous layout', 'switch back to the other one']) {
      expect(fastOps(host, t), t).toEqual([{ action: 'layout.open', args: { layout: 'previous' } }])
    }
    expect(backPhrase('open the last one')).toBeNull()               // no "back" and no "layout": the model's
  })
  it('bare "go back" / "undo" stay UNDO — navigation never takes them', () => {
    const { host } = lib()
    expect(fastParse('go back', { host }).kind).toBe('undo')
    expect(fastParse('undo', { host }).kind).toBe('undo')
  })
})

describe('a layout NAME always wins over the keyword', () => {
  it('"open my last layout" with a layout named "Last Week" opens Last Week', () => {
    const { host } = lib({ entries: [...ENTRIES, { id: 20, name: 'Last Week', scope: 'user' }] })
    expect(fastOps(host, 'open my last layout')).toEqual([{ action: 'layout.open', args: { layout: '20' } }])
  })
  it('"go back to Back Test" opens the layout called Back Test', () => {
    const { host } = lib({ entries: [...ENTRIES, { id: 21, name: 'Back Test', scope: 'user' }] })
    expect(fastOps(host, 'go back to back test')).toEqual([{ action: 'layout.open', args: { layout: '21' } }])
  })
})

describe('resolveArgs: the same rule for instant AND model-planned args', () => {
  it('the member\'s words from the model resolve to the trail\'s most recent other layout', () => {
    const { host } = lib()
    for (const words of ['previous', 'the previous layout', 'the one I was just using']) {
      expect(open.resolveArgs({ layout: words }, host)).toEqual({ args: { layout: '11' } })
    }
    // an id or a real name is untouched by the trail
    expect(open.resolveArgs({ layout: '13' }, host)).toBeNull()
    expect(open.resolveArgs({ layout: 'Macro Board' }, host)).toEqual({ args: { layout: '13' } })
  })
  it('no history → no resolution, and the planner refuses honestly (nothing opens)', () => {
    const { host, state } = lib({ recent: [] })
    expect(open.resolveArgs({ layout: 'previous' }, host)).toBeNull()
    const p = planOps(collectTargets(host, ['layouts']), [{ action: 'layout.open', target: 'layouts', args: { layout: 'previous' } }], {}, CTX)
    expect(p.refusals[0].reason).toMatch(/hasn't had another layout open yet/)
    expect(state.layouts.calls).toEqual([])
  })
  it('the previous one was deleted → ask with the recent layouts still there (the pickArg shape)', () => {
    const { host } = lib({ recent: [{ id: 99, name: 'Gone Board' }, { id: 13, name: 'Macro Board' }] })
    expect(open.resolveArgs({ layout: 'previous' }, host)).toEqual({ ask: {
      arg: 'layout', text: '“Gone Board” isn\'t in your layout list anymore. Open one of your other recent layouts?',
      choices: [{ ref: '13', label: 'Macro Board' }],
    } })
  })
})

describe('context: previous / recent, bounded', () => {
  it('says what "previous" opens, with today\'s names; deleted and open layouts never appear', () => {
    const { host } = lib({ recent: [{ id: 11, name: 'Old Name' }, { id: 99, name: 'Gone' }, { id: 13, name: 'Macro Board' }] })
    const L = buildContext(host, CTX).context.layouts[0]
    expect(L.previous).toEqual({ id: '11', name: 'Main Trading' })
    expect(L.recent).toEqual([{ id: '11', name: 'Main Trading' }, { id: '13', name: 'Macro Board' }])
  })
  it('previous is null when the last layout left is gone (never silently an older one)', () => {
    const { host } = lib({ recent: [{ id: 99, name: 'Gone' }, { id: 13, name: 'Macro Board' }] })
    expect(buildContext(host, CTX).context.layouts[0].previous).toBeNull()
  })
  it('adds well under 250 bytes', () => {
    const with5 = lib({ recent: ENTRIES.filter(e => e.id !== 12).map(e => ({ id: e.id, name: e.name })) })
    const none = lib({ recent: [] })
    const size = (h) => JSON.stringify(buildContext(h.host, CTX).context.layouts).length
    expect(size(with5) - size(none)).toBeLessThan(250)
  })
})
