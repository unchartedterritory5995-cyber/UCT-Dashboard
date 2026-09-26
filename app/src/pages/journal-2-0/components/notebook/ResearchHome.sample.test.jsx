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

import ResearchHome from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { SAMPLE_URL, SAMPLE_COPY } from './onboarding/sampleNotebook'
import { TOUR_OPEN_EVENT, __resetTourControl } from './onboarding/tourControl'

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

function renderHome({ paid = true, hasAnyNotes = false, onOpenNote = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: paid }}>
        <MemoryRouter>
          <ResearchHome hasAnyNotes={hasAnyNotes} onOpenNote={onOpenNote} onCreateNote={vi.fn()}
            onCreateThesis={vi.fn()} onImport={vi.fn()} />
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
})

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

  it("a 409 shows the server's sentence and opens nothing", async () => {
    server.post = async () => json(409, { detail: REFUSED })
    const { onOpenNote } = renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Add a sample notebook' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(REFUSED)
    expect(onOpenNote).not.toHaveBeenCalled()
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

describe('the copy contract', () => {
  it('every sentence, verbatim', () => {
    expect(SAMPLE_COPY).toEqual({
      add: 'Add a sample notebook',
      adding: 'Adding the sample…',
      tour: 'Take the tour',
      addFailed: "We couldn't add the sample notebook. Try again in a moment.",
      strip: "You're looking at the sample notebook",
      remove: 'Remove it',
      removing: 'Removing…',
      removed: 'The sample notes are in Trash. You can restore them from there.',
      removeFailed: "We couldn't remove the sample notebook. Try again in a moment.",
      dismiss: 'Hide this message',
    })
  })
})
