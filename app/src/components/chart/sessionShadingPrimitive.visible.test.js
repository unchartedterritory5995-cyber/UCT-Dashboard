// The session shade draws ONLY the bands on screen (2026-11-18). It draws on every frame (pan, zoom,
// crosshair, live tick); walking every band of a deep extended-hours 1h chart (~11,600 bands, twice:
// price + volume pane) cost ~46,000 coordinate lookups a frame, measured live as 70 ms frames.
//   V1 a frame looks up only the bands that reach the visible range (plus none past its end)
//   V2 it fills exactly the rectangles the full walk would have filled on screen
//   V3 no visible range (or non-numeric times) still draws every band, as before
import { describe, it, expect } from 'vitest'
import { createSessionShadingPrimitive, firstBandReaching } from './sessionShadingPrimitive'

const DAY = 86400
// 3,000 days of pre + post bands, 60 s per "slot" on a fake time scale
function bandsOf(days) {
  const out = []
  for (let d = 0; d < days; d++) {
    const base = d * DAY
    out.push({ from: base + 4 * 3600, to: base + 9 * 3600, type: 'pre' })
    out.push({ from: base + 16 * 3600, to: base + 19 * 3600, type: 'post' })
  }
  return out
}

function harness(bands, visible) {
  const calls = { coord: 0, fills: [] }
  const ts = {
    getVisibleRange: () => visible,
    timeToCoordinate: (t) => { calls.coord++; return (t - (visible?.from ?? 0)) / 60 },
  }
  const shade = createSessionShadingPrimitive({ enabled: true, bands })
  shade.primitive.attached({ chart: { timeScale: () => ts }, requestUpdate: () => {} })
  const ctx = { save() {}, restore() {}, fillStyle: '', fillRect: (x, _y, w) => calls.fills.push([Math.round(x), Math.round(w)]) }
  const draw = () => shade.primitive.paneViews()[0].renderer().draw({ useMediaCoordinateSpace: (fn) => fn({ context: ctx, mediaSize: { width: 1500, height: 600 } }) })
  return { calls, draw }
}

describe('the session shade draws only the bands on screen', () => {
  it('V1 a deep history costs a frame only its visible bands', () => {
    const bands = bandsOf(3000)                                     // 6,000 bands
    const visible = { from: 2990 * DAY, to: 2995 * DAY }            // five days on screen
    const h = harness(bands, visible)
    h.draw()
    expect(h.calls.coord).toBeLessThanOrEqual(2 * 12)              // ~10 bands, two lookups each
  })

  it('V2 the rectangles on screen are the ones the full walk fills', () => {
    const bands = bandsOf(50)
    const visible = { from: 20 * DAY + 6 * 3600, to: 25 * DAY + 17 * 3600 }   // starts and ends mid-band
    const h = harness(bands, visible)
    h.draw()
    const expected = bands
      .filter((b) => b.to >= visible.from && b.from <= visible.to)
      .map((b) => {
        const x0 = (b.from - visible.from) / 60, x1 = (b.to - visible.from) / 60
        return [Math.round(Math.min(x0, x1) - 1), Math.round(Math.max(1, Math.max(x0, x1) + 1 - (Math.min(x0, x1) - 1)))]
      })
    expect(h.calls.fills).toEqual(expected)
    expect(expected[0][0]).toBeLessThan(0)                           // the band cut by the left edge is drawn
  })

  it('V3 with no visible range every band draws, as before', () => {
    const bands = bandsOf(10)
    const h = harness(bands, null)
    h.draw()
    expect(h.calls.fills.length).toBe(bands.length)
    expect(firstBandReaching(bands, 'not-a-number')).toBe(0)
    expect(firstBandReaching(bands, 5 * DAY + 10 * 3600)).toBe(11)    // day 5's post band
    expect(firstBandReaching(bands, 1e12)).toBe(bands.length)
  })
})
