// app/src/components/chart/engine/ast/fillPositionalColour.test.js
//
// ⭐⭐ A `fill`'s COLOUR BY POSITION, and v4's `transp` by position (`pine.js::
// fillPositionalSignature`). ⚰️ `fill(p1, p2, color.red)` was never read: the band had
// no colour of its own and drew its first plot's colour at the engine's 0.15, so set
// F's per-version default could not reach it (two v4 corpus scripts write exactly
// this). Pine's signatures: `fill(plot1, plot2, color, …)` everywhere; v4's next slot
// is `transp`, v5/v6's is `title`. The GRADIENT form puts a number at index 2.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

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
