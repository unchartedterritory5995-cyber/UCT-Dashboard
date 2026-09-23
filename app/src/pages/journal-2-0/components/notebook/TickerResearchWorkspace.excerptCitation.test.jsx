import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { MQ } from '../../../../styles/breakpoints'

// ⛔ AN EXCERPT CITATION IN "THIS RESEARCH" WAS A DEAD CLICK. Ask names a saved
// passage ("Q3 filing.pdf · p.4"), and its navigation is
// `{kind:'excerpt', excerpt_id, document_id, page_number}` -- no `note_id` --
// so the workspace's `navigation.note_id` handler did nothing at all.
//
// Everything here is REAL except the network and the pdfjs canvas: the real
// useTickerResearch hook, the real AskPanel streaming the real SSE parser, the
// real DocumentPreviewSheet and CapturedSourceSheet. `fetch` is the only seam.
// PdfDocumentViewer is stubbed because jsdom has no Worker/Canvas2D (the same
// stub every Notebook test uses); this one reports the props it was handed, so
// "opened at the cited page, emphasising the cited passage" is asserted on what
// the viewer RECEIVED, not on a state variable.
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

import TickerResearchWorkspace from './TickerResearchWorkspace'

const SUMMARY = {
  identity: { symbol: 'NVDA', entityId: null, displayName: null, symbols: ['NVDA'] },
  notes: [{ id: 'n1', title: 'NVDA research note', updatedAt: '2026-09-01T00:00:00Z', propertiesJson: {} }],
  activeTheses: [], pastTheses: [], facts: [], documents: [],
  tradeSummary: { openPositions: 0, closedTrades: 0 },
}

// What `ask_evidence.from_excerpt` emits, projected by `ask_service.public_source`.
const EXCERPT_SOURCE = {
  n: 1, type: 'document_excerpt', label: 'Q3 filing.pdf · p.4', citation: 'exact',
  snippet: 'gross margin compressed',
  navigation: { kind: 'excerpt', excerpt_id: 'ex1', document_id: 'd9', page_number: 4 },
  location: { document_id: 'd9', page_number: 4, quote_prefix: null, quote_suffix: null },
  payload: {}, stance: null, textOrigin: 'native', truncated: false,
}

// What `GET /api/j2/excerpts/{id}` returns (note_excerpts._row_to_excerpt).
const PDF_EXCERPT = {
  id: 'ex1', noteId: 'n7', documentId: 'd9', documentName: 'Q3 filing.pdf',
  attachmentUrl: '/api/j2/notes/attachments/u1/n7/file/q3.pdf', sourceKind: null,
  sourceUrl: null, pageNumber: 4, capturedText: 'gross margin compressed',
  annotation: null,
}

const WEB_EXCERPT = {
  ...PDF_EXCERPT, documentName: 'Reuters: NVDA margins',
  attachmentUrl: 'web:3f2a', sourceKind: 'web', sourceUrl: 'https://www.reuters.com/x',
}

function sseBody(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/** The network, and nothing else. `excerpt` is what the excerpt read answers. */
function installNetwork({ source = EXCERPT_SOURCE, excerpt }) {
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.endsWith('/api/j2/notes/research/NVDA/summary')) return jsonResponse(200, SUMMARY)
    if (u === '/api/j2/ask/stream') {
      return {
        ok: true, status: 200, json: async () => ({}),
        body: sseBody([
          { type: 'sources', scope: 'security', scopeLabel: 'NVDA research', sources: [source], coverageNotice: null },
          { type: 'final', answer: 'Margins compressed [1].' },
        ]),
      }
    }
    if (u.startsWith('/api/j2/excerpts/')) {
      return typeof excerpt === 'function' ? excerpt(u) : excerpt
    }
    throw new Error(`unexpected fetch ${u}`)
  })
}

/** Ask, tap citation 1, and hand back the Ask panel itself -- a notice the
 *  member can see is one INSIDE it (on touch it is a modal Sheet). */
async function askAndClickCitation(label = EXCERPT_SOURCE.label) {
  fireEvent.click(await screen.findByRole('button', { name: 'Ask a question about this research' }))
  const dialog = await screen.findByRole('dialog', { name: /Ask/ })
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'margins?' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
  fireEvent.click(await within(dialog).findByRole('button', { name: `Source 1: ${label}` }))
  return dialog
}

function renderWorkspace(onOpenNote) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        <TickerResearchWorkspace symbol="NVDA" onOpenNote={onOpenNote} />
      </MemoryRouter>
    </SWRConfig>,
  )
}

