// app/src/components/chart/engine/defSchema.tour.test.js
//
// ─── UCT RS Phase 4, unit 4-03 · `meta.tour` and `meta.searchHint` ──────────
//
// Both fields are BEHAVIOURAL meta: a tour card renders in a fixed-width popover
// and a hint query is compared to a whole search. So both are validated
// fail-closed at registration, and every refusal names the field.
import { describe, it, expect } from 'vitest'
import {
  validateDefinition, normalizeHintQuery,
  TOUR_MAX_CARDS, TOUR_TITLE_MAX, TOUR_BODY_MAX, SEARCH_HINT_LINE_MAX, SEARCH_HINT_CTA_MAX, GLOSSARY_HREF_MAX,
} from './defSchema'
import { getDefinition } from './nativeRegistry'
import { tourProbeRaw, TOUR } from '../__tests__/tourProbe.fixture'

const accept = (meta) => {
  const r = validateDefinition(tourProbeRaw(meta))
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.def
}
const refuse = (meta) => {
  const r = validateDefinition(tourProbeRaw(meta))
  expect(r.ok, 'expected a refusal').toBe(false)
  return r.errors.join('\n')
}
const card = (title = 'A title', body = 'A body.') => ({ title, body })

describe('meta.tour', () => {
  it('accepts 1 to 6 cards and carries them onto the registered definition', () => {
    expect(accept({}).meta.tour).toEqual(TOUR)
    expect(accept({ tour: [card()] }).meta.tour).toHaveLength(1)
    const six = Array.from({ length: TOUR_MAX_CARDS }, (_, i) => card(`Card ${i + 1}`))
    expect(accept({ tour: six }).meta.tour).toHaveLength(6)
    // absent (or null) means "no tour", never an error
    expect(accept({ tour: undefined }).meta.tour).toBeUndefined()
    expect(validateDefinition(tourProbeRaw({ tour: null })).ok).toBe(true)
  })

  it('refuses too many cards, and none', () => {
    const seven = Array.from({ length: TOUR_MAX_CARDS + 1 }, () => card())
    expect(refuse({ tour: seven })).toMatch(/meta\.tour: 7 cards — at most 6/)
    expect(refuse({ tour: [] })).toMatch(/meta\.tour: expected at least one card/)
    expect(refuse({ tour: 'cards' })).toMatch(/meta\.tour: expected an array/)
  })

  it('refuses a title over 60 characters and a body over 240, at the limit accepted', () => {
    expect(accept({ tour: [card('x'.repeat(TOUR_TITLE_MAX), 'y'.repeat(TOUR_BODY_MAX))] })).toBeTruthy()
    expect(refuse({ tour: [card('x'.repeat(TOUR_TITLE_MAX + 1))] }))
      .toMatch(/meta\.tour\[0\]\.title: 61 characters — at most 60/)
    expect(refuse({ tour: [card(), card('ok', 'y'.repeat(TOUR_BODY_MAX + 1))] }))
      .toMatch(/meta\.tour\[1\]\.body: 241 characters — at most 240/)
  })

  it('refuses an empty title or body, a non-object card and an unknown field', () => {
    expect(refuse({ tour: [card('  ')] })).toMatch(/meta\.tour\[0\]\.title: required non-empty string/)
    expect(refuse({ tour: [{ title: 'T' }] })).toMatch(/meta\.tour\[0\]\.body: required non-empty string/)
    expect(refuse({ tour: ['T'] })).toMatch(/meta\.tour\[0\]: expected an object/)
    expect(refuse({ tour: [{ ...card(), image: 'x.png' }] })).toMatch(/meta\.tour\[0\]\.image: unknown tour card field/)
  })
})

