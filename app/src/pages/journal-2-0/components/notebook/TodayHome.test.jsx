// Audit 2026-11-05, S15 (M1) + S18: the Today home. One read, the cards in the session's order, a section that failed
// said in place, the recap after 16:05 ET, and nothing that shifts.
// Simplify pass 2 (B1 to B5): the read is make=0 always (it never makes today's note); a card with nothing to show is
// not drawn; the two first-run asks are compact; one quiet line when nothing else is drawn; the header's one button is
// today's note (Start / Open / the Trash pair).
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
  CARD_ORDER, FRESH_ACTION, NAMES_ASK_LINE, NOTE_ACTION, NOTHING_YET, OPEN_ACTION, RECAP_ACTION, RECAP_WRITTEN,
  RESTORE_ACTION, SKELETON_ORDER, START_ACTION, STARTED_STATUS, STARTING_ACTION, TRASHED_NOTE, cardOrder, headerLine,
  msUntilET,
} from './TodayHome'
import { TODAY_READ_URL } from '../../lib/todayHome'
import { CAPTURE_OPEN_EVENT } from '../../lib/captureBus'
import { NAMES_ASK } from './EmptyNamesAsk'
import { FIRST_PLAN } from './FirstPlanAsk'
import { DAILY_FOLDER_NOTICE } from '../../lib/dailyNote'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { SOON_URL } from '../../lib/earningsPrepShared'
import { PASSED_URL } from '../../lib/researchCapture'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetRegistryTourControl, publishRegistryTourWanted } from './onboarding/tourRegistryControl'

const TODAY_URL = '/api/j2/notes/today'

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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); __resetNotebookFlags(); __resetRegistryTourControl() })

const renderToday = (props = {}) => render(
  <MemoryRouter><TodayHome onOpenNote={vi.fn()} onOpenToday={vi.fn()} {...props} /></MemoryRouter>)
const cards = () => [...document.querySelectorAll('[data-today-card]')].map((c) => c.getAttribute('data-today-card'))
const todayReads = () => S.calls.filter((c) => c.url === TODAY_READ_URL)
/** Every section empty: no plan lines, no setups, no names, nothing from yesterday, nothing on this day. */
const EMPTY = () => ({
  names: { count: 0, rows: [], more: 0, earningsUnknown: false, buzzKnown: false, reportingToday: [] },
  setups: { count: 0, nearCount: 0, rows: [], more: 0 },
  openFromYesterday: { count: 0, items: [], more: 0, priorDaily: null },
  onThisDay: { count: 0, items: [] },
  todayNote: { id: null, missing: true, trashed: false, created: false, items: [], itemCount: 0, openCount: 0 },
})
const header = () => document.querySelector('[data-today-home] header')

