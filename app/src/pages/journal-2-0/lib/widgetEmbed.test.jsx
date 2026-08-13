// Journal Widgets P3 — the embed node's document contract.
//
// Three rails: (1) attr construction + the render-path decision are pure and
// pinned; (2) a widgetEmbed node survives the HTML round-trip the importer
// and copy/paste ride (generateHTML → generateJSON with the SAME
// buildExtensions the editor uses); (3) the client plain-text serializer
// emits the stored searchText line — the same line the server serializer
// reads — so notebook search sees embeds identically on both sides.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
// Same entry the importer's convert.js round-trips through.
import { generateHTML, generateJSON } from '@tiptap/core'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { canvasesLookPainted } from './embedArchive'

vi.mock('@tiptap/react', async (orig) => {
  const mod = await orig()
  // NodeViewWrapper needs a live editor context; the view's render chain does
  // not. A plain div keeps these tests about the CHAIN, not the editor.
  return { ...mod, NodeViewWrapper: (props) => <div {...props} /> }
})

// The self-archive pipeline does real fetches (bars warm, PNG upload) — keep
// the durability plumbing out of jsdom. Partial mock: the pure paint verdict
// (canvasesLookPainted) stays real so its tests hit the shipped code.
vi.mock('./embedArchive', async (orig) => ({
  ...(await orig()),
  captureElementPng: vi.fn(async () => null),
  storeFallbackImage: vi.fn(async () => ({ url: '/api/x.png' })),
  kickSnapshotWarm: vi.fn(),
}))

// The live chart renderer drags ChartPane/StockChart into jsdom; draw-mode
// tests are about the VIEW's toolbar + annotation wiring, so stub it with a
// probe that surfaces the two props under test.
vi.mock('../components/notebook/ChartEmbed', () => ({
  default: (props) => (
    <div data-testid="chart-embed-stub" data-annotate={String(!!props.annotate)}>
      <button
        type="button"
        data-testid="emit-drawing"
        onClick={() => props.onAnnotationsChange?.([{ id: 'probe-line' }])}
      />
      <button
        type="button"
        data-testid="emit-bars-ready"
        onClick={() => props.onBarsReady?.()}
      />
    </div>
  ),
}))

import { buildExtensions, extractPlainText } from './tiptap'
import {
  buildWidgetEmbedAttrs, parseChartSlashArgs, parseTfToken,
  resolveEmbedRender, embedAutoCaption, widgetSlotNode,
  reanchorRange, countLiveEmbeds, LIVE_EMBEDS_PER_ENTRY, retimeChartParams,
  embedRenderHeight, EMBED_LEGACY_DEFAULT_HEIGHT,
} from './widgetEmbedCore'
import WidgetEmbedView from '../components/notebook/WidgetEmbedView'

const nowSec = Math.floor(Date.now() / 1000)

describe('buildWidgetEmbedAttrs', () => {
  it('normalizes the capture through the registry schema and derives searchText', () => {
    const attrs = buildWidgetEmbedAttrs('chart', { symbol: 'amd', tf: '5', _leak: 1 })
    expect(attrs.v).toBe(1)
    expect(attrs.widgetId).toBe('chart')
    expect(attrs.params).toEqual({ symbol: 'AMD', tf: '5' })
    expect(attrs.params._leak).toBeUndefined()
    expect(attrs.mode).toBe('snapshot')
    expect(attrs.fallback).toBeNull()
    // height null = AUTO (derived from rendered width at chart-page aspect)
    expect(attrs.layout).toEqual({ width: 'full', height: null })
    expect(attrs.searchText).toBe('[chart: AMD 5m]')
    expect(typeof attrs.capturedAt).toBe('string')
  })
})

