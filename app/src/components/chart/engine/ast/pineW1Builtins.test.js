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

import { translatePine } from './pine'
import { parseFormula } from './parse'
import { interpret } from './interpret'

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

describe('ta.iii, ta.wvad — REFERENCE: TradingView\'s per-bar bodies; a screen may read them', () => {
  const iii = (b) => ((2 * b.c - b.h - b.l) / (b.h - b.l)) * b.v
  const wvad = (b) => ((b.c - b.o) / (b.h - b.l)) * b.v
  it('every bar, holes included (a hole in close is a hole in both)', () => {
    const fin = (xs) => xs.map((x) => (Number.isFinite(x) ? x : NaN))
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
    // `na >= 0` is false in Pine: an unknown momentum adds 0.0 to sm1 and na to sm2
    const sm1 = refSum(mom.map((m) => (m >= 0 ? m : 0)), n)
    const sm2 = refSum(mom.map((m) => (m >= 0 ? 0 : -m)), n)
    return sm1.map((a, i) => 100 * (a - sm2[i]) / (a + sm2[i]))
  }
  it('every bar, holes included; the first value lands on bar n (bar 0\'s change is na)', () => {
    for (const n of [5, 14]) {
      for (const opts of [undefined, pane]) {
        const ours = interpret(treeOf(V6(`plot(ta.cmo(close, ${n}))`), opts).tree, holedBars)
        same(ours, refCmo(holedBars.map((b) => b.c), n), 1e-12)
        expect(Number.isFinite(ours[n - 1])).toBe(false)
        expect(Number.isFinite(ours[n])).toBe(true)
      }
    }
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
  it('a window longer than the unroll cap is refused by name, not built', () => {
    const r = refusalOf(V6('plot(ta.cog(close, 201))'))
    expect(r.guard).toBe('pine:window')
    expect(r.message).toMatch(/at most 200/)
    expect(refusalOf(V6('plot(ta.cog(close, 200))'))).toBeNull()
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
