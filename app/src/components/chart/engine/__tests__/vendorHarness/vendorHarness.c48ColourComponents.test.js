// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c48ColourComponents.test.js
//
// ─── ⭐⭐ C48 — THE GRADIENT'S ONE FORMULA, AND THE COLOUR FORMS ROUND 3 ASKS ───
//
// `vw-colour-components-spy-1d-2026-10-01` (AMEX:SPY 1D, 300 bars; probe
// `tools/visual_conformance/probes/vw-colour-components.pine`) plots colours as
// their four numbers, for every form C38 refused for want of a row.
//
// ⭐ PRIORITY 0 — THE GRADIENT BETWEEN COLOURS OF DIFFERENT TRANSPARENCY. The
// capture session's own note read the blend as "opacity-weighted, exact rounding
// not derived (best rule 226 / 300)". That is the capture agent's arithmetic,
// not this engine's. `runtime/colours.js::fromGradient` — C29's formula: the
// opacity BYTES blend, the channels blend premultiplied by them, both truncated
// — is graded here bar for bar on every gradient row of the capture:
//
//   B01–B04   per-bar bounds (`low` … `high` at `close`), ends t 70 / t 10
//   G05–G08   the two inner gradients (t 0 → 80, t 100 → 0)
//   G01–G04   a gradient BETWEEN those two gradients
//
// 12 rows × 300 bars = 3,600 component-bars, and it is exact on all of them.
// The formula is not changed; the 2026-09-30 same-transparency witness
// (`vendorHarness.c29Gradient`, `vendorHarness.c38ColourValue`) is untouched.
//
// ⭐ WHAT THE CAPTURE DID CORRECT (rows E01–E05, X01–X04):
//   · `top == bottom`, an `na` bound, an `na` value → red 0, blue 0,
//     transparency 100 on every bar (`GRADIENT_ZERO_COLOUR`) — `fromGradient`
//     answered `null` ("unmeasured") for all three;
//   · reversed bounds (bottom 1, top 0) → the BOTTOM colour at every value
//     between them — ⚰️ `fromGradient` ran the blend backwards there.
//
// ⭐ AND THE FORMS SERVED AS COLUMNS, each graded by the harness itself
// (`gradeCapture`: the real member door, the real comparator) on TradingView's
// whole history (`c38Joined.js`), 300 / 300 on every row: an eight-digit
// literal, `input.color`, a per-bar transparency, a ternary of two colours, a
// gradient over per-bar bounds, the degenerate and reversed gradients.
// ⛔ REFUSED BY NAME: a gradient between gradients as a COLUMN (G01–G04) and a
// colour a user function returns (U01 / U02).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { gradeCapture } from './harness'
import { parent, joinedFromListing, keepPlotLines, vendorColumn } from './c38Joined'
import { fromGradient, byteTransparency, COLOUR_FNS, GRADIENT_ZERO_COLOUR, packedToObjectHex } from '../../runtime/colours'
import { unpackColor } from '../../colorInt'
import { gradientPointColour } from '../../pool'
import { translatePine } from '../../ast/pine'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const PROBE = 'vw-colour-components-spy-1d-2026-10-01'
const CONTROL = 'K00_bar_index_CONTROL'
const cap = parent(PROBE)
const TITLES = cap.study.plots.filter((p) => p.title).map((p) => p.title)
const col = (title) => vendorColumn(cap, title)
const rgb = (r, g, b, t = 0) => COLOUR_FNS['color.rgb'].fn([r, g, b, t])
const parts = (packed) => {
  if (packed === null) return null
  const u = unpackColor(packed)
  return { r: u.r, g: u.g, b: u.b, t: byteTransparency(u.transparencyByte) }
}
/** How many of the 300 bars `ours(i)[channel]` equals the vendor's row on. */
const agree = (title, channel, ours) => col(title).filter((v, i) => {
  const o = ours(i)
  return o !== null && o[channel] === v
}).length

const cA = rgb(0, 100, 200, 70)
const cB = rgb(255, 50, 50, 10)
const V = col('K01_v')
const BARS = cap.bars.rows.map((r) => ({ o: r[1], h: r[2], l: r[3], c: r[4] }))

