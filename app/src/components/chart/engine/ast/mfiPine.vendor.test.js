// app/src/components/chart/engine/ast/mfiPine.vendor.test.js
//
// ─── ⭐⭐ PINE'S `ta.mfi` IN THE JS LANE, PINNED TO THE VENDOR'S OWN NUMBERS ─────
//
// The Python lane is pinned to the SAME capture by `tests/test_mfi_pine_parity.py`.
// Neither compares one lane with the other: each compares its lane with
// TradingView, so the two cannot agree with each other while both being wrong.
//
// The capture reaches the symbol's FIRST bar, the only place the difference is
// visible (it is ONE bar — bar n-1 — and nothing after it):
//   * `harness/artemis-oscillator-pro-rddt-1d-2026-09-28.json` — Pine v5,
//     NYSE:RDDT 1D, all 632 bars from listing. Its Volume Pressure line is
//       vpMid = compress(ta.sma(ta.mfi(hlc3, 11) * 0.5 + ta.mfi(hlc3, 19) * 0.5, 2), 0.7) / 2 + 50
//     plotted as `VP Bull = max(vpMid, 50)` and `VP Bear = min(vpMid, 50)`.
//     TradingView's first value is on bar 19: `ta.mfi(hlc3, 19)` answers on bar 18
//     and the 2-bar `sma` needs one more. The house `mfi` answered on bar 19, so
//     the plot started on bar 20 — the harness's one-bar `na` divergence.
//
// ⭐ THE RULE, from TradingView's published source for `ta.mfi`:
//     upper = math.sum(volume * (ta.change(src) <= 0.0 ? 0.0 : src), length)
//     lower = math.sum(volume * (ta.change(src) >= 0.0 ? 0.0 : src), length)
//     mfi   = 100.0 - (100.0 / (1.0 + upper / lower))
// `ta.change(src)` is `na` on bar 0 and a comparison with `na` is FALSE, so bar
// 0's flow lands in BOTH sums and `math.sum` is complete on bar length-1.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { interpret } from './interpret.js'
import { translatePine } from './pine.js'

const FIX = path.resolve(process.cwd(), '../tests/fixtures/vendor')
const CAPTURE = 'harness/artemis-oscillator-pro-rddt-1d-2026-09-28.json'

const S = (name) => ({ type: 'series', name })
const N = (value) => ({ type: 'num', value })
const call = (name, ...args) => ({ type: 'call', name, args })
const mfiPine = (n) => call('mfiPine', S('high'), S('low'), S('close'), S('volume'), N(n))
const houseMfi = (n) => call('mfi', S('high'), S('low'), S('close'), S('volume'), N(n))

const close = (a, b, abs = 1e-9, rel = 1e-12) => Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b))

function artemis() {
  const d = JSON.parse(fs.readFileSync(path.join(FIX, CAPTURE), 'utf8'))
  expect(d.history.startsAtBar0, 'the first window is only observable from bar 0').toBe(true)
  const bars = d.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
  const idOf = (title) => d.study.plots.find((p) => p.title === title).id
  const col = (id) => {
    const k = d.plotValues.fields.indexOf(id)
    const byTime = new Map(d.plotValues.rows.map((r) => [r[0], r[k]]))
    return d.bars.rows.map((r) => {
      const v = byTime.get(r[0])
      return v === null || v === undefined ? NaN : v
    })
  }
  return { bars, bull: col(idOf('VP Bull')), bear: col(idOf('VP Bear')), source: d.source.text }
}

/** The script's own arithmetic after the two MFIs, in plain JS — nothing of
 *  this engine's between the MFI columns and the vendor's plot. */
function vpMid(fast, slow) {
  const blend = fast.map((x, i) => x * 0.5 + slow[i] * 0.5)
  const compress = (x) => {
    const n = (x / 100 - 0.5) * 2
    return 0.7 * 100 * (n > 0 ? 1 : -1) * Math.pow(Math.abs(n), 0.75)
  }
  return blend.map((x, i) => (i === 0 ? NaN : compress((x + blend[i - 1]) / 2) / 2 + 50))
}

