// OWNER APPROVED (2026-11-10): "open my <layout> layout, then <change>" runs as TWO steps. Step 2 resolves its target in the NEWLY
// opened layout: its one chart, or the chart the words name; ambiguous → ASKED, never guessed. Partial-failure reporting and
// bounded Undo as every multi-step request; every save / exclusive rule untouched (a save after an open stays refused whole).
// Built from the family: open verbs × edits × the opened layout's shape. Evidence: LOCAL native Windows Node v24, jsdom,
// BROWSER-MOCK-MODEL / SIMULATED (instant readers; no model call).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel({ tickers: ['SPY', 'NVDA', 'AMD'] }) })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const chart = (id, x = 0, w = 24, color = 'A') => ({ id, type: 'chart', x, y: 0, w, h: 20, color, opts: { settings: bareSettings() } })
const MAIN = [chart('c0')]
const ONE = [chart('s0')]
const TWO = [chart('s0', 0, 12, 'A'), chart('s1', 12, 12, 'B')]
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const mountWith = (swing) => p.mount(MAIN, { A: 'SPY', B: 'AMD' }, { decorate: label, layouts: { entries: [{ id: 1, name: 'Main' }, { id: 2, name: 'Swing' }], active: 1, boards: { 1: MAIN, 2: swing } } })
const widget = (b, id) => b.state.widgets.find(w => w.id === id)
const stored = (b, id) => b.state.layouts.boards[2].find(w => w.id === id)
const tfOf = (w) => w?.opts?.tf || 'D'
const logOf = (w) => !!mergeChartSettings(w?.opts?.settings || null).logScale

const OPENS = ['open my Swing layout', 'switch to the Swing layout', 'load my Swing layout']
const EDITS = [
  { text: 'make it weekly', done: (w) => tfOf(w) === 'W', undone: (w) => tfOf(w) === 'D' },
  { text: 'put it on log scale', done: (w) => logOf(w), undone: (w) => !logOf(w) },
]
const ROWS = OPENS.flatMap((o, i) => EDITS.map((e, j) => [`${o}, then ${e.text}`, e, i + j]))

describe('open a layout, then change its chart: two steps', () => {
  it.each(ROWS.map(([t, e]) => [t, e]))('"%s" (Swing has one chart): Swing opens, its chart changes, receipt per step; Undo takes back both', async (t, e) => {
    const m = mountWith(ONE)
    const out = await m.say(t)
    expect(m.board.state.layouts.activeId, out).toBe(2)
    expect(e.done(widget(m.board, 's0')), out).toBe(true)
    expect(out).not.toMatch(/stopped at|do it in two steps/)
    expect(p.turns()).toBe(0)
    await m.say('undo')
    expect(m.board.state.layouts.activeId).toBe(1)
    expect(m.board.state.widgets.map(w => w.id)).toEqual(['c0'])
    expect(e.undone(stored(m.board, 's0'))).toBe(true)
  }, 60000)
  it('"open my Swing layout, then make the AMD chart weekly" (Swing has two): the chart the words name, only', async () => {
    const m = p.mount(MAIN, { A: 'SPY', B: 'AMD' }, { decorate: label, layouts: { entries: [{ id: 1, name: 'Main' }, { id: 2, name: 'Swing' }], active: 1, boards: { 1: MAIN, 2: TWO } } })
    const out = await m.say('open my Swing layout, then make the AMD chart weekly')
    expect(m.board.state.layouts.activeId, out).toBe(2)
    expect([tfOf(widget(m.board, 's0')), tfOf(widget(m.board, 's1'))], out).toEqual(['D', 'W'])
  }, 60000)
  it.each(EDITS.map(e => [e.text, e]))('AMBIGUOUS "open my Swing layout, then %s" (Swing has two charts, nothing named): Swing opens, then ASKED, nothing guessed', async (_t, e) => {
    const m = p.mount(MAIN, { A: 'SPY', B: 'AMD' }, { decorate: label, layouts: { entries: [{ id: 1, name: 'Main' }, { id: 2, name: 'Swing' }], active: 1, boards: { 1: MAIN, 2: TWO } } })
    const out = await m.say(`open my Swing layout, then ${e.text}`)
    expect(m.board.state.layouts.activeId, out).toBe(2)
    expect(e.undone(widget(m.board, 's0')) && e.undone(widget(m.board, 's1')), out).toBe(true)     // neither changed
    expect(out).toMatch(/Which chart|which one|Name it/i)
    expect(out).toMatch(/Done 1 of 2 steps/)                                                        // honest partial
  }, 60000)
  it('UNCHANGED: a save after an open stays refused whole (the exclusive rule)', async () => {
    const m = mountWith(ONE)
    const out = await m.say('open my Swing layout, then save the layout as Swing 2')
    expect(m.board.state.layouts.activeId, out).toBe(1)
    expect(m.board.state.layouts.entries.map(x => x.name)).toEqual(['Main', 'Swing'])
  }, 60000)
})
