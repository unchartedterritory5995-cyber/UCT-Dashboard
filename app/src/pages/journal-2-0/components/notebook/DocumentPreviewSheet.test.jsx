import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DocumentPreviewSheet from './DocumentPreviewSheet'

// Wave I: native-browser PDF preview -- no pdf.js/react-pdf dependency, an
// <iframe> at the attachment's own authenticated serve URL inside a Sheet.
// Opened from a PDF AttachmentChip click (NoteEditorPage.jsx's
// editorProps.handleClickOn) and from the standalone document route.

const HREF = '/api/j2/notes/attachments/u1/n1/file/abc123.pdf'

describe('DocumentPreviewSheet', () => {
  it('renders nothing when closed', () => {
    render(<DocumentPreviewSheet open={false} href={HREF} name="report.pdf" onClose={vi.fn()} />)
    expect(screen.queryByTitle('Preview of report.pdf')).not.toBeInTheDocument()
  })

  it('renders an iframe at the attachment URL, the filename, and download/open-in-new-tab links', () => {
    render(<DocumentPreviewSheet open href={HREF} name="report.pdf" onClose={vi.fn()} />)
    const frame = screen.getByTitle('Preview of report.pdf')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame.getAttribute('src')).toBe(HREF)
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    const openLink = screen.getByText('Open in new tab').closest('a')
    expect(openLink.getAttribute('href')).toBe(HREF)
    expect(openLink.getAttribute('target')).toBe('_blank')
    const downloadLink = screen.getByText('Download').closest('a')
    expect(downloadLink.getAttribute('href')).toBe(HREF)
    expect(downloadLink.getAttribute('download')).toBe('report.pdf')
  })

  it('appends a #page= fragment when a page number is given, for citation-style deep links', () => {
    render(<DocumentPreviewSheet open href={HREF} name="report.pdf" page={17} onClose={vi.fn()} />)
    expect(screen.getByTitle('Preview of report.pdf').getAttribute('src')).toBe(`${HREF}#page=17`)
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
})
