// app/src/components/chart/engine/ast/pine.batch1VendorBacked.test.js
//
// ─── VENDOR-BACKED UNSERVED BUILTINS — BATCH 1 ───────────────────────────────
//
// `ta.falling`, `ta.kcw` and the `ta.pvt` windowed-delta rewrite, each resolved
// by a REAL TradingView capture rather than documentation alone (see
// `tests/fixtures/vendor/observations/ta-{falling-close3,kcw-close20-2,
// pvt-delta5}-2026-09-06.json`). This file proves the TRANSLATION shape and the
// FORMULA identity; `tests/test_vendor_parity_batch1.py` proves dual-kernel
// conformance and the vendor-parity comparison against the real captured
// numbers, mirroring `pine.contextBounded.test.js`'s split for `ta.obv`.
//
// ⛔ `ta.cmf` and `ta.accdist` are deliberately NOT here as implementations:
// `ta.cmf` is not real Pine syntax (confirmed twice — a live compile error and
// its absence from the full v5 reference manual text) and refuses as an
// unrecognised name, never a "ruled" function; `ta.accdist`'s bare LEVEL is
// refused with the same reasoning `ta.obv`'s ruling carries, and no bounded
// primitive is declared for it because the one corpus script that needs it is
// EMA-based, a shape no windowed delta can serve. Both are asserted below as
// regression protection for those two rulings.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { parseFormula } from './parse.js'
import { interpret, FN, BAR_FN } from './interpret.js'

const S = (body) => `//@version=6\nindicator("s")\nplot(${body})\n`

function translate(body) {
  const out = translatePine(S(body))
  if (!out.ok) return { refused: out.refusal.guard, message: String(out.refusal.message) }
  return { formula: out.outputs[out.selected].formula }
}

const run = (formula, rows) => interpret(parseFormula(formula).ast, rows)

/** Deterministic real-shaped bars: enough up/down alternation (and a genuine
 *  3-bar losing streak, unlike `pine.contextBounded.test.js`'s own `bars()`,
 *  which — like the vendor oracle's synthetic pattern — never falls three bars
 *  running) to exercise `falling`/`pvtN`/`kcw` meaningfully. */
function bars(n = 40) {
  const out = []
  let c = 100
  for (let i = 0; i < n; i++) {
    const step = [1.5, -0.75, -0.5, -0.25, 2.25, -1.5, 0.5][i % 7]
    const prev = c
    c = Math.round((c + step) * 100) / 100
    out.push({
      t: 1700000000 + i * 86400,
      o: prev, h: Math.max(prev, c) + 0.5, l: Math.min(prev, c) - 0.5, c,
      v: 1000 + ((i * 37) % 500),
    })
  }
  return out
}

describe('ta.falling — translates and mirrors ta.rising exactly', () => {
  it('translates the bare call', () => {
    expect(translate('ta.falling(close, 3)').formula).toBe('falling(close, 3)')
  })

  it('FN.falling is the structural mirror of FN.rising, with < in place of >', () => {
    expect(Array.from(FN.falling([5, 4, 3, 2, 1], 3))).toEqual([NaN, NaN, NaN, 1, 1])
    expect(Array.from(FN.falling([1, 2, 3, 4, 5], 3))).toEqual([NaN, NaN, NaN, 0, 0])
    // a tie (no strict decrease) is NOT falling, same convention as rising
    expect(Array.from(FN.falling([5, 5, 4, 3], 3))).toEqual([NaN, NaN, NaN, 0])
  })

  it('⭐⭐ MUTATION: a running-minimum reading is a DIFFERENT function, and the '
    + 'real vendor capture proves it — see falling_real_candRunningMin vs '
    + 'falling_real_builtin at 2026-08-20 in the observation fixture', () => {
    // A 3-bar losing streak that is ALSO a new running low: both readings agree.
    const monotoneOnly = [10, 9, 8, 7] // strictly falling AND a new low every step
    const runningMinOnly = [10, 9, 11, 8] // NOT a 3-bar losing streak (9->11 breaks
    // it), but 8 is still below both prior lows (9, 11) — running-min says TRUE,
    // strict-monotone says FALSE. This is the discriminating shape the real
    // capture found on 2026-08-20.
    const wrongRunningMin = (series, lo, hi) => {
      for (let i = lo + 1; i <= hi; i++) if (series[i] >= series[i - 1]) return null
      return null // never used directly; real check is the min-comparison below
    }
    void wrongRunningMin
    const realFalling = Array.from(FN.falling(runningMinOnly, 3))
    const wrongCandidate = runningMinOnly[3] < Math.min(runningMinOnly[0], runningMinOnly[1], runningMinOnly[2])
    expect(realFalling[3]).toBe(0) // strict monotone: FALSE (9 -> 11 rose)
    expect(wrongCandidate).toBe(true) // running-minimum: TRUE — a real disagreement
  })
})

