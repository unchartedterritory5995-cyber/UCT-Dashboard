// app/src/components/chart/engine/__tests__/colorInt.test.js
//
// ─── RULE 3 — THE COLORER INTEGER, ENFORCED AGAINST THE REAL CAPTURE ────────
//
// ⭐⭐ THIS TEST READS THE COMMITTED VENDOR FIXTURE, not a hand-written constant.
// The rule was discovered by decoding Uncharted Clouds' actual output, so the
// proof has to be that same output: `clouds-volume-spy-1d-250.csv`, 250 bars of
// what TradingView really emitted.
//
// The load-bearing assertion is not "the decoder is correct" — it is that the
// correct byte order lands on PINE PALETTE CONSTANTS and the reversed order does
// not. That is what makes the rule checkable by someone who was not here.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { unpackColor, unpackColorRgbOrder, toCss, packColor, BYTE_ORDER } from '../colorInt'
import { COLOR_V6 } from '../versionRender'

const SRC = path.resolve(__dirname, '../../../..')
const REPO = path.resolve(SRC, '../..')
const FIXTURE = path.join(REPO, 'tests/fixtures/vendor/reference/A/clouds-volume-spy-1d-250.csv')

function loadFixture() {
  const text = fs.readFileSync(FIXTURE, 'utf8').replace(/\r\n/g, '\n').trim()
  const [head, ...rows] = text.split('\n')
  const cols = head.split(',')
  return rows.map((line) => {
    const cells = line.split(',')
    const o = {}
    cols.forEach((c, i) => { o[c] = cells[i] })
    return o
  })
}

const rows = loadFixture()
const num = (r, c) => Number(r[c])
/** Clouds' 20 band-colour plots. */
const BAND_COLOURS = Array.from({ length: 20 }, (_, i) => `uncharted_clouds.plot_${25 + i}`)

