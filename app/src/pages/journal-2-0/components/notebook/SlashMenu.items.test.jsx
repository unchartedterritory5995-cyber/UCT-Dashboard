// Slash-menu widget matching — the two-regime rail. This area regressed twice
// (prefix matching armed an Enter trap on prose; the exact-match fix then
// killed '/ch' discoverability, found by the owner on prod). Single token =
// prefix match (completion, nothing to eat); with args/prose = exact name.
import { describe, it, expect } from 'vitest'
import { widgetItems } from './SlashMenu'

const titles = (q) => widgetItems(q).map((i) => i.title)

describe('slash widget items', () => {
  it('a partial single token discovers Chart (the /ch case from prod)', () => {
    expect(titles('ch')).toEqual(['Chart'])
    expect(titles('c')).toEqual(['Chart', 'Before / after'])   // 'compare' shares the prefix
    expect(titles('chart')).toEqual(['Chart'])
    expect(titles('')).toEqual(['Chart', 'MTF stack', 'Before / after'])
  })

  it('valid args produce the insert item', () => {
    expect(titles('chart NVDA 15m')).toEqual(['Chart — NVDA · 15'])
    expect(titles('chart amd')).toEqual(['Chart — AMD · D'])
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
    expect(titles('compare NVDA 2026-03-13')).toEqual(['Before / after — NVDA @ 2026-03-13'])
    expect(titles('compare nvda 3/13/2026')).toEqual(['Before / after — NVDA @ 2026-03-13'])
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
        insertWidgetEmbed: () => chain, run: () => {},
      }
      widgetItems(q)[0].command({ editor: { chain: () => chain }, range: {} })
      return captured
    }
    const stack = insertedBy('mtf AMD')
    expect(stack.map((n) => n.type)).toEqual(['widgetEmbed', 'widgetEmbed', 'widgetEmbed'])
    expect(stack.map((n) => n.attrs.params.tf)).toEqual(['D', '60', '15'])
    expect(new Set(stack.map((n) => n.attrs.params.symbol))).toEqual(new Set(['AMD']))

    const pair = insertedBy('compare AMD 3/13/2026')
    expect(pair).toHaveLength(2)
    expect(pair.map((n) => n.attrs.layout.width)).toEqual(['half', 'half'])
    expect(pair[0].attrs.params.to).toBeTruthy()               // before: window ends that day
    expect(pair[1].attrs.params.to).toBeUndefined()            // after: current window
    expect(pair[0].attrs.caption).toBe('before · 2026-03-13')
  })
})
