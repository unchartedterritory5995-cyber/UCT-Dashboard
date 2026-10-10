// Notebook UX pass (2026-10-10): Research Home LEADS WITH THE MEMBER'S NOTES, and its
// dashboard boxes fold.
//
// Measured on a sandbox before this pass: a member with 25 notes landed on Research Home and
// saw "Ask Notebook", Reporting soon, Passed setups, Reviews and a 22-step checklist -- and
// none of their notes. What this holds:
//   * for a member with notes the top of Home is a search box (a DOOR into the Notebook's one
//     search: `#search`, never a second search) and their recent notes, ahead of every box;
//   * recent notes are the home read's own recents, or -- only when it has none -- their most
//     recently edited notes from the Notebook's list read;
//   * each box folds; an EMPTY box starts folded to its one-line header with a short count,
//     a box with something to show starts open, and the member's own choice wins;
//   * a running walkthrough, or the palette's "Earnings prep" door, unfolds a folded box (never
//     persisted), so a tour never waits on an anchor a fold unmounted.
// ⛔ Copy and roles are asserted as rendered, after the action settles.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SWRConfig } from 'swr'

let homeData
vi.mock('../../hooks/useNotebookHome', () => ({
  default: () => ({ home: homeData, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('./AskPanel', () => ({ default: () => <div>ask</div> }))

import ResearchHome from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { publishRegistryTourWanted, __resetRegistryTourControl } from './onboarding/tourRegistryControl'
import { SOON_URL } from '../../lib/earningsPrepShared'
import { PASSED_URL } from '../../lib/researchCapture'

const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
const WAVE14 = Object.freeze({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
const SECTION_KEY = (id) => `uct.j2.analytics.section.${id}`

let server
function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
function installFetch() {
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u === '/api/auth/preferences') return json(200, { notebook_getting_started: JSON.stringify({ v: 1, state: 'dismissed' }) })
    if (u === SOON_URL) return json(200, server.soon)
    if (u === PASSED_URL) return json(200, server.passed)
    if (u.startsWith('/api/j2/notes?')) return json(200, { notes: server.edited, total: server.edited.length })
    return json(200, {})
  })
}

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{`${loc.pathname}${loc.hash}`}</p>
}

function renderHome({ onOpenNote = vi.fn(), entry = '/journal/notebook' } = {}) {
  const utils = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter initialEntries={[entry]}>
          <ResearchHome hasAnyNotes onOpenNote={onOpenNote} onCreateNote={vi.fn()}
            onCreateThesis={vi.fn()} onImport={vi.fn()} />
          <Routes><Route path="*" element={<Where />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
  return { ...utils, onOpenNote }
}

const boxHeader = (title) => screen.getByRole('button', { name: new RegExp(`^${title}`) })
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const NOTE = (id, title) => ({ id, title, updatedAt: '2026-10-09T12:00:00Z' })

beforeEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  window.localStorage.clear()
  homeData = { ...EMPTY }
  server = {
    soon: { items: [], windowDays: 7 },
    passed: { items: [], tradedCount: 0 },
    edited: [],
  }
  installFetch()
})
afterEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('the top of Home is the member\'s notes', () => {
  it('a search box and Recent notes come first, ahead of every dashboard box', async () => {
    latchNotebookFlags({ ...WAVE14, notebook_earnings_prep_enabled: true, notebook_passed_setups_enabled: true, notebook_review_drafts_enabled: true })
    homeData = { ...EMPTY, continueWorking: [NOTE('n1', 'NVDA thesis'), NOTE('n2', 'Weekly plan')] }
    renderHome()
    const search = screen.getByRole('button', { name: 'Search your notes' })
    const recent = screen.getByRole('heading', { name: 'Recent notes' })
    await waitFor(() => expect(boxHeader('Reporting soon')).toBeInTheDocument())
    const boxes = [boxHeader('Reporting soon'), boxHeader('Passed setups'), boxHeader('Reviews that write themselves')]
    expect(search.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const box of boxes) {
      expect(recent.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    const list = recent.closest('[data-recent-notes]')
    expect(within(list).getByText('NVDA thesis')).toBeInTheDocument()
    expect(within(list).getByText('Weekly plan')).toBeInTheDocument()
  })

  it('the search box opens the Notebook\'s own search (the #search door), and searches nothing itself', () => {
    renderHome()
    const before = global.fetch.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Search your notes' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/journal/notebook#search')
    expect(global.fetch.mock.calls.length).toBe(before)
  })

  it('a recent note opens on a press', () => {
    homeData = { ...EMPTY, continueWorking: [NOTE('n1', 'NVDA thesis')] }
    const { onOpenNote } = renderHome()
    fireEvent.click(screen.getByText('NVDA thesis'))
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }))
  })

  it('no opened notes (an import, say): their most recently EDITED notes, from the list read', async () => {
    server.edited = [NOTE('e1', 'Imported note'), NOTE('e2', 'Another import')]
    renderHome()
    expect(await screen.findByText('Imported note')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recent notes' })).toBeInTheDocument()
    const asked = global.fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/j2/notes?'))
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('sort=updated')
    expect(asked[0]).toContain('limit=5')
  })

  it('opened notes present: the list read is never asked', async () => {
    homeData = { ...EMPTY, continueWorking: [NOTE('n1', 'NVDA thesis')] }
    renderHome()
    await settle()
    expect(global.fetch.mock.calls.some(([u]) => String(u).startsWith('/api/j2/notes?'))).toBe(false)
  })

  it('the Learn menu sits on the same row as the search box (switch on); not there switch off', () => {
    latchNotebookFlags(WAVE14)
    const { unmount } = renderHome()
    const search = screen.getByRole('button', { name: 'Search your notes' })
    expect(search.parentElement).toContainElement(screen.getByRole('button', { name: 'Learn' }))
    unmount()
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: false })
    renderHome()
    expect(screen.queryByRole('button', { name: 'Learn' })).toBeNull()
  })
})

