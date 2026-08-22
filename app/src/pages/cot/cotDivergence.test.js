import { describe, it, expect } from 'vitest'
import {
  NEAR_PCT,
  TREND_WEEKS,
  INDEX_DROP,
  detectDivergences,
} from './cotDivergence'

// ── fixtures ──────────────────────────────────────────────────────────────────

// n weekly COT rows (Tuesdays from 2020-01-07), ascending; `fn(i)` supplies fields.
function mkRows(n, fn = () => ({})) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2020, 0, 7 + i * 7))
    out.push({
      date: d.toISOString().slice(0, 10),
      commercial_net: 0,
      large_spec_net: 0,
      small_spec_net: 0,
      open_interest: 1_000_000,
      ...fn(i),
    })
  }
  return out
}

// 80 weeks, analysed at the last one, with a 20-week index window so the index
// shifts are easy to reason about. The 52-week range and 13-week trend are
// module constants and need idx ≥ 51.
const N = 80
const IDX = N - 1
const OPTS = { window: 20 }
const price = fn => Array.from({ length: N }, (_, i) => fn(i))

const RISING  = i => 100 + i          // new 52-week high every week
const FALLING = i => 200 - i          // new 52-week low every week

// Large specs climb to week 71 then fall 2/week: index 100 at week 71, 0 at 79.
const SPECS_FADING = i => (i <= 71 ? i : 71 - (i - 71) * 2)
// Commercials sink to week 71 then rise 2/week: index 0 at week 71, 100 at 79.
const HEDGERS_BUYING = i => (i <= 71 ? -i : -71 + (i - 71) * 2)

const keys = out => out.map(d => d.key)

// ── constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('exposes the thresholds the rules use', () => {
    expect(NEAR_PCT).toBe(2)
    expect(TREND_WEEKS).toBe(13)
    expect(INDEX_DROP).toBe(15)
  })
})

// ── guards ────────────────────────────────────────────────────────────────────

describe('detectDivergences — guards', () => {
  it('is empty when price is null', () => {
    const rows = mkRows(N, i => ({ large_spec_net: SPECS_FADING(i), open_interest: 1_000_000 - i }))
    expect(detectDivergences(rows, price(() => null), IDX, OPTS)).toEqual([])
    // Price known elsewhere but not at idx → still nothing to compare.
    const p = price(RISING); p[IDX] = null
    expect(detectDivergences(rows, p, IDX, OPTS)).toEqual([])
  })

  it('is empty on a flat tape with flat positioning', () => {
    const rows = mkRows(N)
    expect(detectDivergences(rows, price(() => 100), IDX, OPTS)).toEqual([])
  })

  it('is empty when idx is out of range', () => {
    const rows = mkRows(N)
    expect(detectDivergences(rows, price(RISING), N, OPTS)).toEqual([])
    expect(detectDivergences(rows, price(RISING), -1, OPTS)).toEqual([])
  })

  it('skips the trend rules when the 13-week-ago price is missing', () => {
    // Rising price, specs rising, OI rising → trend-confirmed would fire…
    const rows = mkRows(N, i => ({ large_spec_net: i, open_interest: 1_000_000 + i * 1000 }))
    const p = price(RISING); p[IDX - TREND_WEEKS] = null
    expect(detectDivergences(rows, p, IDX, OPTS)).toEqual([])
  })
})

// ── rule 1: price-high-specs-fading ───────────────────────────────────────────

