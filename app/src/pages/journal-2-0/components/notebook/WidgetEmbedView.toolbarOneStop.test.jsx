// Finish program, lane KEYS round 2. The chart toolbar in a note is ONE Tab stop.
//
// Making the toolbar reachable by Tab (round 1) put every one of its controls in the page's
// Tab order: about a dozen stops per chart, and Q22's keyboard count went from 20 to 34. A
// toolbar is one stop. Left and Right move inside it, Home and End jump to its ends, and
// every control stays reachable. Nothing about hover or touch changes: only tabindex does.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

async function mount(planOn = true) {
  latchNotebookFlags({ notebook_chart_plan_enabled: planOn })
  render(<WidgetEmbedView node={{ attrs: chartAttrs() }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
  await screen.findByTestId('chart-embed-stub')
  const bar = screen.getByRole('toolbar', { name: 'Chart tools' })
  const controls = () => [...bar.querySelectorAll('button, a[href], select')].filter((el) => !el.disabled)
  const stops = () => controls().filter((el) => el.tabIndex === 0)
  return { bar, controls, stops }
}

describe('the chart toolbar in a note is one Tab stop', () => {
  it('is a named toolbar and exactly one of its controls is in the Tab order', async () => {
    const { controls, stops } = await mount()
    expect(controls().length).toBeGreaterThan(6)      // NON-VACUITY: there is a real row to walk
    expect(stops().length).toBe(1)
    expect(controls().filter((el) => el.tabIndex === -1).length).toBe(controls().length - 1)
  })

  it('the stop is Plan when the plan door is there, so the plan is one Tab and Enter away', async () => {
    const { stops } = await mount(true)
    expect(stops()[0]).toBe(screen.getByRole('button', { name: 'Plan' }))
  })

  it('with no plan door the stop is the first control', async () => {
    const { controls, stops } = await mount(false)
    expect(stops()[0]).toBe(controls()[0])
  })

  it('Right and Left move one control at a time and the stop moves with focus', async () => {
    const { controls, stops } = await mount()
    const all = controls()
    const at = all.indexOf(stops()[0])
    all[at].focus()
    fireEvent.keyDown(all[at], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(all[at + 1])
    expect(stops()).toEqual([all[at + 1]])
    fireEvent.keyDown(all[at + 1], { key: 'ArrowLeft' })
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(all[at - 1])
    expect(stops()).toEqual([all[at - 1]])
  })

  it('Home and End reach the first and last control, and Right wraps from the last to the first', async () => {
    const { controls } = await mount()
    const all = controls()
    all[3].focus()
    fireEvent.keyDown(all[3], { key: 'End' })
    expect(document.activeElement).toBe(all[all.length - 1])
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(all[0])
    fireEvent.keyDown(document.activeElement, { key: 'End' })
    fireEvent.keyDown(document.activeElement, { key: 'Home' })
    expect(document.activeElement).toBe(all[0])
  })

  it('EVERY control can be reached with the arrow keys alone', async () => {
    const { controls } = await mount()
    const all = controls()
    all[0].focus()
    const seen = new Set([document.activeElement])
    for (let i = 0; i < all.length; i += 1) {
      fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' })
      seen.add(document.activeElement)
    }
    expect(seen.size).toBe(all.length)
  })

  it('Up and Down are left alone, so the timeframe list still changes with them', async () => {
    const { bar } = await mount()
    const select = bar.querySelector('select')
    select.focus()
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    select.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(select)
  })

  it('a control the pointer focuses becomes the stop (a click does not strand the Tab order)', async () => {
    const { controls, stops } = await mount()
    const last = controls()[controls().length - 1]
    last.focus()
    expect(stops()).toEqual([last])
  })
})
