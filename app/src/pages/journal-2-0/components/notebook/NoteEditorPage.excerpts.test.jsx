import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// jsdom gap, same as NoteEditorPage.attachments.test.jsx.
Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

// Wave J: excerpt capture + click-to-source, driven through NoteEditorPage.
// PdfDocumentViewer does real pdfjs-dist work jsdom can't run (Worker/
// Canvas2D/ReadableStream) -- mocked here to capture the props
// NoteEditorPage passes it (href/excerpts/onSaveExcerpt/emphasizeExcerptId)
// and to let a test fire onSaveExcerpt directly, the same boundary
// DocumentPreviewSheet.test.jsx already draws. Real PDF.js selection +
// rendering is live-browser-verified.

const NOTE = {
  id: 'n1', title: 'NVDA Investor Deck Research', subtitle: '', folderId: null,
  ticker: 'NVDA', tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: {
    type: 'doc',
    content: [
      { type: 'attachmentChip', attrs: { href: '/api/j2/notes/attachments/u1/n1/file/abc.pdf', name: 'report.pdf', size: 4096 } },
    ],
  },
}

const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

let lastViewerProps = null
vi.mock('./PdfDocumentViewer', () => ({
  default: (props) => {
    lastViewerProps = props
    return <div data-testid="pdf-viewer-stub" />
  },
}))

let fetchMock
beforeEach(() => {
  updateMock.mockReset()
  lastViewerProps = null
  fetchMock = vi.fn((url) => {
    if (String(url).endsWith('/documents')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          documents: [{
            id: 'doc1', attachmentUrl: '/api/j2/notes/attachments/u1/n1/file/abc.pdf',
            name: 'report.pdf', status: 'ready', pageCount: 3,
            createdAt: '2026-01-01T00:00:00Z', processedAt: '2026-01-01T00:00:00Z',
          }],
        }),
      })
    }
    if (String(url).endsWith('/excerpts') && !String(url).includes('search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ excerpts: [] }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
  global.fetch = fetchMock
})
afterEach(() => vi.clearAllMocks())

async function renderEditor(props = {}) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack {...props} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}

describe('NoteEditorPage — Wave J excerpt capture + click-to-source', () => {
  it('opening the PDF preview resolves the documentId from the note\'s own document list', async () => {
    await renderEditor()
    const chip = await screen.findByText('report.pdf')
    fireEvent.click(chip)
    await waitFor(() => expect(lastViewerProps).not.toBeNull())
    expect(lastViewerProps.href).toBe('/api/j2/notes/attachments/u1/n1/file/abc.pdf')
  })

  it('saving an excerpt POSTs to the excerpts endpoint and inserts a real documentExcerpt node', async () => {
    fetchMock.mockImplementation((url, opts) => {
      if (String(url).endsWith('/documents')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            documents: [{ id: 'doc1', attachmentUrl: '/api/j2/notes/attachments/u1/n1/file/abc.pdf', name: 'report.pdf', status: 'ready', pageCount: 3 }],
          }),
        })
      }
      if (String(url) === '/api/j2/notes/n1/excerpts' && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            excerpt: {
              id: 'ex1', documentId: 'doc1', pageNumber: 1,
              capturedText: 'Management expects gross margins to normalize lower',
              documentName: 'report.pdf', annotation: null,
            },
          }),
        })
      }
      if (String(url).endsWith('/excerpts')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ excerpts: [] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    await renderEditor()
    const chip = await screen.findByText('report.pdf')
    fireEvent.click(chip)
    await waitFor(() => expect(lastViewerProps?.href).toBeTruthy())

    await act(async () => {
      await lastViewerProps.onSaveExcerpt({
        pageNumber: 1, capturedText: 'Management expects gross margins to normalize lower',
        quotePrefix: null, quoteSuffix: null, charStart: 0, charEnd: 10,
      })
    })

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([u, o]) => u === '/api/j2/notes/n1/excerpts' && o?.method === 'POST')
      expect(postCall).toBeTruthy()
    })
    const postCall = fetchMock.mock.calls.find(([u, o]) => u === '/api/j2/notes/n1/excerpts' && o?.method === 'POST')
    expect(JSON.parse(postCall[1].body)).toMatchObject({ documentId: 'doc1', pageNumber: 1 })

    await waitFor(() => {
      expect(document.querySelector('[data-document-excerpt]')).toBeTruthy()
    })

    // ⛔ REGRESSION RAIL, found live in the browser: clicking the chip to
    // open the preview leaves ProseMirror holding a NodeSelection on it, and
    // `insertContent` REPLACES the selection -- so saving the first excerpt
    // from a document deleted the attachment chip that document came in on.
    // The chip must still be there after the excerpt lands beside it.
    expect(document.querySelector('a[data-type="attachmentChip"]')).toBeTruthy()
  })

  it('a failed excerpt save shows a toast and inserts no node', async () => {
    fetchMock.mockImplementation((url, opts) => {
      if (String(url).endsWith('/documents')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            documents: [{ id: 'doc1', attachmentUrl: '/api/j2/notes/attachments/u1/n1/file/abc.pdf', name: 'report.pdf', status: 'ready', pageCount: 3 }],
          }),
        })
      }
      if (String(url) === '/api/j2/notes/n1/excerpts' && opts?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ detail: 'nope' }) })
      }
      if (String(url).endsWith('/excerpts')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ excerpts: [] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    await renderEditor()
    const chip = await screen.findByText('report.pdf')
    fireEvent.click(chip)
    await waitFor(() => expect(lastViewerProps?.href).toBeTruthy())

    await act(async () => {
      await lastViewerProps.onSaveExcerpt({ pageNumber: 1, capturedText: 'x' })
    })

    await waitFor(() => expect(screen.getByText("Couldn't save that excerpt. Your note is unchanged.")).toBeInTheDocument())
    expect(document.querySelector('[data-document-excerpt]')).toBeNull()
  })
})
