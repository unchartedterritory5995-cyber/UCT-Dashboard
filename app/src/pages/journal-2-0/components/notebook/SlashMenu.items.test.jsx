// Slash-menu widget matching — the two-regime rail. This area regressed twice
// (prefix matching armed an Enter trap on prose; the exact-match fix then
// killed '/ch' discoverability, found by the owner on prod). Single token =
// prefix match (completion, nothing to eat); with args/prose = exact name.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { widgetItems, factItems } from './SlashMenu'

const titles = (q) => widgetItems(q).map((i) => i.title)

describe('slash widget items', () => {
  it('a partial single token discovers Chart (the /ch case from prod)', () => {
    expect(titles('ch')).toEqual(['Chart'])
    expect(titles('c')).toEqual(['Chart', 'Before / after'])   // 'compare' shares the prefix
    expect(titles('chart')).toEqual(['Chart'])
    expect(titles('')).toEqual(['Chart', 'MTF stack', 'Before / after'])
  })

  it('valid args produce the insert item', () => {
    expect(titles('chart NVDA 15m')).toEqual(['Chart — NVDA · 15m'])
    expect(titles('chart amd')).toEqual(['Chart — AMD · D'])
  })

  it('an optional date token anchors the insert and shows in the title', () => {
    expect(titles('chart NVDA 15m 3/13/2026')).toEqual(['Chart — NVDA · 15m @ Mar 13, 2026'])
    expect(titles('chart NVDA 2026-03-13')).toEqual(['Chart — NVDA · D @ Mar 13, 2026'])
    expect(titles('chart NVDA 15m notaday')).toEqual([])
    // The inserted node carries the day as its anchor (params.to), not the
    // insert moment. (Wire: the shared chartInsertNodes builder →
    // insertContent — the same payload the widget palette inserts.)
    let captured = null
    const chain = {
      focus: () => chain, deleteRange: () => chain,
      insertContent: (nodes) => { captured = nodes; return chain },
      caretAfterWidgetEmbed: () => chain,
      run: () => {},
    }
    widgetItems('chart NVDA 15m 3/13/2026')[0]
      .command({ editor: { chain: () => chain, storage: {} }, range: {} })
    expect(captured).toHaveLength(1)
    expect(captured[0].type).toBe('widgetEmbed')
    expect(captured[0].attrs.widgetId).toBe('chart')
    expect(captured[0].attrs.params).toMatchObject({ symbol: 'NVDA', tf: '15', to: '2026-03-13' })
  })

  it('prose after the name offers NOTHING — Enter must stay a newline', () => {
    expect(titles('chart looks great here')).toEqual([])
    expect(titles('chart AMD notatf')).toEqual([])
    // Prefix + args never matches (the original Enter-trap shape).
    expect(titles('ch NVDA')).toEqual([])
    expect(titles('c looks')).toEqual([])
  })

  it('unrelated tokens match nothing', () => {
    expect(titles('head')).toEqual([])
    expect(titles('xyz')).toEqual([])
  })
})

describe('composition presets (/mtf, /compare)', () => {
  it('single-token discovery + bare-name hints', () => {
    expect(titles('m')).toEqual(['MTF stack'])
    expect(titles('mtf')).toEqual(['MTF stack'])
    expect(titles('comp')).toEqual(['Before / after'])
  })

  it('valid args produce one-action multi-insert items', () => {
    expect(titles('mtf AMD')).toEqual(['MTF stack — AMD · D / 1h / 15m'])
    expect(titles('compare NVDA 2026-03-13')).toEqual(['Before / after — NVDA @ Mar 13, 2026'])
    expect(titles('compare nvda 3/13/2026')).toEqual(['Before / after — NVDA @ Mar 13, 2026'])
    // Optional tf: compare at execution granularity (panel batch 3).
    expect(titles('compare nvda 3/13/2026 15m')).toEqual(['Before / after — NVDA @ Mar 13, 2026 · 15m'])
  })

  it('the strictness contract holds — prose parses as NOTHING', () => {
    expect(titles('mtf looks great here')).toEqual([])
    expect(titles('mtf AMD NVDA')).toEqual([])
    expect(titles('compare AMD notadate')).toEqual([])
    expect(titles('compare AMD')).toEqual([])
    expect(titles('m AMD')).toEqual([])                        // prefix + args never matches
  })

  it('/mtf inserts three chart nodes sharing the symbol; /compare a half-width pair', () => {
    const insertedBy = (q) => {
      let captured = null
      const chain = {
        focus: () => chain, deleteRange: () => chain,
        insertContent: (c) => { captured = c; return chain },
        insertWidgetEmbed: () => chain,
        // The new NodeSelection-exit rail (widgetEmbedInsert.test.jsx owns
        // its behavior); the SlashMenu paths chain it after the insert.
        caretAfterWidgetEmbed: () => chain,
        run: () => {},
      }
      widgetItems(q)[0].command({ editor: { chain: () => chain }, range: {} })
      return captured
    }
    const stack = insertedBy('mtf AMD')
    expect(stack.map((n) => n.type)).toEqual(['widgetEmbed', 'widgetEmbed', 'widgetEmbed'])
    expect(stack.map((n) => n.attrs.params.tf)).toEqual(['D', '60', '15'])
    // Frozen means anchored: preset inserts stamp the insert moment.
    for (const n of stack) expect(Number.isFinite(Number(n.attrs.params.to))).toBe(true)
    expect(new Set(stack.map((n) => n.attrs.params.symbol))).toEqual(new Set(['AMD']))

    // An explicit day anchors the whole stack at that date instead.
    expect(titles('mtf AMD 3/13/2026')).toEqual(['MTF stack — AMD · D / 1h / 15m @ Mar 13, 2026'])
    const anchored = insertedBy('mtf AMD 3/13/2026')
    expect(anchored.map((n) => n.attrs.params.to)).toEqual(['2026-03-13', '2026-03-13', '2026-03-13'])

    const pair = insertedBy('compare AMD 3/13/2026')
    expect(pair).toHaveLength(2)
    expect(pair.map((n) => n.attrs.layout.width)).toEqual(['half', 'half'])
    expect(pair[0].attrs.params.to).toBeTruthy()               // before: window ends that day
    expect(pair[1].attrs.params.to == null).toBe(true)         // after: the explicit rolling opt-out
    expect(pair[0].attrs.caption).toBe('before · 2026-03-13')

    // The optional tf reaches BOTH halves.
    const pair15 = insertedBy('compare AMD 3/13/2026 15m')
    expect(pair15.map((n) => n.attrs.params.tf)).toEqual(['15', '15'])
  })
})

