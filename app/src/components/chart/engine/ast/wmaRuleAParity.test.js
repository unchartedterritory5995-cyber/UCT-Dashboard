// app/src/components/chart/engine/ast/wmaRuleAParity.test.js
//
// ─── ⭐⭐ H7 (step 92) — `ta.wma`'s WARM-UP IS RULE A, IN BOTH HOST LANES ─────────
//
// CAP4 Q-RT8a (`vw-rt8-runtime-followups-rddt-1d-2026-10-04`, NYSE:RDDT 1D from the
// listing) measured it: `ta.wma(src, 10)` over a source finite on bars 0-2, `na` on
// 3-19 and finite from 20 first answers on bar 26 — its 10th FINITE input (W01);
// over bar 0 then `na` to 49 it first answers on bar 58 (W03); and `ta.ema(…, 5)` of
// W01 first answers on bar 30 (W02). The host lanes' FFILL window used to count a
// carried slot as an input and answered from bars 20 and 50.
//
// `interpret.js::rolling` and `ast_interpret._rolling` both count the finite inputs
// now. This file and `tests/test_ast_wma_rule_a_parity.py` read ONE fixture
// (`tests/fixtures/ast/wma_rule_a_parity.json`), so a lane that drifts fails against
// the other lane's own output, never against a number retyped there.
//
// To regenerate after a deliberate change (from `app/`):
//   WMA_RULE_A_PARITY_WRITE=1 npx vitest run src/components/chart/engine/ast/wmaRuleAParity.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { interpret } from './interpret.js'

const FIXTURE = '../tests/fixtures/ast/wma_rule_a_parity.json'
const WRITE = process.env.WMA_RULE_A_PARITY_WRITE === '1'

const num = (value) => ({ type: 'num', value })
const NA = { type: 'op', name: '/', args: [num(0), num(0)] }
const close = { type: 'series', name: 'close' }
/** `close > 50 ? close : na` — the bars below put a hole wherever close is 1. */
const gated = { type: 'op', name: '?:', args: [{ type: 'op', name: '>', args: [close, num(50)] }, close, NA] }
const wma = (src, n) => ({ type: 'call', name: 'wma', args: [src, num(n)] })
const ema = (src, n) => ({ type: 'call', name: 'ema', args: [src, num(n)] })

/** `n` daily bars whose close is 1 (a hole once gated) where `hole(i)`, else a
 *  wavy price above 50. */
function bars(n, hole) {
  const out = []
  const d = new Date(Date.UTC(2024, 2, 21))
  for (let i = 0; i < n; i += 1) {
    const c = hole(i) ? 1 : 100 + Math.sin(i / 3) * 4 + i * 0.25
    out.push({ t: d.toISOString().slice(0, 10), o: c, h: c + 1, l: c - 1, c, v: 1000 + i })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

const BARS = {
  // W01: finite 0-2, na 3-19, finite from 20
  gapAfter3: bars(90, (i) => i >= 3 && i < 20),
  // W03: finite on bar 0, na 1-49, finite from 50
  bar0ThenGap: bars(90, (i) => i >= 1 && i < 50),
  // control: no hole at all — rule A and the old rule agree (first on bar 9)
  noHole: bars(90, () => false),
}
const CASES = [
  { name: 'W01 · wma 10 · gap after 3', bars: 'gapAfter3', ast: wma(gated, 10), first: 26 },
  { name: 'W02 · ema 5 of wma 10 · gap after 3', bars: 'gapAfter3', ast: ema(wma(gated, 10), 5), first: 30 },
  { name: 'W03 · wma 10 · bar 0 then gap', bars: 'bar0ThenGap', ast: wma(gated, 10), first: 58 },
  { name: 'control · wma 10 · no hole', bars: 'noHole', ast: wma(gated, 10), first: 9 },
]

const col = (ast, b) => Array.from(interpret(ast, b, {}, undefined, undefined, {}))
const asJson = (xs) => xs.map((x) => (Number.isFinite(x) ? x : null))

describe('⭐⭐ H7 — ta.wma rule A: the first answer is the n-th FINITE input (CAP4 Q-RT8a)', () => {
  for (const c of CASES) {
    it(`${c.name}: first answers on bar ${c.first}`, () => {
      const out = col(c.ast, BARS[c.bars])
      expect(out.findIndex((x) => Number.isFinite(x))).toBe(c.first)
    })
  }
  it('a hole on the CURRENT bar is still na once warmed (the other half of the FFILL rule)', () => {
    const b = bars(60, (i) => (i >= 3 && i < 20) || i === 40)
    const out = col(wma(gated, 10), b)
    expect(Number.isFinite(out[39])).toBe(true)
    expect(Number.isFinite(out[40])).toBe(false)
    expect(Number.isFinite(out[41])).toBe(true)
  })

  it('the parity fixture is the JS lane\'s own output (the Python lane reads it)', () => {
    const doc = {
      _: 'H7 (step 92) — ta.wma rule A. Written by app/src/components/chart/engine/ast/wmaRuleAParity.test.js, read by tests/test_ast_wma_rule_a_parity.py. Never edit by hand.',
      bars: BARS,
      cases: CASES.map((c) => ({ name: c.name, bars: c.bars, ast: c.ast, first: c.first, expected: asJson(col(c.ast, BARS[c.bars])) })),
    }
    if (WRITE) writeFileSync(FIXTURE, `${JSON.stringify(doc, null, 1)}\n`)
    const disk = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    expect(disk.cases.map((c) => c.name)).toEqual(doc.cases.map((c) => c.name))
    for (const [i, c] of doc.cases.entries()) {
      const want = disk.cases[i].expected
      expect(c.expected.length).toBe(want.length)
      c.expected.forEach((v, k) => {
        if (want[k] === null) expect(v, `${c.name} bar ${k}`).toBe(null)
        else expect(Math.abs(v - want[k]), `${c.name} bar ${k}`).toBeLessThan(1e-9)
      })
    }
  })
})
