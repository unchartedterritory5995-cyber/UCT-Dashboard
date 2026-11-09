// The pointer chip stays fully inside the plot (real-screen review 2026-11-08: "THIS CANDLE" ran under the price scale
// on the RS drafts). pointerFit is pure, so the geometry is pinned here; DrillPlayer hands spot() the anchor it picks.
import { describe, it, expect } from 'vitest'
import { spot } from '../../lab/pointers'
import { barPxFor, chipEnd, chipPlacement, chipWidthPx, defaultChipIndex, PRICE_SCALE_PX, UNMEASURED_BOX_PX } from './pointerFit'

const bars = (n) => Array.from({ length: n }, (_, k) => ({ t: 20260101 + k, o: 10, h: 11, l: 9, c: 10.5 }))

describe('pointerFit', () => {
  it("reproduces the defect: at spot()'s own anchor the chip runs past the last candle on a 120-bar desktop window", () => {
    const n = 120
    const barPx = barPxFor(720, n)
    const span = Math.ceil(chipWidthPx('this candle') / barPx) + 1
    expect(defaultChipIndex(n - 1, 'this candle') + span).toBeGreaterThan(n - 1)   // under the price scale
  })

  it("the question's chip ends before the candle, inside the plot, on desktop and phone widths", () => {
    for (const box of [1200, 720, 390, 360]) {
      for (const n of [40, 60, 120, 160]) {
        const i = n - 1
        const p = chipPlacement({ i, n, label: 'this candle', barPx: barPxFor(box, n) })
        expect(p.index, `${box}px ${n} bars`).toBeGreaterThanOrEqual(1)
        expect(chipEnd(p), `${box}px ${n} bars`).toBeLessThanOrEqual(n - 1)
        if (p.side === 'left') expect(chipEnd(p), `${box}px ${n} bars`).toBeLessThan(i)
      }
    }
  })

  it('the reveal chips (with the forward strip after the candle) stay inside the plot too', () => {
    for (const box of [1200, 720, 360]) {
      for (const label of ['you were right', 'the answer']) {
        const n = 130
        const p = chipPlacement({ i: 119, n, label, barPx: barPxFor(box, n) })
        expect(p.index).toBeGreaterThanOrEqual(1)
        expect(chipEnd(p)).toBeLessThanOrEqual(n - 1)
      }
    }
  })

  it("keeps spot()'s own anchor when that already fits (wide bars keep the scored look)", () => {
    const n = 40
    const p = chipPlacement({ i: n - 1, n, label: 'this candle', barPx: barPxFor(1200, n) })
    expect(p).toMatchObject({ side: 'left', index: defaultChipIndex(n - 1, 'this candle') })
  })

  it('flips to the right of the candle when the left has no room and the forward strip does', () => {
    const n = 30
    const i = 12
    const p = chipPlacement({ i, n, label: 'you were right', barPx: 12 })
    expect(p.side).toBe('right')
    expect(p.index).toBe(i + 2)
    expect(chipEnd(p)).toBeLessThanOrEqual(n - 1)
  })

  it("with no room either side it still stays off the window's edge bar", () => {
    const p = chipPlacement({ i: 9, n: 10, label: 'this candle', barPx: 4 })
    expect(p.index).toBeGreaterThanOrEqual(1)
  })

  it('an unmeasured box assumes a phone, and barPxFor leaves the price scale out of the plot', () => {
    expect(barPxFor(0, 100)).toBeCloseTo((UNMEASURED_BOX_PX - PRICE_SCALE_PX) / 100)
    expect(barPxFor(800, 100)).toBeCloseTo((800 - PRICE_SCALE_PX) / 100)
    expect(barPxFor(800, 0)).toBeNull()
    expect(chipPlacement({ i: 50, n: 60, label: 'this candle', barPx: null }).index).toBe(defaultChipIndex(50, 'this candle'))
  })

  it('spot() anchors the chip at the bar it is handed, and keeps its own anchor without one (the workbench pieces)', () => {
    const b = bars(80)
    const chip = (opts) => spot(b, 79, { label: 'this candle', id: 'pt', ...opts }).find((d) => d.id === 'pt-chip')
    expect(chip({}).points[0].time).toBe(b[defaultChipIndex(79, 'this candle')].t)
    expect(chip({ chipAt: 30 }).points[0].time).toBe(b[30].t)
    expect(chip({ chipAt: -5 }).points[0].time).toBe(b[0].t)
    expect(chip({ chipAt: 500 }).points[0].time).toBe(b[79].t)
  })
})
