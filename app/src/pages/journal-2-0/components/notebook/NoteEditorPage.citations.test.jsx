import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
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
    installDocNetwork({ source: page })
    const ask = await renderEditorAndTap(page.label)
    await new Promise((r) => setTimeout(r, 50))
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/j2\/excerpts\//), expect.anything())
  })
})

// ⛔⛔ A DOCUMENT CITATION OPENS BY ITS KIND. This page already took a cited
// page to `?doc=&page=` -- and its viewer opens whatever this note's document
// list names, a captured web page included: a PDF viewer over `web:<sha256>`
// (Wave N §9). The server now sends the kind (tests/test_ask_document_navigation.py
// pins both shapes against the real schema), and the page routes on it through
// lib/openCitation.js like every other host.
const PDF_PAGE = {
  n: 1, type: 'document_page', label: 'Q3 10-Q · p.47', citation: 'page_only',
  snippet: 'gross margin compressed', payload: {}, stance: null, textOrigin: 'native', truncated: false,
  navigation: { kind: 'document', document_id: 'd1', page_number: 47, note_id: 'n1', source_kind: 'attachment' },
  location: { document_id: 'd1', page_number: 47 },
}
const WEB_PAGE = {
  ...PDF_PAGE, label: 'Captured passage · Reuters: NVDA margins',
  navigation: { kind: 'document', document_id: 'dw', page_number: 1, note_id: 'n1', source_kind: 'web', excerpt_id: 'exw' },
  location: { document_id: 'dw', page_number: 1 },
}
const OLD_PAGE = { ...PDF_PAGE, navigation: { kind: 'document', document_id: 'd1', page_number: 47, note_id: 'n1' } }
const WEB_PAGE_EXCERPT = {
  ...PDF_EXCERPT, id: 'exw', noteId: 'n1', documentId: 'dw', documentName: 'Reuters: NVDA margins',
  attachmentUrl: 'web:3f2a', sourceKind: 'web', sourceUrl: 'https://www.reuters.com/x', pageNumber: 1,
}
// THIS note's own document list, as `GET /notes/{id}/documents` answers it: the
// web capture is in it, and the list says so (`sourceKind`, the server's same
// `is_web_capture` rule) with the excerpt beside each captured page
// (`capturePassages`) -- tests/test_document_list_kind.py pins that shape.
const N1_DOCUMENTS = { documents: [
  { id: 'd1', attachmentUrl: '/api/j2/notes/attachments/u1/n1/file/q3.pdf', name: 'Q3 10-Q', status: 'ready',
    pageCount: 80, sourceKind: 'attachment', capturePassages: [] },
  { id: 'dw', attachmentUrl: 'web:3f2a', name: 'Reuters: NVDA margins', status: 'ready', pageCount: 1,
    sourceKind: 'web', capturePassages: [{ pageNumber: 1, excerptId: 'exw' }] },
] }

/** `documents(n)` answers the n-th read of this note's list (0 = the page's
 *  own load); `excerpt` may be a function of the URL, for a slow read. */
function installDocNetwork({
  source = PDF_PAGE, sources = [source], excerpt = json(500, {}), noteExcerpts = [],
  documents = () => json(200, N1_DOCUMENTS),
}) {
  let listReads = 0
  global.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.includes('/api/j2/ask/stream')) {
      return Promise.resolve({
        ok: true, status: 200, json: async () => ({}),
        body: sse([
          { type: 'sources', scope: 'note', scopeLabel: 'This note', coverageNotice: null, sources },
          { type: 'final', answer: `Margins compressed ${sources.map((_, i) => `[${i + 1}]`).join(' ')}.` },
        ]),
      })
    }
    if (u === '/api/j2/notes/n1/documents') return Promise.resolve(documents(listReads++))
    if (u === '/api/j2/notes/n1/excerpts') return Promise.resolve(json(200, { excerpts: noteExcerpts }))
    if (u.startsWith('/api/j2/excerpts/')) {
      return typeof excerpt === 'function' ? excerpt(u) : Promise.resolve(excerpt)
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  })
}