describe('C48 — PRIORITY 0: the gradient formula, graded bar for bar on every gradient row', () => {
  it('the capture is the one described: 48 rows, 300 bars, `v` sweeping 0 … 1', () => {
    expect(TITLES).toHaveLength(48)
    expect(cap.bars.rows).toHaveLength(300)
    expect(Math.min(...V)).toBe(0)
    expect(Math.max(...V)).toBe(1)
    expect(new Set(V).size).toBe(101)
  })

  it('⭐⭐ B01–B04 — per-bar bounds, ends of DIFFERENT transparency: 300 / 300 on all four components', () => {
    const b1 = (i) => parts(fromGradient(BARS[i].c, BARS[i].l, BARS[i].h, cA, cB))
    expect(agree('B01_grad_perbar_r', 'r', b1)).toBe(300)
    expect(agree('B02_grad_perbar_g', 'g', b1)).toBe(300)
    expect(agree('B03_grad_perbar_b', 'b', b1)).toBe(300)
    expect(agree('B04_grad_perbar_t', 't', b1)).toBe(300)
    // the row really moves, across the whole range
    expect(new Set(col('B01_grad_perbar_r')).size).toBeGreaterThan(100)
    expect(new Set(col('B04_grad_perbar_t')).size).toBeGreaterThan(40)
  })

  it('⭐⭐ G05–G08 and G01–G04 — the two inner gradients, and the gradient BETWEEN them: 300 / 300 on all eight', () => {
    const g1 = (i) => fromGradient(V[i], 0, 1, rgb(0, 0, 0, 0), rgb(200, 100, 50, 80))
    const g2 = (i) => fromGradient(V[i], 0, 1, rgb(255, 255, 255, 100), rgb(20, 40, 60, 0))
    expect(agree('G05_inner1_r', 'r', (i) => parts(g1(i)))).toBe(300)
    expect(agree('G06_inner1_t', 't', (i) => parts(g1(i)))).toBe(300)
    expect(agree('G07_inner2_r', 'r', (i) => parts(g2(i)))).toBe(300)
    expect(agree('G08_inner2_t', 't', (i) => parts(g2(i)))).toBe(300)
    const gg = (i) => parts(fromGradient(V[i], 0, 1, g1(i), g2(i)))
    expect(agree('G01_grad_of_grads_r', 'r', gg)).toBe(300)
    expect(agree('G02_grad_of_grads_g', 'g', gg)).toBe(300)
    expect(agree('G03_grad_of_grads_b', 'b', gg)).toBe(300)
    expect(agree('G04_grad_of_grads_t', 't', gg)).toBe(300)
  })

  it('🔴 CONTROL — the plain per-channel blend the capture note compared against is NOT the vendor\'s', () => {
    const linear = (i) => {
      const b = BARS[i]
      const w = Math.min(1, Math.max(0, (b.c - b.l) / (b.h - b.l)))
      return { r: Math.trunc(0 + 255 * w), b: Math.trunc(200 + (50 - 200) * w) }
    }
    expect(agree('B01_grad_perbar_r', 'r', linear)).toBeLessThan(30)
    expect(agree('B03_grad_perbar_b', 'b', linear)).toBeLessThan(30)
  })

  it('⭐ E01–E03, X01–X04 — equal bounds, an `na` bound, an `na` value: the zero colour on every bar', () => {
    for (const t of ['E01_grad_top_eq_bottom_r', 'E02_grad_top_eq_bottom_b', 'X01_grad_na_bound_r', 'X03_grad_na_value_r']) {
      expect(col(t).every((x) => x === 0), t).toBe(true)
    }
    for (const t of ['E03_grad_top_eq_bottom_t', 'X02_grad_na_bound_t', 'X04_grad_na_value_t']) {
      expect(col(t).every((x) => x === 100), t).toBe(true)
    }
    const zero = { r: 0, g: 0, b: 0, t: 100 }
    for (const v of [0, 0.2, 0.5, 0.9, 1]) {
      expect(parts(fromGradient(v, 0.5, 0.5, cA, cB)), `equal bounds at ${v}`).toEqual(zero)
      expect(parts(fromGradient(v, NaN, 1, cA, cB)), `na bound at ${v}`).toEqual(zero)
      expect(parts(fromGradient(v, 0, NaN, cA, cB)), `na top at ${v}`).toEqual(zero)
    }
    expect(parts(fromGradient(NaN, 0, 1, cA, cB))).toEqual(zero)
    expect(fromGradient(NaN, 0, 1, cA, cB)).toBe(GRADIENT_ZERO_COLOUR)
    expect(packedToObjectHex(GRADIENT_ZERO_COLOUR)).toBe('#00000000')
    // ⛔ an INFINITE value or bound is in no row: still unanswered
    expect(fromGradient(Infinity, 0, 1, cA, cB)).toBeNull()
    expect(fromGradient(0.5, -Infinity, 1, cA, cB)).toBeNull()
  })

  it('⚰️ E04 / E05 — reversed bounds hold the BOTTOM colour between them; outside them nothing is answered', () => {
    expect(col('E04_grad_reversed_bounds_r').every((x) => x === 0)).toBe(true)
    expect(col('E05_grad_reversed_bounds_t').every((x) => x === 70)).toBe(true)
    const e2 = (i) => parts(fromGradient(V[i], 1, 0, cA, cB))
    expect(agree('E04_grad_reversed_bounds_r', 'r', e2)).toBe(300)
    expect(agree('E05_grad_reversed_bounds_t', 't', e2)).toBe(300)
    // what the mirrored blend this function used to run would have read on the same bars
    const mirrored = (i) => parts(fromGradient(1 - V[i], 0, 1, cA, cB))
    expect(agree('E04_grad_reversed_bounds_r', 'r', mirrored)).toBeLessThan(10)
    expect(fromGradient(1.5, 1, 0, cA, cB)).toBeNull()
    expect(fromGradient(-0.5, 1, 0, cA, cB)).toBeNull()
  })

  it('⛔ a plot\'s gradient colour still draws the SERIES colour for a position that is not a number', () => {
    // `fromGradient(NaN, …)` is the zero colour now; the plot lane's position
    // column cannot tell Pine's `na` from a bar this window cannot compute.
    const gradient = { a: cA, b: cB, transparency: null }
    expect(gradientPointColour(gradient, NaN)).toBeNull()
    expect(gradientPointColour(gradient, Infinity)).toBeNull()
    expect(gradientPointColour(gradient, 0)).toBe(packedToObjectHex(cA))
  })
})

