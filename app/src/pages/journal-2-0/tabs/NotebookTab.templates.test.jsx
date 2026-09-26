import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 6 (lane E, item 3) — creating from a MEMBER template goes through the
 * same path as a built-in (`createNote` -> `createNoteViaApi`): the template is
 * read in full, the note is POSTed with its title and body, its property values
 * follow in the properties PUT (which lands its revision), and the new note
 * opens. Real TemplatePicker + MemberTemplates; network, sidebar, editor stubbed.
 */
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [], isLoading: false, error: null, refresh: vi.fn(), mutate: vi.fn(),
    total: 0, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
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
vi.mock('../lib/offline/useDurableNote', async (importOriginal) => ({
  ...(await importOriginal()),
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))

import NotebookTab from './NotebookTab'
import { recordLandedRevision } from '../lib/offline/useDurableNote'
import { setCurrentAccountId } from '../lib/offline/currentAccount'

const BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What worked' }] }] }
let calls
let templateRead
beforeEach(() => {
  vi.clearAllMocks()
  calls = []
  templateRead = { ok: true }
  setCurrentAccountId('acct-A')
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const method = init.method || 'GET'
    calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null })
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (u === '/api/j2/note-templates' && method === 'GET') return ok({ templates: [{ id: 't1', name: 'Weekly review', title: 'Week', createdAt: '1' }] })
    if (u === '/api/j2/note-templates/t1') {
      return templateRead.ok
        ? ok({ template: { id: 't1', name: 'Weekly review', title: 'Week', bodyJson: BODY, properties: { 'builtin:thesis_status': 'active' } } })
        : { ok: false, status: 404, json: async () => ({}) }
    }
    if (u === '/api/j2/notes' && method === 'POST') return ok({ note: { id: 'new1', title: 'Week', updatedAt: 'R0' } })
    if (u === '/api/j2/notes/new1' && method === 'PUT') return ok({ note: { id: 'new1', title: 'Week', updatedAt: 'R1' } })
    if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [] })
    return ok({})
  })
})
afterEach(() => setCurrentAccountId(null))

const renderTab = () => render(
  <MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>,
)

describe('creating from a member template', () => {
  it('reads the template, creates the note through createNoteViaApi, lands its properties, and opens it', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    // Scoped: the built-in catalog has its own "Weekly review" card.
    // (An empty notebook also shows the picker inline, so there are two.)
    const [mine] = await screen.findAllByRole('region', { name: 'Your templates' })
    fireEvent.click(await within(mine).findByRole('button', { name: /^Weekly review/ }))
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'new1'))
    const post = calls.find((c) => c.url === '/api/j2/notes' && c.method === 'POST')
    expect(post.body).toMatchObject({ title: 'Week', bodyJson: BODY })
    const put = calls.find((c) => c.url === '/api/j2/notes/new1' && c.method === 'PUT')
    expect(put.body).toEqual({ properties: { 'builtin:thesis_status': 'active' } })
    expect(recordLandedRevision).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'new1', updatedAt: 'R1' }))
  })

  it('a template that cannot be read creates nothing and says so', async () => {
    templateRead.ok = false
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    // Scoped: the built-in catalog has its own "Weekly review" card.
    // (An empty notebook also shows the picker inline, so there are two.)
    const [mine] = await screen.findAllByRole('region', { name: 'Your templates' })
    fireEvent.click(await within(mine).findByRole('button', { name: /^Weekly review/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t open the template “Weekly review”. Nothing was created.'.replace('’', "'"))
    expect(calls.some((c) => c.url === '/api/j2/notes' && c.method === 'POST')).toBe(false)
  })
})
