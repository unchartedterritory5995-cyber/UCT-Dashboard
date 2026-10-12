// P1.7(b): the card an older bundle shows for a block from a newer version. It names the block,
// says what to do, offers Reload, and never writes to the node.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), NodeViewWrapper: (props) => <div {...props} /> }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: vi.fn(async () => null),
  storeFallbackImage: vi.fn(async () => ({ url: '/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))

import WidgetEmbedView, { UNKNOWN_BLOCK_SENTENCE } from './WidgetEmbedView'

const editor = () => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'note-9' } }, on() {}, off() {} })
const FUTURE = {
  v: 1, widgetId: 'checklistFromTheFuture', embedId: 'e-future-1', mode: 'snapshot',
  capturedAt: '2026-10-11T14:00:00Z', searchText: '[checklist: 1 of 1]', params: { items: [] },
}

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

describe('a block this bundle does not know', () => {
  it('shows the newer-version sentence, the block line and a Reload button', () => {
    render(<WidgetEmbedView node={{ attrs: FUTURE }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    expect(UNKNOWN_BLOCK_SENTENCE).toBe('This block needs a newer version of the app. Reload to see it.')
    expect(screen.getByText(UNKNOWN_BLOCK_SENTENCE)).toBeTruthy()
    expect(screen.getByText('[checklist: 1 of 1]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.queryByText('widget type unavailable')).toBeNull()
  })

  it('never writes to the node', async () => {
    const updateAttributes = vi.fn()
    render(<WidgetEmbedView node={{ attrs: FUTURE }} selected={false} editor={editor()} updateAttributes={updateAttributes} />)
    await new Promise((r) => setTimeout(r, 60))
    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('Reload reloads the page and still writes nothing to the node', () => {
    const realLocation = window.location
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...realLocation, reload } })
    try {
      const updateAttributes = vi.fn()
      render(<WidgetEmbedView node={{ attrs: FUTURE }} selected={false} editor={editor()} updateAttributes={updateAttributes} />)
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
      expect(reload).toHaveBeenCalledTimes(1)
      expect(updateAttributes).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation })
    }
  })

  it('a known chart with no image keeps its own sentence (no regression)', () => {
    const chart = { ...FUTURE, widgetId: 'chart', params: { tf: 'D' } }   // missing symbol: invalid params
    render(<WidgetEmbedView node={{ attrs: chart }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    expect(screen.getByText('snapshot image not captured yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })
})
