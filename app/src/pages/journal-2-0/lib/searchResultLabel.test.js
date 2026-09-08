// ⛔ THE DEFECT THESE PIN, measured on the real product 2026-09-08: a second
// passage captured from one Reuters article rendered in Search as
// "Reuters: NVDA margins · p.2". There is no page 2 — `page_number` on a web
// capture is a CAPTURE ORDINAL, and rendering it as a page asserts that a
// paginated document exists, which is a completeness claim Wave L deliberately
// refused to make about somebody else's content.
import { describe, it, expect } from 'vitest'
import {
  searchResultTitle, searchResultHint, sourceDomain,
  SOURCE_WEB, SOURCE_ATTACHMENT,
} from './searchResultLabel'

const WEB = {
  sourceKind: SOURCE_WEB, name: 'Reuters: NVDA margins',
  sourceUrl: 'https://www.reuters.com/markets/nvda-margins?utm_source=x',
  pageNumber: 2, noteTitle: 'NVDA research',
}
const PDF = {
  sourceKind: SOURCE_ATTACHMENT, name: 'NVDA 10-Q', pageNumber: 47,
  noteTitle: 'NVDA research',
}

describe('⛔⛔ a web capture is never labelled with a page number', () => {
  it('says what it is and where it came from', () => {
    const t = searchResultTitle(WEB, { kind: 'page' })
    expect(t).toContain('Captured passage')
    expect(t).toContain('reuters.com')
  })

  it('carries NO page anywhere in the label', () => {
    for (const kind of ['page', 'excerpt']) {
      const t = searchResultTitle(WEB, { kind })
      expect(t).not.toMatch(/\bp\.\s*\d/)
      expect(t).not.toMatch(/\bpage\b/i)
      // ⛔ Not the ordinal in ANY spelling — "capture 2" would be just as
      // meaningless to a member as "p.2", and twice as confusing.
      expect(t).not.toContain('2')
    }
  })

  it('the hover hint is the same truth, not a second story', () => {
    const h = searchResultHint(WEB, { kind: 'page' })
    expect(h).not.toMatch(/\bp\.\s*\d/)
    expect(h).toContain('NVDA research')
  })

  it('an excerpt kept from a web capture reads as a saved passage', () => {
    expect(searchResultTitle({ ...WEB, documentName: WEB.name, name: undefined },
      { kind: 'excerpt' })).toContain('Saved passage')
  })
})

describe('a real document keeps its page — that one IS a page', () => {
  it('renders name and page', () => {
    expect(searchResultTitle(PDF, { kind: 'page' })).toBe('NVDA 10-Q · p.47')
  })

  it('⭐ CONTROL: the probe can see a page when there should be one', () => {
    // Without this, the web assertions above could pass because the labeller
    // never emits a page for anything.
    expect(searchResultTitle(PDF, { kind: 'page' })).toMatch(/\bp\.\s*47\b/)
  })

  it('a document with no usable page number does not invent one', () => {
    expect(searchResultTitle({ ...PDF, pageNumber: 0 })).toBe('NVDA 10-Q')
    expect(searchResultTitle({ ...PDF, pageNumber: null })).toBe('NVDA 10-Q')
  })

  it('an unknown source kind is treated as a document, not as web', () => {
    // Fail toward the pre-existing behaviour: an old row with a NULL
    // source_kind is a PDF, and the server already coalesces to "attachment".
    expect(searchResultTitle({ name: 'X', pageNumber: 3 })).toBe('X · p.3')
  })
})

describe('the domain is a provenance line, not a URL dump', () => {
  it('strips scheme, www and tracking parameters', () => {
    expect(sourceDomain('https://www.reuters.com/a?utm_source=x')).toBe('reuters.com')
  })

  it('a malformed url degrades to nothing rather than throwing', () => {
    expect(sourceDomain('not a url')).toBe('')
    expect(sourceDomain(null)).toBe('')
    expect(searchResultTitle({ sourceKind: SOURCE_WEB })).toBe('Captured passage')
  })
})
