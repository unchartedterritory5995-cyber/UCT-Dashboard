// Charts family: WIDGET TAB REORDER (widget.moveTab) — a widget tab's place in its strip, as right-click a tab → Move left /
// Move right does (WidgetHeader onMoveTab → WidgetHost.handleMoveTab → widgetTabs.moveWidgetTab; a far place = the same one-step
// writer, step by step). Non-destructive; exact Undo (the order goes back).
// GENERATED: widget shapes (3 / 4 / 2 tabs) × every tab × positions (first, last, left, right, 1…n) × phrasings, each checked
// against an independent reference order; a place that doesn't exist is refused; a tab already there is said, with no Undo.
// WHICH WIDGET: a tab name two widgets hold is asked with the real choices unless the words name one; the plan's wrong widget
// is re-aimed only by the member's own words; a widget without that tab is refused.
// Through the REAL panel (panelHarness), the model SCRIPTED. Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { widgetTabList, orderedWidgetTabList } from '../pages/charts/widgetTabs'
import { labelMap } from '../widgets/registry'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const AGENT_LABEL = labelMap('agent')
const tab = (id, type, opts = {}) => ({ id, type, color: 'A', opts })
// the widget shapes: a Watchlist with 3 tabs, a News widget with 4, a Calendar with 2 — two of them hold a "Calendar" tab
const SHAPES = {
  wl: { id: 'wl', type: 'watchlist', x: 12, y: 0, w: 12, h: 10, color: 'A', opts: { watchName: 'Momentum' }, wtabs: [tab('t1', 'calendar'), tab('t2', 'breadth')], activeWtab: 0 },
  nw: { id: 'nw', type: 'news', x: 0, y: 10, w: 12, h: 10, color: 'A', opts: {}, wtabs: [tab('t3', 'calendar'), tab('t4', 'scanner'), tab('t5', 'breadth')], activeWtab: 0 },
  cal: { id: 'cal', type: 'calendar', x: 12, y: 10, w: 12, h: 10, color: 'A', opts: {}, wtabs: [tab('t6', 'optionsflow')], activeWtab: 0 },
}
const chartW = { id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } }
const board = (over = {}) => [chartW, ...Object.values(SHAPES).map(w => ({ ...w, ...(over[w.id] || {}) }))]
const mount = (over) => p.mount(board(over), { 'N:c': 'NVDA' })

const labelsOf = (w) => orderedWidgetTabList(w).map(t => t.label)
const wOf = (b, id) => b.state.widgets.find(w => w.id === id)
const norm = (ws) => JSON.parse(JSON.stringify(ws, (k, v) => (v === null ? undefined : v)))
const env = (ops) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops })
const plan = (args) => (body) => env([{ action: 'widget.moveTab', target: body.context.board[0].ref, args }])
const transcript = () => screen.getByTestId('agent-transcript').textContent
const undoButton = () => screen.queryByRole('button', { name: 'Undo' })

// the reference: where a move lands, independent of the capability (a remove-and-insert at the destination)
function expected(labels, from, to) {
  const n = labels.length
  const dest = to === 'first' ? 0 : to === 'last' ? n - 1 : to === 'left' ? from - 1 : to === 'right' ? from + 1 : Number(to) - 1
  if (typeof to === 'number' && (to < 1 || to > n)) return { refused: true }
  if (dest < 0 || dest >= n || dest === from) return { noop: true }
  const out = labels.slice(); const [x] = out.splice(from, 1); out.splice(dest, 0, x)
  return { order: out }
}
const SAY = {
  first: [(t, w) => `make ${t} the first tab in the ${w}`, (t, w) => `move the ${t} tab of the ${w} to the front`],
  last: [(t, w) => `move the ${t} tab in the ${w} to the end`, (t, w) => `make ${t} the last tab of the ${w}`],
  left: [(t, w) => `move the ${t} tab in the ${w} left`, (t, w) => `shift the ${w}'s ${t} tab one to the left`],
  right: [(t, w) => `move the ${t} tab in the ${w} right`, (t, w) => `shift the ${w}'s ${t} tab one to the right`],
  n: [(t, w, n) => `put the ${t} tab of the ${w} in position ${n}`],
}
const CASES = Object.values(SHAPES).flatMap(w => {
  const labels = labelsOf(w)
  const wl = AGENT_LABEL[w.type] || w.type
  return labels.flatMap((t, from) => [
    ...['first', 'last', 'left', 'right'].flatMap(pos => SAY[pos].map((say, si) => [say(t, wl), w.id, t, pos, expected(labels, from, pos), si])),
    ...Array.from({ length: labels.length + 1 }, (_, i) => i + 1).map(n => [SAY.n[0](t, wl, n), w.id, t, n, expected(labels, from, n), 0]),
  ])
})

describe('the capability: the product\'s own writer, a typed place, exact Undo', () => {
  it('registered on the board kind with widget / tab / to', () => {
    const c = getCapability('widget.moveTab')
    expect(c.target).toBe('board')
    expect(c.args.required).toEqual(['widget', 'tab', 'to'])
  })
  it('three widgets hold a "Calendar" tab — two as an extra tab, the Calendar widget as its own (the ambiguity fixture is real)', () => {
    expect(Object.values(SHAPES).filter(w => widgetTabList(w).some(t => t.label === widgetTabList(SHAPES.wl)[1].label)).length).toBe(3)
  })
})