const realFetch = global.fetch
// ⛔ NO FILE-WIDE console.error SILENCING (review M-6). It hid every React
// warning in this file and asserted nothing; the one case that EXPECTS a log
// (a read that throws) spies locally and asserts the call.
afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks() })

describe('TickerResearchWorkspace — an EXCERPT citation lands on the passage', () => {
  it('opens the cited PDF at the cited page, emphasising the cited excerpt', async () => {
    const onOpenNote = vi.fn()
    installNetwork({ excerpt: jsonResponse(200, { excerpt: PDF_EXCERPT }) })
    renderWorkspace(onOpenNote)
    await askAndClickCitation()

    const sheet = await screen.findByRole('dialog', { name: 'Preview of Q3 filing.pdf' })
    const viewer = await within(sheet).findByTestId('pdf-viewer-stub')
    expect(viewer).toHaveAttribute('data-initial-page', '4')
    expect(viewer).toHaveAttribute('data-emphasize', 'ex1')
    // The viewer can only emphasise an excerpt it was HANDED (it looks the id
    // up in `excerpts`), so the id alone would scroll to nothing.
    expect(viewer.getAttribute('data-excerpts').split(',')).toContain('ex1')
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/excerpts/ex1',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }))
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('a captured WEB passage opens as a captured passage, never in a PDF viewer', async () => {
    const onOpenNote = vi.fn()
    installNetwork({ excerpt: jsonResponse(200, { excerpt: WEB_EXCERPT }) })
    renderWorkspace(onOpenNote)
    await askAndClickCitation()

    const sheet = await screen.findByRole('dialog', { name: 'Captured passage from Reuters: NVDA margins' })
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: /Open the note it lives in/ }))
    expect(onOpenNote).toHaveBeenCalledWith({ id: 'n7' })
  })

  it('a passage that no longer exists SAYS so -- never a silent click', async () => {
    const onOpenNote = vi.fn()
    installNetwork({ excerpt: jsonResponse(404, { detail: 'Not found' }) })
    renderWorkspace(onOpenNote)
    const ask = await askAndClickCitation()

    expect(await within(ask).findByText('That passage is no longer available.')).toBeInTheDocument()
    expect(within(ask).getByTestId('ask-nav-notice')).toHaveAttribute('role', 'status')
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('a failed read is NOT reported as a deleted passage', async () => {
    installNetwork({ excerpt: jsonResponse(500, {}) })
    renderWorkspace(vi.fn())
    const ask = await askAndClickCitation()

    expect(await within(ask).findByText("Couldn't open that passage — try again.")).toBeInTheDocument()
    expect(screen.queryByText('That passage is no longer available.')).toBeNull()
  })

  it('a read that THROWS (the network is down) says try again, and logs it', async () => {
    // Review M-4: a 500 is a RESPONSE and never reaches the catch; only a
    // rejected fetch does, and nothing exercised that branch.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    installNetwork({ excerpt: () => Promise.reject(new TypeError('Failed to fetch')) })
    renderWorkspace(vi.fn())
    const ask = await askAndClickCitation()

    expect(await within(ask).findByText("Couldn't open that passage — try again.")).toBeInTheDocument()
    expect(err).toHaveBeenCalledWith('[notebook] opening a saved excerpt failed', expect.any(TypeError))
  })

  it('a read that SUCCEEDS but names nowhere is not "try again"', async () => {
    // Review M-7: retrying returns the same excerpt with the same missing
    // destination, so "try again" would send the member round a loop.
    installNetwork({ excerpt: jsonResponse(200, { excerpt: { ...PDF_EXCERPT, attachmentUrl: null } }) })
    renderWorkspace(vi.fn())
    const ask = await askAndClickCitation()

    expect(await within(ask).findByText("That source can't be opened from here.")).toBeInTheDocument()
    expect(screen.queryByText("Couldn't open that passage — try again.")).toBeNull()
  })

  it('a source with no destination at all says so instead of doing nothing', async () => {
    const onOpenNote = vi.fn()
    const fact = {
      ...EXCERPT_SOURCE, type: 'financial_fact', label: 'gross_margin · NVDA', citation: 'record_only',
      navigation: { kind: 'fact', fact_id: 'f1', note_id: null }, location: {},
    }
    installNetwork({ source: fact, excerpt: jsonResponse(500, {}) })
    renderWorkspace(onOpenNote)
    const ask = await askAndClickCitation(fact.label)

    expect(await within(ask).findByText("That source can't be opened from here.")).toBeInTheDocument()
    expect(onOpenNote).not.toHaveBeenCalled()
    await waitFor(() => expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/j2\/excerpts\//), expect.anything()))
  })

  it('CONTROL: a note citation still opens its note, and says nothing', async () => {
    const onOpenNote = vi.fn()
    const note = {
      ...EXCERPT_SOURCE, type: 'note', label: 'NVDA thesis',
      navigation: { kind: 'note', note_id: 'n1' }, location: {},
    }
    installNetwork({ source: note, excerpt: jsonResponse(500, {}) })
    renderWorkspace(onOpenNote)
    await askAndClickCitation(note.label)

    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith({ id: 'n1' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
  })
})

// Review M-5 -- two quick taps on different excerpt citations. Whichever read
// resolves LAST used to win, not the one tapped last, so a slow first read could
// open its sheet over the one the member asked for second.
describe('TickerResearchWorkspace — the LAST tap wins', () => {
  const A = EXCERPT_SOURCE
  const B = {
    ...EXCERPT_SOURCE, n: 2, label: 'Q2 filing.pdf · p.9',
    navigation: { kind: 'excerpt', excerpt_id: 'ex2', document_id: 'd8', page_number: 9 },
  }
  const Q2 = {
    ...PDF_EXCERPT, id: 'ex2', documentId: 'd8', documentName: 'Q2 filing.pdf', pageNumber: 9,
    attachmentUrl: '/api/j2/notes/attachments/u1/n7/file/q2.pdf',
  }

  it('a slow read for the FIRST tap never opens over the second', async () => {
    let releaseA
    const seen = {}
    global.fetch = vi.fn((url, init) => {
      const u = String(url)
      if (u.endsWith('/api/j2/notes/research/NVDA/summary')) return Promise.resolve(jsonResponse(200, SUMMARY))
      if (u === '/api/j2/ask/stream') {
        return Promise.resolve({
          ok: true, status: 200, json: async () => ({}),
          body: sseBody([
            { type: 'sources', scope: 'security', scopeLabel: 'NVDA research', sources: [A, B], coverageNotice: null },
            { type: 'final', answer: 'Margins compressed [1] and [2].' },
          ]),
        })
      }
      if (u === '/api/j2/excerpts/ex1') {
        seen.ex1 = init?.signal
        // A slow read that IGNORES its abort signal: the opener must drop the
        // late result itself, not rely on the transport cancelling it.
        return new Promise((r) => { releaseA = () => r(jsonResponse(200, { excerpt: PDF_EXCERPT })) })
      }
      if (u === '/api/j2/excerpts/ex2') return Promise.resolve(jsonResponse(200, { excerpt: Q2 }))
      throw new Error(`unexpected fetch ${u}`)
    })
    renderWorkspace(vi.fn())
    const ask = await askAndClickCitation(A.label)
    fireEvent.click(await within(ask).findByRole('button', { name: `Source 2: ${B.label}` }))

    await screen.findByRole('dialog', { name: 'Preview of Q2 filing.pdf' })
    expect(seen.ex1.aborted).toBe(true)
    await act(async () => { releaseA() })

    expect(screen.queryByRole('dialog', { name: 'Preview of Q3 filing.pdf' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Preview of Q2 filing.pdf' })).toBeInTheDocument()
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
  })
})

// ⛔ ON TOUCH THE ASK PANEL IS AN aria-modal SHEET OVER A SCRIM, and it stays
// open when a citation is tapped. The first version of this fix wrote its
// "no longer available" line into the workspace's own alert strip -- behind
// that scrim, where the member saw nothing. test-setup stubs matchMedia to
// `matches:false` (desktop), so this block overrides it for the touch query
// alone, derived from MQ rather than typed.
describe('TickerResearchWorkspace — on TOUCH the notice is inside the Sheet', () => {
  const realMatchMedia = window.matchMedia
  beforeEach(() => {
    window.matchMedia = (query) => ({
      matches: query === MQ.touchDown, media: query, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return false },
    })
  })
  afterEach(() => { window.matchMedia = realMatchMedia })

  it('a deleted passage is said inside the modal Sheet the member is looking at', async () => {
    installNetwork({ excerpt: jsonResponse(404, { detail: 'Not found' }) })
    renderWorkspace(vi.fn())
    const ask = await askAndClickCitation()

    expect(ask).toHaveAttribute('aria-modal', 'true')
    const line = await within(ask).findByText('That passage is no longer available.')
    expect(ask.contains(line)).toBe(true)
    expect(within(ask).getByTestId('ask-nav-notice')).toHaveAttribute('role', 'status')
    // Nothing is left behind the scrim for the member to miss.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a PDF passage still opens its preview, stacked above the Ask Sheet', async () => {
    installNetwork({ excerpt: jsonResponse(200, { excerpt: PDF_EXCERPT }) })
    renderWorkspace(vi.fn())
    const ask = await askAndClickCitation()

    const sheet = await screen.findByRole('dialog', { name: 'Preview of Q3 filing.pdf' })
    expect(sheet).not.toBe(ask)
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
  })
})

// ⛔⛔ A DOCUMENT CITATION USED TO OPEN ITS NOTE AT THE TOP. "Q3 10-Q · p.47"
// dropped the member at a note and left them to find page 47. The server now
// sends the page's KIND (tests/test_ask_document_navigation.py pins both shapes
// against the real schema); a PDF opens at its page, a captured web passage as a
// captured passage, and a packet with no kind keeps the old behaviour.
const PDF_PAGE = {
  n: 1, type: 'document_page', label: 'Q3 10-Q · p.47', citation: 'page_only',
  snippet: 'gross margin compressed', payload: {}, stance: null, textOrigin: 'native', truncated: false,
  navigation: { kind: 'document', document_id: 'd9', page_number: 47, note_id: 'n7', source_kind: 'attachment' },
  location: { document_id: 'd9', page_number: 47 },
}
const WEB_PAGE = {
  ...PDF_PAGE, label: 'Captured passage · Reuters: NVDA margins',
  navigation: { kind: 'document', document_id: 'dw', page_number: 1, note_id: 'n7', source_kind: 'web', excerpt_id: 'exw' },
  location: { document_id: 'dw', page_number: 1 },
}
const OLD_PAGE = { ...PDF_PAGE, navigation: { kind: 'document', document_id: 'd9', page_number: 47, note_id: 'n7' } }
const WEB_PAGE_EXCERPT = { ...WEB_EXCERPT, id: 'exw', documentId: 'dw', pageNumber: 1 }
// What `GET /api/j2/notes/{id}/documents` answers for the owning note. The web
// capture is listed too -- the list carries no kind, which is why the kind has
// to come from the citation and never from this list.
const N7_DOCUMENTS = { documents: [
  { id: 'd9', attachmentUrl: '/api/j2/notes/attachments/u1/n7/file/q3.pdf', name: 'Q3 10-Q', status: 'ready', pageCount: 80 },
  { id: 'dw', attachmentUrl: 'web:3f2a', name: 'Reuters: NVDA margins', status: 'ready', pageCount: 1 },
] }

function installDocNetwork({ sources, documents = jsonResponse(200, N7_DOCUMENTS), excerpt = jsonResponse(500, {}) }) {
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.endsWith('/api/j2/notes/research/NVDA/summary')) return jsonResponse(200, SUMMARY)
    if (u === '/api/j2/ask/stream') {
      return {
        ok: true, status: 200, json: async () => ({}),
        body: sseBody([
          { type: 'sources', scope: 'security', scopeLabel: 'NVDA research', sources, coverageNotice: null },
          { type: 'final', answer: `Margins compressed ${sources.map((_, i) => `[${i + 1}]`).join(' ')}.` },
        ]),
      }
    }
    if (u.startsWith('/api/j2/notes/') && u.endsWith('/documents')) {
      return typeof documents === 'function' ? documents(u) : documents
    }
    if (u.startsWith('/api/j2/excerpts/')) return excerpt
    throw new Error(`unexpected fetch ${u}`)
  })
}
const askedFor = (prefix) => global.fetch.mock.calls.some(([u]) => String(u).startsWith(prefix))

describe('TickerResearchWorkspace — a DOCUMENT citation opens by its kind', () => {
  it('a PDF page opens in the preview AT the cited page -- not its note at the top', async () => {
    const onOpenNote = vi.fn()
    installDocNetwork({ sources: [PDF_PAGE] })
    renderWorkspace(onOpenNote)
    const ask = await askAndClickCitation(PDF_PAGE.label)

    const sheet = await screen.findByRole('dialog', { name: 'Preview of Q3 10-Q' })
    expect(await within(sheet).findByTestId('pdf-viewer-stub')).toHaveAttribute('data-initial-page', '47')
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/notes/n7/documents',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }))
    expect(onOpenNote).not.toHaveBeenCalled()
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
  })

  it('a captured WEB page opens as a captured passage, NEVER in the PDF viewer', async () => {
    const onOpenNote = vi.fn()
    installDocNetwork({ sources: [WEB_PAGE], excerpt: jsonResponse(200, { excerpt: WEB_PAGE_EXCERPT }) })
    renderWorkspace(onOpenNote)
    await askAndClickCitation(WEB_PAGE.label)

    await screen.findByRole('dialog', { name: 'Captured passage from Reuters: NVDA margins' })
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/excerpts/exw', expect.anything())
    // The PDF door was never even asked: the kind decided, not the list.
    expect(askedFor('/api/j2/notes/n7/documents')).toBe(false)
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('a captured web page whose saved excerpt is gone opens its note -- still never the PDF viewer', async () => {
    const onOpenNote = vi.fn()
    const orphan = { ...WEB_PAGE, navigation: { ...WEB_PAGE.navigation, excerpt_id: undefined } }
    installDocNetwork({ sources: [orphan] })
    renderWorkspace(onOpenNote)
    await askAndClickCitation(orphan.label)

    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith({ id: 'n7' }))
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
  })

  it('a packet with NO kind keeps the old behaviour (its note) -- never a guess', async () => {
    const onOpenNote = vi.fn()
    installDocNetwork({ sources: [OLD_PAGE] })
    renderWorkspace(onOpenNote)
    const ask = await askAndClickCitation(OLD_PAGE.label)

    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith({ id: 'n7' }))
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
    expect(askedFor('/api/j2/notes/n7/documents')).toBe(false)
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
  })

  it('a cited PDF that is gone SAYS so inside the panel', async () => {
    const onOpenNote = vi.fn()
    installDocNetwork({ sources: [PDF_PAGE], documents: jsonResponse(200, { documents: [] }) })
    renderWorkspace(onOpenNote)
    const ask = await askAndClickCitation(PDF_PAGE.label)

    expect(await within(ask).findByText('That document is no longer available.')).toBeInTheDocument()
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('a cited PDF whose NOTE is gone (the list 404s) says the document is gone', async () => {
    installDocNetwork({ sources: [PDF_PAGE], documents: jsonResponse(404, { detail: 'Not found' }) })
    renderWorkspace(vi.fn())
    const ask = await askAndClickCitation(PDF_PAGE.label)

    expect(await within(ask).findByText('That document is no longer available.')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't open that document — try again.")).toBeNull()
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
  })

  it('a failed read is NOT reported as a deleted document', async () => {
    installDocNetwork({ sources: [PDF_PAGE], documents: jsonResponse(500, {}) })
    renderWorkspace(vi.fn())
    const ask = await askAndClickCitation(PDF_PAGE.label)

    expect(await within(ask).findByText("Couldn't open that document — try again.")).toBeInTheDocument()
    expect(screen.queryByText('That document is no longer available.')).toBeNull()
  })

  it('the LAST tap wins here too: a slow document read never opens over the second', async () => {
    const B = {
      ...PDF_PAGE, n: 2, label: 'Q2 10-Q · p.9',
      navigation: { kind: 'document', document_id: 'd8', page_number: 9, note_id: 'n8', source_kind: 'attachment' },
    }
    let releaseA
    installDocNetwork({
      sources: [PDF_PAGE, B],
      documents: (u) => (u === '/api/j2/notes/n7/documents'
        // A slow read that IGNORES its abort signal: the opener drops it itself.
        ? new Promise((r) => { releaseA = () => r(jsonResponse(200, N7_DOCUMENTS)) })
        : jsonResponse(200, { documents: [
          { id: 'd8', attachmentUrl: '/api/j2/notes/attachments/u1/n8/file/q2.pdf', name: 'Q2 10-Q' }] })),
    })
    renderWorkspace(vi.fn())
    const ask = await askAndClickCitation(PDF_PAGE.label)
    fireEvent.click(await within(ask).findByRole('button', { name: `Source 2: ${B.label}` }))

    await screen.findByRole('dialog', { name: 'Preview of Q2 10-Q' })
    await act(async () => { releaseA() })

    expect(screen.queryByRole('dialog', { name: 'Preview of Q3 10-Q' })).toBeNull()
    expect(screen.getByTestId('pdf-viewer-stub')).toHaveAttribute('data-initial-page', '9')
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
  })
})
