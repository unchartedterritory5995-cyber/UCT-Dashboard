// CHARTS OUTCOME 5 — chart tabs: the widget's persisted opts through the ChartTabStrip's own reducers (pages/charts/chartTabs.js),
// read back with chartTabList / sanitizeChartTabs — the same reads the strip renders from.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, widgetAt, widgetOf, selectedChart, boardRef, must, waitFor } from './outcomeHarness'
import { chartTabList, sanitizeChartTabs } from '../../../pages/charts/chartTabs'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)

const quad = (o = {}) => open(QUAD(), QUAD_SYMS, o)
const widget = (m, id) => m.board.state.widgets.find(w => w.id === id)
const labels = (m, id) => chartTabList(widget(m, id).opts).map(t => t.label)
const active = (m, id) => { const o = widget(m, id).opts; return chartTabList(o)[sanitizeChartTabs(o).active].label }
const entry = (c, ref) => must(c.board[0].widgets.find(w => w.id === ref), `board widget ${ref}`)
const tabOf = (c, ref, label) => must((entry(c, ref).chartTabs || []).find(t => t.label === label), `tab ${label}`).tab
const ADD = (c, ref, name = null, timeframe = null) => ({ action: 'chart.addTab', target: boardRef(c), args: { widget: ref, timeframe, name } })
const op = (c, action, args) => ({ action, target: boardRef(c), args })

describe('add', () => {
  it('"add a tab to this chart": the clicked chart gets it, and shows it; the others are untouched; Undo removes it', async () => {
    const m = quad({ selected: 'tr' })
    const others = JSON.stringify(m.board.state.widgets.filter(w => w.id !== 'tr'))
    await m.say('add a weekly tab to this chart', (c) => [ADD(c, widgetOf(c, selectedChart(c)), null, 'W')])
    await waitFor(() => expect(sanitizeChartTabs(widget(m, 'tr').opts).tabs).toHaveLength(1))
    expect(sanitizeChartTabs(widget(m, 'tr').opts).tabs[0]).toMatchObject({ tf: 'W' })
    expect(sanitizeChartTabs(widget(m, 'tr').opts).active).toBe(1)
    expect(JSON.stringify(m.board.state.widgets.filter(w => w.id !== 'tr'))).toBe(others)
    expect(m.lastReceipt().textContent).toMatch(/top-right/)
    await m.say('undo')
    await waitFor(() => expect(sanitizeChartTabs(widget(m, 'tr').opts).tabs).toHaveLength(0))
    expect(widget(m, 'tr').opts.chartTabs).toBe(undefined)
  })
  it('"add a tab called Swing to the top-left chart": named, on that chart', async () => {
    const m = quad()
    await m.say('add a tab called Swing to the top-left chart', (c) => [ADD(c, widgetAt(c, 'top-left'), 'Swing')])
    await waitFor(() => expect(labels(m, 'tl')).toEqual(['1D', 'Swing']))
    expect(m.lastReceipt().textContent).toMatch(/“Swing”/)
  })
})