describe('NoteEditorPage ("This note") — a DOCUMENT citation opens by its kind', () => {
  it('a PDF page opens in the preview AT the cited page', async () => {
    installDocNetwork({ source: PDF_PAGE })
    const ask = await renderEditorAndTap(PDF_PAGE.label)

    const sheet = await screen.findByRole('dialog', { name: 'Preview of Q3 10-Q' })
    expect(await within(sheet).findByTestId('pdf-viewer-stub')).toHaveAttribute('data-initial-page', '47')
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
  })

  it('a captured WEB page in this very note opens as a captured passage, NEVER in the PDF viewer', async () => {
    installDocNetwork({ source: WEB_PAGE, excerpt: json(200, { excerpt: WEB_PAGE_EXCERPT }) })
    await renderEditorAndTap(WEB_PAGE.label)

    await screen.findByRole('dialog', { name: 'Captured passage from Reuters: NVDA margins' })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/excerpts/exw', expect.anything())
    // Give a `?doc=` route every chance to open the viewer it would have opened.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
  })

  it('a captured web page whose saved excerpt is gone says so -- the note is already open', async () => {
    const orphan = { ...WEB_PAGE, navigation: { ...WEB_PAGE.navigation, excerpt_id: undefined } }
    installDocNetwork({ source: orphan })
    const ask = await renderEditorAndTap(orphan.label)

    expect(await within(ask).findByText('That passage is no longer available.')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
  })

  it('a packet with NO kind keeps this page\'s old page route -- never a new guess', async () => {
    installDocNetwork({ source: OLD_PAGE })
    const ask = await renderEditorAndTap(OLD_PAGE.label)

    const sheet = await screen.findByRole('dialog', { name: 'Preview of Q3 10-Q' })
    expect(await within(sheet).findByTestId('pdf-viewer-stub')).toHaveAttribute('data-initial-page', '47')
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/j2\/excerpts\//), expect.anything())
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
  })
})

// ⛔ N-2: the editor's OWN excerpt wiring (`handleOpenExcerptSource` →
// `openCapturedSource`) had no rail -- pointing it at the PDF viewer stayed
// green in every file that reached it. An Ask citation of a captured passage.
describe('NoteEditorPage — an EXCERPT citation of a captured web passage', () => {
  it('opens the captured-passage sheet, never the PDF viewer', async () => {
    installNetwork({ excerpt: json(200, { excerpt: WEB_PAGE_EXCERPT }) })
    await renderEditorAndTap()

    await screen.findByRole('dialog', { name: 'Captured passage from Reuters: NVDA margins' })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/excerpts/ex1', expect.anything())
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
  })
})

// ⛔⛔ EVERY DOOR INTO `?doc=&page=` -- A WEB CAPTURE NEVER REACHES THE PDF VIEWER.
// The route opens whatever row of this note's document list it names, and the
// list holds captured web pages too. Found doors: Search (page + excerpt hits),
// Ask's page route (a PDF citation, and an OLD packet with no kind), any deep
// link, and -- outside the route but holding the same rows -- an excerpt card's
// citation and a PDF chip. Each opens through ONE door (`openNoteDocument`).
async function renderEditorAt(url) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter initialEntries={[url]}><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}
const settle = () => new Promise((r) => setTimeout(r, 50))

