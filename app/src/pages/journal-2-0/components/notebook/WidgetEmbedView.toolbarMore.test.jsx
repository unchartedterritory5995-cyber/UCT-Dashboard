// P0.2 -- the chart toolbar leads with Plan and Replay; the rest lives under "More".
//
// The chart embed in a note had 14 controls in one row and the flagship Plan action was lost
// among them. The row now holds the timeframe, Plan, Replay and Draw/Done; every other action
// is one menu away, with its guard, its name and its effect unchanged.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), NodeViewWrapper: (props) => <div {...props} /> }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: vi.fn(async () => null),
  storeFallbackImage: vi.fn(async () => ({ url: '/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))
vi.mock('./ChartEmbed', () => ({ default: () => <div data-testid="chart-embed-stub" /> }))
vi.mock('./ChartPlanPanel', () => ({ default: () => <div data-testid="plan-panel-stub" /> }))

import WidgetEmbedView from './WidgetEmbedView'
import { buildWidgetEmbedAttrs } from '../../lib/widgetEmbedCore'

const nowSec = Math.floor(Date.now() / 1000)
const chartAttrs = () => buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: 'D', to: nowSec })
const editor = () => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'note-9' } }, on() {}, off() {} })

let RealIO
beforeAll(() => {
  RealIO = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb }
    observe() { this.cb([{ isIntersecting: true }], this) }
    unobserve() {}
    disconnect() {}
  }
})
afterAll(() => { globalThis.IntersectionObserver = RealIO })
beforeEach(() => { __resetNotebookFlags() })
afterEach(() => __resetNotebookFlags())

async function renderChartEmbed({ planOn = true, deleteNode } = {}) {
  latchNotebookFlags({ notebook_chart_plan_enabled: planOn })
  const updateAttributes = vi.fn()
  render(
    <WidgetEmbedView
      node={{ attrs: chartAttrs() }} selected={false} editor={editor()}
      updateAttributes={updateAttributes} deleteNode={deleteNode}
    />,
  )
  await screen.findByTestId('chart-embed-stub')
  return { updateAttributes }
}

const MOVED = ['Aftermath', 'Re-capture', 'Sync', 'Freeze', 'Chart settings', 'Remove embed']

describe('the chart toolbar folds the rarely-used actions under More', () => {
  it('the row holds Plan and Replay with words, and folds the rest into More', async () => {
    await renderChartEmbed()
    const bar = screen.getByRole('toolbar', { name: 'Chart tools' })
    const names = within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent.trim())
    expect(names).toEqual(expect.arrayContaining(['Plan', 'Replay', 'More chart actions']))
    for (const moved of MOVED) expect(names).not.toContain(moved)
    // The row's other controls are not in the row either: no Live/Half/Charts link.
    expect(within(bar).queryByText('Live')).toBeNull()
    expect(within(bar).queryByText('Half')).toBeNull()
    expect(within(bar).queryByRole('link')).toBeNull()
    fireEvent.click(within(bar).getByRole('button', { name: 'More chart actions' }))
    for (const moved of MOVED) expect(await screen.findByRole('menuitem', { name: moved })).toBeTruthy()
  })

  it('More says it opens a menu, carries the tour anchor, and the row keeps Draw and the timeframe', async () => {
    await renderChartEmbed()
    const more = screen.getByRole('button', { name: 'More chart actions' })
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.getAttribute('data-tour')).toBe('chart-embed-more')
    expect(more.textContent).toContain('More')
    expect(screen.getByRole('button', { name: 'Draw' })).toBeTruthy()
    expect(screen.getByLabelText('Embed timeframe')).toBeTruthy()
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
  })

  it('the menu also holds the width toggle, the live toggle and the Charts link', async () => {
    await renderChartEmbed()
    fireEvent.click(screen.getByRole('button', { name: 'More chart actions' }))
    // chart is liveCapable and starts as a snapshot, at full width
    expect(await screen.findByRole('menuitem', { name: 'Live' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Half width' })).toBeTruthy()
    const link = screen.getByRole('menuitem', { name: 'Open in Charts' })
    expect(link.getAttribute('href')).toContain('NVDA')
  })

  it('a moved action still runs from More (Freeze)', async () => {
    const { updateAttributes } = await renderChartEmbed()
    fireEvent.click(screen.getByRole('button', { name: 'More chart actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Freeze' }))
    expect(updateAttributes).toHaveBeenCalledWith({ frozen: true })
    // and picking an item closes the menu
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Remove embed runs the block\'s own delete from More', async () => {
    const deleteNode = vi.fn()
    await renderChartEmbed({ deleteNode })
    fireEvent.click(screen.getByRole('button', { name: 'More chart actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove embed' }))
    expect(deleteNode).toHaveBeenCalledTimes(1)
  })

  it('Plan and Replay stay in the row (and the menu does not duplicate them)', async () => {
    await renderChartEmbed()
    fireEvent.click(screen.getByRole('button', { name: 'More chart actions' }))
    await screen.findByRole('menu')
    expect(screen.queryByRole('menuitem', { name: 'Plan' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Replay' })).toBeNull()
  })

  it('every moved control keeps its guard: Aftermath needs an anchored snapshot', async () => {
    // `to: null` is the explicit rolling-window opt-out: a chart with no frozen window has
    // nothing to peek past. (Omitting `to` would not do: the builder stamps today's date.)
    latchNotebookFlags({ notebook_chart_plan_enabled: true })
    const attrs = buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: 'D', to: null })
    render(<WidgetEmbedView node={{ attrs }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    await screen.findByTestId('chart-embed-stub')
    fireEvent.click(screen.getByRole('button', { name: 'More chart actions' }))
    await screen.findByRole('menu')
    expect(screen.queryByRole('menuitem', { name: 'Aftermath' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Freeze' })).toBeTruthy()
  })
})
