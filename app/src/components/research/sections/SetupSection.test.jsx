import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import SetupSection, {
  money, compactCap, compactVol, fixedText, divYieldText, moveText, driftText,
} from './SetupSection'
import { countGoldHighlights } from '../../research-kit/testing/restraint'

const FUNDAMENTALS = {
  market_cap: 3.1e12, forward_pe: 38.4, beta: 1.72,
  week52_high: 210, week52_low: 86.6, avg_vol: 245_000_000, div_yield: 0.0002,
}
// A controllable mock (not a fixed factory return) — mirrors
// EarningsResearchModal.test.jsx's mockUseExpectedMove idiom — so the
// phantom-zero tests below can override just the fields under test without a
// second test file.
const mockUseFundamentals = vi.fn(() => ({ data: FUNDAMENTALS }))
vi.mock('../../../hooks/useFundamentals', () => ({ default: (...args) => mockUseFundamentals(...args) }))

vi.mock('swr', async (orig) => {
  const actual = await orig()
  return {
    ...actual,
    default: (key) => (typeof key === 'string' && key.includes('/estimates/')
      ? { data: { revisions: [{ period: '0q', current: 0.94, ago30: 0.90, up30: 6, down30: 1 }] } }
      : { data: null }),
  }
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

describe('moveText — phantom zero', () => {
  it('renders "Priced ±0.0% " for a genuine zero expected move', () => {
    expect(moveText(0)).toBe('Priced ±0.0% ')
  })
  it('renders an empty string (never a phantom 0.0%) when the pct is missing', () => {
    expect(moveText(null)).toBe('')
    expect(moveText(undefined)).toBe('')
  })
})

describe('driftText — phantom zero', () => {
  it('shows ±0¢ for a genuine unchanged estimate, not silence', () => {
    expect(driftText([{ current: 0.94, ago30: 0.94 }])).toBe('Est $0.94 · ±0¢ / 30d')
  })
  it('omits the cents clause (not a phantom +0¢) when ago30 is missing', () => {
    expect(driftText([{ current: 0.94, ago30: null }])).toBe('Est $0.94')
  })
  it('formats a genuine $0.00 current estimate rather than skipping the row', () => {
    expect(driftText([{ current: 0, ago30: 0 }])).toBe('Est $0.00 · ±0¢ / 30d')
  })
  it('skips an entry with a missing current estimate, never treats it as $0.00', () => {
    expect(driftText([{ current: null, ago30: 0.9 }, { current: 0.94, ago30: 0.90 }]))
      .toBe('Est $0.94 · +4¢ / 30d')
  })
  it('returns null (never a fabricated line) when nothing is usable', () => {
    expect(driftText([])).toBeNull()
    expect(driftText(null)).toBeNull()
    expect(driftText([{ current: null }])).toBeNull()
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
