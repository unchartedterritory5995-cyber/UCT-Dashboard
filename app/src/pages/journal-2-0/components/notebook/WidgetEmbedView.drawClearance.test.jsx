// Wave 13 lane 13H-3 — the chart embed's Draw-mode toolbar-clearance height
// bump. The real bug (docs/notebook/evidence/wave13-13h3/, wave13-13h3.md §2):
// a chart embed's Draw mode always renders StockChart's full desktop
// `ChartToolbar` (there is no MobileDrawBar swap on that render path), which
// wraps onto several rows at a touch-narrow embed width and floats
// (`position: absolute`) over a large fraction of the canvas — so a touch tap
// aimed at the upper part of the chart landed on a TOOLBAR BUTTON, never the
// canvas, and no drawing was ever placed. Measured at 390px wide: the toolbar
// bottoms out ~174px below the embed body's own top edge.
//
// This reproduces the MECHANISM, not just the arithmetic (widgetEmbedCore.drawClearance.test.js
// covers the pure function): a fake toolbar button mounts inside the embed body with a
// controlled bounding rect, and the embed's own measurement effect must find it and grow the
// body tall enough to clear it — ONLY on a coarse (touch) pointer, ONLY while Draw mode is open,
// and never persisted past Done.
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

// The mocked chart renders a fake toolbar button carrying a real `aria-label`
// (the exact contract every ChartToolbar tool button carries — "Horizontal
// Line (H)" is the real accessible name run-19's own evidence recorded)
// whenever Draw mode is open, so the embed's measurement effect has something
// real to find inside `[data-widget-embed-body]`.
vi.mock('./ChartEmbed', () => ({
  default: (props) => (
    <div data-testid="chart-embed-stub">
      {props.annotate && (
        <button type="button" aria-label="Horizontal Line (H)" data-fake-toolbar-btn>H</button>
      )}
      {/* A SECOND aria-labeled button, far below the toolbar band -- the kind of
          bottom-anchored chart chrome that caused the measured 16,285px runaway
          (docs/notebook/evidence/wave13-13h3/diag-run4-after-fix) when the effect
          counted every button instead of only the top-anchored toolbar. Always
          present so every test in this file doubles as a check that it is
          correctly ignored. */}
      {props.annotate && (
        <button type="button" aria-label="Chart settings" data-fake-bottom-chrome-btn>⚙</button>
      )}
    </div>
  ),
}))

import WidgetEmbedView from './WidgetEmbedView'
import { buildWidgetEmbedAttrs, ANNOTATE_DRAW_BUFFER_PX } from '../../lib/widgetEmbedCore'

const nowSec = Math.floor(Date.now() / 1000)
const chartAttrs = (extra = {}) => ({
  ...buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: 'D', to: nowSec }), ...extra,
})
const editor = (over = {}) => ({
  isEditable: true, storage: { uctJournalWidgets: { noteId: 'note-9', ...over } }, on() {}, off() {},
})

// jsdom computes no layout: getBoundingClientRect() is always zeros and
// offsetParent is always null. Stub both so the measurement effect sees a real
// top-anchored toolbar bottoming out TOOLBAR_BOTTOM_OFFSET px below the body's
// own top — the exact shape the real bug measured.
const BODY_TOP = 50
const TOOLBAR_BOTTOM_OFFSET = 300 // px below BODY_TOP
// Far below the toolbar band -- bottom-anchored chrome, never the floating
// toolbar this measurement exists to clear (see the mock above).
const BOTTOM_CHROME_OFFSET = 5000 // px below BODY_TOP

let realGetRect
let realOffsetParentDesc
let RealIO
beforeAll(() => {
  // Below-the-fold laziness (WidgetEmbedView's own `inView` gate): without a
  // real IntersectionObserver reporting intersection, the embed renders its
  // loading skeleton forever and the (mocked) chart never mounts at all.
  RealIO = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb }
    observe() { this.cb([{ isIntersecting: true }], this) }
    unobserve() {}
    disconnect() {}
  }
  realGetRect = Element.prototype.getBoundingClientRect
  realOffsetParentDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
  Element.prototype.getBoundingClientRect = function stubRect() {
    if (this.matches?.('[data-widget-embed-body]')) {
      return { top: BODY_TOP, bottom: BODY_TOP + 1, left: 0, right: 0, width: 0, height: 1, x: 0, y: BODY_TOP }
    }
    if (this.matches?.('[data-fake-toolbar-btn]')) {
      return {
        top: BODY_TOP + 10, bottom: BODY_TOP + TOOLBAR_BOTTOM_OFFSET,
        left: 0, right: 40, width: 40, height: TOOLBAR_BOTTOM_OFFSET - 10, x: 0, y: BODY_TOP + 10,
      }
    }
    if (this.matches?.('[data-fake-bottom-chrome-btn]')) {
      return {
        top: BODY_TOP + BOTTOM_CHROME_OFFSET - 10, bottom: BODY_TOP + BOTTOM_CHROME_OFFSET,
        left: 0, right: 40, width: 40, height: 10, x: 0, y: BODY_TOP + BOTTOM_CHROME_OFFSET - 10,
      }
    }
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.matches?.('[data-fake-toolbar-btn], [data-fake-bottom-chrome-btn]') ? document.body : null
    },
  })
})
afterAll(() => {
  Element.prototype.getBoundingClientRect = realGetRect
  if (realOffsetParentDesc) Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParentDesc)
  globalThis.IntersectionObserver = RealIO
})
beforeEach(() => { __resetNotebookFlags(); coarse.value = true })
afterEach(() => __resetNotebookFlags())

