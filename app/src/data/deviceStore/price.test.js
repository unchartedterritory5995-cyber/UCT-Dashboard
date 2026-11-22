// @vitest-environment node
// price.js — the device store's mirror of the server's price grain, held to the cases GENERATED from the
// server's own api/services/bars_fetch.py::_px (__fixtures__/server_price.json; the Python half,
// tests/test_device_store_server_price.py, proves the fixture still is the server's rounding).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { PRICE_DP, serverPrice } from './price'
import { createLiveOverlay, prevSessionISO } from './live'

const FX = JSON.parse(fs.readFileSync(new URL('./__fixtures__/server_price.json', import.meta.url), 'utf8'))

describe('serverPrice: Python round(float(x), 4), bit for bit', () => {
  it('names the server\'s number of decimals', () => {
    expect(PRICE_DP).toBe(FX.dp)
  })

  it(`answers every one of the ${FX.cases.length} server cases exactly (Object.is: -0 and +0 differ)`, () => {
    const wrong = FX.cases.filter(([x, want]) => !Object.is(serverPrice(x), want))
    expect(wrong.slice(0, 5)).toEqual([])
  })

  it('the six stream prices measured on 2026-11-20 round to what /api/bars served', () => {
    expect([11.356196, 5.565822, 5.453962, 21.974304, 61.113935, 81.210387].map(serverPrice))
      .toEqual([11.3562, 5.5658, 5.454, 21.9743, 61.1139, 81.2104])
  })

  it('an EXACT tie goes to the even neighbour, as Python does (Math.round and toFixed go up)', () => {
    expect([0.03125, 0.09375, 1.15625, 21.21875, 61.53125, -0.03125].map(serverPrice))
      .toEqual([0.0312, 0.0938, 1.1562, 21.2188, 61.5312, -0.0312])
    expect(Math.round(0.03125 * 1e4) / 1e4).toBe(0.0313)        // why a naive mirror is wrong
  })

  it('the doubles either side of a tie round by their exact value, not the float product', () => {
    const below = 0.03125 - 2 ** -57, above = 0.03125 + 2 ** -57   // representable neighbours of the tie
    expect(serverPrice(below)).toBe(0.0312)
    expect(serverPrice(above)).toBe(0.0313)
  })

  it('the fixture can tell a naive mirror from the real one', () => {
    const naive = FX.cases.filter(([x, want]) => Math.round(x * 1e4) / 1e4 !== want).length
    const toFixed = FX.cases.filter(([x, want]) => Number.isFinite(x) && Number(x.toFixed(4)) !== want).length
    expect(naive).toBeGreaterThan(10)
    expect(toFixed).toBeGreaterThan(10)
  })

  it('NaN, infinities, zeros and non-numbers come back as they are', () => {
    expect(serverPrice(NaN)).toBeNaN()
    expect(serverPrice(Infinity)).toBe(Infinity)
    expect(serverPrice(-Infinity)).toBe(-Infinity)
    expect(Object.is(serverPrice(-0), -0)).toBe(true)
    expect(serverPrice(null)).toBe(null)
    expect(serverPrice(undefined)).toBe(undefined)
  })
})

describe('the live overlay stores the server grain', () => {
  it('a sub-penny stream bar reads back exactly as /api/bars stores it; volume untouched', () => {
    const day = '2026-11-20'
    const overlay = createLiveOverlay()
    overlay.sink.reset({ day })
    const t = Math.floor(Date.UTC(2026, 10, 20, 16, 30) / 1000)      // 11:30 ET, a regular-session 5m bucket
    overlay.sink.upsert('XLE', '5', { t, o: 61.113935, h: 61.2, l: 61.113935, c: 61.150049, v: 12345 })
    overlay.sink.upsert('MARA', '5', { t, o: 5.5, h: 5.565822, l: 5.453962, c: 5.5, v: 7 })
    overlay.sink.frameDone({ day, seq: 0, minute: t / 60 + 10 })
    const xle = overlay.read('XLE', '5', prevSessionISO(day))
    const mara = overlay.read('MARA', '5', prevSessionISO(day))
    expect([xle.cols.o[0], xle.cols.h[0], xle.cols.l[0], xle.cols.c[0], xle.cols.v[0]]).toEqual([61.1139, 61.2, 61.1139, 61.15, 12345])
    expect([mara.cols.h[0], mara.cols.l[0]]).toEqual([5.5658, 5.454])
  })
})
