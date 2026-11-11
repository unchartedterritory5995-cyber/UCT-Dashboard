// The layout bar (C3-037 pin, C3-038 reorder, C3-039 take off the bar), over the REAL LayoutDock.
// The Agent writes only through the dock's own door (LayoutDock agentRef → host.layoutDock): the dock's writer and the
// menu's positional helpers. It reads the bar back from the dock, never claims a write the server did not accept, never
// writes over a bar that changed since it was read, never deletes or opens a layout, and asks (changing nothing) when the
// words could mean two layouts or a layout that sits on the bar twice.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { useSyncExternalStore, createRef } from 'react'
import { registerBuiltins } from './builtins'
import { planOps, collectTargets } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { buildLayoutDockSource } from './host'
import { UCT_DEFAULT_ID } from '../pages/charts/layoutDockPins'

// The dock's preferences: a tiny reactive store. setPref is optimistic, like usePreferences, and answers whether the
// server accepted it (`refuse` makes the server say no; the optimistic value stays, as usePreferences keeps it).
const prefsStore = { prefs: {}, subs: new Set(), refuse: false, writes: 0 }
const emit = () => prefsStore.subs.forEach(f => f())
const setPref = vi.fn(async (k, v) => { prefsStore.writes += 1; prefsStore.prefs = { ...prefsStore.prefs, [k]: v }; emit(); return !prefsStore.refuse })
vi.mock('../hooks/usePreferences', () => ({
  default: () => {
    const prefs = useSyncExternalStore((f) => { prefsStore.subs.add(f); return () => prefsStore.subs.delete(f) }, () => prefsStore.prefs)
    return { prefs, setPref, loading: false }
  },
  parsePref: (raw, fallback) => { if (raw == null) return fallback; if (typeof raw !== 'string') return raw; try { return JSON.parse(raw) } catch { return fallback } },
}))
const LayoutDock = (await import('../pages/charts/LayoutDock')).default

registerBuiltins()
const CTX = { surface: 'charts' }
const ENTRIES = [
  { id: UCT_DEFAULT_ID, name: 'UCT Default', scope: 'global' },
  { id: 1, name: 'Main Trading', scope: 'user' },
  { id: 2, name: 'Breadth', scope: 'user' },
  { id: 3, name: 'Day Trading', scope: 'user' },
]
const bar = () => JSON.parse(prefsStore.prefs.charts_layout_dock).pins
const shown = () => [...document.querySelectorAll('[aria-hidden="true"] span[class] > span')].map(e => e.textContent)
let onOpen, onDelete, ref
function mount(pins, known = [UCT_DEFAULT_ID, 1, 2, 3]) {
  prefsStore.prefs = { charts_layout_dock: JSON.stringify({ pins, known, hidden: false }) }
  prefsStore.refuse = false
  prefsStore.writes = 0
  onOpen = vi.fn(); onDelete = vi.fn()
  ref = createRef()
  render(<LayoutDock entries={ENTRIES} activeId={1} onOpen={onOpen} onDelete={onDelete} agentRef={ref} />)
  return { layoutDock: buildLayoutDockSource(() => ref.current) }
}
beforeEach(() => { cleanup(); setPref.mockClear() })

const opsOf = (host, text) => {
  const f = fastParse(text, { host })
  return f && f.kind === 'ops' ? f.ops.map(o => ({ ...o, target: 'layoutDock' })) : null
}
const plan = (host, ops) => planOps(collectTargets(host, ['layoutDock']), ops, {}, CTX)
const run = async (host, ops) => { let res; await act(async () => { res = await commitPlan(host, plan(host, ops)) }); return res }
const undo = async (host, entry) => { let res; await act(async () => { res = await undoEntry(host, entry) }); return res }

