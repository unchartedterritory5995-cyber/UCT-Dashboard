// I2 WS1 — a thinkScript weekly/monthly read computes on weekly/monthly bars
// (`periodLift.js`, basis F). Audit PA1 §2.1's matrix, value-checked.
//
// ⛔ THE REFERENCES ARE BUILT WITHOUT THE ENGINE'S TIMEFRAME MACHINERY. Daily
// synthetic bars are grouped into weeks/months HERE (Monday-of-week, calendar
// month) and the window maths is a plain loop, so a value matching is the lift
// agreeing with arithmetic, not the engine agreeing with itself. Two cases that
// would need a re-derivation of a whole indicator (StDev, RSI) compare against the
// engine's own function run over the independently resampled bars — that checks
// the lift and the alignment, which is what this pass owns.
//
// ⭐ THE CROSS-LANE FIXTURE. `tests/fixtures/ast/period_lift_parity.json` is
// written by this file (PERIOD_LIFT_FIXTURE_WRITE=1) and read by
// `tests/test_ast_period_lift_parity.py`, which holds the Python lane to it at
// 1e-9. Synthetic bars only; no market data.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { translateThinkScript } from './thinkscript.js'
import { interpret } from './interpret.js'
import { parseFormula, TABLE } from './parse.js'
import { liftPeriods, BASIS, MIXED_GUARD, isPeriodLeaf } from './periodLift.js'
import { inspectSource } from '../../builder/PineBox.jsx'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(HERE, '../../../../../../tests/fixtures/ast/period_lift_parity.json')

// ─── synthetic weekday bars (no holidays — synthetic) ────────────────────────
function dailyBars(n, seed = 11) {
  let x = seed
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648 }
  const out = []
  let c = 100
  const d = new Date(Date.UTC(2023, 0, 2)) // a Monday
  while (out.length < n) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const o = c
      c = Math.max(5, c * (1 + (rnd() - 0.49) * 0.04))
      const h = Math.max(o, c) * (1 + rnd() * 0.01)
      const l = Math.min(o, c) * (1 - rnd() * 0.01)
      out.push({ t: d.toISOString().slice(0, 10), o, h, l, c, v: 1e6 + Math.floor(rnd() * 5e5) })
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const BARS = dailyBars(560)

const weekKey = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
const monthKey = (iso) => iso.slice(0, 7)

/** Group daily bars into periods; each daily bar learns its period index. */
function periods(bars, keyOf) {
  const list = []
  const idx = []
  for (const b of bars) {
    const k = keyOf(b.t)
    let p = list[list.length - 1]
    if (!p || p.key !== k) { p = { key: k, o: b.o, h: b.h, l: b.l, c: b.c, v: 0, t: b.t }; list.push(p) }
    p.h = Math.max(p.h, b.h); p.l = Math.min(p.l, b.l); p.c = b.c; p.v += b.v; p.t = b.t
    idx.push(list.length - 1)
  }
  return { list, idx }
}
const W = periods(BARS, weekKey)
const M = periods(BARS, monthKey)

const windowAt = (arr, j, n, f) => (j - n + 1 < 0 ? NaN : f(arr.slice(j - n + 1, j + 1)))
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length

/** The per-period reference, aligned to every daily bar of that period: FINAL value
 *  of the period the bar is in (basis F, unshifted), or of the period `back` before. */
function aligned(P, perPeriod, back = 0) {
  return P.idx.map((j) => (j - back < 0 ? NaN : perPeriod[j - back]))
}

const translate = (src) => {
  const out = translateThinkScript(src)
  expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
  const row = out.outputs[out.selected]
  expect(row && row.ast, 'no output').toBeTruthy()
  return row
}
const run = (ast, bars = BARS) => Array.from(interpret(ast, bars, {}))

