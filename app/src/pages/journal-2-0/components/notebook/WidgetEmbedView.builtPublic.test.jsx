// The waves 8-10 ship-walk fix round, W10.7 (privacy) and W8.7: on a PUBLIC page (shareView) a built widget is drawn
// from the params the server reduced and relabelled, never from its archived image. The image is a picture of the
// member's editor: their real note titles, folder and account names, and their own controls. Asserted by RENDERED
// TEXT and by what the DOM holds (no <img>, no control), with a control proving the rule is the built widget's.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), NodeViewWrapper: (props) => <div {...props} /> }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: vi.fn(async () => null),
  storeFallbackImage: vi.fn(async () => ({ url: '/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))

import WidgetEmbedView from './WidgetEmbedView'

const publicEditor = () => ({ isEditable: false, storage: { uctJournalWidgets: { shareView: true } }, on() {}, off() {} })

/** What the server's public reducer hands a stranger for a shared notes list (public_note_payload.allowed_params,
 *  tests/test_widget_public_labels.py): the result only, each title numbered. The archive image an older server (or
 *  a hand-made body) might still name is attached too: it must never be drawn. */
const PUBLIC_NOTES_LIST = {
  v: 1, widgetId: 'builtWidget', mode: 'snapshot', capturedAt: '2026-10-25T21:51:00Z',
  fallback: { url: '/api/j2/shared/TOK/att/inline/widget-embed.png', w: 900, h: 500 },
  params: {
    asOf: '2026-10-25T21:51:00Z', title: 'My notes list', view: 'list', share: true, labelKind: 'note',
    rangeLabel: 'Last 90 days', count: 3,
    measures: [{ label: 'Notes', unit: 'notes', kind: 'count', fmt: 'count' }],
    rows: [
      { label: 'Note 1', label2: '2026-10-25', v1: 1, n1: 1, s1: '', n: 1 },
      { label: 'Note 2', label2: '2026-10-25', v1: 1, n1: 1, s1: '', n: 1 },
      { label: 'Note 3', label2: '2026-10-25', v1: 1, n1: 1, s1: '', n: 1 },
    ],
  },
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

describe('a built widget on a public page (the W10.7 / W8.7 walk fix)', () => {
  it('is drawn from the reduced params: the numbered labels, never the archived image', async () => {
    const { container } = render(<WidgetEmbedView node={{ attrs: PUBLIC_NOTES_LIST }} selected={false} editor={publicEditor()} />)
    expect(await screen.findByTestId('built-widget-embed')).toBeTruthy()
    expect(container.textContent).toContain('My notes list')
    for (const n of ['Note 1', 'Note 2', 'Note 3']) expect(screen.getByText(n)).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).not.toMatch(/archived snapshot/i)
  })

  it('draws none of the author\'s controls (no share switch, See it now, Change, Show as table, menu)', async () => {
    const { container } = render(<WidgetEmbedView node={{ attrs: PUBLIC_NOTES_LIST }} selected={false} editor={publicEditor()} />)
    await screen.findByTestId('built-widget-embed')
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelector('[role="switch"], input[type="checkbox"]')).toBeNull()
    for (const word of ['Show on shared pages', 'See it now', 'Change', 'Show as table', 'More for this widget']) {
      expect(container.textContent).not.toContain(word)
    }
  })

  it('with params it cannot draw, falls back to its caption line, never the image', async () => {
    const broken = { ...PUBLIC_NOTES_LIST, params: { ...PUBLIC_NOTES_LIST.params, view: 'list', rows: 'not a list',
      measures: { not: 'a list' } } }
    const { container } = render(<WidgetEmbedView node={{ attrs: broken }} selected={false} editor={publicEditor()} />)
    await new Promise((r) => setTimeout(r, 30))
    expect(container.querySelector('img')).toBeNull()
  })

  it('CONTROL: a phase 1 account kind on a public page still shows its archived image (the rule is the built widget\'s)', () => {
    const phase1 = { ...PUBLIC_NOTES_LIST, widgetId: 'myPnlStats', params: { share: true, netPnl: 10 } }
    const { container } = render(<WidgetEmbedView node={{ attrs: phase1 }} selected={false} editor={publicEditor()} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(PUBLIC_NOTES_LIST.fallback.url)
  })
})
