// The Watchlist's RVOL column is the SAME "volume vs usual by this time of day" the
// screener, the chart header and the terminal headline show — never today's volume over a
// full-day 20-session average.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { watchlistRvol } from './watchlistRvol'

const LINEAR = Array.from({ length: 391 }, (_, m) => m / 390)
const FRONT_KNOTS = Array.from({ length: 79 }, (_, k) => Math.min(1, k / 39))
const CURVE = {
  curve: LINEAR, session: { date: '2026-08-24', open_min: 570, close_min: 960 },
  suppress_first_min: 15, full_session_min: 390, bar_min: 5, ticker_knots: { NVDA: FRONT_KNOTS },
}
const AT_1042 = new Date('2026-08-24T14:42:00Z')
const META = { avg_vol_30d: 2_000_000, avg_vol_20d: 500_000 }

describe('watchlistRvol', () => {
  it('is volume vs usual BY NOW on the 30-session average, as a percent', () => {
    // market curve: 1e6 / (2e6 × 72/390) = 2.71 -> 271. The old raw ratio was 1e6/5e5 = 200.
    expect(watchlistRvol('AAPL', META, { volume: 1_000_000 }, CURVE, AT_1042)).toBeCloseTo(271, 6)
  })
  it("uses the symbol's own curve from the batch payload", () => {
    expect(watchlistRvol('NVDA', META, { volume: 1_000_000 }, CURVE, AT_1042)).toBeCloseTo(135, 6)
  })
  it('never falls back to the 20-session full-day ratio', () => {
    expect(watchlistRvol('AAPL', { avg_vol_20d: 500_000 }, { volume: 1_000_000 }, CURVE, AT_1042)).toBeNull()
  })
  it('is blank before 09:45 ET, without a curve, or without a print', () => {
    expect(watchlistRvol('AAPL', META, { volume: 1_000_000 }, CURVE, new Date('2026-08-24T13:44:00Z'))).toBeNull()
    expect(watchlistRvol('AAPL', META, { volume: 1_000_000 }, null, AT_1042)).toBeNull()
    expect(watchlistRvol('AAPL', META, {}, CURVE, AT_1042)).toBeNull()
  })
  it('a directly-supplied ratio (the breadth drill) wins, curve or not', () => {
    expect(watchlistRvol('NX', { rvol: 700 }, null, null, AT_1042)).toBe(700)
  })
})

// ⛔ The WIRE: the helper above is correct on its own, so this asserts the page actually
// calls it — for the cell AND for the sort (a sort on a different number than the cell
// shows reorders rows the member cannot see a reason for) — and that the 20-session
// full-day ratio is gone from the page. Comments are stripped so prose cannot satisfy it.
describe('Watchlists.jsx wiring', () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../Watchlists.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  it('the RVOL cell and the RVOL sort both go through watchlistRvol', () => {
    expect(src.match(/\bwatchlistRvol\(/g) || []).toHaveLength(2)
    expect(src).toMatch(/const rvolVal = watchlistRvol\(sym,/)
    expect(src).toMatch(/if \(key === 'rvol'\) \{\s*return watchlistRvol\(s,/)
  })
  it('asks for the curve in ONE batch for the list, and never reads the 20-session average', () => {
    expect(src).toMatch(/useVolumeCurve\(rvolVisible, rvolVisible \? listUniverseOrScan : \[\]\)/)
    expect(src).not.toMatch(/avg_vol_20d/)
  })
})
