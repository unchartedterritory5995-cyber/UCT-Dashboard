// Wave 14 lane W14-D: the "get started" checklist's ONE mount line in Research Home.
// It rides the fragment Research Home already renders on the first-run screen AND on
// every home state after it, so the list a first-run member starts is still there once
// their first note exists (plan 4.1: "visible on first run and from then on until the
// member dismisses it or finishes it").
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import ResearchHome from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { SAMPLE_URL } from './onboarding/sampleNotebook'

const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
let server
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

beforeEach(() => {
  server = { prefs: {}, home: EMPTY }
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    if (url === '/api/auth/preferences' && method === 'GET') return json(200, server.prefs)
    if (url === '/api/auth/preferences' && method === 'POST') return json(200, { ok: true })
    if (url === '/api/j2/notebook/home') return json(200, server.home)
    if (url === SAMPLE_URL && method === 'POST') return json(200, { folderId: 'f1', welcomeNoteId: null })
    return json(404, { detail: 'Not Found' })
  })
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
})
afterEach(() => {
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

function renderHome({ hasAnyNotes = false, paid = true, onCreateNote = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: paid }}>
        <MemoryRouter>
          <ResearchHome hasAnyNotes={hasAnyNotes} onOpenNote={vi.fn()} onCreateNote={onCreateNote}
            onCreateThesis={vi.fn()} onImport={vi.fn()} />
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
  return { onCreateNote }
}

describe('Research Home mounts the checklist', () => {
  it('on the first-run screen, below the welcome', async () => {
    const { onCreateNote } = renderHome()
    const heading = await screen.findByRole('heading', { name: 'Get started' })
    const welcome = screen.getByRole('heading', { name: 'Welcome to your Notebook' })
    // eslint-disable-next-line no-bitwise
    expect(welcome.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The step reuses the first-run screen's own create handler.
    fireEvent.click(screen.getByRole('button', { name: 'Write your first note' }))
    expect(onCreateNote).toHaveBeenCalledTimes(1)
  })

  it('the sample step runs Research Home\'s own add (one authority for that write)', async () => {
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Open the sample notebook' }))
    await waitFor(() => expect(global.fetch.mock.calls.some(([u, i = {}]) => u === SAMPLE_URL && i.method === 'POST')).toBe(true))
  })

  it('an unpaid member is not offered the sample step', async () => {
    renderHome({ paid: false })
    await screen.findByRole('heading', { name: 'Get started' })
    expect(screen.queryByText('Open the sample notebook')).toBeNull()
  })

  it('still there once the member has notes', async () => {
    server.home = { ...EMPTY, continueWorking: [{ id: 'n1', title: 'My note', bodyPlain: 'words', updatedAt: new Date().toISOString() }] }
    renderHome({ hasAnyNotes: true })
    expect(await screen.findByRole('heading', { name: 'Get started' })).toBeInTheDocument()
    expect(screen.getByText('My note')).toBeInTheDocument()
  })

  it('absent while its own flag is off (onboarding on)', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: false })
    renderHome()
    await screen.findByRole('heading', { name: 'Welcome to your Notebook' })
    expect(screen.queryByRole('heading', { name: 'Get started' })).toBeNull()
  })

  it('absent while the onboarding flag is off', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: false, notebook_getting_started_enabled: true })
    renderHome()
    await screen.findByRole('heading', { name: 'Welcome to your Notebook' })
    expect(screen.queryByRole('heading', { name: 'Get started' })).toBeNull()
  })
})