describe('/price (Wave F financial fact capture)', () => {
  const factTitles = (q) => factItems(q).map((i) => i.title)

  it('single-token discovery + bare-name hint', () => {
    expect(factTitles('p')).toEqual(['Price'])
    expect(factTitles('price')).toEqual(['Price'])
    expect(factTitles('')).toEqual(['Price'])
  })

  it('a valid symbol produces the capture item', () => {
    expect(factTitles('price NVDA')).toEqual(['Price — NVDA'])
    expect(factTitles('price amd')).toEqual(['Price — AMD'])
  })

  it('prose or multiple tokens after the name match nothing', () => {
    expect(factTitles('price looks great here')).toEqual([])
    expect(factTitles('price NVDA AMD')).toEqual([])
    expect(factTitles('pr NVDA')).toEqual([])  // prefix + args never matches
  })

  it('unrelated tokens match nothing', () => {
    expect(factTitles('chart')).toEqual([])
    expect(factTitles('xyz')).toEqual([])
  })

  const realFetch = global.fetch
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { global.fetch = realFetch })

  function makeChain(box) {
    const chain = {
      focus: () => chain, deleteRange: () => chain,
      insertContent: (c) => { box.inserted = c; return chain },
      run: () => {},
    }
    return chain
  }

  it('on success, POSTs the capture and inserts a financialFact node with the returned id', async () => {
    global.fetch.mockResolvedValue({
      ok: true, json: async () => ({ fact: { id: 'fact-123' } }),
    })
    const box = { inserted: null }
    const chain = makeChain(box)
    const editor = { chain: () => chain, storage: { uctJournalWidgets: { noteId: 'note-1' } } }
    await factItems('price NVDA')[0].command({ editor, range: {} })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/notes/note-1/facts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ticker: 'NVDA', factType: 'price' }),
    }))
    expect(box.inserted).toEqual({ type: 'financialFact', attrs: { factId: 'fact-123' } })
  })

  it('on a failed capture, inserts nothing (never a broken/partial node)', async () => {
    global.fetch.mockResolvedValue({ ok: false })
    const box = { inserted: null }
    const chain = makeChain(box)
    const editor = { chain: () => chain, storage: { uctJournalWidgets: { noteId: 'note-1' } } }
    await factItems('price NVDA')[0].command({ editor, range: {} })
    expect(box.inserted).toBeNull()
  })

  it('a network error never throws onto the caller and inserts nothing', async () => {
    global.fetch.mockRejectedValue(new Error('network down'))
    const box = { inserted: null }
    const chain = makeChain(box)
    const editor = { chain: () => chain, storage: { uctJournalWidgets: { noteId: 'note-1' } } }
    await expect(factItems('price NVDA')[0].command({ editor, range: {} })).resolves.toBeUndefined()
    expect(box.inserted).toBeNull()
  })

  it('with no noteId on editor storage, never calls fetch at all', async () => {
    const chain = makeChain({ inserted: null })
    const editor = { chain: () => chain, storage: {} }
    await factItems('price NVDA')[0].command({ editor, range: {} })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
