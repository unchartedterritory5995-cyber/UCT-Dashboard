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

  // ⚰️ WAVE P5 — SAVING A PASSAGE HAS TO REACH THE PICKER THAT OFFERS IT.
  //
  // Found by driving the journey on a phone in ONE sitting: save an excerpt
  // from a scanned page, open Add evidence, and the picker said "save an
  // excerpt from a PDF in this note first" — about the passage saved forty
  // seconds earlier. The server was right throughout; the candidate list is
  // subscribed at note-open with `revalidateOnFocus: false`, so the browser
  // kept serving the empty answer it had cached before the excerpt existed.
  //
  // ⛔ A RELOAD HID IT, which is why nothing caught it earlier: any check that
  // starts by loading the page sees a working picker. This asserts the list is
  // re-read on the SAVE, with no remount — the only version of the question a
  // member would recognise.
  it('re-reads the evidence-candidate list after an excerpt is saved, without a reload', async () => {
    const { SWRConfig } = await import('swr')
    const candidateCalls = () => fetchMock.mock.calls
      .filter(([u]) => String(u).startsWith('/api/j2/notes/n1/evidence-candidates')).length
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
            excerpt: { id: 'ex1', documentId: 'doc1', pageNumber: 1, capturedText: 'Total revenue was $12.48 billion', documentName: 'report.pdf', annotation: null },
          }),
        })
      }
      if (String(url).startsWith('/api/j2/notes/n1/evidence-candidates')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ candidates: [] }) })
      }
      if (String(url).endsWith('/excerpts')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ excerpts: [] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(
      // ⛔ NO custom `provider` here, deliberately. The app's own SWRConfig
      // (App.jsx) sets no provider, so the invalidation runs against SWR's
      // DEFAULT cache — give this tree a private Map and the refresher writes
      // to a cache nothing on screen reads, and the rail goes red against
      // correct code. `dedupingInterval: 0` only stops the revalidation being
      // folded into the mount read.
      <SWRConfig value={{ dedupingInterval: 0 }}>
        <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>
      </SWRConfig>,
    )
    await screen.findByPlaceholderText('Title')
    // Control: the picker's list is subscribed at note-open, so it has been
    // read once already. Without this the assertion below could pass on a
    // first read and prove nothing.
    await waitFor(() => expect(candidateCalls()).toBeGreaterThan(0))
    const before = candidateCalls()

    const chip = await screen.findByText('report.pdf')
    fireEvent.click(chip)
    await waitFor(() => expect(lastViewerProps?.href).toBeTruthy())
    await act(async () => {
      await lastViewerProps.onSaveExcerpt({
        pageNumber: 1, capturedText: 'Total revenue was $12.48 billion',
        quotePrefix: null, quoteSuffix: null, charStart: 98, charEnd: 130,
      })
    })

    await waitFor(() => expect(candidateCalls()).toBeGreaterThan(before))
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
