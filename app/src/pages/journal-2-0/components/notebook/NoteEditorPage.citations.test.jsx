import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags } from '../../lib/offline/notebookFlags'

// ⛔ "THIS NOTE" ANSWERED AN EXCERPT CITATION WITH A DEAD CLICK.
// `jumpToCitation` fell through its `kind !== 'note'` guard and returned, while
// this very page already opened an excerpt by id for a thesis evidence row
// (`handleOpenExcerptSource`). Both now go through lib/openCitation.js, and every
// branch that does not navigate RETURNS a sentence AskPanel shows inside itself.
//
// The real editor mount, same convention as NoteEditorPage.askInsert.test.jsx:
// the note/folder/auth hooks are the harness every editor rail uses; the Ask
// panel, its SSE parser, the citation handler, the helper and the preview sheet
// are real, and `fetch` is the seam. PdfDocumentViewer is stubbed because jsdom
// has no Worker/Canvas2D, and it reports the props it RECEIVED.
vi.mock('./PdfDocumentViewer', () => ({
  default: (p) => (
    <div
      data-testid="pdf-viewer-stub"
      data-initial-page={p.initialPage ?? ''}
      data-emphasize={p.emphasizeExcerptId ?? ''}
      data-excerpts={(p.excerpts || []).map((e) => e.id).join(',')}
    />
  ),
}))

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My own view.' }] }] },
}
const { noteStore } = vi.hoisted(() => ({ noteStore: {} }))
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: (noteId) => ({
    note: noteStore[noteId] ?? null,
    isLoading: !noteStore[noteId],
    update: async (patch) => ({ ...noteStore[noteId], ...patch }),
    refresh: vi.fn(),
  }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const EXCERPT_SOURCE = {
  n: 1, type: 'document_excerpt', label: 'Q3 filing.pdf · p.4', citation: 'exact',
  snippet: 'gross margin compressed',
  navigation: { kind: 'excerpt', excerpt_id: 'ex1', document_id: 'd9', page_number: 4 },
  location: { document_id: 'd9', page_number: 4 }, payload: {}, stance: null,
  textOrigin: 'native', truncated: false,
}
const PDF_EXCERPT = {
  id: 'ex1', noteId: 'n7', documentId: 'd9', documentName: 'Q3 filing.pdf',
  attachmentUrl: '/api/j2/notes/attachments/u1/n7/file/q3.pdf', sourceKind: null,
  sourceUrl: null, pageNumber: 4, capturedText: 'gross margin compressed', annotation: null,
}

function sse(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function installNetwork({ source = EXCERPT_SOURCE, excerpt = json(500, {}) } = {}) {
  global.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.includes('/api/j2/ask/stream')) {
      return Promise.resolve({
        ok: true, status: 200, json: async () => ({}),
        body: sse([
          { type: 'sources', scope: 'note', scopeLabel: 'This note', coverageNotice: null, sources: [source] },
          { type: 'final', answer: 'Margins compressed [1].' },
        ]),
      })
    }
    if (u.startsWith('/api/j2/excerpts/')) return Promise.resolve(excerpt)
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  })
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  __resetNotebookFlags()
  noteStore.n1 = { ...NOTE }
})
afterEach(() => vi.clearAllMocks())

async function renderEditorAndTap(label = EXCERPT_SOURCE.label) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  fireEvent.click(screen.getByRole('button', { name: 'Ask a question about this note' }))
  const ask = await screen.findByRole('dialog', { name: 'Ask This note' })
  fireEvent.change(within(ask).getByRole('textbox'), { target: { value: 'margins?' } })
  fireEvent.click(within(ask).getByRole('button', { name: 'Ask' }))
  fireEvent.click(await within(ask).findByRole('button', { name: `Source 1: ${label}` }))
  return ask
}

describe('NoteEditorPage ("This note") — citations', () => {
  it('an EXCERPT opens its PDF at the cited page, emphasising the passage', async () => {
    installNetwork({ excerpt: json(200, { excerpt: PDF_EXCERPT }) })
    await renderEditorAndTap()

    const sheet = await screen.findByRole('dialog', { name: 'Preview of Q3 filing.pdf' })
    const viewer = await within(sheet).findByTestId('pdf-viewer-stub')
    expect(viewer).toHaveAttribute('data-initial-page', '4')
    expect(viewer).toHaveAttribute('data-emphasize', 'ex1')
    // The excerpt belongs to ANOTHER note (n7), so it is not among this note's
    // own excerpts -- the viewer can emphasise it only because it was handed.
    expect(viewer.getAttribute('data-excerpts').split(',')).toContain('ex1')
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/excerpts/ex1',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }))
  })

  it('a deleted passage is said inside the Ask panel', async () => {
    installNetwork({ excerpt: json(404, { detail: 'Not found' }) })
    const ask = await renderEditorAndTap()
    expect(await within(ask).findByText('That passage is no longer available.')).toBeInTheDocument()
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
  })

  it('a source this page cannot route (a fact) says so instead of doing nothing', async () => {
    const fact = {
      ...EXCERPT_SOURCE, type: 'financial_fact', label: 'gross_margin · NVDA', citation: 'record_only',
      navigation: { kind: 'fact', fact_id: 'f1', note_id: 'n1' }, location: {},
    }
    installNetwork({ source: fact })
    const ask = await renderEditorAndTap(fact.label)
    expect(await within(ask).findByText("That source can't be opened from here.")).toBeInTheDocument()
  })

  it('an EXACT passage the live note no longer holds says it changed -- never a silent click', async () => {
    const moved = {
      ...EXCERPT_SOURCE, type: 'note', label: 'Original Title', citation: 'exact',
      snippet: 'a sentence this note no longer contains',
      navigation: { kind: 'note', note_id: 'n1' }, location: { from: 1, to: 40 },
    }
    installNetwork({ source: moved })
    const ask = await renderEditorAndTap(moved.label)
    expect(await within(ask).findByText(
      "That passage can't be pinpointed any more — the note has changed since this answer.",
    )).toBeInTheDocument()
  })

  it('a NOTE-LEVEL source (a thesis state) says it is the note as a whole', async () => {
    const state = {
      ...EXCERPT_SOURCE, type: 'thesis_state', label: 'Original Title', citation: 'note_only',
      snippet: '', navigation: { kind: 'note', note_id: 'n1' }, location: {},
    }
    installNetwork({ source: state })
    const ask = await renderEditorAndTap(state.label)
    expect(await within(ask).findByText(
      'That source is this note as a whole, not one passage in it.',
    )).toBeInTheDocument()
  })

  it('CONTROL: a document-page citation navigates, and says nothing', async () => {
    const page = {
      ...EXCERPT_SOURCE, type: 'document_page', label: 'Q3 filing.pdf · p.2', citation: 'page_only',
      navigation: { kind: 'document', document_id: 'd1', page_number: 2, note_id: 'n1' }, location: {},
    }
    installNetwork({ source: page })
    const ask = await renderEditorAndTap(page.label)
    await new Promise((r) => setTimeout(r, 50))
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/j2\/excerpts\//), expect.anything())
  })
})

// Non-vacuity for the preview assertions above: without a tap nothing opens.
describe('NoteEditorPage — nothing opens on its own', () => {
  it('no preview sheet exists before a citation is tapped', async () => {
    installNetwork()
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
    await screen.findByPlaceholderText('Title')
    await waitFor(() => expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull())
  })
})
