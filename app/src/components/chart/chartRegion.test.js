import { describe, it, expect } from 'vitest'
import { resolveChartRegion, resolveChartRegionFromPanes } from './chartRegion'
import * as chartRegion from './chartRegion'

// Geometry baseline: 800x400 container, 60px right axis, 24px time axis.
// Overlay-mode volume band occupies the bottom 15% of pane 0.
const base = {
  width: 800,
  height: 400,
  axisWidth: 60,
  timeAxisHeight: 24,
  separateVolume: false,
  pane0Height: 376, // height - timeAxis when single pane
  paneMargins: {
    main: { top: 0.30, bottom: 0.15 },
    volume: { top: 0.85, bottom: 0 },
  },
}

describe('resolveChartRegion', () => {
  it('detects the right price axis', () => {
    expect(resolveChartRegion({ ...base, x: 770, y: 100 }).type).toBe('priceAxis')
  })

  it('detects the bottom time axis', () => {
    expect(resolveChartRegion({ ...base, x: 300, y: 390 }).type).toBe('timeAxis')
  })

  it('time axis wins over price axis in the bottom-right corner', () => {
    expect(resolveChartRegion({ ...base, x: 790, y: 390 }).type).toBe('timeAxis')
  })

  it('detects the overlay-mode volume band (bottom 15% of pane 0)', () => {
    // band: y in [0.85*376=319.6 .. 376]
    expect(resolveChartRegion({ ...base, x: 300, y: 350 }).type).toBe('volume')
  })

  it('detects the open price area above the volume band', () => {
    expect(resolveChartRegion({ ...base, x: 300, y: 150 }).type).toBe('price')
  })

  it('treats price headroom (above the price band top) as price', () => {
    expect(resolveChartRegion({ ...base, x: 300, y: 20 }).type).toBe('price')
  })

  it('detects an indicator sub-pane', () => {
    const margins = {
      main: { top: 0.30, bottom: 0.30 },
      rsi: { top: 0.85, bottom: 0 },
      volume: { top: 0.70, bottom: 0.15 },
    }
    // rsi band: y in [0.85*376=319.6 .. 376]
    const r = resolveChartRegion({ ...base, paneMargins: margins, x: 300, y: 350 })
    expect(r.type).toBe('indicator')
    expect(r.key).toBe('rsi')
    // volume band: y in [0.70*376=263.2 .. 0.85*376=319.6]
    expect(resolveChartRegion({ ...base, paneMargins: margins, x: 300, y: 290 }).type).toBe('volume')
  })

  it('detects a separate volume pane below the divider', () => {
    const sep = {
      ...base,
      separateVolume: true,
      pane0Height: 290,        // price pane
      // plot height 376; volume pane ~ 376-290-1 = 85px below divider
      paneMargins: { main: { top: 0.30, bottom: 0 } },
    }
    // above divider (291) → price
    expect(resolveChartRegion({ ...sep, x: 300, y: 150 }).type).toBe('price')
    // below divider → volume
    expect(resolveChartRegion({ ...sep, x: 300, y: 340 }).type).toBe('volume')
  })
})

// ─── B4 Task 3 ──────────────────────────────────────────────────────────────
describe('the module knows about geometry and nothing else', () => {
  it('exports no label table — the region resolver returns a KEY and the catalog names it', () => {
    // The resolver is pure geometry. A label table living beside it was an
    // enumeration site in a file whose whole point is not knowing about
    // indicators — and it was the THIRD spelling of `Williams %R` in the tree.
    expect(Object.keys(chartRegion)).not.toContain('INDICATOR_LABELS')
    // ⛔ …and the check is not vacuous: the module still exports the thing it
    // is FOR, so an empty/mis-resolved namespace cannot pass the line above.
    //
    // ⚠️ ROTTED AT B5 TASK 10 AND REPAIRED, NOT WEAKENED. The list was a literal
    // `['resolveChartRegion']`, which went RED the moment Flip C added the
    // real-pane resolver — correctly: an equality is what makes a THIRD export
    // (a label table by another name) a failure, and relaxing it to
    // `toContain` would have retired the only thing this case does.
    expect(Object.keys(chartRegion).slice().sort())
      .toEqual(['resolveChartRegion', 'resolveChartRegionFromPanes'])
  })
})

