// Audit 2026-11-05, S15 (M1) + S18: the Today home. One read, the cards in the session's order, a teaching empty
// state on every card, a section that failed said in place, the recap after 16:05 ET, and nothing that shifts.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const draftDailyReview = vi.fn()
vi.mock('../../lib/reviewDrafts', () => ({
  draftDailyReview: (...a) => draftDailyReview(...a),
  todayDayIso: () => '2026-11-05',
}))
vi.mock('./FirstRunGate', () => ({ FirstRunInlineSlot: () => <div data-testid="first-run-inline" /> }))
const runNoteBatch = vi.fn()
vi.mock('../../lib/noteBatch', () => ({ runNoteBatch: (...a) => runNoteBatch(...a) }))

import TodayHome, {
  CARD_ORDER, FRESH_ACTION, RECAP_ACTION, RECAP_WRITTEN, RESTORE_ACTION, SKELETON_ORDER, TODAY_URL, TRASHED_NOTE,
  cardOrder, headerLine, msUntilET,
} from './TodayHome'
import { CAPTURE_OPEN_EVENT } from '../../lib/captureBus'
import { NAMES_ASK } from './EmptyNamesAsk'
import { FIRST_PLAN } from './FirstPlanAsk'
import { DAILY_FOLDER_NOTICE } from '../../lib/dailyNote'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { SOON_URL } from '../../lib/earningsPrepShared'
import { PASSED_URL } from '../../lib/researchCapture'

const NOTE = {
  id: 'n-today', title: '2026-11-05 · Thursday', updatedAt: 'x', created: false, templateMissing: false,
  templateName: 'Daily prep', items: [{ index: 0, text: 'Check the market', checked: true },
    { index: 1, text: 'Review the 2 setups within 3% of entry', checked: false }],
  openCount: 1, itemCount: 2, snippet: null, recapWritten: false,
}

function payload(over = {}) {
  return {
    day: '2026-11-05',
    session: { day: '2026-11-05', weekday: 'Thursday', phase: 'premarket', minutesToOpen: 72, recap: false },
    market: { held: true, regime: 'green', regimeWord: 'Green', pctAbove50: 61 },
    setups: { count: 3, nearCount: 2, more: 0, rows: [
      { noteId: 'p1', symbol: 'NVDA', setupTag: 'Flag', state: 'waiting', distancePct: 1.2, distanceR: 0.6, entry: 206 },
      { noteId: 'p3', symbol: 'ANET', setupTag: 'Pullback', state: 'invalidated', distancePct: -4, distanceR: -1 },
    ] },
    names: { count: 2, more: 0, earningsUnknown: false, buzzKnown: true, reportingToday: ['AMD'], rows: [
      { symbol: 'AMD', price: 160, changePct: 1.9, earnings: { date: '2026-11-05', daysAway: 0, timing: 'amc', expectedMovePct: 7.8 }, mentions: 0, buzzHigh: false },
      { symbol: 'TSLA', price: 300, changePct: -1.2, earnings: null, mentions: 3, buzzHigh: true },
    ] },
    todayNote: NOTE,
    openFromYesterday: { count: 1, more: 0, priorDaily: null, items: [
      { noteId: 'n-y', noteTitle: 'yesterday', index: 0, text: 'Move the stop on CRWD to breakeven', due: null, from: 'yesterday' }] },
    onThisDay: { count: 1, items: [
      { noteId: 'n-old', title: 'NVDA thesis', day: '2025-11-05', yearsAgo: 1, snippet: 'NVDA flag after earnings' }] },
    reasons: {},
    ...over,
  }
}

const S = { today: null, calls: [], prefs: {}, hold: null }
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

beforeEach(() => {
  S.today = payload()
  S.calls = []
  S.prefs = {}
  S.hold = null
  draftDailyReview.mockReset()
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    const u = String(url)
    S.calls.push({ url: u, method: opts.method || 'GET', body: opts.body })
    if (u === TODAY_URL || u === `${TODAY_URL}?make=0`) return S.hold ? S.hold.then(() => ok(S.today)) : ok(S.today)
    if (u === '/api/auth/preferences' && (opts.method || 'GET') === 'GET') return ok(S.prefs)
    if (u.startsWith('/api/watchlists')) return ok([])
    return ok({})
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); __resetNotebookFlags() })