// ─────────────────────────────────────────────────────────────────────────────
describe('the fixture is really there and really has colorer values', () => {
  it('loads 250 bars with all 20 band-colour columns', () => {
    // ⭐ NON-VACUITY: every assertion below is over this data.
    expect(rows).toHaveLength(250)
    for (const c of BAND_COLOURS) expect(rows[0]).toHaveProperty(c)
    expect(num(rows[0], BAND_COLOURS[0])).toBeGreaterThan(1000000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⛔ RULE 3 — the colorer integer is 0xTTBBGGRR, not 0xTTRRGGBB', () => {
  it('the worked example from the line map decodes to color.teal', () => {
    const c = unpackColor(226597128)          // 0x0D819908
    expect(c.hex).toBe('#089981')
    expect(c.hex.toLowerCase()).toBe(COLOR_V6.teal.toLowerCase())
    expect(c.transparencyByte).toBe(13)
  })

  it('THE TELL: the reversed reading lands on a colour that is in no palette', () => {
    // ⛔ This is the whole rule. #819908 is a perfectly plausible olive — it
    // renders without complaint and looks deliberate. It is simply not what the
    // author asked for, and nothing about the picture says so.
    const wrong = unpackColorRgbOrder(226597128)
    expect(wrong).toBe('#819908')
    const palette = Object.values(COLOR_V6).map((h) => h.toLowerCase())
    expect(palette).toContain('#089981')
    expect(palette).not.toContain(wrong.toLowerCase())
  })

  it('every band colour in 250 real bars decodes to a Pine palette constant', () => {
    const palette = new Set(Object.values(COLOR_V6).map((h) => h.toLowerCase()))
    const seen = new Set()
    for (const r of rows) {
      for (const c of BAND_COLOURS) {
        const v = r[c]
        if (v === '' || v === undefined) continue
        seen.add(unpackColor(v).hex.toLowerCase())
      }
    }
    expect(seen.size).toBeGreaterThan(0)
    for (const hex of seen) expect(palette, `${hex} should be a Pine constant`).toContain(hex)
  })

  it('and under the reversed reading, NONE of them is a palette constant', () => {
    // The control that makes the assertion above mean something: if both orders
    // landed on palette colours, agreeing with the palette would prove nothing.
    const palette = new Set(Object.values(COLOR_V6).map((h) => h.toLowerCase()))
    const seen = new Set()
    for (const r of rows) {
      for (const c of BAND_COLOURS) {
        const v = r[c]
        if (v === '' || v === undefined) continue
        seen.add(unpackColorRgbOrder(v).toLowerCase())
      }
    }
    expect(seen.size).toBeGreaterThan(0)
    for (const hex of seen) expect(palette).not.toContain(hex)
  })

  it('the two states are exactly color.teal and color.maroon', () => {
    const byState = { up: new Set(), down: new Set() }
    for (const r of rows) {
      const fast = num(r, 'uncharted_clouds.plot_0')
      const slow = num(r, 'uncharted_clouds.plot_2')
      const state = fast >= slow ? 'up' : 'down'
      byState[state].add(unpackColor(r[BAND_COLOURS[0]]).hex.toLowerCase())
    }
    expect([...byState.up]).toEqual([COLOR_V6.teal.toLowerCase()])
    expect([...byState.down]).toEqual([COLOR_V6.maroon.toLowerCase()])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⚠️ transparency is not alpha — they run in opposite directions', () => {
  it('a transparency byte of 0 is fully opaque', () => {
    const c = unpackColor(packColor({ r: 255, g: 255, b: 255, transparencyByte: 0 }))
    expect(c.transparency).toBe(0)
    expect(c.alpha).toBe(1)
  })

  it('a high transparency byte is nearly invisible, not nearly opaque', () => {
    // ⛔ Passing the byte straight into an rgba() alpha slot inverts every fade.
    const c = unpackColor(packColor({ transparencyByte: 255 }))
    expect(c.transparency).toBe(100)
    expect(c.alpha).toBe(0)
  })

  it('the Clouds gradient fades AWAY from the fast MA, monotonically', () => {
    const r = rows[rows.length - 1]
    const t = BAND_COLOURS.map((c) => unpackColor(r[c]).transparencyByte)
    expect(t[0]).toBeLessThan(t[t.length - 1])
    for (let i = 1; i < t.length; i += 1) expect(t[i]).toBeGreaterThan(t[i - 1])
  })

  it('toCss emits a bare hex when opaque and rgba when not', () => {
    expect(toCss(packColor({ r: 8, g: 153, b: 129, transparencyByte: 0 }))).toBe('#089981')
    expect(toCss(226597128)).toMatch(/^rgba\(8, 153, 129, 0\.949/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('packing and edges', () => {
  it('round-trips', () => {
    for (const spec of [{ r: 1, g: 2, b: 3, transparencyByte: 4 }, { r: 255, g: 0, b: 128, transparencyByte: 90 }]) {
      const c = unpackColor(packColor(spec))
      expect({ r: c.r, g: c.g, b: c.b, transparencyByte: c.transparencyByte }).toEqual(spec)
    }
  })

  it('the byte offsets are named, not magic numbers', () => {
    expect(BYTE_ORDER).toEqual({ transparency: 24, blue: 16, green: 8, red: 0 })
  })

  it('handles the two MA colour plots, which are white', () => {
    const r = rows[rows.length - 1]
    expect(unpackColor(r['uncharted_clouds.plot_1']).hex).toBe('#FFFFFF')
    expect(unpackColor(r['uncharted_clouds.plot_3']).hex).toBe('#FFFFFF')
    expect(unpackColor(r['uncharted_clouds.plot_1']).transparencyByte).toBe(0)
  })

  it('refuses a non-number instead of decoding NaN into a colour', () => {
    expect(() => unpackColor('teal')).toThrow(/not a number/)
    expect(() => unpackColor(undefined)).toThrow(/not a number/)
  })
})