describe('price-high-specs-fading', () => {
  it('fires when price is at a 52-week high while the large-spec index has dropped', () => {
    const rows = mkRows(N, i => ({ large_spec_net: SPECS_FADING(i) }))
    const out = detectDivergences(rows, price(RISING), IDX, OPTS)
    expect(keys(out)).toEqual(['price-high-specs-fading'])
    expect(out[0].tone).toBe('bear')
    expect(out[0].label.length).toBeGreaterThan(0)
    expect(out[0].text).toMatch(/52-week high/)
    expect(out[0].text).toMatch(/100 points/)       // index 100 → 0 over eight weeks
    expect(out[0].text).toMatch(/eight weeks/)
  })

  it('does not fire when price is more than NEAR_PCT% below the high', () => {
    const rows = mkRows(N, i => ({ large_spec_net: SPECS_FADING(i) }))
    const p = price(RISING); p[IDX] = 178 * (1 - (NEAR_PCT + 1) / 100)   // high is 178 at week 78
    expect(keys(detectDivergences(rows, p, IDX, OPTS))).not.toContain('price-high-specs-fading')
  })

  it('does not fire when the spec index has slipped less than INDEX_DROP points', () => {
    // Specs climb to week 71 then ease only 0.1/week. Window 60..79: min 60,
    // max 71, latest 70.2 → index ≈ 92.7 vs 100 eight weeks ago → drop ≈ 7 < 15.
    const rows = mkRows(N, i => ({ large_spec_net: i <= 71 ? i : 71 - (i - 71) * 0.1 }))
    expect(keys(detectDivergences(rows, price(RISING), IDX, OPTS))).not.toContain('price-high-specs-fading')
  })
})

// ── rule 2: price-low-hedgers-buying ──────────────────────────────────────────

describe('price-low-hedgers-buying', () => {
  it('fires when price is at a 52-week low while the commercial index has risen', () => {
    const rows = mkRows(N, i => ({ commercial_net: HEDGERS_BUYING(i) }))
    const out = detectDivergences(rows, price(FALLING), IDX, OPTS)
    expect(keys(out)).toEqual(['price-low-hedgers-buying'])
    expect(out[0].tone).toBe('bull')
    expect(out[0].text).toMatch(/52-week low/)
    expect(out[0].text).toMatch(/100 points/)
    expect(out[0].text).toMatch(/hedgers|commercials/i)
  })

  it('does not fire when price is more than NEAR_PCT% above the low', () => {
    const rows = mkRows(N, i => ({ commercial_net: HEDGERS_BUYING(i) }))
    const p = price(FALLING); p[IDX] = 122 * (1 + (NEAR_PCT + 1) / 100)  // low is 122 at week 78
    expect(keys(detectDivergences(rows, p, IDX, OPTS))).not.toContain('price-low-hedgers-buying')
  })
})

// ── rule 3: rally-on-shrinking-participation ──────────────────────────────────

describe('rally-on-shrinking-participation', () => {
  it('fires when price rallies while specs cut and open interest shrinks', () => {
    // Specs fall steadily → index 0 at both 71 and 79 → rule 1 stays quiet.
    const rows = mkRows(N, i => ({ large_spec_net: -i * 100, open_interest: 1_000_000 - i * 1000 }))
    const out = detectDivergences(rows, price(RISING), IDX, OPTS)
    expect(keys(out)).toEqual(['rally-on-shrinking-participation'])
    expect(out[0].tone).toBe('caution')
    expect(out[0].text).toMatch(/7\.8%/)            // (179−166)/166
    expect(out[0].text).toMatch(/1,300/)            // specs cut 13 × 100 contracts
  })

  it('needs all three legs — a rally with rising OI is not this rule', () => {
    const rows = mkRows(N, i => ({ large_spec_net: -i * 100, open_interest: 1_000_000 + i * 1000 }))
    expect(keys(detectDivergences(rows, price(RISING), IDX, OPTS))).not.toContain('rally-on-shrinking-participation')
  })

  it('needs a rally of more than 3% over 13 weeks', () => {
    const rows = mkRows(N, i => ({ large_spec_net: -i * 100, open_interest: 1_000_000 - i * 1000 }))
    const p = price(i => 100 + i * 0.2)              // +2.6% over 13 weeks at the end
    expect(keys(detectDivergences(rows, p, IDX, OPTS))).not.toContain('rally-on-shrinking-participation')
  })
})