describe('meta.searchHint', () => {
  const hint = (extra) => ({ queries: ['rsi'], line: 'Try this one.', ...extra })

  it('accepts lower-case queries, a line and an optional cta', () => {
    expect(accept({}).meta.searchHint).toEqual({ queries: ['rsi', 'relative strength index'], line: expect.any(String) })
    expect(accept({ searchHint: hint({ cta: 'Add it' }) }).meta.searchHint.cta).toBe('Add it')
  })

  it('refuses a query that is not lower-case and trimmed — it could never equal a search', () => {
    expect(refuse({ searchHint: hint({ queries: ['RSI'] }) }))
      .toMatch(/meta\.searchHint\.queries\[0\]: "?RSI"? must be lower-case and trimmed/)
    expect(refuse({ searchHint: hint({ queries: [' rsi'] }) })).toMatch(/queries\[0\].*must be lower-case and trimmed/)
    expect(refuse({ searchHint: hint({ queries: ['relative  strength'] }) })).toMatch(/queries\[0\].*single spaces/)
  })

  it('refuses no queries, an empty or duplicate query', () => {
    expect(refuse({ searchHint: hint({ queries: [] }) })).toMatch(/meta\.searchHint\.queries: expected a non-empty array/)
    expect(refuse({ searchHint: hint({ queries: 'rsi' }) })).toMatch(/meta\.searchHint\.queries: expected a non-empty array/)
    expect(refuse({ searchHint: hint({ queries: ['rsi', ''] }) })).toMatch(/queries\[1\]: required non-empty string/)
    expect(refuse({ searchHint: hint({ queries: ['rsi', 'rsi'] }) })).toMatch(/queries\[1\]: duplicate query/)
  })

  it('refuses an empty line, a long line, a bad cta and an unknown field', () => {
    expect(refuse({ searchHint: hint({ line: '' }) })).toMatch(/meta\.searchHint\.line: required non-empty string/)
    expect(refuse({ searchHint: hint({ line: undefined }) })).toMatch(/meta\.searchHint\.line: required non-empty string/)
    expect(refuse({ searchHint: hint({ line: 'x'.repeat(SEARCH_HINT_LINE_MAX + 1) }) }))
      .toMatch(/meta\.searchHint\.line: 161 characters — at most 160/)
    expect(refuse({ searchHint: hint({ cta: '' }) })).toMatch(/meta\.searchHint\.cta: expected a non-empty string/)
    expect(refuse({ searchHint: hint({ cta: 'x'.repeat(SEARCH_HINT_CTA_MAX + 1) }) })).toMatch(/cta: 41 characters/)
    expect(refuse({ searchHint: hint({ match: 'prefix' }) })).toMatch(/meta\.searchHint\.match: unknown search hint field/)
    expect(refuse({ searchHint: ['rsi'] })).toMatch(/meta\.searchHint: expected an object/)
  })
})

describe('normalizeHintQuery — the one form a search is compared in', () => {
  it('trims, lower-cases and collapses inner whitespace; nothing else', () => {
    expect(normalizeHintQuery('  RSI ')).toBe('rsi')
    expect(normalizeHintQuery('Relative   Strength\tIndex')).toBe('relative strength index')
    expect(normalizeHintQuery('rsi divergence')).toBe('rsi divergence')
    expect(normalizeHintQuery(null)).toBe('')
  })
})

// ─── unit 4-05 · `meta.glossaryHref`, the About page's Glossary link ─────────
describe('meta.glossaryHref', () => {
  it('accepts an in-app path (with an optional #anchor), and absent or null', () => {
    expect(accept({ glossaryHref: '/methodology/relative-strength' }).meta.glossaryHref).toBe('/methodology/relative-strength')
    expect(accept({ glossaryHref: '/methodology/relative-strength#rs-line' }).meta.glossaryHref)
      .toBe('/methodology/relative-strength#rs-line')
    expect(accept({}).meta.glossaryHref).toBeUndefined()
    expect(validateDefinition(tourProbeRaw({ glossaryHref: null })).ok).toBe(true)
  })

  it('refuses anything that could leave the site, and junk', () => {
    for (const bad of ['https://example.com/x', '//example.com/x', 'methodology/rs', '/a b', '/a//b',
      'javascript:alert(1)', '/a?b=1']) {
      expect(refuse({ glossaryHref: bad }), bad).toMatch(/meta\.glossaryHref: .* is not an in-app path/)
    }
    expect(refuse({ glossaryHref: '' })).toMatch(/meta\.glossaryHref: expected an in-app path string/)
    expect(refuse({ glossaryHref: 42 })).toMatch(/meta\.glossaryHref: expected an in-app path string/)
    expect(refuse({ glossaryHref: `/${'a'.repeat(GLOSSARY_HREF_MAX)}` })).toMatch(/at most 120/)
  })

  it('the shipped UCT RS declares the public glossary page', () => {
    expect(getDefinition('rsLine').meta.glossaryHref).toBe('/methodology/relative-strength')
  })
})
