// P0.13: search in place. The Home search box was a BUTTON that opened a SECOND search box in
// the folders panel while its own box stayed on screen, so a member saw two search boxes at
// once. It is now a real search input that hands what the member types to the Notebook's one
// search (the `#search` door, carrying the text), and it steps aside while that search is open.
// ⛔ Roles and names are asserted as rendered: the old box was role=button, the new one is
// role=searchbox, and a test that still looked for the button would pass on neither.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('P0.13: the Home search box is a real input that hands off', () => {
  it('typing in the home search hands the text to the notebook search door', () => {
    renderHome({ hasAnyNotes: true })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your notes' }), { target: { value: 'nvda' } })
    expect(lastLocation().pathname).toBe('/journal/notebook')
    expect(lastLocation().hash).toBe('#search')
    expect(lastLocation().state).toEqual({ q: 'nvda' })
  })

  it('it is an input with a placeholder, not a button', () => {
    renderHome({ hasAnyNotes: true })
    const box = screen.getByRole('searchbox', { name: 'Search your notes' })
    expect(box.tagName).toBe('INPUT')
    expect(box.getAttribute('type')).toBe('search')
    expect(box.getAttribute('placeholder')).toBe('Search your notes')
    expect(screen.queryByRole('button', { name: 'Search your notes' })).toBeNull()
  })

  it('clearing the box (an empty value) hands nothing off', () => {
    renderHome({ hasAnyNotes: true })
    const box = screen.getByRole('searchbox', { name: 'Search your notes' })
    fireEvent.change(box, { target: { value: 'x' } })
    const after = seen.length
    fireEvent.change(box, { target: { value: '' } })
    expect(seen.length).toBe(after)
  })

  // Fix round 1: React Router commits a navigation in a transition, so the Home box stays live for a
  // frame or two after the first keystroke. Every later keystroke must REPLACE that history entry
  // (and carry the full text), or fast typing stacks #search entries and Back lands on stale ones.
  it('typing n, v, d, a quickly pushes exactly ONE history entry, and the last navigation carries the full text', () => {
    renderHome({ hasAnyNotes: true })
    const box = screen.getByRole('searchbox', { name: 'Search your notes' })
    const before = seen.length
    for (const v of ['n', 'nv', 'nvd', 'nvda']) fireEvent.change(box, { target: { value: v } })
    const made = reachedSince(before)
    expect(made.map((l) => l.type)).toEqual(['PUSH', 'REPLACE', 'REPLACE', 'REPLACE'])
    expect(made.map((l) => l.state.q)).toEqual(['n', 'nv', 'nvd', 'nvda'])
    expect(new Set(made.map((l) => l.key)).size).toBe(4)      // each one is a new key, so the tab re-reads the seed
    expect(lastLocation().hash).toBe('#search')
    // one Back leaves #search altogether: there was only one entry to go back over
    fireEvent.click(screen.getByRole('button', { name: 'test: back' }))
    expect(lastLocation().hash).toBe('')
    expect(lastLocation().pathname).toBe('/journal/notebook')
  })

  it('the first hand-off is a PUSH (Back returns to the Notebook home), never a replace', () => {
    renderHome({ hasAnyNotes: true })
    const before = seen.length
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your notes' }), { target: { value: 'n' } })
    expect(reachedSince(before).map((l) => l.type)).toEqual(['PUSH'])
  })

  it('after the box steps aside and comes back, the next hand-off is a fresh PUSH', () => {
    const { rerender } = renderHome({ hasAnyNotes: true })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your notes' }), { target: { value: 'n' } })
    rerender(tree({ hasAnyNotes: true, searchActive: true }))
    rerender(tree({ hasAnyNotes: true, searchActive: false }))
    const before = seen.length
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your notes' }), { target: { value: 'a' } })
    expect(reachedSince(before).map((l) => l.type)).toEqual(['PUSH'])
  })

  it('while the sidebar search is active, the home box is not shown (one search, in place)', () => {
    renderHome({ hasAnyNotes: true, searchActive: true })
    expect(screen.queryByRole('searchbox', { name: 'Search your notes' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Search your notes' })).toBeNull()
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
