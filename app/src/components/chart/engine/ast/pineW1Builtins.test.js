// app/src/components/chart/engine/ast/pineW1Builtins.test.js
//
// ─── PINE FULL-PARITY W1 (2026-11-02) — NAMES AND ROBUSTNESS ─────────────────
//
// The names W1 taught the member door, each held to a NUMBER. Where no
// TradingView capture holds the name yet, the number is an implementation written
// HERE from TradingView's published definition, in plain loops that share nothing
// with the engine (REFERENCE), and the name owes a capture row in
// `docs/pine/capture-queue-2026-11-02-w1.md`. `na` and warm-up are asserted for
// every name, not only values.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { translatePine, BUILTIN_CALL_TREE } from './pine'
import { parseFormula } from './parse'
import { interpret } from './interpret'
import { checkBudget, DEFAULT_BUDGET } from './budget'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'

const REPO = path.resolve(process.cwd(), '..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'))
const NL = String.fromCharCode(10)
const V = (version, body) => `//@version=${version}${NL}${version >= 5 ? 'indicator' : 'study'}("p")${NL}${body}`
const V6 = (body) => V(6, body)

/** One translation's single output tree, read back the way a saved definition is. */
function treeOf(source, opts) {
  const t = translatePine(source, opts)
  const outs = (t.outputs || []).filter((o) => o.formula && !o.refusal)
  expect(outs.length, `nothing translated: ${JSON.stringify(t.refusals || t.refusal || null).slice(0, 400)}`)
    .toBeGreaterThan(0)
  const parsed = parseFormula(outs[0].formula)
  expect(parsed.ok, outs[0].formula).toBe(true)
  return { tree: parsed.ast, formula: outs[0].formula }
}
const refusalOf = (source, opts) => {
  const t = translatePine(source, opts)
  const all = [...(t.refusals || []), ...(t.outputs || []).map((o) => o.refusal).filter(Boolean)]
  return all[0] || t.refusal || null
}

// SPY's own bars, with holes punched in a copy so the na rules are exercised.
const SPY = readJson('tests/fixtures/vendor/vw-alma-spy-1d-2026-09-27.json')
const BARS = SPY.bars.rows.slice(0, 1500).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v ?? 0 }))
const HOLE = (i) => i % 97 === 50 || (i >= 300 && i <= 303)
const holedBars = BARS.map((b, i) => (HOLE(i) ? { ...b, c: NaN } : b))

/** Pine's `ta.cum`, as the vendor was measured answering it (`interpret.js::cumCol`
 *  records the capture): `na` before the first known input, `na` ON an `na` bar,
 *  and the total held across it. Written here, not imported. */
function refCum(xs) {
  let total = NaN
  return xs.map((x) => {
    if (!Number.isFinite(x)) return NaN
    total = Number.isFinite(total) ? total + x : x
    return total
  })
}
const near = (a, b, rel) => (Number.isFinite(a) || Number.isFinite(b))
  ? Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)) : true
function same(ours, ref, rel = 1e-12) {
  let n = 0
  for (let i = 0; i < ref.length; i++) {
    expect(Number.isFinite(ours[i]), `bar ${i}: ours ${ours[i]} ref ${ref[i]} (na differs)`).toBe(Number.isFinite(ref[i]))
    expect(near(ours[i], ref[i], rel), `bar ${i}: ours ${ours[i]} ref ${ref[i]}`).toBe(true)
    if (Number.isFinite(ref[i])) n += 1
  }
  return n
}
const pane = { strict: true }

// ─── ta.obv / ta.pvt ─────────────────────────────────────────────────────────