describe('ta.kcw — a RATIO composed from already-declared primitives', () => {
  it('defaults useTrueRange to true and composes ema(tr)/ema(src)', () => {
    const o = translate('ta.kcw(close, 20, 2)')
    const tr = 'max(high - low, max(abs(high - close[1]), abs(low - close[1])))'
    expect(o.formula).toBe(`2 * (2 * ema(${tr}, 20)) / ema(close, 20)`)
  })

  it('useTrueRange=false uses high-low instead of tr', () => {
    const o = translate('ta.kcw(close, 20, 2, false)')
    expect(o.formula).toBe('2 * (2 * ema(high - low, 20)) / ema(close, 20)')
  })

  it('⛔ never the percent form — that is a different, wrong constant', () => {
    const ratio = translate('ta.kcw(close, 20, 2)').formula
    const percent = translate('ta.kcw(close, 20, 2) * 100').formula
    expect(percent).not.toBe(ratio)
    expect(percent).toBe(`${ratio} * 100`)
  })

  it('refuses a bad arity rather than building a malformed tree', () => {
    expect(translate('ta.kcw(close)').refused).toBe('pine:arity')
    expect(translate('ta.kcw(close, 20, 2, false, 1)').refused).toBe('pine:arity')
  })

  it('a non-literal useTrueRange flag declines to the ordinary refusal', () => {
    // `flag` has to be a literal 1/0 to be read statically — a series argument
    // falls through rather than being guessed at.
    const o = translate('ta.kcw(close, 20, 2, close > open)')
    expect(o.refused).toBeDefined()
  })
})