// ─── B5 Task 10 · FLIP C ─────────────────────────────────────────────────────
//
// The panes resolver reads RECTANGLES the renderer produced. Every case below is
// therefore a statement about pixel arithmetic over a pane list, not about `cs`:
// hand it a different stack and it says something different, which is exactly
// what the bands resolver — which recomputes the layout from settings — cannot.
describe('resolveChartRegionFromPanes', () => {
  // 400px tall, 24px time axis ⇒ 376px of panes. Three panes + two separators:
  // pane 0 (price, 260) | rsi (60) | macd (54).
  const panes = [
    { key: null, height: 260 },
    { key: 'rsi', height: 60 },
    { key: 'macd', height: 54 },
  ]
  const base = {
    width: 800, height: 400, axisWidth: 60, timeAxisHeight: 24,
    panes, separatorHeight: 1,
  }

  it('the axes still win', () => {
    expect(resolveChartRegionFromPanes({ ...base, x: 770, y: 100 }).type).toBe('priceAxis')
    expect(resolveChartRegionFromPanes({ ...base, x: 300, y: 390 }).type).toBe('timeAxis')
    expect(resolveChartRegionFromPanes({ ...base, x: 790, y: 390 }).type).toBe('timeAxis')
  })

  it('names each oscillator pane by its own key, from its own rectangle', () => {
    // pane 0: [0, 260) · rsi: [261, 321) · macd: [322, 376)
    expect(resolveChartRegionFromPanes({ ...base, x: 300, y: 130 })).toEqual({ type: 'price' })
    expect(resolveChartRegionFromPanes({ ...base, x: 300, y: 290 })).toEqual({ type: 'indicator', key: 'rsi' })
    expect(resolveChartRegionFromPanes({ ...base, x: 300, y: 350 })).toEqual({ type: 'indicator', key: 'macd' })
  })

  it('the SAME y lands in a DIFFERENT pane when the renderer sized them differently', () => {
    // ⭐ THE WHOLE POINT. y=290 is RSI above and MACD here, and nothing about the
    // settings blob changed — only the rectangles. The bands resolver cannot
    // express this case at all, because it derives the geometry itself.
    const squeezed = [
      { key: null, height: 160 },
      { key: 'rsi', height: 60 },
      { key: 'macd', height: 154 },
    ]
    expect(resolveChartRegionFromPanes({ ...base, panes: squeezed, x: 300, y: 290 }))
      .toEqual({ type: 'indicator', key: 'macd' })
  })

  it('pane 0 still holds the overlay-mode volume BAND, because volume gets no pane', () => {
    const withVol = {
      ...base,
      panes: [{ key: null, height: 260 }, { key: 'rsi', height: 115 }],
      pane0Bands: { volume: { top: 0.85, bottom: 0 } },
    }
    // band: y in [0.85*260 = 221 .. 260]
    expect(resolveChartRegionFromPanes({ ...withVol, x: 300, y: 240 }).type).toBe('volume')
    expect(resolveChartRegionFromPanes({ ...withVol, x: 300, y: 200 }).type).toBe('price')
  })

  it('a keyless pane below pane 0 is the separate VOLUME pane', () => {
    const sep = [
      { key: null, height: 220 },
      { key: null, height: 80 },
      { key: 'rsi', height: 74 },
    ]
    expect(resolveChartRegionFromPanes({ ...base, panes: sep, x: 300, y: 260 }).type).toBe('volume')
    expect(resolveChartRegionFromPanes({ ...base, panes: sep, x: 300, y: 340 }))
      .toEqual({ type: 'indicator', key: 'rsi' })
  })

  it('the divider pixels belong to the pane above, so there is no gap to fall through', () => {
    // The separator between pane 0 and rsi is y = 260.
    expect(resolveChartRegionFromPanes({ ...base, x: 300, y: 260 }).type).toBe('price')
    expect(resolveChartRegionFromPanes({ ...base, x: 300, y: 261 })).toEqual({ type: 'indicator', key: 'rsi' })
    // TOTALITY: every y in the plot resolves to something, and never to undefined.
    const seen = new Set()
    for (let y = 0; y < 400; y++) {
      const r = resolveChartRegionFromPanes({ ...base, x: 300, y })
      expect(typeof r.type, `y=${y}`).toBe('string')
      seen.add(r.type)
    }
    expect([...seen].sort()).toEqual(['indicator', 'price', 'timeAxis'])
  })
})
