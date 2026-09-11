import { describe, it, expect } from 'vitest'
import { verticalBand, isStorableVerticalBand, LOCK_EPSILON } from '../viewLock'

// The layout's own margins for a chart with a volume pane — the "nothing the
// user did" baseline every measurement is compared against.
const BASE = { top: 0.12, bottom: 0.104 }

/** A pane with the candles sitting exactly on the base margins. */
const atRest = (paneH) => ({
  yHi: BASE.top * paneH,
  yLo: paneH - BASE.bottom * paneH,
  paneH,
  base: BASE,
})

describe('verticalBand', () => {
  // ─── ⛔⛔ THE REGRESSION THIS FILE EXISTS FOR ────────────────────────────────
  //
  // `paneH` used to come from `chart.paneSize().height`, which is PANE 0. The
  // candles are pane 0 only while nothing can sit above Price. The moment an
  // indicator can, `yHi`/`yLo` are measured in one pane and divided by another
  // pane's height, and the resulting margin is persisted and re-applied forever.
  it('⛔⛔ the WRONG pane height produces a wrong band — the bug, reproduced', () => {
    const TOP_PANE_H = 98        // the RSI pane, which `paneSize()` would report
    const CANDLE_PANE_H = 333    // the pane the candles are actually in

    const honest = verticalBand(atRest(CANDLE_PANE_H))
    // Measured against its own pane the chart is simply at rest: nothing to store.
    expect(honest.locked, 'a chart at its default margins must not lock').toBe(false)

    // Same chart, same coordinates, divided by the top pane's height instead.
    const m = atRest(CANDLE_PANE_H)
    const wrong = verticalBand({ ...m, paneH: TOP_PANE_H })
    expect(wrong.locked, 'the wrong pane height went unnoticed').toBe(true)
    expect(wrong.top).toBeGreaterThan(0.35)     // measured live at 0.408
    expect(wrong.bottom).toBe(0)                // (paneH - yLo) went negative
  })

  it('⭐ the band is INVARIANT to pane height — this is why a divider drag is not a zoom', () => {
    // The SAME compressed chart in a short pane and a tall one — a band the user
    // deliberately set, so both measurements do report one. If the two disagreed,
    // growing the pane would look like a new zoom and overwrite what they chose.
    const band = (paneH) => verticalBand({
      yHi: 0.37 * paneH, yLo: paneH - 0.36 * paneH, paneH, base: BASE,
    })
    const short = band(250)
    const tall = band(500)
    expect(short.locked && tall.locked).toBe(true)
    expect(tall.top).toBeCloseTo(short.top, 10)
    expect(tall.bottom).toBeCloseTo(short.bottom, 10)

    // …and the at-rest chart is invariant in the other direction: it reports
    // nothing at either height, so a divider drag persists nothing at all.
    expect(verticalBand(atRest(250)).locked).toBe(false)
    expect(verticalBand(atRest(500)).locked).toBe(false)
  })

  it('A · a pane resize at default scale writes NOTHING', () => {
    // Price pane 297 → 170 (the shipped Price/Volume separator). The candles keep
    // their proportional place, so both measurements are at rest.
    expect(verticalBand(atRest(297)).locked).toBe(false)
    expect(verticalBand(atRest(170)).locked).toBe(false)
  })

  it('B/C · moving an indicator pane top↔bottom writes NOTHING either', () => {
    // Below: candles are pane 0 and 333px tall. Above: the top pane takes 60px,
    // so the candle pane is 273px. Both at rest → no lock, no sticky state.
    expect(verticalBand(atRest(333)).locked).toBe(false)
    expect(verticalBand(atRest(273)).locked).toBe(false)
  })

  it('E · a DELIBERATE vertical compression is captured', () => {
    // The user drags the axis until the candles occupy the middle third.
    const paneH = 400
    const band = verticalBand({ yHi: 0.37 * paneH, yLo: paneH - 0.36 * paneH, paneH, base: BASE })
    expect(band.locked).toBe(true)
    expect(band.top).toBeCloseTo(0.37, 4)
    expect(band.bottom).toBeCloseTo(0.36, 4)
  })

  it('the epsilon is the whole boundary — just inside is rest, just outside is a lock', () => {
    const paneH = 400
    const at = (topFrac) => verticalBand({
      yHi: topFrac * paneH, yLo: paneH - BASE.bottom * paneH, paneH, base: BASE,
    })
    expect(at(BASE.top + LOCK_EPSILON * 0.9).locked).toBe(false)
    expect(at(BASE.top + LOCK_EPSILON * 1.1).locked).toBe(true)
  })

  it('⛔ the pair can never claim more of the pane than the candles can spare', () => {
    // Both ends clamp independently, so without the joint rescale they could sum
    // past 1 and leave a negative rectangle.
    const paneH = 300
    const band = verticalBand({ yHi: 0.8 * paneH, yLo: 0.1 * paneH, paneH, base: BASE })
    expect(band.locked).toBe(true)
    expect(band.top + band.bottom).toBeLessThanOrEqual(0.95 + 1e-9)
    // …and the rescale keeps their RATIO, rather than sacrificing one end.
    expect(band.top / band.bottom).toBeCloseTo(0.8 / 0.9, 3)
  })

  it('refuses to answer on a degenerate pane rather than dividing by it', () => {
    for (const paneH of [0, 8, -100, NaN, undefined]) {
      expect(verticalBand({ yHi: 10, yLo: 50, paneH, base: BASE }).locked).toBe(false)
    }
    expect(verticalBand({ yHi: null, yLo: 50, paneH: 300, base: BASE }).locked).toBe(false)
    expect(verticalBand({ yHi: 10, yLo: 50, paneH: 300, base: null }).locked).toBe(false)
  })
})

describe('isStorableVerticalBand — G · an old saved lock loads safely', () => {
  it('accepts every pair the writer can produce', () => {
    expect(isStorableVerticalBand(0, 0)).toBe(true)
    expect(isStorableVerticalBand(0.12, 0.104)).toBe(true)
    expect(isStorableVerticalBand(0.475, 0.475)).toBe(true)     // the joint-rescale ceiling
    expect(isStorableVerticalBand(0.9, 0)).toBe(true)           // the per-end clamp
  })

  it('⛔ rejects a pair that would leave the candles no rectangle', () => {
    expect(isStorableVerticalBand(0.6, 0.6)).toBe(false)        // sums past 0.95
    expect(isStorableVerticalBand(0.95, 0)).toBe(false)         // past the per-end clamp
    expect(isStorableVerticalBand(-0.1, 0.2)).toBe(false)
    expect(isStorableVerticalBand(0.2, NaN)).toBe(false)
  })

  it('rejects a missing or non-numeric half rather than coercing it', () => {
    expect(isStorableVerticalBand(undefined, undefined)).toBe(false)
    expect(isStorableVerticalBand(null, null)).toBe(false)
    expect(isStorableVerticalBand('0.2', 0.2)).toBe(false)
    expect(isStorableVerticalBand(0.2, undefined)).toBe(false)
  })
})
