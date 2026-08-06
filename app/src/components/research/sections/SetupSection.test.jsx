import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import SetupSection, {
  money, compactCap, compactVol, fixedText, divYieldText, moveText, driftText,
} from './SetupSection'
import { countGoldHighlights } from '../../research-kit/testing/restraint'

const FUNDAMENTALS = {
  // div_yield is a PERCENT already (verified live: /api/fundamentals/MCD ->
  // 2.81, /api/fundamentals/CAT -> 0.8) — a prior version of this fixture
  // used 0.0002 (a FRACTION), which matched divYieldText's now-fixed ×100
  // bug and is exactly why no test caught it: the fixture encoded the same
  // wrong provider contract as the code under test.
  market_cap: 3.1e12, forward_pe: 38.4, beta: 1.72,
  week52_high: 210, week52_low: 86.6, avg_vol: 245_000_000, div_yield: 2.81,
}
// A controllable mock (not a fixed factory return) — mirrors
// EarningsResearchModal.test.jsx's mockUseExpectedMove idiom — so the
// phantom-zero tests below can override just the fields under test without a
// second test file.
const mockUseFundamentals = vi.fn(() => ({ data: FUNDAMENTALS }))
vi.mock('../../../hooks/useFundamentals', () => ({ default: (...args) => mockUseFundamentals(...args) }))

// Controllable too (review round 1, item "normalize the estimates SWR key") —
// a plain factory can't let a test inspect the exact key SetupSection passed.
// `period: 'Current Qtr'` matches the SERVER's actual label
// (api/services/research/estimates.py `_PERIOD_LABEL["0q"]`), not the '0q'
// raw period code — a prior draft of this mock used '0q', which meant no test
// here could ever notice a period-guard being added or removed.
const mockUseSWR = vi.fn((key) => (typeof key === 'string' && key.includes('/estimates/')
  ? { data: { revisions: [{ period: 'Current Qtr', current: 0.94, ago30: 0.90, up30: 6, down30: 1 }] } }
  : { data: null }))
vi.mock('swr', async (orig) => {
  const actual = await orig()
  return { ...actual, default: (...args) => mockUseSWR(...args) }
})

const row = { sym: 'NVDA', eps_estimate: 0.94, reported_eps: null }
const beatHistory = [
  { period: '2026-06-30', actual: 0.91, estimate: 0.88, beat: true, surprise: 3.4 },
  { period: '2026-03-31', actual: 0.80, estimate: 0.82, beat: false, surprise: -2.4 },
  { period: '2025-12-31', actual: 0.75, estimate: 0.70, beat: true, surprise: 7.1 },
]
const histStats = { avg_abs_move: 6.4, up_count: 2, total: 3, last_n: [8.2, -4.1, 5.5] }
const live = {
  pct: 6.8, dollar: 12.5, spot: 184.0, expiry: '2026-08-07',
  horizon: 'through 2026-08-07',
}

const em = (over = {}) => ({ live, history: [], history_since: null, grade: null, ...over })

function renderSetup(props = {}) {
  return render(
    <SetupSection sym="NVDA" row={{ ...row, beat_history: beatHistory, hist_stats: histStats }}
                  reportDate="2026-08-06" timing="amc" lifecycle="PRE"
                  expectedMove={em()} stepping={false} {...props} />,
  )
}

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }))
  mockUseFundamentals.mockReturnValue({ data: FUNDAMENTALS })
})

