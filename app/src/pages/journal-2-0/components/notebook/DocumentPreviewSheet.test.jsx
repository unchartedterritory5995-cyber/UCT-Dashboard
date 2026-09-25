import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DocumentPreviewSheet from './DocumentPreviewSheet'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

// Wave I shipped a native <iframe>; Wave J replaces the preview area with
// PdfDocumentViewer (canvas + a real pdfjs text layer) for excerpt/
// highlight capture. jsdom has no Worker/Canvas2D/ReadableStream support
// pdfjs-dist needs, so PdfDocumentViewer is mocked here -- these tests
// cover the Sheet chrome (bar, actions, close) and the props DocumentPreviewSheet
// threads through to the viewer; real PDF rendering + text selection is
// live-browser-verified (this program's established pattern for anything
// jsdom structurally cannot exercise -- native anchor download, real CSS
// layout, and now native PDF text-layer selection are the same class).

// ⛔ THE VIEWER IS LAZY NOW (PdfViewerBoundary, 2026-09-12), so every assertion about the props
// it receives has to AWAIT its first render. Before the boundary these were synchronous; a
// synchronous read now sees `lastViewerProps === null` and fails for a reason that has nothing
// to do with what the test is about.
const HREF = '/api/j2/notes/attachments/u1/n1/file/abc123.pdf'

let lastViewerProps = null
vi.mock('./PdfDocumentViewer', () => ({
  default: (props) => {
    lastViewerProps = props
    return <div data-testid="pdf-viewer-stub" />
  },
}))

describe('DocumentPreviewSheet', () => {
  it('renders nothing when closed', () => {
    render(<DocumentPreviewSheet open={false} href={HREF} name="report.pdf" onClose={vi.fn()} />)
    expect(screen.queryByTestId('pdf-viewer-stub')).not.toBeInTheDocument()
  })

  it('renders the bar (filename + download/open-in-new-tab links) and mounts the PDF viewer at the attachment URL', async () => {
    lastViewerProps = null
    render(<DocumentPreviewSheet open href={HREF} name="report.pdf" onClose={vi.fn()} />)
    expect(await screen.findByTestId('pdf-viewer-stub')).toBeInTheDocument()
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    const openLink = screen.getByText('Open in new tab').closest('a')
    expect(openLink.getAttribute('href')).toBe(HREF)
    expect(openLink.getAttribute('target')).toBe('_blank')
    const downloadLink = screen.getByText('Download').closest('a')
    expect(downloadLink.getAttribute('href')).toBe(HREF)
    expect(downloadLink.getAttribute('download')).toBe('report.pdf')
    await waitFor(() => expect(lastViewerProps.href).toBe(HREF))
  })

  it('threads the page number through as initialPage -- PdfDocumentViewer scrolls to it, not a browser #page= fragment', async () => {
    lastViewerProps = null
    render(<DocumentPreviewSheet open href={HREF} name="report.pdf" page={17} onClose={vi.fn()} />)
    await waitFor(() => expect(lastViewerProps.initialPage).toBe(17))
  })

  it('threads excerpts, onSaveExcerpt, and emphasizeExcerptId through to the viewer', async () => {
    lastViewerProps = null
    const excerpts = [{ id: 'e1', pageNumber: 3, capturedText: 'x' }]
    const onSaveExcerpt = vi.fn()
    render(
      <DocumentPreviewSheet
        open href={HREF} name="report.pdf" onClose={vi.fn()}
        excerpts={excerpts} onSaveExcerpt={onSaveExcerpt} emphasizeExcerptId="e1"
      />,
    )
    await waitFor(() => expect(lastViewerProps.excerpts).toBe(excerpts))
    expect(lastViewerProps.onSaveExcerpt).toBe(onSaveExcerpt)
    expect(lastViewerProps.emphasizeExcerptId).toBe('e1')
  })

  it('Escape calls onClose (via the shared Sheet primitive)', () => {
    const onClose = vi.fn()
    render(<DocumentPreviewSheet open href={HREF} name="report.pdf" onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('renders with a generic "Document" label when no name is known', () => {
    render(<DocumentPreviewSheet open href={HREF} onClose={vi.fn()} />)
    expect(screen.getByText('Document')).toBeInTheDocument()
  })

  it('renders nothing at all with no href (matches Wave I behavior)', () => {
    const { container } = render(<DocumentPreviewSheet open href={null} onClose={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('DocumentPreviewSheet — G-064 insert into the note behind the sheet', () => {
  it('passes onInsert through to its Ask panel', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_ask_insert_on: true })
    const enc = new TextEncoder()
    const body = new ReadableStream({ start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'sources', scope: 'document', scopeLabel: 'This document', coverageNotice: null, sources: [{ n: 1, type: 'document_page', label: 'report.pdf p.3', citation: 'page_only', snippet: 's', navigation: { kind: 'document', document_id: 'd1', page_number: 3 }, location: {}, payload: {}, stance: null, truncated: false }] })}\n\n`))
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'final', answer: 'Revenue grew [1].' })}\n\n`))
      c.close()
    } })
    const onInsert = vi.fn(() => true)
    render(<DocumentPreviewSheet open href={HREF} name="report.pdf" onClose={vi.fn()} documentId="d1" onInsert={onInsert} />)
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), body })
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question about this document' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask This document' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'revenue?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Insert into this note' }))
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(onInsert.mock.calls[0][0].type).toBe('askInsert')
    __resetNotebookFlags()
  })

  // G-064 fix round 1 (F6) — `onOpenNote` passes through too, independent of
  // `onInsert`: the research workspace's document preview has no note open
  // behind it to insert INTO, only a picker to open one.
  it('passes onOpenNote through to its Ask panel -- "Insert into a note…" when only onOpenNote is given', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_ask_insert_on: true })
    const enc = new TextEncoder()
    const body = new ReadableStream({ start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'sources', scope: 'document', scopeLabel: 'This document', coverageNotice: null, sources: [{ n: 1, type: 'document_page', label: 'report.pdf p.3', citation: 'page_only', snippet: 's', navigation: { kind: 'document', document_id: 'd1', page_number: 3 }, location: {}, payload: {}, stance: null, truncated: false }] })}\n\n`))
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'final', answer: 'Revenue grew [1].' })}\n\n`))
      c.close()
    } })
    const onOpenNote = vi.fn()
    render(<DocumentPreviewSheet open href={HREF} name="report.pdf" onClose={vi.fn()} documentId="d1" onOpenNote={onOpenNote} />)
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), body })
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question about this document' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask This document' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'revenue?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    expect(await within(dialog).findByRole('button', { name: 'Insert into a note…' })).toBeInTheDocument()
    __resetNotebookFlags()
  })
})
