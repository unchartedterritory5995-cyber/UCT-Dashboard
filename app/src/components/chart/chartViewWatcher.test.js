import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createAdaptiveFrameLoop, IDLE_AFTER_FRAMES } from './adaptiveFrameLoop'
import { NO_CHART_FRAMES, watchChartView } from './chartViewWatcher'

// A fake clock: frames and timers run only when the test says so.
function clock() {
  let frames = []
  let timers = []
  return {
    loopFactory: (opts) => createAdaptiveFrameLoop({
      ...opts,
      raf: (fn) => { frames.push(fn); return frames.length },
      caf: () => { frames = [] },
      setTimer: (fn) => { timers.push(fn); return timers.length },
      clearTimer: () => { timers = [] },
    }),
    frame() { const f = frames; frames = []; f.forEach((fn) => fn()) },
    frames(n) { for (let i = 0; i < n; i++) this.frame() },
    timer() { const t = timers; timers = []; t.forEach((fn) => fn()) },
    pendingFrames: () => frames.length,
    pendingTimers: () => timers.length,
  }
}

function fakeChart() {
  const range = { from: 0, to: 100 }
  const rangeSubs = new Set()
  const listeners = {}
  const el = {
    addEventListener: (ev, fn) => { (listeners[ev] ||= new Set()).add(fn) },
    removeEventListener: (ev, fn) => { listeners[ev]?.delete(fn) },
  }
  return {
    range,
    el,
    listeners,
    rangeSubs,
    chartElement: () => el,
    timeScale: () => ({
      getVisibleLogicalRange: () => ({ ...range }),
      subscribeVisibleLogicalRangeChange: (fn) => rangeSubs.add(fn),
      unsubscribeVisibleLogicalRangeChange: (fn) => rangeSubs.delete(fn),
    }),
    moveRange(d) { range.from += d; range.to += d; rangeSubs.forEach((fn) => fn()) },
    fire(ev) { listeners[ev]?.forEach((fn) => fn()) },
  }
}

function fakeSeries() {
  let scale = 1
  const subs = new Set()
  return {
    subs,
    priceToCoordinate: (p) => p * scale,
    subscribeDataChanged: (fn) => subs.add(fn),
    unsubscribeDataChanged: (fn) => subs.delete(fn),
    rescale(s) { scale = s },
    dataChanged() { subs.forEach((fn) => fn()) },
  }
}

const settle = (c) => c.frames(IDLE_AFTER_FRAMES + 2)

