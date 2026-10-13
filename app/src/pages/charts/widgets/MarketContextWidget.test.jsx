/**
 * Rails for the Market Context widget (R-3c).
 *
 * ⛔ EVERY member-facing assertion here reads RENDERED TEXT — same reason as the
 * Indexes rails: this repo shipped two toast defects in which the state
 * transition was correct and only the half that talks to the member was broken.
 *
 * ⛔ The load-bearing rail in this file is the POWER TREND one. `powerTrend` is
 * null by owner direction (2026-04-17, "rule not yet defined") and must render
 * as an em dash. Its predecessor shipped a column that was an em dash on every
 * row in production and the whole feature was later ripped out; the row is kept
 * here because the null IS the ruling, and the rail exists so nobody "fixes" it
 * by deriving a value or hiding the row.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import MarketContextWidget from './MarketContextWidget'
import { readingsFrom } from './marketContextModel'
import MarketContextEmbed from '../../journal-2-0/components/notebook/MarketContextEmbed'
import { contractBody } from '../../journal-2-0/__fixtures__/contract'

const mockData = vi.fn()
// Every key the widget asks the data hook for. A frozen stamp must ask for NONE
// (a null key is SWR's "do not fetch").
const mockSwrKeys = []
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: (key) => {
    mockSwrKeys.push(key)
    return { data: mockData(), mutate: vi.fn(), isValidating: false }
  },
}))

const sendMock = vi.fn(async () => 'Saved to Today’s note')
vi.mock('../../journal-2-0/lib/sendToJournal', () => ({
  sendCaptureToJournal: (...args) => sendMock(...args),
  buildCapture: vi.fn(),
}))

// The real `/api/breadth` shape (engine._normalize_breadth + _normalize_exposure).
// 2026-09-10 17:26 UTC = 1:26 PM ET. The fetcher stamps this onto the payload;
// the footer formats it in ET explicitly, so the assertion is host-TZ-proof.
const STAMP = Date.UTC(2026, 8, 10, 17, 26)

const BREADTH = {
  _fetchedAt: STAMP,
  pct_above_5ma: 44.2,
  pct_above_50ma: 62.4,
  pct_above_200ma: 55.1,
  advancing: 3200,
  declining: 1400,
  breadth_score: 71.5,
  distribution_days: 2,
  market_phase: 'Confirmed Uptrend',
  exposure: { score: 112, score_delta: 4, note: 'lean in', breakdown: {} },
  wire_date: '2026-09-10',
}

const OTHER_BREADTH = {
  ...BREADTH,
  breadth_score: 22.1,
  distribution_days: 6,
  market_phase: 'Correction',
  pct_above_50ma: 18.3,
  pct_above_200ma: 31.7,
  exposure: { score: 15, score_delta: -30 },
  wire_date: '2026-09-11',
}

// The /charts binding passes this widget NO props — it has no symbol and no
// per-widget options. Mount it the same way the host does.
function Wrap() {
  return <MarketContextWidget />
}

/** The value cell of one labelled row (the label and the value are siblings). */
const rowOf = (label) => screen.getByText(label).closest('div')

beforeEach(() => {
  sendMock.mockClear()
  mockData.mockReset()
  mockSwrKeys.length = 0
})

// ── What the member reads ───────────────────────────────────────────────────

test('every reading renders with its label and its value — as text', () => {
  mockData.mockReturnValue(BREADTH)
  render(<Wrap />)
  expect(screen.getByText('Market Context')).toBeInTheDocument()
  expect(rowOf('Market phase')).toHaveTextContent('Confirmed Uptrend')
  expect(rowOf('UCT Exposure')).toHaveTextContent('112')
  expect(rowOf('Breadth score')).toHaveTextContent('71.5')
  expect(rowOf('Distribution days')).toHaveTextContent('2')
  expect(rowOf('% above 50-day')).toHaveTextContent('62.4%')
  expect(rowOf('% above 200-day')).toHaveTextContent('55.1%')
  // The footer names the WIRE RUN the readings came from AND when they were
  // read — two different facts, and the wire date is the one that dates them.
  expect(screen.getByText('Wire 2026-09-10 · updated 1:26 PM ET')).toBeInTheDocument()
})

