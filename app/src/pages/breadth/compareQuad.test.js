/**
 * What a legal quad is — pure, so the ruling is testable without a grid.
 *
 * The load-bearing property here is DISTINCTNESS. It is what makes duplicate
 * test ids impossible when four views share one document, so it is asserted
 * directly rather than inferred from a rendered grid.
 */
import { describe, it, expect } from 'vitest'
import {
  COMPARE_PANES, LAYOUTS, DEFAULT_LAYOUT, defaultQuad, normalizeQuad, pickIntoQuad, isStyleKey,
} from './compareQuad'
import { STYLES, VIEW_CONFIG } from './views/viewMetricConfig'

describe('the default quad is derived from the registry', () => {
  it('is four distinct registered styles', () => {
    const q = defaultQuad()
    expect(q).toHaveLength(COMPARE_PANES)
    expect(new Set(q).size).toBe(COMPARE_PANES)
    for (const s of q) expect(STYLES).toContain(s)
  })

  it('opens on lenses, in registry order — not a hand-typed roster', () => {
    const lenses = STYLES.filter(s => VIEW_CONFIG[s].kind === 'lens')
    expect(lenses.length).toBeGreaterThanOrEqual(COMPARE_PANES)   // else the top-up path
    expect(defaultQuad()).toEqual(lenses.slice(0, COMPARE_PANES))
  })

  it('names the two layouts and starts in single', () => {
    expect(LAYOUTS).toEqual(['single', 'compare'])
    expect(DEFAULT_LAYOUT).toBe('single')
  })
})

describe('normalizeQuad coerces anything into a legal quad', () => {
  it('keeps a good quad as it is', () => {
    expect(normalizeQuad(['clock', 'divergence', 'events', 'analogues']))
      .toEqual(['clock', 'divergence', 'events', 'analogues'])
  })

  it('IGNORES an unknown style key rather than throwing the quad away', () => {
    const q = normalizeQuad(['clock', 'bogus', 'events'])
    expect(q).toHaveLength(COMPARE_PANES)
    expect(q.slice(0, 2)).toEqual(['clock', 'events'])   // order of the survivors kept
    expect(q).not.toContain('bogus')
  })

  it('collapses a duplicate and tops the quad back up', () => {
    const q = normalizeQuad(['clock', 'clock', 'clock', 'clock'])
    expect(q[0]).toBe('clock')
    expect(new Set(q).size).toBe(COMPARE_PANES)
  })

  it('truncates a list longer than the grid', () => {
    expect(normalizeQuad(STYLES)).toEqual(STYLES.slice(0, COMPARE_PANES))
  })

  it('trims whitespace, because a URL is typed by people', () => {
    expect(normalizeQuad([' clock ', 'divergence'])[0]).toBe('clock')
  })

  it('returns null — not a default — when NOTHING was recognisable', () => {
    // The caller needs to tell "no compare state" from "a compare state with a
    // bad name in it": the first falls back to Single, the second does not.
    expect(normalizeQuad([])).toBeNull()
    expect(normalizeQuad(['bogus', 'nonsense'])).toBeNull()
    expect(normalizeQuad(null)).toBeNull()
    expect(normalizeQuad('clock')).toBeNull()          // a string is not a list
  })

  it('never returns a quad with a repeat, for any input', () => {
    for (const bad of [['clock', 'clock'], ['events', 'events', 'events'],
      ['ribbon', 'ribbon', 'clock', 'clock'], ['tug'], ['x', 'radar', 'radar']]) {
      const q = normalizeQuad(bad)
      if (q) expect(new Set(q).size, JSON.stringify(bad)).toBe(COMPARE_PANES)
    }
  })
})

describe('picking a style into a pane', () => {
  const quad = ['clock', 'divergence', 'events', 'analogues']

  it('replaces a pane with a style not already shown', () => {
    expect(pickIntoQuad(quad, 1, 'ribbon')).toEqual(['clock', 'ribbon', 'events', 'analogues'])
  })

  it('SWAPS when the style is already on screen — never duplicates it', () => {
    // The displaced style is still visible; it moved, it was not dropped.
    expect(pickIntoQuad(quad, 0, 'events')).toEqual(['events', 'divergence', 'clock', 'analogues'])
  })

  it('is a no-op for the pane that already shows it, an unknown key, or a bad index', () => {
    expect(pickIntoQuad(quad, 2, 'events')).toBe(quad)
    expect(pickIntoQuad(quad, 0, 'bogus')).toBe(quad)
    expect(pickIntoQuad(quad, 9, 'ribbon')).toBe(quad)
    expect(pickIntoQuad(quad, -1, 'ribbon')).toBe(quad)
  })

  it('leaves the quad distinct after any pick of any style into any pane', () => {
    for (let i = 0; i < COMPARE_PANES; i++) {
      for (const s of STYLES) {
        const next = pickIntoQuad(quad, i, s)
        expect(new Set(next).size, `${s} → pane ${i}`).toBe(COMPARE_PANES)
        expect(next[i]).toBe(s)
      }
    }
  })

  it('never mutates the quad it was given', () => {
    const before = [...quad]
    pickIntoQuad(quad, 0, 'ribbon')
    expect(quad).toEqual(before)
  })
})

describe('isStyleKey reads the registry', () => {
  it('accepts every registered style and nothing else', () => {
    for (const s of STYLES) expect(isStyleKey(s)).toBe(true)
    for (const bad of ['', 'CLOCK', 'clock ', null, 7, {}]) expect(isStyleKey(bad)).toBe(false)
  })
})
