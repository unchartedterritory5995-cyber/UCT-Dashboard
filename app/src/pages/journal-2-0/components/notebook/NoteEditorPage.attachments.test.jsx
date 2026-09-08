import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// jsdom has no layout engine, so ProseMirror's scrollIntoView-after-insert
// (fired internally by `.chain().insertContent(...).run()`, the exact
// command handleAttachmentInsert uses) throws reaching into Range/Element
// APIs jsdom doesn't implement. This is a test-environment gap, not app
// behavior — no prior test in this file's siblings ever exercised a real
// content-insertion command, which is why it's fixed here rather than in
// the shared test-setup.js.
Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

// Wave I: live attachment authoring. The backend endpoint
// (POST /notes/{id}/attachments) and the AttachmentChip TipTap node both
// existed before this wave -- the editor's paste/drop handlers were
// image-only, so a member could never reach either. This covers the new
// toolbar entry point + the file-picker upload path end to end (a real
// AttachmentChip node lands in the editor), plus the upload-failure toast.
// Same real-editor-mount convention as NoteEditorPage.waveB.test.jsx.

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original body' }] }] },
}

const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
// Wave J: PdfDocumentViewer does real async pdfjs-dist work (Worker/Canvas2D/
// ReadableStream, none of which jsdom implements) -- mocked here the same
// way DocumentPreviewSheet.test.jsx mocks it, so this file's own concern
// (does clicking a chip open the preview Sheet at all) stays isolated from
// PDF rendering, which is live-browser-verified instead.
vi.mock('./PdfDocumentViewer', () => ({ default: () => <div data-testid="pdf-viewer-stub" /> }))

let fetchMock
beforeEach(() => {
  updateMock.mockReset()
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  global.fetch = fetchMock
})
afterEach(() => vi.clearAllMocks())

async function renderEditor(props = {}) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack {...props} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}

describe('NoteEditorPage — Wave I live attachment authoring', () => {
  it('renders a discoverable, accessibly-labeled "Attach a file" toolbar button', async () => {
    await renderEditor()
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeInTheDocument()
  })

  it('clicking the toolbar button opens the hidden attachment file picker', async () => {
    await renderEditor()
    const input = screen.getByLabelText('Upload file attachment')
    const clickSpy = vi.spyOn(input, 'click')
    // ToolButton fires its action on mousedown (preventing the focus-stealing
    // default), not click -- same convention as every other toolbar button.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Attach a file' }))
    expect(clickSpy).toHaveBeenCalled()
  })

  it('picking a PDF uploads it to /notes/{id}/attachments and inserts a real AttachmentChip node', async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).endsWith('/attachments')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ url: '/api/j2/notes/attachments/u1/n1/file/abc123.pdf', name: 'report.pdf', size: 4096 }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    await renderEditor()
    const input = screen.getByLabelText('Upload file attachment')
    const file = new File(['%PDF-1.4'], 'report.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/j2/notes/n1/attachments',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    ))
    // The chip renders as a real <a data-type="attachmentChip"> node, not a
    // bare markdown link -- the exact node the import adapters already use.
    await waitFor(() => {
      const chip = document.querySelector('a[data-type="attachmentChip"]')
      expect(chip).toBeTruthy()
      expect(chip.getAttribute('data-name')).toBe('report.pdf')
      expect(chip.getAttribute('href')).toBe('/api/j2/notes/attachments/u1/n1/file/abc123.pdf')
    })
  })

  it('clicking a PDF AttachmentChip opens the preview Sheet, not a download (real-browser-found regression: renderHTML emits a native download= attribute that beats TipTap\'s own handleClickOn)', async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).endsWith('/attachments')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ url: '/api/j2/notes/attachments/u1/n1/file/abc123.pdf', name: 'report.pdf', size: 4096 }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    await renderEditor()
    const input = screen.getByLabelText('Upload file attachment')
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], 'report.pdf', { type: 'application/pdf' })] } })
    const chip = await screen.findByText('report.pdf')
    expect(chip.closest('a').getAttribute('download')).toBe('report.pdf')  // confirms the exact hazard this test guards

    fireEvent.click(chip)
    expect(screen.getByRole('dialog', { name: 'Preview of report.pdf' })).toBeInTheDocument()
  })

  it('clicking a non-PDF AttachmentChip does nothing special (no preview Sheet)', async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).endsWith('/attachments')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ url: '/api/j2/notes/attachments/u1/n1/file/data.csv', name: 'data.csv', size: 128 }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    await renderEditor()
    const input = screen.getByLabelText('Upload file attachment')
    fireEvent.change(input, { target: { files: [new File(['a,b'], 'data.csv', { type: 'text/csv' })] } })
    const chip = await screen.findByText('data.csv')
    fireEvent.click(chip)
    expect(screen.queryByRole('dialog', { name: 'Preview of data.csv' })).not.toBeInTheDocument()
  })

  it('an upload failure shows a toast and leaves the note otherwise unchanged (no alert())', async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).endsWith('/attachments')) {
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ detail: 'File must be < 25 MB' }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await renderEditor()
    const input = screen.getByLabelText('Upload file attachment')
    const file = new File(['x'], 'huge.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText("Couldn't upload huge.pdf. Your note is unchanged.")).toBeInTheDocument())
    expect(alertSpy).not.toHaveBeenCalled()
    expect(document.querySelector('a[data-type="attachmentChip"]')).toBeNull()
  })

  // Drop itself isn't exercised here: jsdom's ProseMirror integration needs
  // `document.elementFromPoint` (unimplemented in jsdom) before it ever
  // reaches this editor's own handleDrop -- the same limitation that left
  // the pre-existing image-drop path with zero test coverage too. handleDrop
  // and handlePaste route through the identical ALLOWED_ATTACHMENT_MIMES
  // check and the identical handleAttachmentInsert call (see NoteEditorPage.
  // jsx), so the picker-upload and paste-failure tests above already cover
  // that shared logic.
})
