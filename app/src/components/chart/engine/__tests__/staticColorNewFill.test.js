// app/src/components/chart/engine/__tests__/staticColorNewFill.test.js
//
// ⭐⭐ DOOR 2 (engine e100, NUMBER PENDING; DRAFT until FRED's capture grid): A STATIC BAND'S `color.new(c, t)` IS A
// STYLE TRANSPARENCY. TradingView stores a static fill's colour as a decimal-alpha string ("rgba(41,98,255,0.1)") and
// paints it with ONE rounding, so t = 90 is byte 26 (FRED's pixel probe, 2026-11-27, v5 SPY 1D: alpha 0.1024). A
// PER-BAR colour is a computed colour, byte-rounded from the floating 1 − t/100 (capture A, Uncharted Clouds: 25).
// Among whole t, 90 is the only one where the two rules paint a different byte, so it is the case here.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { fillPaint } from '../fillPaint'
import { DOOR_FILL_RULES, DOOR_VERSION, stampedFillOpacity, doorOneFillOpacity, upgradeFromDoorStamps } from '../memberDocumentMigration'

const script = (body) => ['//@version=5', 'indicator("u", overlay=false)',
  'p1 = plot(100, "p1", color=color.gray)', 'p2 = plot(80, "p2", color=color.gray)', body, ''].join('\n')
const fillsOf = (body) => translatePine(script(body), { strict: true }).presentation.fills

describe('a static band: color.new / color.rgb at t = 90 paints TradingView\'s byte 26', () => {
  for (const body of ['fill(p1, p2, color=color.new(#2962ff, 90))', 'fill(p1, p2, color=color.rgb(41, 98, 255, 90))']) {
    it(body, () => {
      const [f] = fillsOf(body)
      expect(f.opacity).toBe(0.1)
      expect(fillPaint(f.color, f.opacity)).toBe('#2962FF1A')
      expect(f.transparency).toEqual({ value: 90, via: 'color' })
    })
  }
  it('CONTROL: t = 50 and t = 70 paint the same byte under either rule (128, 77)', () => {
    expect(Math.round(fillsOf('fill(p1, p2, color=color.new(#2962ff, 50))')[0].opacity * 255)).toBe(128)
    expect(Math.round(fillsOf('fill(p1, p2, color=color.new(#2962ff, 70))')[0].opacity * 255)).toBe(77)
  })
})

describe("⛔ a PER-BAR band keeps capture A's rule: t = 90 stays byte 25", () => {
  const alphaByte = (c) => (typeof c === 'string' && /^#[0-9a-f]{8}$/i.test(c) ? parseInt(c.slice(7), 16) : null)
  it('fill(p1, p2, color = close > open ? color.new(color.green, 90) : color.new(color.red, 90))', () => {
    const [f] = fillsOf('fill(p1, p2, color = close > open ? color.new(color.green, 90) : color.new(color.red, 90))')
    expect(typeof f.colorUp, JSON.stringify(f)).toBe('string')
    const bytes = [alphaByte(f.colorUp), alphaByte(f.colorDown), Number.isFinite(f.opacity) ? Math.round(f.opacity * 255) : null]
      .filter((b) => b !== null)
    expect(bytes.length, `NON-VACUITY: the band states its alpha somewhere: ${JSON.stringify(f)}`).toBeGreaterThan(0)
    bytes.forEach((b) => expect(b, JSON.stringify(f)).toBe(25))
  })
})

describe('the door rules: door 2 states (100 − t) / 100, door 1 is kept to recognise its saved values', () => {
  const s90 = { value: 90, via: 'color' }
  it('door 2 is today\'s door, and both rules are in the table', () => {
    expect(DOOR_VERSION).toBe(2)
    expect(DOOR_FILL_RULES[2]).toBe(stampedFillOpacity)
    expect(DOOR_FILL_RULES[1]).toBe(doorOneFillOpacity)
    expect(stampedFillOpacity(s90, 5)).toBe(0.1)
    expect(doorOneFillOpacity(s90, 5)).toBe(1 - 90 / 100)
  })
  const doc = (fillOpacity) => ({
    id: 'u_x', meta: { pineVersion: 5, doorVersion: 1 },
    plots: [{ key: 'a', fill: { with: 'b' }, fillColor: '#2962ff', fillTransparency: s90, ...(fillOpacity === undefined ? {} : { fillOpacity }) }, { key: 'b' }],
  })
  it('a door-1 band still holding door 1\'s own value moves to door 2\'s', () => {
    expect(upgradeFromDoorStamps(doc(1 - 90 / 100)).plots[0].fillOpacity).toBe(0.1)
  })
  it('⛔ a value somebody else set is never moved', () => {
    const d = doc(0.2)
    expect(upgradeFromDoorStamps(d)).toBe(d)
  })
})
