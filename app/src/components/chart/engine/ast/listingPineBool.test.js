// ─── H1 — FROM THE LISTING, A CROSSING OVER `na` IS PINE'S `false` ─────────────
//
// `ta.cross` / `crossover` / `crossunder` compare two series on this bar and the
// last, and a comparison with `na` is false — so the result is never `na`. This
// engine's crossing column answers `NaN` on such a bar (its event domain's warm-up,
// right for a window that starts mid-history). Inside a recurrence that `NaN` was
// the TEST of a ternary, so from the listing the state went `na` where Pine's took
// the other arm. The listing pass now re-reads a test built only of crossings and
// comparisons with a `NaN` crossing as `false` (`interpret.js::pineBoolAt`).
// Vendor witness: `vendorHarness.h1Ratchet.test.js` (qqe-signals, RDDT listing).
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'

const N = 120
const CLOSE = Array.from({ length: N }, (_, i) => 100 + 8 * Math.sin(i / 5) + i * 0.05)
const BARS = CLOSE.map((c, i) => ({ t: 1700000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 }))
const columnOf = (lines, opts) => {
  const t = translatePine(['//@version=5', 'indicator("h1-bool")', ...lines].join('\n'))
  if (!t.ok) throw new Error(`refused: ${JSON.stringify(t.refusal).slice(0, 300)}`)
  return Array.from(interpret(t.outputs.find((o) => o.ast).ast, BARS, {}, undefined, undefined, opts))
}
// `m` is `na` for its first 20 bars, so the crossing over `m[1]` is `na` there
const TREND = [
  'm = ta.sma(close, 20)',
  'trend = 0',
  'trend := ta.crossover(close, m[1]) ? 1 : ta.crossunder(close, m[1]) ? -1 : nz(trend[1], 1)',
  'plot(trend)',
]
// Pine's own value, bar by bar: a crossing with an `na` side is false
const pineTrend = () => {
  const sma = CLOSE.map((_, i) => (i < 19 ? NaN : CLOSE.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20))
  const out = []
  let prev = NaN
  for (let i = 0; i < N; i++) {
    const m1 = i >= 1 ? sma[i - 1] : NaN
    const m2 = i >= 2 ? sma[i - 2] : NaN
    const ok = !Number.isNaN(m1) && !Number.isNaN(m2) && i >= 1
    const up = ok && CLOSE[i] > m1 && CLOSE[i - 1] <= m2
    const dn = ok && CLOSE[i] < m1 && CLOSE[i - 1] >= m2
    const v = up ? 1 : dn ? -1 : (Number.isNaN(prev) ? 1 : prev)
    out.push(v)
    prev = v
  }
  return out
}

describe('H1 — from the listing, a crossing over na is false', () => {
  it('⭐ the listing column is Pine\'s on every bar, the warm-up included', () => {
    const col = columnOf(TREND, { historyFromListing: true })
    const ref = pineTrend()
    expect(ref.slice(0, 21).every((v) => v === 1)).toBe(true) // non-vacuity: the warm-up is real
    expect(ref.some((v) => v === -1)).toBe(true) // and the column moves after it
    // bar 0 is the listing pass's own (C12w): `trend` read bare is its seed `0` and
    // through history `na`, and one seed slot cannot hold both — withheld, never guessed
    expect(Number.isNaN(col[0]) || col[0] === ref[0]).toBe(true)
    col.slice(1).forEach((v, k) => expect(v, `bar ${k + 1}`).toBe(ref[k + 1]))
  })

  it('⛔ control: behind the curtain the same warm-up stays withheld (never a guessed 1)', () => {
    const col = columnOf(TREND, {})
    expect(col.slice(0, 21).every((v) => Number.isNaN(v))).toBe(true)
  })

})