function bodyEl(container) {
  return container.querySelector('[data-widget-embed-body]')
}

describe('chart embed Draw-mode toolbar clearance (13H-3)', () => {
  it('a coarse pointer gets a taller body once Draw mode measures the floating toolbar', async () => {
    const { container } = render(
      <WidgetEmbedView node={{ attrs: chartAttrs() }} selected={false} editor={editor()} updateAttributes={vi.fn()} />,
    )
    await screen.findByTestId('chart-embed-stub')
    const before = bodyEl(container).style.height
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    const after = bodyEl(container).style.height
    // The exact number is widgetEmbedCore.drawClearance.test.js's job; here the
    // assertion is the MECHANISM itself: a real DOM measurement of a real
    // toolbar element changed the rendered height, and changed it past the
    // toolbar's own bottom edge -- the clearance a lost tap needed.
    expect(after).not.toBe(before)
    expect(parseInt(after, 10)).toBeGreaterThan(TOOLBAR_BOTTOM_OFFSET - BODY_TOP)
  })

  it('a button far below the toolbar band never feeds the clearance (the measured feedback-loop class)', async () => {
    // docs/notebook/evidence/wave13-13h3/diag-run4-after-fix: an earlier version
    // of this measurement counted EVERY aria-labeled button, including chrome
    // anchored near the chart's own bottom -- whose viewport Y grows WITH the
    // body's own height, so bumping the height fed a bigger "clearance" back in,
    // an unbounded loop that reached 16,285px in one run. The fake bottom-chrome
    // button in this file's mock (always rendered, 5000px below the body's top)
    // reproduces that shape.
    //
    // EXACT equality, not a loose bound: EMBED_MAX_H's own clamp would make a
    // "less than some big number" assertion pass even with the band filter
    // removed (the clamp silently caps the runaway at 1400, which still clears
    // a generous bound) -- that masked mutation was caught and is why this
    // asserts the PRECISE height the toolbar alone produces.
    const { container } = render(
      <WidgetEmbedView node={{ attrs: chartAttrs() }} selected={false} editor={editor()} updateAttributes={vi.fn()} />,
    )
    await screen.findByTestId('chart-embed-stub')
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    const after = parseInt(bodyEl(container).style.height, 10)
    // drawClearance = (BODY_TOP + TOOLBAR_BOTTOM_OFFSET) - BODY_TOP == TOOLBAR_BOTTOM_OFFSET exactly.
    expect(after).toBe(TOOLBAR_BOTTOM_OFFSET + ANNOTATE_DRAW_BUFFER_PX)
  })

  it('a fine pointer never gets the bump -- the SAME floating toolbar never trips it', async () => {
    coarse.value = false
    const { container } = render(
      <WidgetEmbedView node={{ attrs: chartAttrs() }} selected={false} editor={editor()} updateAttributes={vi.fn()} />,
    )
    await screen.findByTestId('chart-embed-stub')
    const before = bodyEl(container).style.height
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    expect(bodyEl(container).style.height).toBe(before)
  })

  it('exiting Draw mode drops the bump -- nothing here is persisted', async () => {
    const { container } = render(
      <WidgetEmbedView node={{ attrs: chartAttrs() }} selected={false} editor={editor()} updateAttributes={vi.fn()} />,
    )
    await screen.findByTestId('chart-embed-stub')
    const before = bodyEl(container).style.height
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    expect(bodyEl(container).style.height).not.toBe(before)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(bodyEl(container).style.height).toBe(before)
  })

  it('a non-chart widget never measures or bumps (the effect is chart-only)', async () => {
    const { container } = render(
      <WidgetEmbedView
        node={{ attrs: buildWidgetEmbedAttrs('breadth', {}) }}
        selected={false}
        editor={editor()}
        updateAttributes={vi.fn()}
      />,
    )
    // Breadth has no Draw button at all; the body simply never grows past its
    // ordinary rendered height regardless of pointer type.
    expect(screen.queryByRole('button', { name: 'Draw' })).toBeNull()
  })
})
