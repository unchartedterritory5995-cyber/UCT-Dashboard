import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Notebook P1 (Task 12): the New-note sheet's kind picker, through the real NotebookTab. Switch on:
 * one press on a kind makes the note through the ONE create door (createNoteViaApi, mocked at that
 * boundary: Task 9 owns its wire) with `kindId`, and a chosen style goes as `styleId`. Switch off:
 * today's sheet exactly, and the styles list is never requested.
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
let homeProps = null
vi.mock('../components/notebook/ResearchHome', () => ({ default: (p) => { homeProps = p; return <div data-testid="research-home" /> } }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))
vi.mock('../lib/noteCreation', async (importOriginal) => ({
  ...(await importOriginal()),
  createNoteViaApi: vi.fn(async () => ({ id: 'new1', title: '', updatedAt: 'R0' })),
}))

import NotebookTab from './NotebookTab'
import { createNoteViaApi } from '../lib/noteCreation'
import { BUILTIN_NOTE_KINDS } from '../lib/noteKinds'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { setCurrentAccountId } from '../lib/offline/currentAccount'

const listBody = {
  kinds: BUILTIN_NOTE_KINDS.map((k) => ({ ...k, builtin: true })),
  styles: [
    ...BUILTIN_NOTE_KINDS.map((k) => ({ id: `builtin:${k.id}`, name: `${k.name} (starter)`, kindId: k.id,
      builtin: true, isDefault: true, version: 1, blocks: [], properties: {} })),
    { id: 's-mine', name: 'My plan', kindId: 'trade_plan', builtin: false, isDefault: false, version: 2, blocks: [], properties: {} },
  ],
  blockKinds: [],
}
// The lazy chunk is fetched once, up front: a test that races the first cold import of KindSection is
// a test of the machine's speed (review I5).
beforeAll(async () => { await import('../components/notebook/styles/StyleSurfaces') })
const T = { timeout: 20000 }
vi.setConfig({ testTimeout: 40000 })   // role queries over the whole Notebook are slow in jsdom; this is a wait, not a budget

let urls
beforeEach(() => {
  vi.clearAllMocks()
  urls = []
  homeProps = null
  setCurrentAccountId('acct-A')
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    urls.push(u)
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (u === '/api/j2/journal-styles') return ok(listBody)
    if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [] })
    if (u === '/api/j2/note-templates') return ok({ templates: [] })
    return ok({})
  })
})
afterEach(() => { setCurrentAccountId(null); __resetNotebookFlags() })

const renderTab = () => render(
  <MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>,
)

describe('New note: pick a kind (Notebook P1)', () => {
  it('the Home New-note menu gets a "From a style" door only while the switch is on', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    const { unmount } = render(<MemoryRouter initialEntries={['/journal']}><NotebookTab /></MemoryRouter>)
    await screen.findByTestId('research-home')
    expect(typeof homeProps.onFromStyle).toBe('function')
    unmount()
    __resetNotebookFlags()
    homeProps = null
    render(<MemoryRouter initialEntries={['/journal']}><NotebookTab /></MemoryRouter>)
    await screen.findByTestId('research-home')
    expect(homeProps.onFromStyle).toBeNull()
  })

  it('switch on: a kind makes a note of that kind through the one create door', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const [btn] = await screen.findAllByLabelText('New Trade plan', {}, T)
    fireEvent.click(btn)
    await waitFor(() => expect(createNoteViaApi).toHaveBeenCalled())
    expect(createNoteViaApi.mock.calls[0][0]).toMatchObject({ kindId: 'trade_plan' })
    expect(createNoteViaApi.mock.calls[0][0].styleId).toBeUndefined()
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'new1'))
  })

  it('switch on: a chosen style goes as styleId', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const [another] = await screen.findAllByLabelText('Choose another style for Trade plan', {}, T)
    fireEvent.click(another)
    fireEvent.click(screen.getAllByRole('button', { name: 'Use My plan' })[0])
    await waitFor(() => expect(createNoteViaApi).toHaveBeenCalled())
    expect(createNoteViaApi.mock.calls[0][0]).toMatchObject({ styleId: 's-mine' })
  })

  it('From a style opens the New-note sheet with focus on the first kind, not the search box (M6)', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    render(<MemoryRouter initialEntries={['/journal']}><NotebookTab /></MemoryRouter>)
    await screen.findByTestId('research-home')
    act(() => { homeProps.onFromStyle() })
    const dialog = await screen.findByRole('dialog', { name: 'New note' })
    // not even for a moment: the search box must not grab focus while the kinds are still loading
    expect(document.activeElement).not.toBe(within(dialog).getByRole('searchbox', { name: 'Search templates' }))
    const first = await within(dialog).findByLabelText('New Trade plan', {}, T)
    await waitFor(() => expect(document.activeElement).toBe(first))
    expect(document.activeElement).not.toBe(within(dialog).getByRole('searchbox', { name: 'Search templates' }))
  })

  it('the Templates button still opens it with the search box focused', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const dialog = await screen.findByRole('dialog', { name: 'New note' })
    await within(dialog).findByLabelText('New Trade plan', {}, T)
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('searchbox', { name: 'Search templates' })))
  })

  it('switch off: today\'s sheet exactly, and the styles list is never requested', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    await screen.findAllByRole('region', { name: 'Your templates' })
    expect(screen.queryByRole('group', { name: 'Start from a kind of note' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New Trade plan' })).toBeNull()
    expect(screen.queryByText(/journal styles/i)).toBeNull()   // not even the picker's failure line
    expect(urls).not.toContain('/api/j2/journal-styles')
  })
})
