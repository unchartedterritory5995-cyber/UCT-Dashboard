// Wave 8 lane 8C (C3): the first-run screen's two new doors — "Add a sample notebook" and
// "Take the tour" — and the strip that offers to remove the sample again.
//
// ⛔ Every sentence is asserted as RENDERED TEXT (copy contract). ⛔ Every request is read
// from `fetch.mock.calls` outside the mock. Each test gets its own SWR cache.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
vi.mock('../../hooks/useNotebookHome', () => ({
  default: () => ({ home: { ...EMPTY, continueWorking: [{ id: 'n1', title: 'Welcome to your sample notebook', updatedAt: new Date().toISOString() }] }, isLoading: false }),
}))

// Fix I-3: the device's durable store, answered PER NOTE -- the real noteHasUnsentWork (and the
// real precheckNoteBatch) run over it. Only reached when a test gives the page an indexedDB and
// an account; every other test stays 'wave-off' and never opens it (the pattern of
// tabs/NotebookTab.bulk.test.jsx).
let unsentStore = null
vi.mock('../../lib/offline/notebookDb', async (importOriginal) => ({
  ...(await importOriginal()),
  openNotebookDb: vi.fn(async () => {
    if (!unsentStore) throw new Error('no store in this test')
    return unsentStore
  }),
}))

import ResearchHome from './ResearchHome'
import { setCurrentAccountId } from '../../lib/offline/currentAccount'
import { installKeyRange } from '../../lib/offline/__fixtures__/fakeIndexedDb'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { SAMPLE_URL, SAMPLE_COPY } from './onboarding/sampleNotebook'
import { TOUR_OPEN_EVENT, __resetTourControl } from './onboarding/tourControl'

// the SERVER's 409 sentence; the member reads the client's, which names Trash and Archive (M-13)
const REFUSED = "You already have notes, so we didn't add the sample. You can import notes instead."
const IDS = ['w1', 'r1', 't1', 'd1', 'c1']

let server
function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
function installFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    if (url === '/api/auth/preferences' && method === 'GET') return json(200, server.prefs)
    if (url === '/api/auth/preferences' && method === 'POST') {
      const { key, value } = JSON.parse(init.body)
      server.prefs = { ...server.prefs, [key]: value }
      return json(200, { ok: true })
    }
    if (url === SAMPLE_URL && method === 'GET') return json(200, server.status)
    if (url === SAMPLE_URL && method === 'POST') return server.post()
    if (url === SAMPLE_URL && method === 'DELETE') return server.del()
    return json(404, { detail: 'Not Found' })
  })
}
const calls = (method, url = SAMPLE_URL) => global.fetch.mock.calls
  .filter(([u, init = {}]) => u === url && (init.method || 'GET').toUpperCase() === method)

const TITLES = { w1: 'Welcome to your sample notebook', r1: 'Researching a company', t1: 'A sample thesis', d1: 'A daily note', c1: 'A checklist' }

function renderHome({ paid = true, hasAnyNotes = false, onOpenNote = vi.fn(), blockedNoteIds = null } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: paid }}>
        <MemoryRouter>
          <ResearchHome hasAnyNotes={hasAnyNotes} onOpenNote={onOpenNote} onCreateNote={vi.fn()}
            onCreateThesis={vi.fn()} onImport={vi.fn()}
            blockedNoteIds={blockedNoteIds} titleOf={(id) => TITLES[id] || null} />
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
  return { onOpenNote }
}

beforeEach(() => {
  __resetNotebookFlags()
  __resetTourControl()
  latchNotebookFlags({ notebook_onboarding_enabled: true })
  server = {
    prefs: {},
    status: { ids: [], activeIds: [] },
    post: async () => json(200, { folderId: 'f1', welcomeNoteId: 'w1' }),
    del: async () => json(200, { trashed: IDS }),
  }
  installFetch()
})
afterEach(() => {
  __resetNotebookFlags()
  vi.restoreAllMocks()
  unsentStore = null
  setCurrentAccountId(null)
  vi.unstubAllGlobals()
})

