import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DocumentPreviewSheet from './DocumentPreviewSheet'

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
