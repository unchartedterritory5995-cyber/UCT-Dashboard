// S12 remainder (audit M9, point 2): phone chart mode in the chart embed. At phone width (<=640, read from
// window.innerWidth) the chart's header is compact -- the ticker and timeframe, Insights and More -- Draw,
// Plan and Replay move into More, and a tap on the chart opens it full screen in the phone /charts app on
// the same ticker and timeframe. Desktop and tablet render exactly as before.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { forwardRef } from 'react'
import { render, screen, fireEvent, within, act, cleanup } from '@testing-library/react'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), NodeViewWrapper: forwardRef((props, ref) => <div ref={ref} {...props} />) }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: vi.fn(async () => null),
  storeFallbackImage: vi.fn(async () => ({ url: '/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))
const seen = vi.hoisted(() => ({ props: [] }))
vi.mock('./ChartEmbed', () => ({
  default: (props) => { seen.props.push(props); return <div data-testid="chart-embed-stub" /> },
}))
vi.mock('./ChartPlanPanel', () => ({ default: () => <div data-testid="plan-panel-stub" /> }))
vi.mock('../../../../components/chart/SymbolSearch', () => ({
  default: forwardRef(function Stub({ ariaLabel }, ref) { return <button ref={ref} type="button" aria-label={ariaLabel}>sym</button> }),
}))

import WidgetEmbedView from './WidgetEmbedView'
import { buildWidgetEmbedAttrs } from '../../lib/widgetEmbedCore'

const nowSec = Math.floor(Date.now() / 1000)
const chartAttrs = (p = {}, extra = {}) => ({ ...buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: 'D', to: nowSec, ...p }), ...extra })
const editor = () => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'n' } }, on() {}, off() {}, state: { doc: { descendants() {} } } })

let RealIO
const realWidth = window.innerWidth
const setWidth = (w) => { Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w }) }
beforeAll(() => {
  RealIO = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb }
    observe() { this.cb([{ isIntersecting: true }], this) }
    unobserve() {}
    disconnect() {}
  }
})
afterAll(() => { globalThis.IntersectionObserver = RealIO; setWidth(realWidth) })
beforeEach(() => { __resetNotebookFlags(); latchNotebookFlags({ notebook_chart_plan_enabled: true }); seen.props = [] })
afterEach(() => { cleanup(); __resetNotebookFlags(); setWidth(realWidth) })

async function mount(attrs = chartAttrs()) {
  const view = render(<WidgetEmbedView node={{ attrs }} selected editor={editor()} updateAttributes={vi.fn()} />)
  await screen.findByTestId('chart-embed-stub')
  return view.container.querySelector('[data-widget-embed-view="chart"]')
}
const lastProps = () => seen.props[seen.props.length - 1]

describe('S12: phone chart mode (390 px)', () => {
  it('the header is compact: the ticker and timeframe, Insights and More, each a button', async () => {
    setWidth(390)
    const root = await mount()
    const bar = within(root).getByRole('toolbar', { name: 'Chart tools' })
    expect(root.querySelector('[data-phone-chart-title]').textContent).toBe('NVDA · 1D')
    expect(within(bar).getByRole('button', { name: 'Insights' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(bar).getByRole('button', { name: 'More chart actions' })).toBeInTheDocument()
    // Nothing else in the row: no collapse toggle, ticker search, Live/Snapshot, timeframe, Draw, Plan or Replay.
    expect(within(bar).queryByRole('button', { name: /toolbar/ })).toBeNull()
    expect(within(bar).queryByRole('button', { name: /Chart ticker/ })).toBeNull()
    expect(within(bar).queryByRole('group', { name: 'Live or snapshot' })).toBeNull()
    expect(within(bar).queryByRole('combobox', { name: 'Embed timeframe' })).toBeNull()
    for (const name of ['Draw', 'Plan', 'Replay']) expect(within(bar).queryByRole('button', { name })).toBeNull()
  })

  it('Draw, Plan and Replay are one menu away in More', async () => {
    setWidth(390)
    const root = await mount()
    fireEvent.click(within(root).getByRole('button', { name: 'More chart actions' }))
    for (const label of ['Draw', 'Plan', 'Replay']) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  })

  it('the chart starts without its auto-labels; Insights hands them back, view-only', async () => {
    setWidth(390)
    const root = await mount()
    expect(lastProps()).toMatchObject({ phoneMode: true, insights: false })
    fireEvent.click(within(root).getByRole('button', { name: 'Insights' }))
    expect(within(root).getByRole('button', { name: 'Insights' })).toHaveAttribute('aria-pressed', 'true')
    expect(lastProps()).toMatchObject({ phoneMode: true, insights: true })
  })

  it('a tap opens the chart full screen in /charts with the ticker and the timeframe', async () => {
    setWidth(390)
    const root = await mount(chartAttrs({ symbol: 'AMD', tf: '15' }))
    const link = within(root).getByRole('link', { name: 'Open AMD 15m full screen' })
    expect(link).toHaveAttribute('href', '/charts?sym=AMD&tf=15')
    expect(link.textContent).toBe('Tap to open full screen')
    // The width is read again AT the tap: on a phone the link is followed...
    expect(fireEvent.click(link)).toBe(true)
    // ...and on a screen that grew past 640 since, it is not.
    setWidth(1200)
    expect(fireEvent.click(link)).toBe(false)
  })

  it('a daily chart hands off its own timeframe', async () => {
    setWidth(390)
    const root = await mount()
    expect(within(root).getByRole('link', { name: 'Open NVDA 1D full screen' })).toHaveAttribute('href', '/charts?sym=NVDA&tf=D')
  })

  it('leaves phone mode when the screen widens past 640', async () => {
    setWidth(390)
    const root = await mount()
    expect(root.querySelector('[data-phone-chart-open]')).not.toBeNull()
    act(() => { setWidth(1200); window.dispatchEvent(new Event('resize')) })
    expect(root.querySelector('[data-phone-chart-open]')).toBeNull()
    expect(within(root).getByRole('button', { name: 'Plan' })).toBeInTheDocument()
  })
})

describe('S12: desktop and tablet are unchanged', () => {
  for (const width of [1200, 820]) {
    it(`at ${width} px the full header stays and there is no phone mode`, async () => {
      setWidth(width)
      const root = await mount()
      const bar = within(root).getByRole('toolbar', { name: 'Chart tools' })
      expect(root.querySelector('[data-phone-chart-title]')).toBeNull()
      expect(root.querySelector('[data-phone-chart-open]')).toBeNull()
      expect(within(bar).queryByRole('button', { name: 'Insights' })).toBeNull()
      expect(within(bar).getByRole('button', { name: 'Hide toolbar' })).toBeInTheDocument()
      expect(within(bar).getByRole('group', { name: 'Live or snapshot' })).toBeInTheDocument()
      expect(within(bar).getByRole('combobox', { name: 'Embed timeframe' })).toBeInTheDocument()
      for (const name of ['Draw', 'Plan', 'Replay']) expect(within(bar).getByRole('button', { name })).toBeInTheDocument()
      expect(lastProps()).not.toHaveProperty('phoneMode')
      expect(lastProps()).not.toHaveProperty('insights')
    })
  }
})
