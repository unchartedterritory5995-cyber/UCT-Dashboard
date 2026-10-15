import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'

/**
 * Notebook P2 Tier 2 part B (Task 9): the earnings follow-up card, through the real NotebookTab. The card shows
 * for /journal/notebook?followup=SYM&reportDate=YYYY-MM-DD only with BOTH switches on and no note open; its
 * chunk is not even requested otherwise (F20a); "Write follow-up" makes the note through the ONE create door
 * (createNoteViaApi, mocked at that boundary) and opens it through the tab's own create finish (F3).
 */
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [], isLoading: false, error: null, refresh: vi.fn(), mutate: vi.fn(),
    total: 0, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({ default: () => <div data-testid="folder-sidebar" /> }))
vi.mock('../components/notebook/NoteEditorPage', () => ({
  default: ({ noteId, openFocus }) => <div data-testid="note-editor" data-note-id={noteId} data-open-focus={openFocus || ''} />,
}))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))
vi.mock('../lib/noteCreation', async (importOriginal) => ({
  ...(await importOriginal()),
  createNoteViaApi: vi.fn(async () => ({ id: 'new1', title: '', updatedAt: 'R0' })),
}))
vi.mock('../lib/offline/settleNoteWrite', async (importOriginal) => ({
  ...(await importOriginal()),
  settleNoteWrite: vi.fn(async () => {}),
}))
// The tab primes useJ2Note's cache through swr's global mutate; a call-through spy lets the test see that it did.
vi.mock('swr', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, mutate: vi.fn((...args) => real.mutate(...args)) }
})

import { mutate as globalMutate } from 'swr'
import NotebookTab from './NotebookTab'
import { followupChunk } from '../components/notebook/FollowupOfferSlot'
import { createNoteViaApi } from '../lib/noteCreation'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { setCurrentAccountId } from '../lib/offline/currentAccount'

const T = { timeout: 20000 }
vi.setConfig({ testTimeout: 40000 })   // role queries over the whole Notebook are slow in jsdom; this is a wait, not a budget
// The card's chunk is fetched once, up front: a test that races the first cold import is a test of the machine's speed.
beforeAll(async () => { await import('../components/notebook/FollowupOffer') })

const BOTH = { notebook_journal_styles_enabled: true, notebook_earnings_followup_enabled: true }
const ORCL = '/journal/notebook?followup=ORCL&reportDate=2026-10-14'
const REGION = { name: 'Earnings follow-up' }

let loadSpy
beforeEach(() => {
  vi.clearAllMocks()
  createNoteViaApi.mockImplementation(async () => ({ id: 'new1', title: '', updatedAt: 'R0' }))
  loadSpy = vi.spyOn(followupChunk, 'load')
  setCurrentAccountId('acct-A')
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ folders: [], templates: [], kinds: [], styles: [], blockKinds: [] }) }))
})
afterEach(() => { loadSpy.mockRestore(); setCurrentAccountId(null); __resetNotebookFlags() })

let nav
function Probe() {
  const loc = useLocation()
  nav = useNavigate()
  return <div data-testid="search">{loc.search}</div>
}
const renderTab = (url) => render(<MemoryRouter initialEntries={[url]}><Probe /><NotebookTab /></MemoryRouter>)
const search = () => new URLSearchParams(screen.getByTestId('search').textContent)

