// app/src/components/chart/engine/ast/fillPositionalColour.test.js
//
// ⭐⭐ A `fill`'s COLOUR BY POSITION, and v4's `transp` by position (`pine.js::
// fillPositionalSignature`). ⚰️ `fill(p1, p2, color.red)` was never read: the band had
// no colour of its own and drew its first plot's colour at the engine's 0.15, so set
// F's per-version default could not reach it (two v4 corpus scripts write exactly
// this). Pine's signatures: `fill(plot1, plot2, color, …)` everywhere; v4's next slot
// is `transp`, v5/v6's is `title`. The GRADIENT form puts a number at index 2.
import { describe, it, expect } from 'vitest'
import { translatePine, isLegacyPineVersion } from './pine.js'

const fillsOf = (version, call) => {
  const head = version >= 5 ? `//@version=${version}\nindicator("t")\n` : `//@version=${version}\nstudy("t")\n`
  const t = translatePine(`${head}p1 = plot(close, "a")\np2 = plot(open, "b")\n${call}\n`, { strict: true })
  return t.presentation.fills
}

describe('a fill colour passed by position', () => {
  it('v4: `fill(p1, p2, color.red)` is #FF5252 at the v4 default, transparency 90 (byte 26)', () => {
    const [f] = fillsOf(4, 'fill(p1, p2, color.red)')
    expect(f.color).toBe('#FF5252')
    expect(Math.round(f.opacity * 255)).toBe(26)
  })
  it('v4: `fill(p1, p2, color.red, 0)` — `transp` by position — is opaque', () => {
    const [f] = fillsOf(4, 'fill(p1, p2, color.red, 0)')
    expect(f.color).toBe('#FF5252')
    expect(f.opacity).toBe(1)
  })
  it('v5: `fill(p1, p2, color.red, "T")` — the next slot is the TITLE, never a transparency — opaque', () => {
    const [f] = fillsOf(5, 'fill(p1, p2, color.red, "T")')
    expect(f.color).toBe('#FF5252') // v5's red (v6's is #F23645)
    expect(f.opacity).toBe(1)
  })
  it('a NAMED colour still wins, as it always did', () => {
    const [f] = fillsOf(6, 'fill(p1, p2, color = color.new(color.red, 50))')
    expect(Math.round(f.opacity * 255)).toBe(128)
  })
  it('⛔ the GRADIENT form (six positionals): index 2 is a NUMBER, and is never read as a colour', () => {
    // ⚰️ read by position, `close` / `100` there became a "colour this lane could not
    // carry" (`colorDynamic`) — a false disclosure about a band whose colour is a gradient
    for (const call of ['fill(p1, p2, 100, 0, color.red, color.green)', 'fill(p1, p2, close, open, color.red, color.green)']) {
      const [f] = fillsOf(5, call)
      expect(f, call).toEqual({ a: 0, b: 1 })
    }
  })
})

describe('the gradient form by NAME is never read by position either (F1)', () => {
  for (const call of [
    'fill(p1, p2, 100, 0, top_color = color.red, bottom_color = color.green)',
    'fill(p1, p2, close, open, top_color = color.red, bottom_color = color.green)',
    'fill(p1, p2, top_value = 100, bottom_value = 0, top_color = color.red, bottom_color = color.green)',
    // a user variable as top_value looks like anything by position; only the NAMES say gradient
    'v = close * 2\nfill(p1, p2, v, 0, top_color = color.red, bottom_color = color.green)',
    // no gradient NAME at all: a third positional that cannot be a colour
    'fill(p1, p2, close, title = "x")',
    'fill(p1, p2, 100, title = "x")',
  ]) {
    it(call, () => {
      const [f] = fillsOf(5, call)
      expect(f.colorDynamic, 'no false "colour this lane could not carry"').toBeUndefined()
      expect(f.color).toBeUndefined()
    })
  }
})

describe('a script with NO //@version line is v1 — legacy — for both defaults (F2)', () => {
  const unversioned = (body) => translatePine(`study("t")\np1 = plot(close, "a")\np2 = plot(open, "b")\n${body}\n`, { strict: true })
  it('the shared predicate: null / undefined / a non-integer is legacy; 4 is; 5 and 6 are not', () => {
    expect([null, undefined, 'x', 1, 3, 4, 5, 6].map(isLegacyPineVersion)).toEqual([true, true, true, true, true, true, false, false])
  })
  it('an unversioned `fill(p1, p2, color = color.red)` takes transparency 90 (byte 26), not opaque', () => {
    const t = unversioned('fill(p1, p2, color = color.red)')
    expect(t.version ?? null).toBeNull()
    expect(Math.round(t.presentation.fills[0].opacity * 255)).toBe(26)
  })
  it('…and an unversioned `bgcolor(color.red)` takes the same legacy default through the same predicate', () => {
    const t = unversioned('bgcolor(color.red)')
    const [p] = t.presentation.paints || []
    expect(p, 'the paint is carried').toBeTruthy()
    expect(Math.round(p.opacity * 255)).toBe(26)
  })
})
