// Go-live wave 1 (A1, A4): Research home's "Needs review", "Connected to your open positions" and Notices live on the
// Daily brief. The two note sections are drawn only when they have rows, read only after the cards' own read has
// answered, and open the note on a click; the Notices box sits at the top of the cards.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./FirstRunGate', () => ({ FirstRunInlineSlot: () => null }))
vi.mock('./NoticesBox', () => ({ default: () => <section data-testid="notices-box">Notices</section> }))

import TodayHome, { NEEDS_REVIEW_TITLE, OPEN_POSITIONS_TITLE, OPEN_POSITION_TAG, TODAY_URL, reviewReasonsLine } from './TodayHome'

const HOME_URL = '/api/j2/notebook/home'
const TODAY = {
  day: '2026-11-05',
  session: { phase: 'premarket', recap: false },
  todayNote: { id: 'n-today', title: 'Today', items: [] },
  setups: { count: 0, rows: [] },
  names: { count: 1, rows: [{ symbol: 'AMD' }] },
  openFromYesterday: { count: 0, items: [] },
  onThisDay: { count: 0, items: [] },
  reasons: {},
}
const HOME = {
  continueWorking: [], favorites: [], activeTheses: [],
  needsReview: [{ id: 'r1', title: 'NVDA thesis', ticker: 'NVDA',
    reviewReasons: [{ code: 'review_due', text: 'review due today' }, { code: 'x', text: '2 new trades since you last looked' }] }],
  openPositionResearch: [{ id: 'p1', title: 'CRWD plan', ticker: 'CRWD' }],
}

const S = { home: HOME, calls: [], releaseToday: null }
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

beforeEach(() => {
  S.home = HOME
  S.calls = []
  S.releaseToday = null
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    S.calls.push(u)
    if (u === TODAY_URL) {
      if (S.releaseToday) return new Promise((resolve) => { S.releaseToday.fn = () => resolve() }).then(() => ok(TODAY))
      return ok(TODAY)
    }
    if (u === HOME_URL) return ok(S.home)
    return ok({})
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const renderToday = (props = {}) => render(
  <MemoryRouter><TodayHome onOpenNote={vi.fn()} onCreateNote={vi.fn()} onSelectAllNotes={vi.fn()} {...props} /></MemoryRouter>)

describe('Needs review and Notes on your open positions, on the Daily brief', () => {
  it('draws both sections after the phase cards, with the reasons line and the Open position tag', async () => {
    renderToday()
    const review = await screen.findByTestId('today-needs-review')
    expect(within(review).getByRole('heading', { name: NEEDS_REVIEW_TITLE })).toBeInTheDocument()
    expect(within(review).getByText('review due today · 2 new trades since you last looked')).toBeInTheDocument()
    const positions = screen.getByTestId('today-open-positions')
    expect(within(positions).getByRole('heading', { name: OPEN_POSITIONS_TITLE })).toBeInTheDocument()
    expect(within(positions).getByText(OPEN_POSITION_TAG)).toBeInTheDocument()
    // After the phase cards: every phase card precedes both sections in document order.
    const plan = screen.getByTestId('today-plan')
    expect(plan.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a note title opens the note', async () => {
    const onOpenNote = vi.fn()
    renderToday({ onOpenNote })
    fireEvent.click(await screen.findByRole('button', { name: /NVDA thesis/ }))
    expect(onOpenNote).toHaveBeenCalledWith({ id: 'r1', title: 'NVDA thesis' })
    fireEvent.click(screen.getByRole('button', { name: /CRWD plan/ }))
    expect(onOpenNote).toHaveBeenLastCalledWith({ id: 'p1', title: 'CRWD plan' })
  })

  it('a section with no rows draws nothing at all: no heading, no empty line', async () => {
    S.home = { ...HOME, needsReview: [] }
    renderToday()
    await screen.findByTestId('today-open-positions')
    expect(screen.queryByTestId('today-needs-review')).toBeNull()
    expect(screen.queryByText(NEEDS_REVIEW_TITLE)).toBeNull()
  })

  it('both empty: nothing is drawn', async () => {
    S.home = { ...HOME, needsReview: [], openPositionResearch: [] }
    renderToday()
    await screen.findByTestId('today-plan')
    await waitFor(() => expect(S.calls).toContain(HOME_URL))
    expect(document.querySelector('[data-today-home-notes]')).toBeNull()
  })

  it('the home read waits for the cards\' own read, so it never delays a card', async () => {
    S.releaseToday = {}
    renderToday()
    await waitFor(() => expect(S.calls).toContain(TODAY_URL))
    // The cards are still skeletons and the home read has not been asked for.
    expect(document.querySelector('[data-today-skeleton]')).not.toBeNull()
    expect(S.calls).not.toContain(HOME_URL)
    S.releaseToday.fn()
    await screen.findByTestId('today-plan')
    await waitFor(() => expect(S.calls).toContain(HOME_URL))
    expect(await screen.findByTestId('today-needs-review')).toBeInTheDocument()
  })

  it('reviewReasonsLine: the server texts in order, blanks dropped; nothing for a row without reasons', () => {
    expect(reviewReasonsLine({ reviewReasons: [{ text: 'a' }, { text: ' ' }, {}, { text: 'b' }] })).toBe('a · b')
    expect(reviewReasonsLine({})).toBe('')
  })
})

describe('Notices on the Daily brief', () => {
  it('the Notices box is mounted at the top of the cards', async () => {
    renderToday()
    const notices = await screen.findByTestId('notices-box')
    const plan = await screen.findByTestId('today-plan')
    expect(notices.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