describe('the layout bar: pin, take off, reorder (the dock\'s own writer, read back, exact Undo)', () => {
  it('C3-037 "pin my Breadth layout to the bar": a slot on the end, the library and the board untouched; Undo takes it off', async () => {
    const host = mount([UCT_DEFAULT_ID, 1])
    const ops = opsOf(host, 'pin my Breadth layout to the bar')
    expect(ops).toEqual([{ action: 'layout.pinToBar', target: 'layoutDock', args: { layout: '2' } }])
    expect(decideMode('apply', plan(host, ops))).toBe('apply')
    const res = await run(host, ops)
    expect(res.ok).toBe(true)
    expect(bar()).toEqual([UCT_DEFAULT_ID, 1, 2])
    expect(shown()).toEqual(['UCT Default', 'Main Trading', 'Breadth'])
    expect(onOpen).not.toHaveBeenCalled()                       // pinning never switches the board
    expect(res.lines.join(' ')).toMatch(/Pinned “Breadth” to the layout bar \(the 3rd spot\)\. It is not opened/)
    const u = await undo(host, res.undo)
    expect(u.ok).toBe(true)
    expect(bar()).toEqual([UCT_DEFAULT_ID, 1])
  })

  it('C3-039 "take Main Trading off the bar": Close, never a delete; Undo puts it back in the same spot', async () => {
    const host = mount([UCT_DEFAULT_ID, 1, 2])
    const ops = opsOf(host, 'take Main Trading off the bar')
    expect(ops).toEqual([{ action: 'layout.unpinFromBar', target: 'layoutDock', args: { layout: '1' } }])
    const res = await run(host, ops)
    expect(res.ok).toBe(true)
    expect(bar()).toEqual([UCT_DEFAULT_ID, 2])
    expect(onDelete).not.toHaveBeenCalled()
    expect(host.layoutDock.snapshot().library.map(e => e.name)).toContain('Main Trading')
    expect(res.lines.join(' ')).toMatch(/Took “Main Trading” off the layout bar\. It is still in your layout library/)
    const u = await undo(host, res.undo)
    expect(u.ok).toBe(true)
    expect(bar()).toEqual([UCT_DEFAULT_ID, 1, 2])
  })

  it('C3-038 "move Breadth to the front of the bar", then one spot right; Undo moves it back', async () => {
    const host = mount([UCT_DEFAULT_ID, 1, 2])
    const ops = opsOf(host, 'move Breadth to the front of the bar')
    expect(ops[0]).toMatchObject({ action: 'layout.moveOnBar', args: { layout: '2', to: 'front' } })
    const res = await run(host, ops)
    expect(bar()).toEqual([2, UCT_DEFAULT_ID, 1])
    expect(shown()).toEqual(['Breadth', 'UCT Default', 'Main Trading'])
    expect(res.lines.join(' ')).toMatch(/Moved “Breadth” on the layout bar from the 3rd spot to the 1st\./)
    const r2 = await run(host, opsOf(host, 'move breadth to the right on the bar'))
    expect(r2.ok).toBe(true)
    expect(bar()).toEqual([UCT_DEFAULT_ID, 2, 1])
    expect((await undo(host, r2.undo)).ok).toBe(true)
    expect(bar()).toEqual([2, UCT_DEFAULT_ID, 1])
  })

  it('a planned move to a numbered spot; edges and "already there" are refused or no-ops, and nothing is written', async () => {
    const host = mount([UCT_DEFAULT_ID, 1, 2])
    const res = await run(host, [{ action: 'layout.moveOnBar', target: 'layoutDock', args: { layout: 'UCT Default', to: '3' } }])
    expect(res.ok).toBe(true)
    expect(bar()).toEqual([1, 2, UCT_DEFAULT_ID])
    const writes = prefsStore.writes
    expect(plan(host, [{ action: 'layout.moveOnBar', target: 'layoutDock', args: { layout: '1', to: 'left' } }]).refusals[0].reason).toMatch(/already the first/)
    expect(plan(host, [{ action: 'layout.moveOnBar', target: 'layoutDock', args: { layout: '1', to: 'spot 9' } }]).refusals[0].reason).toMatch(/has 3 spots/)
    const pinAgain = plan(host, [{ action: 'layout.pinToBar', target: 'layoutDock', args: { layout: 'Breadth' } }])
    expect(pinAgain.plans.every(p => !p.patch)).toBe(true)
    expect(prefsStore.writes).toBe(writes)
  })
})

describe('⛔ targeting and safety', () => {
  it('two layouts the words could mean → asks with both names; the fast path does not claim it; nothing is written', async () => {
    const host = mount([UCT_DEFAULT_ID, 1, 2, 3])
    expect(opsOf(host, 'take my trading layout off the bar')).toBeNull()
    const p = plan(host, [{ action: 'layout.unpinFromBar', target: 'layoutDock', args: { layout: 'my trading layout' } }])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/Which layout do you mean: “Main Trading” or “Day Trading”\? Nothing was changed\./)
    expect(prefsStore.writes).toBe(0)
  })

  it('a layout on the bar twice → asks which spot; nothing is written', async () => {
    const host = mount([1, 2, 1])
    const p = plan(host, opsOf(host, 'take Main Trading off the bar'))
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/is on the layout bar 2 times \(the 1st and 3rd spots\)/)
    expect(prefsStore.writes).toBe(0)
  })

  it('wrong target: chart and layout-library sentences are never the bar', () => {
    const host = mount([UCT_DEFAULT_ID, 1, 2])
    for (const t of ['move the chart to the left', 'delete Main Trading', 'remove Main Trading', 'open Breadth', 'close the Breadth tab']) {
      const f = fastParse(t, { host })
      const actions = f && f.kind === 'ops' ? f.ops.map(o => o.action) : []
      expect(actions.some(a => /Bar$/.test(a)), t).toBe(false)
    }
  })

  it('the bar changed after the plan was made → nothing is written over it, and it says so', async () => {
    const host = mount([UCT_DEFAULT_ID, 1, 2])
    const p = plan(host, opsOf(host, 'take Breadth off the bar'))
    // another tab moved the bar meanwhile
    act(() => { prefsStore.prefs = { charts_layout_dock: JSON.stringify({ pins: [2, UCT_DEFAULT_ID, 1], known: [UCT_DEFAULT_ID, 1, 2, 3], hidden: false }) }; emit() })
    let res; await act(async () => { res = await commitPlan(host, p) })
    expect(res.ok).toBe(false)
    // the runtime's fingerprint of the bar catches it first; the commit's own check is the second line (see the mutant in the PR doc)
    expect(res.failed[0].say || res.failed[0].reason).toMatch(/changed (?:while I was working|since I read it)/)
    expect(res.lines).toEqual([])
    expect(bar()).toEqual([2, UCT_DEFAULT_ID, 1])
    expect(prefsStore.writes).toBe(0)
  })

  it('the server refuses the write → it is put back, no receipt, and the member is told nothing changed', async () => {
    const host = mount([UCT_DEFAULT_ID, 1, 2])
    prefsStore.refuse = true
    const res = await run(host, opsOf(host, 'take Breadth off the bar'))
    expect(res.ok).toBe(false)
    expect(res.lines).toEqual([])
    expect(res.failed[0].say).toMatch(/did not go through, so I put it back\. Nothing was changed\./)
    expect(bar()).toEqual([UCT_DEFAULT_ID, 1, 2])
  })

  it('no dock (not /charts) → refused, never a receipt', () => {
    const host = { layoutDock: buildLayoutDockSource(() => null) }
    expect(collectTargets(host, ['layoutDock']).size).toBe(0)
  })
})
