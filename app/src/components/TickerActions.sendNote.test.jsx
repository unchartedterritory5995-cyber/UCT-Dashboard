// Wave R (R-2e) — "Send chart to note" on the universal per-symbol menu.
//
// TickerActions is the right-click/long-press menu behind ticker chips across the
// whole app. It offered Flag · colour tags · + Add to list · Compare · Set alert
// and had no way to put the symbol into a note. This is that entry: right-click
// any symbol anywhere → a chart widget for it, frozen at a timeframe and a spot.
//
// ⛔ NOTHING ON THE PATH UNDER TEST IS MOCKED. `sendCaptureToJournal`,
// `captureTargets`, `buildWidgetEmbedAttrs` and the widget registry are all real;
// `fetch` is the only seam. The mocks below are exactly the ones the file's own
// existing tests use (TickerActions.compare.test.jsx) — the hooks it already
// needed — and NOT the journal wiring, because a stubbed send cannot tell you
// what the member's note actually received.
//
// ⭐ The mock set is also the context rail: there is no VoiceProvider, no journal
// context, no capture host anywhere above this component. That is the state on
// most of the surfaces that render it, and the entry must work there.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { isReconstructable, normalizeParams } from '../widgets/registry'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({ toggle: vi.fn(), isFlagged: () => false }),
}))
vi.mock('../hooks/useTickerTags', () => ({
  default: () => ({ getTag: () => null, setTag: vi.fn(), removeTag: vi.fn() }),
}))
vi.mock('../hooks/useWatchlistAlerts', () => ({
  default: () => ({
    createAlert: vi.fn(), deleteAlert: vi.fn(),
    getAlertsForSym: () => [], hasAlert: () => false,
  }),
}))
vi.mock('../hooks/useTagColors', () => ({ default: () => ({ tagColors: [] }) }))
vi.mock('../hooks/useBreakpoint', () => ({ useIsTouch: () => false }))
vi.mock('./chart/SymbolSearch', () => ({ default: () => null }))

const TickerActionsMenu = (await import('./TickerActions')).default

const MENU = { sym: 'NVDA', x: 100, y: 100 }
const ENTRY = /send nvda chart to note/i

let posted = []
function stubFetch(ok = true) {
  posted = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    posted.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
    return { ok, status: ok ? 200 : 500, json: async () => ({}) }
  }))
}
const inboxPost = () => posted.find(p => p.url.includes('/api/j2/inbox'))

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
  stubFetch()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('the universal ticker menu offers a send-to-note entry, on a surface with no journal context at all', () => {
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  // Reaching this line at all is half the assertion: the entry must not throw on
  // a tree with no provider above it.
  expect(screen.getByRole('button', { name: ENTRY })).toBeTruthy()
})

test('CONTROL — the destinations are absent until the entry is opened', () => {
  // Non-vacuity for every "a destination is on screen" assertion below: these
  // queries CAN come back empty, so their finding something means something.
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Notebook inbox' })).toBeNull()
  expect(screen.queryByText(/frozen at now/i)).toBeNull()
})

test('opening it says WHAT is being frozen and offers every destination', () => {
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: ENTRY }))

  // ⭐ The sentence a human reads. There is no chart in scope here, so the member
  // is told exactly what this door knows — a daily chart, anchored at now — rather
  // than being left to assume it captured whatever they were looking at.
  expect(screen.getByText('Daily chart of NVDA, frozen at now')).toBeTruthy()

  expect(screen.getByRole('button', { name: 'Current note' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'New entry' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Notebook inbox' })).toBeTruthy()
  // A chart capture with a symbol earns the chart-only destination too.
  expect(screen.getByRole('button', { name: 'Copy chart link' })).toBeTruthy()
})

test('choosing a destination inserts the chart and tells the member where it landed', async () => {
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: ENTRY }))
  fireEvent.click(screen.getByRole('button', { name: 'Notebook inbox' }))

  // ⛔ THE RENDERED SENTENCE, not a setter call. And it must still be on screen
  // AFTER the action: the menu deliberately does not close on send, because a
  // message owned by a branch its own action unmounts renders for zero frames.
  await screen.findByText('NVDA captured → Notebook inbox')

  const post = inboxPost()
  expect(post, 'no capture reached /api/j2/inbox').toBeTruthy()
  expect(post.body.widgetId).toBe('chart')
  expect(post.body.params.symbol).toBe('NVDA')
})

test('the frozen params are HONEST about what was and was not known', async () => {
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: ENTRY }))
  fireEvent.click(screen.getByRole('button', { name: 'Notebook inbox' }))
  await waitFor(() => expect(inboxPost()).toBeTruthy())

  const params = inboxPost().body.params
  expect(params.tf).toBe('D')
  expect(params.to).toEqual(expect.any(Number))
  // ⛔ NO visible range. This door has no chart instance and therefore never
  // measured one; writing a `from` would be a claim about what the member saw.
  // ChartEmbed frames the snapshot from `to` alone and never reads `from`.
  expect(params.from).toBeUndefined()
})

test("the anchor is the moment the member ASKED, not the moment they picked a destination", async () => {
  // Every other capture door freezes when its menu opens. `buildWidgetEmbedAttrs`
  // would stamp `to` itself at send time, and the interval a member spends reading
  // four destination labels is exactly where "frozen means anchored" would quietly
  // stop being true.
  const OPENED_AT = 1_757_500_000_000
  const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(OPENED_AT)
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: ENTRY }))

  // …the member deliberates for ten minutes.
  nowSpy.mockReturnValue(OPENED_AT + 600_000)
  fireEvent.click(screen.getByRole('button', { name: 'Notebook inbox' }))
  await waitFor(() => expect(inboxPost()).toBeTruthy())

  expect(inboxPost().body.params.to).toBe(Math.floor(OPENED_AT / 1000))
})

test('the default timeframe keeps the note renderable forever — an intraday one would not', async () => {
  // This is the justification for `TICKER_CAPTURE_TF = 'D'`, expressed as a test
  // rather than only a comment. `chartReconstructable` gates NUMERIC tfs on
  // CHART_TF_CEILING_DAYS; this door archives no fallback image, so an expired
  // intraday default degrades to a placeholder chip inside a kept note.
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: ENTRY }))
  fireEvent.click(screen.getByRole('button', { name: 'Notebook inbox' }))
  await waitFor(() => expect(inboxPost()).toBeTruthy())

  const params = normalizeParams('chart', inboxPost().body.params)
  const twoYearsAgo = { ...params, to: Math.floor(Date.now() / 1000) - 730 * 86400 }
  expect(isReconstructable('chart', twoYearsAgo)).toBe(true)
  // The same capture on the 1-minute timeframe (ceiling 60 days) would not be.
  expect(isReconstructable('chart', { ...twoYearsAgo, tf: '1' })).toBe(false)
})

test('a failed send says so, in words', async () => {
  stubFetch(false)
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: ENTRY }))
  fireEvent.click(screen.getByRole('button', { name: 'Notebook inbox' }))
  await screen.findByText('Capture failed — try again')
})

test('the pre-existing menu actions still work beside the new entry', () => {
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  expect(screen.getByRole('button', { name: /full research/i })).toBeTruthy()
  expect(screen.getByRole('button', { name: /flag/i })).toBeTruthy()
  expect(screen.getByRole('button', { name: /compare nvda with/i })).toBeTruthy()
  expect(screen.getByRole('button', { name: /set alert/i })).toBeTruthy()
})
