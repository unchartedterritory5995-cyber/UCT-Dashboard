// The next rows arrive deep (2026-11-17). Production flip proof (60m/15m/5m, members' default):
// first candles ~30 ms with ~470 bars, but 2,000+ bars only at ~470 ms — the landed chart waited
// DEEP_ARM_MS and then asked two older windows in turn. While the member rests on a row, the
// neighbor hold now asks those same windows for the rows named in `deep`, so the flip paints them
// deep. These tests pin the bounds: only after a rest, one request at a time, `grid` rank, up to the
// chart's own target, abandoned by the next selection, intraday only, switchable off.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { STATUS } from './types'
import { PREFETCH_WINDOWS, HISTORY_PREFETCH_TARGET_BARS, HISTORY_WINDOW_BARS } from '../../utils/historyPrepend'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function stubStore({ windowAnswer = () => ({ ok: true, added: HISTORY_WINDOW_BARS }), hold = false } = {}) {
  const snaps = new Map()
  const scrolls = []          // [key, priority]
  const pending = []          // resolvers of held windows
  let live = 0
  let maxLive = 0
  const answered = (k, depth) => ({ key: k, restSeen: true, status: STATUS.CURRENT, bars: [{ t: 1 }], depth, gen: 0 })
  const store = {
    registry: { acquire: vi.fn(), release: vi.fn() },
    persist: { hydrate: () => Promise.resolve(), hydrateMem: () => {} },
    peek: (k) => snaps.get(k) || null,
    ensure: vi.fn(async (k) => { const s = answered(k, 470); snaps.set(k, s); return s }),
    scrollBack: vi.fn((k, opts) => {
      scrolls.push([k, opts?.priority])
      live++; maxLive = Math.max(maxLive, live)
      const finish = () => {
        live--
        const res = windowAnswer(k)
        const s = snaps.get(k)
        if (res?.ok && res.added > 0 && s) snaps.set(k, { ...s, depth: s.depth + res.added })
        return res
      }
      if (!hold) return Promise.resolve().then(finish)
      return new Promise((resolve) => pending.push(() => resolve(finish())))
    }),
  }
  return { store, snaps, scrolls, pending, answered, stats: () => ({ live, maxLive }) }
}

async function boot(opts = {}) {
  const { createPrefetch, NEIGHBOR_DEEP_MS } = await import('./prefetch')
  const st = stubStore(opts)
  const timers = new Map()
  let id = 0
  const pf = createPrefetch({
    store: st.store, tickerMeta: () => {}, packIngesting: () => false, extended: () => false,
    setTimer: (fn, ms) => { const h = ++id; timers.set(h, { fn, ms }); return h },
    clearTimer: (h) => { timers.delete(h) },
    deepNeighbors: opts.deepNeighbors,
  })
  const fire = async (ms = NEIGHBOR_DEEP_MS) => {
    for (const [h, t] of [...timers]) if (t.ms === ms) { timers.delete(h); t.fn() }
    await flush()
  }
  const k = (sym, tf = '5') => pf.keyFor(sym, tf)
  const seed = (sym, tf = '5', depth = 470) => st.snaps.set(k(sym, tf), st.answered(k(sym, tf), depth))
  return { ...st, pf, fire, k, seed, timers, NEIGHBOR_DEEP_MS }
}

beforeEach(() => { try { localStorage.clear() } catch { /* no storage */ } })

