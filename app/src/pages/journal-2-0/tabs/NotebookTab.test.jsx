import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Heavy children + data hook are stubbed — this test is about the tab's own
// "New from template" wiring, not the note list or the editor.
const mockRefresh = vi.fn()
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({ notes: [], isLoading: false, error: null, refresh: mockRefresh }),
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

import NotebookTab from './NotebookTab'

let lastPostBody = null

beforeEach(() => {
  lastPostBody = null
  mockRefresh.mockClear()
  global.fetch = vi.fn((url, opts) => {
    if (opts?.method === 'POST') lastPostBody = JSON.parse(opts.body)
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'new1' } }) })
  })
})

function renderTab() {
  return render(
    <MemoryRouter initialEntries={['/journal']}>
      <NotebookTab />
    </MemoryRouter>,
  )
}

describe('NotebookTab — template menu', () => {
  it('renders Blank note + the three templates when the menu is opened', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'New from template' }))
    expect(screen.getByRole('menuitem', { name: 'Blank note' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Trade Review' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Weekly Plan' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Daily Prep' })).toBeInTheDocument()
  })

  it('the menu is closed by default (no menuitems shown)', () => {
    renderTab()
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('picking "Trade Review" POSTs a seeded bodyJson doc + the template title', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'New from template' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trade Review' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, opts] = global.fetch.mock.calls[0]
    expect(String(url)).toBe('/api/j2/notes')
    expect(opts.method).toBe('POST')
    expect(lastPostBody.title).toBe('Trade Review')
    expect(lastPostBody.bodyJson.type).toBe('doc')
    expect(lastPostBody.bodyJson.content.length).toBeGreaterThan(0)
  })

  it('picking "Blank note" POSTs with no bodyJson (existing blank behavior)', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'New from template' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Blank note' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(lastPostBody.title).toBe('')
    expect(lastPostBody.bodyJson).toBeUndefined()
  })

  it('the primary "+ New note" button still creates a blank note', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '+ New note' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(lastPostBody.title).toBe('')
    expect(lastPostBody.bodyJson).toBeUndefined()
  })

  it('opens the editor for the created note after a template pick', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'New from template' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Weekly Plan' }))
    const editor = await screen.findByTestId('note-editor')
    expect(editor).toHaveAttribute('data-note-id', 'new1')
  })
})
