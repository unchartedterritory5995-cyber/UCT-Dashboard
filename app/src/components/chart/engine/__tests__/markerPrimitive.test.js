// app/src/components/chart/engine/__tests__/markerPrimitive.test.js
//
// ─── C3A.3/.4: THE EVENT MARKER, AND THE FOUR WAYS IT DISAPPEARS ────────────
//
// A marker fails silently in every direction that matters: it draws on the
// wrong bars, on every bar, on no bar, or at the right bars with the wrong
// glyph. All four leave a chart that renders and a scan that is correct, which
// is exactly the shape of "validated but inert" this program keeps finding.
import { describe, it, expect, vi } from 'vitest'
import { markersFor, createMarkerLayer } from '../markerPrimitive'

const times = (n) => Array.from({ length: n }, (_, i) => 1500000000 + i * 86400)
const MARKER = { shape: 'arrowUp', position: 'aboveBar', text: 'BUY', size: 1 }

describe('C3A — which bars get a glyph', () => {
  it('exactly the bars where the event column is 1', () => {
    const column = [NaN, 0, 1, 0, 1, 1]
    const out = markersFor({ column, times: times(6), marker: MARKER, color: '#0f0' })
    expect(out.map((m) => m.time)).toEqual([times(6)[2], times(6)[4], times(6)[5]])
  })

  it('⛔ NaN IS THE WARM-UP PAD, NOT AN EVENT', () => {
    // A 200-bar indicator whose condition needs 199 bars of history has 199 NaN
    // bars. Reading them as events would mark the entire left of the chart.
    const column = [NaN, NaN, NaN, 1]
    const out = markersFor({ column, times: times(4), marker: MARKER, color: '#0f0' })
    expect(out).toHaveLength(1)
  })

  it('⛔⛔ A PRICE COLUMN DOES NOT MARK EVERY BAR — the test is explicit', () => {
    // `location.absolute` lets a Pine author hand `plotshape` a PRICE. Under a
    // truthy test every bar with a non-zero price is an event, which is every
    // bar — a chart solid with glyphs, and a rail that reads "markers work".
    const column = [-3, -1, 0, 2, 5]
    const out = markersFor({ column, times: times(5), marker: MARKER, color: '#0f0' })
    expect(out.map((m) => m.time)).toEqual([times(5)[3], times(5)[4]])
  })

  it('a column shorter than the bars is not read past its end', () => {
    const out = markersFor({ column: [1, 1], times: times(6), marker: MARKER, color: '#0f0' })
    expect(out).toHaveLength(2)
  })

  it('no marker spec, no markers — and no throw', () => {
    expect(markersFor({ column: [1], times: times(1), marker: null, color: '#0f0' })).toEqual([])
    expect(markersFor({})).toEqual([])
  })
})

describe('C3A — what each glyph SAYS', () => {
  it('carries shape, position, text and size through verbatim', () => {
    const [m] = markersFor({
      column: [1], times: times(1), color: '#abcdef',
      marker: { shape: 'arrowDown', position: 'belowBar', text: 'SELL', size: 1.5 },
    })
    expect(m).toEqual({
      time: times(1)[0], shape: 'arrowDown', position: 'belowBar',
      color: '#abcdef', text: 'SELL', size: 1.5,
    })
  })

  it('omits text and size rather than inventing them', () => {
    const [m] = markersFor({
      column: [1], times: times(1), color: '#fff', marker: { shape: 'circle' },
    })
    expect(m.text).toBeUndefined()
    expect(m.size).toBeUndefined()
    // …and an absent position still lands somewhere deliberate
    expect(m.position).toBe('aboveBar')
  })

  it('⭐ a two-colour rule colours each glyph like the line would', () => {
    // The same `colorMode: 'column:<key>'` fields a line reads. A marker whose
    // colour rule disagreed with the line drawn from the same condition would be
    // two authorities over one signal.
    const out = markersFor({
      column: [1, 1, 1],
      condColumn: [1, 0, 1],
      colorUp: '#0f0',
      colorDown: '#f00',
      times: times(3),
      marker: { shape: 'circle' },
      color: '#999',
    })
    expect(out.map((m) => m.color)).toEqual(['#0f0', '#f00', '#0f0'])
  })

  it('⛔ THE CONTROL: without the rule every glyph takes the plot colour', () => {
    const out = markersFor({
      column: [1, 1], condColumn: [1, 0], times: times(2),
      marker: { shape: 'circle' }, color: '#999',
    })
    expect(out.map((m) => m.color)).toEqual(['#999', '#999'])
  })
})

describe('C3A — the layer, and the redraw it must not do', () => {
  it('creates the controller once, then updates it', () => {
    const setMarkers = vi.fn()
    const create = vi.fn(() => ({ setMarkers }))
    const layer = createMarkerLayer(create, {})
    layer.set([{ time: 1, shape: 'circle', position: 'inBar', color: '#f00' }])
    expect(create).toHaveBeenCalledTimes(1)
    layer.set([{ time: 2, shape: 'circle', position: 'inBar', color: '#f00' }])
    expect(create).toHaveBeenCalledTimes(1)
    expect(setMarkers).toHaveBeenCalledTimes(1)
  })

  it('⛔ AN IDENTICAL LIST IS NOT RE-SET. Markers are re-derived on every bind, '
    + 'and a chart that redraws the same glyphs on every bar tick spends its '
    + 'frame budget on nothing', () => {
    const setMarkers = vi.fn()
    const create = vi.fn(() => ({ setMarkers }))
    const layer = createMarkerLayer(create, {})
    const list = [{ time: 1, shape: 'circle', position: 'inBar', color: '#f00' }]
    layer.set(list)
    layer.set([...list])
    layer.set([...list])
    expect(setMarkers).not.toHaveBeenCalled()
  })

  it('an empty first list creates nothing at all', () => {
    const create = vi.fn(() => ({ setMarkers: vi.fn() }))
    const layer = createMarkerLayer(create, {})
    layer.set([])
    expect(create).not.toHaveBeenCalled()
    expect(layer.attached).toBe(false)
  })

  it('clear() empties an attached layer and is safe on an empty one', () => {
    const setMarkers = vi.fn()
    const layer = createMarkerLayer(() => ({ setMarkers }), {})
    layer.clear()
    expect(setMarkers).not.toHaveBeenCalled()
    layer.set([{ time: 1, shape: 'circle', position: 'inBar', color: '#f00' }])
    layer.clear()
    expect(setMarkers).toHaveBeenCalledWith([])
  })
})
