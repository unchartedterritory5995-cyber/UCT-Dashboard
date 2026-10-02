// app/src/components/chart/engine/runtime/__tests__/colourComponents.test.js
//
// ─── ⭐⭐ C38 — A COLOUR'S COMPONENT IS A NUMBER, AND A NUMBER IS A COLUMN ──────
//
// `color.r(c)` / `.g` / `.b` (0-255) and `color.t(c)` (0-100) as a PLOTTED VALUE.
// A colour is still not a column (`pine:colour-value`); its four numbers are, for
// the colours `vw-gradient-spy-1d-2026-09-30` measured. The vendor's own bars are
// graded in `vendorHarness.c38ColourValue.test.js`; this file holds the two things
// that rail cannot say on its own:
//
//   1. `gradientChannelTree` is `fromGradient` — the SAME numbers, on a sweep far
//      denser than the capture's, for endpoints the capture does not use. The
//      formula exists twice (a function for the lanes that call one, a tree for
//      the lane that evaluates one) and this is what holds the two together.
//   2. Every colour the capture does NOT witness still refuses, by name.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../../ast/pine.js'
import { interpret } from '../../ast/interpret.js'
import { fromGradient, gradientChannelTree, hexToPacked, byteTransparency, GRADIENT_ZERO_COLOUR } from '../colours.js'
import { unpackColor } from '../../colorInt.js'

const HEAD = '//@version=6\nindicator("t")\n'
const host = (body) => translatePine(`${HEAD}${body}\n`, { strict: true })
const formula = (body) => {
  const t = host(body)
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  return t.outputs[t.selected].formula
}

/** `n` bars whose close sweeps `lo..hi` — the gradient's value column. */
const sweep = (lo, hi, n) => Array.from({ length: n }, (_, i) => {
  const c = lo + ((hi - lo) * i) / (n - 1)
  return { t: 1700000000 + i * 86400, o: c, h: c, l: c, c, v: 1 }
})
const VALUE = { type: 'series', name: 'close' }
// ⭐ C48 — `fromGradient` answers `null` where no capture reads a colour (a value
// outside REVERSED bounds); the tree answers `na` on exactly those bars.
const componentOf = (packed, channel) => {
  if (packed === null) return NaN
  const u = unpackColor(packed)
  return channel === 't' ? byteTransparency(u.transparencyByte) : u[channel]
}