describe('NoteEditorPage — the `?doc=&page=` route opens a document by ITS kind', () => {
  it('a deep link to a CAPTURED page opens the captured passage, never the PDF viewer', async () => {
    installDocNetwork({ excerpt: json(200, { excerpt: WEB_PAGE_EXCERPT }) })
    await renderEditorAt('/?note=n1&doc=dw&page=1')

    await screen.findByRole('dialog', { name: 'Captured passage from Reuters: NVDA margins' })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/excerpts/exw', expect.anything())
    await settle()
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
  })

  it('CONTROL: a deep link to a PDF page still opens the viewer AT that page', async () => {
    installDocNetwork({})
    await renderEditorAt('/?note=n1&doc=d1&page=47')

    const sheet = await screen.findByRole('dialog', { name: 'Preview of Q3 10-Q' })
    expect(await within(sheet).findByTestId('pdf-viewer-stub')).toHaveAttribute('data-initial-page', '47')
  })

  it('a captured page with no saved passage opens NOTHING -- and SAYS so (its note is already open)', async () => {
    installDocNetwork({})
    await renderEditorAt('/?note=n1&doc=dw&page=2')
    expect(await screen.findByText('That passage is no longer available.')).toBeInTheDocument()
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
    expect(screen.queryByRole('dialog', { name: /Captured passage/ })).toBeNull()
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/j2\/excerpts\//), expect.anything())
  })

  it('an OLD Ask packet (no kind) citing a captured page goes to the door -- never the PDF viewer', async () => {
    const oldWeb = { ...WEB_PAGE, navigation: { kind: 'document', document_id: 'dw', page_number: 1, note_id: 'n1' } }
    installDocNetwork({ source: oldWeb, excerpt: json(200, { excerpt: WEB_PAGE_EXCERPT }) })
    await renderEditorAndTap(oldWeb.label)

    await screen.findByRole('dialog', { name: 'Captured passage from Reuters: NVDA margins' })
    await settle()
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
  })

  it("an excerpt card's citation for a captured page opens the captured passage", async () => {
    noteStore.n1 = {
      ...NOTE,
      bodyJson: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'My own view.' }] },
        { type: 'documentExcerpt', attrs: { excerptId: 'exw' } },
      ] },
    }
    installDocNetwork({ excerpt: json(200, { excerpt: WEB_PAGE_EXCERPT }), noteExcerpts: [WEB_PAGE_EXCERPT] })
    await renderEditorAt('/')

    fireEvent.click(await screen.findByRole('button', { name: /Reuters: NVDA margins · p\.1/ }))
    await screen.findByRole('dialog', { name: 'Captured passage from Reuters: NVDA margins' })
    await settle()
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
  })

  it('a PDF-named chip whose row is a captured page opens the captured passage', async () => {
    // The chip gate is the file NAME (`.pdf`), which a member controls; the
    // row behind the chip is what says whether a PDF viewer can show it.
    noteStore.n1 = {
      ...NOTE,
      bodyJson: { type: 'doc', content: [
        { type: 'paragraph', content: [
          { type: 'attachmentChip', attrs: { href: 'web:3f2a', name: 'reuters-capture.pdf', size: 1 } },
        ] },
      ] },
    }
    installDocNetwork({ excerpt: json(200, { excerpt: WEB_PAGE_EXCERPT }) })
    await renderEditorAt('/')
    await settle()   // the document list resolves before the tap

    fireEvent.click(await screen.findByText('reuters-capture.pdf'))
    await screen.findByRole('dialog', { name: 'Captured passage from Reuters: NVDA margins' })
    expect(screen.queryByRole('dialog', { name: /Preview of/ })).toBeNull()
  })
})