describe('SetupSection', () => {
  it('leads with the implied-vs-realized hero', () => {
    renderSetup()
    expect(screen.getByTestId('rk-ivr')).toBeTruthy()
  })

  it('the coverage caption counts STORED snapshots, not tonight’s live implied', () => {
    renderSetup({ expectedMove: em({ history: [], history_since: '2026-08-01' }) })
    expect(screen.getByTestId('rk-ivr-cold').textContent)
      .toBe('Implied tracking since 2026-08 · 0/8 recorded')
  })

  it('counts the stored rows when history exists', () => {
    const history = [
      { report_date: '2026-05-06', pct: 5.9 },
      { report_date: '2026-02-05', pct: 7.2 },
    ]
    renderSetup({ expectedMove: em({ history, history_since: '2026-02-05' }) })
    expect(screen.getByTestId('rk-ivr-cold').textContent)
      .toBe('Implied tracking since 2026-02 · 2/8 recorded')
  })

  it('states the horizon on the break-even strip', () => {
    renderSetup()
    const strip = screen.getByTestId('setup-breakeven')
    expect(strip.textContent).toMatch(/through 2026-08-07/)
    expect(strip.textContent).toMatch(/171\.50/)     // 184.00 - 12.50
    expect(strip.textContent).toMatch(/196\.50/)     // 184.00 + 12.50
  })

  it('renders the key-stats strip with tabular numerics', () => {
    renderSetup()
    const stats = screen.getByTestId('setup-stats')
    expect(stats.textContent).toMatch(/Fwd P\/E/i)
    expect(stats.textContent).toMatch(/38\.4/)
    expect(stats.textContent).toMatch(/Beta/i)
    expect(stats.querySelector('.t-num')).toBeTruthy()
  })

  it('shows the consensus DRIFT, never the word "whisper"', () => {
    renderSetup()
    const drift = screen.getByTestId('setup-drift')
    expect(drift.textContent).toMatch(/\$0\.94/)
    expect(drift.textContent).toMatch(/\+4¢/)
    expect(drift.textContent).toMatch(/30d/)
    expect(drift.textContent.toLowerCase()).not.toContain('whisper')
  })

  it('omits the break-even strip entirely when there is no live move', () => {
    renderSetup({ expectedMove: em({ live: null }) })
    expect(screen.queryByTestId('setup-breakeven')).toBeNull()
    expect(screen.getByTestId('rk-ivr')).toBeTruthy()   // the hero still renders
  })

  it('keeps the canvas inside the one-gold-highlight budget', () => {
    const { container } = renderSetup()
    expect(countGoldHighlights(container)).toBeLessThanOrEqual(1)
  })

  it('never says "verdict"', () => {
    const { container } = renderSetup()
    expect(container.textContent.toLowerCase()).not.toContain('verdict')
  })
})

// ─── Phantom-zero: Number(null) === 0 has landed in seven prior tasks on this
// branch. Every numeric formatter this section owns gets BOTH directions
// asserted — a genuine 0 must render as 0, and a missing value must render as
// an em dash, never the other way round.
describe('money — phantom zero', () => {
  it('renders a genuine $0.00', () => { expect(money(0)).toBe('$0.00') })
  it('renders an em dash for a missing value, never $0.00', () => {
    expect(money(null)).toBe('—')
    expect(money(undefined)).toBe('—')
  })
})

describe('compactCap — phantom zero', () => {
  it('renders $0 for a genuine zero market cap', () => { expect(compactCap(0)).toBe('$0') })
  it('renders an em dash for a missing market cap', () => { expect(compactCap(null)).toBe('—') })
})

describe('compactVol — phantom zero', () => {
  it('renders 0K for genuine zero volume', () => { expect(compactVol(0)).toBe('0K') })
  it('renders an em dash for missing volume', () => { expect(compactVol(null)).toBe('—') })
})

describe('fixedText — phantom zero', () => {
  it('renders 0.0 for a genuine zero stat', () => { expect(fixedText(0, 1)).toBe('0.0') })
  it('renders an em dash for a missing stat', () => { expect(fixedText(null, 1)).toBe('—') })
})

describe('divYieldText — phantom zero', () => {
  it('renders 0.00% for a genuine zero yield', () => { expect(divYieldText(0)).toBe('0.00%') })
  it('renders an em dash for a missing yield', () => { expect(divYieldText(null)).toBe('—') })
})

