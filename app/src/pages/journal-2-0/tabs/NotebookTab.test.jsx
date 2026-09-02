import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Heavy children + data hook are stubbed — these tests are about the tab's own
// template-picker wiring (toolbar sheet, empty state, deep link), not the note
// list or the editor.
const mockRefresh = vi.fn()
const mockLoadMore = vi.fn()
// A vi.fn() wrapper (not a bare factory) so individual tests can distinguish
// the tab's TWO useJ2Notes calls by their args — the main (filtered) list vs
// the sidebar's unfiltered `sort: 'title'` fetch — the way FolderSidebar's
// own test file already does for its multiple hook calls.
const useJ2NotesMock = vi.fn(() => ({
  notes: [], isLoading: false, error: null, refresh: mockRefresh, mutate: vi.fn(),
  total: 0, hasMore: false, loadMore: mockLoadMore, isLoadingMore: false,
}))
vi.mock('../hooks/useJ2Notes', () => ({
  default: (...args) => useJ2NotesMock(...args),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({
  default: () => <div data-testid="folder-sidebar" />,
}))
vi.mock('../components/notebook/NoteCard', () => ({
  default: () => <div data-testid="note-card" />,
}))
vi.mock('../components/notebook/NoteEditorPage', () => ({
  default: ({ noteId }) => <div data-testid="note-editor" data-note-id={noteId} />,
}))
vi.mock('../components/notebook/import/ImportWizard', () => ({
  // Shallow mock — a real "onImported" trigger button lets tests fire the
  // callback without exercising the real wizard's drop/scan/preview flow.
  default: ({ open, onImported }) => (
    open ? (
      <div data-testid="import-wizard">
        <button type="button" onClick={onImported}>fire onImported</button>
      </div>
    ) : null
  ),
}))
// Shallow mock — has its own SWR fetch + dedicated test file
// (NoteConnectorsTrustStrip.test.jsx); these tests are about the tab's own
// wiring, and leaving it real just adds an async fetch nobody here awaits.
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({
  default: () => null,
}))

import NotebookTab from './NotebookTab'

let lastPostBody = null

beforeEach(() => {
  lastPostBody = null
  mockRefresh.mockClear()
  mockLoadMore.mockClear()
  useJ2NotesMock.mockReset()
  useJ2NotesMock.mockImplementation(() => ({
    notes: [], isLoading: false, error: null, refresh: mockRefresh, mutate: vi.fn(),
    total: 0, hasMore: false, loadMore: mockLoadMore, isLoadingMore: false,
  }))
  global.fetch = vi.fn((url, opts) => {
    if (opts?.method === 'POST') {
      lastPostBody = JSON.parse(opts.body)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'new1' } }) })
    }
    // Template-context lookups (breadth / positions / game-plan) — empty data.
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})

function renderTab(entry = '/journal') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NotebookTab />
    </MemoryRouter>,
  )
}

const lastPost = () => {
  const call = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST')
  return call ? { url: String(call[0]) } : null
}

describe('NotebookTab — template picker', () => {
  it('empty notebook renders the picker inline with all families', () => {
    renderTab()
    expect(screen.getByText('Daily & weekly rituals')).toBeInTheDocument()
    expect(screen.getByText('Around a trade')).toBeInTheDocument()
    expect(screen.getByText('Mindset')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Daily Game Plan/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Blank note/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /My Playbook/ })).toBeInTheDocument()
  })

  it('the Templates button opens the sheet picker (second picker instance)', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    expect(screen.getAllByRole('button', { name: /Tilt Log/ }).length).toBeGreaterThanOrEqual(2)
  })

  it('picking Daily Game Plan POSTs seeded body + template title + preset tags', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Daily Game Plan/ }))
    await waitFor(() => expect(lastPostBody).not.toBeNull())
    expect(lastPost().url).toBe('/api/j2/notes')
    expect(lastPostBody.title).toMatch(/^Game Plan — /)
    expect(lastPostBody.tags).toEqual(['game-plan'])
    expect(lastPostBody.bodyJson.type).toBe('doc')
    expect(lastPostBody.bodyJson.content.length).toBeGreaterThan(0)
  })

  it('picking Blank note POSTs with no bodyJson (existing blank behavior)', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Blank note/ }))
    await waitFor(() => expect(lastPostBody).not.toBeNull())
    expect(lastPostBody.title).toBe('')
    expect(lastPostBody.bodyJson).toBeUndefined()
    expect(lastPostBody.tags).toBeUndefined()
  })

  it('the primary "+ New note" button still creates a blank note', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ New note' }))
    await waitFor(() => expect(lastPostBody).not.toBeNull())
    expect(lastPostBody.title).toBe('')
    expect(lastPostBody.bodyJson).toBeUndefined()
  })

  it('opens the editor for the created note after a template pick', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Weekly Review/ }))
    const editor = await screen.findByTestId('note-editor')
    expect(editor).toHaveAttribute('data-note-id', 'new1')
  })

  it('?new=<key> deep link auto-creates the template with its ticker', async () => {
    renderTab('/journal/notebook?new=earnings-play&ticker=gh')
    await waitFor(() => expect(lastPostBody).not.toBeNull())
    expect(lastPostBody.title).toBe('Earnings Play — GH')
    expect(lastPostBody.tags).toEqual(['earnings'])
    expect(lastPostBody.ticker).toBe('GH')
  })

  it('an unknown ?new= key strips quietly without creating anything', async () => {
    renderTab('/journal/notebook?new=not-a-template')
    // give the effect a tick to run
    await new Promise((r) => setTimeout(r, 50))
    expect(lastPostBody).toBeNull()
  })
})

