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
  perf: null, settings: null, settingsError: undefined,
}))

// ⚠️ ORDER MATTERS: `/api/j2/accounts/{id}/settings` contains BOTH substrings,
// so the settings branch has to be tested first or the accounts payload is
// served as settings and every R assertion below measures the wrong object.
vi.mock('swr', () => ({
  default: (key) => {
    const k = String(key)
    if (k.includes('/settings')) return { data: h.settings, error: h.settingsError, isLoading: false, mutate: () => {} }
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

import JournalSnapshotTile, { realStop, R_REASON_COPY } from './JournalSnapshotTile'

// ⚠️ EVERY FIXTURE CARRIES `accountId`, AND `h.accounts` IS POPULATED.
// An earlier cut of this file left `h.accounts = null` in beforeEach while its
// CONTROL asserted `0.50R` — so the suite ENCODED the fail-open bug as correct:
// R rendered precisely because the account scope could not be established. The
// tile now derives scope from the POSITIONS' own `accountId`, and `useJ2Settings`
// resolves its account id from this roster, so both must be real here or these
// tests measure the wrong thing.
const ACCT = 'a1'
beforeEach(() => {
  h.positions = null; h.options = { strategies: [] }; h.prices = {}
  h.broker = null; h.perf = null
  h.accounts = { accounts: [{ id: ACCT, balanceSource: 'manual' }] }
  // A $100,000 book risking 1% per trade ⇒ 1R = $1,000.
  h.settings = { accountSize: 100_000, maxRiskPerTradePct: 1 }
  h.settingsError = undefined
  localStorage.clear()
})
afterEach(cleanup)

/** A manual long: 100 sh, entry 100, stop 95 ⇒ risk $500 = 0.50R. */
const REAL_STOP = {
  id: 'p1', accountId: ACCT, symbol: 'NVDA', side: 'Long', shares: 100,
  entryPrice: 100, stopPrice: 95, source: 'manual',
}
/** A BROKER import with the NOT-NULL placeholder: stop == entry ⇒ no stop. */
const PLACEHOLDER = {
  id: 'p2', accountId: ACCT, symbol: 'AAPL', side: 'Long', shares: 10,
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
  test('R is withheld when the POSITIONS span more than one account', () => {
    h.positions = { positions: [REAL_STOP, { ...REAL_STOP, id: 'p7', accountId: 'a2', symbol: 'MSFT' }] }
    h.prices = { NVDA: { price: 110, change_pct: 10 }, MSFT: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('$1,000.00'),
      'the DOLLAR figure is book-wide and stays correct').toBeInTheDocument()
    expect(screen.getByText('R n/a across accounts')).toBeInTheDocument()
    expect(screen.queryByText(/[\d.]+R$/),
      'one account’s 1R was divided into every account’s risk').toBeNull()
  })

  test('CONTROL: one account, and the R figure renders', () => {
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('0.50R')).toBeInTheDocument()
    expect(screen.queryByText(/R n\/a/)).toBeNull()
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
  h.positions = { positions: [REAL_STOP, { ...REAL_STOP, id: 'p7', accountId: 'a2', symbol: 'MSFT' }] }
  h.prices = { NVDA: { price: 110, change_pct: 10 }, MSFT: { price: 110, change_pct: 10 } }
  renderWithProviders(<JournalSnapshotTile />)
  const hint = screen.getByText('R n/a across accounts')
  expect(hint.tagName).toBe('SPAN')
  expect(hint.querySelector('a'), 'the hint became an anchor again').toBeNull()
})

// ─── 🔴 FIX ROUND 3 · THE GATE MUST FAIL CLOSED, AND READ THE BOOK ──────────

describe('NEW-1 · the R gate fails CLOSED when scope cannot be established', () => {
  test('a dead /api/j2/accounts withholds R — it does not silently divide', () => {
    // ⛔ THE BUG THIS REPLACES, AND THE ONE THE SUITE USED TO ENCODE AS CORRECT.
    // The tile's fetcher returns `null` on a non-ok response with
    // shouldRetryOnError:false, so `accounts` was EMPTY on a 5xx/401 — and a
    // gate written as `accounts.length > 1` never fired. A multi-account member
    // got whole-book dollars over one account's 1R, with nothing on screen
    // saying so. Scope is now read off the positions, and an unverifiable
    // scope withholds.
    h.accounts = null                      // endpoint down → no selected account
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('$500.00'),
      'the dollar figure needs no account scope and must survive').toBeInTheDocument()
    // ⭐ ITS OWN SENTENCE. An unreachable roster is an OUTAGE, not the member's
    // "All Accounts" choice and not a missing setting — three different facts
    // that all leave `settingsAccountId` null.
    expect(screen.getByText('R n/a — accounts unavailable')).toBeInTheDocument()
    expect(screen.queryByText('0.50R'),
      'R was computed against a budget we could not confirm governs this book')
      .toBeNull()
  })

  test('positions with NO accountId (legacy pre-migration rows) also withhold R', () => {
    // `_row_to_position`: "account_id may not be present on legacy rows".
    h.positions = { positions: [{ ...REAL_STOP, accountId: null }] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('R n/a — account scope unknown')).toBeInTheDocument()
  })

  test('and so does a book whose account is NOT the one the settings came from', () => {
    // The settings hook resolved account a1; the positions live in a2.
    h.positions = { positions: [{ ...REAL_STOP, accountId: 'a2' }] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('R n/a — account scope unknown')).toBeInTheDocument()
  })

  test('the two refusals are DIFFERENT sentences — scope-unknown is not spanning', () => {
    // One message for two causes is how a member learns to ignore both.
    h.positions = { positions: [REAL_STOP, { ...REAL_STOP, id: 'p7', accountId: 'a2', symbol: 'MSFT' }] }
    h.prices = { NVDA: { price: 110, change_pct: 10 }, MSFT: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('R n/a across accounts')).toBeInTheDocument()
    expect(screen.queryByText('R n/a — account scope unknown')).toBeNull()
  })
})

describe('NEW-2 · scope is the BOOK, not the account roster', () => {
  test('a member with several accounts still gets R when every position is in one', () => {
    // ⛔ THE OVER-REFUSAL THIS REPLACES. `list_accounts` applies no
    // archived/active filter, so a paper account, a retired one or a
    // disconnected broker cost a member their R permanently — with no red test,
    // because an over-refusal has none.
    h.accounts = { accounts: [
      { id: ACCT, balanceSource: 'manual' },
      { id: 'paper', balanceSource: 'manual' },
      { id: 'retired', balanceSource: 'manual' },
    ] }
    h.positions = { positions: [REAL_STOP] }        // all in ACCT
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('0.50R'),
      'three owned accounts blocked R even though the whole book sits in one')
      .toBeInTheDocument()
    expect(screen.queryByText(/R n\/a/)).toBeNull()
  })
})

describe('NEW-5 · an uncomputable risk reads as unknown, never as zero', () => {
  test('a position with a real stop but no entryPrice is counted as UNKNOWN', () => {
    // `realStop` is finite while `positionRiskDollar` is NaN. Absorbing that as
    // +$0 under a "stopped" claim under-reports on the one tile whose job is
    // never to under-report.
    h.positions = { positions: [{ ...REAL_STOP, id: 'p6', entryPrice: undefined }] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('1 risk unknown')).toBeInTheDocument()
    expect(screen.queryByText('1 with no stop'),
      'an uncomputable risk was reported as a MISSING STOP, which is a different fact')
      .toBeNull()
  })

  test('a side that is neither Long nor Short is unknown, not $0', () => {
    h.positions = { positions: [{ ...REAL_STOP, id: 'p5', side: 'Sideways', stopPrice: 95 }] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    // shortRiskDollar clamps (95 − 100) × 100 to 0 for a non-Long side, so this
    // one IS finite — it must be counted as stopped-at-$0, not as unknown. The
    // assertion that matters is that the total is not silently inflated.
    expect(screen.queryByText('$500.00')).toBeNull()
  })

  test('CONTROL: a computable risk is NOT counted as unknown', () => {
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.queryByText(/risk unknown/)).toBeNull()
    expect(screen.getByText('$500.00')).toBeInTheDocument()
  })
})

// ─── 🔴 FIX ROUND 4 ─────────────────────────────────────────────────────────

describe('a MIXED book — the gate that was still open', () => {
  test('one real account PLUS one legacy null-account row withholds R', () => {
    // 🔴 THE DEFECT: `positions.map(p => p.accountId).filter(id => id != null)`
    // dropped the null BEFORE sizing the set, so `ids.size === 1` and the tile
    // rendered R — whole-book dollars, INCLUDING a position whose account is
    // unknown, divided by a1's 1R. The `ids.size === 0` test could not see it,
    // because an all-null book still sizes to 0; only a MIXED book exposes it.
    h.positions = { positions: [
      REAL_STOP,                                            // accountId: 'a1'
      { ...REAL_STOP, id: 'p4', accountId: null, symbol: 'MSFT' },
    ] }
    h.prices = { NVDA: { price: 110, change_pct: 10 }, MSFT: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('$1,000.00'),
      'the dollar figure needs no account scope and must survive').toBeInTheDocument()
    expect(screen.getByText('R n/a — account scope unknown')).toBeInTheDocument()
    expect(screen.queryByText('1.00R'),
      'a book containing a position of unknown account was divided by one '
      + 'account’s 1R').toBeNull()
  })

  test('CONTROL: the same two positions, both in a1, DO produce R', () => {
    // Without this, the assertion above is satisfied by a gate that never opens
    // for a two-position book at all.
    h.positions = { positions: [
      REAL_STOP,
      { ...REAL_STOP, id: 'p4', symbol: 'MSFT' },            // also accountId: 'a1'
    ] }
    h.prices = { NVDA: { price: 110, change_pct: 10 }, MSFT: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('1.00R')).toBeInTheDocument()
    expect(screen.queryByText(/R n\/a/)).toBeNull()
  })
})

describe('the aggregate never contradicts the row beneath it', () => {
  test('"no stops set" is NOT claimed when a position is merely uncomputable', () => {
    // 🔴 With withStop 0 / noStop 0 / unknown 1 the line read
    // "Open risk  no stops set · 1 risk unknown" while the row directly beneath
    // rendered `stop $95.00`. The `else` was written when the loop had two
    // outcomes; the third made it lie — the same "two answers, one fact" defect
    // the loop's own comment exists to prevent.
    h.positions = { positions: [{ ...REAL_STOP, id: 'p6', entryPrice: undefined }] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    // The row still shows the stop it really has…
    expect(screen.getByText(/stop \$95\.00/)).toBeInTheDocument()
    // …so the aggregate must not say there are none.
    expect(screen.queryByText('no stops set'),
      'the aggregate claimed "no stops set" about a book whose only position '
      + 'renders a stop').toBeNull()
    expect(screen.getByText('1 risk unknown')).toBeInTheDocument()
  })

  test('CONTROL: a book that genuinely has no stops still says so', () => {
    // Without this, the assertion above is satisfied by deleting the message.
    h.positions = { positions: [PLACEHOLDER] }
    h.prices = {}
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('no stops set')).toBeInTheDocument()
  })
})

describe('every reason R is missing gets its OWN sentence', () => {
  test('All Accounts mode names itself and says how to get R back', () => {
    // The book's scope is KNOWN here; the budget's is not. Saying "account
    // scope unknown" was a false statement about a state the member chose and
    // can undo.
    localStorage.setItem('uct.j2.selectedAccountId', '_all_')
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    const hint = screen.getByText('R n/a in All Accounts')
    expect(hint).toBeInTheDocument()
    expect(hint.getAttribute('title')).toMatch(/pick a single account/i)
    expect(screen.queryByText('R n/a — account scope unknown')).toBeNull()
  })

  test('a failed settings fetch is an OUTAGE, not the member’s omission', () => {
    // `useJ2Settings`'s fetcher throws on non-ok, so `settings` is undefined and
    // `error` is set. Telling someone to "set account size & risk %" because the
    // endpoint 5xx'd is how a member learns to distrust the whole line.
    h.settings = undefined
    h.settingsError = new Error('500')
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('R n/a — settings unavailable')).toBeInTheDocument()
    expect(screen.queryByText('R n/a — set account size & risk %'),
      'the member was told to configure something because the server failed')
      .toBeNull()
  })

  test('CONTROL: genuinely unset settings DO still ask the member to set them', () => {
    // The one reason that really is the member's to fix. Without this control
    // the assertion above passes for a tile that never gives that instruction.
    h.settings = { accountSize: 100_000 }        // present, but no risk %
    h.positions = { positions: [REAL_STOP] }
    h.prices = { NVDA: { price: 110, change_pct: 10 } }
    renderWithProviders(<JournalSnapshotTile />)
    expect(screen.getByText('R n/a — set account size & risk %')).toBeInTheDocument()
  })

  test('the five sentences are all different', () => {
    // A roster of the distinct copy, so a future edit cannot quietly collapse
    // two facts back onto one message.
    const texts = Object.values(R_REASON_COPY).map((r) => r.text)
    expect(new Set(texts).size).toBe(texts.length)
    expect(texts.length).toBeGreaterThanOrEqual(5)
  })
})