describe('ta.pvt — the windowed delta, reached only through the bounding comparison', () => {
  it('⭐ every spelling rewrites to pvtN, mirroring obvN exactly', () => {
    expect(translate('ta.pvt > ta.pvt[10]').formula).toBe('pvtN(10) > 0')
    expect(translate('ta.pvt < ta.pvt[5]').formula).toBe('pvtN(5) < 0')
    expect(translate('ta.pvt - ta.pvt[3] > 0').formula).toBe('pvtN(3) > 0')
  })

  it('⭐⭐ this is the literal blind-corpus shape: pvtRising = ta.pvt > ta.pvt[10]', () => {
    const o = translatePine(
      '//@version=6\nindicator("s")\npvtRising = ta.pvt > ta.pvt[10]\nplot(pvtRising ? 1 : 0)\n',
    )
    expect(o.ok, o.ok ? '' : o.refusal.message).toBe(true)
    expect(o.outputs[o.selected].formula).toBe('pvtN(10) > 0 ? 1 : 0')
  })

  it('pvtN is declared in BAR_FN, mirroring obvN', () => {
    expect(typeof BAR_FN.pvtN).toBe('function')
  })

  it('⛔ the unbounded name is still refused, and it gets the table ruling', () => {
    const bare = translate('ta.pvt')
    expect(bare.refused).toBe('pine:function')
    expect(bare.message).toContain('THE SAME SHAPE AS `obv`')
  })

  it('⛔ a pvt difference against a NON-pvt term is not a difference at all', () => {
    expect(translate('ta.pvt > close').refused).toBe('pine:function')
    expect(translate('ta.pvt > close[1]').refused).toBe('pine:function')
  })

  it('⭐⭐ the identity, MEASURED against a reference computed here', () => {
    const rows = bars()
    // TradingView's own published f_pvt() source, computed independently of
    // `computePVT` — if this drifted from the shipped implementation the
    // comparison below would fail, which is the property the rewrite rests on.
    const level = [0]
    for (let i = 1; i < rows.length; i++) {
      const prevClose = rows[i - 1].c
      const term = prevClose ? ((rows[i].c - prevClose) / prevClose) * rows[i].v : 0
      level.push(level[i - 1] + term)
    }
    let compared = 0
    for (const k of [3, 5, 10]) {
      const got = run(`pvtN(${k})`, rows)
      for (let i = 0; i < rows.length; i++) {
        const v = typeof got[i] === 'number' ? got[i] : (got[i] && got[i].value)
        if (!Number.isFinite(v)) continue
        expect(v, `pvtN(${k}) at bar ${i}`).toBeCloseTo(level[i] - level[i - k], 6)
        compared += 1
      }
    }
    expect(compared).toBeGreaterThan(60)
  })

  it('⭐⭐ MUTATION: a wrong previous-close reference must disagree', () => {
    // The obvious wrong candidate: dividing by THIS bar's close instead of the
    // PRIOR bar's — a plausible off-by-one a member could actually make.
    const rows = bars()
    const correct = [0]
    const wrong = [0]
    for (let i = 1; i < rows.length; i++) {
      const prevClose = rows[i - 1].c
      correct.push(correct[i - 1] + (prevClose ? ((rows[i].c - prevClose) / prevClose) * rows[i].v : 0))
      const thisClose = rows[i].c
      wrong.push(wrong[i - 1] + (thisClose ? ((rows[i].c - prevClose) / thisClose) * rows[i].v : 0))
    }
    const got = Array.from(run('pvtN(5)', rows))
    let disagreements = 0
    let matches = 0
    for (let i = 5; i < rows.length; i++) {
      const v = typeof got[i] === 'number' ? got[i] : (got[i] && got[i].value)
      if (!Number.isFinite(v)) continue
      const correctDelta = correct[i] - correct[i - 5]
      const wrongDelta = wrong[i] - wrong[i - 5]
      expect(v).toBeCloseTo(correctDelta, 6)
      if (Math.abs(v - wrongDelta) > 1e-6) disagreements += 1
      matches += 1
    }
    expect(matches).toBeGreaterThan(10)
    // ⛔ NON-VACUITY: the wrong candidate must actually diverge somewhere, or
    // this mutation control proves nothing.
    expect(disagreements).toBeGreaterThan(0)
  })
})

describe('⛔ ta.cmf and ta.accdist — regression protection for the two rulings', () => {
  it('ta.cmf refuses as an UNRECOGNISED name, never a ruled function — it is '
    + 'not real Pine syntax (confirmed by a live compile error and its absence '
    + 'from the full v5 reference manual text)', () => {
    const r = translate('ta.cmf(21)')
    expect(r.refused).toBe('pine:function')
    expect(r.message).not.toContain('this table has RULED on that name')
  })

  it('ta.accdist bare refuses with the ruled OBV-shaped message', () => {
    const r = translate('ta.accdist')
    expect(r.refused).toBe('pine:function')
    expect(r.message).toContain('THE SAME SHAPE AS `obv` AND `pvt`')
  })

  it('⛔ no accdistN rewrite exists — a windowed accdist comparison still refuses', () => {
    expect(translate('ta.accdist > ta.accdist[5]').refused).toBe('pine:function')
  })
})