describe('the dashboard boxes fold; an empty one starts folded', () => {
  beforeEach(() => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true, notebook_passed_setups_enabled: true, notebook_review_drafts_enabled: true })
  })

  it('nothing reporting, nothing saved: both start folded to one line with a short count', async () => {
    renderHome()
    await waitFor(() => expect(boxHeader('Reporting soon')).toHaveTextContent('None of your names in the next 7 days'))
    expect(boxHeader('Reporting soon')).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(boxHeader('Passed setups')).toHaveTextContent('None saved yet'))
    expect(boxHeader('Passed setups')).toHaveAttribute('aria-expanded', 'false')
    // folded means unmounted: the passed-setups add form is not in the page
    expect(screen.queryByRole('form', { name: 'Add a passed setup' })).toBeNull()
  })

  it('a box with something to show starts open, with its content and its count', async () => {
    server.soon = { items: [{ symbol: 'NVDA', date: '2026-10-12', daysAway: 2, timing: 'amc', sources: ['watchlist'] }], windowDays: 7 }
    server.passed = { items: [{ id: 'p1', symbol: 'AMD', source: 'watchlist', savedDay: '2026-10-01', status: 'scored', outcomes: [] }], tradedCount: 0 }
    renderHome()
    await waitFor(() => expect(boxHeader('Reporting soon')).toHaveAttribute('aria-expanded', 'true'))
    expect(boxHeader('Reporting soon')).toHaveTextContent('1 reporting in the next 7 days')
    expect(await screen.findByRole('button', { name: 'Create prep note for NVDA' })).toBeInTheDocument()
    await waitFor(() => expect(boxHeader('Passed setups')).toHaveAttribute('aria-expanded', 'true'))
    expect(boxHeader('Passed setups')).toHaveTextContent('1 saved')
    expect(await screen.findByRole('form', { name: 'Add a passed setup' })).toBeInTheDocument()
  })

  it('Reviews that write themselves starts open: its three drafts are always there to press', async () => {
    renderHome()
    expect(boxHeader('Reviews that write themselves')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Today's recap/ })).toBeInTheDocument()
    // its own heading stays for screen readers (and its skip link), drawn once by the header
    expect(screen.getByRole('heading', { name: 'Reviews that write themselves' })).toBeInTheDocument()
  })

  it('an unfolded empty box keeps its existing behaviour (the add form is there)', async () => {
    renderHome()
    await waitFor(() => expect(boxHeader('Passed setups')).toHaveTextContent('None saved yet'))
    fireEvent.click(boxHeader('Passed setups'))
    expect(boxHeader('Passed setups')).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('form', { name: 'Add a passed setup' })).toBeInTheDocument()
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument()
  })

  it('the member\'s own choice wins over the default, and is kept', async () => {
    window.localStorage.setItem(SECTION_KEY('nb-home-passed-setups'), '1')
    window.localStorage.setItem(SECTION_KEY('nb-home-reviews'), '0')
    renderHome()
    await waitFor(() => expect(boxHeader('Passed setups')).toHaveTextContent('None saved yet'))
    expect(boxHeader('Passed setups')).toHaveAttribute('aria-expanded', 'true')
    expect(boxHeader('Reviews that write themselves')).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('a walkthrough or a door aimed inside a folded box unfolds it', () => {
  beforeEach(() => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true, notebook_passed_setups_enabled: true })
  })

  it('a running registry tour unfolds every folded box -- never persisted', async () => {
    renderHome()
    await waitFor(() => expect(boxHeader('Reporting soon')).toHaveTextContent('None of your names'))
    await waitFor(() => expect(boxHeader('Passed setups')).toHaveTextContent('None saved yet'))
    expect(boxHeader('Reporting soon')).toHaveAttribute('aria-expanded', 'false')
    act(() => { publishRegistryTourWanted('earnings-prep') })
    expect(boxHeader('Reporting soon')).toHaveAttribute('aria-expanded', 'true')
    expect(boxHeader('Passed setups')).toHaveAttribute('aria-expanded', 'true')
    // the tour's anchors are on screen now
    expect(document.querySelector('[data-tour="reporting-soon-list"]')).not.toBeNull()
    expect(document.querySelector('[data-tour="passed-add"]')).not.toBeNull()
    expect(window.localStorage.getItem(SECTION_KEY('nb-home-reporting-soon'))).toBeNull()
  })

  it('the palette\'s "Earnings prep" (#prep) unfolds Reporting soon', async () => {
    renderHome({ entry: '/journal/notebook#prep' })
    await waitFor(() => expect(boxHeader('Reporting soon')).toHaveAttribute('aria-expanded', 'true'))
    expect(boxHeader('Passed setups')).toHaveAttribute('aria-expanded', 'false')
  })
})