/** This device holds unsent work for `queued` (an outbox entry per note); a note in
 *  `unreadable` fails its own read. The offline layer is on (it is by default) and has a store. */
function withDeviceStore(queued = [], { unreadable = [] } = {}) {
  installKeyRange()
  setCurrentAccountId('acct-A')
  vi.stubGlobal('indexedDB', { open: () => ({}) })
  unsentStore = {
    close() {},
    transaction() {
      return {
        objectStore() {
          return {
            get(noteId) {
              const req = {}
              setTimeout(() => {
                if (unreadable.includes(noteId)) { req.onerror?.(); return }
                req.result = { noteId, dirty: 0 }
                req.onsuccess?.()
              }, 0)
              return req
            },
            index() {
              return {
                getKey(range) {
                  const req = {}
                  setTimeout(() => { req.result = queued.includes(range.__only) ? 'mut-1' : undefined; req.onsuccess?.() }, 0)
                  return req
                },
              }
            },
          }
        },
      }
    },
  }
}
/** The offline layer is on and this device's store can never be opened. */
function withUncheckableDevice() {
  installKeyRange()
  setCurrentAccountId('acct-A')
  vi.stubGlobal('indexedDB', { open: () => ({}) })
  unsentStore = null
}

describe('the first-run screen', () => {
  it('offers the sample and the tour to a paid member when the gate is on', () => {
    renderHome()
    expect(screen.getByRole('button', { name: 'Add a sample notebook' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take the tour' })).toBeInTheDocument()
    // the tour's first step points here
    expect(document.querySelectorAll('[data-tour="first-run"]')).toHaveLength(1)
  })

  it('offers neither while the gate is off (nor before any flag has latched)', () => {
    __resetNotebookFlags()
    renderHome()
    expect(screen.queryByRole('button', { name: 'Add a sample notebook' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Take the tour' })).toBeNull()
    latchNotebookFlags({ notebook_onboarding_enabled: false })
    renderHome()
    expect(screen.queryByRole('button', { name: 'Add a sample notebook' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Take the tour' })).toBeNull()
  })

  it('an unpaid member gets the tour but not the sample', () => {
    renderHome({ paid: false })
    expect(screen.queryByRole('button', { name: 'Add a sample notebook' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Take the tour' })).toBeInTheDocument()
  })

  it('a member who has had the sample is not offered it again', async () => {
    server.prefs = { notebook_sample: JSON.stringify({ v: 1, ids: IDS, at: '2026-09-26T00:00:00Z' }) }
    renderHome()
    await waitFor(() => expect(calls('GET', '/api/auth/preferences').length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add a sample notebook' })).toBeNull())
  })

  it('adding the sample POSTs once, says so while it works, and opens the Welcome note', async () => {
    let release
    server.post = () => new Promise((r) => { release = () => r(json(200, { folderId: 'f1', welcomeNoteId: 'w1' })) })
    const { onOpenNote } = renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Add a sample notebook' }))
    const busy = await screen.findByRole('button', { name: 'Adding the sample…' })
    expect(busy).toBeDisabled()
    fireEvent.click(busy)
    release()
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith({ id: 'w1' }))
    expect(calls('POST')).toHaveLength(1)
    expect(calls('POST')[0][1]).toEqual({ method: 'POST', credentials: 'include' })
  })

  // M-13: this screen shows while the member has no ACTIVE notes, so a 409 ("you already have
  // notes") means they are in Trash or Archive -- and the sentence has to say so.
  it('a 409 names Trash and Archive, and opens nothing', async () => {
    server.post = async () => json(409, { detail: REFUSED })
    const { onOpenNote } = renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Add a sample notebook' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You already have notes, so we didn't add the sample. If you can't see them, look in Trash or Archive.",
    )
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it("any other refusal keeps the server's own sentence", async () => {
    server.post = async () => json(402, { detail: 'The sample notebook is part of a paid plan.' })
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Add a sample notebook' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The sample notebook is part of a paid plan.')
  })

  it('a failure with no sentence, or a dropped connection, says so plainly', async () => {
    server.post = async () => { throw new TypeError('offline') }
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Add a sample notebook' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't add the sample notebook. Try again in a moment.")
  })

  it('"Take the tour" asks the tour to open', () => {
    const heard = vi.fn()
    window.addEventListener(TOUR_OPEN_EVENT, heard)
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }))
    window.removeEventListener(TOUR_OPEN_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('the sample strip', () => {
  beforeEach(() => {
    server.prefs = { notebook_sample: JSON.stringify({ v: 1, ids: IDS, at: '2026-09-26T00:00:00Z' }) }
    server.status = { ids: IDS, activeIds: IDS }
  })

  it('shows while a sample note is still out of Trash, in the words the brief gives', async () => {
    renderHome({ hasAnyNotes: true })
    expect(await screen.findByText("You're looking at the sample notebook —")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove it' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide this message' })).toBeInTheDocument()
  })

  it('Remove it DELETEs, then says where the notes went', async () => {
    renderHome({ hasAnyNotes: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Remove it' }))
    server.status = { ids: IDS, activeIds: [] }
    expect(await screen.findByRole('status')).toHaveTextContent('The sample notes are in Trash. You can restore them from there.')
    expect(calls('DELETE')).toHaveLength(1)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove it' })).toBeNull())
  })

  it('a failed remove shows its sentence and keeps the strip', async () => {
    server.del = async () => json(500, {})
    renderHome({ hasAnyNotes: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Remove it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't remove the sample notebook. Try again in a moment.")
    expect(screen.getByRole('button', { name: 'Remove it' })).toBeInTheDocument()
  })

  it('hiding it writes the whole preference back with its ids, and it goes', async () => {
    renderHome({ hasAnyNotes: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Hide this message' }))
    await waitFor(() => expect(screen.queryByText("You're looking at the sample notebook —")).toBeNull())
    const post = calls('POST', '/api/auth/preferences')
    expect(post).toHaveLength(1)
    const { key, value } = JSON.parse(post[0][1].body)
    const written = JSON.parse(value)
    expect(key).toBe('notebook_sample')
    expect(written.ids).toEqual(IDS)
    expect(written.v).toBe(1)
    expect(typeof written.dismissedAt).toBe('string')
  })

  it('does not show when every sample note is in Trash, when dismissed, or with the gate off', async () => {
    server.status = { ids: IDS, activeIds: [] }
    renderHome({ hasAnyNotes: true })
    await waitFor(() => expect(calls('GET').length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: 'Remove it' })).toBeNull()
  })

  it('a dismissed sample asks the server nothing', async () => {
    server.prefs = { notebook_sample: JSON.stringify({ v: 1, ids: IDS, at: 'x', dismissedAt: 'y' }) }
    renderHome({ hasAnyNotes: true })
    await waitFor(() => expect(calls('GET', '/api/auth/preferences').length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 20))
    expect(calls('GET')).toEqual([])
    expect(screen.queryByRole('button', { name: 'Remove it' })).toBeNull()
  })

  it('with the gate off, no strip and no status request', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: false })
    renderHome({ hasAnyNotes: true })
    await waitFor(() => expect(calls('GET', '/api/auth/preferences').length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 20))
    expect(calls('GET')).toEqual([])
    expect(screen.queryByRole('button', { name: 'Remove it' })).toBeNull()
  })
})

// ⛔⛔ Wave 8 final review, fix I-3. "Remove it" TRASHES the sample notes, and it used to skip
// the unsent-work check both other trash doors run: a sample note trashed under queued words
// met its next save as a 404 and was stranded as BLOCKED, in the Trash. It now runs the bulk
// trash's own pre-check over the sample ids still out of Trash, first.
describe('Remove it asks the device first, as the bulk trash does', () => {
  beforeEach(() => {
    server.prefs = { notebook_sample: JSON.stringify({ v: 1, ids: IDS, at: '2026-09-26T00:00:00Z' }) }
    server.status = { ids: IDS, activeIds: ['w1', 'r1', 't1'] }
  })

  it('a sample note with queued words is not removed, and is named', async () => {
    withDeviceStore(['r1'])
    renderHome({ hasAnyNotes: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Remove it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The sample was not removed: "Researching a company" is still syncing — try again in a moment.',
    )
    expect(calls('DELETE')).toEqual([])
    expect(screen.getByRole('button', { name: 'Remove it' })).toBeInTheDocument()
  })

  it('a note waiting to sync (blocked) is refused and named the same way', async () => {
    renderHome({ hasAnyNotes: true, blockedNoteIds: new Set(['t1']) })
    fireEvent.click(await screen.findByRole('button', { name: 'Remove it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The sample was not removed: "A sample thesis" is waiting to sync (edit it again first).',
    )
    expect(calls('DELETE')).toEqual([])
  })

  it('CONTROL: the same device with nothing queued removes the sample', async () => {
    withDeviceStore([])
    renderHome({ hasAnyNotes: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Remove it' }))
    expect(await screen.findByRole('status')).toHaveTextContent('The sample notes are in Trash. You can restore them from there.')
    expect(calls('DELETE')).toHaveLength(1)
  })

  it('a device that cannot be checked is offered a confirmed "Remove anyway", with focus on each step', async () => {
    withUncheckableDevice()
    renderHome({ hasAnyNotes: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Remove it' }))
    const alert = await screen.findByRole('alert', {}, { timeout: 6000 })
    expect(alert).toHaveTextContent(
      "Can't check this device for unsent words. The sample was not removed: "
      + '"Welcome to your sample notebook"; "Researching a company"; "A sample thesis".',
    )
    expect(calls('DELETE')).toEqual([])
    const anyway = screen.getByRole('button', { name: 'Remove anyway' })
    await waitFor(() => expect(document.activeElement).toBe(anyway))
    fireEvent.click(anyway)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Remove the sample notebook without checking this device? Words typed here that have not reached the server may not be kept.',
    )
    const yes = screen.getByRole('button', { name: 'Yes, remove anyway' })
    await waitFor(() => expect(document.activeElement).toBe(yes))
    // Cancel disarms, and focus comes back to the offer
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove anyway' })))
    fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove anyway' }))
    expect(await screen.findByRole('status', {}, { timeout: 6000 })).toHaveTextContent('The sample notes are in Trash. You can restore them from there.')
    expect(calls('DELETE')).toHaveLength(1)
  }, 20000)
})

describe('the copy contract', () => {
  it('every sentence, verbatim', () => {
    expect(SAMPLE_COPY).toEqual({
      add: 'Add a sample notebook',
      adding: 'Adding the sample…',
      tour: 'Take the tour',
      addFailed: "We couldn't add the sample notebook. Try again in a moment.",
      refused: "You already have notes, so we didn't add the sample. If you can't see them, look in Trash or Archive.",
      strip: "You're looking at the sample notebook",
      remove: 'Remove it',
      removing: 'Removing…',
      removed: 'The sample notes are in Trash. You can restore them from there.',
      removeFailed: "We couldn't remove the sample notebook. Try again in a moment.",
      notRemoved: 'The sample was not removed:',
      uncheckedNotRemoved: "Can't check this device for unsent words. The sample was not removed:",
      removeAnyway: 'Remove anyway',
      removeAnywayConfirm: 'Remove the sample notebook without checking this device? Words typed here that have not reached the server may not be kept.',
      removeAnywayYes: 'Yes, remove anyway',
      cancel: 'Cancel',
      dismiss: 'Hide this message',
    })
  })
})