describe('watchChartView', () => {
  it('stops spending frames once the view is still, then rests on the slow safety pass', () => {
    const c = clock()
    const chart = fakeChart()
    const sample = vi.fn()
    const w = watchChartView({ chartRef: { current: chart }, seriesRef: { current: fakeSeries() }, sample, loopFactory: c.loopFactory, win: null })
    settle(c)
    expect(c.pendingFrames()).toBe(0)
    expect(c.pendingTimers()).toBe(1)
    const calls = sample.mock.calls.length
    c.frames(50) // nothing scheduled per frame any more
    expect(sample.mock.calls.length).toBe(calls)
    w.stop()
  })

  it('a range change redraws on the same call (onRange) and returns to every frame', () => {
    const c = clock()
    const chart = fakeChart()
    const onRange = vi.fn()
    const keys = []
    const w = watchChartView({ chartRef: { current: chart }, seriesRef: { current: fakeSeries() }, onRange, sample: ({ key }) => { keys.push(key) }, loopFactory: c.loopFactory, win: null })
    settle(c)
    chart.moveRange(5)
    expect(onRange).toHaveBeenCalledTimes(1)
    expect(c.pendingFrames()).toBe(1)
    c.frame()
    expect(keys.at(-1)).toMatch(/^5\.00_105\.00\|/)
    w.stop()
  })

  it('a price-axis drag (pointer on the chart element) wakes it, and sees the new price mapping', () => {
    const c = clock()
    const chart = fakeChart()
    const series = fakeSeries()
    const keys = []
    const w = watchChartView({ chartRef: { current: chart }, seriesRef: { current: series }, sample: ({ key }) => { keys.push(key) }, loopFactory: c.loopFactory, win: null })
    settle(c)
    series.rescale(2)
    chart.fire('pointermove')
    expect(c.pendingFrames()).toBe(1)
    c.frame()
    expect(keys.at(-1)).toBe('0.00_100.00|2|200|')
    w.stop()
  })

  it('a data change on the series wakes it (autoscale moves the mapping)', () => {
    const c = clock()
    const series = fakeSeries()
    const w = watchChartView({ chartRef: { current: fakeChart() }, seriesRef: { current: series }, sample: () => {}, loopFactory: c.loopFactory, win: null })
    settle(c)
    series.dataChanged()
    expect(c.pendingFrames()).toBe(1)
    w.stop()
  })

  it('the safety pass still catches a change nothing reported', () => {
    const c = clock()
    const series = fakeSeries()
    const keys = []
    const w = watchChartView({ chartRef: { current: fakeChart() }, seriesRef: { current: series }, sample: ({ key }) => { keys.push(key) }, loopFactory: c.loopFactory, win: null })
    settle(c)
    series.rescale(3)
    c.timer()
    expect(keys.at(-1)).toBe('0.00_100.00|3|300|')
    expect(c.pendingFrames()).toBe(1) // back to every frame until it settles again
    w.stop()
  })

  it('sample returning null keeps it on every frame (a snap waiting to land)', () => {
    const c = clock()
    let settling = true
    const w = watchChartView({ chartRef: { current: fakeChart() }, seriesRef: { current: fakeSeries() }, sample: () => (settling ? null : undefined), loopFactory: c.loopFactory, win: null })
    c.frames(100)
    expect(c.pendingFrames()).toBe(1)
    settling = false
    settle(c)
    expect(c.pendingFrames()).toBe(0)
    w.stop()
  })

  it('the extra key (text fade) changing keeps it awake', () => {
    const c = clock()
    let fade = 0
    const w = watchChartView({ chartRef: { current: fakeChart() }, seriesRef: { current: fakeSeries() }, extraKey: () => fade.toFixed(3), sample: () => {}, loopFactory: c.loopFactory, win: null })
    for (let i = 0; i < 30; i++) { fade += 0.03; c.frame() }
    expect(c.pendingFrames()).toBe(1)
    w.stop()
  })

  it('finds a chart that mounts late, and follows a replaced chart and series', () => {
    const c = clock()
    const chartRef = { current: null }
    const seriesRef = { current: null }
    const sample = vi.fn()
    const w = watchChartView({ chartRef, seriesRef, sample, loopFactory: c.loopFactory, win: null })
    c.frames(5)
    expect(sample).not.toHaveBeenCalled()
    expect(c.pendingFrames()).toBe(1) // still polling every frame for the chart
    const a = fakeChart()
    const s1 = fakeSeries()
    chartRef.current = a
    seriesRef.current = s1
    c.frame()
    expect(sample).toHaveBeenCalled()
    expect(a.rangeSubs.size).toBe(1)
    expect(s1.subs.size).toBe(1)
    const b = fakeChart()
    const s2 = fakeSeries()
    chartRef.current = b
    seriesRef.current = s2
    c.frame()
    expect(a.rangeSubs.size).toBe(0)
    expect(a.listeners.pointermove?.size ?? 0).toBe(0)
    expect(s1.subs.size).toBe(0)
    expect(b.rangeSubs.size).toBe(1)
    expect(s2.subs.size).toBe(1)
    w.stop()
  })

  it('a chart that never appears stops costing frames after the grace period', () => {
    const c = clock()
    const w = watchChartView({ chartRef: { current: null }, seriesRef: { current: null }, sample: () => {}, loopFactory: c.loopFactory, win: null })
    c.frames(NO_CHART_FRAMES + IDLE_AFTER_FRAMES + 5)
    expect(c.pendingFrames()).toBe(0)
    w.stop()
  })

  it('stop removes every subscription and listener', () => {
    const c = clock()
    const chart = fakeChart()
    const series = fakeSeries()
    const resize = new Set()
    const win = { addEventListener: (_e, fn) => resize.add(fn), removeEventListener: (_e, fn) => resize.delete(fn) }
    const w = watchChartView({ chartRef: { current: chart }, seriesRef: { current: series }, sample: () => {}, loopFactory: c.loopFactory, win })
    expect(resize.size).toBe(1)
    w.stop()
    expect(chart.rangeSubs.size).toBe(0)
    expect(series.subs.size).toBe(0)
    expect(Object.values(chart.listeners).every((s) => s.size === 0)).toBe(true)
    expect(resize.size).toBe(0)
    expect(c.pendingFrames() + c.pendingTimers()).toBe(0)
  })
})

describe('the chart overlays use the watcher, not a forever loop', () => {
  // 2026-11-10: each of these re-armed requestAnimationFrame from inside its own tick, forever.
  const files = ['ChartDrawingOverlay.jsx', 'ChartCalloutOverlay.jsx', 'SetupMoveOverlay.jsx']
  it.each(files)('%s watches the view through watchChartView', (f) => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), f), 'utf8')
    expect(src).toMatch(/watchChartView\(\{/)
    expect(src).not.toMatch(/=\s*requestAnimationFrame\(tick\)/)
  })
})