function expectColumn(got, ref, { tol = 1e-9, minCompared = 200 } = {}) {
  expect(got.length).toBe(ref.length)
  let compared = 0
  for (let i = 0; i < ref.length; i++) {
    if (!Number.isFinite(ref[i])) continue
    if (!Number.isFinite(got[i])) continue // engine warm-up may withhold a bar the reference has
    compared++
    expect(Math.abs(got[i] - ref[i]) <= tol * Math.max(1, Math.abs(ref[i])), `bar ${i} (${BARS[i].t}): ${got[i]} vs ${ref[i]}`).toBe(true)
  }
  // ⛔ NON-VACUITY: a column of holes would pass every comparison above.
  expect(compared).toBeGreaterThanOrEqual(minCompared)
  return compared
}

const WEEK = 'AggregationPeriod.WEEK'
const MONTH = 'AggregationPeriod.MONTH'
const wc = W.list.map((p) => p.c)
const mc = M.list.map((p) => p.c)

describe('basis F is the owner’s decision', () => {
  it('BASIS is F', () => { expect(BASIS).toBe('F') })
})

describe('the shape of the lifted tree (PA1 §2.3)', () => {
  it('Average(close(W), 10) → tf_live(sma(close, 10), W)', () => {
    expect(translate(`plot x = Average(close(period = ${WEEK}), 10);`).ast).toEqual({
      type: 'tf_live', value: 'W',
      args: [{ type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 10 }] }],
    })
  })
  it('close(W)[1] → tf(close, W) — the confirmed previous week', () => {
    expect(translate(`plot x = close(period = ${WEEK})[1];`).ast)
      .toEqual({ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] })
  })
  it('Average(close(W), 10)[1] → tf(sma(close, 10), W)', () => {
    expect(translate(`plot x = Average(close(period = ${WEEK}), 10)[1];`).ast).toEqual({
      type: 'tf', value: 'W',
      args: [{ type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 10 }] }],
    })
  })
  it('close(MONTH)[2] → tf(close[1], M)', () => {
    expect(translate(`plot x = close(period = ${MONTH})[2];`).ast).toEqual({
      type: 'tf', value: 'M', args: [{ type: 'offset', value: 1, args: [{ type: 'series', name: 'close' }] }],
    })
  })
  it('an element-wise mix stays daily: close > Average(close(W), 10)', () => {
    const ast = translate(`plot x = close > Average(close(period = ${WEEK}), 10);`).ast
    expect(ast.type).toBe('op')
    expect(ast.args[0]).toEqual({ type: 'series', name: 'close' })
    expect(ast.args[1].type).toBe('tf_live')
  })
  it('no period leaf survives anywhere in a lifted tree', () => {
    const ast = translate(`plot x = Average(close(period = ${WEEK}) - open(period = ${WEEK}), 10);`).ast
    const leaves = []
    const walk = (n) => { if (n && typeof n === 'object') { if (isPeriodLeaf(n)) leaves.push(n); (n.args || []).forEach(walk) } }
    walk(ast.args[0])
    expect(ast.type).toBe('tf_live')
    expect(leaves).toEqual([])
  })
})

