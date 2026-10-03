// ─── ⭐⭐ H1 — A HELPER'S OWN RECURRENCE: `x = init` / `x := f(x[1])` inside a function ─
//
// Every QQE, PMax and range filter writes its trailing state inside a helper:
//
//     rngfilt(x, r) =>
//         rngfilt = x
//         rngfilt := x > nz(rngfilt[1]) ? … : …
//         rngfilt
//
// At the top level the same three lines build an `accum` (the plain self-reference
// path); inside a function they refused `pine:state` — "`rngfilt[1]` reads what
// `rngfilt` held on an earlier bar, and this script reassigns it" — because the
// resolver found a binding's LAST WORD only through the top-level name map.
// H1 finds a function-local's last word by IDENTITY (`Resolver.finalLocalOf`), so:
//
//   1. a helper's recurrence is the SAME tree as the identical top-level one;
//   2. a helper called at two sites builds TWO columns (no name-keyed memo between
//      call sites);
//   3. a read of the name AFTER its last `:=` (by another local) is the column a
//      bar back, never the other local's binding;
//   4. a top-level name the helper shadows is never confused with it.
import { describe, it, expect } from 'vitest'
import { translatePine, printFormula } from './pine.js'
import { interpret } from './interpret.js'

const N = 600
const CLOSE = Array.from({ length: N }, (_, i) => 100 + 10 * Math.sin(i / 7) + 3 * Math.sin(i / 2.1) + i * 0.04)
const BARS = CLOSE.map((c, i) => ({ t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 }))
const pine = (lines) => ['//@version=5', 'indicator("h1-local")', ...lines].join('\n')
const formulas = (src) => {
  const t = translatePine(src)
  if (!t.ok) throw new Error(`refused: ${JSON.stringify(t.refusal).slice(0, 300)}`)
  return (t.outputs || []).filter((o) => o.ast).map((o) => printFormula(o.ast))
}
const columns = (src) => {
  const t = translatePine(src)
  if (!t.ok) throw new Error(`refused: ${JSON.stringify(t.refusal).slice(0, 300)}`)
  return (t.outputs || []).filter((o) => o.ast).map((o) => Array.from(interpret(o.ast, BARS, {})))
}

const STOP_BODY = (name, band) => [
  `${name} = ${band}`,
  `${name}1 = nz(${name}[1], ${name})`,
  `${name} := close[1] > ${name}1 ? math.max(${name}, ${name}1) : ${name}`,
]

describe('H1 — a function-local recurrence', () => {
  it('⭐ is the SAME tree as the identical top-level recurrence', () => {
    const top = formulas(pine([...STOP_BODY('up', 'close - 2'), 'plot(up)']))
    const local = formulas(pine([
      'stop(src) =>',
      ...STOP_BODY('up', 'src - 2').map((l) => `    ${l}`),
      '    up',
      'plot(stop(close))',
    ]))
    expect(local).toEqual(top)
    expect(local[0].startsWith('accum(')).toBe(true)
  })

  it('⭐ two call sites build two columns, never one memoised under the name', () => {
    const src = pine([
      'stop(src, k) =>',
      ...STOP_BODY('up', 'src - k').map((l) => `    ${l}`),
      '    up',
      'plot(stop(close, 2))',
      'plot(stop(close, 5))',
    ])
    const [a, b] = formulas(src)
    expect(a).not.toEqual(b)
    expect(a).toContain('close - 2')
    expect(b).toContain('close - 5')
    const [ca, cb] = columns(src)
    const differ = ca.some((v, i) => Number.isFinite(v) && Number.isFinite(cb[i]) && v !== cb[i])
    expect(differ).toBe(true)
  })

  it('⭐ a read after the last `:=` is the column a bar back — not another local\'s binding', () => {
    // the QQE shape: `trend` reads `band[1]` AFTER `band`'s final assignment
    const src = pine([
      'qqe(src) =>',
      ...STOP_BODY('band', 'src - 2').map((l) => `    ${l}`),
      '    trend = 0',
      '    trend := close > band[1] ? 1 : -1',
      '    trend',
      'plot(qqe(close))',
    ])
    const [f] = formulas(src)
    expect(f).toContain('accum(')
    expect(f).toContain('[1]')
  })

  it('⭐ a top-level name the helper shadows stays the top-level one', () => {
    const src = pine([
      ...STOP_BODY('up', 'close - 9'),
      'stop(src) =>',
      ...STOP_BODY('up', 'src - 2').map((l) => `    ${l}`),
      '    up',
      'plot(up)',
      'plot(stop(close))',
    ])
    const [outer, inner] = formulas(src)
    expect(outer).toContain('close - 9')
    expect(outer).not.toContain('close - 2')
    expect(inner).toContain('close - 2')
    expect(inner).not.toContain('close - 9')
  })

  it('⭐ ANOTHER local reading `x[1]` ABOVE the last `:=` reads the column a bar back', () => {
    // the trend-targets shape: `prevUpper = nz(upper[1])` sits between the
    // declaration and the reassignment, and something other than the update reads it
    const src = pine([
      'bands(src) =>',
      '    upper = src + 2',
      '    prevUpper = nz(upper[1])',
      '    flag = close > prevUpper ? 1 : 0',
      '    upper := upper < prevUpper or close[1] > prevUpper ? upper : prevUpper',
      '    flag',
      'plot(bands(close))',
    ])
    const [f] = formulas(src)
    expect(f).toContain('accum(')
    expect(f).toContain('[1]')
    // it is Pine's own value: the flag compares close with the band a bar back
    const ref = []
    let prev = NaN
    for (let i = 0; i < N; i++) {
      const p = Number.isNaN(prev) ? 0 : prev
      ref.push(CLOSE[i] > p ? 1 : 0)
      const up = CLOSE[i] + 2
      prev = up < p || (i > 0 && CLOSE[i - 1] > p) ? up : p
    }
    // past the 250-bar window's own curtain (the chart withholds the bars before a
    // tree's lookback; `interpret` alone does not)
    const [col] = columns(src)
    let decided = 0
    col.forEach((v, i) => { if (i >= 260 && Number.isFinite(v)) { decided += 1; expect(v, `bar ${i}`).toBe(ref[i]) } })
    expect(decided).toBeGreaterThan(300)
  })

  it('⭐ …and a TOP-LEVEL read of a shadowed name above its own `:=` stays the top-level column', () => {
    const src = pine([
      'up = close - 9',
      'z = nz(up[1])',
      'up := close[1] > nz(up[1], up) ? math.max(up, nz(up[1], up)) : up',
      'stop(src) =>',
      ...STOP_BODY('up', 'src - 2').map((l) => `    ${l}`),
      '    up',
      'plot(z)',
      'plot(stop(close))',
    ])
    const [outer, inner] = formulas(src)
    expect(outer).toContain('close - 9')
    expect(outer).not.toContain('close - 2')
    expect(inner).toContain('close - 2')
  })

  it('⛔ a helper local that reassigns WITHOUT reading its past is unchanged — no recurrence', () => {
    const [f] = formulas(pine([
      'g(src) =>',
      '    x = src',
      '    x := x * 2',
      '    x',
      'plot(g(close))',
    ]))
    expect(f).toBe('close * 2')
  })
})
