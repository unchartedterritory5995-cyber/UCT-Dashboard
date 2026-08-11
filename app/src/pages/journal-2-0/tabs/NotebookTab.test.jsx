import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Heavy children + data hook are stubbed — these tests are about the tab's own
// template-picker wiring (toolbar sheet, empty state, deep link), not the note
// list or the editor.
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
vi.mock('../components/notebook/import/ImportWizard', () => ({
  default: ({ open }) => (open ? <div data-testid="import-wizard" /> : null),
}))

import NotebookTab from './NotebookTab'

let lastPostBody = null

beforeEach(() => {
  lastPostBody = null
  mockRefresh.mockClear()
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
    renderTab('/journal?seg=notebook&new=earnings-play&ticker=gh')
    await waitFor(() => expect(lastPostBody).not.toBeNull())
    expect(lastPostBody.title).toBe('Earnings Play — GH')
    expect(lastPostBody.tags).toEqual(['earnings'])
    expect(lastPostBody.ticker).toBe('GH')
  })

  it('an unknown ?new= key strips quietly without creating anything', async () => {
    renderTab('/journal?seg=notebook&new=not-a-template')
    // give the effect a tick to run
    await new Promise((r) => setTimeout(r, 50))
    expect(lastPostBody).toBeNull()
  })
})

describe('NotebookTab — import', () => {
  it('header Import button opens the wizard', async () => {
    renderTab()
    expect(screen.queryByTestId('import-wizard')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    expect(screen.getByTestId('import-wizard')).toBeInTheDocument()
  })

  it('empty state pitches the import path', () => {
    renderTab()
    expect(screen.getByText(/Notion, Obsidian, Evernote/i)).toBeInTheDocument()
  })
})
