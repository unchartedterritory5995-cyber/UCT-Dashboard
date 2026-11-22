// S12 remainder (audit M9, point 2): phone chart mode in the chart embed. At phone width (<=640, read from
// window.innerWidth) the chart's header is compact -- the ticker and timeframe, Insights and More -- Draw,
// Plan and Replay move into More, and a tap on the chart opens it full screen in the phone /charts app on
// the same ticker and timeframe. Desktop and tablet render exactly as before.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { forwardRef, useEffect } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, within, act, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), NodeViewWrapper: forwardRef((props, ref) => <div ref={ref} {...props} />) }))
const shot = vi.hoisted(() => ({ els: [] }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  // The element the self-archive hands the rasteriser, as it stood at that moment.
  captureElementPng: vi.fn(async (el) => { shot.els.push({ open: !!el?.querySelector('[data-phone-chart-open]') }); return null }),
  storeFallbackImage: vi.fn(async () => ({ url: '/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))
const seen = vi.hoisted(() => ({ props: [] }))
vi.mock('./ChartEmbed', () => ({
  default: function Stub(props) {
    seen.props.push(props)
    // The live chart says its bars are painted (the self-archive waits for that).
    useEffect(() => { props.onBarsReady?.() }, []) // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="chart-embed-stub" />
  },
}))
vi.mock('./ChartPlanPanel', () => ({ default: () => <div data-testid="plan-panel-stub" /> }))
vi.mock('../../../../components/chart/SymbolSearch', () => ({
  default: forwardRef(function Stub({ ariaLabel }, ref) { return <button ref={ref} type="button" aria-label={ariaLabel}>sym</button> }),
}))

import WidgetEmbedView from './WidgetEmbedView'
import { buildWidgetEmbedAttrs } from '../../lib/widgetEmbedCore'

const nowSec = Math.floor(Date.now() / 1000)
// An ARCHIVED chart (its PNG is stored), so phone mode applies at once; `pending()` is one still to be archived.
const ARCHIVED = { fallback: { url: '/x.png', w: 600, h: 300 } }
const chartAttrs = (p = {}, extra = {}) => ({ ...buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: 'D', to: nowSec, ...p }), ...ARCHIVED, ...extra })
const pending = () => buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: 'D', to: nowSec })
const editor = (over = {}) => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'n', ...over } }, on() {}, off() {}, state: { doc: { descendants() {} } } })

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
beforeEach(() => { __resetNotebookFlags(); latchNotebookFlags({ notebook_chart_plan_enabled: true }); seen.props = []; shot.els = [] })
afterEach(() => { cleanup(); __resetNotebookFlags(); setWidth(realWidth); vi.useRealTimers() })

async function mount(attrs = chartAttrs(), ed = editor(), wrap = (x) => x) {
  const view = render(wrap(<WidgetEmbedView node={{ attrs }} selected editor={ed} updateAttributes={vi.fn()} />))
  await screen.findByTestId('chart-embed-stub')
  return view.container.querySelector('[data-widget-embed-view]')
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
    // Final polish: the link is the transparent plot (it covers no data with words); the words are a caption under it.
    expect(link.textContent).toBe('')
    expect(root.querySelector('[data-phone-chart-caption]').textContent).toBe('Tap the chart to open it full screen')
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

// ⛔ Fix round 1 (review 1, CRITICAL): the archive PNG is the note's permanent evidence. It is taken from the full
// render at any width, and the tap layer never reaches it.
describe('fix round 1: an archive taken at 390 px is the full chart, with no phone-only element', () => {
  it('while the archive is due the chart renders as on a desktop, and the raster holds no tap layer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setWidth(390)
    const view = render(<WidgetEmbedView node={{ attrs: pending() }} selected editor={editor()} updateAttributes={vi.fn()} />)
    await screen.findByTestId('chart-embed-stub')
    expect(lastProps()).not.toHaveProperty('phoneMode')
    expect(view.container.querySelector('[data-phone-chart-open]')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(4000) })
    await act(async () => { await Promise.resolve() })
    expect(shot.els).toHaveLength(1)
    expect(shot.els[0].open).toBe(false)
    expect(seen.props.every((p) => !('phoneMode' in p))).toBe(true)
  })

  it('once the image is stored, phone mode applies, and its tap layer is marked for the archive filter', async () => {
    setWidth(390)
    const root = await mount(chartAttrs())
    expect(lastProps()).toMatchObject({ phoneMode: true })
    expect(root.querySelector('[data-phone-chart-open]')).toHaveAttribute('data-archive-exclude')
  })
})