describe('the neighbor hold deepens the next rows once the member rests', () => {
  it('asks the chart\'s own windows for each deep row, in order, at grid rank, up to its target', async () => {
    const t = await boot()
    t.seed('AAA'); t.seed('BBB'); t.seed('CCC')
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA', 'BBB', 'CCC'], '5', { deep: ['AAA', 'BBB'] })
    expect(t.scrolls).toEqual([])                                    // nothing before the rest
    await t.fire()
    const want = []
    for (const sym of ['AAA', 'BBB']) for (let i = 0; i < PREFETCH_WINDOWS; i++) want.push([t.k(sym), 'grid'])
    expect(t.scrolls).toEqual(want)
    expect(t.snaps.get(t.k('AAA')).depth).toBe(470 + PREFETCH_WINDOWS * HISTORY_WINDOW_BARS)
    expect(t.scrolls.some(([key]) => key === t.k('CCC'))).toBe(false) // only the rows named in `deep`
  })

  it('where the lake carries the row, its target is the lake\'s: it goes on past the server target', async () => {
    const { LAKE_PREFETCH_TARGET_BARS } = await import('../../utils/historyPrepend')
    const t = await boot()
    t.store.lakeCarries = () => true
    t.seed('AAA', '5', HISTORY_PREFETCH_TARGET_BARS)                 // at the SERVER target already
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA'], '5', { deep: ['AAA'] })
    await t.fire()
    expect(t.scrolls.length).toBe(PREFETCH_WINDOWS)                   // still deepened toward the lake's
    t.snaps.set(t.k('AAA'), t.answered(t.k('AAA'), LAKE_PREFETCH_TARGET_BARS))
    t.scrolls.length = 0
    hold.set(['AAA'], '5', { deep: ['AAA'] })
    await t.fire()
    expect(t.scrolls).toEqual([])                                     // at the lake target: done
  })

  it('where the lake carries the row, ONE lake load brings its whole depth: no window is asked', async () => {
    const t = await boot()
    t.store.lakeCarries = () => true
    t.store.lakeSeed = vi.fn(async () => 'join')
    t.seed('AAA')
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA'], '5', { deep: ['AAA'] })
    await t.fire()
    expect(t.store.lakeSeed).toHaveBeenCalledWith(t.k('AAA'))
    expect(t.scrolls).toEqual([])
    // a lake that adds nothing (it ends before the row's answer) hands over to the windows
    t.store.lakeSeed = vi.fn(async () => false)
    hold.set(['AAA'], '5', { deep: ['AAA'] })
    await t.fire()
    expect(t.scrolls.length).toBeGreaterThan(0)
  })

  it('never asks a row already at the chart\'s target', async () => {
    const t = await boot()
    t.seed('AAA', '5', HISTORY_PREFETCH_TARGET_BARS)
    t.seed('BBB')
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], '5', { deep: ['AAA', 'BBB'] })
    await t.fire()
    expect(t.scrolls.filter(([key]) => key === t.k('AAA'))).toEqual([])
    expect(t.scrolls.filter(([key]) => key === t.k('BBB')).length).toBe(PREFETCH_WINDOWS)
  })

  it('one request at a time', async () => {
    const t = await boot({ hold: true })
    t.seed('AAA'); t.seed('BBB')
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], '5', { deep: ['AAA', 'BBB'] })
    await t.fire()
    for (let i = 0; i < 2 * PREFETCH_WINDOWS && t.pending.length; i++) { t.pending.shift()(); await flush() }
    expect(t.scrolls.length).toBe(2 * PREFETCH_WINDOWS)
    expect(t.stats().maxLive).toBe(1)
  })

  it('a selection that moves before the rest starts nothing for the row it left', async () => {
    const t = await boot()
    t.seed('AAA'); t.seed('BBB')
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA'], '5', { deep: ['AAA'] })
    hold.set(['BBB'], '5', { deep: ['BBB'] })                        // a held key stepped on
    await t.fire()
    expect(t.scrolls.map(([key]) => key)).toEqual(Array(PREFETCH_WINDOWS).fill(t.k('BBB')))
  })

  it('a new selection abandons the deepening in progress', async () => {
    const t = await boot({ hold: true })
    t.seed('AAA'); t.seed('BBB'); t.seed('CCC')
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], '5', { deep: ['AAA', 'BBB'] })
    await t.fire()
    expect(t.scrolls.length).toBe(1)                                  // AAA's first window in flight
    // The member moved on; AAA and BBB are still in the new window (still held), so only the
    // selection's own generation can stop their deepening.
    hold.set(['AAA', 'BBB', 'CCC'], '5', { deep: ['CCC'] })
    t.pending.shift()(); await flush()
    expect(t.scrolls.map(([key]) => key)).toEqual([t.k('AAA')])       // nothing more for AAA / BBB
    await t.fire()
    expect(t.scrolls.slice(1).map(([key]) => key)[0]).toBe(t.k('CCC'))
  })

  it('clear stops it (a list that unmounts asks nothing more)', async () => {
    const t = await boot()
    t.seed('AAA')
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA'], '5', { deep: ['AAA'] })
    expect(t.timers.size).toBe(1)
    hold.clear()
    expect(t.timers.size).toBe(0)                                    // no timer outlives the list
    await t.fire()
    expect(t.scrolls).toEqual([])
  })

  it('a row held only as a local copy gets its server answer first', async () => {
    const t = await boot()
    t.snaps.set(t.k('AAA'), { key: t.k('AAA'), restSeen: false, status: STATUS.PROVISIONAL, bars: [{ t: 1 }], depth: 300, gen: 0 })
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA'], '5', { deep: ['AAA'] })
    await t.fire()
    expect(t.store.ensure).toHaveBeenCalled()
    expect(t.scrolls.length).toBe(PREFETCH_WINDOWS)
  })

  it('a row that still holds only a local copy after the warm gets the lake depth (no window on a local copy)', async () => {
    const t = await boot()
    t.store.lakeCarries = () => true
    t.store.lakeSeed = vi.fn(async () => 'seed')
    const local = { key: t.k('AAA'), restSeen: false, status: STATUS.CONTEXT, bars: [{ t: 1 }], depth: 1034, gen: 0 }
    t.snaps.set(t.k('AAA'), local)
    t.store.ensure = vi.fn(async () => local)                         // the warm got no server answer
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA'], '5', { deep: ['AAA'] })
    await t.fire()
    expect(t.store.lakeSeed).toHaveBeenCalledWith(t.k('AAA'))
    expect(t.scrolls).toEqual([])                                    // a server window never prepends to a local copy
  })

  it('off the lake, a row that still holds only a local copy is left for the chart (nothing asked)', async () => {
    const t = await boot()
    t.store.lakeSeed = vi.fn(async () => 'seed')
    const local = { key: t.k('AAA'), restSeen: false, status: STATUS.CONTEXT, bars: [{ t: 1 }], depth: 1034, gen: 0 }
    t.snaps.set(t.k('AAA'), local)
    t.store.ensure = vi.fn(async () => local)
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA'], '5', { deep: ['AAA'] })
    await t.fire()
    expect(t.store.lakeSeed).not.toHaveBeenCalled()
    expect(t.scrolls).toEqual([])
  })

  it('a window with nothing older, refused, still filling or failed ends that row, not the next', async () => {
    for (const answer of [{ ok: true, added: 0 }, { ok: true, added: 0, refused: true }, { ok: true, added: 10, filling: true }, { error: true }, null]) {
      const t = await boot({ windowAnswer: (key) => (key.startsWith('AAA') ? answer : { ok: true, added: HISTORY_WINDOW_BARS }) })
      t.seed('AAA'); t.seed('BBB')
      const hold = t.pf.createNeighborHold()
      hold.set(['AAA', 'BBB'], '5', { deep: ['AAA', 'BBB'] })
      await t.fire()
      expect(t.scrolls.filter(([key]) => key === t.k('AAA')).length).toBe(1)
      expect(t.scrolls.filter(([key]) => key === t.k('BBB')).length).toBe(PREFETCH_WINDOWS)
    }
  })

  it('a window that THROWS ends that row as a named failure (TERM-033), and the next row is still deepened', async () => {
    // Without the named sentinel the rejection escapes `deepen` and the timer's catch swallows the
    // WHOLE run: BBB, the next row, would never be deepened.
    const t = await boot({ windowAnswer: (key) => { if (key.startsWith('AAA')) throw new Error('window read failed'); return { ok: true, added: HISTORY_WINDOW_BARS } } })
    t.seed('AAA'); t.seed('BBB')
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], '5', { deep: ['AAA', 'BBB'] })
    await t.fire()
    expect(t.scrolls.filter(([key]) => key === t.k('AAA')).length).toBe(1)
    expect(t.scrolls.filter(([key]) => key === t.k('BBB')).length).toBe(PREFETCH_WINDOWS)
    expect(t.snaps.get(t.k('AAA')).depth).toBe(470)                  // a failed window adds nothing
  })

  it('scroll-back windows are intraday only (daily rows join their sealed history instead: prefetch.deepDaily.test.js), and only rows the hold holds', async () => {
    const t = await boot()
    t.seed('AAA', 'D'); t.seed('BBB'); t.seed('ZZZ')
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA'], 'D', { deep: ['AAA'] })
    for (const ms of [...t.timers.values()].map((x) => x.ms)) await t.fire(ms)
    expect(t.scrolls).toEqual([])                                    // daily: never an intraday window
    hold.set(['BBB'], '5', { deep: ['ZZZ'] })                        // ZZZ is not in the window
    expect(t.timers.size).toBe(0)
    await t.fire()
    expect(t.scrolls).toEqual([])
  })

  it('switched off, nothing is asked', async () => {
    const t = await boot({ deepNeighbors: () => false })
    t.seed('AAA')
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA'], '5', { deep: ['AAA'] })
    await t.fire()
    expect(t.scrolls).toEqual([])
  })

  it('the switch: on by default, off by either browser key', async () => {
    const { deepNeighborsEnabled } = await import('./prefetch')
    expect(deepNeighborsEnabled()).toBe(true)
    localStorage.setItem('uct.deepNeighbors', '0')
    expect(deepNeighborsEnabled()).toBe(false)
    localStorage.clear()
    localStorage.setItem('uct.intradayDeepBackfill.enabled', '0')
    expect(deepNeighborsEnabled()).toBe(false)
    localStorage.setItem('uct.intradayDeepBackfill.enabled', '1')
    expect(deepNeighborsEnabled()).toBe(true)
  })

  it('without `deep` the hold only holds (callers that pass nothing are unchanged)', async () => {
    const t = await boot()
    t.seed('AAA')
    const hold = t.pf.createNeighborHold()
    hold.set(['AAA'], '5')
    expect(t.timers.size).toBe(0)
    await t.fire()
    expect(t.scrolls).toEqual([])
  })
})
