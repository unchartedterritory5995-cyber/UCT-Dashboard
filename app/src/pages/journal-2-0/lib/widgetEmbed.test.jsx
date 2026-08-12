// Journal Widgets P3 — the embed node's document contract.
//
// Three rails: (1) attr construction + the render-path decision are pure and
// pinned; (2) a widgetEmbed node survives the HTML round-trip the importer
// and copy/paste ride (generateHTML → generateJSON with the SAME
// buildExtensions the editor uses); (3) the client plain-text serializer
// emits the stored searchText line — the same line the server serializer
// reads — so notebook search sees embeds identically on both sides.
import { describe, it, expect, vi } from 'vitest'
// Same entry the importer's convert.js round-trips through.
import { generateHTML, generateJSON } from '@tiptap/core'
import { render, screen } from '@testing-library/react'

vi.mock('@tiptap/react', async (orig) => {
  const mod = await orig()
  // NodeViewWrapper needs a live editor context; the view's render chain does
  // not. A plain div keeps these tests about the CHAIN, not the editor.
  return { ...mod, NodeViewWrapper: (props) => <div {...props} /> }
})

import { buildExtensions, extractPlainText } from './tiptap'
import {
  buildWidgetEmbedAttrs, parseChartSlashArgs, parseTfToken,
  resolveEmbedRender, embedAutoCaption, widgetSlotNode,
  reanchorRange, countLiveEmbeds, LIVE_EMBEDS_PER_ENTRY,
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
    expect(attrs.layout).toEqual({ width: 'full', height: 320 })
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