describe('ta.obv — REFERENCE: ta.cum(math.sign(ta.change(close)) * volume), on a pane', () => {
  const refObv = (bars) => refCum(bars.map((b, i) => (i === 0 ? NaN : Math.sign(b.c - bars[i - 1].c) * b.v)))
  it('every bar of 1,500, holes included: na on bar 0 and on every hole, the total held across it', () => {
    const { tree, formula } = treeOf(V6('plot(ta.obv)'), pane)
    expect(formula).toBe('cum(sign(change(close)) * volume)')
    const ours = interpret(tree, holedBars)
    // a hole poisons its own bar and the next (change reads close[1])
    expect(same(ours, refObv(holedBars))).toBe(1500 - 1 - 2 * 15 - 1 - 4)
    expect(Number.isFinite(ours[0])).toBe(false)
    expect(Number.isFinite(ours[1])).toBe(true)
  })
  it('an unchanged close adds 0 (sign 0), not the volume', () => {
    const bars = [
      { t: 1, o: 1, h: 1, l: 1, c: 10, v: 5 },
      { t: 2, o: 1, h: 1, l: 1, c: 11, v: 7 },
      { t: 3, o: 1, h: 1, l: 1, c: 11, v: 100 },
      { t: 4, o: 1, h: 1, l: 1, c: 9, v: 3 },
    ]
    expect(Array.from(interpret(treeOf(V6('plot(ta.obv)'), pane).tree, bars), (x) => (Number.isFinite(x) ? x : null)))
      .toEqual([null, 7, 7, 4])
  })
  it('the corpus quantity ta.ema(ta.obv, n) translates on a pane (a level, so a pane only)', () => {
    expect(treeOf(V6('plot(ta.ema(ta.obv, 21))'), pane).formula).toBe('ema(cum(sign(change(close)) * volume), 21)')
  })
  it('a SCREEN keeps the ruling: the level moves with the fetch', () => {
    expect(refusalOf(V6('plot(ta.obv)'))).not.toBeNull()
    expect(refusalOf(V6('plot(ta.ema(ta.obv, 21))'))).not.toBeNull()
  })
  it('the bounded rewrites still win, on a pane as on a screen: obv > obv[k] is obvN(k) > 0', () => {
    for (const opts of [undefined, pane]) {
      expect(treeOf(V6('plot(ta.obv > ta.obv[5] ? 1 : 0)'), opts).formula).toMatch(/obvN\(5\) > 0/)
      expect(treeOf(V6('plot(ta.obv - ta.obv[3])'), opts).formula).toBe('obvN(3)')
    }
  })
  it('v4 bare `obv` is TradingView\'s obv; from v5 the bare spelling is refused by name', () => {
    expect(treeOf(V(4, 'plot(obv)'), pane).formula).toBe('cum(sign(change(close)) * volume)')
    const r = refusalOf(V6('plot(obv)'), pane)
    expect(r.guard).toBe('pine:function')
    expect(r.message).toMatch(/ta\.obv/)
  })
})

describe('ta.pvt — REFERENCE: ta.cum((ta.change(close) / close[1]) * volume), on a pane', () => {
  const refPvt = (bars) => refCum(bars.map((b, i) => (i === 0 ? NaN : ((b.c - bars[i - 1].c) / bars[i - 1].c) * b.v)))
  it('every bar of 1,500, holes included', () => {
    const { tree, formula } = treeOf(V6('plot(ta.pvt)'), pane)
    expect(formula).toBe('cum(change(close) / close[1] * volume)')
    const ours = interpret(tree, holedBars)
    expect(same(ours, refPvt(holedBars), 1e-11)).toBe(1500 - 1 - 2 * 15 - 1 - 4)
    expect(Number.isFinite(ours[0])).toBe(false)
  })
  it('a SCREEN keeps the ruling; the bounded pvtN rewrite still wins', () => {
    expect(refusalOf(V6('plot(ta.pvt)'))).not.toBeNull()
    expect(treeOf(V6('plot(ta.pvt - ta.pvt[4])')).formula).toBe('pvtN(4)')
    expect(treeOf(V6('plot(ta.pvt - ta.pvt[4])'), pane).formula).toBe('pvtN(4)')
  })
  it('v4 bare `pvt` is TradingView\'s pvt; v6 bare `pvt` is refused by name', () => {
    expect(treeOf(V(4, 'plot(pvt)'), pane).formula).toBe('cum(change(close) / close[1] * volume)')
    expect(refusalOf(V6('plot(pvt)'), pane).guard).toBe('pine:function')
  })
})

// ─── ta.iii / ta.wvad / ta.wad ───────────────────────────────────────────────

