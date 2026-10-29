// ⭐ AUDIT 2026-10-13 P0-5 — "Last value horizontal" was offered in Settings and drew
// an ordinary line: `presentation.drawsHistory` existed and nothing called it. The
// style now reaches the pool as `plot.levelOnly`, which hides the line's ink and draws
// one level at the latest value. The series keeps its data (crosshair and legend read
// every bar), and every other style is unchanged.
import { describe, it, expect } from 'vitest'
import { presentedPlot, drawsHistory, PLOT_STYLE_TO_DEF_STYLE } from './presentation.js'
import { seriesOptionsForPlot } from './pool.js'

const plot = { key: 'rsi', style: 'line', color: '#7E57C2', width: 2 }
const as = (style) => ({ presentation: { plots: { rsi: { style } } } })

describe('Last value horizontal', () => {
  it('reaches the pool as a level, not as history', () => {
    const p = presentedPlot(plot, as('lastValueHorizontal'))
    expect(p.levelOnly).toBe(true)
    expect(p.style).toBe('line') // the carrier is a line series, as presentation.js says
    const o = seriesOptionsForPlot(p, {})
    expect(o.lineVisible).toBe(false)
    expect(o.priceLineVisible).toBe(true)
    expect(o.lastValueVisible).toBe(true)
  })

  it('every other style still draws its history, with the line visible', () => {
    for (const style of Object.keys(PLOT_STYLE_TO_DEF_STYLE)) {
      if (!drawsHistory(style)) continue
      const p = presentedPlot(plot, as(style))
      expect(p.levelOnly, style).toBeUndefined()
      const o = seriesOptionsForPlot(p, {})
      if (o && 'lineVisible' in o) expect(o.lineVisible, style).toBe(true)
    }
  })

  it('a plot with no override is handed back untouched (no new object)', () => {
    expect(presentedPlot(plot, {})).toBe(plot)
  })

  it('exactly one style is level-only', () => {
    expect(Object.keys(PLOT_STYLE_TO_DEF_STYLE).filter((s) => !drawsHistory(s))).toEqual(['lastValueHorizontal'])
  })
})