test('CONTROL — the reading rail reads the payload, not constants in the component', () => {
  mockData.mockReturnValue(BREADTH)
  const { rerender } = render(<Wrap />)
  expect(rowOf('Market phase')).toHaveTextContent('Confirmed Uptrend')
  mockData.mockReturnValue(OTHER_BREADTH)
  rerender(<Wrap />)
  expect(screen.queryByText('Confirmed Uptrend')).not.toBeInTheDocument()
  expect(rowOf('Market phase')).toHaveTextContent('Correction')
  expect(rowOf('Breadth score')).toHaveTextContent('22.1')
  expect(rowOf('UCT Exposure')).toHaveTextContent('15')
})

test("the exposure row renders the day's move with its sign", () => {
  mockData.mockReturnValue(BREADTH)
  const { rerender } = render(<Wrap />)
  expect(rowOf('UCT Exposure')).toHaveTextContent('+4')
  mockData.mockReturnValue(OTHER_BREADTH)
  rerender(<Wrap />)
  expect(rowOf('UCT Exposure')).toHaveTextContent('-30')
})

// ── ⛔ The power-trend ruling ────────────────────────────────────────────────

test('⛔ Power trend renders an EM DASH — the row is present and the value is never a reading', () => {
  mockData.mockReturnValue(BREADTH)
  render(<Wrap />)
  const row = rowOf('Power trend')
  expect(row).toBeInTheDocument()
  expect(row).toHaveTextContent('—')
  expect(row).not.toHaveTextContent(/On|Off|true|false|null/)
})

test('⛔ powerTrend stays null even when the payload offers something to read', () => {
  // The derivation rule does not exist (owner, 2026-04-17). A future wire that
  // starts publishing a power-trend-shaped field must NOT start populating it
  // by accident — that is a decision, not a data change.
  const r = readingsFrom({ ...BREADTH, power_trend: 'On', powerTrend: 'On' })
  expect(r.powerTrend).toBeNull()
  expect(r.marketPhase).toBe('Confirmed Uptrend')   // control: the fn does read the payload
})

test('an absent reading renders the em dash too, and no row is dropped', () => {
  mockData.mockReturnValue({ market_phase: '', breadth_score: null, exposure: {}, wire_date: null })
  render(<Wrap />)
  for (const label of ['Market phase', 'UCT Exposure', 'Breadth score', '% above 50-day', 'Power trend']) {
    expect(rowOf(label), label).toHaveTextContent('—')
  }
  // distribution_days is genuinely absent here — the row still stands.
  expect(rowOf('Distribution days')).toBeInTheDocument()
})

// ── The capture door ────────────────────────────────────────────────────────

test('Send to Journal freezes the readings on screen AND tells the member it saved', async () => {
  mockData.mockReturnValue(BREADTH)
  render(<Wrap />)
  fireEvent.click(screen.getByRole('button', { name: /send this market context to journal/i }))

  expect(sendMock).toHaveBeenCalledTimes(1)
  const [widgetId, capture, extra] = sendMock.mock.calls[0]
  expect(widgetId).toBe('marketcontext')
  expect(extra).toEqual({ label: 'Market context' })
  expect(capture.readings).toEqual({
    marketPhase: 'Confirmed Uptrend',
    exposureScore: 112,
    exposureDelta: 4,
    breadthScore: 71.5,
    distributionDays: 2,
    pctAbove50: 62.4,
    pctAbove200: 55.1,
    powerTrend: null,
  })
  expect(capture.wireDate).toBe('2026-09-10')

  // ⭐ The half that talks to the member.
  expect(await screen.findByText('Saved to Today’s note')).toBeInTheDocument()
})

test('CONTROL — the toast rail fails when the door says nothing', async () => {
  sendMock.mockImplementationOnce(async () => '')
  mockData.mockReturnValue(BREADTH)
  render(<Wrap />)
  fireEvent.click(screen.getByRole('button', { name: /send this market context to journal/i }))
  expect(await screen.findByRole('status')).toHaveTextContent('')
  expect(screen.queryByText('Saved to Today’s note')).not.toBeInTheDocument()
})

test('the “choose where” trigger opens the destination picker', async () => {
  mockData.mockReturnValue(BREADTH)
  render(<Wrap />)
  expect(screen.queryByText('Send to Notebook')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /send to journal — choose where/i }))
  expect(await screen.findByText('Send to Notebook')).toBeInTheDocument()
  expect(screen.getByLabelText('Capture comment')).toBeInTheDocument()
})

// ── The journal embed ───────────────────────────────────────────────────────

