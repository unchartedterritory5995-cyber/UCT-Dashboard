import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 6 (lane E, item 4) — Today, WIRED: the button and Ctrl/Cmd+Alt+D open
 * the member's note for today's ET date (from `todayET`), with their daily
 * template; a template that no longer exists is said in words; a failure too.
 */
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [{ id: 'n1', title: 'A note', tags: [] }], isLoading: false, error: null, refresh: vi.fn(),
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
vi.mock('../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: { notebook_daily_template: 'tpl-daily' }, setPref: vi.fn() }),
}))
// ⛔ The day comes from todayET — pinned to a day that can NEVER be the real
// one, so a client that used the UTC day (toISOString) sends something else.
// (A first version pinned the date these tests were written on, which WAS the
// UTC day — and the UTC mutation passed.)
vi.mock('../lib/calendar', async (importOriginal) => ({
  ...(await importOriginal()),
  todayET: () => '2031-01-02',
}))

import NotebookTab from './NotebookTab'

let posts
let answer
beforeEach(() => {
  posts = []
  answer = () => ({ ok: true, status: 200, json: async () => ({ note: { id: 'day1', title: '2026-09-24 · Thursday' }, created: true, templateMissing: false }) })
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    if (u === '/api/j2/notes/daily') {
      posts.push(JSON.parse(init.body))
      return answer()
    }
    if (u.startsWith('/api/j2/note-folders')) return { ok: true, json: async () => ({ folders: [] }) }
    return { ok: true, json: async () => ({}) }
  })
})
afterEach(() => vi.clearAllMocks())

const renderTab = () => render(
  <MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>,
)

describe('Today', () => {
  it('the button opens today’s note, for the ET day, with the member’s daily template', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Today/ }))
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'day1'))
    expect(posts).toEqual([{ date: '2031-01-02', templateId: 'tpl-daily' }])
  })

  it('Ctrl+Alt+D and Cmd+Option+D do the same, from anywhere on the page', async () => {
    renderTab()
    fireEvent.keyDown(window, { code: 'KeyD', key: '∂', altKey: true, metaKey: true })
    await waitFor(() => expect(posts).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'day1'))
  })

  it('a daily template that no longer exists is said in words; the day still opens', async () => {
    answer = () => ({ ok: true, status: 200, json: async () => ({ note: { id: 'day1' }, created: true, templateMissing: true }) })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Today/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Your daily template no longer exists, so today's note started blank.")
    expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'day1')
  })

  it('a refusal says nothing was created', async () => {
    answer = () => ({ ok: false, status: 500, json: async () => ({}) })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /Today/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't open today's note. Nothing was created.")
  })
})