describe('values against independent weekly/monthly references (PA1 §2.1 rows)', () => {
  it('#3 Average(close(W), 10) is the 10-WEEK average, final value on past bars', () => {
    const ref = aligned(W, wc.map((_, j) => windowAt(wc, j, 10, mean)))
    expectColumn(run(translate(`plot x = Average(close(period = ${WEEK}), 10);`).ast), ref)
  })
  it('#7/#8 Highest(high(W), 10) and Lowest(low(W), 10) are 10-WEEK extremes', () => {
    const wh = W.list.map((p) => p.h)
    const wl = W.list.map((p) => p.l)
    expectColumn(run(translate(`plot x = Highest(high(period = ${WEEK}), 10);`).ast),
      aligned(W, wh.map((_, j) => windowAt(wh, j, 10, (a) => Math.max(...a)))))
    expectColumn(run(translate(`plot x = Lowest(low(period = ${WEEK}), 10);`).ast),
      aligned(W, wl.map((_, j) => windowAt(wl, j, 10, (a) => Math.min(...a)))))
  })
  it('#9 Sum(volume(W), 4) is four WEEKS of volume', () => {
    const wv = W.list.map((p) => p.v)
    expectColumn(run(translate(`plot x = Sum(volume(period = ${WEEK}), 4);`).ast),
      aligned(W, wv.map((_, j) => windowAt(wv, j, 4, (a) => a.reduce((s, x) => s + x, 0)))))
  })
  it('#15 close(W)[1] is the PREVIOUS week’s close on every bar, including each Monday', () => {
    const ref = aligned(W, wc, 1)
    expectColumn(run(translate(`plot x = close(period = ${WEEK})[1];`).ast), ref, { minCompared: 500 })
  })
  it('#16 close(MONTH)[2] is the close two MONTHS back', () => {
    expectColumn(run(translate(`plot x = close(period = ${MONTH})[2];`).ast), aligned(M, mc, 2), { minCompared: 450 })
  })
  it('#17 close(W) - close(W)[1] is this week’s change, never zero mid-week', () => {
    const per = wc.map((c, j) => (j < 1 ? NaN : c - wc[j - 1]))
    expectColumn(run(translate(`plot x = close(period = ${WEEK}) - close(period = ${WEEK})[1];`).ast), aligned(W, per), { minCompared: 500 })
  })
  it('#19 Average(close(W), 10)[1] is last week’s 10-week average (confirmed)', () => {
    const per = wc.map((_, j) => windowAt(wc, j, 10, mean))
    expectColumn(run(translate(`plot x = Average(close(period = ${WEEK}), 10)[1];`).ast), aligned(W, per, 1))
  })
  it('#22/#23 a def and an input bind through to the same 10-week average', () => {
    const ref = aligned(W, wc.map((_, j) => windowAt(wc, j, 10, mean)))
    expectColumn(run(translate(`def w = close(period = ${WEEK});\nplot x = Average(w, 10);`).ast), ref)
    expectColumn(run(translate(`input agg = ${WEEK};\nplot x = Average(close(period = agg), 10);`).ast), ref)
  })
  it('#24 ExpAverage(close(MONTH), 6) runs on monthly bars (engine ema over the resampled months)', () => {
    const months = M.list.map((p) => ({ t: p.t, o: p.o, h: p.h, l: p.l, c: p.c, v: p.v }))
    const perMonth = run(parseFormula('ema(close, 6)').ast, months)
    expectColumn(run(translate(`plot x = ExpAverage(close(period = ${MONTH}), 6);`).ast), aligned(M, perMonth), { minCompared: 300 })
  })
  it('#10/#11 StDev and RSI over weekly closes run on weekly bars', () => {
    const weeks = W.list.map((p) => ({ t: p.t, o: p.o, h: p.h, l: p.l, c: p.c, v: p.v }))
    for (const [ts, native] of [['StDev(close(period = AggregationPeriod.WEEK), 10)', 'stdev(close, 10)'],
      ['RSI(price = close(period = AggregationPeriod.WEEK), length = 14)', 'rsi(close, 14)']]) {
      const per = run(parseFormula(native).ast, weeks)
      expectColumn(run(translate(`plot x = ${ts};`).ast), aligned(W, per), { minCompared: 300 })
    }
  })
  it('#27 close crosses above Average(close(W), 10) is decided on DAILY bars of both', () => {
    const w10 = aligned(W, wc.map((_, j) => windowAt(wc, j, 10, mean)))
    const ref = BARS.map((b, i) => (i < 1 || !Number.isFinite(w10[i - 1]) || !Number.isFinite(w10[i]) ? NaN
      : (BARS[i - 1].c <= w10[i - 1] && b.c > w10[i] ? 1 : 0)))
    const got = run(translate(`plot x = close crosses above Average(close(period = ${WEEK}), 10);`).ast).map(Number)
    expectColumn(got, ref)
    expect(ref.filter((v) => v === 1).length).toBeGreaterThan(2) // the cross actually happens
  })
})