const renderToday = (props = {}) => render(
  <MemoryRouter><TodayHome onOpenNote={vi.fn()} onCreateNote={vi.fn()} onSelectAllNotes={vi.fn()} {...props} /></MemoryRouter>)
const cards = () => [...document.querySelectorAll('[data-today-card]')].map((c) => c.getAttribute('data-today-card'))
const todayReads = () => S.calls.filter((c) => c.url === TODAY_URL)

describe('one read, the M1 layout', () => {
  it('draws the greeting line, the five cards in pre-market order, from ONE request', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    expect(cards()).toEqual(CARD_ORDER.premarket)
    expect(todayReads()).toHaveLength(1)
    expect(document.querySelector('[data-today-line]').textContent)
      .toBe('Thursday, Nov 5 · Pre-market · Green regime · 61% above the 50-day · 1 h 12 m to the open')
    expect(screen.getByText('Started from “Daily prep”')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New note' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All notes' })).toBeInTheDocument()
    const setups = screen.getByTestId('today-setups')
    expect(within(setups).getByText('1.2% away')).toBeInTheDocument()
    expect(within(setups).getByText('below stop')).toBeInTheDocument()
    expect(within(setups).getByText('Review →')).toBeInTheDocument()
    const names = screen.getByTestId('today-names')
    expect(within(names).getByText('Earnings today AMC')).toBeInTheDocument()
    expect(within(names).getByText('exp. move ±7.8%')).toBeInTheDocument()
    expect(within(names).getByText('Room buzz high')).toBeInTheDocument()
    expect(within(names).getByText('3 mentions')).toBeInTheDocument()
    expect(screen.getByText('“NVDA flag after earnings”')).toBeInTheDocument()
    expect(screen.getByText('1 year ago')).toBeInTheDocument()
  })

  // Fix round 1 (I7): before the server says which session it is, the boxes are reserved in ONE fixed order. Every
  // half-width card reserves the same height (TodayHome.layout.test.js reads the CSS), so the answer's order -- a
  // session's, or a holiday's "closed" -- fills the same total space: same boxes, same wide cards, same reserves.
  it.each(['premarket', 'open', 'closed'])('reserves every card in a fixed order; the %s answer fills the same space', async (phase) => {
    let release
    S.hold = new Promise((r) => { release = r })
    S.today = payload({ session: { ...payload().session, phase, recap: false } })
    renderToday()
    const skeletons = () => [...document.querySelectorAll('[data-today-skeleton]')]
    await waitFor(() => expect(skeletons().length).toBeGreaterThan(0))
    expect(skeletons().map((s) => s.getAttribute('data-today-skeleton'))).toEqual([...SKELETON_ORDER])
    const reserve = (el) => el.className.split(' ').filter((c) => /card_|wide/.test(c)).map((c) => c.replace(/_[^_]+$/, ''))
    const before = skeletons().map(reserve).map((r) => r.join(' ')).sort()
    await act(async () => { release() })
    await screen.findByTestId('today-plan')
    const cards = [...document.querySelectorAll('[data-today-card]')]
    expect(cards.map((c) => c.getAttribute('data-today-card'))).toEqual(CARD_ORDER[phase])
    expect(cards.map(reserve).map((r) => r.join(' ')).sort()).toEqual(before)
  })

  it('the inline first-run ask sits BELOW the cards, never above them', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    const grid = document.querySelector('[data-today-card]').parentElement
    const ask = screen.getByTestId('first-run-inline')
    expect(grid.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the session orders the cards', () => {
  it('during the session the setups lead; after the close the recap leads (S18)', () => {
    expect(cardOrder({ phase: 'open' })).toEqual(['setups', 'names', 'plan', 'yesterday', 'onThisDay'])
    expect(cardOrder({ phase: 'after_close', recap: true })[0]).toBe('recap')
    expect(cardOrder({ phase: 'after_close', recap: false })).not.toContain('recap')     // 16:00 to 16:05
    expect(cardOrder({ phase: 'after_close', recap: true }, { recapOn: false })).not.toContain('recap')
    expect(cardOrder({ phase: 'closed' })[0]).toBe('plan')
  })

  it('the header line drops what is not held', () => {
    expect(headerLine({ day: '2026-11-05', session: { phase: 'open' }, market: { held: false } }))
      .toBe('Thursday, Nov 5 · Market open')
  })
})

