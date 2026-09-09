import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CapturedSourceSheet from './CapturedSourceSheet'
import { excerptRevisitTarget } from '../../lib/searchNavigation'

/**
 * Wave N §9 — revisiting a captured web passage.
 *
 * ⚰️ WHAT WAS LIVE. `handleOpenExcerptSource` gated on `attachmentUrl` alone,
 * and a captured web source HAS one — `web:<sha256>`, an identity string, not
 * a file — so clicking a captured Reuters paragraph in a thesis opened a
 * FULLSCREEN PDF VIEWER over a non-URL, with "Open in new tab" and "Download"
 * controls that could not work. §9 forbids a fake document viewer by name.
 */

const WEB = {
  id: 'ex-web', noteId: 'n1', documentId: 'd1', pageNumber: 1,
  attachmentUrl: 'web:24aaeedede6798bbaffd1030d900acec',
  documentName: 'Reuters: NVDA margins',
  sourceKind: 'web',
  sourceUrl: 'https://www.reuters.com/markets/nvda',
  capturedText: 'Gross margin normalizes toward the mid-70s next year.',
  annotation: 'I think management is too optimistic.',
}

const PDF = {
  id: 'ex-pdf', noteId: 'n1', documentId: 'd2', pageNumber: 47,
  attachmentUrl: '/api/j2/notes/attachments/u1/n1/file/abc.pdf',
  documentName: 'NVDA 10-Q',
  sourceKind: 'attachment',
  capturedText: 'Management expects margins to normalise.',
}

describe('the revisit decision', () => {
  it('⛔ sends a web capture to its captured-source view, NOT a document viewer', () => {
    expect(excerptRevisitTarget(WEB)).toEqual({ kind: 'captured_source', noteId: 'n1' })
  })

  it('⭐ still sends a real document excerpt to the viewer, at its real page', () => {
    // §8's control. Fixing the web path must not cost the Wave J path its page.
    const t = excerptRevisitTarget(PDF)
    expect(t.kind).toBe('document')
    expect(t.page).toBe(47)
    expect(t.href).toBe(PDF.attachmentUrl)
    expect(t.emphasizeExcerptId).toBe('ex-pdf')
  })

  it('refuses to guess when there is no source object at all', () => {
    expect(excerptRevisitTarget(null)).toBeNull()
    expect(excerptRevisitTarget({ id: 'x', noteId: 'n1' })).toBeNull()
  })

  it('⛔ the web decision does not depend on the page number being absent', () => {
    // A capture ordinal of 2 is still not a page. If this keyed on
    // `pageNumber` instead of `sourceKind`, a second passage from the same
    // article would open the fake viewer.
    expect(excerptRevisitTarget({ ...WEB, pageNumber: 2 }).kind).toBe('captured_source')
  })
})

describe('what the member sees instead', () => {
  const renderIt = (excerpt = WEB, props = {}) =>
    render(<CapturedSourceSheet open excerpt={excerpt} onClose={() => {}} {...props} />)

  it('shows the captured passage', () => {
    renderIt()
    expect(screen.getByText(/Gross margin normalizes toward the mid-70s/)).toBeInTheDocument()
  })

  it('⛔ keeps the member note SEPARATE from the quoted source (§7)', () => {
    renderIt()
    const quote = screen.getByText(/Gross margin normalizes toward the mid-70s/)
    expect(quote.textContent).not.toMatch(/too optimistic/)
    const mine = screen.getByText(/I think management is too optimistic/)
    expect(mine.textContent).not.toMatch(/Gross margin/)
    expect(screen.getByText('Your note')).toBeInTheDocument()
  })

  it('names the source and its domain', () => {
    renderIt()
    expect(screen.getByText('Reuters: NVDA margins')).toBeInTheDocument()
    expect(screen.getByText('reuters.com')).toBeInTheDocument()
  })

  it('⛔ never claims a page', () => {
    renderIt()
    expect(document.body.textContent).not.toMatch(/\bp\.\s?\d/)
  })

  it('⛔ offers no download of a thing that is not a document', () => {
    renderIt()
    expect(screen.queryByText(/Download/i)).toBeNull()
    expect(document.querySelector('[download]')).toBeNull()
  })

  it('⛔ says what it holds, so the quotation is not read as the article', () => {
    renderIt()
    expect(screen.getByText(/not the whole article/i)).toBeInTheDocument()
  })

  it('sends the member to the publisher for the rest — their click, their browser', () => {
    renderIt()
    const link = screen.getByRole('link', { name: /Open the source/i })
    expect(link).toHaveAttribute('href', 'https://www.reuters.com/markets/nvda')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toMatch(/noreferrer/)
  })

  it('offers the owning note only when it is somewhere else', () => {
    renderIt(WEB)
    expect(screen.queryByText(/Open the note it lives in/i)).toBeNull()
    renderIt(WEB, { onOpenOwningNote: () => {} })
    expect(screen.getByText(/Open the note it lives in/i)).toBeInTheDocument()
  })

  it('renders nothing at all without an excerpt', () => {
    const { container } = render(
      <CapturedSourceSheet open excerpt={null} onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
