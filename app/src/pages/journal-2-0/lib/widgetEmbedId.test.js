import { describe, it, expect, vi, afterEach } from 'vitest'
import { Editor, generateHTML, generateJSON, getSchema } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { buildWidgetEmbedAttrs, chartInsertNodes, newEmbedId, widgetSlotNode } from './widgetEmbedCore'
import { citationAtomIdentity } from './askCitation'
import { nodeKeyOf } from './offline/serverChange'

// ─────────────────────────────────────────────────────────────────────────
// WAVE 4 — EVERY WIDGET EMBED IS ITS OWN NODE, BY IDENTITY.
//
// Every chart of one /mtf or /compare insert is built in the same millisecond
// and shares capturedAt, so `widgetId|capturedAt` named the whole insert and
// Ask could not cite one chart of it (rereview2 R2-1). Each node now carries
// its own `embedId`, stamped where every node's attrs are built
// (buildWidgetEmbedAttrs). These rails pin the id's generation (including the
// insecure-context fallback), its reach to every creation door, its survival
// through the schema and HTML, and that nothing else keyed on attrs moved.
// ─────────────────────────────────────────────────────────────────────────

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

const insecure = () => vi.stubGlobal('crypto', {}) // a plain-http page: no randomUUID

describe('newEmbedId', () => {
  it('uses crypto.randomUUID when the page has it', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-from-crypto' })
    expect(newEmbedId()).toBe('uuid-from-crypto')
  })

  it('an insecure context (no randomUUID) still gets distinct ids, never throwing', () => {
    insecure()
    const ids = Array.from({ length: 1000 }, () => newEmbedId())
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    // Never mistakable for a legacy widgetId|capturedAt identity.
    expect(ids.some((id) => id.includes('|'))).toBe(false)
  })

  it('a randomUUID that throws, or no crypto at all, falls back too', () => {
    vi.stubGlobal('crypto', { randomUUID: () => { throw new Error('not a secure context') } })
    expect(newEmbedId()).toMatch(/\S/)
    vi.stubGlobal('crypto', undefined)
    expect(newEmbedId()).toMatch(/\S/)
  })

  it('the fallback stays distinct under one frozen clock and a constant Math.random', () => {
    // One insert builds its charts in the same millisecond; a weak RNG must
    // not collapse them back into one identity.
    insecure()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-01T14:00:00.000Z'))
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const ids = [newEmbedId(), newEmbedId(), newEmbedId()]
    expect(new Set(ids).size).toBe(3)
  })
})