describe('developing values (basis F): the current period moves until it closes', () => {
  it('a mid-week bar’s value changes when the rest of the week arrives, and past bars show the final', () => {
    const ast = translate(`plot x = Average(close(period = ${WEEK}), 10);`).ast
    // the last week that has a Wednesday and a Friday
    const fri = BARS.map((b) => b.t).filter((t) => new Date(`${t}T00:00:00Z`).getUTCDay() === 5).at(-1)
    const iFri = BARS.findIndex((b) => b.t === fri)
    const iWed = iFri - 2
    expect(new Date(`${BARS[iWed].t}T00:00:00Z`).getUTCDay()).toBe(3)
    const asOfWed = run(ast, BARS.slice(0, iWed + 1))
    const asOfFri = run(ast, BARS.slice(0, iFri + 1))
    // on Wednesday, the forming week's value uses Wednesday's close
    const wk = W.idx[iWed]
    const formingCloses = [...wc.slice(wk - 9, wk), BARS[iWed].c]
    expect(Math.abs(asOfWed[iWed] - mean(formingCloses)) < 1e-9).toBe(true)
    // by Friday the same Wednesday bar shows the week's FINAL value: it repainted
    expect(Math.abs(asOfFri[iWed] - mean(wc.slice(wk - 9, wk + 1))) < 1e-9).toBe(true)
    expect(asOfFri[iWed]).not.toBe(asOfWed[iWed])
  })
  it('a shifted read never moves: last week’s close is the same on Wednesday and on Friday', () => {
    const ast = translate(`plot x = close(period = ${WEEK})[1];`).ast
    const fri = BARS.map((b) => b.t).filter((t) => new Date(`${t}T00:00:00Z`).getUTCDay() === 5).at(-1)
    const iFri = BARS.findIndex((b) => b.t === fri)
    const iWed = iFri - 2
    expect(run(ast, BARS.slice(0, iWed + 1))[iWed]).toBe(run(ast, BARS.slice(0, iFri + 1))[iWed])
  })
})

describe('mixed daily/weekly inside a window is refused, not guessed (PA1 row 29)', () => {
  for (const src of [
    `plot x = Average(close - close(period = ${WEEK}), 10);`,
    `plot x = (close - close(period = ${WEEK}))[1];`,
    `plot x = Highest(high - high(period = ${MONTH}), 5);`,
  ]) {
    it(src, () => {
      const out = translateThinkScript(src)
      const g = out.refusal ? out.refusal.guard : out.outputs[0] && out.outputs[0].refusal && out.outputs[0].refusal.guard
      expect(g).toBe(MIXED_GUARD)
    })
  }
  it('the refusal names the window and tells the member what to do', () => {
    const out = translateThinkScript(`plot x = Average(close - close(period = ${WEEK}), 10);`)
    const r = out.refusal || out.outputs[0].refusal
    expect(r.message).toMatch(/will not guess/)
    expect(r.message).toMatch(/`sma`/)
  })
})

describe('disclosure: the import says weekly/monthly, never "exact"', () => {
  it('the row carries the fold channel with the period and whether it develops', () => {
    expect(translate(`plot x = Average(close(period = ${WEEK}), 10);`).thinkscriptSecondaryAggregation)
      .toEqual([{ period: 'W', form: 'live' }])
    expect(translate(`plot x = close(period = ${MONTH})[1];`).thinkscriptSecondaryAggregation)
      .toEqual([{ period: 'M', form: 'closed' }])
    expect(translate('plot x = Average(close, 10);').thinkscriptSecondaryAggregation).toBe(undefined)
  })
  it('the Import box verdict is a disclosed difference, never "Exact" and never "the values are the same"', () => {
    const rep = inspectSource(`plot x = Average(close(period = ${WEEK}), 10);`, 'thinkscript')
    expect(rep.outcome.verdict).toBe('disclosed')
    expect(rep.outcome.reason).not.toMatch(/the values are the same/)
    expect(rep.outcome.semantic.map((n) => n.name)).toContain('thinkscriptSecondaryAggregation')
  })
  it('closedTable declares the channel, and its sentence never claims a confirmed match', () => {
    const fold = TABLE._folds.thinkscriptSecondaryAggregation
    expect(fold && fold.kind).toBe('fold')
    expect(fold.memberNote).toMatch(/not yet been confirmed against thinkorswim/)
    expect(fold.memberNote).toMatch(/may repaint/)
    expect(fold.memberNote).not.toMatch(/\bexact|as thinkorswim does/i)
  })
})