describe('slash arg parsing', () => {
  it('parses symbol + timeframe tokens', () => {
    expect(parseChartSlashArgs('AMD 15m')).toEqual({ symbol: 'AMD', tf: '15' })
    expect(parseChartSlashArgs('amd')).toEqual({ symbol: 'AMD', tf: 'D' })
    expect(parseChartSlashArgs('NVDA 1h')).toEqual({ symbol: 'NVDA', tf: '60' })
    expect(parseChartSlashArgs('brk.b w')).toEqual({ symbol: 'BRK.B', tf: 'W' })
    expect(parseChartSlashArgs('')).toBeNull()
    expect(parseChartSlashArgs('123')).toBeNull()
    // Prose after '/chart' must parse as NOTHING — with allowSpaces the
    // suggestion stays alive mid-sentence, and a lenient parse turned
    // '/chart looks great here' + Enter into a LOOKS·D embed that ate the
    // sentence (review finding).
    expect(parseChartSlashArgs('looks great here')).toBeNull()
    expect(parseChartSlashArgs('looks great')).toBeNull()
    expect(parseChartSlashArgs('AMD notatf')).toBeNull()
  })
  it('maps timeframe tokens onto bars-API codes', () => {
    expect(parseTfToken('5m')).toBe('5')
    expect(parseTfToken('d')).toBe('D')
    expect(parseTfToken('60m')).toBe('60')
    expect(parseTfToken('15')).toBe('15')
    expect(parseTfToken('nope')).toBeNull()
  })
})

describe('resolveEmbedRender — the never-broken chain', () => {
  const chartAttrs = (over = {}) => ({
    ...buildWidgetEmbedAttrs('chart', { symbol: 'AMD', tf: '5', to: nowSec - 3600 }),
    ...over,
  })
  it('recent chart snapshot renders live from frozen params', () => {
    expect(resolveEmbedRender(chartAttrs())).toEqual({ kind: 'live', reason: 'reconstructable' })
  })
  it('a 1m chart beyond its 60-day wall drops to the archive', () => {
    const attrs = buildWidgetEmbedAttrs('chart', { symbol: 'AMD', tf: '1', to: nowSec - 90 * 86400 })
    expect(resolveEmbedRender({ ...attrs, fallback: { url: '/x.png' } }).kind).toBe('image')
    expect(resolveEmbedRender(attrs).kind).toBe('placeholder')
  })
  it('unknown/removed widget types degrade to image, never crash', () => {
    expect(resolveEmbedRender({ widgetId: 'gone', params: {}, fallback: { url: '/x.png' } }))
      .toEqual({ kind: 'image', reason: 'unknown-widget' })
    expect(resolveEmbedRender({ widgetId: 'gone', params: {} }).kind).toBe('placeholder')
  })
  it('invalid params degrade instead of rendering wrong', () => {
    expect(resolveEmbedRender({ widgetId: 'chart', params: {}, fallback: { url: '/x.png' } }))
      .toEqual({ kind: 'image', reason: 'invalid-params' })
  })
  it('image-only types render their archive even in live mode', () => {
    const attrs = buildWidgetEmbedAttrs('breadth', {}, { mode: 'live', fallback: { url: '/b.png' } })
    expect(resolveEmbedRender(attrs)).toEqual({ kind: 'image', reason: 'image-only' })
  })
})

describe('document round-trip', () => {
  it('survives generateHTML → generateJSON with the editor extension set', () => {
    const attrs = buildWidgetEmbedAttrs('chart', { symbol: 'AMD', tf: '5', from: 1710338700, to: 1710343800, settings: { background: '#0f0f0f' } }, { tradeRef: 'tr_9', caption: 'entry bar' })
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      { type: 'widgetEmbed', attrs },
    ] }
    const exts = buildExtensions()
    const html = generateHTML(doc, exts)
    expect(html).toContain('data-widget-embed')
    expect(html).toContain('[chart: AMD 5m]')
    const revived = generateJSON(html, exts)
    const node = revived.content.find(n => n.type === 'widgetEmbed')
    expect(node).toBeTruthy()
    expect(node.attrs.widgetId).toBe('chart')
    expect(node.attrs.params).toEqual(attrs.params)
    expect(node.attrs.tradeRef).toBe('tr_9')
    expect(node.attrs.caption).toBe('entry bar')
    expect(node.attrs.layout).toEqual(attrs.layout)
    expect(node.attrs.searchText).toBe('[chart: AMD 5m]')
  })

  it('a template-declared widget slot round-trips like a hand-inserted embed', () => {
    // The integration point the spec demands: TEMPLATES[].build(ctx) emits
    // widgetSlotNode(...) inside its doc content, no other API needed.
    const doc = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Daily plan' }] },
      widgetSlotNode('chart', { symbol: 'SPY', tf: 'D' }),
    ] }
    const exts = buildExtensions()
    const revived = generateJSON(generateHTML(doc, exts), exts)
    const node = revived.content.find(n => n.type === 'widgetEmbed')
    expect(node.attrs.params).toEqual({ symbol: 'SPY', tf: 'D' })
    expect(node.attrs.searchText).toBe('[chart: SPY D]')
  })

  it('extractPlainText emits the stored searchText line (server parity)', () => {
    const attrs = buildWidgetEmbedAttrs('chart', { symbol: 'AMD', tf: '5' })
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Note' }] },
      { type: 'widgetEmbed', attrs },
      { type: 'widgetEmbed', attrs: { widgetId: 'gone' } },
    ] }
    const txt = extractPlainText(doc)
    expect(txt).toContain('[chart: AMD 5m]')
    expect(txt).toContain('[widget]')
  })
})

