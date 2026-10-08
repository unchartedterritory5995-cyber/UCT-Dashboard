// Wave 13 lane 13H-2 — the chart-plan doors on a note's chart embed (Plan, Replay, and the
// panel's mount), held to 13H-1's gate. OFF: the embed is byte-for-byte the toolbar it was and
// the panel's chunk is never asked for. ON: the doors appear on an editable live chart only —
// never on the public share page, a frozen image, or a non-chart widget.
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
const panelMounts = vi.hoisted(() => ({ n: 0 }))
vi.mock('./ChartPlanPanel', () => ({
  default: (props) => {
    panelMounts.n += 1
    return (
      <div
        data-testid="plan-panel-stub"
        data-open={String(!!props.open)}
        data-replay={String(!!props.replayOpen)}
        data-note={props.noteId || ''}
      />
    )
  },
}))

import WidgetEmbedView from './WidgetEmbedView'
import { buildWidgetEmbedAttrs } from '../../lib/widgetEmbedCore'

const nowSec = Math.floor(Date.now() / 1000)
const chartAttrs = (extra = {}) => ({
  ...buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: 'D', to: nowSec }), ...extra,
})
const editor = (over = {}) => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'note-9', ...over } }, on() {}, off() {} })

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
beforeEach(() => { __resetNotebookFlags(); panelMounts.n = 0 })
afterEach(() => __resetNotebookFlags())

describe('the chart-plan doors on a note chart', () => {
  it('gate OFF: no Plan, no Replay, and the panel is never mounted', async () => {
    latchNotebookFlags({ notebook_chart_plan_enabled: false })
    render(<WidgetEmbedView node={{ attrs: chartAttrs() }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    await screen.findByTestId('chart-embed-stub')
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull()
    expect(screen.queryByTestId('plan-panel-stub')).toBeNull()
    expect(panelMounts.n).toBe(0)
  })

  it('gate ON: Plan toggles the panel open, Replay opens the replay, the note id reaches it', async () => {
    latchNotebookFlags({ notebook_chart_plan_enabled: true })
    render(<WidgetEmbedView node={{ attrs: chartAttrs() }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    const panel = await screen.findByTestId('plan-panel-stub')
    expect(panel.dataset.open).toBe('false')          // mounted closed: the alert sync still runs
    expect(panel.dataset.note).toBe('note-9')
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }))
    expect(screen.getByTestId('plan-panel-stub').dataset.open).toBe('true')
    expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }))
    expect(screen.getByTestId('plan-panel-stub').dataset.replay).toBe('true')
  })

  it('gate ON but the public share page, a frozen chart, a reader, or a non-chart widget: no doors', async () => {
    latchNotebookFlags({ notebook_chart_plan_enabled: true })
    const cases = [
      { attrs: chartAttrs(), ed: editor({ shareView: true }) },
      { attrs: chartAttrs({ frozen: true }), ed: editor() },
      { attrs: chartAttrs(), ed: { ...editor(), isEditable: false } },
      { attrs: buildWidgetEmbedAttrs('breadth', {}), ed: editor() },
    ]
    for (const c of cases) {
      const { unmount } = render(<WidgetEmbedView node={{ attrs: c.attrs }} selected={false} editor={c.ed} updateAttributes={vi.fn()} />)
      expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull()
      expect(screen.queryByTestId('plan-panel-stub')).toBeNull()
      unmount()
    }
  })
})
