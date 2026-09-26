// app/src/pages/journal-2-0/a11y/panels.a11y.test.jsx
//
// A1: the Notebook's side panels — the folder sidebar (a folder in edit mode,
// the tag list, the search view), the Ask panel (an answer with citations, and
// a refusal), the Ticker Research Workspace, and the linked-notes panel the
// trade pages show. Real components over the fixture network.
import { describe, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers, NOTES, noteDetail } from './fixtures'
import { axeSurface } from './surface'
import FolderSidebar from '../components/notebook/FolderSidebar'
import AskPanel from '../components/notebook/AskPanel'
import TickerResearchWorkspace from '../components/notebook/TickerResearchWorkspace'
import LinkedNotesPanel from '../components/notebook/LinkedNotesPanel'

vi.mock('../components/notebook/PdfDocumentViewer', () => ({ default: () => <div data-testid="pdf-viewer-stub" /> }))

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

function renderSidebar(props = {}) {
  render(
    <Providers>
      <FolderSidebar
        notes={NOTES}
        notesTotal={NOTES.length}
        activeFolderId={null}
        onSelectFolder={() => {}}
        activeTag={null}
        onSelectTag={() => {}}
        onOpenNote={() => {}}
        savedViews={[{ id: 'v1', name: 'Active theses', viewType: 'list', spec: {} }]}
        onRenameTag={async () => {}}
        {...props}
      />
    </Providers>,
  )
}

describe('folder sidebar', () => {
  beforeEach(() => { installFetch(); latchWave8Flags(true) })

  axeSurface('folder-sidebar-edit', async () => {
    renderSidebar()
    const row = (await screen.findAllByText('Theses'))[0].closest('button')
    fireEvent.doubleClick(row)
    await waitFor(() => expect(document.querySelector('input[value="Theses"]')).not.toBeNull())
  })

  axeSurface('folder-sidebar-tags', async () => {
    renderSidebar({ activeTag: 'semis' })
    await screen.findByText('#semis')
    await screen.findAllByText('Theses')
    // the add-subfolder form open too: every inline field in one run
    await settle()
  })

  axeSurface('folder-sidebar-search', async () => {
    renderSidebar()
    fireEvent.click(await screen.findByRole('tab', { name: 'Search notes' }))
    const input = await screen.findByPlaceholderText('Search notes…')
    fireEvent.change(input, { target: { value: 'thesis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search filters' }))
    await screen.findByText('Note created from')
    await settle(400)
  })
})

function sse(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

function withAskStream(events) {
  const base = installFetch()
  global.fetch = vi.fn((url, init) => {
    if (String(url).includes('/api/j2/ask/stream')) {
      return Promise.resolve({ ok: true, status: 200, body: sse(events), json: async () => ({}) })
    }
    return base(url, init)
  })
}

const SOURCE = {
  n: 1, type: 'note', label: 'NVDA thesis', citation: 'exact', snippet: 'margins compressed in Q3',
  navigation: { kind: 'note', note_id: 'n1' }, location: { from: 1, to: 25, fingerprint: 'abc:12' },
  payload: {}, stance: null, truncated: false,
}
const head = (extra = {}) => ({
  type: 'sources', scope: 'note', scopeLabel: 'This note', sources: [SOURCE],
  coverageNotice: null, independentSources: 1, noAnswer: false, ...extra,
})

async function ask(events) {
  withAskStream(events)
  render(<Providers><AskPanel scope="note" target="n1" autoOpen onInsert={() => {}} /></Providers>)
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'margins?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  await screen.findByTestId('ask-answer')
  await settle()
}

describe('Ask panel', () => {
  beforeEach(() => { latchWave8Flags(true) })

  axeSurface('ask-panel', async () => {
    await ask([head(), { type: 'delta', text: 'Margins fell [1].' },
      { type: 'final', answer: 'Margins fell [1].', cited: [1], invalidCitations: [] }])
    screen.getByRole('button', { name: 'Source 1: NVDA thesis' })
  })

  axeSurface('ask-insert-picker', async () => {
    // G-064: outside a note, "Insert into a note…" opens the picker (AskInsertPicker).
    latchWave8Flags(true, { notebook_ask_insert_on: true })
    withAskStream([head(), { type: 'delta', text: 'Margins fell [1].' },
      { type: 'final', answer: 'Margins fell [1].', cited: [1], invalidCitations: [] }])
    render(<Providers><AskPanel scope="notebook" target={null} autoOpen onOpenNote={() => {}} /></Providers>)
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'margins?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByTestId('ask-answer')
    fireEvent.click(await screen.findByRole('button', { name: 'Insert into a note…' }))
    await settle(350)
    expect(screen.queryByRole('button', { name: 'Insert into a note…' })).toBeNull()
  })

  axeSurface('ask-panel-refusal', async () => {
    await ask([head({ sources: [], noAnswer: true }),
      { type: 'final', answer: "Your notes don't say.", cited: [], invalidCitations: [] }])
  })
})

const SUMMARY = {
  identity: { symbol: 'NVDA', entityId: 'e1', displayName: 'NVIDIA Corporation', symbols: ['NVDA'] },
  notes: [NOTES[1]],
  activeTheses: [NOTES[0]],
  pastTheses: [{ ...NOTES[2], id: 'n9', title: 'Old NVDA call', propertiesJson: { 'builtin:thesis_status': 'closed' } }],
  facts: [{ id: 'fa1', noteId: 'n1', factLabel: 'EPS (Q2)', value: 1.24, unit: 'usd_per_share', observedAt: '2026-09-10T00:00:00Z' }],
  documents: [{ id: 'd1', noteId: 'n1', name: 'NVDA 10-Q', status: 'ready', pageCount: 42, attachmentUrl: '/api/j2/notes/attachments/u1/n1/file/q.pdf', sourceKind: 'attachment', createdAt: '2026-09-01T00:00:00Z' }],
  tradeSummary: { openPositions: 1, closedTrades: 2 },
}

describe('research + linked notes', () => {
  beforeEach(() => {
    installFetch([
      [/^\/api\/j2\/notes\/research\/[^/]+\/summary$/, SUMMARY],
      [/^\/api\/j2\/notes\/by-trade-ref$/, { notes: [NOTES[0], NOTES[1]] }],
    ])
    latchWave8Flags(true)
  })

  axeSurface('ticker-research', async () => {
    render(<Providers><TickerResearchWorkspace symbol="NVDA" onOpenNote={() => {}} /></Providers>)
    await screen.findByText('NVIDIA Corporation')
    await screen.findByText('Captured facts')
    void noteDetail
  }, { level: 'page' })

  axeSurface('linked-notes-panel', async () => {
    render(<Providers><LinkedNotesPanel tradeRef="t1" tradeRefType="trade" /></Providers>)
    await screen.findByTestId('linked-notes-panel')
  })
})
