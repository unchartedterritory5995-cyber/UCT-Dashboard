/**
 * Fin walk 8.3 — "From the whole Notebook a citation opens the cited note, not a
 * passage in it. Inside a note it lands on the passage."
 *
 * The REAL pieces, end to end: the real NotebookTab routes the open; the real
 * ResearchHome renders the real AskPanel (its SSE parser, its citation buttons);
 * the real `openSpanningCitation` hands the passage to the tab's own `openNote`;
 * the real NoteEditorPage mounts the real TipTap editor and lands on it. Only the
 * data hooks and the heavy siblings the tab mounts beside the editor are stubbed,
 * the same harness NotebookTab.menuUnlock.test.jsx runs on. `fetch` is the seam.
 *
 * What it reads is the editor's OWN selection (`editor.state.selection`), the
 * landing the member sees, never a mock of it: cut the passage out of the open
 * (openCitation.js), or the landing effect out of the editor, and the first case
 * reds on a selection that never moved off the note's start.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

// jsdom has no layout: a selection scrolled into view measures a Range.
Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const PLAN_TEXT = 'CRWD breakout plan. Planned entry 412.50 on a close above the base high.'
const STOP_TEXT = 'Stop 398 under the pivot low, target 455.'
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTE = {
  id: 'n1', title: 'CRWD plan', subtitle: '', folderId: null, ticker: 'CRWD', tags: [],
  heroImageUrl: null, updatedAt: '2026-10-01T00:00:00Z', isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [P(PLAN_TEXT), P(STOP_TEXT)] },
}
// ProseMirror positions of the word "entry" in that doc: the first paragraph
// opens at position 1, so a text offset k inside it is position 1 + k.
const ENTRY_FROM = 1 + PLAN_TEXT.indexOf('entry')
const ENTRY_TO = ENTRY_FROM + 'entry'.length
// Positions of "pivot" in the second paragraph: 1 (open p1) + len + 1 (close p1) + 1 (open p2).
const PIVOT_FROM = 1 + PLAN_TEXT.length + 2 + STOP_TEXT.indexOf('pivot')
const PIVOT_TO = PIVOT_FROM + 'pivot'.length

/** What ask_retrieval._note_passage sends for "My Notebook": the snippet is the
 *  whole note, the location is the matched word's own range WITH its text. */
const noteSource = (location, extra = {}) => ({
  n: 1, type: 'note', label: 'CRWD plan', citation: 'exact',
  snippet: `${PLAN_TEXT}\n${STOP_TEXT}`,
  navigation: { kind: 'note', note_id: 'n1' },
  location, payload: {}, stance: null, textOrigin: null, truncated: false,
  ...extra,
})
const LOCATED = noteSource({
  from: ENTRY_FROM, to: ENTRY_TO, fingerprint: 'fp:1',
  snippet_start: PLAN_TEXT.indexOf('entry'), snippet_end: PLAN_TEXT.indexOf('entry') + 5, text: 'entry',
})

const HOME = {
  continueWorking: [{ id: 'n1', title: 'CRWD plan', updatedAt: NOTE.updatedAt, propertiesJson: {} }],
  favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [],
}

const { noteStore } = vi.hoisted(() => ({ noteStore: {} }))
vi.mock('../../../hooks/useBreakpoint', async (importOriginal) => ({
  ...(await importOriginal()),
  useIsDesktop: () => true,
}))
vi.mock('../../../context/AuthContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useAuth: () => ({ user: { id: 'u42', role: 'member' }, isPaid: true }),
  useIsPaid: () => true,
}))
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [{ id: 'n1', title: 'CRWD plan', tags: [] }], isLoading: false, error: null, refresh: vi.fn(),
    mutate: vi.fn(), total: 1, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
  useJ2Note: (noteId) => ({
    note: noteStore[noteId] ?? null,
    isLoading: !noteStore[noteId],
    update: async (patch) => ({ ...noteStore[noteId], ...patch }),
    refresh: vi.fn(),
  }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../components/notebook/FolderSidebar', () => ({ default: () => <div data-testid="folder-sidebar" /> }))
vi.mock('../components/notebook/NoteBoardView', () => ({ default: () => null }))
vi.mock('../components/notebook/NoteGraphView', () => ({ default: () => null }))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../../../hub/useHubActive', async (importOriginal) => ({
  ...(await importOriginal()),
  useHubEligible: () => false,
}))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))

import NotebookTab from './NotebookTab'

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

