// drawingTools — the drawing layer's exports for placing drawings without a mouse (C-3).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { POINT_COUNT, validateDrawing, drawingTimeFor } from './drawingTools'
import { toChartTime } from './patternTime'
import { ET_OFFSET } from './barTime'

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY = readFileSync(join(HERE, 'ChartDrawingOverlay.jsx'), 'utf8')

describe('POINT_COUNT', () => {
  it('is exactly the table the overlay places with (parsed from its own literal)', () => {
    const at = OVERLAY.indexOf('const POINT_COUNT = {')
    expect(at).toBeGreaterThan(-1)
    const body = OVERLAY.slice(OVERLAY.indexOf('{', at) + 1, OVERLAY.indexOf('}', at))
    const table = Object.fromEntries([...body.matchAll(/(\w+):\s*(\d+)/g)].map(m => [m[1], Number(m[2])]))
    expect(Object.keys(table).length).toBeGreaterThan(15)
    expect({ ...POINT_COUNT }).toEqual(table)
  })
  it('is frozen', () => { expect(Object.isFrozen(POINT_COUNT)).toBe(true) })
})

describe('drawingTimeFor', () => {
  it('is patternTime’s conversion: YYYY-MM-DD on D/W/M, ET-shifted seconds intraday', () => {
    expect(drawingTimeFor('2026-01-05', 'D')).toBe('2026-01-05')
    expect(drawingTimeFor(20260105, 'W')).toBe('2026-01-05')
    expect(drawingTimeFor('2026-01-05', '5')).toBe(toChartTime('2026-01-05', '5'))
    const sec = Date.UTC(2026, 0, 5, 15, 0) / 1000
    expect(drawingTimeFor(sec, '15')).toBe(sec + ET_OFFSET)
  })
  it('never guesses', () => {
    expect(drawingTimeFor('soon', 'D')).toBeNull()
    expect(drawingTimeFor(null, 'D')).toBeNull()
  })
})

describe('validateDrawing', () => {
  it('a horizontal level is ONE price, no time (the price-axis menu shape)', () => {
    expect(validateDrawing('horizontal', [{ price: 190 }])).toEqual({ ok: true })
    expect(validateDrawing('horizontal', [{ price: 190 }, { price: 191 }]).ok).toBe(false)
  })
  it('a trendline needs two dated points on D/W/M', () => {
    expect(validateDrawing('trendline', [{ time: '2026-01-05', price: 100 }, { time: '2026-03-02', price: 120 }])).toEqual({ ok: true })
    expect(validateDrawing('trendline', [{ time: 1767600000, price: 100 }, { time: '2026-03-02', price: 120 }], { tf: 'D' }).ok).toBe(false)
    expect(validateDrawing('trendline', [{ time: '2026-01-05', price: 100 }]).reason).toMatch(/2 points/)
  })
  it('intraday points are display seconds', () => {
    expect(validateDrawing('rect', [{ time: 1767600000, price: 100 }, { time: 1767603600, price: 110 }], { tf: '5' })).toEqual({ ok: true })
    expect(validateDrawing('rect', [{ time: '2026-01-05', price: 100 }, { time: 1767603600, price: 110 }], { tf: '5' }).ok).toBe(false)
  })
  it('three-point tools, future bars, and unknown tools', () => {
    const p = (d, x) => ({ time: d, price: x })
    expect(validateDrawing('pitchfork', [p('2026-01-05', 1), p('2026-01-06', 2), p('2026-01-07', 3)]).ok).toBe(true)
    expect(validateDrawing('ray', [p('2026-01-05', 1), { ...p('2026-01-06', 2), futureBars: 20 }]).ok).toBe(true)
    expect(validateDrawing('ray', [p('2026-01-05', 1), { ...p('2026-01-06', 2), futureBars: 9999 }]).ok).toBe(false)
    expect(validateDrawing('spiral', [p('2026-01-05', 1)]).ok).toBe(false)
    expect(validateDrawing('text', [{ time: '2026-01-05' }]).reason).toMatch(/no price/)
  })
})
