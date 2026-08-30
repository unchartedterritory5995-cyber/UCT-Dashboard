// app/src/components/tiles/JournalSnapshotTile.risk.test.jsx
//
// ─── 🔴 ZONE C · "WHERE ARE MY STOPS" ───────────────────────────────────────
//
// The spec's Zone C is *"today's P&L, open positions **with their stops**, and
// open risk in dollars and R"*, and "where are my stops" was the single
// most-quoted need from the trader analysis that motivated the whole redesign.
// The first cut of the cockpit shipped the curve removal and NOTHING ELSE from
// that sentence — a grep for stop/risk in this tile found only SVG `<stop>`
// gradient elements.
//
// ⛔ THE SAFETY-CRITICAL CASE IS THE PLACEHOLDER STOP, and it has its own
// tests below. Broker imports store `stop_price = entry_price` because the
// column is NOT NULL and the broker reports no stop. Rendering that as a real
// stop tells a member they are protected when they are not; counting it in the
// risk total reads as ZERO risk, which UNDER-reports heat and would green-light
// an over-cap add. `api/services/portfolio_heat.py` calls this out as
// safety-critical server-side; this is the client half of the same rule.
import { renderWithProviders, screen, cleanup } from '../../test-utils'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  positions: null, options: null, prices: {}, broker: null, accounts: null,
  perf: null, settings: null,
}))

// ⚠️ ORDER MATTERS: `/api/j2/accounts/{id}/settings` contains BOTH substrings,
// so the settings branch has to be tested first or the accounts payload is
// served as settings and every R assertion below measures the wrong object.
vi.mock('swr', () => ({
  default: (key) => {
    const k = String(key)
    if (k.includes('/settings')) return { data: h.settings, isLoading: false, mutate: () => {} }
    if (k.includes('/broker/performance')) return { data: h.perf, isLoading: false }
    if (k.includes('/broker')) return { data: h.broker, isLoading: false }
    if (k.includes('/accounts')) return { data: h.accounts, isLoading: false }
    if (k.includes('/positions')) return { data: h.positions, isLoading: false }
    if (k.includes('/options')) return { data: h.options, isLoading: false }
    return { data: undefined, isLoading: false, mutate: () => {} }
  },
  useSWRConfig: () => ({ mutate: () => {} }),
}))

vi.mock('../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: h.prices, isLoading: false, isStreaming: true, staleSymbols: new Set() }),
}))

import JournalSnapshotTile from './JournalSnapshotTile'

beforeEach(() => {
  h.positions = null; h.options = { strategies: [] }; h.prices = {}
  h.broker = null; h.accounts = null; h.perf = null
  // A $100,000 book risking 1% per trade ⇒ 1R = $1,000.
  h.settings = { accountSize: 100_000, maxRiskPerTradePct: 1 }
  localStorage.clear()
})
afterEach(cleanup)

/** A manual long: 100 sh, entry 100, stop 95 ⇒ risk $500 = 0.50R. */
const REAL_STOP = {
  id: 'p1', symbol: 'NVDA', side: 'Long', shares: 100,
  entryPrice: 100, stopPrice: 95, source: 'manual',
}
/** A BROKER import with the NOT-NULL placeholder: stop == entry ⇒ no stop. */
const PLACEHOLDER = {
  id: 'p2', symbol: 'AAPL', side: 'Long', shares: 10,
  entryPrice: 200, stopPrice: 200, source: 'broker',
}

describe('the stop on each open position', () => {
  test('renders the real stop beside shares @ price', () => {
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 5 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText(/stop \$95\.00/)).toBeInTheDocument()
  })

  test('a BROKER PLACEHOLDER stop reads "no stop" — never a stop at breakeven', () => {
    // ⛔ The whole point. `stopPrice === entryPrice` on a broker row means the
    // broker reported no stop, not that the member set one at their entry.
    h.positions = { positions: [PLACEHOLDER] }
    h.prices = { AAPL: { price: 210, change_pct: 5 } }
    renderWithProviders(<JournalSnapshotTile />)
    // The ROW's own marker — matched exactly, because the risk line below also
    // contains the words "no stop" and a loose regex would pass on either.
    expect(screen.getByText('· no stop')).toBeInTheDocument()
    expect(screen.queryByText(/stop \$200\.00/),
      'a broker placeholder rendered as a real stop at the entry price — that '
      + 'tells a member they are protected when they are not').toBeNull()
  })
})

