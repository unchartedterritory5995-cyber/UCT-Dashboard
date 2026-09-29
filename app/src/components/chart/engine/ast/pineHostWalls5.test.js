// app/src/components/chart/engine/ast/pineHostWalls5.test.js
//
// ─── ⭐⭐ HOST WALLS 5 — three first-blockers of the member door, 2026-09-28 ───
//
// Measured with `partialDrawing.census.measure.test.js` (PARTIAL_CENSUS=1) over
// the 266 committed scripts: member door 35 → 39 attached (objects flag off),
// 58 → 62 (flag on). Each section below is one Pine rule, with hand-derived
// expected columns and a control that goes red if the rule is stubbed.
//
// 1. A v1–v4 bare `valuewhen(cond, src, occurrence)` IS Pine's occurrence
//    function (v5 moved it under `ta.` unchanged) — it used to meet
//    `pine:role-order` against the house bar-window `valuewhen`.
// 2. A function body whose LAST statement is a declaration returns what it
//    declares (`get_y(m, b, ts) => Y = m * ts + b`), and a body whose last
//    statement is NOT a value refuses instead of returning an EARLIER
//    statement's value (a wrong answer this door used to give).
// 3. A `switch` STATEMENT whose arms reassign (`"close" => ret := close`) on a
//    subject the script fixes.
//
// The vendor-backed half (trendlines, a v4 script built on 1 and 2) is
// `trendlinesLegacy.vendor.test.js`.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'

const HEAD = {
  3: '//@version=3\nstudy("t")\n',
  4: '//@version=4\nstudy("t")\n',
  5: '//@version=5\nindicator("t")\n',
  6: '//@version=6\nindicator("t")\n',
  none: '',
}
const tr = (v, body) => translatePine(`${HEAD[v]}${body}\n`, { strict: true })
const formulaOf = (t, k = null) => {
  expect(t.refusal, t.refusal && t.refusal.message).toBe(null)
  const o = t.outputs[k === null ? t.selected : k]
  expect(o.refusal, o.refusal && o.refusal.message).toBeFalsy()
  return o.formula
}
const NL = String.fromCharCode(10)
const refusalOf = (t) => t.refusal || (t.outputs || []).map((o) => o.refusal).find(Boolean) || null
const col = (f, bars) => Array.from(interpret(parseFormula(f).ast, bars, {}))
const same = (a, b) => a.length === b.length
  && a.every((x, i) => (Number.isNaN(x) ? Number.isNaN(b[i]) : x === b[i]))

/** close > open on bars 0, 2, 4 — so the condition is true every other bar. */
const VW_BARS = [
  { t: 20260101, o: 1, h: 9, l: 0, c: 2, v: 1 },
  { t: 20260102, o: 5, h: 9, l: 0, c: 3, v: 1 },
  { t: 20260105, o: 1, h: 9, l: 0, c: 4, v: 1 },
  { t: 20260106, o: 9, h: 9, l: 0, c: 5, v: 1 },
  { t: 20260107, o: 1, h: 9, l: 0, c: 6, v: 1 },
  { t: 20260108, o: 9, h: 9, l: 0, c: 7, v: 1 },
]
// Hand-derived, Pine's `valuewhen(cond, src, occurrence)`:
//   occurrence 0 = close on the most recent true bar  → 2,2,4,4,6,6
//   occurrence 1 = close on the one before that        → na,na,2,2,4,4
const OCC0 = [2, 2, 4, 4, 6, 6]
const OCC1 = [NaN, NaN, 2, 2, 4, 4]

describe('1 · a v1–v4 bare valuewhen is Pine\'s occurrence function', () => {
  it('⭐⭐ v4 `valuewhen(c, src, 0)` and `(…, 1)` count occurrences back — hand-derived', () => {
    const f0 = formulaOf(tr(4, 'plot(valuewhen(close > open, close, 0))'))
    const f1 = formulaOf(tr(4, 'plot(valuewhen(close > open, close, 1))'))
    expect(f0).toBe('valuewhenOccurrence(close > open, close, 0)')
    expect(f1).toBe('valuewhenOccurrence(close > open, close, 1)')
    expect(col(f0, VW_BARS)).toEqual(OCC0)
    expect(same(col(f1, VW_BARS), OCC1)).toBe(true)
  })

  it('⭐ v3 routes the same way (the bare spelling is Pine\'s on every version before v5)', () => {
    expect(formulaOf(tr(3, 'plot(valuewhen(close > open, close, 0))')))
      .toBe('valuewhenOccurrence(close > open, close, 0)')
  })

  it('⛔⛔ CONTROL: the HOUSE bar-window valuewhen answers differently on the same bars', () => {
    // The house `valuewhen(cond, src, n)` reads `n` as a BAR WINDOW. At `1` it
    // answers only on the true bar itself (2,na,4,na,6,na); Pine's occurrence 1
    // is the PREVIOUS true bar's close. A redirect onto the wrong function is
    // therefore visible on every bar of this fixture. (At `0` the house function
    // refuses outright — a window must be at least 1 bar.)
    const house = col('valuewhen(close > open, close, 1)', VW_BARS)
    expect(same(house, OCC1)).toBe(false)
    expect(same(col('valuewhenOccurrence(close > open, close, 1)', VW_BARS), OCC1)).toBe(true)
  })

  it('⛔ v5, v6 and a versionless script keep the house meaning — and still refuse by role order', () => {
    for (const v of [5, 6, 'none']) {
      const r = refusalOf(tr(v, 'plot(valuewhen(close > open, close, 0))'))
      expect(r && (r.guard || r.code), `v=${v}`).toBe('pine:role-order')
    }
  })

  it('⭐ the v4 condition is a bool context: a NUMERIC condition takes the implicit cast', () => {
    expect(formulaOf(tr(4, 'plot(valuewhen(close - open, close, 0))')))
      .toBe('valuewhenOccurrence(close - open != 0, close, 0)')
  })

  it('⭐ the v4 script this was found on translates both levels', () => {
    const t = tr(4, [
      'hih = pivothigh(high, 10, 10)',
      'top = valuewhen(hih, high[10], 0)',
      'plot(top)',
    ].join('\n'))
    expect(formulaOf(t)).toBe('valuewhenOccurrence(pivothigh(high, 10, 10)[10] != 0, high[10], 0)')
  })
})