describe('C38 — `gradientChannelTree` IS `fromGradient`, component for component', () => {
  const ENDS = [
    ['the capture\'s own (max-pain\'s legend colours)', hexToPacked('#0064C8', 70), hexToPacked('#FF3232', 70)],
    ['opaque → opaque', hexToPacked('#2962FF', 0), hexToPacked('#F23645', 0)],
    ['opaque → fully transparent', hexToPacked('#2962FF', 0), hexToPacked('#F23645', 100)],
    ['two transparencies the capture does not use', hexToPacked('#13A8C4', 13), hexToPacked('#E0B020', 87)],
    ['fully transparent → opaque', hexToPacked('#000000', 100), hexToPacked('#FFFFFF', 0)],
  ]
  const RANGES = [[0, 1], [-0.5, 2.5], [10, 250], [3, -3]]

  for (const [label, a, b] of ENDS) {
    it(`${label}: r, g, b and t agree on 2,001 points of every range, clamps included`, () => {
      let compared = 0
      let clamped = 0
      for (const [lo, hi] of RANGES) {
        const span = Math.abs(hi - lo)
        const bars = sweep(Math.min(lo, hi) - span * 0.25, Math.max(lo, hi) + span * 0.25, 2001)
        for (const channel of ['r', 'g', 'b', 't']) {
          const col = interpret(gradientChannelTree({ value: VALUE, lo, hi, a, b }, channel), bars, {})
          for (let i = 0; i < bars.length; i++) {
            const want = componentOf(fromGradient(bars[i].c, lo, hi, a, b), channel)
            if (!Object.is(col[i], want)) {
              throw new Error(`${label} ${channel} [${lo}, ${hi}] at ${bars[i].c}: tree ${col[i]}, fromGradient ${want}`)
            }
            compared++
          }
        }
        clamped += bars.filter((x) => (x.c - lo) / (hi - lo) < 0 || (x.c - lo) / (hi - lo) > 1).length
      }
      expect(compared).toBe(RANGES.length * 4 * 2001)
      expect(clamped).toBeGreaterThan(1000)
    })
  }

  // ⭐ C48 — the reversed range in `RANGES` ([3, −3]) is the BOTTOM colour between
  // its bounds and unanswered outside them (rows E04 / E05); it used to be the
  // mirrored blend in BOTH spellings, which is why the sweep above never saw it.
  it('⭐ C48 — reversed bounds: the bottom colour between them, `na` outside, in both spellings', () => {
    const a = hexToPacked('#0064C8', 70)
    const b = hexToPacked('#FF3232', 10)
    const bars = sweep(-5, 5, 201)
    for (const channel of ['r', 'g', 'b', 't']) {
      const col = interpret(gradientChannelTree({ value: VALUE, lo: 3, hi: -3, a, b }, channel), bars, {})
      const inside = bars.map((x, i) => (x.c >= -3 && x.c <= 3 ? col[i] : null)).filter((x) => x !== null)
      expect(new Set(inside), channel).toEqual(new Set([componentOf(a, channel)]))
      expect(bars.every((x, i) => (x.c >= -3 && x.c <= 3) || Number.isNaN(col[i])), channel).toBe(true)
    }
    expect(fromGradient(0, 3, -3, a, b)).toBe(a)
    expect(fromGradient(4, 3, -3, a, b)).toBeNull()
  })

  // ⭐ C48 re-pin — this read "an `na` value is an `na` component … unmeasured".
  // It is measured now (`vw-colour-components`, rows X03 / X04, and X01 / X02 /
  // E01–E03 for an `na` or equal pair of bounds): the zero colour.
  it('⭐ C48 — an `na` value, an `na` bound and equal bounds are the ZERO colour, in both spellings', () => {
    const a = hexToPacked('#0064C8', 70)
    const b = hexToPacked('#FF3232', 70)
    const bars = sweep(0, 1, 5).map((x, i) => (i === 2 ? { ...x, c: NaN } : x))
    for (const channel of ['r', 'g', 'b', 't']) {
      const zero = channel === 't' ? 100 : 0
      const col = interpret(gradientChannelTree({ value: VALUE, lo: 0, hi: 1, a, b }, channel), bars, {})
      expect(col[2], channel).toBe(zero)
      expect(col[1], channel).toBe(componentOf(fromGradient(bars[1].c, 0, 1, a, b), channel))
      for (const [lo, hi] of [[5, 5], [NaN, 1], [0, NaN]]) {
        const flat = interpret(gradientChannelTree({ value: VALUE, lo, hi, a, b }, channel), bars, {})
        expect(Array.from(flat), `${channel} [${lo}, ${hi}]`).toEqual([zero, zero, zero, zero, zero])
      }
    }
    expect(fromGradient(NaN, 0, 1, 1, 2)).toBe(GRADIENT_ZERO_COLOUR)
    expect(fromGradient(0.5, 5, 5, 1, 2)).toBe(GRADIENT_ZERO_COLOUR)
  })

  it('⭐ C48 — PER-BAR bounds: the tree is `fromGradient` on every bar, each case of it', () => {
    const a = hexToPacked('#0064C8', 70)
    const b = hexToPacked('#FF3232', 10)
    const LOW = { type: 'series', name: 'low' }
    const HIGH = { type: 'series', name: 'high' }
    // bounds in order, equal, reversed (the value inside and outside), and `na`
    const bars = []
    for (let i = 0; i < 400; i += 1) {
      const kind = i % 8
      const c = 100 + ((i * 37) % 61) / 3
      let l = c - 1 - (i % 5)
      let h = c + 1 + (i % 7) / 2
      if (kind === 3) h = l                       // equal
      if (kind === 4) { const x = l; l = h; h = x } // reversed, value between
      if (kind === 5) { l = c - 5; h = c - 9 }      // reversed, value above both
      if (kind === 6) l = NaN
      bars.push({ t: 1700000000 + i * 86400, o: c, h, l, c: kind === 7 ? NaN : c, v: 1 })
    }
    let compared = 0
    const cases = new Set()
    for (const channel of ['r', 'g', 'b', 't']) {
      const col = interpret(gradientChannelTree({ value: VALUE, lo: LOW, hi: HIGH, a, b }, channel), bars, {})
      bars.forEach((x, i) => {
        const packed = fromGradient(x.c, x.l, x.h, a, b)
        const want = componentOf(packed, channel)
        if (!Object.is(col[i], want)) throw new Error(`${channel} bar ${i} (${x.l}, ${x.h}) at ${x.c}: tree ${col[i]}, fromGradient ${want}`)
        cases.add(packed === null ? 'unanswered' : packed === GRADIENT_ZERO_COLOUR ? 'zero' : packed === a ? 'bottom' : 'blend')
        compared += 1
      })
    }
    expect(compared).toBe(1600)
    expect([...cases].sort()).toEqual(['blend', 'bottom', 'unanswered', 'zero'])
  })

  it('CONTROL — the comparison can fail: a tree for the WRONG end is caught', () => {
    const a = hexToPacked('#0064C8', 70)
    const b = hexToPacked('#FF3232', 70)
    const bars = sweep(0, 1, 101)
    const swapped = interpret(gradientChannelTree({ value: VALUE, lo: 0, hi: 1, a: b, b: a }, 'r'), bars, {})
    const differ = bars.filter((x, i) => swapped[i] !== unpackColor(fromGradient(x.c, 0, 1, a, b)).r).length
    expect(differ).toBeGreaterThan(90)
  })
})