function installNetwork(source) {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u === '/api/j2/notebook/home') return json(200, HOME)
    if (u === '/api/j2/ask/stream') {
      return {
        ok: true, status: 200, json: async () => ({}),
        body: sseBody([
          { type: 'sources', scope: 'notebook', scopeLabel: 'My Notebook', sources: [source], coverageNotice: null },
          { type: 'final', answer: 'The plan was an entry at 412.50 [1].' },
        ]),
      }
    }
    if (u === '/api/j2/notes/n1/documents') return json(200, { documents: [] })
    if (u === '/api/j2/notes/n1/excerpts') return json(200, { excerpts: [] })
    if (u.startsWith('/api/j2/saved-views')) return json(200, { savedViews: [] })
    return json(200, {})
  })
}

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.search}</output>
}

const realFetch = globalThis.fetch
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  noteStore.n1 = { ...NOTE }
})
afterEach(() => { globalThis.fetch = realFetch; vi.clearAllMocks() })

const renderTab = (entry = '/journal/notebook') => render(
  <MemoryRouter initialEntries={[entry]}><NotebookTab /><Where /></MemoryRouter>,
)

/** Research Home → Ask → tap the one citation. Returns the editor that opened. */
async function askAndTap() {
  fireEvent.click(await screen.findByRole('button', { name: 'Ask a question about my notebook' }))
  const ask = await screen.findByRole('dialog', { name: /Ask/ })
  fireEvent.change(within(ask).getByRole('textbox'), { target: { value: 'what was the entry?' } })
  fireEvent.click(within(ask).getByRole('button', { name: 'Ask' }))
  fireEvent.click(await within(ask).findByRole('button', { name: 'Source 1: CRWD plan' }))
  return mountedEditor()
}

const mountedEditor = () => waitFor(() => {
  const el = document.querySelector('.ProseMirror')
  if (!el?.editor) throw new Error('editor not mounted')
  return el.editor
}, { timeout: 8000 })

const selectionOf = (editor) => {
  const { from, to } = editor.state.selection
  return { from, to, text: editor.state.doc.textBetween(from, to) }
}
const settle = () => new Promise((r) => setTimeout(r, 120))

describe('a "My Notebook" citation opens the note AT the cited passage (fin walk 8.3)', () => {
  it('the note opens, and the editor\'s selection IS the cited word, scrolled into view', async () => {
    installNetwork(LOCATED)
    renderTab()
    const editor = await askAndTap()
    expect(new URLSearchParams(screen.getByTestId('where').textContent).get('note')).toBe('n1')

    await waitFor(() => expect(selectionOf(editor)).toEqual({ from: ENTRY_FROM, to: ENTRY_TO, text: 'entry' }))
    // The in-note landing's own contract: a text passage is a TextSelection, not a node.
    expect(editor.state.selection.constructor.name).toBe('TextSelection')
  }, 20000)

  it('a passage whose positions went stale (the note changed) is re-found by its text and still landed on', async () => {
    // The server located "pivot" in a doc that had an extra opening line; this
    // doc does not, so the stored positions read the wrong characters.
    installNetwork(noteSource({
      from: PIVOT_FROM + 12, to: PIVOT_TO + 12, fingerprint: 'fp:old',
      snippet_start: 0, snippet_end: 5, text: 'pivot',
    }))
    renderTab()
    const editor = await askAndTap()
    await waitFor(() => expect(selectionOf(editor)).toEqual({ from: PIVOT_FROM, to: PIVOT_TO, text: 'pivot' }))
  }, 20000)

  it('a passage the note no longer holds: the note opens, nothing is selected, nothing is said', async () => {
    installNetwork(noteSource({
      from: ENTRY_FROM, to: ENTRY_TO, fingerprint: 'fp:old', snippet_start: 0, snippet_end: 5, text: 'gamma',
    }))
    renderTab()
    const editor = await askAndTap()
    await settle()
    expect(new URLSearchParams(screen.getByTestId('where').textContent).get('note')).toBe('n1')
    expect(editor.state.selection.empty).toBe(true)
    // ⛔ Never a confident mis-landing: the stale range reads "entry", and it is NOT selected.
    expect(selectionOf(editor).text).not.toBe('entry')
    expect(screen.queryByText(/can't be pinpointed/)).toBeNull()
    expect(screen.queryByText(/no longer available/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  }, 20000)

  it('CONTROL: a note-level citation (no range) opens the note exactly as before -- at its start', async () => {
    installNetwork(noteSource({}, { citation: 'note_only', snippet: PLAN_TEXT }))
    renderTab()
    const editor = await askAndTap()
    await settle()
    expect(new URLSearchParams(screen.getByTestId('where').textContent).get('note')).toBe('n1')
    expect(editor.state.selection.empty).toBe(true)
  }, 20000)

  it('NON-VACUITY: a plain open of the same note leaves the selection where a fresh editor puts it', async () => {
    installNetwork(LOCATED)
    renderTab('/journal/notebook?note=n1')
    const editor = await mountedEditor()
    await settle()
    expect(editor.state.selection.empty).toBe(true)
    expect(selectionOf(editor).text).toBe('')
  }, 20000)
})
