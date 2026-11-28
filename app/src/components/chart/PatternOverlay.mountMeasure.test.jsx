// ⚡ (2026-11-27, the board switch) THE OVERLAY MEASURES ITS PANE ONLY WHEN IT DRAWS, AND NEVER RE-RENDERS FOR A SIZE IT HAS.
//
// MEASURED (untraced CPU profiles, keepalive2-20261127, first click into the 2-chart board): the overlay's mount
// effect cost 4-9 ms per click (`updateSize`): `el.clientWidth` / `clientHeight` read inside the commit, a forced
// layout of the freshly committed board, on every chart, although the overlay drew nothing on that board (its render
// returned null on every pass). Each size it was handed (the mount read, then the ResizeObserver's first delivery of
// the SAME size) was a new object, so the overlay re-rendered again and re-ran its pattern pipeline
// (selectDrawable / rowView / computeLabelLayout) for an unchanged pattern set.
//
// NOW: the ResizeObserver's deliveries (after layout, before paint: the read is free there) keep the size; the mount
// reads it synchronously only when the overlay draws and has no size for its pane yet (exactly the old first frame
// for a drawing overlay); an unchanged size is not a new state.
//   P1 (red first) a mount that draws nothing reads no layout
//   P2 a mount that draws reads the size at once, as before (the svg is sized after the mount)
//   P3 (red first) the observer delivering the size the overlay already has does not re-render it
//   P4 an overlay that starts drawing later uses the size the observer delivered (no read)
//   P5 an overlay that starts drawing before any delivery reads it then
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { Profiler } from 'react'
import PatternOverlay from './PatternOverlay'
import htfDetection from './patternShapes/__fixtures__/htf_detection.json'

const chart = {
  timeScale: () => ({
    timeToCoordinate: (t) => t / 100000,
    subscribeVisibleTimeRangeChange: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleTimeRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    options: () => ({ barSpacing: 8 }),
  }),
}
const series = { priceToCoordinate: (p) => 1000 - p * 10 }
// a drawable row: the fixture PatternOverlay.test.jsx draws
const DET = [htfDetection]

let reads, observers
const container = () => {
  const el = {}
  Object.defineProperty(el, 'clientWidth', { get: () => { reads++; return 800 } })
  Object.defineProperty(el, 'clientHeight', { get: () => { reads++; return 400 } })
  return { current: el }
}
beforeEach(() => {
  reads = 0
  observers = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb) { this.cb = cb; observers.push(this) }
    observe(el) { this.el = el }
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const deliver = () => act(() => { for (const o of observers) if (o.el) o.cb([{ target: o.el }], o) })

function Overlay({ containerRef, detections, onCommit }) {
  return (
    <Profiler id="po" onRender={onCommit || (() => {})}>
      <PatternOverlay chart={chart} series={series} containerRef={containerRef} 
        detections={detections} enabled />
    </Profiler>
  )
}

describe('PatternOverlay: measured only when it draws', () => {
  it('P1 (red first) a mount that draws nothing reads no layout', () => {
    render(<Overlay containerRef={container()} detections={[]} />)
    expect(reads, 'layout read inside the mount commit of an overlay that draws nothing').toBe(0)
  })

  it('P2 a mount that draws reads the size at once, as before', () => {
    const { container: host } = render(<Overlay containerRef={container()} detections={DET} />)
    const svg = host.querySelector('svg')
    expect(svg, 'the overlay draws this row').not.toBeNull()
    expect(svg.style.width).toBe('800px')
    expect(svg.style.height).toBe('400px')
  })

  it('P3 (red first) the observer delivering the size the overlay already has does not re-render it', async () => {
    const commits = vi.fn()
    render(<Overlay containerRef={container()} detections={DET} onCommit={commits} />)
    const before = commits.mock.calls.length
    await deliver() // the observer's first delivery: the same 800 x 400
    expect(commits.mock.calls.length, 're-rendered for a size it already had').toBe(before)
  })

  it('P4 an overlay that starts drawing later uses the size the observer delivered', async () => {
    const ref = container()
    const view = render(<Overlay containerRef={ref} detections={[]} />)
    await deliver()
    const afterDelivery = reads
    view.rerender(<Overlay containerRef={ref} detections={DET} />)
    expect(reads, 'read again although the observer had delivered the size').toBe(afterDelivery)
    expect(view.container.querySelector('svg').style.width).toBe('800px')
  })

  it('P5 an overlay that starts drawing before any delivery reads it then', () => {
    const ref = container()
    const view = render(<Overlay containerRef={ref} detections={[]} />)
    view.rerender(<Overlay containerRef={ref} detections={DET} />)
    expect(view.container.querySelector('svg').style.width).toBe('800px')
    expect(view.container.querySelector('svg').style.height).toBe('400px')
  })
})
