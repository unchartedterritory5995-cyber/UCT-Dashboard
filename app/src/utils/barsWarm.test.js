// The warmers' door forwards to the SAME source the chart reads: the store's facade once it has
// registered itself (it does so on load, under BARSTORE only), the legacy module otherwise — so a
// list's warm lands where the flip looks.
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  delete globalThis.__uctStoreWarmers
  vi.resetModules()
  vi.doUnmock('../components/chart/barStoreSwitch')
  vi.doUnmock('./prefetchBars')
})

const NAMES = ['prefetchBars', 'prefetchBar', 'prefetchBarsToIDB', 'prefetchAllTimeframes',
  'prefetchListAllTimeframes', 'prefetchGridWarm', 'warmMemFromIDB', 'prewarmVisibleList',
  'prefetchListDeep', 'prefetchReplayTimeframes', 'prefetchBarOnIntent']

function stubModule(tag, calls) {
  const m = {}
  for (const n of NAMES) m[n] = (...a) => { calls.push([tag, n, ...a]); return tag }
  return m
}

async function door() {
  vi.resetModules()
  const calls = []
  vi.doMock('./prefetchBars', () => stubModule('legacy', calls))
  const d = await import('./barsWarm')
  return { d, calls }
}

describe('barsWarm: the warmers follow the chart source', () => {
  it('no registered store (BARSTORE off, or no chart loaded yet): the legacy module, unchanged', async () => {
    const { d, calls } = await door()
    expect(d.prefetchBarsToIDB(['AAA'], '5', { priority: true })).toBe('legacy')
    expect(calls).toEqual([['legacy', 'prefetchBarsToIDB', ['AAA'], '5', { priority: true }]])
  })

  it('the store registered: every call goes to it, with the same arguments', async () => {
    const { d, calls } = await door()
    globalThis[d.STORE_WARMERS_KEY] = stubModule('store', calls)
    d.prewarmVisibleList(['A', 'B'], { chartTf: '60' })
    d.warmMemFromIDB(['C'], ['60'])
    expect(calls).toEqual([
      ['store', 'prewarmVisibleList', ['A', 'B'], { chartTf: '60' }],
      ['store', 'warmMemFromIDB', ['C'], ['60']],
    ])
  })

  it('every forwarded name has a door function', async () => {
    const { d } = await door()
    expect([...d.WARMER_NAMES].sort()).toEqual([...NAMES].sort())
    for (const n of d.WARMER_NAMES) expect(typeof d[n]).toBe('function')
  })
})

describe('the facade registers itself under BARSTORE only', () => {
  async function facadeWith(on) {
    vi.resetModules()
    delete globalThis.__uctStoreWarmers
    vi.doMock('../components/chart/barStoreSwitch', () => ({ BARSTORE: on, BARSTORE_STORAGE_KEY: 'uct.barStore' }))
    const facade = await import('../data/barStore/prefetch')
    const d = await import('./barsWarm')
    return { facade, d }
  }

  it('BARSTORE on: registered under the door key, with exactly the door names', async () => {
    const { facade, d } = await facadeWith(true)
    expect(globalThis[d.STORE_WARMERS_KEY]).toBe(facade.STORE_WARMERS)
    // the forwarded warmers, plus the store-only neighbor hold
    expect(Object.keys(facade.STORE_WARMERS).sort()).toEqual([...d.WARMER_NAMES, 'createNeighborHold'].sort())
    expect(d.warmers()).toBe(facade.STORE_WARMERS)
  })

  it('a neighbor hold drives the store once registered, and is a no-op on the legacy path', async () => {
    const { d, calls } = await door()
    const legacyHold = d.createNeighborHold()
    expect(() => { legacyHold.set(['A'], '5'); legacyHold.clear() }).not.toThrow()   // legacy: nothing to pin
    const seen = []
    globalThis[d.STORE_WARMERS_KEY] = { ...stubModule('store', calls),
      createNeighborHold: () => ({ set: (...a) => seen.push(['set', ...a]), clear: () => seen.push(['clear']) }) }
    const hold = d.createNeighborHold()
    hold.set(['A', 'B'], '60')
    hold.clear()
    expect(seen).toEqual([['set', ['A', 'B'], '60', undefined], ['clear']])
  })

  it('BARSTORE off: nothing registered, the door stays on the legacy module', async () => {
    const { d } = await facadeWith(false)
    expect(globalThis[d.STORE_WARMERS_KEY]).toBeUndefined()
    expect(d.warmers()).toBe(await import('./prefetchBars'))
  })
})