describe('timeframe re-anchoring (spec: same center, never jump to now)', () => {
  it('keeps the center timestamp and re-sizes the window by bar count', () => {
    // 100 five-minute bars: 30,000s window centered on 1,715,000,000.
    const from = 1715000000 - 15000
    const to = 1715000000 + 15000
    const r = reanchorRange(from, to, '5', '15')
    // Same bar count at 15m = 3× the span, same center.
    expect((r.from + r.to) / 2).toBeCloseTo(1715000000, 0)
    expect(r.to - r.from).toBe(90000)
    // Downshift: 15m → 5m shrinks the window back, same center.
    const r2 = reanchorRange(r.from, r.to, '15', '5')
    expect((r2.from + r2.to) / 2).toBeCloseTo(1715000000, 0)
    expect(r2.to - r2.from).toBe(30000)
  })
  it('handles intraday ↔ daily and rejects unusable ranges', () => {
    const r = reanchorRange(1715000000, 1715000000 + 20 * 86400, 'D', '60')
    expect((r.from + r.to) / 2).toBeCloseTo(1715000000 + 10 * 86400, 0)
    expect(r.to - r.from).toBe(20 * 3600)
    expect(reanchorRange(null, 1715000000, '5', '15')).toBeNull()
    expect(reanchorRange(1715000000, 1715000000, '5', '15')).toBeNull()
  })
})

describe('toolbar tf switch (retimeChartParams — the re-anchor math\'s door)', () => {
  it('re-anchors the frozen window around the same center and re-derives searchText', () => {
    const attrs = buildWidgetEmbedAttrs('chart', {
      symbol: 'AMD', tf: '5', from: 1715000000 - 15000, to: 1715000000 + 15000,
    })
    const next = retimeChartParams(attrs, '15')
    expect(next.params.tf).toBe('15')
    expect((next.params.from + next.params.to) / 2).toBeCloseTo(1715000000, 0)
    expect(next.params.to - next.params.from).toBe(90000) // same bar count × 3
    expect(next.params.symbol).toBe('AMD')
    expect(next.searchText).toBe('[chart: AMD 15m]')
  })
  it('no-ops on the same tf and survives an anchorless capture', () => {
    const attrs = buildWidgetEmbedAttrs('chart', { symbol: 'AMD', tf: '5' })
    expect(retimeChartParams(attrs, '5')).toBeNull()
    const bare = retimeChartParams(buildWidgetEmbedAttrs('chart', { symbol: 'SPY', tf: 'D' }), '60')
    expect(bare.params).toEqual({ symbol: 'SPY', tf: '60' })
    expect(bare.searchText).toBe('[chart: SPY 1h]')
  })
})

