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
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import MarketContextWidget from './MarketContextWidget'
import { readingsFrom } from './marketContextModel'
import MarketContextEmbed from '../../journal-2-0/components/notebook/MarketContextEmbed'

const mockData = vi.fn()
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: () => ({ data: mockData(), mutate: vi.fn(), isValidating: false }),
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
