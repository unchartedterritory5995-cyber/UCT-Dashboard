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
vi.mock('./FirstRunGate', () => ({ FirstRunInlineSlot: () => null }))

import TodayHome, {
  CARD_ORDER, RECAP_ACTION, RECAP_WRITTEN, TODAY_URL, cardOrder, clientSession, headerLine,
} from './TodayHome'
import { NAMES_ASK } from './EmptyNamesAsk'
import { FIRST_PLAN } from './FirstPlanAsk'
import { DAILY_FOLDER_NOTICE } from '../../lib/dailyNote'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { LANDING_PREF } from '../../lib/todayHome'

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
    if (u === TODAY_URL) return S.hold ? S.hold.then(() => ok(S.today)) : ok(S.today)
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

  it('reserves every card while the read is in flight: the same boxes, in the same order (no shift)', async () => {
    let release
    S.hold = new Promise((r) => { release = r })
    // The skeleton is ordered by this browser's ET clock; the answer agrees with it (the same session).
    S.today = payload({ session: { ...payload().session, phase: clientSession().phase, recap: false } })
    renderToday()
    const skeletons = () => [...document.querySelectorAll('[data-today-skeleton]')]
    await waitFor(() => expect(skeletons().length).toBeGreaterThan(0))
    const before = skeletons().map((s) => [s.getAttribute('data-today-skeleton'), s.className])
    await act(async () => { release() })
    await screen.findByTestId('today-plan')
    const after = [...document.querySelectorAll('[data-today-card]')]
    // Each skeleton was the card that replaced it: the same card class, so the same reserved height.
    expect(after.map((c) => c.getAttribute('data-today-card'))).toEqual(before.map(([id]) => id))
    before.forEach(([id, cls], i) => {
      const cardClass = cls.split(' ').find((c) => c.includes(`card_${id}`))
      expect(cardClass).toBeTruthy()
      expect(after[i].className).toContain(cardClass)
    })
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

  it('a section that failed is said in its own card; the others still draw', async () => {
    S.today = payload({ names: null, setups: null, reasons: { names: 'error', setups: 'paid_plan' } })
    renderToday()
    await screen.findByTestId('today-plan')
    expect(screen.getByText('The setups board comes with a paid plan.')).toBeInTheDocument()
    expect(screen.getByText('This could not be read just now. Try again in a minute.')).toBeInTheDocument()
    expect(screen.getByTestId('today-on-this-day')).toBeInTheDocument()
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

describe('where the Notebook opens', () => {
  it('the member’s choice is stored on the account', async () => {
    renderToday()
    const select = await screen.findByLabelText('Open the Notebook on')
    await waitFor(() => expect(select).not.toBeDisabled())
    fireEvent.change(select, { target: { value: 'home' } })
    await waitFor(() => expect(S.calls.some((c) => c.method === 'POST' && c.url === '/api/auth/preferences'
      && JSON.parse(c.body).key === LANDING_PREF && JSON.parse(c.body).value === 'home')).toBe(true))
  })

  it('sends today_opened once, with the session', async () => {
    renderToday()
    await screen.findByTestId('today-plan')
    await waitFor(() => expect(S.calls.some((c) => c.url === '/api/j2/telemetry')).toBe(true))
    const sent = S.calls.filter((c) => c.url === '/api/j2/telemetry').map((c) => JSON.parse(c.body))
    expect(sent).toEqual([{ event: 'today_opened', props: { session: 'premarket', created: false } }])
  })
})