describe('every creation door stamps a distinct embedId per NODE', () => {
  const idOf = (attrs) => attrs.embedId
  const distinct = (ids) => {
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  }

  it('buildWidgetEmbedAttrs (every capture door, Send to Journal, the importer, AddPosition)', () => {
    distinct([buildWidgetEmbedAttrs('chart', { symbol: 'NVDA' }), buildWidgetEmbedAttrs('chart', { symbol: 'NVDA' })]
      .map(idOf))
  })

  it('an explicit capturedAt (the capture tray, placing a staged row) still mints a fresh id', () => {
    const extra = { capturedAt: '2026-09-01T14:00:00.000Z' }
    distinct([buildWidgetEmbedAttrs('chart', { symbol: 'NVDA' }, extra),
      buildWidgetEmbedAttrs('chart', { symbol: 'NVDA' }, extra)].map(idOf))
  })

  it('widgetSlotNode and every chartInsertNodes kind (SlashMenu, WidgetPalette, templates)', () => {
    vi.useFakeTimers({ toFake: ['Date'] }) // one insert = one millisecond
    vi.setSystemTime(new Date('2026-09-01T14:00:00.000Z'))
    for (const kind of ['chart', 'mtf', 'compare']) {
      const nodes = chartInsertNodes(kind, { symbol: 'NVDA', tf: 'D', day: 1757000000 })
      expect(nodes.length).toBeGreaterThan(0)
      distinct(nodes.map((n) => idOf(n.attrs)))
      if (nodes.length > 1) expect(new Set(nodes.map((n) => n.attrs.capturedAt)).size).toBe(1) // the R2-1 shape
    }
    distinct([widgetSlotNode('chart', { symbol: 'NVDA' }), widgetSlotNode('chart', { symbol: 'NVDA' })]
      .map((n) => idOf(n.attrs)))
  })

  it('the editor insert command (the capture tray) puts one on the node, and edits keep it', () => {
    const ed = new Editor({ extensions: buildExtensions(),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note' }] }] } })
    try {
      ed.chain().focus('end').insertWidgetEmbed('chart', { symbol: 'AMD', tf: '15' },
        { capturedAt: '2026-09-01T14:00:00.000Z' }).run()
      ed.chain().focus('end').insertWidgetEmbed('chart', { symbol: 'AMD', tf: '15' },
        { capturedAt: '2026-09-01T14:00:00.000Z' }).run()
      const embeds = () => ed.getJSON().content.filter((n) => n.type === 'widgetEmbed')
      const ids = embeds().map((n) => n.attrs.embedId)
      distinct(ids)
      // Recapture / timeframe switch / freeze write through updateAttributes,
      // which MERGES: the node keeps its identity.
      let pos = null
      ed.state.doc.descendants((n, p) => { if (pos == null && n.type.name === 'widgetEmbed') pos = p })
      ed.chain().setNodeSelection(pos).updateAttributes('widgetEmbed', { fallback: null, frozen: true }).run()
      expect(embeds().map((n) => n.attrs.embedId)).toEqual(ids)
    } finally { ed.destroy() }
  })
})

describe('the id survives the schema and HTML; an embed without one is unchanged', () => {
  const exts = buildExtensions()
  const schema = getSchema(exts)
  const embed = (attrs) => ({ type: 'doc', content: [{ type: 'widgetEmbed', attrs }] })
  const base = { widgetId: 'chart', searchText: '[chart: NVDA D]', capturedAt: '2026-09-01T14:00:00.000Z' }

  it('copy/paste and the importer round-trip it through a data- attribute', () => {
    const html = generateHTML(embed({ ...base, embedId: 'e-1' }), exts)
    expect(html).toContain('data-embed-id="e-1"')
    const back = generateJSON(html, exts).content.find((n) => n.type === 'widgetEmbed')
    expect(back.attrs.embedId).toBe('e-1')
    expect(citationAtomIdentity(schema.nodeFromJSON(back))).toBe('e-1')
  })

  it('an old embed (stored JSON or HTML) has none, and keeps the widgetId|capturedAt identity', () => {
    const node = schema.nodeFromJSON({ type: 'widgetEmbed', attrs: base })
    expect(node.attrs.embedId).toBeNull()
    expect(citationAtomIdentity(node)).toBe('chart|2026-09-01T14:00:00.000Z')
    const html = generateHTML(embed(base), exts)
    expect(html).not.toContain('data-embed-id')
    const back = generateJSON(html, exts).content.find((n) => n.type === 'widgetEmbed')
    expect(back.attrs.embedId).toBeNull()
  })

  it('serverChange\'s merge key (frozen, F5) reads widgetId|capturedAt|searchText and never embedId', () => {
    const withId = { type: 'widgetEmbed', attrs: { ...base, embedId: 'e-1' } }
    const withOther = { type: 'widgetEmbed', attrs: { ...base, embedId: 'e-2' } }
    const without = { type: 'widgetEmbed', attrs: base }
    expect(nodeKeyOf(withId)).toBe(nodeKeyOf(without))
    expect(nodeKeyOf(withOther)).toBe(nodeKeyOf(without))
    // Control: the key DOES see an attr it reads, so the equality above is not vacuous.
    expect(nodeKeyOf({ type: 'widgetEmbed', attrs: { ...base, capturedAt: 'T2' } })).not.toBe(nodeKeyOf(without))
  })
})
