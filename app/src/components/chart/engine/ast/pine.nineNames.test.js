// app/src/components/chart/engine/ast/pine.nineNames.test.js
//
// ─── ⭐⭐ ITEM 8: WHAT THE 2026-09-11 CAPTURE BOUGHT, AND WHAT IT DID NOT ────
//
// `math.pi`, `math.ceil`, `math.floor` and `year` were four of item 8's nine
// names. The capture answered all four; only ONE of them is pinned here, and the
// gap is deliberate and priced.
//
//     TradingView, AMEX:SPY 1D, 400 bars, 2026-09-11:
//       math.pi          3.141592653589793  on every bar
//       math.ceil(-2.5)  -2     math.ceil(2.5)   3
//       math.floor(-2.5) -3     math.floor(2.5)  2
//       hour             9  on a bar stamped 09:30 ET / 13:30 UTC
//
// ⭐⭐ THE `floor` READ IS THE ONLY ONE THAT DISCRIMINATES. Toward-zero and
// toward-±∞ AGREE that ceil(-2.5) is -2; they disagree about floor(-2.5), which
// is -2 under toward-zero and -3 here. So the pair is pinned from ONE reading
// rather than from two agreeing ones — and this file asserts that asymmetry
// rather than treating the two as symmetric evidence.
//
// ⛔⛔ AND `ceil`/`floor` ARE NOT IN THE TABLE, ON PURPOSE. Declaring them as bar
// functions was built and BACKED OUT the same hour: `test_ast_scalars.py::
// test_the_scalar_floor_is_ITS_OWN_and_folding_it_in_ABORTS_the_recorder` and
// `test_ast_interpret.py::test_ast_table_SPELLS_NO_TABLE_NAME…` went red BY NAME,
// which is those gates working — a new BAR name owes a corpus case, and adding
// one moves every frozen per-ast digest and re-freezes a cross-lane oracle. That
// is a priced, focused pass, not a side effect of a capture. The MEASUREMENT is
// banked; the pin is routed.
//
// Capture: `tests/fixtures/vendor/r11-nine-safe-spy-1d-2026-09-11.json`.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { translatePine, PINE_MATH_CONSTANTS } from './pine.js'
import TABLE from './closedTable.json'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..', '..', '..', '..')
const CAPTURE = path.join(REPO, 'tests', 'fixtures', 'vendor',
  'r11-nine-safe-spy-1d-2026-09-11.json')
const cap = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'))

const tr = (src, opts) =>
  translatePine(`//@version=6\nindicator("p", overlay=false)\n${src}\n`, opts || {})

describe('⭐ `math.pi` is PINNED, and it is a constant rather than a function', () => {
  for (const [mode, opts] of [['screener', {}], ['pane/strict', { strict: true }]]) {
    it(`resolves inside an expression — ${mode}`, () => {
      const out = tr('plot(close * math.pi)', opts)
      const r = out.refusals || []
      expect(r, r.length ? `${r[0].guard} \`${r[0].token}\`` : '').toEqual([])
      expect(out.ok).toBe(true)
    })
  }

  it('⭐⭐ it FOLDS TO A NUMBER, so it costs no table function', () => {
    expect(Object.keys(PINE_MATH_CONSTANTS)).toContain('math.pi')
    const tree = PINE_MATH_CONSTANTS['math.pi']()
    expect(tree.type).toBe('num')
    expect(tree.value).toBe(Math.PI)
    expect(TABLE.functions.pi, 'π must not have become a table function').toBeUndefined()
  })

  it('⛔ and it is NOT strict-gated, unlike the barstate constants', () => {
    // `BUILTIN_CONSTANT_TREE` is strict-gated because it folds `barstate.*`,
    // whose value depends on HOW THIS ENGINE FETCHED. π depends on nothing, so
    // folding it under one contract and refusing it under the other would be a
    // refusal with no reason behind it. Both modes are asserted above; this
    // pins the REASON by keeping it out of the gated table.
    const src = fs.readFileSync(path.join(HERE, 'pine.js'), 'utf8')
    const gated = src.slice(src.indexOf('BUILTIN_CONSTANT_TREE = Object.freeze({'))
    expect(gated.slice(0, gated.indexOf('})'))).not.toContain('math.pi')
  })

  it('⛔ `math.pi` ALONE is still refused, by the RIGHT guard', () => {
    // A script whose only plot is a constant is degenerate and was already
    // refused by name. Pinning π must not have weakened that — and the guard is
    // no longer `pine:function` ("maps to nothing the engine declares"), which
    // was a true sentence about FUNCTIONS asked of something that is not one.
    const r = tr('plot(math.pi)', { strict: true }).refusals || []
    expect(r.length).toBe(1)
    expect(r[0].guard).toBe('pine:constant-only')
    expect(r[0].guard).not.toBe('pine:function')
  })
})

