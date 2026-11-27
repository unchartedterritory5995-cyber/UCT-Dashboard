// @vitest-environment jsdom
// The drawing overlay on a hidden LAYER board (2026-11-27, the board keep-alive's layer mode; boardVisibility.js).
// Its undo / redo / Escape listener is on `window`: a kept board stays mounted, so without the board's gate a Ctrl+Z
// pressed on the board in front would also undo on the hidden one.
//   D1 (red first) a hidden layer board's overlay answers no Ctrl+Z / Ctrl+Y; a shown one does
//   D2 its view-watcher frame loop is gated on the board
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { createRef } from 'react'

const loops = vi.hoisted(() => [])
vi.mock('./adaptiveFrameLoop', async (orig) => {
  const m = await orig()
  return { ...m, createAdaptiveFrameLoop: (o) => { loops.push(o); return m.createAdaptiveFrameLoop(o) } }
})

const { default: ChartDrawingOverlay } = await import('./ChartDrawingOverlay')
const { BoardVisibilityContext, createBoardVisibility } = await import('./boardVisibility')

afterEach(() => { cleanup(); loops.length = 0 })

const bars = [
  { t: '2026-01-02', o: 10, h: 12, l: 9, c: 11, v: 100 },
  { t: '2026-01-05', o: 11, h: 14, l: 10, c: 13, v: 120 },
]
function chartRefs() {
  const pane = { getHeight: () => 400, getHTMLElement: () => null }
  const chart = {
    panes: () => [pane],
    timeScale: () => ({
      height: () => 30, coordinateToLogical: () => 1, logicalToCoordinate: () => 100, timeToCoordinate: () => 100,
      getVisibleLogicalRange: () => ({ from: 0, to: 2 }),
      subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {},
    }),
    options: () => ({ layout: { background: { color: '#0f0f0f' } } }),
    priceScale: () => ({ width: () => 56 }),
  }
  const series = {
    priceScale: () => ({ width: () => 56, options: () => ({ scaleMargins: { top: 0.1, bottom: 0.22 } }) }),
    priceToCoordinate: (p) => 400 - p * 10, coordinateToPrice: (y) => (400 - y) / 10, getPane: () => pane,
  }
  const chartRef = createRef(); chartRef.current = chart
  const seriesRef = createRef(); seriesRef.current = series
  return { chartRef, seriesRef }
}
function mount(vis, undo, redo) {
  const NOOP = () => {}
  const props = {
    ...chartRefs(), bars, activeTool: null, setActiveTool: NOOP, color: '#c9a84c', lineWidth: 1, drawings: [],
    addDrawing: () => 'id', updateDrawing: NOOP, removeDrawing: NOOP, selectedId: null, setSelectedId: NOOP,
    undo, redo, snapshotHistory: NOOP, savedColors: [], repeatMode: false,
  }
  return render(<BoardVisibilityContext.Provider value={vis}><ChartDrawingOverlay {...props} /></BoardVisibilityContext.Provider>)
}
const press = (key, o = {}) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, ...o })) })

describe('the drawing overlay on a hidden layer board', () => {
  it('D1 (red first) a hidden layer board answers no undo or redo key', async () => {
    const vis = createBoardVisibility({ layer: true })
    const undo = vi.fn()
    const redo = vi.fn()
    mount(vis, undo, redo)
    await press('z')
    expect(undo, 'NON-VACUITY: Ctrl+Z undoes on a shown board').toHaveBeenCalledTimes(1)
    act(() => { vis.set('hidden') })
    await press('z')
    await press('y')
    expect(undo, 'Ctrl+Z undid on a hidden board').toHaveBeenCalledTimes(1)
    expect(redo, 'Ctrl+Y redid on a hidden board').not.toHaveBeenCalled()
    act(() => { vis.set('visible') })
    await press('y')
    expect(redo).toHaveBeenCalledTimes(1)
  })

  it('D2 its view-watcher loop is gated on the board', () => {
    const vis = createBoardVisibility({ layer: true })
    mount(vis, () => {}, () => {})
    expect(loops.length, 'NON-VACUITY: the overlay runs a view watcher').toBeGreaterThan(0)
    expect(loops.every((o) => o.gate), 'an overlay loop is not gated on the board').toBe(true)
  })
})
