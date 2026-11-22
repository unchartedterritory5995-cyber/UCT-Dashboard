// CHARTS OUTCOME — the layout bar (C3-037 pin, C3-038 reorder, C3-039 take off the bar): the state is read from the REAL
// LayoutDock (its stored rail, `charts_layout_dock`, and the slots it renders), mounted beside the real AgentPanel and
// reached only through the dock's own door (LayoutDock agentRef → host.layoutDock). Only the model is scripted, from the
// request's context. The board, the layout library and the open layout stay as they were.
//
// ⛔ Evidence: LOCAL native Windows Node, jsdom, scripted model (SIMULATED). Not a browser, not the real model.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useSyncExternalStore, createRef } from 'react'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, must, waitFor, refusals } from './outcomeHarness'
import { buildLayoutDockSource } from '../../host'
import { UCT_DEFAULT_ID } from '../../../pages/charts/layoutDockPins'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
const prefsStore = { prefs: {}, subs: new Set() }
vi.mock('../../../hooks/usePreferences', () => ({
  default: function usePreferencesMock() {
    const prefs = useSyncExternalStore((f) => { prefsStore.subs.add(f); return () => prefsStore.subs.delete(f) }, () => prefsStore.prefs)
    return {
      prefs, loading: false,
      setPref: async (k, v) => { prefsStore.prefs = { ...prefsStore.prefs, [k]: v }; prefsStore.subs.forEach(f => f()); return true },
    }
  },
  parsePref: (raw, fallback) => { if (raw == null) return fallback; if (typeof raw !== 'string') return raw; try { return JSON.parse(raw) } catch { return fallback } },
}))
const LayoutDock = (await import('../../../pages/charts/LayoutDock')).default
await outcomeSuite()
afterEach(afterEachOutcome)

const ENTRIES = [
  { id: UCT_DEFAULT_ID, name: 'UCT Default', scope: 'global' },
  { id: 1, name: 'Main Trading', scope: 'user' },
  { id: 2, name: 'Breadth', scope: 'user' },
  { id: 3, name: 'Day Trading', scope: 'user' },
]
const bar = () => JSON.parse(prefsStore.prefs.charts_layout_dock).pins
const shown = () => [...document.querySelectorAll('[aria-hidden="true"] span[class] > span')].map(e => e.textContent)
const dockEntry = (c) => must(c.layoutDock?.[0], 'layout bar entry')
const spotOf = (c, name) => must(dockEntry(c).bar.find(x => x.layout === name), `${name} on the bar`)

function mount(pins) {
  const m = open(QUAD(), QUAD_SYMS, { selected: 'bl' })
  act(() => { prefsStore.prefs = { charts_layout_dock: JSON.stringify({ pins, known: [UCT_DEFAULT_ID, 1, 2, 3], hidden: false }) }; prefsStore.subs.forEach(f => f()) })
  const ref = createRef()
  const calls = { open: vi.fn(), del: vi.fn() }
  render(<LayoutDock entries={ENTRIES} activeId={1} onOpen={calls.open} onDelete={calls.del} agentRef={ref} />)
  m.h.layoutDock = buildLayoutDockSource(() => ref.current)
  const board0 = JSON.stringify(m.board.state.widgets)
  return { m, calls, boardSame: () => JSON.stringify(m.board.state.widgets) === board0 }
}

describe('the layout bar through the panel', () => {
  it('C3-037 "pin my Breadth layout to the bar": a slot on the end; not opened; the board untouched; "undo" takes it off', async () => {
    const { m, calls, boardSame } = mount([UCT_DEFAULT_ID, 1])
    await m.say('pin my Breadth layout to the bar')
    await waitFor(() => expect(bar()).toEqual([UCT_DEFAULT_ID, 1, 2]))
    expect(shown()).toEqual(['UCT Default', 'Main Trading', 'Breadth'])
    expect(m.lastReceipt().textContent).toMatch(/Pinned “Breadth” to the layout bar/)
    expect(calls.open).not.toHaveBeenCalled()
    expect(boardSame()).toBe(true)
    await m.say('undo')
    await waitFor(() => expect(bar()).toEqual([UCT_DEFAULT_ID, 1]))
  })

  it('C3-038 a planned "make Breadth my leftmost layout": the spot comes from the bar in the request; "undo" moves it back', async () => {
    const { m, boardSame } = mount([UCT_DEFAULT_ID, 1, 2])
    await m.say('can you make Breadth my leftmost layout', (c) => [{ action: 'layout.moveOnBar', target: dockEntry(c).ref, args: { layout: spotOf(c, 'Breadth').id, to: 'first' } }])
    await waitFor(() => expect(bar()).toEqual([2, UCT_DEFAULT_ID, 1]))
    expect(shown()).toEqual(['Breadth', 'UCT Default', 'Main Trading'])
    expect(m.lastReceipt().textContent).toMatch(/Moved “Breadth” on the layout bar from the 3rd spot to the 1st/)
    expect(boardSame()).toBe(true)
    await m.say('undo')
    await waitFor(() => expect(bar()).toEqual([UCT_DEFAULT_ID, 1, 2]))
  })

  it('C3-039 "take Main Trading off the bar": off the bar, still in the library, never deleted', async () => {
    const { m, calls, boardSame } = mount([UCT_DEFAULT_ID, 1, 2])
    await m.say('take Main Trading off the bar')
    await waitFor(() => expect(bar()).toEqual([UCT_DEFAULT_ID, 2]))
    expect(m.lastReceipt().textContent).toMatch(/Took “Main Trading” off the layout bar\. It is still in your layout library/)
    expect(calls.del).not.toHaveBeenCalled()
    expect(m.h.layoutDock.snapshot().library.map(e => e.name)).toContain('Main Trading')
    expect(boardSame()).toBe(true)
  })

  it('⛔ wrong target: "take my trading layout off the bar" with two trading layouts asks with both names; the bar is untouched', async () => {
    const { m } = mount([UCT_DEFAULT_ID, 1, 2, 3])
    const out = await m.say('take my trading layout off the bar', (c) => [{ action: 'layout.unpinFromBar', target: dockEntry(c).ref, args: { layout: 'my trading layout' } }])
    const said = `${out || ''} ${refusals().map(e => e.textContent).join(' ')}`
    expect(said).toMatch(/“Main Trading” or “Day Trading”/)
    expect(bar()).toEqual([UCT_DEFAULT_ID, 1, 2, 3])
    expect(m.pending()).toBe(0)
  })
})