describe('saved definitions are untouched', () => {
  it('a saved legacy weekly formula still reads, hashes and computes exactly as before', () => {
    // A thinkScript paste was SAVED as this native text (PA1 §2.2). The native
    // reader does not run the lift, so its tree is the legacy tree, byte for byte.
    const legacy = parseFormula("sma(tf(close, 'W'), 10)")
    expect(legacy.ast).toEqual({ type: 'call', name: 'sma', args: [{ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] }, { type: 'num', value: 10 }] })
    // and its values are the daily average of the closed-week close — unchanged maths
    const closedWeek = aligned(W, wc, 1)
    const ref = BARS.map((_, i) => windowAt(closedWeek, i, 10, mean))
    expectColumn(run(legacy.ast), ref, { minCompared: 500 })
  })
  it('the lift is wired into the thinkScript door ONLY', () => {
    const importers = []
    for (const f of fs.readdirSync(HERE)) {
      if (!f.endsWith('.js') || f.includes('.test.') || f === 'periodLift.js') continue
      if (/from '\.\/periodLift\.js'/.test(fs.readFileSync(path.join(HERE, f), 'utf8'))) importers.push(f)
    }
    expect(importers).toEqual(['thinkscript.js'])
  })
  it('liftPeriods returns a tree without period leaves BY IDENTITY and never mutates its input', () => {
    const plain = parseFormula('sma(close, 10)').ast
    expect(liftPeriods(plain, TABLE.functions).ast).toBe(plain)
    const tree = { type: 'call', name: 'sma', args: [{ type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] }, { type: 'num', value: 10 }] }
    const before = JSON.stringify(tree)
    liftPeriods(tree, TABLE.functions)
    expect(JSON.stringify(tree)).toBe(before)
  })
})

// ─── the cross-lane fixture ──────────────────────────────────────────────────
const PARITY_CASES = [
  `plot x = Average(close(period = ${WEEK}), 10);`,
  `plot x = close(period = ${WEEK})[1];`,
  `plot x = Average(close(period = ${WEEK}), 10)[1];`,
  `plot x = close(period = ${MONTH})[2];`,
  `plot x = Highest(high(period = ${WEEK}), 4);`,
  `plot x = close / close(period = ${WEEK});`,
]
function fixtureNow() {
  const b = BARS.slice(0, 320)
  return {
    _: 'Written by app/src/components/chart/engine/ast/periodLift.test.js (PERIOD_LIFT_FIXTURE_WRITE=1); read by tests/test_ast_period_lift_parity.py. Synthetic bars only.',
    bars: b,
    cases: PARITY_CASES.map((source) => {
      const ast = translate(source).ast
      return { source, ast, expected: run(ast, b).map((v) => (Number.isFinite(v) ? v : null)) }
    }),
  }
}
describe('the cross-lane fixture', () => {
  it('matches this lane (and is rewritten on request)', () => {
    const now = fixtureNow()
    if (process.env.PERIOD_LIFT_FIXTURE_WRITE === '1') {
      fs.writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`)
    }
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    expect(committed.cases.map((c) => c.source)).toEqual(PARITY_CASES)
    for (let k = 0; k < now.cases.length; k++) {
      expect(committed.cases[k].ast).toEqual(now.cases[k].ast)
      const a = now.cases[k].expected
      const c = committed.cases[k].expected
      expect(a.length).toBe(c.length)
      for (let i = 0; i < a.length; i++) {
        if (c[i] === null) { expect(a[i], `case ${k} bar ${i}`).toBe(null); continue }
        expect(Math.abs(a[i] - c[i]) < 1e-9, `case ${k} bar ${i}`).toBe(true)
      }
    }
    for (const c of committed.cases) expect(c.expected.filter((v) => v !== null).length).toBeGreaterThan(150)
  })
})
