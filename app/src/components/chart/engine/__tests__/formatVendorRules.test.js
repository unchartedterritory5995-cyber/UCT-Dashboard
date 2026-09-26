// app/src/components/chart/engine/__tests__/formatVendorRules.test.js
//
// ─── ⭐⭐ WHAT A NUMBER LOOKS LIKE AS TEXT AT TRADINGVIEW ────────────────────
//
// A table cell's text is member-visible output on the objects-only pane, so a
// formatting difference is a visible difference on every row of every table.
//
// ⭐ `pineTableVendorParity.test.js` already compares whole cells character for
// character for ONE real member script. This file is the other half: the
// GENERIC rules, captured from a probe rather than from a script, so a rule
// holds for every future script instead of for the one that happened to be
// measured.
//
// ⭐⭐ STRINGS CANNOT BE PLOTTED, so each reading is a numeric PROPERTY of the
// rendered string — its length, or where its decimal point falls. Those
// discriminate precision, trailing zeros, sign, scientific notation and the
// `na` spelling without needing any string transport out of the chart.
//
// ⛔ AND THE DEMAND IS MEASURED, not assumed. Over the 266-script committed
// corpus (comment-stripped): `str.tostring` 1,127 uses in 102 scripts, its
// TWO-ARGUMENT form 637 uses in 70, `table.cell` 671 in 61, `label.new` 799 in
// 130. This is not a corner of the language.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildObjectLane } from '../runtime/objectLane.js'

const FIX = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), '../tests/fixtures/vendor/w3-format-spy-1d-2026-09-22.json'), 'utf8'))

const L = FIX.last_bar

describe('⛔ the fixture is the one this file was written against', () => {
  it('names its probe, its symbol and enough rows to be a series', () => {
    expect(FIX._probe).toBe('tools/visual_conformance/probes/w3-format.pine')
    expect(FIX._symbol).toBe('SPY')
    expect(FIX._rows).toBeGreaterThan(200)
  })

  it('⛔ CONTROL — the readings are STABLE across the series, not one lucky bar', () => {
    // A formatting rule read off a single bar could be an artifact of that
    // bar's magnitude. These four are magnitude-independent by construction,
    // so they must be identical on every row the vendor answered.
    for (const col of ['F05_len_of_na_THE_SPELLING', 'F08_len_true_IS_IT_4',
      'F09_len_negative_SIGN_COUNTED', 'F11_len_two_point_zero_TRAILING']) {
      const vals = new Set(FIX.rows.map((r) => r[col]).filter((v) => v !== null))
      expect(vals.size, `${col} varies across bars: ${[...vals]}`).toBe(1)
    }
  })
})

describe('⭐⭐ the rules, each one a reading rather than a belief', () => {
  it('⭐⭐ TRAILING ZEROS ARE DROPPED — `str.tostring(2.0)` is ONE character', () => {
    // "2", not "2.0". This is the rule most likely to make a whole column of a
    // table differ from TradingView while every number in it is correct.
    expect(L.F11_len_two_point_zero_TRAILING).toBe(1)
  })

  it('⭐⭐ and the same on a real price — 773.5 renders in 5 chars, not 6', () => {
    // The symbol's own display precision is 2, so "773.50" would be 6. It is 5,
    // with the decimal point at 0-based index 3 — so `str.tostring` does NOT
    // follow the symbol's precision.
    expect(L.close).toBe(773.5)
    expect(L.F01_len_close_DEFAULT_PRECISION).toBe(5)
    expect(L.F02_decimal_POSITION_in_close).toBe(3)
  })

  it('⭐⭐ AN UNFORMATTED DIVISION GETS TEN DECIMALS — `1/3` is 12 characters', () => {
    // "0." plus ten digits. ⛔ This is the one to watch when implementing:
    // JavaScript's own `String(1/3)` is "0.3333333333333333" — EIGHTEEN
    // characters — so a renderer that falls through to `String(n)` disagrees
    // with TradingView on every unformatted ratio a member puts in a cell.
    expect(L.F04_len_one_third_HOW_MANY_DIGITS).toBe(12)
    expect(String(1 / 3).length).toBe(18)
  })

  it('⭐ `na` spells NaN, and a bool spells true', () => {
    expect(L.F05_len_of_na_THE_SPELLING).toBe(3)
    expect(L.F08_len_true_IS_IT_4).toBe(4)
  })

  it('⭐⭐ NO SCIENTIFIC NOTATION at either end of the range measured', () => {
    // 1000000 -> "1000000" (7), 0.000001 -> "0.000001" (8). JavaScript agrees at
    // both of these points and switches to an exponent at 1e21 and 1e-7, so the
    // BOUNDARY is unmeasured and is deliberately not asserted here.
    expect(L.F06_len_million_SCIENTIFIC_OR_NOT).toBe(7)
    expect(L.F07_len_millionth_SCIENTIFIC_OR_NOT).toBe(8)
  })

  it('⭐ the sign is counted, and a large integer carries no decimals', () => {
    expect(L.F09_len_negative_SIGN_COUNTED).toBe(4)
    expect(L.F10_len_volume_LARGE_INTEGERS).toBe(String(Math.trunc(L.volume)).length)
  })
})

describe('⭐ what this engine can and cannot express, measured on the product path', () => {
  const H = '//@version=6\nindicator("t", overlay = true)\n'
  const cell = (expr) => {
    const src = `${H}var t = table.new(position.top_right, 1, 1)\n`
      + `if barstate.islast\n    table.cell(t, 0, 0, ${expr})\n`
    const r = buildObjectLane(src, { tf: 'D', newestBarIsForming: false })
    return r.ok ? 'OK' : `refused ${(r.refusal && r.refusal.guard) || '?'}`
  }

  it('⭐⭐ BOTH `str.tostring` FORMS ARE SERVED — including the two-argument one', () => {
    // ⚰️ Recorded because the opposite was briefly believed and written down:
    // a probe measuring these through `plot(str.length(...))` refused every
    // reading, and the common factor was `str.length`, NOT `str.tostring`. The
    // 637 two-argument uses in 70 corpus scripts are NOT blocked.
    expect(cell('str.tostring(close)')).toBe('OK')
    expect(cell('str.tostring(close, "#.##")')).toBe('OK')
    expect(cell('str.tostring(close, "0.00")')).toBe('OK')
  })

  it('⛔ `str.format` IS NOT — and its refusal is pinned by name', () => {
    // 100 uses in 20 corpus scripts. The vendor's answer for the same call is
    // already captured (F12), so this becomes an ordinary parity assertion the
    // day the refusal stops firing.
    expect(cell('str.format("{0,number,#.##}", close)')).toContain('pine:builtin')
    expect(FIX.last_bar.F12_len_str_format).toBe(5)
  })
})