describe('embed render height (screenshot proportions)', () => {
  it('auto height follows the rendered width at chart-page aspect, clamped', () => {
    expect(embedRenderHeight(null, 966)).toBe(531)
    expect(embedRenderHeight(null, 460)).toBe(300)   // half-width floor
    expect(embedRenderHeight(null, 2000)).toBe(640)  // ceiling
    expect(embedRenderHeight(null, 0)).toBe(531)     // unmeasured → prose-column default
  })
  it('the v1 default 320 reads as auto (nobody ever chose it); explicit heights win', () => {
    expect(embedRenderHeight(EMBED_LEGACY_DEFAULT_HEIGHT, 966)).toBe(531)
    expect(embedRenderHeight(480, 966)).toBe(480)
  })
})

describe('live-embed budget', () => {
  it('counts live embeds and the cap constant matches the owner decision', () => {
    const live = { type: 'widgetEmbed', attrs: { mode: 'live' } }
    const snap = { type: 'widgetEmbed', attrs: { mode: 'snapshot' } }
    const doc = { type: 'doc', content: [live, snap, { type: 'paragraph', content: [] }, live] }
    expect(countLiveEmbeds(doc)).toBe(2)
    expect(countLiveEmbeds({})).toBe(0)
    expect(LIVE_EMBEDS_PER_ENTRY).toBe(3)
  })
})

