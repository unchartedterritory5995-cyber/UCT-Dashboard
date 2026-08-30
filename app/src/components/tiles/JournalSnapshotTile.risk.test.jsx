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

import JournalSnapshotTile, { realStop } from './JournalSnapshotTile'

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

// ─── 🔴 FIX ROUND 2 · THE TWO SHAPES THAT MUST NEVER READ AS PROTECTION ─────
//
// Both were measured in jsdom against the first cut, not inferred.

/** A MANUAL row created without a stop. api/services/journal_two/positions.py
 *  stores `stop_price = 0.0` when `stopPrice` is omitted (it is optional), and
 *  `isBrokerPlaceholderStop` only fires on `source === 'broker'` — so nothing
 *  caught this. Measured: "100 @ $110.00 · stop $0.00" and
 *  "Open risk $10,000.00 10.00R" — a $0 stop shown as protection and the whole
 *  notional booked as risk, 20x the truth. */
const ZERO_STOP = {
  id: 'p9', symbol: 'TSLA', side: 'Long', shares: 100,
  entryPrice: 100, stopPrice: 0, source: 'manual',
}

/** A stop RAISED TO BREAKEVEN — the thing a disciplined trader does.
 *  `positionRiskDollar` is clampNonNegative, so risk is legitimately 0; the
 *  first cut put that 0 in the `r <= 0` bucket and counted it as NO stop, so
 *  the row said "stop $100.00" while the aggregate said "1 with no stop". */
const BREAKEVEN_STOP = {
  id: 'p8', symbol: 'AMD', side: 'Long', shares: 100,
  entryPrice: 100, stopPrice: 90, source: 'manual',
  raiseToBreakeven: true, breakevenStop: 100,
}

describe('DEFECT 1 · a zero stop is not a stop', () => {
  test('the row reads "no stop", never "stop $0.00"', () => {
    h.positions = { positions: [ZERO_STOP] }
    h.prices = { TSLA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('· no stop')).toBeInTheDocument()
    expect(screen.queryByText(/stop \$0\.00/),
      'a $0.00 stop rendered as real protection').toBeNull()
  })

  test('and it books NO risk — not the entire notional', () => {
    h.positions = { positions: [ZERO_STOP] }
    h.prices = { TSLA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.queryByText('$10,000.00'),
      'the whole notional was booked as open risk because a 0 stop was treated '
      + 'as a real one — measured at 20x the truth before this fix').toBeNull()
    expect(screen.getByText('1 with no stop')).toBeInTheDocument()
    expect(screen.getByText('no stops set')).toBeInTheDocument()
  })

  test('the client now agrees with portfolio_heat.py, which always had this rule', () => {
    // api/services/portfolio_heat.py:37 — `if stop <= 0: return True`. The two
    // authorities disagreed; only the server knew.
    expect(realStop(ZERO_STOP)).toBeNull()
    expect(realStop({ ...ZERO_STOP, stopPrice: -5 })).toBeNull()
    expect(realStop({ ...ZERO_STOP, stopPrice: null })).toBeNull()
    expect(realStop({ ...ZERO_STOP, stopPrice: 95 })).toBe(95)   // the control
  })
})

describe('DEFECT 2 · a breakeven stop is a stop, not a missing one', () => {
  test('the row and the aggregate give the SAME answer about one position', () => {
    h.positions = { positions: [BREAKEVEN_STOP] }
    h.prices = { AMD: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    // The row shows the raised stop…
    expect(screen.getByText(/stop \$100\.00/)).toBeInTheDocument()
    // …and the aggregate must NOT call the same position unstopped.
    expect(screen.queryByText(/with no stop/),
      'the row said "stop $100.00" and the total said "1 with no stop" about the '
      + 'same position — two answers, one fact').toBeNull()
    expect(screen.queryByText('no stops set')).toBeNull()
  })

  test('it contributes $0 to open risk — risk-free is a real, correct zero', () => {
    h.positions = { positions: [BREAKEVEN_STOP, REAL_STOP] }
    h.prices = { AMD: { price: 110, change_pct: 10 }, NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    // Only NVDA's $500 — AMD is stopped at breakeven and risks nothing.
    expect(screen.getByText('$500.00')).toBeInTheDocument()
    expect(screen.queryByText(/with no stop/)).toBeNull()
  })

  test('CONTROL: realStop keeps the breakeven override, so this is not "any stop passes"', () => {
    expect(realStop(BREAKEVEN_STOP)).toBe(100)          // breakevenStop wins
    expect(realStop({ ...BREAKEVEN_STOP, raiseToBreakeven: false })).toBe(90)
  })
})

describe('DEFECT 3 · 1R and open risk must cover the same book', () => {
  test('R is withheld when the book spans MORE THAN ONE account', () => {
    // /api/j2/positions is fetched with no account_id and the router returns
    // EVERY account's positions, while useJ2Settings resolves to the SELECTED
    // account — so dividing here mixes two books.
    h.accounts = { accounts: [{ id: 'a1', balanceSource: 'manual' }, { id: 'a2', balanceSource: 'manual' }] }
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('$500.00'),
      'the DOLLAR figure is book-wide and stays correct').toBeInTheDocument()
    expect(screen.getByText('R n/a across accounts')).toBeInTheDocument()
    expect(screen.queryByText('0.50R'),
      'one account’s 1R was divided into every account’s risk').toBeNull()
  })

  test('CONTROL: with a single account the R figure still renders', () => {
    h.accounts = { accounts: [{ id: 'a1', balanceSource: 'manual' }] }
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('0.50R')).toBeInTheDocument()
    expect(screen.queryByText('R n/a across accounts')).toBeNull()
  })
})

test('DEFECT 4 · the no-stop warning icon is NOT brand gold', () => {
  // UIcon's `gold` prop DEFAULTS TO TRUE and overrides `stroke` with the
  // metallic gradient, so the most safety-relevant signal on the tile rendered
  // as decoration beside --warning-coloured text.
  h.positions = { positions: [PLACEHOLDER] }
  h.prices = {}
  renderWithProviders(<JournalSnapshotTile />)
  const warn = document.querySelector('[class*="riskNoStop"] svg')
  expect(warn, 'the no-stop warning icon is gone').not.toBeNull()
  expect(warn.getAttribute('stroke'),
    'the warning icon is rendering with UIcon’s gold gradient instead of a '
    + 'semantic stroke — gold={false} is missing').not.toMatch(/url\(#uig/)
})

test('the R hint is a SPAN, never a nested anchor inside the tile-wide link', () => {
  // React logs "<a> cannot be a descendant of <a>", and the first cut's target
  // was byte-identical to JOURNAL_LINK, so the nesting bought nothing.
  h.accounts = { accounts: [{ id: 'a1', balanceSource: 'manual' }, { id: 'a2', balanceSource: 'manual' }] }
  h.positions = { positions: [REAL_STOP] }
  h.prices = { NVDA: { price: 110, change_pct: 10 } }
  renderWithProviders(<JournalSnapshotTile />)
  const hint = screen.getByText('R n/a across accounts')
  expect(hint.tagName).toBe('SPAN')
  expect(hint.querySelector('a'), 'the hint became an anchor again').toBeNull()
})