describe('never empty (M7)', () => {
  it('no names asks for them; no setups asks for the first plan; empty lists say what fills them', async () => {
    S.today = payload({
      names: { count: 0, rows: [], more: 0, earningsUnknown: false, buzzKnown: false, reportingToday: [] },
      setups: { count: 0, nearCount: 0, rows: [], more: 0 },
      openFromYesterday: { count: 0, items: [], more: 0, priorDaily: null },
      onThisDay: { count: 0, items: [] },
      todayNote: { ...NOTE, items: [], itemCount: 0, openCount: 0 },
    })
    renderToday()
    await screen.findByTestId('today-plan')
    expect(within(screen.getByTestId('today-names')).getByText(NAMES_ASK)).toBeInTheDocument()
    expect(within(screen.getByTestId('today-setups')).getByText(FIRST_PLAN.title)).toBeInTheDocument()
    expect(within(screen.getByTestId('today-yesterday')).getByText(/Nothing left open/)).toBeInTheDocument()
    expect(within(screen.getByTestId('today-on-this-day')).getByText(/Nothing written on this date/)).toBeInTheDocument()
    expect(within(screen.getByTestId('today-plan')).getByText(/Nothing on today’s plan yet/)).toBeInTheDocument()
  })

  it('a section the plan does not include is its neutral empty line; one that failed offers a retry (M7)', async () => {
    S.today = payload({ names: null, setups: null, market: null, reasons: { names: 'error', setups: 'plan', market: 'plan' } })
    renderToday()
    await screen.findByTestId('today-plan')
    expect(screen.getByText('No setups to show.')).toBeInTheDocument()
    expect(screen.queryByText(/paid plan/i)).toBeNull()
    expect(screen.queryByText(NAMES_ASK)).toBeNull()                       // never the ask to a member who has names
    const reads = todayReads().length
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(todayReads().length).toBe(reads + 1))
    expect(screen.getByTestId('today-on-this-day')).toBeInTheDocument()
  })

  it('I3: a trashed day note offers Restore and Start a fresh one, and makes nothing by itself', async () => {
    S.today = payload({ todayNote: { id: 'n-old', trashed: true, missing: false, created: false, items: [] } })
    renderToday({ dailyTemplateId: 'tpl1' })
    expect(await screen.findByText(TRASHED_NOTE)).toBeInTheDocument()
    expect(S.calls.some((c) => c.method === 'POST' && c.url.startsWith('/api/j2/notes'))).toBe(false)
    runNoteBatch.mockResolvedValue({ results: [{ id: 'n-old', status: 'changed' }] })
    fireEvent.click(screen.getByRole('button', { name: RESTORE_ACTION }))
    await waitFor(() => expect(runNoteBatch).toHaveBeenCalledWith({ ids: ['n-old'], op: 'restore' }))
    fireEvent.click(await screen.findByRole('button', { name: FRESH_ACTION }))
    await waitFor(() => expect(S.calls.some((c) => c.url === '/api/j2/notes/daily' && c.method === 'POST')).toBe(true))
    const post = S.calls.find((c) => c.url === '/api/j2/notes/daily')
    expect(JSON.parse(post.body)).toMatchObject({ templateId: 'tpl1', seedToday: true })
  })

  it('I9: with the first run due Today asks with make=0 and says the plan comes with the setup', async () => {
    S.today = payload({ todayNote: { id: null, missing: true, trashed: false, created: false, items: [] } })
    const { rerender } = renderToday({ todayRead: 'hold' })
    await screen.findByText('Today’s plan is written when you set up your Notebook.')
    expect(S.calls.map((c) => c.url)).toContain(`${TODAY_URL}?make=0`)
    expect(S.calls.map((c) => c.url)).not.toContain(TODAY_URL)
    S.today = payload()
    rerender(<MemoryRouter><TodayHome onOpenNote={vi.fn()} onCreateNote={vi.fn()} onSelectAllNotes={vi.fn()} todayRead="make" /></MemoryRouter>)
    await waitFor(() => expect(S.calls.map((c) => c.url)).toContain(TODAY_URL))
  })

  it('R1-B: an established member makes exactly ONE request, with make=1 -- waiting first reads nothing', async () => {
    const { rerender } = renderToday({ todayRead: 'wait' })
    await new Promise((r) => setTimeout(r, 30))
    expect(todayReads()).toHaveLength(0)
    expect(document.querySelectorAll('[data-today-skeleton]').length).toBe(SKELETON_ORDER.length)   // skeletons up
    rerender(<MemoryRouter><TodayHome onOpenNote={vi.fn()} onCreateNote={vi.fn()} onSelectAllNotes={vi.fn()} todayRead="make" /></MemoryRouter>)
    await screen.findByTestId('today-plan')
    await new Promise((r) => setTimeout(r, 30))
    const reads = S.calls.filter((c) => c.url.startsWith(TODAY_URL))
    expect(reads.map((c) => c.url)).toEqual([TODAY_URL])
    expect(screen.queryByText('Today’s plan is written when you set up your Notebook.')).toBeNull()
  })

  it("a note this read MADE says where it went (Tier 0's notice) and tells the Notebook once", async () => {
    S.today = payload({ todayNote: { ...NOTE, created: true } })
    const onNoteMade = vi.fn()
    renderToday({ onNoteMade })
    await screen.findByText(DAILY_FOLDER_NOTICE)
    await waitFor(() => expect(onNoteMade).toHaveBeenCalledTimes(1))
    expect(onNoteMade.mock.calls[0][0].id).toBe('n-today')
  })
})