describe('WidgetEmbedView fallback rendering', () => {
  it('renders the archived image + label when live is impossible', () => {
    const attrs = buildWidgetEmbedAttrs('breadth', {}, { fallback: { url: '/api/x.png', w: 800, h: 400 } })
    render(<WidgetEmbedView node={{ attrs }} selected={false} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('/api/x.png')
    expect(screen.getByText(/archived snapshot/i)).toBeTruthy()
  })
  it('renders a labeled placeholder for an unknown type with no archive', () => {
    render(<WidgetEmbedView node={{ attrs: { widgetId: 'gone', searchText: '[mystery]' } }} selected={false} />)
    expect(screen.getByText('[mystery]')).toBeTruthy()
    expect(screen.getByText(/widget type unavailable/i)).toBeTruthy()
  })
  it('derives the auto-caption from params, never from stored text', () => {
    const attrs = buildWidgetEmbedAttrs('chart', { symbol: 'AMD', tf: '5' }, { capturedAt: '2026-03-13T15:45:00Z' })
    expect(embedAutoCaption(attrs)).toBe('chart: AMD 5m · captured Mar 13, 2026')
  })
})

describe('WidgetEmbedView draw mode', () => {
  const liveChartAttrs = () =>
    buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: '5', from: nowSec - 3600, to: nowSec })

  // test-setup.js polyfills IntersectionObserver as a NOOP (never fires), so
  // the view's below-the-fold gate would hold inView=false forever and the
  // live component under test could never mount. These tests need the gate to
  // OPEN — an IO that reports intersection on observe, exactly what a browser
  // does for an on-screen embed.
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

  it('Draw collapses the toolbar to the lone Done button (the chart drawing toolbar owns the top strip)', async () => {
    render(<WidgetEmbedView node={{ attrs: liveChartAttrs() }} selected={false} updateAttributes={() => {}} />)
    await screen.findByTestId('chart-embed-stub')
    // Full toolbar before drawing.
    expect(screen.getByTitle('Remove embed')).toBeTruthy()
    expect(screen.getByText('Re-capture')).toBeTruthy()
    expect(screen.getByLabelText('Embed timeframe')).toBeTruthy()

    fireEvent.click(screen.getByText('Draw'))
    expect(screen.getByText('Done')).toBeTruthy()
    // Everything else leaves the strip — including the destructive ✕, one
    // misclick away from a drawing gesture.
    expect(screen.queryByTitle('Remove embed')).toBeNull()
    expect(screen.queryByText('Re-capture')).toBeNull()
    expect(screen.queryByText('Live')).toBeNull()
    expect(screen.queryByText('Half')).toBeNull()
    expect(screen.queryByLabelText('Embed timeframe')).toBeNull()

    fireEvent.click(screen.getByText('Done'))
    expect(screen.getByText('Draw')).toBeTruthy()
    expect(screen.getByTitle('Remove embed')).toBeTruthy()
  })

  it('annotate + onAnnotationsChange reach the chart only in draw mode; edits land in attrs.annotations', async () => {
    const updateAttributes = vi.fn()
    render(<WidgetEmbedView node={{ attrs: liveChartAttrs() }} selected={false} updateAttributes={updateAttributes} />)
    const stub = await screen.findByTestId('chart-embed-stub')

    // Read-only until Draw: annotate off, and the change callback is absent.
    expect(stub.getAttribute('data-annotate')).toBe('false')
    fireEvent.click(screen.getByTestId('emit-drawing'))
    expect(updateAttributes).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Draw'))
    expect(screen.getByTestId('chart-embed-stub').getAttribute('data-annotate')).toBe('true')
    fireEvent.click(screen.getByTestId('emit-drawing'))
    expect(updateAttributes).toHaveBeenCalledWith({ annotations: [{ id: 'probe-line' }] })
  })

  it('Done after changed marks re-freezes the archive; Done without changes does not', async () => {
    const updateAttributes = vi.fn()
    const attrs = { ...liveChartAttrs(), fallback: { url: '/api/old.png', w: 800, h: 400 } }
    render(<WidgetEmbedView node={{ attrs }} selected={false} updateAttributes={updateAttributes} />)
    await screen.findByTestId('chart-embed-stub')

    const refreeze = () => updateAttributes.mock.calls.filter(([a]) => a && a.fallback === null)

    // Draw → Done with NO edits: the archive still matches — no re-freeze.
    fireEvent.click(screen.getByText('Draw'))
    fireEvent.click(screen.getByText('Done'))
    expect(refreeze()).toHaveLength(0)

    // Draw → edit → Done: fallback cleared (re-arms self-archive) with a
    // fresh capturedAt stamp.
    fireEvent.click(screen.getByText('Draw'))
    fireEvent.click(screen.getByTestId('emit-drawing'))
    fireEvent.click(screen.getByText('Done'))
    expect(refreeze()).toHaveLength(1)
    expect(refreeze()[0][0].capturedAt).toBeTruthy()
  })

  it('live-mode embeds skip the Done re-freeze (self-archive is snapshot-only); freezing with marks re-freezes', async () => {
    const updateAttributes = vi.fn()
    const attrs = {
      ...buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: '5', from: nowSec - 3600, to: nowSec },
        { mode: 'live', annotations: [{ id: 'mark' }] }),
      fallback: { url: '/api/old.png', w: 800, h: 400 },
    }
    render(<WidgetEmbedView node={{ attrs }} selected={false} updateAttributes={updateAttributes} />)
    await screen.findByTestId('chart-embed-stub')

    // Done after an edit on a LIVE embed: clearing fallback would orphan the
    // archive (needsArchive requires mode:'snapshot') — must NOT fire.
    fireEvent.click(screen.getByText('Draw'))
    fireEvent.click(screen.getByTestId('emit-drawing'))
    fireEvent.click(screen.getByText('Done'))
    expect(updateAttributes.mock.calls.filter(([a]) => a && a.fallback === null)).toHaveLength(0)

    // Freezing the annotated live embed re-freezes: mode + fallback together.
    fireEvent.click(screen.getByText('Snapshot'))
    expect(updateAttributes).toHaveBeenCalledWith({ mode: 'snapshot', fallback: null })
  })

  it('focusing the prose editor exits draw mode (the overlay eats editor undo while editable)', async () => {
    const handlers = {}
    const editor = {
      isEditable: true,
      storage: { uctJournalWidgets: { noteId: 'n1' } },
      on: (ev, fn) => { handlers[ev] = fn },
      off: (ev) => { delete handlers[ev] },
    }
    render(<WidgetEmbedView node={{ attrs: liveChartAttrs() }} selected={false} editor={editor} updateAttributes={vi.fn()} />)
    await screen.findByTestId('chart-embed-stub')

    fireEvent.click(screen.getByText('Draw'))
    expect(screen.getByText('Done')).toBeTruthy()
    expect(typeof handlers.focus).toBe('function')

    await act(async () => { handlers.focus() })
    expect(screen.getByText('Draw')).toBeTruthy()
    expect(screen.queryByText('Done')).toBeNull()
    // Listener detached once out of draw mode — no stale exit on later focus.
    expect(handlers.focus).toBeUndefined()
  })
})

