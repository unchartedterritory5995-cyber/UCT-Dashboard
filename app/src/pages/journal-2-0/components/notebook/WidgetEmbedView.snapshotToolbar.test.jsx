// Notebook widgets fix F4 (D1, browser walk 2026-10-21): the embed toolbar (‹, ⋯, More) covered a snapshot
// widget's frame title. At 1200 px on hover it read "‹ ⋯ More positions and risk"; on the touch tier, where
// the toolbar is always shown with 44 px controls, the title was hidden outright at 820 and 390
// (1200-2-myPositionsRisk.png, 820-2-myPnlStats.png, 390-2-myPositionsRisk.png).
//
// jsdom performs no layout, so the promise is pinned at the two places that make it: the frame says it holds
// a snapshot kind (a DOM attribute, no schema change), and the stylesheet takes THAT frame's toolbar out of
// absolute positioning, so it is a row in flow above the body, never drawn over the header. A chart embed
// keeps the overlay. The screenshot re-check should show, at 1200 / 820 / 390, the toolbar row first and the
// widget title fully readable on the line below it.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { __resetNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('@tiptap/react', async (orig) => ({ ...(await orig()), NodeViewWrapper: (props) => <div {...props} /> }))
vi.mock('../../lib/embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: vi.fn(async () => null),
  storeFallbackImage: vi.fn(async () => ({ url: '/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))
vi.mock('./widgets/MyPositionsRiskEmbed', () => ({ default: () => <div data-testid="risk-stub">My open positions and risk</div> }))
vi.mock('./ChartEmbed', () => ({ default: () => <div data-testid="chart-embed-stub" /> }))

import WidgetEmbedView from './WidgetEmbedView'
import { widgetEmbedNode } from '../../lib/notebookWidgets'
import { buildWidgetEmbedAttrs } from '../../lib/widgetEmbedCore'

const css = readFileSync(
  join(process.cwd(), 'src/pages/journal-2-0/components/notebook/WidgetEmbedView.module.css'), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

/** Every `selector { body }` rule (one level; media bodies are scanned the same way), with its selector text. */
function rules(src) {
  const out = []
  const re = /([^{}@]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(src))) out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] })
  return out
}

const editor = () => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'note-1' } }, on() {}, off() {} })

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
beforeEach(() => {
  __resetNotebookFlags()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
})
afterEach(() => { __resetNotebookFlags(); vi.unstubAllGlobals() })

describe('a snapshot widget keeps its title clear of the embed toolbar', () => {
  it('the frame of a snapshot kind says so, and its toolbar comes BEFORE the body, as a sibling', async () => {
    const { attrs } = widgetEmbedNode('myPositionsRisk', { asOf: '2026-10-21T11:39:00Z', source: 'manual', rows: [] })
    const { container } = render(
      <WidgetEmbedView node={{ attrs }} selected editor={editor()} updateAttributes={vi.fn()} />,
    )
    await screen.findByTestId('risk-stub')
    const frame = container.querySelector('[data-widget-embed-view="myPositionsRisk"]')
    expect(frame.getAttribute('data-snapshot-embed')).toBe('true')
    const bar = screen.getByRole('toolbar', { name: 'Chart tools' })
    const body = container.querySelector('[data-widget-embed-body]')
    // The two are siblings in the frame, toolbar first: the stylesheet below then keeps it in flow.
    expect(bar.parentElement).toBe(frame)
    expect(body.parentElement).toBe(frame)
    expect(bar.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The title the toolbar used to cover is rendered (stub text) inside the body, not the toolbar.
    expect(body.textContent).toContain('My open positions and risk')
    expect(bar.textContent).not.toContain('My open positions and risk')
  })

  it('a chart embed is not marked, so it keeps the overlay toolbar over its canvas', async () => {
    const attrs = buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: 'D', to: Math.floor(Date.now() / 1000) })
    const { container } = render(<WidgetEmbedView node={{ attrs }} selected={false} editor={editor()} updateAttributes={vi.fn()} />)
    await screen.findByTestId('chart-embed-stub')
    expect(container.querySelector('[data-widget-embed-view="chart"]').hasAttribute('data-snapshot-embed')).toBe(false)
  })

  it('the stylesheet takes the marked frame\'s toolbar out of absolute positioning', () => {
    const all = rules(css)
    const base = all.find((r) => r.selector === '.toolbar')
    expect(base).toBeTruthy()                                   // non-vacuity: the overlay rule is still there
    expect(base.body).toMatch(/position:\s*absolute/)
    const snap = all.find((r) => r.selector === '.frame[data-snapshot-embed] .toolbar')
    expect(snap).toBeTruthy()
    expect(snap.body).toMatch(/position:\s*static/)
  })

  it('no later rule (touch tier included) puts any toolbar back to absolute or fixed', () => {
    const all = rules(css)
    const at = all.findIndex((r) => r.selector === '.frame[data-snapshot-embed] .toolbar')
    expect(at).toBeGreaterThan(-1)
    const later = all.slice(at + 1).filter((r) => /\.toolbar\b/.test(r.selector) && !/::/.test(r.selector))
    expect(later.length).toBeGreaterThan(0)                    // non-vacuity: hover and touch rules follow
    for (const r of later) {
      if (/position:\s*(absolute|fixed)/.test(r.body)) {
        // Only the chart-only draw mode may move it; a snapshot kind has no Draw.
        expect(r.selector).toMatch(/^\.annotating \.toolbar$/)
      }
    }
  })
})