describe('2 · a function body returns its LAST statement', () => {
  const BARS = [
    { t: 20260101, o: 1, h: 3, l: 0, c: 1, v: 1 },
    { t: 20260102, o: 1, h: 3, l: 0, c: 2, v: 1 },
    { t: 20260105, o: 1, h: 3, l: 0, c: 5, v: 1 },
  ]

  it('⭐⭐ a trailing declaration is the return value (v4 `get_y`, the trendlines helper)', () => {
    const f = formulaOf(tr(4, 'get_y(m, b, ts)=>\n    Y = m * ts + b\n\nplot(get_y(2, 1, close))'))
    expect(f).toBe('2 * close + 1')
    // hand-derived: 2*1+1, 2*2+1, 2*5+1
    expect(col(f, BARS)).toEqual([3, 5, 11])
  })

  it('⭐ a TYPED trailing declaration too, and a chain of locals ending in one', () => {
    expect(formulaOf(tr(5, 'f(x) =>\n    float y = x * 3\nplot(f(close))'))).toBe('close * 3')
    const f = formulaOf(tr(5, 'f(x) =>\n    a = x + 1\n    b = a * 2\nplot(f(close))'))
    expect(f).toBe('(close + 1) * 2')
    expect(col(f, BARS)).toEqual([4, 6, 12])
  })

  it('⛔⛔ DISCRIMINATOR: a bare expression EARLIER does not win over the trailing declaration', () => {
    // Pine returns `y` (the last statement). Before this change the door
    // returned `x + 100` — the last BARE expression — a wrong column that attached.
    const f = formulaOf(tr(5, 'f(x) =>\n    x + 100\n    y = x * 2\nplot(f(close))'))
    expect(f).toBe('close * 2')
    expect(col(f, BARS)).toEqual([2, 4, 10])
    expect(col(f, BARS)).not.toEqual(col('close + 100', BARS))
  })

  it('⛔⛔ a trailing REASSIGNMENT after an earlier bare expression refuses — never the stale value', () => {
    const r = refusalOf(tr(5, 'f(x) =>\n    y = x * 2\n    x + 100\n    y := y + 1\nplot(f(close))'))
    expect(r && (r.guard || r.code)).toBe('pine:function-def')
    expect(r.message).toMatch(/LAST statement/)
  })

  it('⛔ a trailing `if` with no value after an earlier bare expression refuses too', () => {
    const r = refusalOf(tr(5, 'f(x) =>\n    y = x * 2\n    x + 100\n    if x > 1\n        y := 5\nplot(f(close))'))
    expect(r && (r.guard || r.code)).toBe('pine:function-def')
  })

  it('⛔ a trailing self-history reassignment still refuses (the history lane\'s, not this)', () => {
    const r = refusalOf(tr(5, 'f(x) =>\n    y = 0.0\n    y := nz(y[1]) + x\nplot(f(close))'))
    expect(r).not.toBe(null)
    expect(r.guard || r.code).toBe('pine:function-def')
  })

  it('⛔ a trailing `var` declaration is not served as a plain value', () => {
    const r = refusalOf(tr(5, 'f(x) =>\n    var y = x\nplot(f(close))'))
    expect(r && (r.guard || r.code)).toBe('pine:function-def')
  })

  it('⭐ a body ending in a bare expression is unchanged', () => {
    expect(formulaOf(tr(5, 'f(x) =>\n    y = x * 2\n    y + 1\nplot(f(close))'))).toBe('close * 2 + 1')
  })
})