// ── rule 4: selloff-hedgers-absorbing ─────────────────────────────────────────

describe('selloff-hedgers-absorbing', () => {
  it('fires when price sells off while specs sell and commercials buy', () => {
    // Commercials rise steadily → index 100 at both 71 and 79 → rule 2 stays quiet.
    const rows = mkRows(N, i => ({ large_spec_net: -i * 100, commercial_net: i * 100 }))
    const out = detectDivergences(rows, price(FALLING), IDX, OPTS)
    expect(keys(out)).toEqual(['selloff-hedgers-absorbing'])
    expect(out[0].tone).toBe('bull')
    expect(out[0].text).toMatch(/9\.7%/)            // (121−134)/134
    expect(out[0].text).toMatch(/1,300/)
  })

  it('needs commercials to be adding — a selloff where hedgers also sell is not absorption', () => {
    const rows = mkRows(N, i => ({ large_spec_net: -i * 100, commercial_net: -i * 100 }))
    expect(keys(detectDivergences(rows, price(FALLING), IDX, OPTS))).not.toContain('selloff-hedgers-absorbing')
  })
})

// ── rule 5: trend-confirmed ───────────────────────────────────────────────────

describe('trend-confirmed', () => {
  it('fires when price, specs and open interest all rise together', () => {
    const rows = mkRows(N, i => ({ large_spec_net: i * 100, open_interest: 1_000_000 + i * 1000 }))
    const out = detectDivergences(rows, price(RISING), IDX, OPTS)
    expect(keys(out)).toEqual(['trend-confirmed'])
    expect(out[0].tone).toBe('info')
    expect(out[0].text).toMatch(/not a divergence/)
    expect(out[0].text).toMatch(/7\.8%/)
  })

  it('is mutually exclusive with the shrinking-participation rule', () => {
    const rows = mkRows(N, i => ({ large_spec_net: i * 100, open_interest: 1_000_000 - i * 1000 }))
    const out = detectDivergences(rows, price(RISING), IDX, OPTS)
    expect(keys(out)).not.toContain('trend-confirmed')
    expect(keys(out)).not.toContain('rally-on-shrinking-participation')
  })
})

// ── cap + priority ────────────────────────────────────────────────────────────

describe('detectDivergences — at most two, in priority order', () => {
  it('puts the 52-week-high tell ahead of the participation tell', () => {
    const rows = mkRows(N, i => ({ large_spec_net: SPECS_FADING(i), open_interest: 1_000_000 - i * 1000 }))
    const out = detectDivergences(rows, price(RISING), IDX, OPTS)
    expect(keys(out)).toEqual(['price-high-specs-fading', 'rally-on-shrinking-participation'])
    expect(out.map(d => d.tone)).toEqual(['bear', 'caution'])
  })

  it('puts the 52-week-low tell ahead of the absorption tell', () => {
    const rows = mkRows(N, i => ({ commercial_net: HEDGERS_BUYING(i), large_spec_net: -i * 100 }))
    const out = detectDivergences(rows, price(FALLING), IDX, OPTS)
    expect(keys(out)).toEqual(['price-low-hedgers-buying', 'selloff-hedgers-absorbing'])
  })

  it('never returns more than two and every entry has the full shape', () => {
    const rows = mkRows(N, i => ({ large_spec_net: SPECS_FADING(i), open_interest: 1_000_000 - i * 1000 }))
    const out = detectDivergences(rows, price(RISING), IDX, OPTS)
    expect(out.length).toBeLessThanOrEqual(2)
    for (const d of out) {
      expect(typeof d.key).toBe('string')
      expect(['bull', 'bear', 'caution', 'info']).toContain(d.tone)
      expect(d.label.length).toBeGreaterThan(0)
      expect(d.text.length).toBeGreaterThan(40)
    }
  })
})
