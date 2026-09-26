import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

/**
 * Wave 6 whole-branch review I-2 — the Tasks view is MOUNTED, as the Notebook's
 * seventh view mode, and `?view=tasks` opens it.
 *
 * ⚰️ `NoteTasksView.jsx` was built, tested (its own file, 9 green) and imported by
 * nothing, while the default-ON task reminder linked every member to
 * `/journal/notebook?view=tasks` (note_tasks.py TASKS_VIEW_URL) — which landed on
 * Research Home. The component's own tests are structurally blind to a missing
 * mount; this file renders the REAL NoteTasksView inside the real tab and reads
 * its rendered text, so cutting the wire reds it (and `reachable.test.js`).
 */
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [{ id: 'n1', title: 'A', tags: [] }], isLoading: false, error: null, refresh: vi.fn(),
    mutate: vi.fn(), total: 1, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({ default: () => <div data-testid="folder-sidebar" /> }))
vi.mock('../components/notebook/NoteEditorPage', () => ({
  default: ({ noteId }) => <div data-testid="note-editor" data-note-id={noteId} />,
}))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))

import NotebookTab from './NotebookTab'

const TASKS = {
  today: '2026-09-25',
  truncated: false,
  tasks: [
    { noteId: 'n7', noteTitle: 'NVDA thesis', index: 2, text: 'Trim NVDA into earnings', checked: false, due: '2026-09-25' },
  ],
}

beforeEach(() => {
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.startsWith('/api/j2/notes/tasks')) return { ok: true, json: async () => TASKS }
    if (u.startsWith('/api/j2/saved-views')) return { ok: true, json: async () => ({ savedViews: [] }) }
    return { ok: true, json: async () => ({}) }
  })
})

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.search}</output>
}

const renderTab = (entry) => render(
  <MemoryRouter initialEntries={[entry]}><NotebookTab /><Where /></MemoryRouter>,
)

describe('the Tasks view is mounted (review I-2)', () => {
  it('`?view=tasks` — the reminder’s link — opens the Tasks view, not Research Home', async () => {
    renderTab('/journal/notebook?view=tasks')
    // The REAL component's rendered words, not a stub's test id.
    expect(await screen.findByText('Trim NVDA into earnings')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /tasks/i })).toBeInTheDocument()
    expect(screen.getByText('To tick a task off, open its note.')).toBeInTheDocument()
    expect(screen.queryByTestId('research-home')).toBeNull()
    expect(global.fetch.mock.calls.some(([u]) => String(u) === '/api/j2/notes/tasks?status=open')).toBe(true)
    // A one-shot instruction: applied, then the URL is the explicit All-notes state.
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?view=all'))
    expect(screen.getByRole('button', { name: 'Tasks view' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('is offered in the view switcher, beside the others', async () => {
    renderTab('/journal/notebook?view=all')
    expect(screen.queryByText('Trim NVDA into earnings')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tasks view' }))
    expect(await screen.findByText('Trim NVDA into earnings')).toBeInTheDocument()
  })

  it('offers no Save view — a tasks list is not a saveable view type', async () => {
    renderTab('/journal/notebook?view=all')
    expect(screen.getByRole('button', { name: /save view/i })).toBeInTheDocument()  // control
    fireEvent.click(screen.getByRole('button', { name: 'Tasks view' }))
    await screen.findByText('Trim NVDA into earnings')
    expect(screen.queryByRole('button', { name: /save view/i })).toBeNull()
  })

  it('a task row opens its note AT that task, through the tab’s own door', async () => {
    renderTab('/journal/notebook?view=tasks')
    fireEvent.click(await screen.findByRole('button', { name: /Trim NVDA into earnings/ }))
    const editor = await screen.findByTestId('note-editor')
    expect(editor.dataset.noteId).toBe('n7')
    const params = new URLSearchParams(screen.getByTestId('where').textContent)
    expect(params.get('note')).toBe('n7')
    expect(params.get('task')).toBe('2')
    expect(params.get('view')).toBeNull()
  })
})