describe('⛔⛔ `ceil` / `floor` are MEASURED and NOT PINNED — the price is the reason', () => {
  it('they still refuse, and the refusal is the honest one', () => {
    for (const src of ['plot(math.ceil(close))', 'plot(math.floor(close))']) {
      const r = tr(src, { strict: true }).refusals || []
      expect(r.length, src).toBe(1)
      expect(r[0].guard, src).toBe('pine:function')
    }
  })

  it('and the table does NOT declare them', () => {
    // ⛔ If this ever flips, the corpus cases and the re-frozen digests must have
    // landed WITH it — that is what the two red gates were asking for.
    expect(TABLE.functions.ceil).toBeUndefined()
    expect(TABLE.functions.floor).toBeUndefined()
  })

  it('⭐ but the reading is banked, and it is the discriminating one', () => {
    expect(cap.readings['math.ceil'].at_negative_2p5).toBe(-2)
    expect(cap.readings['math.floor'].at_negative_2p5).toBe(-3)
    expect(cap.readings['math.ceil'].at_positive_2p5).toBe(3)
    expect(cap.readings['math.floor'].at_positive_2p5).toBe(2)
    expect(cap.readings['math.floor'].verdict).toMatch(/toward -∞/)
  })

  it('⛔⛔ THE CONTROL — toward-zero differs on `floor` ONLY', () => {
    // This is the whole reason the capture was worth an add. If both names had
    // agreed under both rules, the reading would have proved nothing.
    const towardZero = (x) => (x < 0 ? Math.ceil(x) : Math.floor(x))
    expect(towardZero(-2.5)).toBe(cap.readings['math.ceil'].at_negative_2p5)   // agrees
    expect(towardZero(-2.5)).not.toBe(cap.readings['math.floor'].at_negative_2p5)
    // and the measured pair IS the native toward-±∞ pair, which is why the
    // implementation will need no hand-written correction the way `round` does
    expect(cap.readings['math.ceil'].at_negative_2p5).toBe(Math.ceil(-2.5))
    expect(cap.readings['math.floor'].at_negative_2p5).toBe(Math.floor(-2.5))
  })
})

describe('⭐ `year` needed no engine work at all', () => {
  it('the bare clock names already translate', () => {
    // `r11-remaining-nine.md` lists `year` among the nine as needing a vendor
    // read before it can be added. It is ALREADY SERVED — the closed table
    // declares it in its `clock` section and the Pine door binds it. What the
    // capture bought was the TIMEZONE, which the backlog correctly said was open.
    for (const name of ['year', 'month', 'dayofmonth', 'hour', 'minute']) {
      const out = tr(`plot(${name})`, { strict: true })
      expect(out.refusals || [], name).toEqual([])
      expect(out.ok, name).toBe(true)
      expect(Object.keys(TABLE.clock), name).toContain(name)
    }
  })

  it('⭐⭐ and the capture settles WHICH CLOCK, through `hour` rather than `year`', () => {
    const y = cap.readings.year
    // the daily bar stamped 09:30 ET is 13:30 UTC; `hour` read 9, not 13
    expect(y.lastBar.hour).toBe(9)
    expect(y.verdict).toMatch(/EXCHANGE/)
    // and `year` actually varies across the series, or it could not be tested
    expect(y.distinctYearsAcross400Bars.length).toBeGreaterThan(1)
  })
})