// ⛔ e99 (2026-11-26, MEASURED): `ta.iii` MULTIPLIES BY THE VOLUME, in every version: TradingView's own `ta.iii`
// (Pine v6, the builtin4 witness captures `builtin4-witness-spy-spy-1d-2026-11-26` (AMEX:SPY 1D, 8,515 bars, receipt
// fnv1a 1430519255) and `builtin4-witness-rddt-rddt-1d-2026-11-26` (NYSE:RDDT 1D, 674 bars, fnv1a 3084821133), local
// evidence) equals `((2 * close - high - low) / (high - low)) * volume`, the v5/v6 pages' body, on every bar, its one
// `na` (a high == low bar) included; graded for //@version=6, 5 and 4 alike. The dividing body the W1 re-review
// (2026-11-02) switched to matched 35 of 8,515 and 0 of 674. Its evidence, PyneCore's export fixture, is not a v4
// export (its column is the v5+ name `ta.iii`), so v4 multiplies too. Sources: `pine.js` (the `iii` tree's comment).
describe('ta.iii, ta.wvad — REFERENCE: TradingView\'s per-bar bodies; a screen may read them', () => {
  const iii = (b) => ((2 * b.c - b.h - b.l) / (b.h - b.l)) * b.v
  const wvad = (b) => ((b.c - b.o) / (b.h - b.l)) * b.v
  // the engine's one rule for a division by zero, applied here as the reference's own
  // last step: IEEE division (`interpret.js::BINARY['/']`), and whatever is not finite
  // is `na` at the column (`interpret.js::toColumn`)
  const fin = (xs) => xs.map((x) => (Number.isFinite(x) ? x : NaN))
  it('every bar, holes included (a hole in close is a hole in both)', () => {
    for (const [name, ref] of [['ta.iii', iii], ['ta.wvad', wvad]]) {
      for (const opts of [undefined, pane]) {
        const ours = interpret(treeOf(V6(`plot(${name})`), opts).tree, holedBars)
        const want = fin(holedBars.map(ref))
        // every hole in close is a hole here (and a high == low bar, if any, is not finite)
        expect(same(fin(Array.from(ours)), want)).toBe(want.filter(Number.isFinite).length)
        expect(want.filter(Number.isFinite).length).toBeGreaterThan(1470)
      }
    }
  })
  it('⛔ ta.iii by hand: the volume multiplies; a zero range is a gap (0 / 0), a zero volume over a range is 0', () => {
    const bars = [
      // 2 * 769.64 - 772 - 765 = 2.28, and 2.28 / 7 * 46,335,000 = 15,091,971.43
      { t: 1, o: 768, h: 772.00, l: 765.00, c: 769.64, v: 46335000 },
      // high == low: (2 * 100 - 100 - 100) / 0 * 5000 = 0 / 0 → NaN → na
      { t: 2, o: 100, h: 100, l: 100, c: 100, v: 5000 },
      // volume == 0: (21 - 11 - 9) / 2 * 0 = 0
      { t: 3, o: 10, h: 11, l: 9, c: 10.5, v: 0 },
      // volume == 0 over a zero numerator: 0 / 2 * 0 = 0
      { t: 4, o: 10, h: 11, l: 9, c: 10, v: 0 },
    ]
    for (const opts of [undefined, pane]) {
      const { tree, formula } = treeOf(V6('plot(ta.iii)'), opts)
      expect(formula).toBe('(2 * close - high - low) / (high - low) * volume')
      const ours = Array.from(interpret(tree, bars))
      expect(Math.abs(ours[0] / 15091971.428571 - 1), String(ours[0])).toBeLessThan(1e-9)
      expect(Math.abs(ours[0] / ((2.28 / 7) * 46335000) - 1), String(ours[0])).toBeLessThan(1e-12)
      expect(ours.slice(1).map((x) => (Number.isFinite(x) ? x : null)), JSON.stringify(ours)).toEqual([null, 0, 0])
      // and the reference, independently, says the same of all four bars
      same(fin(ours), fin(bars.map(iii)), 1e-12)
      // the v4 bare spelling and v5 are the same tree
      expect(treeOf(V(4, 'plot(iii)'), opts).formula).toBe(formula)
      expect(treeOf(V(5, 'plot(ta.iii)'), opts).formula).toBe(formula)
    }
  })
  it('⭐ e99 VENDOR: TradingView\'s own ta.iii, rows of the builtin4 witness captures (SPY and RDDT 1D), v6 / v5 / v4 alike', () => {
    // [time, open, high, low, close, volume, TradingView's ta.iii]; null = TradingView's `na`
    const rows = [
      // builtin4-witness-spy-spy-1d-2026-11-26: bars 0-2, 1052 (high == low: TradingView's one `na`), 8514
      [728317800, 43.9688, 43.96899, 43.75, 43.938, 1003200, 719267.6925887401],
      [728577000, 43.96875, 44.25, 43.96875, 44.25, 480500, 480500],
      [728663400, 44.21875, 44.375, 44.125, 44.34375, 201300, 150975],
      [859818600, 75.6875, 75.6875, 75.6875, 75.6875, 4270699, null],
      [1795617000, 703.2, 718.43, 695.45, 716.7, 73112796, 62104516.010444425],
      // builtin4-witness-rddt-rddt-1d-2026-11-26: bars 0-2, 673
      [1711027800, 47, 57.8, 45.05, 50.44, 48705533, -7525482.353725486],
      [1711114200, 48.88, 51, 45.34, 46, 15983139, -12255622.484098958],
      [1711373400, 47.09, 61.9399, 46.08, 59.8, 24398838, 17814802.358388122],
      [1795617000, 87.895, 92.3, 84.6, 91.51, 4196762, 3335608.238961048],
    ]
    const bars = rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    const want = rows.map((r) => r[6])
    let graded = 0
    for (const src of [V6('plot(ta.iii)'), V(5, 'plot(ta.iii)'), V(4, 'plot(iii)')]) {
      for (const opts of [undefined, pane]) {
        const ours = Array.from(interpret(treeOf(src, opts).tree, bars)).map((x) => (Number.isFinite(x) ? x : null))
        expect(ours.map((x) => x === null)).toEqual(want.map((x) => x === null))
        ours.forEach((x, i) => {
          if (x === null) return
          expect(Math.abs(x - want[i]) / Math.max(1, Math.abs(want[i])), `row ${i}`).toBeLessThan(1e-12)
          graded += 1
        })
      }
    }
    expect(graded).toBe(6 * 8)
    // ⛔ and the dividing body (the W1 re-review's) is wrong on every one of these finite rows
    rows.forEach((r, i) => {
      if (r[6] === null) return
      const div = (2 * r[4] - r[2] - r[3]) / ((r[2] - r[3]) * r[5])
      expect(Math.abs(div - r[6]) / Math.max(1, Math.abs(r[6])), `row ${i}`).toBeGreaterThan(1e-3)
    })
  })
  it('pinned history, not a witness: PyneCore\'s export fixture iii+nvi+obv.csv (rows 1-3) divides, and today\'s builtin does not', () => {
    // github.com/PyneSys/pynecore @ fe29d4a4c5, tests/t01_lib/t20_ta/data/iii+nvi+obv.csv: a TradingView chart-data
    // export by its format, its column the v5+ name `ta.iii` (so not a v4 export). Its values are the DIVIDING body's;
    // TradingView's v6 builtin today (the witness rows above) multiplies. Held so neither fact drifts unseen.
    const rows = [
      [1.06994, 1.06994, 1.06912, 1.06918, 100, -0.008536585365854584],
      [1.06918, 1.06925, 1.06664, 1.06789, 824, -0.00005114756537591343],
      [1.06789, 1.06837, 1.06628, 1.06785, 5684, 0.0000883871119805718],
    ]
    const bars = rows.map(([o, h, l, c, v], i) => ({ t: i + 1, o, h, l, c, v }))
    same(bars.map((b) => (2 * b.c - b.h - b.l) / ((b.h - b.l) * b.v)), rows.map((r) => r[5]), 1e-12)
    const ours = Array.from(interpret(treeOf(V6('plot(ta.iii)')).tree, bars))
    same(ours, bars.map(iii), 1e-12)
    ours.forEach((x, i) => expect(Math.abs(x - rows[i][5])).toBeGreaterThan(1e-3))
  })
  it('v4 bare spellings are TradingView\'s; v6 bare spellings are refused by name', () => {
    expect(treeOf(V(4, 'plot(iii)')).formula).toBe(treeOf(V6('plot(ta.iii)')).formula)
    expect(treeOf(V(4, 'plot(wvad)')).formula).toBe(treeOf(V6('plot(ta.wvad)')).formula)
    expect(refusalOf(V6('plot(iii)')).guard).toBe('pine:function')
    expect(refusalOf(V6('plot(wvad)')).guard).toBe('pine:function')
  })
  it('a script\'s own `iii` binding is theirs', () => {
    expect(treeOf(V6(['iii = close * 2', 'plot(iii)'].join(NL))).formula).toBe('close * 2')
  })
})