describe('C38 — the translator: the witnessed colours are numbers', () => {
  it('a fixed colour folds to its component — names, literals, `color.rgb`, `color.new`', () => {
    expect(formula('plot(color.r(color.red) + close * 0)')).toBe('242 + close * 0')           // v6 `color.red` #F23645
    expect(formula('plot(color.b(#0064C8) + close * 0)')).toBe('200 + close * 0')
    expect(formula('plot(color.g(color.rgb(0, 100, 200, 70)) + close * 0)')).toBe('100 + close * 0')
    expect(formula('plot(color.t(color.rgb(0, 100, 200, 70)) + close * 0)')).toBe('70 + close * 0')
    expect(formula('plot(color.t(color.new(color.red, 70.5)) + close * 0)')).toBe('70 + close * 0')  // truncated (C29)
    expect(formula('plot(color.t(color.new(#0064C8, 70.4)) + close * 0)')).toBe('70 + close * 0')
    expect(formula('plot(color.t(color.blue) + close * 0)')).toBe('0 + close * 0')
  })

  it('a bound name is followed, as every colour reader in the file follows it', () => {
    expect(formula('cA = color.rgb(0, 100, 200, 70)\nn = color.new(cA, 30)\nplot(color.t(n) + close * 0)')).toBe('30 + close * 0')
    expect(formula('cA = color.rgb(0, 100, 200, 70)\nn = color.new(cA, 30)\nplot(color.b(n) + close * 0)')).toBe('200 + close * 0')
  })

  it('a gradient\'s component is `gradientChannelTree` over the script\'s own value', () => {
    const t = host('g = color.from_gradient(close, 10, 250, color.rgb(0, 100, 200, 70), color.rgb(255, 50, 50, 70))\nplot(color.g(g))')
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    const want = gradientChannelTree({ value: VALUE, lo: 10, hi: 250, a: hexToPacked('#0064C8', 70), b: hexToPacked('#FF3232', 70) }, 'g')
    expect(JSON.parse(JSON.stringify(t.outputs[t.selected].ast))).toEqual(want)
  })

  it('`color.new(<gradient>, t)`: the transparency is `t`, the three colour bytes are the gradient\'s', () => {
    const g = 'g = color.new(color.from_gradient(close, 0, 1, color.blue, color.red), 30)\n'
    expect(formula(`${g}plot(color.t(g) + close * 0)`)).toBe('30 + close * 0')
    const t = host(`${g}plot(color.r(g))`)
    const want = gradientChannelTree({ value: VALUE, lo: 0, hi: 1, a: hexToPacked('#2962FF', 0), b: hexToPacked('#F23645', 0) }, 'r')
    expect(JSON.parse(JSON.stringify(t.outputs[t.selected].ast))).toEqual(want)
  })
})

describe('C38 — every colour the capture does NOT witness still refuses `pine:colour-value`', () => {
  // ⭐ C48 re-pin — five entries left this list: an eight-digit literal, an
  // `input.color`, a ternary of colours, a gradient over a per-bar bound and one
  // over an empty range are rows of `vw-colour-components-spy-1d-2026-10-01` now,
  // graded 300 / 300 in `vendorHarness.c48ColourComponents`. The per-bar
  // transparency below stays: `close` is not provably within 0-100.
  const UNWITNESSED = {
    'a per-bar transparency': 'plot(color.t(color.new(color.red, close)))',
    'a gradient between gradients': 'g = color.from_gradient(close, 0, 1, color.blue, color.red)\nplot(color.r(color.from_gradient(open, 0, 1, g, color.red)))',
    '`color.new` twice over a gradient': 'plot(color.r(color.new(color.new(color.from_gradient(close, 0, 1, color.blue, color.red), 30), 40)))',
    'a transparency outside 0-100': 'plot(color.t(color.new(color.red, 140)))',
    'a user colour helper': 'f(c) => color.new(c, 50)\nplot(color.t(f(color.red)))',
  }
  for (const [label, body] of Object.entries(UNWITNESSED)) {
    it(label, () => {
      const t = host(body)
      expect(t.ok, 'served an unwitnessed colour').toBe(false)
      expect(t.refusal.guard).toBe('pine:colour-value')
      expect(t.refusal.message).toMatch(/`color\.[rgbt]`/)
      expect(t.refusal.message).toMatch(/vw-gradient/)
    })
  }

  it('a colour ITSELF is still not a column', () => {
    const t = host('plot(color.red)')
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:colour-value')
  })

  it('a member\'s own function named `color.r` is theirs — the carve-out yields to a definition', () => {
    // Pine has no way to define a dotted name; a bare user `r` is unaffected
    expect(formula('r(x) => x + 1\nplot(r(close))')).toBe('close + 1')
  })
})
