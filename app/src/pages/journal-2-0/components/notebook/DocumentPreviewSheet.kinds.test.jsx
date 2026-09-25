import { createRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentPreviewSheet from './DocumentPreviewSheet'
import TextPagesViewer from './TextPagesViewer'
import {
  DOCUMENT_KIND_DOCX, DOCUMENT_KIND_IMAGE, DOCUMENT_KIND_PDF,
  documentKindFromHref, parseAttachmentHref,
} from './documentKind'

// Wave 7 lane G (G4) — the preview sheet branches on what the document IS.
//
// ⛔ THE PDF RAIL COMES FIRST. The mounts pass no kind and are unchanged, so the
// one way this lane could hurt every existing member is by routing a PDF away
// from PdfDocumentViewer. It is mocked exactly as DocumentPreviewSheet.test.jsx
// mocks it (jsdom cannot run pdfjs), which makes "the stub rendered" the proof
// that the real viewer would have.

const PDF = '/api/j2/notes/attachments/u1/n1/file/abc123.pdf'
const IMG = '/api/j2/notes/attachments/u1/n1/inline/0123456789abcdef0123456789abcdef.png'
const DOCX = '/api/j2/notes/attachments/u1/n1/file/fedcba9876543210.docx'

vi.mock('./PdfDocumentViewer', () => ({
  default: () => <div data-testid="pdf-viewer-stub" />,
}))

function row(overrides) {
  return {
    id: 'd1', attachmentUrl: IMG, name: 'Image', status: 'ready', pageCount: 1,
    pagesTotal: 1, pagesWithText: 1, pagesFromOcr: 1, ocrUnavailable: false,
    sourceKind: 'attachment', ...overrides,
  }
}

/** A fetch that answers the documents list and per-page text from tables. */
function serve({ docs, pages = {} }) {
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.startsWith('/api/j2/notes/n1/documents')) {
      return { ok: true, status: 200, json: async () => ({ documents: docs }) }
    }
    const m = /\/api\/j2\/notes\/documents\/([^/]+)\/pages\/(\d+)\/text$/.exec(u)
    if (m) {
      const text = pages[Number(m[2])]
      if (text === undefined) return { ok: false, status: 404, json: async () => ({}) }
      return {
        ok: true, status: 200,
        json: async () => ({ documentId: m[1], pageNumber: Number(m[2]), text, available: !!text.trim(), textOrigin: 'native' }),
      }
    }
    return { ok: false, status: 500, json: async () => ({}) }
  })
}

const realFetch = global.fetch
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { global.fetch = realFetch })

describe('documentKind — the viewer is read from the URL the server wrote', () => {
  it('names each kind, and defaults to the PDF viewer for anything it cannot identify', () => {
    expect(documentKindFromHref(PDF)).toBe(DOCUMENT_KIND_PDF)
    expect(documentKindFromHref(IMG)).toBe(DOCUMENT_KIND_IMAGE)
    expect(documentKindFromHref(IMG.replace('.png', '.JPG'))).toBe(DOCUMENT_KIND_IMAGE)
    expect(documentKindFromHref(DOCX)).toBe(DOCUMENT_KIND_DOCX)
    // a PDF saved without a known extension is still a PDF, as it always was
    expect(documentKindFromHref('/api/j2/notes/attachments/u1/n1/file/x.bin')).toBe(DOCUMENT_KIND_PDF)
    // an image extension under file/ is not an image document (only /inline/ ones are)
    expect(documentKindFromHref('/api/j2/notes/attachments/u1/n1/file/x.png')).toBe(DOCUMENT_KIND_PDF)
    expect(documentKindFromHref('web:abc')).toBe(DOCUMENT_KIND_PDF)
    expect(documentKindFromHref(null)).toBe(DOCUMENT_KIND_PDF)
  })

  it('parses the note id out of the attachment URL', () => {
    expect(parseAttachmentHref(DOCX)).toEqual({
      userId: 'u1', noteId: 'n1', sub: 'file', filename: 'fedcba9876543210.docx',
    })
    expect(parseAttachmentHref('/elsewhere/x.docx')).toBeNull()
  })
})

