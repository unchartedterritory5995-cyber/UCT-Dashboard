// VIS-4 (audit 2026-11-05, visual issue 12): the query and its results STAY IN THE MAIN COLUMN. P0.13's hand-off
// (first keystroke -> the folders panel's search) made the box vanish, the query reappear in the 236 px sidebar
// and "New note" jump 558 px left. The box now keeps the text and lists matching titles under itself; "Search
// by meaning" opens the Notebook's full search through the same door, carrying the text.
//
// (History) P0.13: search in place. The Home search box was a BUTTON that opened a SECOND search box in
// the folders panel while its own box stayed on screen, so a member saw two search boxes at
// once. It is now a real search input that hands what the member types to the Notebook's one
// search (the `#search` door, carrying the text), and it steps aside while that search is open.
// ⛔ Roles and names are asserted as rendered: the old box was role=button, the new one is
// role=searchbox, and a test that still looked for the button would pass on neither.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { SWRConfig } from 'swr'

let homeData
vi.mock('../../hooks/useNotebookHome', () => ({
  default: () => ({ home: homeData, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('./AskPanel', () => ({ default: () => <div>ask</div> }))

import ResearchHome, { HomeSearch } from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { __resetRegistryTourControl } from './onboarding/tourRegistryControl'

const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }

const seen = []
function Where() {
  const loc = useLocation()
  const type = useNavigationType()
  seen.push({ pathname: loc.pathname, hash: loc.hash, state: loc.state, key: loc.key, type })
  return <p data-testid="where">{`${loc.pathname}${loc.hash}`}</p>
}
function BackProbe() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(-1)}>test: back</button>
}
const lastLocation = () => seen[seen.length - 1]
/** The distinct locations reached after index `from`, in order (Where can render more than once per navigation). */
const reachedSince = (from) => seen.slice(from).filter((l, i, a) => i === 0 || l.key !== a[i - 1].key)

function tree({ entry = '/journal/notebook', ...props } = {}) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter initialEntries={[entry]}>
          <ResearchHome hasAnyNotes onOpenNote={vi.fn()} onCreateNote={vi.fn()}
            onCreateThesis={vi.fn()} onImport={vi.fn()} {...props} />
          <Routes><Route path="*" element={<Where />} /></Routes>
          <BackProbe />
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>
  )
}
const renderHome = (props) => render(tree(props))

beforeEach(() => {
  seen.length = 0
  __resetNotebookFlags()
  __resetRegistryTourControl()
  window.localStorage.clear()
  homeData = { ...EMPTY }
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.startsWith('/api/j2/notes?') && u.includes('q=')) {
      const q = new URL(u, 'http://x').searchParams.get('q')
      const notes = q === 'nvda' ? [{ id: 'n1', title: 'NVDA thesis' }, { id: 'n2', title: 'NVDA earnings' }] : []
      return { ok: true, status: 200, json: async () => ({ notes, total: notes.length }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
})
afterEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('VIS-4: the Home search stays in the main column', () => {
  const box = () => screen.getByRole('searchbox', { name: 'Search your notes' })
  const type = (v) => fireEvent.change(box(), { target: { value: v } })

  it('typing keeps the text in THIS box and never navigates to the panel search', async () => {
    renderHome({ hasAnyNotes: true })
    const before = seen.length
    type('nvda')
    expect(box()).toHaveValue('nvda')
    await screen.findByRole('region', { name: 'Search results' })
    expect(reachedSince(before).filter((l) => l.hash === '#search')).toEqual([])
    expect(lastLocation().hash).not.toBe('#search')
  })

  it('lists the matching titles under the box, and a title opens its note', async () => {
    const onOpenNote = vi.fn()
    renderHome({ hasAnyNotes: true, onOpenNote })
    type('nvda')
    const results = await screen.findByRole('region', { name: 'Search results' })
    const hit = await within(results).findByRole('button', { name: 'NVDA thesis' })
    expect(within(results).getByRole('button', { name: 'NVDA earnings' })).toBeInTheDocument()
    fireEvent.click(hit)
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }))
  })

  it('no match says so, in the main column, with the way to the full search', async () => {
    renderHome({ hasAnyNotes: true })
    type('zzz')
    const results = await screen.findByRole('region', { name: 'Search results' })
    expect(await within(results).findByText('No notes match “zzz”.')).toBeInTheDocument()
    expect(within(results).getByRole('button', { name: 'Search by meaning' })).toBeInTheDocument()
  })

  it('"Search by meaning" opens the Notebook search door carrying the text (one PUSH)', async () => {
    renderHome({ hasAnyNotes: true })
    type('nvda')
    const results = await screen.findByRole('region', { name: 'Search results' })
    const before = seen.length
    fireEvent.click(within(results).getByRole('button', { name: 'Search by meaning' }))
    const reached = reachedSince(before)
    expect(reached.map((l) => l.type)).toEqual(['PUSH'])
    expect(lastLocation().hash).toBe('#search')
    expect(lastLocation().state).toEqual({ q: 'nvda' })
  })

  it('an empty box asks for nothing and shows no results', async () => {
    renderHome({ hasAnyNotes: true })
    type('nvda')
    await screen.findByRole('region', { name: 'Search results' })
    type('')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull())
  })

  it('Escape clears the box', async () => {
    renderHome({ hasAnyNotes: true })
    type('nvda')
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(box()).toHaveValue('')
  })

  it('while the sidebar search is active, the home box is not shown (one search on screen)', () => {
    renderHome({ hasAnyNotes: true, searchActive: true })
    expect(screen.queryByRole('searchbox', { name: 'Search your notes' })).toBeNull()
  })

  it('CONTROL: with the sidebar search not active, exactly one box is on screen', () => {
    renderHome({ hasAnyNotes: true, searchActive: false })
    expect(screen.getAllByLabelText('Search your notes')).toHaveLength(1)
  })

  it('HomeSearch hidden renders nothing at all', () => {
    const { container } = render(
      <MemoryRouter><HomeSearch hidden /></MemoryRouter>,
    )
    expect(container.firstChild).toBeNull()
  })
})