describe('C48 — the new colour forms are columns, graded through the member door on TradingView\'s history', () => {
  const CONSTANT_ROWS = new Set(['K02_lit8_0064C84D_r', 'K03_lit8_0064C84D_g', 'K04_lit8_0064C84D_b', 'K05_lit8_0064C84D_t',
    'K06_lit8_FF323280_t', 'K07_lit8_FF323280_r', 'I01_input_plain_r', 'I02_input_plain_g', 'I03_input_plain_t',
    'I04_input_transp35_b', 'I05_input_transp35_t', 'N02_new_red_perbar_r', 'N04_new_lit8_perbar_b',
    'E01_grad_top_eq_bottom_r', 'E02_grad_top_eq_bottom_b', 'E03_grad_top_eq_bottom_t', 'E04_grad_reversed_bounds_r',
    'E05_grad_reversed_bounds_t', 'X01_grad_na_bound_r', 'X02_grad_na_bound_t', 'X03_grad_na_value_r', 'X04_grad_na_value_t'])
  /** The probe's source cut to `keep`, its constant rows lifted off the pane's
   *  constant rule with `+ close * 0` (C29's device, as `c38ColourValue` does). */
  const cut = (keep) => (text) => keepPlotLines(keep)(text).split('\n').map((l) => {
    const m = /^plot\((color\.[rgbt]\([A-Za-z0-9]+\)),(\s*)("([A-Za-z0-9_]+)")\)$/.exec(l)
    return m && CONSTANT_ROWS.has(m[4]) ? `plot(${m[1]} + close * 0,${m[2]}${m[3]})` : l
  }).join('\n')
  const grade = (id, keep, mutateVendor) => gradeCapture(joinedFromListing(cap, { control: CONTROL, id, keep, source: cut(keep), mutateVendor }))
  const SERVED = TITLES.filter((t) => !/^G0[1-4]_|^U0[12]_/.test(t))
  // twelve rows a pane (its ceiling), the control leading each
  const GROUPS = []
  for (let i = 1; i < SERVED.length; i += 11) GROUPS.push([CONTROL, ...SERVED.slice(i, i + 11)])
  const notMatch = (v) => (v.plots || []).filter((p) => p.verdict !== 'MATCH').map((p) => `${p.title}: ${p.verdict} — ${String(p.reason).slice(0, 120)}`)

  it('the groups cover every served row exactly once', () => {
    expect(SERVED).toHaveLength(42)
    expect(SERVED[0]).toBe(CONTROL)
    expect(GROUPS.map((g) => g.length)).toEqual([12, 12, 12, 9])
    expect([...new Set(GROUPS.flat())].sort()).toEqual([...SERVED].sort())
  })

  it.each([[0], [1], [2], [3]])('⭐⭐ group %i: every row MATCHes on all 300 bars', (g) => {
    const keep = GROUPS[g]
    const { verdict, ours, integrity } = grade(`c48-${g}`, keep)
    expect(integrity.ok, (integrity.errors || []).join('; ')).toBe(true)
    expect(ours.ok, ours.refusal || '').toBe(true)
    expect(verdict.plots.map((p) => p.title)).toEqual(keep)
    expect(notMatch(verdict)).toEqual([])
    for (const p of verdict.plots) {
      expect(p.stats.matching, p.title).toBe(300)
      expect(p.warmupBars, p.title).toBe(0)
    }
  })

  it('NON-VACUITY — the rows that move really move, and the truncation is exercised', () => {
    expect(new Set(col('N01_new_red_perbar_t')).size).toBe(101)
    expect(new Set(col('N03_new_lit8_perbar_t')).size).toBe(101)
    // `v * 100` lands on 28.999999999999996 and the like on 9 bars; the colour holds the whole number it names
    const fractional = cap.bars.rows.map((_, i) => V[i] * 100).filter((x) => !Number.isInteger(x) && Math.abs(x - Math.round(x)) < 1e-9)
    const below = cap.bars.rows.filter((_, i) => Math.floor(V[i] * 100) !== col('N03_new_lit8_perbar_t')[i]).length
    expect(fractional.length).toBeGreaterThan(0)
    expect(below).toBe(9)
    expect(new Set(col('Q01_ternary_r'))).toEqual(new Set([10, 250]))
    expect(new Set(col('Q05_ternary_lit8_vs_name_t'))).toEqual(new Set([70, 0]))
    expect(col('K05_lit8_0064C84D_t')[0]).toBe(70)
    expect(col('K06_lit8_FF323280_t')[0]).toBe(50)
    expect(col('I05_input_transp35_t')[0]).toBe(35)
  })

  it('🔴 CONTROL — the grade can fail: one vendor component moved by 1 is a DIVERGE at that bar', () => {
    const { verdict } = grade('c48-ctl', GROUPS[1], (fields, rows) => {
      const at = fields.indexOf(cap.study.plots.find((p) => p.title === 'N03_new_lit8_perbar_t').id)
      rows[7][at] += 1
    })
    expect(notMatch(verdict).map((s) => s.split(' — ')[0])).toEqual(['N03_new_lit8_perbar_t: DIVERGE'])
  })

  it('⛔ REFUSED BY NAME — a gradient between gradients, a colour a user function returns, and what no row shows', () => {
    const outputs = translatePine(cap.source.text, { strict: true }).outputs
    const refused = outputs.filter((o) => o.refusal)
    // G01–G04 (gg) and U01 / U02 (u1) — and nothing else
    expect(outputs).toHaveLength(48)
    expect(refused).toHaveLength(6)
    for (const o of refused) {
      expect(o.refusal.guard).toBe('pine:colour-value')
      expect(o.refusal.message).toMatch(/a gradient between gradients and a colour returned by a user function are measured and not served/)
    }
    const one = (expr) => translatePine(['//@version=6', 'indicator("c48 refused")', `plot(color.t(${expr}), "t")`].join('\n'), { strict: true }).outputs[0]
    // a per-bar transparency that is not provably within 0-100
    expect(one('color.new(color.red, close)').refusal.guard).toBe('pine:colour-value')
    expect(one('color.new(color.red, bar_index % 201)').refusal.guard).toBe('pine:colour-value')
    expect(one('color.new(color.red, na)').refusal.guard).toBe('pine:colour-value')
    // …and the same shape inside the range is a column
    expect(one('color.new(color.red, bar_index % 101)').refusal).toBeNull()
    // `color.new` over a colour that moves
    expect(one('color.new(close > open ? color.red : color.blue, 30)').refusal.guard).toBe('pine:colour-value')
    // a gradient whose END moves
    expect(one('color.from_gradient(close, low, high, close > open ? color.red : color.blue, color.green)').refusal.guard).toBe('pine:colour-value')
  })
})