const FROZEN_ATTRS = {
  widgetId: 'marketcontext',
  params: {
    readings: {
      marketPhase: 'Confirmed Uptrend', exposureScore: 112, exposureDelta: 4,
      breadthScore: 71.5, distributionDays: 2, pctAbove50: 62.4, pctAbove200: 55.1,
      powerTrend: null,
    },
    wireDate: '2026-09-10',
    updated: '1:26 PM ET',
  },
}

test('the note embed renders the CAPTURED readings verbatim — never a live re-fetch', () => {
  // ⛔ The wire payload is OVERWRITTEN every morning, so a re-fetch would show
  // a DIFFERENT market inside a note written about this one. The hook is mocked
  // to a hostile-tape payload; the embed must still read the captured one.
  mockData.mockReturnValue(OTHER_BREADTH)
  render(<MarketContextEmbed attrs={FROZEN_ATTRS} height={280} />)
  expect(rowOf('Market phase')).toHaveTextContent('Confirmed Uptrend')
  expect(rowOf('Breadth score')).toHaveTextContent('71.5')
  expect(screen.queryByText('Correction')).not.toBeInTheDocument()
  expect(screen.queryByText('22.1')).not.toBeInTheDocument()
  expect(screen.getByText(/Wire 2026-09-10 · updated 1:26 PM ET/)).toBeInTheDocument()
})

test('⛔ the em dash survives the freeze — a note shows Power trend undefined, not missing', () => {
  mockData.mockReturnValue(OTHER_BREADTH)
  render(<MarketContextEmbed attrs={FROZEN_ATTRS} height={280} />)
  expect(rowOf('Power trend')).toHaveTextContent('—')
})

test('the note embed carries no capture doors', () => {
  mockData.mockReturnValue(BREADTH)
  render(<MarketContextEmbed attrs={FROZEN_ATTRS} height={280} />)
  expect(screen.queryByRole('button', { name: /send this market context to journal/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /choose where/i })).not.toBeInTheDocument()
})

test('an empty capture says so instead of rendering a blank panel', () => {
  mockData.mockReturnValue(BREADTH)
  render(<MarketContextEmbed attrs={{ widgetId: 'marketcontext', params: {} }} height={200} />)
  expect(screen.getByText('No market context was captured.')).toBeInTheDocument()
})

test('CONTROL — the embed rail fails when the frozen readings are not rendered', () => {
  mockData.mockReturnValue(BREADTH)
  render(<MarketContextEmbed attrs={FROZEN_ATTRS} height={280} />)
  expect(screen.queryByText('No market context was captured.')).not.toBeInTheDocument()
  expect(rowOf('UCT Exposure')).toHaveTextContent('112')
})

// ── Notebook P2a: the market context STAMP (Task 9) ─────────────────────────
// A note's frozen capture (IR-S6): the wire rows plus four sourced fields, each
// {value, source, asOf, missing}. Every assertion reads the RENDERED text.

const P2A_STAMP = {
  marketPhase: 'Uptrend', exposureScore: 32, exposureDelta: -4, breadthScore: 47.6, distributionDays: 3,
  pctAbove50: 41.3, pctAbove200: 55, powerTrend: null,
  regime: { value: 'orange', source: 'UCT Exposure Rating', asOf: '2026-10-13', missing: null },
  spy: { value: { price: 600.5, changePct: -0.42, closed: false }, source: 'live price', asOf: '2026-10-13T17:26:00Z', missing: null },
  qqq: { value: null, source: null, asOf: null, missing: 'No QQQ quote could be read just now.' },
  vix: { value: null, source: null, asOf: null, missing: 'VIX unavailable' },
}

test('P2a stamp: the regime, SPY, QQQ and VIX rows render after the wire rows, each with its time or its sentence', () => {
  render(<MarketContextWidget frozen={{ readings: P2A_STAMP, wireDate: '2026-10-13', updated: '1:26 PM ET', fields: 'all' }} readOnly journalDoor={false} />)
  expect(screen.getByText('Orange')).toBeTruthy()
  expect(screen.getByText('600.50 (-0.42%) · as of 1:26 PM ET')).toBeTruthy()
  expect(screen.getByText('No QQQ quote could be read just now.')).toBeTruthy()
  expect(screen.getByText('VIX unavailable')).toBeTruthy()
  expect(screen.getByText('Market phase')).toBeTruthy()
})

test('P2a stamp: the indexes preset shows SPY, QQQ and VIX only', () => {
  render(<MarketContextWidget frozen={{ readings: P2A_STAMP, fields: 'indexes' }} readOnly journalDoor={false} />)
  expect(screen.queryByText('Market phase')).toBeNull()
  expect(screen.queryByText('Orange')).toBeNull()
  expect(screen.getByText('VIX unavailable')).toBeTruthy()
})

