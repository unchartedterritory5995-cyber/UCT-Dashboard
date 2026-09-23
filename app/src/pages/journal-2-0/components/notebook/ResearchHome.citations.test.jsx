import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

// ⛔ "MY NOTEBOOK" ANSWERED AN EXCERPT CITATION WITH A DEAD CLICK. Its
// navigation carries no `note_id`, and Research Home's handler knew nothing
// else. It now goes through the one shared router (lib/openCitation.js).
//
// Everything is REAL except the network and the pdfjs canvas: the real
// useNotebookHome over SWR, the real AskPanel and its SSE parser, the real
// DocumentPreviewSheet and CapturedSourceSheet. The PdfDocumentViewer stub (the
// same stub every Notebook test uses -- jsdom has no Worker/Canvas2D) reports
// the props it RECEIVED.
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

import ResearchHome from './ResearchHome'

const HOME = {
  continueWorking: [{ id: 'n1', title: 'NVDA research note', updatedAt: '2026-09-01T00:00:00Z', propertiesJson: {} }],
  favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [],
}

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
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function installNetwork({ source = EXCERPT_SOURCE, excerpt }) {
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u === '/api/j2/notebook/home') return json(200, HOME)
    if (u === '/api/j2/ask/stream') {
      return {
        ok: true, status: 200, json: async () => ({}),
        body: sseBody([
          { type: 'sources', scope: 'notebook', scopeLabel: 'My Notebook', sources: [source], coverageNotice: null },
          { type: 'final', answer: 'Margins compressed [1].' },
        ]),
      }
    }
    if (u.startsWith('/api/j2/excerpts/')) return excerpt
    throw new Error(`unexpected fetch ${u}`)
  })
}

function renderHome(onOpenNote) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        <ResearchHome hasAnyNotes onOpenNote={onOpenNote} onCreateNote={vi.fn()}
                      onCreateThesis={vi.fn()} onImport={vi.fn()} />
      </MemoryRouter>
    </SWRConfig>,
  )
}

async function askAndTap(label) {
  fireEvent.click(await screen.findByRole('button', { name: 'Ask a question about my notebook' }))
  const ask = await screen.findByRole('dialog', { name: /Ask/ })
  fireEvent.change(within(ask).getByRole('textbox'), { target: { value: 'margins?' } })
  fireEvent.click(within(ask).getByRole('button', { name: 'Ask' }))
  fireEvent.click(await within(ask).findByRole('button', { name: `Source 1: ${label}` }))
  return ask
}

const realFetch = global.fetch
afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks() })

describe('Research Home ("My Notebook") — citations', () => {
  it('an EXCERPT opens its PDF at the cited page, emphasising the passage', async () => {
    const onOpenNote = vi.fn()
    installNetwork({ excerpt: json(200, { excerpt: PDF_EXCERPT }) })
    renderHome(onOpenNote)
    await askAndTap(EXCERPT_SOURCE.label)

    const sheet = await screen.findByRole('dialog', { name: 'Preview of Q3 filing.pdf' })
    const viewer = await within(sheet).findByTestId('pdf-viewer-stub')
    expect(viewer).toHaveAttribute('data-initial-page', '4')
    expect(viewer).toHaveAttribute('data-emphasize', 'ex1')
    expect(viewer.getAttribute('data-excerpts').split(',')).toContain('ex1')
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('a captured WEB passage opens as a captured passage, and its note door works', async () => {
    const onOpenNote = vi.fn()
    installNetwork({ excerpt: json(200, { excerpt: WEB_EXCERPT }) })
    renderHome(onOpenNote)
    await askAndTap(EXCERPT_SOURCE.label)

    const sheet = await screen.findByRole('dialog', { name: 'Captured passage from Reuters: NVDA margins' })
    expect(screen.queryByTestId('pdf-viewer-stub')).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: /Open the note it lives in/ }))
    expect(onOpenNote).toHaveBeenCalledWith({ id: 'n7' })
  })

  it('a deleted passage is said inside the Ask panel', async () => {
    installNetwork({ excerpt: json(404, { detail: 'Not found' }) })
    renderHome(vi.fn())
    const ask = await askAndTap(EXCERPT_SOURCE.label)

    expect(await within(ask).findByText('That passage is no longer available.')).toBeInTheDocument()
    expect(within(ask).getByTestId('ask-nav-notice')).toHaveAttribute('role', 'status')
  })

  it('a source with no destination says so instead of doing nothing', async () => {
    const onOpenNote = vi.fn()
    const fact = {
      ...EXCERPT_SOURCE, type: 'financial_fact', label: 'gross_margin · NVDA', citation: 'record_only',
      navigation: { kind: 'fact', fact_id: 'f1', note_id: null }, location: {},
    }
    installNetwork({ source: fact, excerpt: json(500, {}) })
    renderHome(onOpenNote)
    const ask = await askAndTap(fact.label)

    expect(await within(ask).findByText("That source can't be opened from here.")).toBeInTheDocument()
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('CONTROL: a note citation still opens its note, and says nothing', async () => {
    const onOpenNote = vi.fn()
    const note = {
      ...EXCERPT_SOURCE, type: 'note', label: 'NVDA thesis',
      navigation: { kind: 'note', note_id: 'n1' }, location: {},
    }
    installNetwork({ source: note, excerpt: json(500, {}) })
    renderHome(onOpenNote)
    const ask = await askAndTap(note.label)

    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith({ id: 'n1' }))
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
  })
})