describe('ta.wad — REFERENCE: ta.cum(mom > 0 ? close - min(low, close[1]) : mom < 0 ? close - max(high, close[1]) : 0)', () => {
  const refWad = (bars) => {
    // Pine: `na > 0` and `na < 0` are false, so a bar whose momentum is unknown adds 0
    let total = 0
    return bars.map((b, i) => {
      const prev = i === 0 ? NaN : bars[i - 1].c
      const mom = b.c - prev
      const gain = mom > 0 ? b.c - Math.min(b.l, prev) : mom < 0 ? b.c - Math.max(b.h, prev) : 0
      total += gain
      return total
    })
  }
  it('every bar of 1,500, holes included: bar 0 is 0, and a hole adds nothing', () => {
    const { tree } = treeOf(V6('plot(ta.wad)'), pane)
    const ours = interpret(tree, holedBars)
    expect(same(ours, refWad(holedBars), 1e-11)).toBe(1500)
    expect(ours[0]).toBe(0)
  })
  it('a SCREEN keeps the cum ruling: the level moves with the fetch', () => {
    expect(refusalOf(V6('plot(ta.wad)'))).not.toBeNull()
  })
})

// ─── ta.cmo / ta.cog ─────────────────────────────────────────────────────────

/** Pine's math.sum as TradingView answers it — the vendor-pinned rule `interpret.js`
 *  records for `sum` (`NA.SKIP`, "380 ok / 0 bad"): the sum of the last `n` KNOWN
 *  values, `na` until `n` known values exist. An `na` bar is skipped, not summed.
 *  Written here as a plain loop, not imported. */
