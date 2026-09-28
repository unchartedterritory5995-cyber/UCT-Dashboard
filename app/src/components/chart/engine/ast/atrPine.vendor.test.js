// app/src/components/chart/engine/ast/atrPine.vendor.test.js
//
// ─── ⭐⭐ PINE'S `ta.atr` IN THE JS LANE, PINNED TO THE VENDOR'S OWN NUMBERS ─────
//
// The Python lane is pinned to the SAME two captures by
// `tests/test_atr_pine_parity.py`. Neither file compares one lane with the other:
// each compares its lane with TradingView, so the two cannot agree with each
// other while both being wrong — which is what "parity" between two copies of
// one seed would have proved.
//
// Both captures reach the symbol's FIRST bar, the only place a seed is visible
// (a recursive average forgets its seed geometrically — by ~bar 160 on RDDT):
//   * `harness/keltner-channels-bands-rddt-1d-2026-09-27.json` — Pine v4
//     `ema(close,20) ± k·atr(10)`, NYSE:RDDT 1D, all 631 bars from listing. The
//     vendor's ATR is (band − basis) / k; six independent readings per bar.
//   * `seed-warmup-spy-12m-2026-09-21.json` — SPY 12M, the whole 34-bar series;
//     column `atr5` is `ta.atr(5)` from bar_index 0.
//
// ⭐ THE RULE BOTH AGREE ON, to the last bit: bar 0's true range is
// `high - low` (`ta.tr(true)`), the seed is the mean of the first n true ranges
// and lands on bar n-1, Wilder's step after that.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { interpret } from './interpret.js'
import { translatePine } from './pine.js'

const FIX = path.resolve(process.cwd(), '../tests/fixtures/vendor')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(FIX, rel), 'utf8'))

const S = (name) => ({ type: 'series', name })
const N = (value) => ({ type: 'num', value })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const atrPine = (n) => call('atrPine', S('high'), S('low'), S('close'), N(n))
const houseAtr = (n) => call('atr', S('high'), S('low'), S('close'), N(n))
/** `ta.rma(ta.tr(true), n)` written out in the table's own vocabulary. */
const rmaOfTrTrue = (n) => {
  const prev = { type: 'offset', value: 1, args: [S('close')] }
  const range = op('-', S('high'), S('low'))
  const far = call('max', call('abs', op('-', S('high'), prev)), call('abs', op('-', S('low'), prev)))
  return call('rma', op('?:', call('na', prev), range, call('max', range, far)), N(n))
}

const close = (a, b, abs = 1e-9, rel = 1e-12) => Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b))

function keltner() {
  const d = readJson('harness/keltner-channels-bands-rddt-1d-2026-09-27.json')
  expect(d.history.startsAtBar0, 'the seed is only observable from bar 0').toBe(true)
  const rows = d.bars.rows
  const bars = rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
  const index = new Map(rows.map((r, i) => [r[0], i]))
  const vendor = new Map()
  for (const p of d.plotValues.rows) {
    const b = p[1]
    vendor.set(index.get(p[0]), [p[2] - b, b - p[3], (p[4] - b) / 2, (b - p[5]) / 2, (p[6] - b) / 3, (b - p[7]) / 3])
  }
  return { bars, vendor, source: d.source.text }
}

function spy12m() {
  const d = readJson('seed-warmup-spy-12m-2026-09-21.json')
  expect(d.rows[0].bar_index).toBe(0)
  const bars = d.rows.map((r, i) => ({ t: 1000000000 + i * 86400 * 365, o: r.o, h: r.h, l: r.l, c: r.c, v: 0 }))
  return { bars, vendor: d.rows.map((r) => r.atr5) }
}

describe('⭐⭐ atrPine against the Keltner RDDT capture (631 bars from listing)', () => {
  const { bars, vendor, source } = keltner()

  it('matches every band-implied ATR on every plotted bar — 612 bars × 6 readings', () => {
    const ours = interpret(atrPine(10), bars)
    expect(vendor.size).toBe(612)
    let compared = 0
    for (const [i, readings] of vendor) {
      expect(Number.isFinite(ours[i]), `bar ${i}: the vendor has an ATR and we do not`).toBe(true)
      for (const v of readings) {
        expect(close(ours[i], v), `bar ${i}: ours ${ours[i]} vs vendor ${v}`).toBe(true)
        compared += 1
      }
    }
    expect(compared).toBe(612 * 6)
    // the first vendor values, by bar
    expect(close(ours[19], 5.207212319146947)).toBe(true)
    expect(close(ours[20], 5.052491087232255)).toBe(true)
    expect(close(ours[23], 4.203573002592314)).toBe(true)
  })

  it('seeds on bar n-1 with bar 0 counted as high − low', () => {
    const ours = interpret(atrPine(10), bars)
    expect(Number.isNaN(ours[8])).toBe(true)
    expect(close(ours[9], 8.78848)).toBe(true) // (12.75 + 5.66 + … + 3.33) / 10
    expect(bars[0].h - bars[0].l).toBeCloseTo(12.75, 12)
  })

  it('⭐ the pasted SCRIPT reaches atrPine — the door, not only the table entry', () => {
    const out = translatePine(source)
    expect(out.ok, out.refusal && out.refusal.message).toBe(true)
    const formulas = out.outputs.map((o) => o.formula).join('\n')
    expect(formulas).toMatch(/\batrPine\(high, low, close, 10\)/)
    expect(formulas).not.toMatch(/(^|[^\w])atr\(/)
  })

  it('atrPine IS rma(ta.tr(true)) on every bar — composed, not a second average', () => {
    const a = interpret(atrPine(10), bars)
    const b = interpret(rmaOfTrTrue(10), bars)
    expect(a.filter(Number.isFinite).length).toBeGreaterThan(600)
    for (let i = 0; i < a.length; i += 1) {
      expect(Number.isNaN(a[i])).toBe(Number.isNaN(b[i]))
      if (!Number.isNaN(a[i])) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-15)
    }
  })

  it('⛔ CONTROL — the house `atr` is Wilder’s and MISSES the vendor seed', () => {
    // Without this, every case above passes if atrPine were quietly pointed back
    // at the house column and the capture misread. The house column is untouched
    // by ruling (`divergences.json::atr-tr-starts-at-bar-1`).
    const house = interpret(houseAtr(10), bars)
    expect(Number.isNaN(house[9])).toBe(true)
    expect(Number.isFinite(house[10])).toBe(true)
    let bad = 0
    for (const [i, r] of vendor) if (!close(house[i], r[0])) bad += 1
    expect(bad, 'the house ATR matched the vendor — this control cannot distinguish').toBeGreaterThan(100)
  })
})

describe('⭐⭐ atrPine against the SPY 12M seed capture (bar_index 0..33)', () => {
  const { bars, vendor } = spy12m()

  it('matches all 34 bars, na where the vendor is na', () => {
    const ours = interpret(atrPine(5), bars)
    expect(vendor.length).toBe(34)
    vendor.forEach((v, i) => {
      if (v === null) expect(Number.isNaN(ours[i]), `bar ${i}: vendor na, ours ${ours[i]}`).toBe(true)
      else expect(close(ours[i], v, 1e-12), `bar ${i}: ours ${ours[i]} vs vendor ${v}`).toBe(true)
    })
    expect(ours[4]).toBe(13.96875)
  })
})
