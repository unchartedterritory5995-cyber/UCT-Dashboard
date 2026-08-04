import { describe, it, expect } from 'vitest'
import { resolveChartRegion } from './chartRegion'
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
    expect(Object.keys(chartRegion)).toEqual(['resolveChartRegion'])
  })
})