describe('the evening loop (S18)', () => {
  const evening = (over = {}) => payload({
    session: { day: '2026-11-05', weekday: 'Thursday', phase: 'after_close', minutesToOpen: null, recap: true }, ...over })

  it('after 16:05 the recap card leads and writes the review drafts into today’s note', async () => {
    latchNotebookFlags({ notebook_review_drafts_enabled: true })
    S.today = evening()
    const onOpenNote = vi.fn()
    const onNotice = vi.fn()
    draftDailyReview.mockResolvedValue({ note: { id: 'n-today' }, created: false })
    renderToday({ onOpenNote, onNotice })
    await screen.findByTestId('today-recap')
    expect(cards()[0]).toBe('recap')
    fireEvent.click(screen.getByRole('button', { name: RECAP_ACTION }))
    await waitFor(() => expect(onOpenNote).toHaveBeenCalled())
    expect(draftDailyReview).toHaveBeenCalledWith({ accountId: null, day: '2026-11-05' })
    expect(onOpenNote.mock.calls[0][0]).toEqual({ id: 'n-today' })
    expect(onNotice).not.toHaveBeenCalled()                          // the note already existed
  })

  it('a recap that made the note says where it went', async () => {
    latchNotebookFlags({ notebook_review_drafts_enabled: true })
    S.today = evening()
    const onNotice = vi.fn()
    draftDailyReview.mockResolvedValue({ note: { id: 'n-today' }, created: true })
    renderToday({ onNotice })
    fireEvent.click(await screen.findByRole('button', { name: RECAP_ACTION }))
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(DAILY_FOLDER_NOTICE))
  })

  it('a written recap is not offered again', async () => {
    latchNotebookFlags({ notebook_review_drafts_enabled: true })
    S.today = evening({ todayNote: { ...NOTE, recapWritten: true } })
    renderToday()
    await screen.findByText(RECAP_WRITTEN)
    expect(screen.queryByRole('button', { name: RECAP_ACTION })).toBeNull()
  })

  it('a failed recap says so and changes nothing', async () => {
    latchNotebookFlags({ notebook_review_drafts_enabled: true })
    S.today = evening()
    draftDailyReview.mockRejectedValue(new Error('500'))
    renderToday()
    fireEvent.click(await screen.findByRole('button', { name: RECAP_ACTION }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't write today's recap.")
  })
})

// Notebook simplify, Task 5: the Today home is the Daily brief, an optional page (the Notebook opens on the notes
// list). It no longer offers "Open the Notebook on" or a Research home link; its "All notes" button stays.
describe('the Daily brief', () => {
  it('offers no landing choice and no Research home link; All notes stays', async () => {
    const onSelectAllNotes = vi.fn()
    renderToday({ onSelectAllNotes, onOpenResearchHome: vi.fn() })
    await screen.findByTestId('today-plan')
    expect(screen.queryByLabelText('Open the Notebook on')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Research home/ })).toBeNull()
    expect(S.calls.some((c) => c.method === 'POST' && c.url === '/api/auth/preferences')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'All notes' }))
    expect(onSelectAllNotes).toHaveBeenCalledTimes(1)
  })

  it('below the cards: "Reporting soon" and "Passed setups", folded, reading nothing until opened', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true, notebook_passed_setups_enabled: true })
    renderToday()
    await screen.findByTestId('today-plan')
    const soon = screen.getByRole('button', { name: /^Reporting soon/ })
    const passed = screen.getByRole('button', { name: /^Passed setups/ })
    expect(soon.getAttribute('aria-expanded')).toBe('false')
    expect(passed.getAttribute('aria-expanded')).toBe('false')
    // after the cards
    const grid = document.querySelector('[data-today-card]').parentElement
    // eslint-disable-next-line no-bitwise
    expect(grid.compareDocumentPosition(soon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(S.calls.some((c) => c.url === SOON_URL || c.url === PASSED_URL)).toBe(false)
    fireEvent.click(soon)
    expect(soon.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(S.calls.some((c) => c.url === SOON_URL)).toBe(true))
  })

  it('CONTROL: with their switches off neither section is drawn', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    expect(screen.queryByRole('button', { name: /^Reporting soon/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Passed setups/ })).toBeNull()
  })
})

