// Audit 2026-11-05, spec S3: a chart widget that is safe and adjustable. The chart's header carries
// a ticker button (the Charts page's SymbolSearch) and a Live / Snapshot segment; a key typed over
// the selected chart opens the ticker search with that key instead of replacing the chart (the
// editor half is railed in lib/widgetEmbedTypeToSearch.test.jsx).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { forwardRef, useImperativeHandle } from 'react'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), NodeViewWrapper: forwardRef((props, ref) => <div ref={ref} {...props} />) }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: vi.fn(async () => null),
  storeFallbackImage: vi.fn(async () => ({ url: '/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))
vi.mock('./ChartEmbed', () => ({ default: () => <div data-testid="chart-embed-stub" /> }))
vi.mock('./ChartPlanPanel', () => ({ default: () => <div data-testid="plan-panel-stub" /> }))
// The Charts page's SymbolSearch, as a stub that shows what `openWith` was asked and can pick.
const opened = vi.hoisted(() => ({ with: [] }))
vi.mock('../../../../components/chart/SymbolSearch', () => ({
  default: forwardRef(function Stub({ sym, onSymbolChange, ariaLabel }, ref) {
    useImperativeHandle(ref, () => ({ openWith: (t) => opened.with.push(t) }))
    return <button type="button" aria-label={ariaLabel} onClick={() => onSymbolChange('AMD')}>{sym}</button>
  }),
}))

import WidgetEmbedView from './WidgetEmbedView'
import { buildWidgetEmbedAttrs } from '../../lib/widgetEmbedCore'
import { CHART_EMBED_TYPE_EVENT } from '../../lib/widgetEmbedNode'

const nowSec = Math.floor(Date.now() / 1000)
const chartAttrs = (extra = {}) => ({ ...buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: 'D', to: nowSec }), ...extra })
const editor = () => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'n' } }, on() {}, off() {}, state: { doc: { descendants() {} } } })

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
beforeEach(() => { __resetNotebookFlags(); latchNotebookFlags({ notebook_chart_plan_enabled: true }); opened.with = [] })
afterEach(() => __resetNotebookFlags())

async function mount(attrs = chartAttrs()) {
  const updateAttributes = vi.fn()
  const view = render(<WidgetEmbedView node={{ attrs }} selected editor={editor()} updateAttributes={updateAttributes} />)
  await screen.findByTestId('chart-embed-stub')
  return { updateAttributes, root: view.container.querySelector('[data-widget-embed-view="chart"]') }
}

describe('S3: the chart header', () => {
  it('has a ticker button that changes the ticker through the chart params, clearing the old archive', async () => {
    const { updateAttributes } = await mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Chart ticker, NVDA. Change it' }))
    expect(updateAttributes).toHaveBeenCalledTimes(1)
    const patch = updateAttributes.mock.calls[0][0]
    expect(patch.params.symbol).toBe('AMD')
    expect(patch.params.tf).toBe('D')
    expect(patch.fallback).toBeNull()
  })

  it('a chart with drawings is never moved to another ticker, and says why', async () => {
    const { updateAttributes } = await mount(chartAttrs({ annotations: [{ id: 'l1', role: 'stop', price: 196 }] }))
    fireEvent.click(await screen.findByRole('button', { name: /Chart ticker/ }))
    expect(updateAttributes).not.toHaveBeenCalled()
    expect(screen.getByText('This chart has drawings on NVDA. Insert a new chart for AMD.')).toBeInTheDocument()
  })

  it('Live / Snapshot sits in the header and uses the same setter as before', async () => {
    const { updateAttributes } = await mount()
    const group = screen.getByRole('group', { name: 'Live or snapshot' })
    expect(within(group).getByRole('button', { name: 'Snapshot' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(group).getByRole('button', { name: 'Live' }))
    expect(updateAttributes).toHaveBeenCalledWith({ mode: 'live' })
  })

  it('a key typed over the selected chart opens the ticker search with that key', async () => {
    const { root } = await mount()
    await screen.findByRole('button', { name: /Chart ticker/ })
    act(() => { root.dispatchEvent(new CustomEvent(CHART_EMBED_TYPE_EVENT, { bubbles: true, detail: { text: 'A' } })) })
    await waitFor(() => expect(opened.with).toEqual(['A']))
  })
})

// ⛔ Fix round 1 (review finding 4): the spec's hint line while the chart is selected.
describe('fix round 1: a selected chart says what keys do', () => {
  it('shows the hint while selected, politely announced, and not when unselected', async () => {
    await mount()
    const hint = screen.getByText('Selected · type a ticker to switch it (for example A, M, D) · Del removes the chart · Esc back to writing')
    expect(hint.closest('[aria-live="polite"]')).not.toBeNull()
    cleanupAndRemountUnselected()
  })
})

function cleanupAndRemountUnselected() {
  document.body.innerHTML = ''
  render(<WidgetEmbedView node={{ attrs: chartAttrs() }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
  expect(screen.queryByText(/Esc back to writing/)).toBeNull()
}

// Fix round 1 (review minor 12): a frozen chart has no toolbar, so its "this chart is fixed"
// message was written where nothing shows it, and the typed key just vanished.
describe('typing over a frozen chart says why nothing happened (fix round 1)', () => {
  it('shows the message on the chart itself', async () => {
    const { root } = await mount(chartAttrs({ frozen: true }))
    act(() => { root.dispatchEvent(new CustomEvent(CHART_EMBED_TYPE_EVENT, { bubbles: true, detail: { text: 'A' } })) })
    expect(await screen.findByText('This chart is fixed. Insert a new chart for another ticker.')).toBeInTheDocument()
    expect(opened.with).toEqual([])
  })
})

// Fix round 2 (re-review N6): a live region inserted WITH its words is generally not announced. The
// hint's region is there, empty, from the start; selecting the chart fills the same element.
describe('fix round 2: the hint region is mounted empty, then filled', () => {
  it('the same polite region is present before selection and receives the words on selection', async () => {
    const attrs = chartAttrs()
    const view = render(<WidgetEmbedView node={{ attrs }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    await screen.findAllByTestId('chart-embed-stub')
    const root = view.container.querySelector('[data-widget-embed-view="chart"]')
    const region = root.querySelector('[data-chart-hint][aria-live="polite"]')
    expect(region).not.toBeNull()
    expect(region.textContent).toBe('')
    view.rerender(<WidgetEmbedView node={{ attrs }} selected editor={editor()} updateAttributes={vi.fn()} />)
    expect(root.querySelector('[data-chart-hint][aria-live="polite"]')).toBe(region)
    expect(region.textContent).toMatch(/Esc back to writing/)
  })
})