describe('fix round 1: share view, read-only, frozen and other widgets', () => {
  it('a public share page never enters phone mode', () => {
    setWidth(390)
    const view = render(<WidgetEmbedView node={{ attrs: chartAttrs() }} selected={false}
      editor={{ ...editor({ shareView: true }), isEditable: false }} updateAttributes={vi.fn()} />)
    expect(view.container.querySelector('[data-phone-chart-open], [data-phone-chart-title], [data-phone-chart-bar]')).toBeNull()
    expect(seen.props.every((p) => !('phoneMode' in p))).toBe(true)
  })

  it('a read-only note keeps a view-only Insights toggle (it has no toolbar)', async () => {
    setWidth(390)
    const root = await mount(chartAttrs(), { ...editor(), isEditable: false })
    expect(within(root).queryByRole('toolbar')).toBeNull()
    const bar = root.querySelector('[data-phone-chart-bar]')
    expect(bar.textContent).toContain('NVDA · 1D')
    expect(lastProps()).toMatchObject({ phoneMode: true, insights: false })
    fireEvent.click(within(bar).getByRole('button', { name: 'Insights' }))
    expect(lastProps()).toMatchObject({ phoneMode: true, insights: true })
  })

  it('a frozen chart keeps it too', async () => {
    setWidth(390)
    const root = await mount(chartAttrs({}, { frozen: true }))
    const bar = root.querySelector('[data-phone-chart-bar]')
    expect(bar).not.toBeNull()
    fireEvent.click(within(bar).getByRole('button', { name: 'Insights' }))
    expect(lastProps()).toMatchObject({ insights: true })
  })

  it('an editable chart has no second bar (Insights lives in its header)', async () => {
    setWidth(390)
    const root = await mount()
    expect(root.querySelector('[data-phone-chart-bar]')).toBeNull()
  })

  it('a widget that is not a chart is untouched at 390 px', () => {
    setWidth(390)
    const attrs = { ...buildWidgetEmbedAttrs('cot', { market: 'ES', reportDate: '2026-11-03', groups: {} }), ...ARCHIVED }
    const view = render(<WidgetEmbedView node={{ attrs }} selected editor={editor()} updateAttributes={vi.fn()} />)
    expect(view.container.querySelector('[data-phone-chart-open], [data-phone-chart-title], [data-phone-chart-bar]')).toBeNull()
  })
})

// Fix round 1 (review 4): inside the app's router the hop to /charts is client-side, so no document unload races a
// pending autosave; and a long press shows no link callout.
describe('fix round 1: the full-screen hop', () => {
  function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p> }

  it('a tap navigates to /charts with the ticker and timeframe, through the router', async () => {
    setWidth(390)
    const wrap = (el) => (
      <MemoryRouter initialEntries={['/journal/notebook/n']}>
        <Routes>
          <Route path="/journal/notebook/n" element={el} />
          <Route path="/charts" element={<Where />} />
        </Routes>
      </MemoryRouter>
    )
    const root = await mount(chartAttrs({ symbol: 'AMD', tf: '15' }), editor(), wrap)
    expect(fireEvent.click(within(root).getByRole('link', { name: 'Open AMD 15m full screen' }))).toBe(false)
    expect((await screen.findByTestId('where')).textContent).toBe('/charts?sym=AMD&tf=15')
  })

  it('the link suppresses the long-press callout', () => {
    const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/WidgetEmbedView.module.css'), 'utf8')
    expect(/\.phoneOpen\s*\{([^}]*)\}/.exec(css)[1]).toMatch(/-webkit-touch-callout:\s*none/)
  })
})
// Final polish (WebKit at 390 px, production): the compact header was laid OVER the price area, the tap pill over the
// volume pane, and the keyboard hint pushed below. The header is a row above the plot; the words are under it.
describe('final polish: the phone chart chrome never covers the plot', () => {
  const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/WidgetEmbedView.module.css'), 'utf8')

  it('the frame says it is a phone chart, and the stylesheet puts its toolbar in flow (static), always shown', async () => {
    setWidth(390)
    const root = await mount()
    expect(root).toHaveAttribute('data-phone-chart', 'true')
    const rule = /\.frame\[data-phone-chart\] \.toolbar\s*\{([^}]*)\}/.exec(css)
    expect(rule, 'the phone-chart toolbar rule').toBeTruthy()
    expect(rule[1]).toMatch(/position:\s*static/)
    expect(rule[1]).toMatch(/opacity:\s*1/)
  })

  it('the caption sits after the plot body, not inside it, and the keyboard hint is not drawn', async () => {
    setWidth(390)
    const root = await mount()
    const body = root.querySelector('[data-widget-embed-body]')
    const caption = root.querySelector('[data-phone-chart-caption]')
    expect(body.contains(caption)).toBe(false)
    expect(body.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(root.querySelector('[data-chart-hint]')).toBeNull()
  })

  it('CONTROL: on a desktop the frame is not a phone chart and the hint region is there', async () => {
    setWidth(1200)
    const root = await mount()
    expect(root).not.toHaveAttribute('data-phone-chart')
    expect(root.querySelector('[data-phone-chart-caption]')).toBeNull()
    expect(root.querySelector('[data-chart-hint]')).not.toBeNull()
  })
})