// ⛔⛔ NOTHING A DOOR COULD NOT OPEN IS SILENT (review M-1, M-3). Each of these
// was a dead click at 96d3652bd -- the review's five probes, plus a cited
// document that left this note. An Ask tap says it inside the panel; the doors
// outside Ask (a deep link, an excerpt card, a chip) say it in the page's Toast.
describe('NoteEditorPage — every door that opens nothing says why', () => {
  const noticeOf = (ask) => within(ask).getByTestId('ask-nav-notice')
  const nothingOpened = () => {
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
    expect(screen.queryByRole('dialog', { name: /Captured passage/ })).toBeNull()
  }

  it('an OLD packet citing a captured page with NO passage says it in the panel', async () => {
    const oldWeb = { ...WEB_PAGE, navigation: { kind: 'document', document_id: 'dw', page_number: 2, note_id: 'n1' } }
    installDocNetwork({ source: oldWeb })
    const ask = await renderEditorAndTap(oldWeb.label)
    await waitFor(() => expect(noticeOf(ask)).toHaveTextContent('That passage is no longer available.'))
    nothingOpened()
  })

  it('an OLD packet whose excerpt read 404s says it in the panel', async () => {
    const oldWeb = { ...WEB_PAGE, navigation: { kind: 'document', document_id: 'dw', page_number: 1, note_id: 'n1' } }
    installDocNetwork({ source: oldWeb, excerpt: json(404, { detail: 'Not found' }) })
    const ask = await renderEditorAndTap(oldWeb.label)
    await waitFor(() => expect(noticeOf(ask)).toHaveTextContent('That passage is no longer available.'))
    nothingOpened()
  })

  it('a deep link whose excerpt read FAILS says try again, in the page Toast', async () => {
    installDocNetwork({ excerpt: json(500, {}) })
    await renderEditorAt('/?note=n1&doc=dw&page=1')
    expect(await screen.findByText("Couldn't open that passage — try again.")).toBeInTheDocument()
    nothingOpened()
  })

  it('a .pdf-named chip over a captured row with NO passage says so, in the page Toast', async () => {
    noteStore.n1 = {
      ...NOTE,
      bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'attachmentChip', attrs: { href: 'web:3f2a', name: 'reuters-capture.pdf', size: 1 } }] }] },
    }
    installDocNetwork({
      documents: () => json(200, { documents: [{ ...N1_DOCUMENTS.documents[1], capturePassages: [] }] }),
    })
    await renderEditorAt('/')
    await settle()
    fireEvent.click(await screen.findByText('reuters-capture.pdf'))
    expect(await screen.findByText('That passage is no longer available.')).toBeInTheDocument()
    nothingOpened()
  })

  it("an excerpt card whose read FAILS says try again, in the page Toast", async () => {
    noteStore.n1 = {
      ...NOTE,
      bodyJson: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'My own view.' }] },
        { type: 'documentExcerpt', attrs: { excerptId: 'exw' } },
      ] },
    }
    installDocNetwork({ excerpt: json(500, {}), noteExcerpts: [WEB_PAGE_EXCERPT] })
    await renderEditorAt('/')
    fireEvent.click(await screen.findByRole('button', { name: /Reuters: NVDA margins · p\.1/ }))
    expect(await screen.findByText("Couldn't open that passage — try again.")).toBeInTheDocument()
    nothingOpened()
  })

  it("an excerpt card for ANOTHER note's captured passage, whose read FAILS, says try again", async () => {
    // Its document is not one of this note's rows, so the card goes straight
    // to the excerpt path -- and that path's sentence must still be said.
    const foreign = { ...WEB_PAGE_EXCERPT, id: 'exf', documentId: 'dx', noteId: 'n9' }
    noteStore.n1 = {
      ...NOTE,
      bodyJson: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'My own view.' }] },
        { type: 'documentExcerpt', attrs: { excerptId: 'exf' } },
      ] },
    }
    installDocNetwork({ excerpt: json(500, {}), noteExcerpts: [foreign] })
    await renderEditorAt('/')
    fireEvent.click(await screen.findByRole('button', { name: /Reuters: NVDA margins · p\.1/ }))
    expect(await screen.findByText("Couldn't open that passage — try again.")).toBeInTheDocument()
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/excerpts/exf', expect.anything())
    nothingOpened()
  })

  it('M-3: a cited PDF that LEFT this note says so -- the same words the spanning hosts use', async () => {
    const gonePdf = {
      ...PDF_PAGE, label: 'Old deck · p.3',
      navigation: { kind: 'document', document_id: 'dz', page_number: 3, note_id: 'n1', source_kind: 'attachment' },
    }
    installDocNetwork({ source: gonePdf })
    const ask = await renderEditorAndTap(gonePdf.label)
    await waitFor(() => expect(noticeOf(ask)).toHaveTextContent('That document is no longer available.'))
    nothingOpened()
    // It asked the list again rather than trusting the page's cached copy.
    expect(globalThis.fetch.mock.calls.filter(([u]) => u === '/api/j2/notes/n1/documents').length).toBeGreaterThan(1)
  })

  it('M-3: a cited PDF the cached list had not caught up with still opens AT its page', async () => {
    const late = {
      id: 'dn', attachmentUrl: '/api/j2/notes/attachments/u1/n1/file/new.pdf', name: 'New deck', status: 'ready',
      pageCount: 9, sourceKind: 'attachment', capturePassages: [],
    }
    const newPdf = {
      ...PDF_PAGE, label: 'New deck · p.3',
      navigation: { kind: 'document', document_id: 'dn', page_number: 3, note_id: 'n1', source_kind: 'attachment' },
    }
    installDocNetwork({
      source: newPdf,
      documents: (n) => json(200, n === 0 ? N1_DOCUMENTS : { documents: [...N1_DOCUMENTS.documents, late] }),
    })
    const ask = await renderEditorAndTap(newPdf.label)
    const sheet = await screen.findByRole('dialog', { name: 'Preview of New deck' })
    expect(await within(sheet).findByTestId('pdf-viewer-stub')).toHaveAttribute('data-initial-page', '3')
    expect(noticeOf(ask)).toBeEmptyDOMElement()
  })

  it('the LAST tap wins through the door: a slow captured-page read never opens over the second tap', async () => {
    const oldWeb = { ...WEB_PAGE, navigation: { kind: 'document', document_id: 'dw', page_number: 1, note_id: 'n1' } }
    const pdf2 = { ...PDF_PAGE, n: 2 }
    let releaseA
    const seen = {}
    installDocNetwork({
      sources: [oldWeb, pdf2],
      // A slow read that IGNORES its abort signal: the door must pass the tap's
      // signal on, or this late answer opens over the page the member chose.
      excerpt: (u) => {
        seen.url = u
        return new Promise((r) => { releaseA = () => r(json(200, { excerpt: WEB_PAGE_EXCERPT })) })
      },
    })
    const ask = await renderEditorAndTap(oldWeb.label)
    await waitFor(() => expect(seen.url).toBe('/api/j2/excerpts/exw'))
    fireEvent.click(await within(ask).findByRole('button', { name: `Source 2: ${pdf2.label}` }))
    await screen.findByRole('dialog', { name: 'Preview of Q3 10-Q' })
    await act(async () => { releaseA() })
    await settle()
    expect(screen.queryByRole('dialog', { name: /Captured passage/ })).toBeNull()
  })
})