describe('3 · a switch STATEMENT whose arms reassign, on a fixed subject', () => {
  const BARS = [
    { t: 20260101, o: 10, h: 14, l: 8, c: 12, v: 1 },
    { t: 20260102, o: 11, h: 15, l: 9, c: 13, v: 1 },
  ]
  const script = (mode, { withDefault = true } = {}) => [
    `mode = input.string("${mode}", "Mode")`,
    'band(isUpper) =>',
    '    ret = close',
    '    switch mode',
    '        "close" => ret := close',
    '        "wicks" => ret := isUpper ? high : low',
    ...(withDefault ? ['        => ret := open'] : []),
    '    ret',
    'plot(band(true), "U")',
    'plot(band(false), "L")',
  ].join('\n')

  it('⭐⭐ the matching arm runs, per call (the atr-bands shape) — hand-derived columns', () => {
    const t = tr(5, script('wicks'))
    expect(col(formulaOf(t, 0), BARS)).toEqual([14, 15]) // high
    expect(col(formulaOf(t, 1), BARS)).toEqual([8, 9])   // low
    const c = tr(5, script('close'))
    expect(col(formulaOf(c, 0), BARS)).toEqual([12, 13])
    expect(col(formulaOf(c, 1), BARS)).toEqual([12, 13])
  })

  it('⭐ no label matches → the default arm runs', () => {
    const t = tr(5, script('nothing'))
    expect(col(formulaOf(t, 0), BARS)).toEqual([10, 11]) // open
  })

  it('⛔⛔ no label matches and NO default → nothing runs, the name keeps its prior value', () => {
    // Pine: an unmatched switch STATEMENT with no default executes no arm, so
    // `ret` is still `close`. (The VALUE form's no-match is `na`, which this
    // door refuses to invent — a different rule, left alone.)
    const t = tr(5, script('nothing', { withDefault: false }))
    expect(col(formulaOf(t, 0), BARS)).toEqual([12, 13])
  })

  it('⭐ the FIRST matching arm wins', () => {
    const t = tr(5, [
      'mode = input.string("a", "Mode")',
      'f() =>',
      '    r = close',
      '    switch mode',
      '        "a" => r := high',
      '        "a" => r := low',
      '    r',
      'plot(f())',
    ].join('\n'))
    expect(col(formulaOf(t), BARS)).toEqual([14, 15])
  })

  it('⭐ an arm may reassign several names, and an arm that skips one leaves it alone', () => {
    const t = tr(5, [
      'mode = input.string("b", "Mode")',
      'f() =>',
      '    p = 1',
      '    q = 2',
      '    switch mode',
      '        "a" => p := 10, q := 20',
      '        "b" => p := 30',
      '    p * 100 + q',
      'plot(f())',
    ].join('\n'))
    // "b": p = 30, q untouched = 2 → 3002 on every bar
    const f = formulaOf(t, 0)
    expect(f).toBe('30 * 100 + 2')
    expect(col(f, BARS)).toEqual([3002, 3002])
    // …and "a" takes BOTH assignments of its arm
    expect(formulaOf(tr(5, [
      'mode = input.string("a", "Mode")',
      'f() =>',
      '    p = 1',
      '    q = 2',
      '    switch mode',
      '        "a" => p := 10, q := 20',
      '        "b" => p := 30',
      '    p * 100 + q',
      'plot(f())',
    ].join(NL)), 0)).toBe('10 * 100 + 20')
  })

  it('⛔ a subject that moves bar to bar still refuses (every arm would have to exist at once)', () => {
    const r = refusalOf(tr(5, [
      'f() =>',
      '    r = close',
      '    switch close > open ? "a" : "b"',
      '        "a" => r := high',
      '        "b" => r := low',
      '    r',
      'plot(f())',
    ].join('\n')))
    expect(r && (r.guard || r.code)).toBe('pine:block')
  })

  it('⛔ shapes outside the statement form are unchanged (a compound `+=` arm)', () => {
    const r = refusalOf(tr(5, [
      'mode = input.string("a", "Mode")',
      'f() =>',
      '    r = close',
      '    switch mode',
      '        "a" => r += 1',
      '    r',
      'plot(f())',
    ].join('\n')))
    expect(r && (r.guard || r.code)).toBe('pine:statement')
  })

  it('⛔⛔ CONTROL: the statement form equals the same choice written as a ternary', () => {
    // An independent spelling of the identical Pine decision. If the switch
    // picked the wrong arm, ignored `isUpper`, or fell through to the prior
    // value, this column would differ.
    for (const mode of ['close', 'wicks', 'nothing']) {
      const tern = tr(5, [
        `mode = input.string("${mode}", "Mode")`,
        'band(isUpper) =>',
        '    mode == "close" ? close : mode == "wicks" ? (isUpper ? high : low) : open',
        'plot(band(true), "U")',
        'plot(band(false), "L")',
      ].join(NL))
      const stmt = tr(5, script(mode))
      for (const k of [0, 1]) {
        expect(col(formulaOf(stmt, k), BARS), `${mode}/${k}`).toEqual(col(formulaOf(tern, k), BARS))
      }
    }
  })
})