describe('archive capture paint gate (canvasesLookPainted)', () => {
  it('the observed failure shape — chart canvases blank, overlay carrying only marks — reads UNPAINTED', () => {
    expect(canvasesLookPainted([
      { w: 1098, h: 604, rectW: 1098, rectH: 604, opaqueRatio: 0 },        // LWC price pane, mid-cycle
      { w: 1098, h: 604, rectW: 1098, rectH: 604, opaqueRatio: 0.001 },    // drawing overlay: one line + text
      { w: 76, h: 28, rectW: 76, rectH: 28, opaqueRatio: 1 },              // axis stub — too small to vote
    ])).toBe(false)
  })
  it('a painted pane passes even beside its legitimately-empty crosshair layer', () => {
    expect(canvasesLookPainted([
      { w: 1098, h: 604, rectW: 1098, rectH: 604, opaqueRatio: 0.9 },
      { w: 1098, h: 604, rectW: 1098, rectH: 604, opaqueRatio: 0 },
    ])).toBe(true)
  })
  it('an unsized default bitmap stretched over the pane votes by its CSS rect', () => {
    expect(canvasesLookPainted([
      { w: 300, h: 150, rectW: 1022, rectH: 576, opaqueRatio: 0 },
      { w: 1098, h: 604, rectW: 1098, rectH: 604, opaqueRatio: 0.002 },
    ])).toBe(false)
  })
  it('fails OPEN: unmeasurable contexts and DOM-only widgets never block a capture', () => {
    expect(canvasesLookPainted([{ w: 1098, h: 604, rectW: 1098, rectH: 604, opaqueRatio: null }])).toBe(true)
    expect(canvasesLookPainted([])).toBe(true)
    expect(canvasesLookPainted([{ w: 16, h: 16, rectW: 16, rectH: 16, opaqueRatio: 0 }])).toBe(true)
  })
})

describe('WidgetEmbedView self-archive bars-ready gate', () => {
  const editor = { storage: { uctJournalWidgets: { noteId: 'note-1' } }, isEditable: true }
  const bareAttrs = () =>
    buildWidgetEmbedAttrs('chart', { symbol: 'NVDA', tf: '5', from: nowSec - 3600, to: nowSec })

  let RealIO
  beforeAll(async () => {
    RealIO = globalThis.IntersectionObserver
    globalThis.IntersectionObserver = class {
      constructor(cb) { this.cb = cb }
      observe() { this.cb([{ isIntersecting: true }], this) }
      unobserve() {}
      disconnect() {}
    }
  })
  afterAll(() => { globalThis.IntersectionObserver = RealIO })

  it('never rasterizes before the chart signals bars-ready (the blank-archive race)', async () => {
    const { captureElementPng } = await import('./embedArchive')
    captureElementPng.mockClear()
    render(<WidgetEmbedView node={{ attrs: bareAttrs() }} selected={false} editor={editor} updateAttributes={vi.fn()} />)
    await screen.findByTestId('chart-embed-stub')
    // Past the settle window with NO ready signal: the gate must hold.
    await new Promise((r) => setTimeout(r, 4000))
    expect(captureElementPng).not.toHaveBeenCalled()
  }, 10000)

  it('captures once bars are ready and patches the fallback onto the node', async () => {
    const { captureElementPng, storeFallbackImage } = await import('./embedArchive')
    captureElementPng.mockClear()
    captureElementPng.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
    storeFallbackImage.mockResolvedValue({ url: '/api/fresh.png', width: 800, height: 400 })
    const updateAttributes = vi.fn()
    render(<WidgetEmbedView node={{ attrs: bareAttrs() }} selected={false} editor={editor} updateAttributes={updateAttributes} />)
    fireEvent.click(await screen.findByTestId('emit-bars-ready'))
    await waitFor(() => expect(captureElementPng).toHaveBeenCalled(), { timeout: 6000 })
    await waitFor(() => expect(updateAttributes).toHaveBeenCalledWith({
      fallback: { url: '/api/fresh.png', w: 800, h: 400 },
    }), { timeout: 2000 })
  }, 12000)
})