describe('open risk in dollars and R', () => {
  test('sums the dollar risk of positions that HAVE a stop, and expresses it in R', () => {
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 5 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('Open risk')).toBeInTheDocument()
    expect(screen.getByText('$500.00')).toBeInTheDocument()   // 100 × (100 − 95)
    expect(screen.getByText('0.50R')).toBeInTheDocument()     // $500 / $1,000
  })

  test('EXCLUDES placeholder-stop positions from the dollars AND says how many', () => {
    // Counting the placeholder as a real stop would add $0 risk and read as a
    // COMPLETE total — the under-report that green-lights an over-cap add.
    h.positions = { positions: [REAL_STOP, PLACEHOLDER] }
    h.prices = { NVDA: { price: 110, change_pct: 5 }, AAPL: { price: 210, change_pct: 5 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('$500.00')).toBeInTheDocument()
    expect(screen.getByText('1 with no stop'),
      'the excluded position is invisible, so the total reads as complete when '
      + 'it is not').toBeInTheDocument()
  })

  test('counts risk for a position the LIVE FEED does not carry', () => {
    // ⛔ THE REASON THIS DOES NOT USE `portfolioAggregates`: that helper skips
    // any position with no current price. Risk does not depend on the current
    // price, so after hours it would silently under-report — the one direction
    // a risk number must never fail in.
    h.positions = { positions: [REAL_STOP] }
    h.prices = {}   // live feed empty
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('$500.00'),
      'open risk vanished because the live feed was empty — risk is not a '
      + 'function of the current price').toBeInTheDocument()
  })

  test('a SHORT is risked on the correct side', () => {
    // Short 100 @ 100 with the stop ABOVE at 105 ⇒ $500, same magnitude.
    h.positions = { positions: [{ ...REAL_STOP, side: 'Short', stopPrice: 105 }] }
    h.prices = { NVDA: { price: 95, change_pct: -5 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('$500.00')).toBeInTheDocument()
  })
})

describe('R when the account has no risk budget', () => {
  test('says R is not available instead of printing a number with no basis', () => {
    h.settings = { accountSize: 100_000 }   // no maxRiskPerTradePct
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 5 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('$500.00')).toBeInTheDocument()
    expect(screen.getByText(/R n\/a/)).toBeInTheDocument()
    expect(screen.queryByText(/0\.00R/),
      'a 1R of zero/undefined was rendered as a real R multiple').toBeNull()
  })

  test('and the same when accountSize is missing', () => {
    h.settings = { maxRiskPerTradePct: 1 }
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 5 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText(/R n\/a/)).toBeInTheDocument()
  })

  test('CONTROL: with both settings present the R figure DOES render', () => {
    // Without this, the two assertions above are satisfied by a tile that can
    // never compute R at all.
    h.settings = { accountSize: 50_000, maxRiskPerTradePct: 2 }   // 1R = $1,000
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 5 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('0.50R')).toBeInTheDocument()
    expect(screen.queryByText(/R n\/a/)).toBeNull()
  })
})

test('every open position lacking a stop is reported, not silently dropped', () => {
  h.positions = { positions: [PLACEHOLDER, { ...PLACEHOLDER, id: 'p3', symbol: 'MSFT' }] }
  h.prices = {}
  renderWithProviders(<JournalSnapshotTile />)
  expect(screen.getByText('2 with no stop')).toBeInTheDocument()
  // …and with nothing stopped there is no dollar total to show, so it says so
  // rather than printing a confident $0.00. Scoped to the RISK LINE — the
  // manual hero legitimately shows $0.00 for a book with no live prices, and a
  // page-wide query would pass or fail for that unrelated reason.
  expect(screen.getByText('no stops set')).toBeInTheDocument()
  const riskLine = document.querySelector('[class*="riskLine"]')
  expect(riskLine).not.toBeNull()
  expect(riskLine.querySelector('[class*="riskValue"]'),
    'a $0.00 open-risk total was printed for a book where nothing has a stop')
    .toBeNull()
  // Both rows carry the per-row marker too.
  expect(screen.getAllByText('· no stop')).toHaveLength(2)
})
