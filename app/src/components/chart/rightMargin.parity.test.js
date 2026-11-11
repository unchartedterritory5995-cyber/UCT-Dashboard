import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { LAST_CANDLE_POS, MIN_RIGHT_GAP_PX, MAX_RIGHT_GAP_FRAC, lastCandlePos, pinNewestRange, rightMarginBars } from './rightMargin'
import { frameAfterKeyChange } from '../../data/barStore/framing'

// ONE right-margin policy. rightMargin.js is the owner; StockChart still declares its own
// copies until it imports from here (W-R / P3-S3). This rail reads StockChart's SOURCE so
// the copies cannot drift — delete the source check the day StockChart imports the module.

const SC = fs.readFileSync(path.join(__dirname, '..', 'StockChart.jsx'), 'utf8')
const constOf = (name) => {
  const m = new RegExp(`^const ${name} = ([0-9.]+)\\s*$`, 'm').exec(SC)
  return m ? Number(m[1]) : undefined
}

describe('right-margin policy parity', () => {
  it('StockChart\'s copies equal the owner\'s values (or StockChart imports the owner)', () => {
    const imports = /from '\.\/chart\/rightMargin'/.test(SC)
    if (imports) return
    expect({ LAST_CANDLE_POS: constOf('LAST_CANDLE_POS'), MIN_RIGHT_GAP_PX: constOf('MIN_RIGHT_GAP_PX'), MAX_RIGHT_GAP_FRAC: constOf('MAX_RIGHT_GAP_FRAC') })
      .toEqual({ LAST_CANDLE_POS, MIN_RIGHT_GAP_PX, MAX_RIGHT_GAP_FRAC })
    // …and StockChart's lastCandlePos body is the owner's formula.
    expect(SC).toMatch(/const gap = Math\.min\(MAX_RIGHT_GAP_FRAC, Math\.max\(1 - LAST_CANDLE_POS, MIN_RIGHT_GAP_PX \/ plotWidthPx\)\)/)
  })

  it('lastCandlePos regimes: wide fraction, narrow pixel minimum, thin cap, unknown width', () => {
    expect(lastCandlePos(null)).toBe(0.95)
    expect(lastCandlePos(1200)).toBeCloseTo(0.95, 12)
    expect(lastCandlePos(400)).toBeCloseTo(1 - 34 / 400, 12)
    expect(lastCandlePos(150)).toBeCloseTo(0.84, 12)
  })

  it('framing K1 ≡ pinNewestRange for every tf incl. the D/W/M developing-slot reserve', () => {
    for (const reserve of [0, 1, 2]) {
      for (const [W, px] of [[390, 900], [65, 600], [126, 420], [52, 300], [36, 160]]) {
        for (const newestIndex of [0, 64, 4999]) {
          const pin = pinNewestRange(newestIndex, W, px, reserve)
          expect(frameAfterKeyChange({ newestIndex, prevRange: { from: 10, to: 10 + W }, plotWidthPx: px, reserve })).toEqual(pin)
          expect(pin.to - pin.from).toBe(W)
          expect(pin.to).toBeCloseTo(newestIndex + reserve + rightMarginBars(W, px), 12)
        }
      }
    }
  })
})