// ⛔⛔ PRE-GATE M-1: THE FRESH ROW GOES THROUGH THE ONE DOOR. A cited document
// this page's cached list does not hold is read again (M-3) -- and the row that
// comes back is handed to `openNoteDocument`, never to the viewer directly. A
// packet with no kind whose late row is a captured page used to open the PDF
// viewer over `web:<sha256>`, "Open in new tab" and all (the final review's
// PROBE-A). The page's own load (read 0) lacks the row; every re-read has it.
describe('NoteEditorPage — a row the cached list had not caught up with opens through the one door', () => {
  const lateWeb = (capturePassages) => ({
    id: 'dw2', attachmentUrl: 'web:9b9b', name: 'Late capture', status: 'ready', pageCount: 1,
    sourceKind: 'web', capturePassages,
  })
  const lateList = (row) => (n) => json(200, n === 0 ? N1_DOCUMENTS : { documents: [...N1_DOCUMENTS.documents, row] })
  const LATE_EXCERPT = {
    ...WEB_PAGE_EXCERPT, id: 'exw2', documentId: 'dw2', documentName: 'Late capture', attachmentUrl: 'web:9b9b',
  }
  const oldLate = {
    ...PDF_PAGE, label: 'Late capture · p.1',
    navigation: { kind: 'document', document_id: 'dw2', page_number: 1, note_id: 'n1' },
  }

  it('PROBE-A: an OLD packet (no kind) whose late row is a captured page opens the captured passage -- never the PDF viewer', async () => {
    installDocNetwork({
      source: oldLate, documents: lateList(lateWeb([{ pageNumber: 1, excerptId: 'exw2' }])),
      excerpt: json(200, { excerpt: LATE_EXCERPT }),
    })
    const ask = await renderEditorAndTap(oldLate.label)

    await screen.findByRole('dialog', { name: 'Captured passage from Late capture' })
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/excerpts/exw2', expect.anything())
    await settle()
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
    expect(screen.queryByRole('dialog', { name: /Preview of/ })).toBeNull()
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
  })

  it('PROBE-A with no passage left says so in the panel -- and still never the PDF viewer', async () => {
    installDocNetwork({ source: oldLate, documents: lateList(lateWeb([])) })
    const ask = await renderEditorAndTap(oldLate.label)

    await waitFor(() => expect(within(ask).getByTestId('ask-nav-notice'))
      .toHaveTextContent('That passage is no longer available.'))
    await settle()
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
    expect(screen.queryByRole('dialog', { name: /Preview of|Captured passage/ })).toBeNull()
  })

  it('CONTROL: the same page, with the kind the new server sends, opens the captured passage', async () => {
    const newLate = { ...oldLate, navigation: { ...oldLate.navigation, source_kind: 'web', excerpt_id: 'exw2' } }
    installDocNetwork({
      source: newLate, documents: lateList(lateWeb([{ pageNumber: 1, excerptId: 'exw2' }])),
      excerpt: json(200, { excerpt: LATE_EXCERPT }),
    })
    const ask = await renderEditorAndTap(newLate.label)

    await screen.findByRole('dialog', { name: 'Captured passage from Late capture' })
    await settle()
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
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
