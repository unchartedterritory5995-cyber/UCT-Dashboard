// ⚡ (2026-11-26, the board switch) THE LEGEND'S CONTEXT IS READ ONCE PER ELEMENT CHAIN. `readLegendContext` makes the
// browser resolve the role tokens inside a chart and walks its ancestors' backgrounds (style reads), 2.7 ms of a two-chart
// board switch, every chart mount paying it again for the same answer. The answer follows from the stylesheets and the
// chain of elements up to the root (tags, attributes) and the viewport, so that chain is the key.
//   C1 (red first) a second chart in the same chain reads nothing: the first answer is reused
//   C2 an attribute changing anywhere on the chain (a widget's inline token, the app theme on <html>) reads again
//   C3 a viewport change (a media query) reads again; C4 the answer is readLegendContext's own
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as ink from './legendInk'

function chain(attrs = {}) {
  const host = document.createElement('div')
  host.className = 'widgetBody'
  host.setAttribute('style', '--text: #dddddd; background: rgb(10, 12, 14)')
  for (const [k, v] of Object.entries(attrs)) host.setAttribute(k, v)
  const wrap = document.createElement('div')
  wrap.className = 'chartWrapper'
  host.appendChild(wrap)
  document.body.appendChild(host)
  return wrap
}
let reads
beforeEach(() => {
  if (ink._resetLegendContextsForTests) ink._resetLegendContextsForTests()
  reads = vi.spyOn(window, 'getComputedStyle')
})
afterEach(() => {
  reads.mockRestore()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
})

describe('readLegendContextCached: one read per element chain', () => {
  it('C1 (red first) a second chart in the same chain reads nothing: the first answer is reused', () => {
    const a = chain()
    const z = chain()
    const first = ink.readLegendContextCached(a)
    const n = reads.mock.calls.length
    expect(n, 'the first read reads').toBeGreaterThan(0)
    const second = ink.readLegendContextCached(z)
    expect(reads.mock.calls.length, 'the second chart read its context again').toBe(n)
    expect(second).toEqual(first)
  })

  it('C2 an attribute changing anywhere on the chain reads again: a widget\'s inline token, the app theme on <html>', () => {
    const a = chain()
    ink.readLegendContextCached(a)
    let n = reads.mock.calls.length
    ink.readLegendContextCached(chain({ style: '--text: #222222; background: rgb(250, 250, 250)' }))
    expect(reads.mock.calls.length).toBeGreaterThan(n)
    n = reads.mock.calls.length
    document.documentElement.setAttribute('data-theme', 'light')
    ink.readLegendContextCached(a)
    expect(reads.mock.calls.length).toBeGreaterThan(n)
  })

  it('C3 a viewport change reads again (a media query can move a token)', () => {
    const a = chain()
    ink.readLegendContextCached(a)
    const n = reads.mock.calls.length
    const w = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w + 100 })
    try {
      ink.readLegendContextCached(a)
      expect(reads.mock.calls.length).toBeGreaterThan(n)
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
    }
  })

  it('C4 the answer is readLegendContext\'s own', () => {
    const a = chain()
    expect(ink.readLegendContextCached(a)).toEqual(ink.readLegendContext(a))
  })

  // (review of #2844) A PRODUCTION-SHAPED WRAPPER: its own attributes move with every chart and every frame (the tail bar,
  // the live badge, the pane height, its panel and layout variables, the inks this read publishes); none feeds the tokens
  function prodChart(host, { tail, badge, height, axis }) {
    const wrap = document.createElement('div')
    wrap.className = 'stockChartWrapper'
    wrap.setAttribute('data-bar-tail', String(tail))
    wrap.setAttribute('data-bar-currentness', 'current')
    if (badge) wrap.setAttribute('data-live-badge', badge)
    wrap.setAttribute('style', `height: ${height}px; --chart-panel-bg-low: rgb(${tail % 255}, 1, 2); --price-axis-w: ${axis}px; --lookback-bottom: 30px; --price-pane-top: 4px`)
    host.appendChild(wrap)
    return wrap
  }
  function board() {
    const host = document.createElement('div')
    host.className = 'widgetBody'
    host.setAttribute('style', '--text: #dddddd; background: rgb(10, 12, 14)')
    document.body.appendChild(host)
    return host
  }

  it('C5 a production-shaped wrapper: chart 2 of a board, and the same chart after its inks land, reuse the answer', () => {
    const host = board()
    const one = prodChart(host, { tail: 1795300000, badge: 'live', height: 412, axis: 52 })
    const first = ink.readLegendContextCached(one)
    const n = reads.mock.calls.length
    const two = prodChart(host, { tail: 1795212000, badge: null, height: 388, axis: 61 })
    expect(ink.readLegendContextCached(two), 'chart 2').toEqual(first)
    one.setAttribute('style', `${one.getAttribute('style')}; --legend-ink-bright: #eeeeee; --legend-val-lmin: 0.62`)
    one.setAttribute('data-bar-tail', '1795300060')
    expect(ink.readLegendContextCached(one), 'after its inks landed').toEqual(first)
    expect(reads.mock.calls.length, 'a volatile wrapper attribute made it read again').toBe(n)
  })

  it('C6 a role token declared on the wrapper itself, or a change of its class, still reads again', () => {
    const host = board()
    const one = prodChart(host, { tail: 1, badge: null, height: 400, axis: 50 })
    ink.readLegendContextCached(one)
    let n = reads.mock.calls.length
    const two = prodChart(host, { tail: 2, badge: null, height: 400, axis: 50 })
    two.style.setProperty('--text-muted', '#777777')
    ink.readLegendContextCached(two)
    expect(reads.mock.calls.length).toBeGreaterThan(n)
    n = reads.mock.calls.length
    const three = prodChart(host, { tail: 3, badge: null, height: 400, axis: 50 })
    three.className = 'stockChartWrapper sunrise'
    ink.readLegendContextCached(three)
    expect(reads.mock.calls.length).toBeGreaterThan(n)
  })

  it('C7 a media feature a token can be defined under (colour scheme, forced colours, contrast) changing reads again', () => {
    const real = window.matchMedia
    let dark = false
    window.matchMedia = (q) => ({ matches: q === '(prefers-color-scheme: dark)' ? dark : false, media: q, addEventListener() {}, removeEventListener() {} })
    try {
      const a = chain()
      ink.readLegendContextCached(a)
      const n = reads.mock.calls.length
      dark = true
      ink.readLegendContextCached(a)
      expect(reads.mock.calls.length).toBeGreaterThan(n)
    } finally { window.matchMedia = real }
  })

  it('C8 the opt-in counter counts hits and misses', () => {
    globalThis.__uctLegendContextStats = {}
    try {
      const a = chain()
      ink.readLegendContextCached(a)
      ink.readLegendContextCached(a)
      expect(globalThis.__uctLegendContextStats).toEqual({ misses: 1, hits: 1 })
    } finally { delete globalThis.__uctLegendContextStats }
  })
})