const refSum = (xs, n) => xs.map((_, i) => {
  let s = 0
  let k = 0
  for (let j = i; j >= 0 && k < n; j--) if (Number.isFinite(xs[j])) { s += xs[j]; k += 1 }
  return k < n ? NaN : s
})

describe('ta.cmo — REFERENCE: TradingView\'s f_cmo, 100 * (sm1 - sm2) / (sm1 + sm2)', () => {
  const refCmo = (xs, n) => {
    const mom = xs.map((x, i) => (i === 0 ? NaN : x - xs[i - 1]))
    // bar 0's momentum is the warm-up `na`: `na >= 0` is false in Pine, so it adds 0.0 to sm1 and
    // na to sm2, and the first value lands on bar n. On a source with no gap that is the only `na`,
    // and a warm-up gives the same values whether the `na` is read literally or ignored.
    const sm1 = refSum(mom.map((m) => (m >= 0 ? m : 0)), n)
    const sm2 = refSum(mom.map((m) => (m >= 0 ? 0 : -m)), n)
    return sm1.map((a, i) => 100 * (a - sm2[i]) / (a + sm2[i]))
  }
  // ⛔ W1 FIX (coordinator ruling, 2026-11-02): this rail no longer holds the literal body over a
  // HOLED source as the reference. What TradingView draws on an `na` after the source's first value
  // is not known (its v5/v6 remark says the `na` is ignored; PyneCore answers `na`; the literal body
  // draws), so such a source is refused by name below, and the reference is asserted on bars with
  // no gap, where every reading agrees.
  it('every bar of a source with no gap; the first value lands on bar n (bar 0\'s change is na)', () => {
    for (const n of [5, 14]) {
      for (const opts of [undefined, pane]) {
        const ours = interpret(treeOf(V6(`plot(ta.cmo(close, ${n}))`), opts).tree, BARS)
        expect(same(ours, refCmo(BARS.map((b) => b.c), n), 1e-12)).toBe(1500 - n)
        expect(Number.isFinite(ours[n - 1])).toBe(false)
        expect(Number.isFinite(ours[n])).toBe(true)
      }
    }
  })
  it('every price the bar holds, and Pine\'s means of them, is a source with no gap: served, equal to the reference', () => {
    const PRICE = {
      open: (b) => b.o,
      high: (b) => b.h,
      low: (b) => b.l,
      hl2: (b) => (b.h + b.l) / 2,
      hlc3: (b) => (b.h + b.l + b.c) / 3,
      ohlc4: (b) => (b.o + b.h + b.l + b.c) / 4,
      hlcc4: (b) => (b.h + b.l + b.c + b.c) / 4,
    }
    for (const [name, at] of Object.entries(PRICE)) {
      for (const opts of [undefined, pane]) {
        const ours = interpret(treeOf(V6(`plot(ta.cmo(${name}, 9))`), opts).tree, BARS)
        expect(same(ours, refCmo(BARS.map(at), 9), 1e-12), name).toBe(1500 - 9)
      }
    }
    // an `input.source` left at a bar price IS that price
    expect(treeOf(V6(['src = input.source(close, "Source")', 'plot(ta.cmo(src, 9))'].join(NL))).formula)
      .toBe(treeOf(V6('plot(ta.cmo(close, 9))')).formula)
    // a number is never `na`, so it passes this gate (the column it gives is one number on every
    // bar, and it meets that rule instead). It is also what the runtime lane's history probe asks
    // with (`pineRuntimeFrontend.js::callHeadStateful` replaces every argument by `2`): rail
    // `runtime/__tests__/w1BareConditionalHistory.test.js`
    expect(refusalOf(V6('plot(ta.cmo(2, 2))')).guard).toBe('pine:constant-only')
  })
  it('⛔ a source that can be `na` after its first value is REFUSED BY NAME, on a screen and on a pane', () => {
    // capture rows E04/E05 (docs/pine/capture-queue-2026-11-02-w1.md) are what would lift this
    const gappyLines = ['gappy = bar_index % 50 == 25 ? na : close'] // row E04's own source
    const cases = [
      V6([...gappyLines, 'plot(ta.cmo(gappy, 9))'].join(NL)),
      V6('plot(ta.cmo(close > open ? close : na, 9))'),
      // no gap in fact, but the rule is a whitelist: a computed source is refused, never guessed at
      V6('plot(ta.cmo(ta.sma(close, 5), 9))'),
      V6('plot(ta.cmo(close - open, 9))'),
      V6('plot(ta.cmo(close[1], 9))'),
      // `volume` is not a price the bar must hold: a bar may carry none
      V6('plot(ta.cmo(volume, 9))'),
      V(4, [...gappyLines, 'plot(cmo(gappy, 9))'].join(NL)),
    ]
    for (const source of cases) {
      for (const opts of [undefined, pane]) {
        const r = refusalOf(source, opts)
        expect(r && r.guard, source).toBe('pine:arity')
        expect(r.message, source).toMatch(/was given a source that can be `na` on a bar after its first value/)
        expect(r.message, source).toMatch(/TO UNBLOCK: give it one of those/)
      }
    }
    // the way forward is spelled the way the script spells the name
    expect(refusalOf(V(4, 'plot(cmo(close > open ? close : na, 9))')).message).toMatch(/`cmo\(close, 14\)`/)
    expect(refusalOf(V6('plot(ta.cmo(close > open ? close : na, 9))')).message).toMatch(/`ta\.cmo\(close, 14\)`/)
    // …and on the runtime pane, which asks the same Resolver, while a bar price still builds there
    const runtimePane = (source) => buildRuntimeIr(source, { bars: [], inputs: {}, pane: true })
    for (const source of [cases[0], cases[1], cases[6]]) {
      const b = runtimePane(source)
      expect(b.ok, source).toBe(false)
      expect(b.refusal.guard, source).toBe('pine:arity')
      expect(b.refusal.message, source).toMatch(/was given a source that can be `na` on a bar after its first value/)
    }
    expect(runtimePane(V6('plot(ta.cmo(close, 9))')).ok).toBe(true)
  })
  it('an input length is folded and recorded as a window, not left a member knob', () => {
    const t = translatePine(V6(['len = input.int(9, "Len")', 'plot(ta.cmo(close, len))'].join(NL)),
      { declareInputs: 'all' })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    const out = t.outputs[t.selected]
    expect(out.formula).toMatch(/sum\(.*, 9\)/)
    // ⛔ recorded before the fold erased it: the member door refuses the knob by name
    const len = (out.inputsFolded || []).find((e) => e.name === 'len')
    expect(len && len.windowBound).toBe(true)
  })
  it('a length this engine cannot read is refused by name; v6 bare `cmo` is not Pine', () => {
    expect(refusalOf(V6('plot(ta.cmo(close, bar_index % 5 + 1))')).guard).toBe('pine:window')
    expect(refusalOf(V6('plot(ta.cmo(close))')).guard).toBe('pine:arity')
    expect(refusalOf(V6('plot(cmo(close, 5))')).guard).toBe('pine:function')
    expect(treeOf(V(4, 'plot(cmo(close, 5))')).formula).toBe(treeOf(V6('plot(ta.cmo(close, 5))')).formula)
  })
})

