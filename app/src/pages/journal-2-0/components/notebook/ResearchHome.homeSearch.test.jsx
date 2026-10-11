// P0.13: search in place. The Home search box was a BUTTON that opened a SECOND search box in
// the folders panel while its own box stayed on screen, so a member saw two search boxes at
// once. It is now a real search input that hands what the member types to the Notebook's one
// search (the `#search` door, carrying the text), and it steps aside while that search is open.
// ⛔ Roles and names are asserted as rendered: the old box was role=button, the new one is
// role=searchbox, and a test that still looked for the button would pass on neither.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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
  seen.push({ pathname: loc.pathname, hash: loc.hash, state: loc.state, key: loc.key })
  return <p data-testid="where">{`${loc.pathname}${loc.hash}`}</p>
}
const lastLocation = () => seen[seen.length - 1]

function renderHome({ entry = '/journal/notebook', ...props } = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter initialEntries={[entry]}>
          <ResearchHome hasAnyNotes onOpenNote={vi.fn()} onCreateNote={vi.fn()}
            onCreateThesis={vi.fn()} onImport={vi.fn()} {...props} />
          <Routes><Route path="*" element={<Where />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}

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