describe('GENERATED: shapes × tabs × positions × phrasings', () => {
  it('generated: the case count', () => expect(CASES.length).toBe(9 * 8 + 3 * 4 + 4 * 5 + 2 * 3))   // (3+4+2 tabs) × 8 named-place phrasings + every N
  it.each(CASES)('"%s"', async (text, id, t, to, want) => {
    const { say, board: b } = mount()
    const before = norm(b.state.widgets)
    p.st.envelopes.push(plan({ widget: id, tab: t, to }))
    const out = await say(text)
    if (want.refused) {
      expect(out).toMatch(/there is no position/)
      expect(norm(b.state.widgets)).toEqual(before)
      return
    }
    if (want.noop) {
      expect(out).toMatch(/is already/)
      expect(norm(b.state.widgets)).toEqual(before)
      expect(undoButton()).toBeNull()
      return
    }
    expect(labelsOf(wOf(b, id))).toEqual(want.order)
    expect(out).toMatch(/Moved the .* tab to/)
    // nothing else on the board changed
    for (const w of b.state.widgets.filter(x => x.id !== id)) expect(norm(w)).toEqual(before.find(x => x.id === w.id))
    await say('undo')
    expect(norm(b.state.widgets)).toEqual(before)
  }, 40000)
})

describe('WHICH WIDGET and wrong-widget controls', () => {
  const CAL = () => widgetTabList(SHAPES.wl)[1].label
  it('a tab name two widgets hold, the words name neither → asked with the real choices; nothing written', async () => {
    const { say, board: b } = mount()
    const before = norm(b.state.widgets)
    p.st.envelopes.push(plan({ widget: 'wl', tab: CAL(), to: 'first' }))
    expect(await say(`make ${CAL().toLowerCase()} the first tab`)).toMatch(/Which widget’s .* tab — /)
    expect(transcript()).toMatch(/Watchlist/)
    expect(transcript()).toMatch(/News/)
    expect(norm(b.state.widgets)).toEqual(before)
  }, 40000)
  it.each([['wl', 'nw'], ['nw', 'wl']])('the plan writes %s, the words name the other widget (%s) → re-aimed there', async (planned, named) => {
    const wl = AGENT_LABEL[SHAPES[named].type]
    const { say, board: b } = mount()
    const was = norm(wOf(b, planned))
    p.st.envelopes.push(plan({ widget: planned, tab: CAL(), to: 'last' }))
    await say(`move the ${CAL()} tab of the ${wl} to the end`)
    expect(labelsOf(wOf(b, named)).at(-1)).toBe(CAL())
    expect(norm(wOf(b, planned))).toEqual(was)
  }, 40000)
  it('the plan names a widget without that tab, and one widget holds it → re-aimed by the words (the tab named)', async () => {
    const { say, board: b } = mount()
    const opt = widgetTabList(SHAPES.cal)[1].label
    p.st.envelopes.push(plan({ widget: 'nw', tab: opt, to: 'first' }))
    await say(`make the ${opt.toLowerCase()} tab first`)
    expect(labelsOf(wOf(b, 'cal'))[0]).toBe(opt)
  }, 40000)
  it('a widget with no tabs → refused, nothing written', async () => {
    const { say, board: b } = mount()
    const before = norm(b.state.widgets)
    p.st.envelopes.push(plan({ widget: 'c', tab: '1', to: 'first' }))
    expect(await say('move the first tab of the chart to the end')).toMatch(/has no tabs/)
    expect(norm(b.state.widgets)).toEqual(before)
  }, 40000)
  it('a tab the widget doesn\'t have → refused, nothing written', async () => {
    const { say, board: b } = mount()
    const before = norm(b.state.widgets)
    p.st.envelopes.push(plan({ widget: 'cal', tab: 'Screener', to: 'first' }))
    expect(await say('make the screener tab of the calendar first')).toMatch(/has no tab “Screener”/)
    expect(norm(b.state.widgets)).toEqual(before)
  }, 40000)
  it.each(['middle', 'up', '0'])('a place that is no place (%s) → refused, nothing written', async (to) => {
    const { say, board: b } = mount()
    const before = norm(b.state.widgets)
    p.st.envelopes.push(plan({ widget: 'cal', tab: 'main', to }))
    expect(await say(`move the calendar's main tab ${to}`)).toMatch(/isn’t a place in the tab strip|there is no position/)
    expect(norm(b.state.widgets)).toEqual(before)
  }, 40000)
  it('two moves, then one Undo each: the order goes back step by step', async () => {
    const { say, board: b } = mount()
    const s0 = labelsOf(wOf(b, 'nw'))
    p.st.envelopes.push(plan({ widget: 'nw', tab: s0[3], to: 'first' }))
    await say(`make ${s0[3]} the first tab in the ${AGENT_LABEL.news}`)
    const s1 = labelsOf(wOf(b, 'nw'))
    p.st.envelopes.push(plan({ widget: 'nw', tab: s0[0], to: 'last' }))
    await say(`move the ${s0[0]} tab in the ${AGENT_LABEL.news} to the end`)
    await say('undo')
    expect(labelsOf(wOf(b, 'nw'))).toEqual(s1)
    await say('undo')
    expect(labelsOf(wOf(b, 'nw'))).toEqual(s0)
  }, 40000)
})