describe('where the Notebook opens', () => {

  it('sends today_opened once, with the session', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    await waitFor(() => expect(S.calls.some((c) => c.url === '/api/j2/telemetry')).toBe(true))
    const sent = S.calls.filter((c) => c.url === '/api/j2/telemetry').map((c) => JSON.parse(c.body))
    expect(sent).toEqual([{ event: 'today_opened', props: { session: 'premarket', created: false } }])
  })
})

describe('fix round 1 minors', () => {
  // Fix round 2 (N4): a return to the tab re-reads only when the answer is 90 s old, or the ET day or session
  // phase it was read in has changed -- a member flicking between the chart and the Notebook costs nothing.
  it('M1 + N4: a return to the tab re-reads only after 90 s (or a new day or phase)', async () => {
    let now = Date.parse('2026-11-05T13:15:00Z')                 // 08:15 ET, pre-market (the payload's phase)
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      renderToday()
      await screen.findByTestId('today-plan')
      const reads = todayReads().length
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      now += 30_000
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      await new Promise((r) => setTimeout(r, 30))
      expect(todayReads().length).toBe(reads)                     // 30 s later, same phase: nothing
      now += 61_000
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      await waitFor(() => expect(todayReads().length).toBe(reads + 1))
    } finally { spy.mockRestore() }
  })

  it('N4: a new session phase re-reads at once, inside the 90 s', async () => {
    let now = Date.parse('2026-11-05T14:29:30Z')                 // 09:29:30 ET, pre-market
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      renderToday()
      await screen.findByTestId('today-plan')
      const reads = todayReads().length
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      now += 40_000                                              // 09:30:10 ET: the session opened
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      await waitFor(() => expect(todayReads().length).toBe(reads + 1))
    } finally { spy.mockRestore() }
  })

  it('M1: the next boundary is counted in ET (16:05 and midnight)', () => {
    // 2026-11-05 15:00 ET = 20:00Z (EST, UTC-5)
    const at3pm = new Date('2026-11-05T20:00:00Z')
    expect(Math.round(msUntilET(16, 5, at3pm) / 60_000)).toBe(65)
    expect(Math.round(msUntilET(0, 0, at3pm) / 60_000)).toBe(9 * 60)
  })

  it('M3: Quick capture opens the Notebook’s one capture dialog', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    const seen = vi.fn()
    window.addEventListener(CAPTURE_OPEN_EVENT, seen)
    fireEvent.click(screen.getByRole('button', { name: 'Quick capture' }))
    window.removeEventListener(CAPTURE_OPEN_EVENT, seen)
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('M4: the greeting is an h2 under the Journal’s h1, and each card an h3', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    expect(document.querySelector('[data-today-home] h1')).toBeNull()
    expect(document.querySelector('[data-today-home] header h2')).toBeTruthy()
    expect(within(screen.getByTestId('today-plan')).getByRole('heading', { level: 3, name: "Today's plan" })).toBeInTheDocument()
  })

  it('M5: a row is named with its facts', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    expect(screen.getByRole('button', { name: 'NVDA, Flag, 1.2% away, 0.6R, entry 206' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ANET, Pullback, below stop, review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Move the stop on CRWD to breakeven/ })).toBeInTheDocument()
  })
})
