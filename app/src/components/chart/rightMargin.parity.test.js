import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { LAST_CANDLE_POS, MIN_RIGHT_GAP_PX, MAX_RIGHT_GAP_FRAC, lastCandlePos, pinNewestRange, rightMarginBars } from './rightMargin'
import { frameAfterKeyChange } from '../../data/barStore/framing'

// ONE right-margin policy. rightMargin.js is the owner and StockChart IMPORTS it (W-R,
// charts/symbol-switch-pinned) — this rail fails if StockChart grows its own copy again.

const SC = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/components/StockChart.jsx'), 'utf8')

describe('right-margin policy parity', () => {
  it('StockChart imports the owner and declares no copy of the policy', () => {
    expect(SC).toMatch(/from '\.\/chart\/rightMargin'/)
    for (const name of ['LAST_CANDLE_POS', 'MIN_RIGHT_GAP_PX', 'MAX_RIGHT_GAP_FRAC']) {
      expect({ name, declared: new RegExp(`^\\s*(export\\s+)?const ${name}\\s*=`, 'm').test(SC) }).toEqual({ name, declared: false })
    }
    for (const fn of ['lastCandlePos', 'pinNewestRange', 'rightMarginBars']) {
      expect({ fn, declared: new RegExp(`^\\s*(export\\s+)?function ${fn}\\s*\\(`, 'm').test(SC) }).toEqual({ fn, declared: false })
    }
  })

  it('lastCandlePos regimes: wide fraction, narrow pixel minimum, thin cap, unknown width', () => {
    expect(LAST_CANDLE_POS).toBe(0.95)
    expect(MIN_RIGHT_GAP_PX).toBe(34)
    expect(MAX_RIGHT_GAP_FRAC).toBe(0.16)
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