// Unit-contract regression: /api/fundamentals/{sym} returns div_yield as a
// PERCENT already (live: MCD 2.81, CAT 0.8), not a fraction. A stray ×100
// here rendered "281.00%"/"80.00%" for real tickers, live-verified in
// browser. Neither phantom-zero test above pins the CONVENTION (0*100 === 0
// either way), which is exactly how the earlier ×100 bug shipped invisibly.
describe('divYieldText — unit contract (not a fraction)', () => {
  it('a realistic yield renders as-is, never multiplied by 100', () => {
    expect(divYieldText(2.81)).toBe('2.81%')
    expect(divYieldText(0.8)).toBe('0.80%')
  })
})

describe('moveText — phantom zero', () => {
  it('renders "Priced ±0.0% " for a genuine zero expected move', () => {
    expect(moveText(0)).toBe('Priced ±0.0% ')
  })
  it('renders an empty string (never a phantom 0.0%) when the pct is missing', () => {
    expect(moveText(null)).toBe('')
    expect(moveText(undefined)).toBe('')
  })
})

// `period` is required on every fixture below — driftText is now pinned to
// the server's "Current Qtr" row (review round 1, item 4), not "the first row
// with a usable current estimate".
describe('driftText — phantom zero', () => {
  it('shows ±0¢ for a genuine unchanged estimate, not silence', () => {
    expect(driftText([{ period: 'Current Qtr', current: 0.94, ago30: 0.94 }]))
      .toBe('Est $0.94 · ±0¢ / 30d')
  })
  it('omits the cents clause (not a phantom +0¢) when ago30 is missing', () => {
    expect(driftText([{ period: 'Current Qtr', current: 0.94, ago30: null }]))
      .toBe('Est $0.94')
  })
  it('formats a genuine $0.00 current estimate rather than skipping the row', () => {
    expect(driftText([{ period: 'Current Qtr', current: 0, ago30: 0 }]))
      .toBe('Est $0.00 · ±0¢ / 30d')
  })
  it('treats a Current Qtr row with a missing current as unusable, never $0.00', () => {
    expect(driftText([
      { period: 'Next Qtr', current: 4.12, ago30: 4.0 },
      { period: 'Current Qtr', current: null, ago30: 0.9 },
    ])).toBeNull()
  })
  it('returns null (never a fabricated line) when nothing is usable', () => {
    expect(driftText([])).toBeNull()
    expect(driftText(null)).toBeNull()
    expect(driftText([{ period: 'Current Qtr', current: null }])).toBeNull()
  })
})

// review round 1, item 4 — driftText must speak ONLY for tonight's quarter.
// Real payloads (api/services/research/estimates.py) order rows
// ["0q","+1q","0y","+1y"] and DROP a row whose `current` is null — exactly
// what happens to the Current Qtr row around a print. Walking the array for
// "the first usable value" would then silently present an annual or
// next-quarter number as tonight's estimate.
describe('driftText — pinned to the Current Qtr row, never a different period', () => {
  it('finds the Current Qtr row regardless of array position', () => {
    expect(driftText([
      { period: 'Next Qtr', current: 99, ago30: 98 },
      { period: 'Current Qtr', current: 0.94, ago30: 0.90 },
    ])).toBe('Est $0.94 · +4¢ / 30d')
  })

  it('never falls through to Next Qtr / Current Yr when Current Qtr is absent or unusable', () => {
    // No Current Qtr row at all.
    expect(driftText([
      { period: 'Next Qtr', current: 4.12, ago30: 4.0 },
      { period: 'Current Yr', current: 18.5, ago30: 18.0 },
    ])).toBeNull()
    // Current Qtr present but its current estimate reset to null post-report —
    // the exact scenario around a print.
    expect(driftText([
      { period: 'Current Qtr', current: null, ago30: 0.9 },
      { period: 'Next Qtr', current: 4.12, ago30: 4.0 },
    ])).toBeNull()
  })
})