describe('ta.cog — REFERENCE: TradingView\'s pine_cog, -Σ source[i]·(i+1) / math.sum(source, length)', () => {
  const refCog = (xs, n) => {
    const sums = refSum(xs, n)
    return xs.map((_, i) => {
      if (i < n - 1) return NaN
      let num = 0.0
      for (let k = 0; k < n; k++) num = num + xs[i - k] * (k + 1)
      return -num / sums[i]
    })
  }
  it('every bar, holes included; warm-up of length - 1 bars', () => {
    for (const n of [1, 10]) {
      const ours = interpret(treeOf(V6(`plot(ta.cog(close, ${n}))`)).tree, holedBars)
      same(ours, refCog(holedBars.map((b) => b.c), n), 1e-14)
      if (n > 1) expect(Number.isFinite(ours[n - 2])).toBe(false)
      expect(Number.isFinite(ours[n - 1])).toBe(true)
    }
  })
  it('⛔ the NODE BUDGET decides the longest window: the edge is exactly where budget.js refuses, and it is refused HERE by name', () => {
    const cap = DEFAULT_BUDGET.maxNodes
    const over = new RegExp(`exceeds the node budget — this formula measures (\\d+) and the cap is ${cap}`)
    const edges = {}
    // a compound source costs units of its own, so the edge moves with it: the budget
    // decides, never a number of the expansion's own
    for (const src of ['close', 'hl2', 'ta.sma(close, 5)']) {
      let edge = 0
      for (let n = 20; n <= 40 && refusalOf(V6(`plot(ta.cog(${src}, ${n}))`)) === null; n += 1) edge = n
      expect(edge, src).toBeGreaterThanOrEqual(20)
      edges[src] = edge
      for (const opts of [undefined, pane]) {
        // the longest window that translates passes the budget's own check…
        expect(checkBudget(treeOf(V6(`plot(ta.cog(${src}, ${edge}))`), opts).tree).ok, `${src} @ ${edge}`).toBe(true)
        // …and one bar more is refused at the translator, in the budget's own words, measured
        // past the cap: never translated for the budget to refuse downstream
        const r = refusalOf(V6(`plot(ta.cog(${src}, ${edge + 1}))`), opts)
        expect(r && r.guard, src).toBe('pine:budget')
        const m = over.exec(r.message)
        expect(m, r.message).not.toBeNull()
        expect(Number(m[1])).toBeGreaterThan(cap)
      }
    }
    // `ta.cog(close, n)` is 4n units: n reads of `close`, n − 1 weights, n − 1 products, n − 1
    // sums, and the negation, `math.sum` and the division (its length is the last weight)
    expect(edges.close).toBe(cap / 4)
    expect(edges['ta.sma(close, 5)']).toBeLessThan(edges.close)
  })
  it('⛔ a window past the cap itself is never built, and is refused by name without a measurement', () => {
    const cap = DEFAULT_BUDGET.maxNodes
    const close = { type: 'series', name: 'close' }
    expect(BUILTIN_CALL_TREE.cog([close, { type: 'num', value: cap + 1 }])).toBeNull()
    expect(BUILTIN_CALL_TREE.cog([close, { type: 'num', value: cap }])).not.toBeNull()
    for (const n of [cap + 1, 5000]) {
      const r = refusalOf(V6(`plot(ta.cog(close, ${n}))`))
      expect(r.guard).toBe('pine:budget')
      expect(r.message).toContain(`a window of ${n} bars is ${n} terms before anything else is counted, and the cap is ${cap}`)
    }
    // TradingView's own example length (the only one the corpus writes) still translates
    expect(refusalOf(V6('plot(ta.cog(close, 10))'))).toBeNull()
  })
  it('every cap is the budget\'s: a source reaching back past the lookback cap is refused the same way', () => {
    const cap = DEFAULT_BUDGET.maxLookback
    const r = refusalOf(V6(`plot(ta.cog(ta.sma(close, ${cap + 50}), 5))`), pane)
    expect(r && r.guard).toBe('pine:budget')
    expect(r.message).toMatch(new RegExp(`exceeds the lookback budget — this formula measures \\d+ and the cap is ${cap}`))
    // well inside the cap, the same shape translates and its tree passes the budget's own check
    expect(checkBudget(treeOf(V6(`plot(ta.cog(ta.sma(close, ${cap - 50}), 5))`), pane).tree).ok).toBe(true)
  })
})

