// Wave 13 lane 13H-4 — WidgetEmbedView's own half of the mobileDrawBar wire:
// it computes `annotate && isCoarsePointer` and hands that straight to the
// chart embed. ChartEmbed.mobileDrawBar.test.jsx covers ChartEmbed's own
// second AND-gate; this file covers the level above it (the exact pattern
// WidgetEmbedView.drawClearance.test.jsx already used for 13H-3's effect —
// mock `./ChartEmbed` to a props recorder, drive Draw mode through the real
// "Draw"/"Done" buttons).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { __resetNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), NodeViewWrapper: (props) => <div {...props} /> }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: vi.fn(async () => null),
  storeFallbackImage: vi.fn(async () => ({ url: '/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))

const coarse = vi.hoisted(() => ({ value: true }))
vi.mock('../../../../components/chart/coarsePointer', () => ({
  useCoarsePointer: () => coarse.value,
}))

const panes = []
vi.mock('./ChartEmbed', () => ({
  default: (props) => { panes.push(props); return <div data-testid="chart-embed-stub" /> },
}))

import WidgetEmbedView from './WidgetEmbedView'
import { buildWidgetEmbedAttrs } from '../../lib/widgetEmbedCore'

const chartAttrs = () => buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: 'D' })
const editor = () => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'note-1' } }, on() {}, off() {} })

let RealIO
beforeAll(() => {
  // Same below-the-fold stub WidgetEmbedView.drawClearance.test.jsx uses — without
  // it the embed never leaves its loading skeleton and ChartEmbed never mounts.
  RealIO = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb }
    observe() { this.cb([{ isIntersecting: true }], this) }
    unobserve() {}
    disconnect() {}
  }
})
afterAll(() => { globalThis.IntersectionObserver = RealIO })
beforeEach(() => { __resetNotebookFlags(); coarse.value = true; panes.length = 0 })
afterEach(() => __resetNotebookFlags())

describe('WidgetEmbedView -> ChartEmbed mobileDrawBar wire (13H-4)', () => {
  it('coarse pointer + Draw mode: ChartEmbed receives mobileDrawBar=true', async () => {
    render(<WidgetEmbedView node={{ attrs: chartAttrs() }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    await screen.findByTestId('chart-embed-stub')
    expect(panes[panes.length - 1].mobileDrawBar).toBe(false) // not drawing yet
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    expect(panes[panes.length - 1].mobileDrawBar).toBe(true)
  })

  it('fine pointer + Draw mode: mobileDrawBar stays false (ChartToolbar is the right presentation there)', async () => {
    coarse.value = false
    render(<WidgetEmbedView node={{ attrs: chartAttrs() }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    await screen.findByTestId('chart-embed-stub')
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    expect(panes[panes.length - 1].mobileDrawBar).toBe(false)
  })

  it('exiting Draw mode drops it back to false', async () => {
    render(<WidgetEmbedView node={{ attrs: chartAttrs() }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    await screen.findByTestId('chart-embed-stub')
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    expect(panes[panes.length - 1].mobileDrawBar).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(panes[panes.length - 1].mobileDrawBar).toBe(false)
  })
})
