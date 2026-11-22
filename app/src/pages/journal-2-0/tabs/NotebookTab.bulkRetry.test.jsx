// Follow-up A fix round 1 (I1): the bulk actions library is fetched on demand (lib/noteBatch.js has NO default
// export). A failed fetch is retried once under a new address (lib/lazyChunk.js `chunkRetry.importUrl`); a retry that
// succeeds must RUN the action, with its pre-check (a note waiting to sync is held back and named). Two failures draw
// the sentence and a Reload the member presses; the page reloads only on that press; a later press asks again.
// Real NotebookTab and BulkActionBar; the network, the sidebar and the editor stubbed (NotebookTab.bulk.test.jsx).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const NOTES = [
  { id: 'n1', title: 'First note', tags: [], updatedAt: '2026-09-18T00:00:00Z' },
  { id: 'n2', title: 'Second note', tags: [], updatedAt: '2026-09-17T00:00:00Z' },
]
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: NOTES, isLoading: false, error: null, refresh: vi.fn(), mutate: vi.fn(),
    total: NOTES.length, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({ default: () => <div data-testid="folder-sidebar" /> }))
vi.mock('../components/notebook/NoteEditorPage', () => ({ default: () => <div data-testid="note-editor" /> }))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
let blockedIds = new Set()
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: blockedIds }) }))
vi.mock('../lib/offline/useDurableNote', async (importOriginal) => ({
  ...(await importOriginal()),
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))

import NotebookTab, { __resetNoteBatchForTests, noteBatchLoader } from './NotebookTab'
import { chunkRetry } from '../lib/lazyChunk'
import { pageReload } from '../lib/heldModule'
import { setCurrentAccountId } from '../lib/offline/currentAccount'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'

const realLoad = noteBatchLoader.load
const chunkError = () => new Error(`Failed to fetch dynamically imported module: ${window.location.origin}/assets/noteBatch-abc.js`)
let batchCalls = []

beforeEach(() => {
  vi.clearAllMocks()
  __resetNoteBatchForTests()
  blockedIds = new Set()
  batchCalls = []
  setCurrentAccountId('acct-A')
  global.fetch = vi.fn((url, init = {}) => {
    const u = String(url)
    const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    if (u === '/api/j2/notes/batch') {
      const body = JSON.parse(init.body)
      batchCalls.push(body)
      return ok({ op: body.op, results: body.ids.map((id) => ({ id, status: 'changed' })) })
    }
    if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [] })
    return ok({})
  })
})
afterEach(() => {
  cleanup()
  noteBatchLoader.load = realLoad
  __resetNoteBatchForTests()
  setCurrentAccountId(null)
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

const renderTab = () => render(<MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>)
const box = (title) => screen.getByRole('checkbox', { name: `Select ${title}` })

describe('the bulk actions library on a flaky network', () => {
  it('first fetch fails, the retry under a new address succeeds: the action RUNS, pre-check included', async () => {
    noteBatchLoader.load = vi.fn(() => Promise.reject(chunkError()))
    const retry = vi.spyOn(chunkRetry, 'importUrl').mockImplementation((spec) => {
      expect(spec).toContain('chunk-retry=')
      return realLoad()
    })
    blockedIds = new Set(['n2'])
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(box('Second note'))
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText(/"Second note" is waiting to sync \(edit it again first\)/, {}, { timeout: 4000 }))
      .toBeInTheDocument()
    expect(batchCalls).toEqual([{ ids: ['n1'], op: 'trash', args: {} }])
    expect(retry).toHaveBeenCalled()
    expect(screen.queryByText(/This action could not be loaded/)).toBeNull()
  }, 15000)

  it('two failures draw the sentence and a Reload; the page reloads only when the member presses it; a later press asks again', async () => {
    const reload = vi.spyOn(pageReload, 'run').mockImplementation(() => {})
    noteBatchLoader.load = vi.fn(() => Promise.reject(chunkError()))
    vi.spyOn(chunkRetry, 'importUrl').mockImplementation(() => Promise.reject(chunkError()))
    renderTab()
    fireEvent.click(box('First note'))
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Trash' }))
    const notice = await screen.findByTestId('bulk-notice', {}, { timeout: 4000 })
    await waitFor(() => expect(notice).toHaveTextContent('This action could not be loaded. Reload the page to get this back.'))
    expect(batchCalls).toEqual([])
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)

    // The network is back: the next press asks again and the action runs.
    noteBatchLoader.load = realLoad
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    await waitFor(() => expect(batchCalls).toEqual([{ ids: ['n1'], op: 'trash', args: {} }]), { timeout: 4000 })
  }, 15000)
})