describe('one read, the M1 layout', () => {
  it('draws the greeting line, the five cards in pre-market order, from ONE request', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    expect(cards()).toEqual(CARD_ORDER.premarket)
    expect(todayReads()).toHaveLength(1)
    // Simplify pass 2 (A1): the page is titled by its panel row's name; the greeting leads the date line under it.
    expect(screen.getByRole('heading', { level: 2, name: 'Daily brief' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeNull()
    expect(document.querySelector('[data-today-line]').textContent).toMatch(
      /^Good (morning|afternoon|evening) · Thursday, Nov 5 · Pre-market · Green regime · 61% above the 50-day · 1 h 12 m to the open$/)
    expect(screen.getByText('Started from “Daily prep”')).toBeInTheDocument()
    // B4: the header's one button is today's note.
    expect(within(header()).getAllByRole('button').map((b) => b.textContent)).toEqual([OPEN_ACTION])
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

  // Simplify pass 2, fix round 1: the answer's card count is unknown until it lands (B2 hides empty cards), so the read
  // in flight draws the header and ONE skeleton, and nothing below the grid. The session's order fills in after it.
  it.each(['premarket', 'open', 'closed'])('one skeleton while the read is in flight; the %s answer draws its order', async (phase) => {
    let release
    S.hold = new Promise((r) => { release = r })
    S.today = payload({ session: { ...payload().session, phase, recap: false } })
    renderToday()
    const skeletons = () => [...document.querySelectorAll('[data-today-skeleton]')]
    await waitFor(() => expect(skeletons().length).toBeGreaterThan(0))
    expect(skeletons().map((s) => s.getAttribute('data-today-skeleton'))).toEqual(['plan'])
    expect([...SKELETON_ORDER]).toEqual(['plan'])
    await act(async () => { release() })
    await screen.findByTestId('today-plan')
    expect(skeletons()).toEqual([])
    expect(cards()).toEqual(CARD_ORDER[phase])
  })

  it('A1: a member with a name is greeted by first name, as the first part of the date line', async () => {
    render(
      <AuthContext.Provider value={{ user: { display_name: 'Pat Smith' } }}>
        <MemoryRouter><TodayHome onOpenNote={vi.fn()} onOpenToday={vi.fn()} /></MemoryRouter>
      </AuthContext.Provider>)
    await screen.findByTestId('today-plan')
    expect(screen.getByRole('heading', { level: 2, name: 'Daily brief' })).toBeInTheDocument()
    expect(document.querySelector('[data-today-line]').textContent).toMatch(/^Good (morning|afternoon|evening), Pat · Thursday, Nov 5 · /)
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

describe('B1: the read never makes today’s note; the header button says which it is', () => {
  it('(a) mounting issues exactly ONE today read, with make=0, and no POST', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    await new Promise((r) => setTimeout(r, 30))
    const reads = S.calls.filter((c) => c.url.startsWith(TODAY_URL))
    expect(reads.map((c) => c.url)).toEqual([`${TODAY_URL}?make=0`])
    expect(S.calls.filter((c) => c.method !== 'GET' && c.url !== '/api/j2/telemetry')).toEqual([])
  })

  it('(b) no note yet: "Start today’s note" calls the create path once, reads busy while it runs, and makes nothing itself', async () => {
    S.today = payload({ todayNote: EMPTY().todayNote })
    let done
    // Final fix I4: Start is the stay-on-the-brief door (`onStartToday`), never the one that opens the note.
    const onStartToday = vi.fn(() => new Promise((r) => { done = r }))
    const onOpenToday = vi.fn()
    renderToday({ onStartToday, onOpenToday })
    const start = await within(header()).findByRole('button', { name: START_ACTION })
    expect(screen.queryByTestId('today-plan')).toBeNull()                 // no plan lines: no plan card (B2)
    fireEvent.click(start)
    fireEvent.click(start)                                                  // a second press while the first runs
    expect(onStartToday).toHaveBeenCalledTimes(1)
    expect(onOpenToday).not.toHaveBeenCalled()
    expect(start).toBeDisabled()
    expect(start).toHaveTextContent(STARTING_ACTION)
    expect(start.getAttribute('aria-busy')).toBe('true')
    await act(async () => { done(false) })                                  // the press failed (NotebookTab said so)
    expect(start).not.toBeDisabled()
    expect(start).toHaveTextContent(START_ACTION)
    expect(document.querySelector('[data-today-actions] [role="status"]').textContent).toBe('')
    expect(S.calls.some((c) => c.method === 'POST' && c.url.startsWith('/api/j2/notes'))).toBe(false)
  })

  it('I4: a Start that made the note says so in the polite status, which is in the page before it speaks', async () => {
    S.today = payload({ todayNote: EMPTY().todayNote })
    const onStartToday = vi.fn(async () => true)
    renderToday({ onStartToday })
    const start = await within(header()).findByRole('button', { name: START_ACTION })
    const status = document.querySelector('[data-today-actions] [role="status"]')
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toBe('')
    fireEvent.click(start)
    await waitFor(() => expect(status.textContent).toBe(STARTED_STATUS))
    expect(document.querySelector('[data-today-actions] [role="status"]')).toBe(status)       // the same live region, never remounted
  })

  it('(c) a note today: "Open today’s note" opens it', async () => {
    const onOpenNote = vi.fn()
    const onOpenToday = vi.fn()
    renderToday({ onOpenNote, onOpenToday })
    fireEvent.click(await within(header()).findByRole('button', { name: OPEN_ACTION }))
    expect(onOpenNote).toHaveBeenCalledWith({ id: 'n-today', title: NOTE.title })
    expect(onOpenToday).not.toHaveBeenCalled()
    expect(within(header()).queryByRole('button', { name: START_ACTION })).toBeNull()
  })

  it('I3: a trashed day note puts Restore and Start a fresh one in the header, and makes nothing by itself', async () => {
    S.today = payload({ todayNote: { id: 'n-old', trashed: true, missing: false, created: false, items: [] } })
    const onOpenToday = vi.fn()
    renderToday({ dailyTemplateId: 'tpl1', onOpenToday })
    expect(await within(header()).findByText(TRASHED_NOTE)).toBeInTheDocument()
    expect(within(header()).queryByRole('button', { name: START_ACTION })).toBeNull()
    expect(within(header()).queryByRole('button', { name: OPEN_ACTION })).toBeNull()
    expect(screen.queryByTestId('today-plan')).toBeNull()
    expect(S.calls.some((c) => c.method === 'POST' && c.url.startsWith('/api/j2/notes'))).toBe(false)
    runNoteBatch.mockResolvedValue({ results: [{ id: 'n-old', status: 'changed' }] })
    fireEvent.click(within(header()).getByRole('button', { name: RESTORE_ACTION }))
    await waitFor(() => expect(runNoteBatch).toHaveBeenCalledWith({ ids: ['n-old'], op: 'restore' }))
    fireEvent.click(await within(header()).findByRole('button', { name: FRESH_ACTION }))
    await waitFor(() => expect(S.calls.some((c) => c.url === '/api/j2/notes/daily' && c.method === 'POST')).toBe(true))
    const post = S.calls.find((c) => c.url === '/api/j2/notes/daily')
    expect(JSON.parse(post.body)).toMatchObject({ templateId: 'tpl1', seedToday: true })
    expect(onOpenToday).not.toHaveBeenCalled()
  })

  it('today’s note section unread: the list button’s own words, which open or make it on the press', async () => {
    S.today = payload({ todayNote: null, reasons: { todayNote: 'error' } })
    const onOpenToday = vi.fn()
    renderToday({ onOpenToday })
    fireEvent.click(await within(header()).findByRole('button', { name: NOTE_ACTION }))
    expect(onOpenToday).toHaveBeenCalledTimes(1)
    const plan = document.querySelector('[data-today-card="plan"]')
    expect(within(plan).getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('while the read is in flight the button’s room is held by an invisible copy, never a live button', async () => {
    S.hold = new Promise(() => {})
    renderToday()
    await waitFor(() => expect(document.querySelector('[data-today-skeleton]')).not.toBeNull())
    expect(within(header()).queryAllByRole('button')).toEqual([])
    expect(header().querySelector('[data-today-actions] [aria-hidden="true"]').textContent).toBe(START_ACTION)
  })
})

describe('B2 to B5: only what it has', () => {
  it('(d) an empty section’s card is not drawn, and its teaching sentence is not on the page', async () => {
    S.today = payload({
      openFromYesterday: { count: 0, items: [], more: 0, priorDaily: null },
      onThisDay: { count: 0, items: [] },
      todayNote: { ...NOTE, items: [{ index: 0, text: 'Check the market', checked: true }], itemCount: 1, openCount: 0 },
    })
    renderToday()
    await screen.findByTestId('today-setups')
    for (const title of ['Open from yesterday', 'On this day', "Today's plan"]) {
      expect(screen.queryByRole('heading', { name: title })).toBeNull()
    }
    expect(cards()).toEqual(['setups', 'names'])                          // the session's order, empty ones skipped
    expect(document.body.textContent).not.toMatch(/shows here tomorrow|comes back here next year|Nothing on today/)
    expect(screen.queryByText(NOTHING_YET)).toBeNull()                    // setups and names have content
    expect(within(header()).getByRole('button', { name: OPEN_ACTION })).toBeTruthy()
  })

  it('CONTROL: the same cards draw when they have rows, in the session’s order', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    expect(cards()).toEqual(CARD_ORDER.premarket)
  })

  it('(e) every section empty: the one quiet line and the two compact asks, and no heading without content', async () => {
    S.today = payload(EMPTY())
    renderToday()
    expect(await screen.findByText(NOTHING_YET)).toBeInTheDocument()
    // Final fix M1: the card's own name, so it cannot read as the chart plan the setups ask right under it asks for.
    expect(NOTHING_YET).toBe('Nothing for today yet. Today’s plan, the setups near your entry and your names will show here.')
    expect(cards()).toEqual(['setups', 'names'])
    const h3s = [...document.querySelectorAll('[data-today-home] h3')]
    expect(h3s).toHaveLength(2)
    for (const h3 of h3s) expect(h3.closest('[data-today-card]').querySelector('input')).not.toBeNull()
    expect(within(header()).getByRole('button', { name: START_ACTION })).toBeTruthy()
  })

  it('(f) the compact asks: a heading, one sentence and the field; no ordered list, no suggestions', async () => {
    S.today = payload(EMPTY())
    renderToday()
    await screen.findByText(NOTHING_YET)
    for (const id of ['setups', 'names']) {
      const card = document.querySelector(`[data-today-card="${id}"]`)
      expect(card.querySelectorAll('h3')).toHaveLength(1)
      expect(card.querySelector('ol')).toBeNull()
      expect(within(card).queryByRole('group', { name: 'Suggestions' })).toBeNull()
      const lines = [...card.querySelectorAll('p')].filter((p) => p.textContent.trim())
      expect(lines).toHaveLength(1)
      expect(lines[0].textContent.trim().split(/[.!?](\s|$)/).filter((x) => x && x.trim())).toHaveLength(1)
      expect(card.querySelectorAll('input')).toHaveLength(1)
    }
    expect(within(document.querySelector('[data-today-card="names"]')).getByText(NAMES_ASK_LINE)).toBeTruthy()
    expect(screen.queryByText(NAMES_ASK)).toBeNull()
    expect(screen.queryByText(FIRST_PLAN.title)).toBeNull()
    expect(screen.getByText(FIRST_PLAN.line)).toBeInTheDocument()
  })

  it('a member with names but nothing else: no quiet line (the names card has content), and the setups ask stays', async () => {
    S.today = payload({ ...EMPTY(), names: payload().names })
    renderToday()
    await screen.findByTestId('today-names')
    expect(screen.queryByText(NOTHING_YET)).toBeNull()
    expect(screen.getByText(FIRST_PLAN.line)).toBeInTheDocument()
  })

  it('a section the plan does not include is not drawn; one that failed offers a retry (M7)', async () => {
    S.today = payload({ names: null, setups: null, market: null, reasons: { names: 'error', setups: 'plan', market: 'plan' } })
    renderToday()
    await screen.findByTestId('today-plan')
    expect(screen.queryByRole('heading', { name: 'Setups near entry' })).toBeNull()
    expect(screen.queryByText('No setups to show.')).toBeNull()
    expect(screen.queryByText(/paid plan/i)).toBeNull()
    expect(screen.queryByText(NAMES_ASK)).toBeNull()                       // never the ask to a member who has names
    expect(screen.getByRole('heading', { name: 'Your names' })).toBeInTheDocument()
    const reads = todayReads().length
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(todayReads().length).toBe(reads + 1))
    expect(screen.getByTestId('today-on-this-day')).toBeInTheDocument()
  })
})

describe('fix round 1: nothing on screen before the read moves when it lands', () => {
  beforeEach(() => { latchNotebookFlags({ notebook_earnings_prep_enabled: true, notebook_passed_setups_enabled: true }) })
  const home = () => document.querySelector('[data-today-home]')
  const below = () => ({
    more: document.querySelector('[data-today-more]'),
    firstRun: document.querySelector('[data-today-first-run]'),
    notes: document.querySelector('[data-today-home-notes]'),
    nothing: document.querySelector('[data-today-nothing]'),
  })
  const FOLLOWS = Node.DOCUMENT_POSITION_FOLLOWING

  it('read pending: the header and exactly one skeleton card; no folded box, no first-run slot, nothing else', async () => {
    S.hold = new Promise(() => {})
    renderToday()
    await waitFor(() => expect(document.querySelector('[data-today-skeleton]')).not.toBeNull())
    expect(document.querySelectorAll('[data-today-skeleton]')).toHaveLength(1)
    expect(document.querySelector('[data-today-skeleton]').getAttribute('data-today-skeleton')).toBe('plan')
    expect(below()).toEqual({ more: null, firstRun: null, notes: null, nothing: null })
    expect(screen.queryByRole('button', { name: /^Reporting soon/ })).toBeNull()
    expect(screen.queryByTestId('first-run-inline')).toBeNull()
    expect(document.querySelectorAll('[data-today-card]')).toHaveLength(0)
  })

  it('a member with nothing: the quiet line, the two compact asks and the folded boxes, all AFTER what was there', async () => {
    let release
    S.hold = new Promise((r) => { release = r })
    S.today = payload(EMPTY())
    renderToday()
    await waitFor(() => expect(document.querySelector('[data-today-skeleton]')).not.toBeNull())
    // Before the read: only the header and the one skeleton (in its grid) carry anything on screen.
    const headerBefore = header()
    const before = [...home().querySelectorAll('header, [data-today-skeleton], [data-today-card], [data-today-more], '
      + '[data-today-first-run], [data-today-nothing], [data-today-home-notes]')]
    expect(before.map((el) => el.tagName === 'HEADER' ? 'header' : el.getAttribute('data-today-skeleton'))).toEqual(['header', 'plan'])
    await act(async () => { release() })
    const quiet = await screen.findByText(NOTHING_YET)
    expect(header()).toBe(headerBefore)                                   // the same node, still first
    const { more, firstRun } = below()
    expect(more).not.toBeNull()
    expect(firstRun).not.toBeNull()
    expect(cards()).toEqual(['setups', 'names'])
    const grid = document.querySelector('[data-today-card]').parentElement
    // header -> quiet line -> grid -> first-run slot -> folded boxes; nothing new sits above what was on screen
    expect(headerBefore.compareDocumentPosition(quiet) & FOLLOWS).toBeTruthy()
    expect(quiet.compareDocumentPosition(grid) & FOLLOWS).toBeTruthy()
    expect(grid.compareDocumentPosition(firstRun) & FOLLOWS).toBeTruthy()
    expect(firstRun.compareDocumentPosition(more) & FOLLOWS).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Reporting soon/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Passed setups/ })).toBeInTheDocument()
  })

  it('a failed read still draws the retry line, the header button and the folded boxes', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      const u = String(url)
      if (u.startsWith(TODAY_URL)) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
      return ok({})
    }))
    const onOpenToday = vi.fn()
    renderToday({ onOpenToday })
    await waitFor(() => expect(document.querySelector('[data-load-failed]')).not.toBeNull())
    expect(within(document.querySelector('[data-load-failed]')).getByRole('button', { name: /try again|retry/i })).toBeTruthy()
    // Final fix M2: named as the heading names it.
    expect(document.querySelector('[data-load-failed]')).toHaveTextContent("Couldn't load your Daily brief.")
    expect(document.querySelector('[data-load-failed]')).not.toHaveTextContent(/load Today/)
    fireEvent.click(within(header()).getByRole('button', { name: NOTE_ACTION }))
    expect(onOpenToday).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-today-more]')).not.toBeNull()
    expect(document.querySelectorAll('[data-today-skeleton]')).toHaveLength(0)
  })

  it('a walkthrough wanted before the read: the folded boxes arrive with the answer, already open for it', async () => {
    let release
    S.hold = new Promise((r) => { release = r })
    publishRegistryTourWanted('earnings-prep')
    renderToday()
    await waitFor(() => expect(document.querySelector('[data-today-skeleton]')).not.toBeNull())
    expect(document.querySelector('[data-today-more]')).toBeNull()
    await act(async () => { release() })
    const soon = await screen.findByRole('button', { name: /^Reporting soon/ })
    await waitFor(() => expect(soon.getAttribute('aria-expanded')).toBe('true'))
    expect(screen.getByRole('button', { name: /^Passed setups/ }).getAttribute('aria-expanded')).toBe('true')
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
    expect(draftDailyReview).toHaveBeenCalledWith({ accountId: null, day: '2026-11-05', templateId: '', seedToday: true })
    expect(onOpenNote.mock.calls[0][0]).toEqual({ id: 'n-today' })
    expect(onNotice).not.toHaveBeenCalled()                          // the note already existed
  })

  // Final fix I1: after 16:05 the recap can be the first door of the day; it makes today's note as Start would, from the
  // member's daily template and with today's plan lines.
  it("I1: a recap on a day with no note sends the member's daily template and the seed", async () => {
    latchNotebookFlags({ notebook_review_drafts_enabled: true })
    S.today = evening({ todayNote: EMPTY().todayNote })
    draftDailyReview.mockResolvedValue({ note: { id: 'n-new' }, created: true })
    renderToday({ dailyTemplateId: 'tpl-daily' })
    fireEvent.click(await screen.findByRole('button', { name: RECAP_ACTION }))
    await waitFor(() => expect(draftDailyReview).toHaveBeenCalledTimes(1))
    expect(draftDailyReview).toHaveBeenCalledWith({
      accountId: null, day: '2026-11-05', templateId: 'tpl-daily', seedToday: true,
    })
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
    // Final fix M3: the card says where the recap is; the header's button is the ONE door to the note.
    const opens = screen.getAllByRole('button', { name: /open today.s note/i })
    expect(opens).toHaveLength(1)
    expect(header().contains(opens[0])).toBe(true)
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
// list). It no longer offers "Open the Notebook on" or a Research home link. Simplify pass 2 (B4): nor Quick capture,
// All notes or + New (the palette, the panel and the list have them).
describe('the Daily brief', () => {
  it('offers no landing choice, no Research home link, and no Quick capture / All notes / + New', async () => {
    renderToday({ onOpenResearchHome: vi.fn() })
    await screen.findByTestId('today-plan')
    expect(screen.queryByLabelText('Open the Notebook on')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Research home/ })).toBeNull()
    expect(S.calls.some((c) => c.method === 'POST' && c.url === '/api/auth/preferences')).toBe(false)
    for (const name of ['Quick capture', 'All notes', '+ New']) expect(screen.queryByRole('button', { name })).toBeNull()
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

  it('M3 + B4: the brief opens no capture dialog of its own (Quick capture lives in the command palette)', async () => {
    const seen = vi.fn()
    window.addEventListener(CAPTURE_OPEN_EVENT, seen)
    renderToday()
    await screen.findByTestId('today-plan')
    for (const b of within(header()).getAllByRole('button')) fireEvent.click(b)
    window.removeEventListener(CAPTURE_OPEN_EVENT, seen)
    expect(seen).not.toHaveBeenCalled()
  })

  it('M4: the greeting is an h2 under the Journal’s h1, and each card an h3', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    expect(document.querySelector('[data-today-home] h1')).toBeNull()
    expect(document.querySelector('[data-today-home] header h2')).toBeTruthy()
    expect(within(screen.getByTestId('today-plan')).getByRole('heading', { level: 3, name: "Today's plan" })).toBeInTheDocument()
  })

  it('simplify pass 2: the visible "Daily brief" heading takes the ref it is handed and is a programmatic focus target', async () => {
    const headingRef = { current: null }
    renderToday({ headingRef })
    await screen.findByTestId('today-plan')
    const h = screen.getByRole('heading', { level: 2, name: 'Daily brief' })
    expect(headingRef.current).toBe(h)
    expect(h.getAttribute('tabindex')).toBe('-1')
    expect(h.hasAttribute('data-focus-fallback')).toBe(true)
    act(() => { headingRef.current.focus() })
    expect(document.activeElement).toBe(h)
  })

  it('M5: a row is named with its facts', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    expect(screen.getByRole('button', { name: 'NVDA, Flag, 1.2% away, 0.6R, entry 206' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ANET, Pullback, below stop, review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Move the stop on CRWD to breakeven/ })).toBeInTheDocument()
  })
})
