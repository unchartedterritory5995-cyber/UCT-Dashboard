// app/src/components/chart/engine/ast/markerPineWords.test.js
//
// ─── e99 — A MARKER KEEPS THE PINE WORDS, BESIDE THE LWC FALLBACK ─────────────
//
// TradingView keeps, per `plotshape` / `plotchar`, the shape style, the
// `location.*` word, the `size.*` word and a text colour (#2962FF when none is
// given) — measured by FRED RS on AMEX:SPY 1D captures, 2026-11-26. The
// translator kept only the LWC fallback (`shape` / `position` / a size
// MULTIPLIER), so `location.top` became `aboveBar` and `size.large` became 1.5
// with the word gone: a canvas renderer could not get the author's picture back.
//
// ⛔ SYNTHETIC RAILS ONLY. These hold the translator's record to Pine's own
// spelling; the capture-graded rails (against TradingView's study state) come
// with the redacted captures. NOTHING here claims pixel geometry, nor the
// unmeasured defaults of `size` (absent stays absent).
//
// ⛔ Each fixture distinguishes: the default text colour is asserted beside a
// written one, the default location beside a written one, and the LWC fallback
// fields are asserted UNCHANGED beside the new words.
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { validateDefinition } from '../defSchema'

const Q = String.fromCharCode(34)
const marker = (body, version = 6) => {
  const r = translatePine(`//@version=${version}\nindicator(${Q}t${Q}, overlay = true)\n${body}\n`, { strict: false })
  expect(r.ok, `${body}: ${(r.refusal || {}).message}`).toBe(true)
  const o = (r.outputs || [])[0]
  expect(o, body).toBeTruthy()
  return (o.presentation || {}).marker
}

const LOCATIONS = [
  ['location.abovebar', 'aboveBar', undefined],
  ['location.belowbar', 'belowBar', undefined],
  ['location.top', 'aboveBar', true],
  ['location.bottom', 'belowBar', true],
  ['location.absolute', 'inBar', undefined],
]
const SIZES = [
  ['size.tiny', 0.5], ['size.small', 0.8], ['size.normal', 1],
  ['size.large', 1.5], ['size.huge', 2], ['size.auto', 1],
]

describe('e99 — the location word', () => {
  for (const [word, position, approx] of LOCATIONS) {
    it(`${word} is kept as written, and the LWC fallback is unchanged (${position})`, () => {
      const m = marker(`plotshape(close > open, ${Q}S${Q}, shape.circle, location = ${word})`)
      expect(m.pineLocation).toBe(word)
      expect(m.position).toBe(position)
      expect(m.positionApprox).toBe(approx)
    })
  }

  it('⭐ the positional location slot carries the word too', () => {
    const m = marker(`plotshape(close > open, ${Q}S${Q}, shape.circle, location.bottom, color.red)`)
    expect(m.pineLocation).toBe('location.bottom')
  })

  it('⭐ ABSENT is Pine\'s default, location.abovebar, on both calls', () => {
    expect(marker(`plotshape(close > open, ${Q}S${Q}, shape.circle)`).pineLocation).toBe('location.abovebar')
    expect(marker(`plotchar(close > open, ${Q}C${Q}, ${Q}x${Q})`).pineLocation).toBe('location.abovebar')
  })

  it('⛔ a location this door cannot read is NOT claimed to be the default', () => {
    const m = marker(`plotshape(close > open, ${Q}S${Q}, shape.circle, location = close > open ? location.top : location.bottom)`)
    expect(m.pineLocation).toBeUndefined()
  })
})

describe('e99 — the size word', () => {
  for (const [word, mult] of SIZES) {
    it(`${word} is kept as written beside the multiplier ${mult}`, () => {
      const m = marker(`plotshape(close > open, ${Q}S${Q}, shape.diamond, size = ${word})`)
      expect(m.pineSize).toBe(word)
      expect(m.size).toBe(mult)
    })
  }

  it('⛔ ABSENT stays absent: Pine\'s default size is not measured yet', () => {
    const m = marker(`plotshape(close > open, ${Q}S${Q}, shape.diamond)`)
    expect(m.pineSize).toBeUndefined()
    expect(m.size).toBeUndefined()
  })
})

describe('e99 — the text colour', () => {
  it('⭐ ABSENT is #2962FF, the colour TradingView records', () => {
    expect(marker(`plotshape(close > open, ${Q}S${Q}, shape.flag, text = ${Q}B${Q})`).textColor).toBe('#2962FF')
    expect(marker(`plotchar(close > open, ${Q}C${Q}, ${Q}x${Q})`).textColor).toBe('#2962FF')
  })

  it('⭐ a written static colour is that colour, not the default', () => {
    expect(marker(`plotshape(close > open, ${Q}S${Q}, shape.flag, textcolor = color.red)`).textColor).toBe('#F23645')
    expect(marker(`plotshape(close > open, ${Q}S${Q}, shape.flag, textcolor = #123456)`).textColor.toLowerCase()).toBe('#123456')
    expect(marker(`plotchar(close > open, ${Q}C${Q}, ${Q}x${Q}, textcolor = color.rgb(255, 0, 0))`).textColor).toBe('#FF0000')
  })

  it('⛔ a text colour this door cannot read statically is left absent, never the default', () => {
    const m = marker(`plotshape(close > open, ${Q}S${Q}, shape.flag, textcolor = close > open ? color.red : color.green)`)
    expect(m.textColor).toBeUndefined()
  })
})

describe('e99 — the LWC fallback is untouched', () => {
  it('shape / pineShape / shapeApprox exactly as before', () => {
    expect(marker(`plotshape(close > open, ${Q}S${Q}, shape.triangleup, location.belowbar, size = size.small)`))
      .toMatchObject({ shape: 'arrowUp', pineShape: 'shape.triangleup', shapeApprox: true, position: 'belowBar', size: 0.8 })
    const circle = marker(`plotshape(close > open, ${Q}S${Q}, shape.circle)`)
    expect(circle.shape).toBe('circle')
    expect(circle.shapeApprox).toBeUndefined()
  })

  it('the bare default (plotshape with no style) keeps its approximation', () => {
    const m = marker(`plotshape(close > open, ${Q}S${Q})`)
    expect(m).toMatchObject({ shape: 'square', pineShape: 'shape.xcross', shapeApprox: true, position: 'aboveBar' })
  })
})

describe('e99 — the save gate accepts every word the translator writes', () => {
  it('a markers plot carrying each Pine word validates', () => {
    for (const [loc] of LOCATIONS) {
      for (const [size] of SIZES) {
        const m = marker(`plotshape(close > open, ${Q}S${Q}, shape.cross, location = ${loc}, size = ${size}, textcolor = color.red)`)
        const v = validateDefinition({ plots: [{ key: 'sig', style: 'markers', ast: { type: 'num', value: 1 }, formula: '1', marker: m }] })
        const markerErrors = (v.errors || []).filter((e) => e.includes('.marker'))
        expect(markerErrors, `${loc} ${size}`).toEqual([])
      }
    }
  })

  it('CONTROL: the gate can refuse a word Pine does not have', () => {
    const v = validateDefinition({ plots: [{ key: 'sig', style: 'markers', marker: { shape: 'circle', pineLocation: 'location.middle', pineSize: 'size.giant', textColor: 'blue' } }] })
    const msgs = (v.errors || []).join('\n')
    expect(msgs).toContain('marker.pineLocation')
    expect(msgs).toContain('marker.pineSize')
    expect(msgs).toContain('marker.textColor')
  })
})