describe('rename, select, close: one conversation on one chart', () => {
  it('add two, rename by position, select by name, select main, close by name, each read back from the widget', async () => {
    const m = quad()
    await m.say('add a tab called Swing to the top-left chart', (c) => [ADD(c, 'tl', 'Swing')])
    await waitFor(() => expect(labels(m, 'tl')).toEqual(['1D', 'Swing']))
    await m.say('and a weekly tab', (c) => [ADD(c, 'tl', null, 'W')])
    await waitFor(() => expect(labels(m, 'tl')).toHaveLength(3))
    expect(active(m, 'tl')).toBe(labels(m, 'tl')[2])

    await m.say('rename the second tab to Position', (c) => [op(c, 'chart.renameTab', { widget: 'tl', tab: '2', name: 'Position' })])
    await waitFor(() => expect(labels(m, 'tl')).toEqual(['1D', 'Swing', 'Position']))
    expect(m.lastReceipt().textContent).toMatch(/“Position”/)

    await m.say('switch to the Swing tab', (c) => [op(c, 'chart.selectTab', { widget: 'tl', tab: tabOf(c, 'tl', 'Swing') })])
    await waitFor(() => expect(active(m, 'tl')).toBe('Swing'))
    expect(m.lastReceipt().textContent).toMatch(/“Swing”/)

    await m.say('go back to the main tab', (c) => [op(c, 'chart.selectTab', { widget: 'tl', tab: 'main' })])
    await waitFor(() => expect(active(m, 'tl')).toBe('1D'))

    const swing = sanitizeChartTabs(widget(m, 'tl').opts).tabs.find(t => t.name === 'Swing')
    await m.say('close the Swing tab', (c) => [op(c, 'chart.closeTab', { widget: 'tl', tab: tabOf(c, 'tl', 'Swing') })])
    await waitFor(() => expect(labels(m, 'tl')).toEqual(['1D', 'Position']))
    expect(m.lastReceipt().textContent).toMatch(/Closed the “Swing” tab/)
    expect(m.lastReceipt().getAttribute('data-undoable')).toBe('true')
    await m.say('undo')
    await waitFor(() => expect(labels(m, 'tl')).toEqual(['1D', 'Swing', 'Position']))
    expect(sanitizeChartTabs(widget(m, 'tl').opts).tabs.find(t => t.name === 'Swing')).toEqual(swing)
  })
  it('the switch receipt names the tab the widget ended on, not the words of the request', async () => {
    const m = quad()
    await m.say('add a tab called Swing to the top-left chart', (c) => [ADD(c, 'tl', 'Swing')])
    await waitFor(() => expect(labels(m, 'tl')).toEqual(['1D', 'Swing']))
    await m.say('go back to the main tab', (c) => [op(c, 'chart.selectTab', { widget: 'tl', tab: 'main' })])
    await waitFor(() => expect(active(m, 'tl')).toBe('1D'))
    expect(m.lastReceipt().textContent).toMatch(/“1D”/)
    expect(m.lastReceipt().textContent).not.toMatch(/“main”/)
  })
  it('the main tab renames (it has its own name), and the receipt is about the tab that changed', async () => {
    const m = quad()
    await m.say('add a tab to the top-left chart', (c) => [ADD(c, 'tl')])
    await waitFor(() => expect(labels(m, 'tl')).toHaveLength(2))
    await m.say('rename the main tab to Core', (c) => [op(c, 'chart.renameTab', { widget: 'tl', tab: 'main', name: 'Core' })])
    await waitFor(() => expect(labels(m, 'tl')[0]).toBe('Core'))
    expect(m.lastReceipt().textContent).toMatch(/“Core”/)
  })
  it('the natural follow-up: "close it" right after adding one closes THAT tab', async () => {
    const m = quad()
    await m.say('add a tab called Swing to the bottom-left chart', (c) => [ADD(c, widgetAt(c, 'bottom-left'), 'Swing')])
    await waitFor(() => expect(labels(m, 'bl')).toEqual(['1D', 'Swing']))
    await m.say('close it', (c) => {
      const t = must((c.board[0].widgets.find(w => w.chartTabs)?.chartTabs || []).find(x => x.active), 'the active tab')
      return [op(c, 'chart.closeTab', { widget: c.board[0].widgets.find(w => w.chartTabs).id, tab: t.tab })]
    })
    await waitFor(() => expect(labels(m, 'bl')).toEqual(['1D']))
    expect(active(m, 'bl')).toBe('1D')
  })
  it('two tabs with one automatic label are told apart by position; the label alone is refused, not guessed', async () => {
    const m = quad()
    await m.say('add a tab to the top-left chart', (c) => [ADD(c, 'tl')])                     // Daily beside the main Daily
    await waitFor(() => expect(labels(m, 'tl')).toEqual(['1D', '1D']))
    const out = await m.say('close the 1D tab', (c) => [op(c, 'chart.closeTab', { widget: 'tl', tab: '1D' })])
    expect(out).toMatch(/no tab “1D”/)
    expect(labels(m, 'tl')).toHaveLength(2)
    await m.say('close tab 1', (c) => [op(c, 'chart.closeTab', { widget: 'tl', tab: '1' })])
    await waitFor(() => expect(labels(m, 'tl')).toEqual(['1D']))
  })
  it('FIXED (#835 continuesTabs): "and a weekly one" right after adding a tab adds the weekly tab on the same chart', async () => {
    // The defect this pinned (TAB_ADDS ignored the conversation) was fixed by #835: the very next short message
    // continuing the same tab action on the same widget is allowed. The marker flipped loudly, as designed.
    const m = quad()
    await m.say('add a tab called Swing to the top-left chart', (c) => [ADD(c, 'tl', 'Swing')])
    await waitFor(() => expect(labels(m, 'tl')).toEqual(['1D', 'Swing']))
    const out = await m.say('and a weekly one', (c) => [ADD(c, 'tl', null, 'W')])
    expect(out).not.toMatch(/didn.t change anything/)
    await waitFor(() => expect(labels(m, 'tl')).toHaveLength(3))
    expect(labels(m, 'tl').slice(0, 2)).toEqual(['1D', 'Swing'])
    expect(m.board.state.widgets).toHaveLength(4)
  })
  it('the main tab cannot be closed, and nothing changes', async () => {
    const m = quad()
    await m.say('add a tab to the top-left chart', (c) => [ADD(c, 'tl')])
    await waitFor(() => expect(labels(m, 'tl')).toHaveLength(2))
    const out = await m.say('close the main tab', (c) => [op(c, 'chart.closeTab', { widget: 'tl', tab: 'main' })])
    expect(out).toMatch(/can't be closed/)
    expect(labels(m, 'tl')).toHaveLength(2)
    expect(m.board.state.widgets).toHaveLength(4)
  })
})