test('P2a: an older capture (no stamp keys) renders exactly the rows it always did', () => {
  const OLD = { marketPhase: 'Uptrend', exposureScore: 32, breadthScore: 47.6, powerTrend: null }
  render(<MarketContextWidget frozen={{ readings: OLD }} readOnly journalDoor={false} />)
  expect(screen.queryByText('Regime')).toBeNull()
  expect(screen.queryByText('SPY')).toBeNull()
  expect(screen.queryByText('VIX')).toBeNull()
})

test('P2a: an uncaptured stamp says why it is empty, and offers no capture (IR-S11)', () => {
  render(<MarketContextWidget frozen={{ readings: null, uncaptured: true, fields: 'all' }} readOnly journalDoor={false} />)
  expect(screen.getByText('Market context is captured when a note is created. This note was written before it had one.')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

test('P2a stamp: each stored field renders its value, its source wording and its date', () => {
  render(<MarketContextWidget frozen={{ readings: P2A_STAMP, wireDate: '2026-10-13', fields: 'all' }} readOnly journalDoor={false} />)
  expect(rowOf('Regime')).toHaveTextContent('Orange')
  expect(rowOf('Regime')).toHaveTextContent('UCT Exposure Rating, as of 2026-10-13')
  expect(rowOf('SPY')).toHaveTextContent('600.50 (-0.42%) · as of 1:26 PM ET')
  expect(rowOf('SPY')).toHaveTextContent('Live price, Oct 13, 2026, 1:26 PM ET')
  expect(rowOf('QQQ')).toHaveTextContent('No QQQ quote could be read just now.')
  expect(rowOf('VIX')).toHaveTextContent('VIX unavailable')
})

test('P2a stamp: a closed index row says last close and its session close, in ET', () => {
  const closed = { ...P2A_STAMP, qqq: { value: { price: 500, changePct: 1, closed: true }, source: 'last close', asOf: '2026-10-09T20:00:00Z', missing: null } }
  render(<MarketContextWidget frozen={{ readings: closed, fields: 'indexes' }} readOnly journalDoor={false} />)
  expect(rowOf('QQQ')).toHaveTextContent('500.00 (+1.00%) · last close')
  expect(rowOf('QQQ')).toHaveTextContent('Last close, Oct 9, 2026, 4:00 PM ET')
})

test('P2a stamp (R-T3-5): an unavailable change says so — never 0.00%, never blank', () => {
  const noChange = { ...P2A_STAMP, spy: { value: { price: 600.5, changePct: null, closed: false }, source: 'live price', asOf: '2026-10-13T17:26:00Z', missing: null } }
  render(<MarketContextWidget frozen={{ readings: noChange, fields: 'indexes' }} readOnly journalDoor={false} />)
  expect(rowOf('SPY')).toHaveTextContent('600.50 · change unavailable · as of 1:26 PM ET')
  expect(rowOf('SPY')).not.toHaveTextContent('0.00%')
})

test('P2a stamp: the regime\'s internal source is worded for members, never rendered raw', () => {
  const raw = { ...P2A_STAMP, regime: { value: 'amber', source: 'journal_two.regime.get_current_regime', asOf: '2026-10-13', missing: null } }
  render(<MarketContextWidget frozen={{ readings: raw, fields: 'regime' }} readOnly journalDoor={false} />)
  expect(rowOf('Regime')).toHaveTextContent('Yellow')
  expect(rowOf('Regime')).toHaveTextContent('UCT Exposure Rating, as of 2026-10-13')
  expect(screen.queryByText(/journal_two|get_current_regime/)).toBeNull()
  expect(document.body.innerHTML).not.toMatch(/journal_two/)
})

test('P2a stamp: the regime preset shows the wire rows and the regime, and no index row', () => {
  render(<MarketContextWidget frozen={{ readings: P2A_STAMP, fields: 'regime' }} readOnly journalDoor={false} />)
  expect(screen.getByText('Market phase')).toBeTruthy()
  expect(rowOf('Regime')).toHaveTextContent('Orange')
  expect(screen.queryByText('SPY')).toBeNull()
  expect(screen.queryByText('VIX unavailable')).toBeNull()
})

test('P2a stamp: the board door sentence names the property, and only where a regime row shows', () => {
  const HINT = 'To see your notes by the regime they were written in, open your notes as a Board and group by "Regime when written".'
  const { unmount } = render(<MarketContextWidget frozen={{ readings: P2A_STAMP, fields: 'all' }} readOnly journalDoor={false} />)
  expect(screen.getByText(HINT)).toBeTruthy()
  unmount()
  render(<MarketContextWidget frozen={{ readings: P2A_STAMP, fields: 'indexes' }} readOnly journalDoor={false} />)
  expect(screen.queryByText(HINT)).toBeNull()
})

test('P2a stamp: a frozen stamp NEVER asks for live data to fill a gap', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'))
  try {
    mockData.mockReturnValue(OTHER_BREADTH)
    render(<MarketContextWidget frozen={{ readings: P2A_STAMP, fields: 'all' }} readOnly journalDoor={false} />)
    expect(mockSwrKeys.length).toBeGreaterThan(0)                         // non-vacuity: the hook was asked
    expect(mockSwrKeys.every((k) => k === null)).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    // The QQQ gap stays its sentence; nothing from the live payload leaks in.
    expect(screen.getByText('No QQQ quote could be read just now.')).toBeTruthy()
    expect(screen.queryByText('Correction')).toBeNull()
  } finally {
    fetchSpy.mockRestore()
  }
})

test('CONTROL — the live board DOES ask for the wire (the no-fetch rail can fail)', () => {
  mockData.mockReturnValue(BREADTH)
  render(<Wrap />)
  expect(mockSwrKeys).toContain('/api/breadth')
})

test('P2a: the board (no frozen capture) renders no sourced row and no board-door sentence', () => {
  mockData.mockReturnValue({ ...BREADTH, regime: { value: 'red' }, spy: { value: { price: 1 } } })
  render(<Wrap />)
  expect(screen.queryByText('Regime')).toBeNull()
  expect(screen.queryByText('SPY')).toBeNull()
  expect(screen.queryByText(/Regime when written/)).toBeNull()
  expect(screen.getByText('Market phase')).toBeTruthy()
})

test('P2a embed: the note embed passes the preset through', () => {
  mockData.mockReturnValue(OTHER_BREADTH)
  render(<MarketContextEmbed attrs={{ widgetId: 'marketcontext', capturedAt: '2026-10-13T17:26:00Z',
    params: { readings: P2A_STAMP, wireDate: '2026-10-13', updated: '1:26 PM ET', fields: 'indexes' } }} height={280} />)
  expect(screen.queryByText('Market phase')).toBeNull()
  expect(rowOf('SPY')).toHaveTextContent('600.50 (-0.42%) · as of 1:26 PM ET')
})

test('P2a embed: an uncaptured node (capturedAt null) says why, and renders no capture date anywhere', () => {
  mockData.mockReturnValue(OTHER_BREADTH)
  render(<MarketContextEmbed attrs={{ widgetId: 'marketcontext', capturedAt: null,
    params: { uncaptured: true, fields: 'all' } }} height={280} />)
  expect(screen.getByText('Market context is captured when a note is created. This note was written before it had one.')).toBeTruthy()
  expect(screen.queryByText('No market context was captured.')).toBeNull()
  expect(screen.queryByText(/Wire/)).toBeNull()
  const fig = screen.getByRole('figure')
  expect(fig.getAttribute('aria-label')).toBe('Market Context — not captured')
  expect(document.body.textContent).not.toMatch(/captured \w{3} \d/)
  expect(mockSwrKeys.every((k) => k === null)).toBe(true)
})

// ── R-T12-C fix round, I-1: a NEW note whose create ran out of its read budget ─────────────────────
// The backend writes `{uncaptured: true, reason: "budget"}`; "Update layout" still writes no reason.
// Every assertion reads RENDERED text. The read's answer is the server's REAL one (the contract fixture).

const BUDGET_SENTENCE = 'The market could not be read in time when this note was made.'
const OLD_SENTENCE = 'Market context is captured when a note is created. This note was written before it had one.'
const CAPTURE_FAILED = "This couldn't be read just now. Nothing was changed."
const MC_URL = '/api/j2/trader-blocks/market-context'
const budgetAttrs = (extra = {}) => ({ widgetId: 'marketcontext', capturedAt: null,
  params: { uncaptured: true, reason: 'budget', fields: 'regime', ...extra } })

describe('R-T12-C: the budget stamp', () => {
  let realFetch
  beforeEach(() => { realFetch = globalThis.fetch; mockData.mockReturnValue(OTHER_BREADTH) })
  afterEach(() => { globalThis.fetch = realFetch })

  test('says the true sentence and offers Capture now; reads nothing on mount', () => {
    globalThis.fetch = vi.fn()
    render(<MarketContextEmbed attrs={budgetAttrs()} height={280} setParams={vi.fn(() => true)} editable />)
    expect(screen.getByText(BUDGET_SENTENCE)).toBeTruthy()
    expect(screen.queryByText(OLD_SENTENCE)).toBeNull()
    expect(screen.getByRole('button', { name: 'Capture now' })).toBeTruthy()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mockSwrKeys.every((k) => k === null)).toBe(true)
  })

  test('CONTROL: the "Update layout" stamp (no reason) keeps its sentence and offers no capture, even to an editor', () => {
    render(<MarketContextEmbed attrs={{ widgetId: 'marketcontext', capturedAt: null, params: { uncaptured: true, fields: 'all' } }}
      height={280} setParams={vi.fn(() => true)} editable />)
    expect(screen.getByText(OLD_SENTENCE)).toBeTruthy()
    expect(screen.queryByText(BUDGET_SENTENCE)).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('a reader (not editable, or no setParams) sees the sentence and no button', () => {
    const { unmount } = render(<MarketContextEmbed attrs={budgetAttrs()} height={280} setParams={vi.fn(() => true)} editable={false} />)
    expect(screen.getByText(BUDGET_SENTENCE)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    unmount()
    render(<MarketContextEmbed attrs={budgetAttrs()} height={280} />)
    expect(screen.getByText(BUDGET_SENTENCE)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('Capture now reads the route once and lands the readings through setParams; the stamp keeps its preset', async () => {
    const body = contractBody('trader-blocks.market-context')
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }))
    const setParams = vi.fn(() => true)
    render(<MarketContextEmbed attrs={budgetAttrs()} height={280} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
    await waitFor(() => expect(setParams).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledWith(MC_URL, expect.objectContaining({ credentials: 'include' }))
    const patch = setParams.mock.calls[0][0]
    expect(patch).toEqual({ readings: body.readings, wireDate: body.wireDate, updated: body.updated,
      uncaptured: undefined, reason: undefined })
    expect('fields' in patch).toBe(false)              // setParams merges: the stamp's own `fields` stays
    // fix round 1: the capture time rides the same call, in trader_blocks._iso's form
    expect(setParams.mock.calls[0][1]).toEqual({ capturedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{6})?Z$/) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Capture now' }).disabled).toBe(false))
    expect(screen.queryByText(CAPTURE_FAILED)).toBeNull()
  })

  test('the landed params render as a captured stamp (the readings, no uncaptured sentence)', () => {
    const body = contractBody('trader-blocks.market-context')
    render(<MarketContextEmbed attrs={{ widgetId: 'marketcontext', capturedAt: null,
      params: { fields: 'regime', readings: body.readings, wireDate: body.wireDate, updated: body.updated,
        uncaptured: undefined, reason: undefined } }} height={280} setParams={vi.fn(() => true)} editable />)
    expect(rowOf('Market phase')).toHaveTextContent('Uptrend')
    expect(rowOf('Regime')).toHaveTextContent('Yellow')
    expect(screen.queryByText(BUDGET_SENTENCE)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Capture now' })).toBeNull()
  })

  test('a failed read says the failure sentence and writes nothing; Capture now can be pressed again', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    const setParams = vi.fn(() => true)
    render(<MarketContextEmbed attrs={budgetAttrs()} height={280} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
    expect(await screen.findByText(CAPTURE_FAILED)).toBeTruthy()
    expect(setParams).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Capture now' }).disabled).toBe(false)
    expect(screen.getByText(BUDGET_SENTENCE)).toBeTruthy()
  })

  test('an answer with no readings, a read that throws, and a write the editor refused each say the failure sentence', async () => {
    for (const [fetchImpl, setParams] of [
      [vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ wireDate: '2026-10-05' }) })), vi.fn(() => true)],
      [vi.fn(async () => { throw new TypeError('Failed to fetch') }), vi.fn(() => true)],
      [vi.fn(async () => ({ ok: true, status: 200, json: async () => contractBody('trader-blocks.market-context') })), vi.fn(() => false)],
    ]) {
      globalThis.fetch = fetchImpl
      const { unmount } = render(<MarketContextEmbed attrs={budgetAttrs()} height={280} setParams={setParams} editable />)
      fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
      expect(await screen.findByText(CAPTURE_FAILED)).toBeTruthy()
      unmount()
    }
  })
})
