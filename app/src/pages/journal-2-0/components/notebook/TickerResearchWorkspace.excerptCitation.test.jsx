import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
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
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/excerpts/ex1', { credentials: 'include' })
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