describe('SetupSection — key stats, phantom zero at the component level', () => {
  it('renders every stat live when every fundamental is a genuine zero (no em dashes)', () => {
    mockUseFundamentals.mockReturnValueOnce({ data: {
      market_cap: 0, forward_pe: 0, beta: 0, avg_vol: 0, div_yield: 0,
      week52_high: 210, week52_low: 86.6,
    } })
    renderSetup()
    expect(screen.getByTestId('setup-stats').textContent).not.toContain('—')
  })

  it('renders an em dash for every stat that is genuinely missing (never a phantom zero)', () => {
    mockUseFundamentals.mockReturnValueOnce({ data: {
      market_cap: null, forward_pe: null, beta: null, avg_vol: null, div_yield: null,
      week52_high: null, week52_low: null,
    } })
    renderSetup()
    const dashes = screen.getByTestId('setup-stats').textContent.match(/—/g) || []
    expect(dashes).toHaveLength(5)   // Mkt cap, Fwd P/E, Beta, Avg vol, Div yield
  })

  // Live-browser-verified regression: the default FUNDAMENTALS fixture
  // carries div_yield: 2.81 (the real MCD shape). Before the fix this
  // rendered "281.00%" in a real running instance of this modal.
  it('renders the div yield as the real percent, never ×100', () => {
    renderSetup()
    expect(screen.getByTestId('setup-stats').textContent).toContain('2.81%')
    expect(screen.getByTestId('setup-stats').textContent).not.toContain('281.00%')
  })

  // review round 1, item 2 — `fundamentals` is `undefined` on EVERY user's
  // FIRST render (SWR before its first resolve), not a rare edge case. The
  // prior suite's `beforeEach` always returned resolved data, so this branch
  // — the one state every user sees first — was never actually rendered by
  // any test.
  it('renders the loading skeleton (never a stats crash) while fundamentals is still resolving', () => {
    mockUseFundamentals.mockReturnValueOnce({ data: undefined })
    renderSetup()
    expect(screen.getByTestId('setup-stats-loading')).toBeTruthy()
    expect(screen.queryByTestId('setup-stats')).toBeNull()
  })
})

describe('SetupSection — 52-week range, phantom zero', () => {
  it('draws the range with a genuine $0 low, never treating it as missing', () => {
    mockUseFundamentals.mockReturnValueOnce({ data: { ...FUNDAMENTALS, week52_low: 0 } })
    renderSetup()
    expect(screen.getByTestId('setup-52w')).toBeTruthy()
  })

  it('omits the range entirely when a bound is genuinely missing', () => {
    mockUseFundamentals.mockReturnValueOnce({ data: { ...FUNDAMENTALS, week52_low: null } })
    renderSetup()
    expect(screen.queryByTestId('setup-52w')).toBeNull()
  })
})

// review round 1, item 5a — `value={spot}` on the marker must actually carry
// the live spot; a slipped `value={0}` would silently ship a current-price
// marker pinned to the left edge labelled $0.00.
describe('SetupSection — 52-week slider wiring', () => {
  it('positions the current-price marker from the live spot, not pinned to zero', () => {
    renderSetup()
    const wrap = screen.getByTestId('setup-52w')
    const marker = wrap.querySelector('[data-testid="rk-range-marker"]')
    expect(marker).toBeTruthy()
    // spot=184 within [week52_low=86.6, week52_high=210] sits ~79% up the
    // track — comfortably distinguishable from value=0's 0%.
    expect(parseFloat(marker.style.left)).toBeGreaterThan(50)
  })

  it('gives the 52-week slider an accessible name', () => {
    renderSetup()
    expect(screen.getByRole('img', { name: /52-week range/i })).toBeTruthy()
  })
})

// review round 1, items 1 and 5b — `spot` gets its own bidirectional
// phantom-zero coverage (previously only `dollar` was independently tested;
// the shared table row cited a mutation that covered `dollar`, not `spot`),
// plus an accessible-name assertion for the break-even slider.
describe('SetupSection — spot, phantom zero (independent of dollar)', () => {
  it('omits the strip when spot is missing even though pct/dollar are present', () => {
    renderSetup({ expectedMove: em({ live: { pct: 6.8, dollar: 12.5, spot: null } }) })
    expect(screen.queryByTestId('setup-breakeven')).toBeNull()
  })

  it('draws the strip from a genuine $0 spot/dollar/pct, showing $0.00 (never omitted)', () => {
    renderSetup({ expectedMove: em({ live: { pct: 0, dollar: 0, spot: 0 } }) })
    const strip = screen.getByTestId('setup-breakeven')
    expect(strip.textContent).toMatch(/\$0\.00/)
  })

  it('gives the break-even slider an accessible name', () => {
    renderSetup()
    expect(screen.getByRole('img', { name: /break-even range/i })).toBeTruthy()
  })
})

