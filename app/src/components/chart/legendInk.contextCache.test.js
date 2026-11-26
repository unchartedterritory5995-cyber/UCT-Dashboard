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
})