describe('the earnings follow-up card in the Notebook (Tier 2 part B)', () => {
  it('both switches on: the card shows, and only the press makes the note and opens it', async () => {
    latchNotebookFlags(BOTH)
    renderTab(ORCL)
    expect(await screen.findByRole('region', REGION, T)).toBeTruthy()
    expect(screen.getByText(/ORCL reported on Oct 14, 2026\./)).toBeTruthy()
    expect(createNoteViaApi).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    await waitFor(() => expect(createNoteViaApi).toHaveBeenCalledTimes(1))
    expect(createNoteViaApi.mock.calls[0][0]).toMatchObject({
      kindId: 'earnings_followup', ticker: 'ORCL', earningsFollowup: { reportDate: '2026-10-14' },
    })
    const editor = await screen.findByTestId('note-editor', {}, T)
    expect(editor).toHaveAttribute('data-note-id', 'new1')
    // F3: opened through the tab's own create finish -- a FRESH open (focus lands in the title), the SWR cache
    // primed with the POST's answer, and the link's two parameters gone in the same URL write.
    expect(editor).toHaveAttribute('data-open-focus', 'title')
    expect(globalMutate).toHaveBeenCalledWith('/api/j2/notes/new1', { note: expect.objectContaining({ id: 'new1' }) }, false)
    expect(search().get('note')).toBe('new1')
    expect(search().has('followup')).toBe(false)
    expect(search().has('reportDate')).toBe(false)
    expect(screen.queryByRole('region', REGION)).toBeNull()
  })

  it('the follow-up switch off: no card, and the card\'s chunk is never requested', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    renderTab(ORCL)
    await screen.findByTestId('research-home', {}, T)
    expect(screen.queryByRole('region', REGION)).toBeNull()
    expect(loadSpy).not.toHaveBeenCalled()
    expect(createNoteViaApi).not.toHaveBeenCalled()
  })

  it('Journal styles off (the follow-up switch on): no card, and no chunk request either', async () => {
    latchNotebookFlags({ notebook_earnings_followup_enabled: true })
    renderTab(ORCL)
    await screen.findByTestId('research-home', {}, T)
    expect(screen.queryByRole('region', REGION)).toBeNull()
    expect(loadSpy).not.toHaveBeenCalled()
  })

  it('CONTROL -- with both on, the chunk IS requested (so the two "not requested" cases mean something)', async () => {
    latchNotebookFlags(BOTH)
    renderTab(ORCL)
    await screen.findByRole('region', REGION, T)
    expect(loadSpy).toHaveBeenCalledTimes(1)
  })

  it('a note already open: no card', async () => {
    latchNotebookFlags(BOTH)
    renderTab(`/journal/notebook?note=n1&followup=ORCL&reportDate=2026-10-14`)
    await screen.findByTestId('note-editor', {}, T)
    expect(screen.queryByRole('region', REGION)).toBeNull()
    expect(loadSpy).not.toHaveBeenCalled()
  })

  it('a note made while a folder is open goes into that folder, and never into a view that is not one', async () => {
    latchNotebookFlags(BOTH)
    renderTab(`${ORCL}&folder=f9`)
    await screen.findByRole('region', REGION, T)
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    await waitFor(() => expect(createNoteViaApi).toHaveBeenCalledTimes(1))
    expect(createNoteViaApi.mock.calls[0][0].folderId).toBe('f9')
  })

  it('the Trash view is not a folder: the follow-up is made unfiled', async () => {
    latchNotebookFlags(BOTH)
    renderTab(`${ORCL}&folder=__trash__`)
    await screen.findByRole('region', REGION, T)
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    await waitFor(() => expect(createNoteViaApi).toHaveBeenCalledTimes(1))
    expect('folderId' in createNoteViaApi.mock.calls[0][0] && createNoteViaApi.mock.calls[0][0].folderId !== undefined).toBe(false)
  })

  it('Not now: the card goes, the URL loses both parameters, and nothing is made', async () => {
    latchNotebookFlags(BOTH)
    renderTab(ORCL)
    await screen.findByRole('region', REGION, T)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByRole('region', REGION)).toBeNull())
    expect(search().has('followup')).toBe(false)
    expect(search().has('reportDate')).toBe(false)
    expect(createNoteViaApi).not.toHaveBeenCalled()
  })

  it('F4: a SECOND notice opened in the same tab gets a card whose button works', async () => {
    latchNotebookFlags(BOTH)
    renderTab(ORCL)
    await screen.findByRole('region', REGION, T)
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    await waitFor(() => expect(createNoteViaApi).toHaveBeenCalledTimes(1))
    await screen.findByTestId('note-editor', {}, T)
    createNoteViaApi.mockImplementationOnce(async () => ({ id: 'new2', title: '', updatedAt: 'R0' }))
    // the member leaves that note and follows another bell
    nav('/journal/notebook?followup=AMD&reportDate=2026-10-13')
    await screen.findByText(/AMD reported on Oct 13, 2026\./, {}, T)
    fireEvent.click(screen.getByRole('button', { name: 'Write follow-up' }))
    await waitFor(() => expect(createNoteViaApi).toHaveBeenCalledTimes(2))
    expect(createNoteViaApi.mock.calls[1][0]).toMatchObject({ ticker: 'AMD', earningsFollowup: { reportDate: '2026-10-13' } })
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'new2'))
  })

  it('V12: a card chunk that cannot be fetched leaves the Notebook standing, with no card', async () => {
    latchNotebookFlags(BOTH)
    loadSpy.mockImplementation(() => Promise.reject(new TypeError('boom: not a chunk error')))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderTab(ORCL)
    await waitFor(() => expect(loadSpy).toHaveBeenCalled(), T)
    await screen.findByTestId('research-home', {}, T)
    await waitFor(() => expect(screen.queryByRole('region', REGION)).toBeNull())
    expect(createNoteViaApi).not.toHaveBeenCalled()
    quiet.mockRestore()
  })
})