describe('SetupSection — break-even strip, phantom zero', () => {
  it('draws the strip from a genuine $0 expected move (both edges collapse to spot)', () => {
    renderSetup({ expectedMove: em({ live: {
      pct: 0, dollar: 0, spot: 184, expiry: '2026-08-07', horizon: 'through 2026-08-07',
    } }) })
    const strip = screen.getByTestId('setup-breakeven')
    expect(strip.textContent).toMatch(/184\.00/)
  })

  it('omits the strip when the dollar move is missing even though spot is present', () => {
    renderSetup({ expectedMove: em({ live: { pct: 6.8, dollar: null, spot: 184 } }) })
    expect(screen.queryByTestId('setup-breakeven')).toBeNull()
  })
})

// review round 1, item 3 — the three hero tests in the main describe block
// only assert `rk-ivr` exists and that the coverage CAPTION is right (which
// is driven by `recordedCount`, a prop separate from the payload feeding the
// bars). Nothing previously asserted that `live`/`impliedHistory`/`info` were
// actually wired through to the kit component. Past-quarter pairing is a
// KNOWN, separately-scoped defect (report_date = fiscal period-end vs.
// implied_store's announcement-date key) — these assertions are deliberately
// scoped to the CURRENT quarter, which pairs via `live` and needs no store
// match, so they don't depend on that fix.
describe('SetupSection — hero data wiring', () => {
  it('draws a current-quarter implied mark when live.pct is present, and none when it is not', () => {
    const { container: withLive } = renderSetup()
    expect(withLive.querySelectorAll('[data-testid="rk-ivr-implied"]')).toHaveLength(1)

    const { container: withoutLive } = renderSetup({ expectedMove: em({ live: null }) })
    expect(withoutLive.querySelectorAll('[data-testid="rk-ivr-implied"]')).toHaveLength(0)
  })

  it('draws the current-quarter implied bar from a matching STORED history row, not only from live', () => {
    // report_date matches the CURRENT quarter (reportDate="2026-08-06") —
    // pairQuarters resolves this via impliedHistory's byDate match BEFORE it
    // would ever fall back to live.pct.
    const historyOverride = [{ report_date: '2026-08-06', pct: 0.1 }]
    const { container } = renderSetup({
      expectedMove: em({ history: historyOverride, history_since: '2026-08-06' }),
    })
    const rects = container.querySelectorAll('[data-testid="rk-ivr-implied"]')
    expect(rects).toHaveLength(1)
    const h = Number(rects[0].getAttribute('height'))
    // Wired: the current bar reflects the tiny 0.1% stored value, dwarfed by
    // the realized reaction bars (~8.2% peak) — near-zero height. Dropped
    // (impliedHistory={[]}), the bar falls back to live.pct=6.8%, rendering
    // at ~40 (an order of magnitude taller).
    expect(h).toBeLessThan(3)
  })

  it('renders the hero methodology info tip (§12)', () => {
    renderSetup()
    expect(screen.getByRole('button', { name: /about implied vs realized move/i })).toBeTruthy()
  })
})

// review round 1, "normalize the estimates SWR key" — must match
// useEstimates.js/useExpectedMove.js's uppercase-and-trim so a non-canonical
// sym doesn't fragment the SWR cache from every other surface reading this
// endpoint.
describe('SetupSection — estimates SWR key normalization', () => {
  it('uppercases and trims sym before building the estimates cache key', () => {
    mockUseSWR.mockClear()
    renderSetup({ sym: ' nvda ' })
    const keys = mockUseSWR.mock.calls.map(([key]) => key)
    expect(keys).toContain('/api/research/estimates/NVDA')
    expect(keys).not.toContain('/api/research/estimates/ nvda ')
  })
})