describe('DocumentPreviewSheet — PDF is unchanged', () => {
  it('a PDF row still mounts PdfDocumentViewer, and neither new viewer', async () => {
    global.fetch = vi.fn()
    render(<DocumentPreviewSheet open href={PDF} name="report.pdf" documentId="d9" onClose={vi.fn()} />)
    expect(await screen.findByTestId('pdf-viewer-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('image-document-viewer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('text-pages-viewer')).not.toBeInTheDocument()
    // the PDF path fetches nothing of this lane's
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/documents'), expect.anything())
  })
})

describe('DocumentPreviewSheet — an image document', () => {
  it('shows the image itself and, beside it, the text read from it', async () => {
    serve({ docs: [row()], pages: { 1: 'Q3 revenue $9,242\nmargin 51%' } })
    render(<DocumentPreviewSheet open href={IMG} name="Image" documentId="d1" onClose={vi.fn()} />)
    const img = screen.getByRole('img', { name: 'Attached image' })
    expect(img.getAttribute('src')).toBe(IMG)
    expect(await screen.findByTestId('image-document-text')).toHaveTextContent('Q3 revenue $9,242')
    expect(screen.getByText('Read from the image — check exact figures against the image itself.'))
      .toBeInTheDocument()
    expect(screen.queryByTestId('pdf-viewer-stub')).not.toBeInTheDocument()
  })

  it('says it is still reading while OCR owes the page, and offers to check again', async () => {
    serve({ docs: [row({ status: 'pending', pagesWithText: 0, pagesFromOcr: 0 })] })
    render(<DocumentPreviewSheet open href={IMG} documentId="d1" onClose={vi.fn()} />)
    expect(await screen.findByText('Reading the text in this image. This can take a moment.'))
      .toBeInTheDocument()
    serve({ docs: [row()], pages: { 1: 'now it is read' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByTestId('image-document-text')).toHaveTextContent('now it is read')
  })

  it('tells the truth when no engine can read it, and when nothing was readable', async () => {
    serve({ docs: [row({ status: 'pending', ocrUnavailable: true, pagesWithText: 0 })] })
    const { unmount } = render(<DocumentPreviewSheet open href={IMG} documentId="d1" onClose={vi.fn()} />)
    expect(await screen.findByText(/Text reading isn’t available right now/)).toBeInTheDocument()
    unmount()
    serve({ docs: [row({ status: 'no_text', pagesWithText: 0 })], pages: { 1: '' } })
    render(<DocumentPreviewSheet open href={IMG} documentId="d1" onClose={vi.fn()} />)
    expect(await screen.findByText('No text could be read from this image.')).toBeInTheDocument()
  })
})

describe('DocumentPreviewSheet — a .docx document', () => {
  const docxRow = row({ id: 'dx', attachmentUrl: DOCX, name: 'memo.docx', pageCount: 3,
                        pagesTotal: 3, pagesWithText: 3, pagesFromOcr: 0 })
  const pages = { 1: 'Page one words', 2: 'Page two\tcolumn', 3: 'Page three words' }

  it('opens as page-numbered text on the page the search hit named, and pages through it', async () => {
    serve({ docs: [docxRow], pages })
    render(<DocumentPreviewSheet open href={DOCX} name="memo.docx" page={2} documentId="dx" onClose={vi.fn()} />)
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
    expect(await screen.findByTestId('text-page-body')).toHaveTextContent('Page two')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByTestId('text-page-body')).toHaveTextContent('Page three words'))
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeInTheDocument())
    expect(screen.queryByTestId('pdf-viewer-stub')).not.toBeInTheDocument()
  })

  it('a target past the end lands on the last page; the handle moves pages (Ask citations)', async () => {
    serve({ docs: [docxRow], pages })
    const ref = createRef()
    render(<TextPagesViewer ref={ref} href={DOCX} documentId="dx" initialPage={9} />)
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument()
    act(() => { ref.current.scrollToPage(1) })
    await waitFor(() => expect(screen.getByTestId('text-page-body')).toHaveTextContent('Page one words'))
  })

  it('says it is reading, or that it could not be read, instead of an empty box', async () => {
    serve({ docs: [{ ...docxRow, status: 'pending', pagesWithText: 0 }] })
    const { unmount } = render(<DocumentPreviewSheet open href={DOCX} documentId="dx" onClose={vi.fn()} />)
    expect(await screen.findByText('Reading this document. This can take a moment.')).toBeInTheDocument()
    unmount()
    serve({ docs: [{ ...docxRow, status: 'processing_failed', pagesWithText: 0 }] })
    render(<DocumentPreviewSheet open href={DOCX} documentId="dx" onClose={vi.fn()} />)
    expect(await screen.findByText('This document couldn’t be read, so its text isn’t searchable.'))
      .toBeInTheDocument()
  })
})