describe('NotebookTab — import', () => {
  it('header AND empty-state each expose an Import entry point; the empty-state one opens the wizard', () => {
    renderTab()
    expect(screen.queryByTestId('import-wizard')).not.toBeInTheDocument()
    // On <=640px the toolbar row stacks above the (scrollable) list, so the
    // empty state needs its OWN Import CTA in view — not just the header's.
    const importButtons = screen.getAllByRole('button', { name: /import/i })
    expect(importButtons.length).toBeGreaterThanOrEqual(2)
    // DOM order: header toolbar renders before the empty-state pitch, so the
    // empty-state button is the last match.
    fireEvent.click(importButtons[importButtons.length - 1])
    expect(screen.getByTestId('import-wizard')).toBeInTheDocument()
  })

  it('the header Import button also opens the wizard', () => {
    renderTab()
    const importButtons = screen.getAllByRole('button', { name: /import/i })
    fireEvent.click(importButtons[0])
    expect(screen.getByTestId('import-wizard')).toBeInTheDocument()
  })

  it('empty state pitches the import path', () => {
    renderTab()
    expect(screen.getByText(/Notion, Obsidian, Evernote/i)).toBeInTheDocument()
  })

  it('a completed import (ImportWizard calling onImported) refreshes notes', () => {
    renderTab()
    fireEvent.click(screen.getAllByRole('button', { name: /import/i })[0])
    expect(mockRefresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('fire onImported'))
    expect(mockRefresh).toHaveBeenCalled()
  })
})

describe('NotebookTab — pagination (Task 11: the browse path must survive a migrated library)', () => {
  // The sidebar's OWN unfiltered `sort: 'title'` fetch shares this same
  // mocked hook — route it to an empty, harmless response so these
  // assertions are only about the main (filtered) list's wiring.
  function mockMainList({ notes, total, hasMore = false, isLoadingMore = false }) {
    useJ2NotesMock.mockImplementation((opts) => {
      if (opts?.sort === 'title') {
        return { notes: [], isLoading: false, error: null, refresh: vi.fn(), mutate: vi.fn(), total: 0, hasMore: false, loadMore: vi.fn(), isLoadingMore: false }
      }
      return { notes, isLoading: false, error: null, refresh: mockRefresh, mutate: vi.fn(), total, hasMore, loadMore: mockLoadMore, isLoadingMore }
    })
  }

  it('shows how many of how many notes are loaded — the honest count, not a silent 100-row wall', () => {
    mockMainList({ notes: [{ id: 'n1', title: 'A' }], total: 250, hasMore: true })
    renderTab()
    expect(screen.getByText('Showing 1 of 250 notes')).toBeInTheDocument()
  })

  it('renders "Load more" only while more of the total remains unloaded', () => {
    mockMainList({ notes: [{ id: 'n1', title: 'A' }], total: 1, hasMore: false })
    renderTab()
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 1 note')).toBeInTheDocument()
  })

  it('clicking "Load more" calls the hook\'s loadMore — fetching the next page is delegated, not reimplemented here', () => {
    mockMainList({ notes: [{ id: 'n1', title: 'A' }], total: 250, hasMore: true })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    expect(mockLoadMore).toHaveBeenCalledTimes(1)
  })

  it('disables the control and says so while a page is in flight', () => {
    mockMainList({ notes: [{ id: 'n1', title: 'A' }], total: 250, hasMore: true, isLoadingMore: true })
    renderTab()
    const btn = screen.getByRole('button', { name: /loading/i })
    expect(btn).toBeDisabled()
  })
})