describe('⭐⭐ mfiPine against the Artemis RDDT capture (632 bars from listing)', () => {
  const { bars, bull, bear, source } = artemis()

  it('VP Bull and VP Bear agree with TradingView on EVERY bar, na-ness included', () => {
    const vp = vpMid(interpret(mfiPine(11), bars), interpret(mfiPine(19), bars))
    let compared = 0
    for (let i = 0; i < bars.length; i += 1) {
      for (const [vendor, ours] of [[bull[i], Math.max(vp[i], 50)], [bear[i], Math.min(vp[i], 50)]]) {
        expect(Number.isNaN(ours), `bar ${i}: vendor ${vendor} ours ${ours}`).toBe(Number.isNaN(vendor))
        if (!Number.isNaN(vendor)) {
          expect(close(ours, vendor), `bar ${i}: ours ${ours} vs vendor ${vendor}`).toBe(true)
          compared += 1
        }
      }
    }
    // ⛔ NON-VACUITY: 613 plotted bars x 2 plots.
    expect(compared).toBe(613 * 2)
    // the bar the harness reported, to the digits it quoted
    expect(Number.isNaN(vp[18])).toBe(true)
    expect(close(Math.min(vp[19], 50), 40.08191730469555)).toBe(true)
    expect(Math.max(vp[19], 50)).toBe(50)
  })

  it('the first value lands on bar n-1, and it counts bar 0 on BOTH sides', () => {
    const m = interpret(mfiPine(19), bars)
    expect(Number.isNaN(m[17])).toBe(true)
    expect(Number.isFinite(m[18])).toBe(true)
    const tp = bars.map((b) => (b.h + b.l + b.c) / 3)
    let up = tp[0] * bars[0].v
    let down = tp[0] * bars[0].v
    for (let j = 1; j <= 18; j += 1) {
      if (tp[j] > tp[j - 1]) up += tp[j] * bars[j].v
      else if (tp[j] < tp[j - 1]) down += tp[j] * bars[j].v
    }
    expect(close(m[18], 100 - 100 / (1 + up / down), 1e-12)).toBe(true)
  })

  it('from bar n on it IS the house `mfi`, bit for bit — only the first window differs', () => {
    for (const n of [11, 14, 19]) {
      const p = interpret(mfiPine(n), bars)
      const h = interpret(houseMfi(n), bars)
      expect(Number.isNaN(h[n - 1]) && Number.isFinite(p[n - 1]), `n=${n}`).toBe(true)
      for (let i = n; i < bars.length; i += 1) expect(p[i], `n=${n} bar ${i}`).toBe(h[i])
    }
  })

  it('⭐ the pasted SCRIPT reaches mfiPine — the door, not only the table entry', () => {
    const out = translatePine(source)
    expect(out.ok, out.refusal && out.refusal.message).toBe(true)
    const formulas = out.outputs.map((o) => o.formula || '').join('\n')
    expect(formulas).toMatch(/\bmfiPine\(high, low, close, volume, 11\)/)
    expect(formulas).toMatch(/\bmfiPine\(high, low, close, volume, 19\)/)
    expect(formulas).not.toMatch(/(^|[^\w])mfi\(/)
  })

  it('⛔ CONTROL — the house `mfi` starts a bar late and MISSES bar 19', () => {
    // Without this, every case above passes if mfiPine were quietly pointed back
    // at the house column. The house column stays for the native MFI and its
    // golden fixtures, by the same ruling that keeps the house `atr`.
    const vp = vpMid(interpret(houseMfi(11), bars), interpret(houseMfi(19), bars))
    expect(Number.isNaN(vp[19])).toBe(true)
    expect(Number.isNaN(bear[19])).toBe(false)
  })
})

describe('mfiPine by hand — three bars, n = 2', () => {
  // A flat bar (h = l = c) makes the typical price the close, so every number
  // below is exact. Flows: bar 0 = 10 x 1 = 10 (direction unknown), bar 1 =
  // 12 x 1 = 12 (up), bar 2 = 11 x 2 = 22 (down).
  const bars = [[10, 1], [12, 1], [11, 2]].map(([c, v], t) => ({ t, o: c, h: c, l: c, c, v }))

  it('bar 1 (= n-1) counts bar 0 on both sides: 100 - 100 / (1 + 22/10) = 68.75', () => {
    const p = interpret(mfiPine(2), bars)
    expect(Number.isNaN(p[0])).toBe(true)
    expect(p[1]).toBe(68.75)
    // and the house column has nothing there yet
    expect(Number.isNaN(interpret(houseMfi(2), bars)[1])).toBe(true)
  })

  it('bar 2 (= n) no longer holds bar 0: up 12, down 22 — both columns agree', () => {
    const want = 100 - 100 / (1 + 12 / 22)
    expect(interpret(mfiPine(2), bars)[2]).toBe(want)
    expect(interpret(houseMfi(2), bars)[2]).toBe(want)
  })

  it('a window with no falling flow is 100, as the house column says', () => {
    const rising = [[10, 1], [11, 1], [12, 1]].map(([c, v], t) => ({ t, o: c, h: c, l: c, c, v }))
    // bar 1's window holds bar 0, whose flow is on the falling side too
    expect(interpret(mfiPine(2), rising)[1]).toBe(100 - 100 / (1 + 21 / 10))
    expect(interpret(mfiPine(2), rising)[2]).toBe(100)
  })
})
