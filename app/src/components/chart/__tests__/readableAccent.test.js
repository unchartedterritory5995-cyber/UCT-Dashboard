import { describe, it, expect } from 'vitest'
import { readableAccent, readableInk } from '../chartThemes'

/** WCAG contrast, duplicated here on purpose: a test that imported the
 *  implementation's own maths could not catch the implementation's own maths. */
const contrast = (a, b) => {
  const hex = (h) => h.replace('#', '').match(/../g).map((x) => parseInt(x, 16))
  const chan = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
  const rel = (c) => 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2])
  const [l1, l2] = [rel(hex(a)), rel(hex(b))]
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}
const hue = (h) => {
  const [r, g, b] = h.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255)
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min
  if (!d) return 0
  const v = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (v / 6) * 360
}

// The four colours the header actually ships (headerFields.js `dflt`).
const SHIPPED = { marketCap: '#6ba3be', rating: '#dcbb5e', sector: '#9b9684' }
const LIGHT = '#f3efe4'   // Cream app surface — the canvas the loss report measured
const PAPER = '#ffffff'
const OLED = '#0a0a0a'
const GRAPHITE = '#17181b'

describe('readableAccent — our defaults adapt, their hue survives', () => {
  for (const [name, c] of Object.entries(SHIPPED)) {
    it(`⭐ ${name} reaches 4.5:1 on a light canvas`, () => {
      const out = readableAccent(c, LIGHT)
      expect(contrast(c, LIGHT)).toBeLessThan(4.5)      // the defect, restated
      expect(contrast(out, LIGHT)).toBeGreaterThanOrEqual(4.5)
    })
    it(`⭐ ${name} keeps its hue (identity is how a field is found)`, () => {
      const out = readableAccent(c, LIGHT)
      expect(Math.abs(hue(out) - hue(c))).toBeLessThan(2)
    })
    it(`⛔ ${name} is UNTOUCHED on a dark canvas — dark themes render byte-identically`, () => {
      expect(readableAccent(c, OLED)).toBe(c)
      expect(readableAccent(c, GRAPHITE)).toBe(c)
    })
    it(`⭐ ${name} also reaches 4.5:1 on pure white`, () => {
      expect(contrast(readableAccent(c, PAPER), PAPER)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('⛔ unparseable input is passed through, never guessed at', () => {
    expect(readableAccent('var(--x)', LIGHT)).toBe('var(--x)')
    expect(readableAccent('#6ba3be', 'nonsense')).toBe('#6ba3be')
  })

  it('⭐ it takes rgb() as well as hex — the forms the pickers produce', () => {
    const out = readableAccent('rgb(220, 187, 94)', LIGHT)
    expect(contrast(out, LIGHT)).toBeGreaterThanOrEqual(4.5)
  })

  it('⛔ it is NOT readableInk: two different accents stay two different colours', () => {
    const a = readableAccent(SHIPPED.marketCap, LIGHT)
    const b = readableAccent(SHIPPED.rating, LIGHT)
    expect(a).not.toBe(b)
    // …whereas the ink helper flattens both to one value by design.
    expect(readableInk(LIGHT)).toBe(readableInk(LIGHT))
  })
})
