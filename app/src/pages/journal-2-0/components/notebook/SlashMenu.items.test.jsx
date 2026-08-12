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
    expect(titles('c')).toEqual(['Chart'])
    expect(titles('chart')).toEqual(['Chart'])
    expect(titles('')).toEqual(['Chart'])
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
