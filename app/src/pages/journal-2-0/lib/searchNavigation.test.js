// ⛔⛔ SEARCH RESULT IDENTITY MUST MATCH SEARCH RESULT DESTINATION (Wave M §4).
//
// ⚰️ Every section — note, document page, saved excerpt — ended at
// `onOpenNote({ id: noteId })`. Search could correctly say "NVDA 10-Q · p.47"
// and then drop the member at the top of a note. A result that names one thing
// and navigates to another is only half a retrieval system.
//
// ⛔ §6 IS EXPLICIT THAT CARRYING THE FIELDS IS NOT THE TEST. It is not enough
// that a row HAS documentId/pageNumber — the member action has to arrive
// somewhere. So these assert the TARGET, and the component rails beside them
// assert the click produces it; the mutation that replaces page navigation with
// a bare note open is what proves they can fail.
import { describe, it, expect } from 'vitest'
import {
  navigationDepth, searchResultTarget, applyTargetToParams, targetFromParams,
} from './searchNavigation'

const PDF_PAGE = {
  noteId: 'n1', documentId: 'd1', pageNumber: 47,
  sourceKind: 'attachment', name: 'NVDA 10-Q',
}
const PDF_EXCERPT = {
  noteId: 'n1', documentId: 'd1', pageNumber: 47, excerptId: 'x1',
  sourceKind: 'attachment', documentName: 'NVDA 10-Q',
}
const WEB = {
  noteId: 'n1', documentId: 'd2', pageNumber: 2,
  sourceKind: 'web', name: 'Reuters: NVDA margins',
  sourceUrl: 'https://www.reuters.com/markets/nvda',
}

describe('how deep can we truthfully go', () => {
  it('a real document page reaches the page', () => {
    expect(navigationDepth(PDF_PAGE, { kind: 'page' })).toBe('page')
    expect(searchResultTarget(PDF_PAGE, { kind: 'page' }))
      .toEqual({ noteId: 'n1', documentId: 'd1', page: 47, depth: 'page' })
  })

  it('a saved excerpt reaches the excerpt', () => {
    const t = searchResultTarget(PDF_EXCERPT, { kind: 'excerpt' })
    expect(t.depth).toBe('excerpt')
    expect(t.excerptId).toBe('x1')
    expect(t.page).toBe(47)
  })

  it('⛔ a WEB capture reaches only the note — and does not pretend otherwise', () => {
    // Its attachment_url is `web:<sha256>`, an identity string rather than a
    // file, and nothing in the product renders one. Inventing a page anchor
    // here would be the navigation twin of the "· p.2" label defect.
    expect(navigationDepth(WEB, { kind: 'page' })).toBe('note')
    const t = searchResultTarget(WEB, { kind: 'page' })
    expect(t).toEqual({ noteId: 'n1', depth: 'note' })
    expect(t.page).toBeUndefined()
    expect(t.documentId).toBeUndefined()
  })

  it('⛔ …even when it arrives as an EXCERPT row', () => {
    expect(navigationDepth({ ...WEB, excerptId: 'x9' }, { kind: 'excerpt' })).toBe('note')
  })

  it('a row with no note is not navigable at all', () => {
    expect(searchResultTarget({ documentId: 'd1', pageNumber: 3 })).toBeNull()
  })

  it('a document with no usable page falls back to the note', () => {
    expect(navigationDepth({ noteId: 'n1', documentId: 'd1', pageNumber: 0,
                             sourceKind: 'attachment' })).toBe('note')
  })
})

describe('the target rides the routing the app already uses', () => {
  it('folds into ?note=&doc=&page=', () => {
    const p = applyTargetToParams(new URLSearchParams('note=old'),
                                  searchResultTarget(PDF_PAGE, { kind: 'page' }))
    expect(p.get('note')).toBe('n1')
    expect(p.get('doc')).toBe('d1')
    expect(p.get('page')).toBe('47')
  })

  it('⛔ a second search click cannot inherit the previous hit’s page', () => {
    // The bug this prevents: click a PDF page hit, then click a web hit, and
    // the stale `page=47` reopens the previous document.
    const first = applyTargetToParams(new URLSearchParams(),
                                      searchResultTarget(PDF_PAGE, { kind: 'page' }))
    const second = applyTargetToParams(first, searchResultTarget(WEB, { kind: 'page' }))
    expect(second.get('note')).toBe('n1')
    expect(second.get('doc')).toBeNull()
    expect(second.get('page')).toBeNull()
    expect(second.get('excerpt')).toBeNull()
  })

  it('round-trips back out for the editor to act on', () => {
    const p = applyTargetToParams(new URLSearchParams(),
                                  searchResultTarget(PDF_EXCERPT, { kind: 'excerpt' }))
    expect(targetFromParams(p)).toEqual({ documentId: 'd1', page: 47, excerptId: 'x1' })
  })

  it('no document target reads back as nothing to do', () => {
    expect(targetFromParams(new URLSearchParams('note=n1'))).toBeNull()
  })
})