// ─── v1–v4 bare `barssince(cond)` ────────────────────────────────────────────

describe('a v4 script\'s bare one-argument barssince(cond) is Pine\'s unbounded barssince', () => {
  const refSince = (cond) => {
    let last = -1
    return cond.map((c, i) => { if (c) last = i; return last < 0 ? NaN : i - last })
  }
  it('on a pane it is exactly ta.barssince(cond): the same tree, the same unbounded count', () => {
    const v4 = treeOf(V(4, 'plot(barssince(close > open))'), pane)
    expect(v4.formula).toBe(treeOf(V6('plot(ta.barssince(close > open))'), pane).formula)
    const cond = BARS.map((_, i) => i > 3 && i < 500 && i % 13 === 0)
    const bars = BARS.map((b, i) => ({ ...b, o: cond[i] ? b.c - 1 : b.c + 1 }))
    const ours = interpret(v4.tree, bars, undefined, undefined, undefined, { barIndexFromFirstBar: true })
    expect(same(ours, refSince(cond), 0)).toBe(1500 - 13)
    expect(ours[1499]).toBe(1499 - 494)
  })
  it('the corpus shape `barssince(not c) >= n + 1` translates on a pane (v4)', () => {
    const src = V(4, ['n = input(3)', 'c = close > open', 'plot(barssince(not c) >= (n + 1) ? 1 : 0)'].join(NL))
    expect(refusalOf(src, pane)).toBeNull()
  })
  it('a screen meets ta.barssince\'s own refusal, never the table\'s "add a number" arity sentence', () => {
    const r = refusalOf(V(4, 'plot(barssince(close > open))'))
    expect(r.guard).toBe('pine:function')
    expect(r.message).not.toMatch(/this table takes 2/)
  })
  it('from v5 the bare one-argument spelling is not Pine and stays refused; two arguments are the table\'s', () => {
    expect(refusalOf(V6('plot(barssince(close > open))'), pane)).not.toBeNull()
    expect(treeOf(V(4, 'plot(barssince(close > open, 10))'), pane).formula).toBe('barssince(close > open, 10)')
  })
})
