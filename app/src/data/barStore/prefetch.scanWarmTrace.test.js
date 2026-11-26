// The opt-in scan-warm trace, the store's part (2026-11-26; utils/prefetchBars `scanTrace`). For each key of an URGENT
// next-row warm the facade writes what it read (`warm`: the registry's copy, the path: re-ask or warm), what the warm
// hydrated and decided (`warm-decide`: satisfied / preparing / cooling / ensure), the ask (`warm-ask`), the lane's part
// (utils/prefetchBars.scanTrace.test.js) and the outcome (`warm-done`: answered / held / aborted / error), and which later
// urgent call aborted it (`warm-abort`). ⛔ Only while `globalThis.__uctScanWarmTrace` is an array, and what is asked and
// held is the same with the trace on.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const at = (h, m, s = 0) => (OPEN + ((h * 60 + m) - (9 * 60 + 30)) * 60 + s) * 1000   // ET wall clock on Tue 2026-11-10
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  localStorage.setItem('barspack.version', 'test')
  delete globalThis.__uctScanWarmTrace
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem('barspack.version')
  delete globalThis.__uctScanWarmTrace
})

async function boot(mode) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor: () => mode })
  const { createBarStore } = await import('./index')
  const P = await import('./prefetch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = P.createPrefetch({ store, tickerMeta: () => {}, extended: () => false, visible: () => true, random: () => 0, deepNeighbors: () => false })
  return { server, store, pf, k: (sym) => pf.keyFor(sym, '1') }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
async function serve(w, ms) {
  for (let t = 0; t < ms; t += 10) {
    await tick(10)
    for (const c of w.server.open()) c.respond()
    await w.server.flush()
  }
}
async function warmNext(w, syms) {
  w.pf.prefetchBars(syms, '1', { urgent: true })
  await serve(w, 200)
}

/** Two rows warmed before a minute roll, the same rows after it (asked again), a third press in that bucket. */
async function session() {
  fakeDb._clear()
  vi.setSystemTime(at(10, 0, 55))
  const w = await boot('ok')
  await warmNext(w, ['AAA', 'BBB'])
  vi.setSystemTime(at(10, 1, 1))
  await warmNext(w, ['AAA', 'BBB'])
  vi.setSystemTime(at(10, 1, 20))
  await warmNext(w, ['AAA', 'CCC'])
  const out = {
    asked: w.server.calls.map((c) => JSON.stringify(c.q)),
    held: ['AAA', 'BBB', 'CCC'].map((s) => { const x = w.store.peek(w.k(s)); return [x?.status, x?.bars?.length, x?.bars?.at(-1)?.t, x?.developing?.t] }),
  }
  w.store.dispose()
  // nothing this session left scheduled may run inside the next one: the fake clock is shared, and a disposed
  // store's late persist write would land in the next session's (cleared) fake IndexedDB and change what it asks
  vi.clearAllTimers()
  return out
}

describe('the opt-in scan-warm trace: the urgent next-row warm', () => {
  it('T1 off (no array, or a value that is not one): nothing is written, and the warm asks and holds what it does traced', async () => {
    const off = await session()
    expect(globalThis.__uctScanWarmTrace).toBeUndefined()
    expect(off.asked.length, 'the session itself').toBeGreaterThan(0)
    const notArray = {}
    globalThis.__uctScanWarmTrace = notArray
    expect(await session()).toEqual(off)
    expect(Object.keys(notArray), 'a value that is not an array was written to').toEqual([])
    globalThis.__uctScanWarmTrace = []
    expect(await session(), 'the trace changed what the warm asked or what the store holds').toEqual(off)
    expect(globalThis.__uctScanWarmTrace.length).toBeGreaterThan(0)
  })

  it('T2 on: warm, decide, ask, the lane, answered, in order; after the roll the row is asked again; in that bucket it is satisfied', async () => {
    globalThis.__uctScanWarmTrace = []
    vi.setSystemTime(at(10, 0, 55))
    const w = await boot('ok')
    const k = w.k('AAA')
    const mine = (t, ev) => t.filter((e) => e.ev === ev && (e.key === k || e.url?.includes('/AAA?')))
    const first = (t, ev) => t.indexOf(mine(t, ev)[0])

    await warmNext(w, ['AAA', 'BBB'])
    const t1 = globalThis.__uctScanWarmTrace.splice(0)
    expect(mine(t1, 'warm')[0]).toMatchObject({ path: 'warm', reg: { held: false } })
    expect(mine(t1, 'warm-decide')[0]).toMatchObject({ decision: 'ensure', copy: { rows: 0 } })   // (an empty entry exists once the cache read ran)
    expect(mine(t1, 'warm-done')[0]).toMatchObject({ outcome: 'answered', copy: { held: true, rest: true, behind: 0 } })
    const order = ['warm', 'warm-decide', 'warm-ask', 'lane-queue', 'lane-start', 'warm-done'].map((ev) => first(t1, ev))
    expect(order.every((i) => i >= 0), JSON.stringify(t1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(new Set(t1.filter((e) => e.ev === 'warm').map((e) => e.call)).size, 'one call id per urgent call').toBe(1)
    expect(t1.every((e) => Number.isFinite(e.at))).toBe(true)

    vi.setSystemTime(at(10, 1, 1))                                     // after the roll: the copy is a bucket behind
    await warmNext(w, ['AAA', 'BBB'])
    const t2 = globalThis.__uctScanWarmTrace.splice(0)
    expect(mine(t2, 'warm')[0]).toMatchObject({ path: 'reask', reg: { held: true, rest: true, behind: 1 } })
    expect(mine(t2, 'warm-done')[0]).toMatchObject({ outcome: 'answered', copy: { behind: 0 } })

    vi.setSystemTime(at(10, 1, 20))                                    // the same bucket: the copy is the warm
    await warmNext(w, ['AAA', 'BBB'])
    const t3 = globalThis.__uctScanWarmTrace.splice(0)
    expect(mine(t3, 'warm')[0]).toMatchObject({ path: 'warm' })
    expect(mine(t3, 'warm-decide')[0]).toMatchObject({ decision: 'satisfied', copy: { behind: 0 } })
    expect(mine(t3, 'warm-ask')).toEqual([])
    w.store.dispose()
  })

  it('T3 a row the member passed is aborted by the later urgent call, and the trace names that call', async () => {
    globalThis.__uctScanWarmTrace = []
    vi.setSystemTime(at(10, 0, 55))
    const w = await boot('ok')
    w.pf.prefetchBars(['AAA'], '1', { urgent: true })
    await tick(10)                                                     // AAA is on its way, not answered
    w.pf.prefetchBars(['BBB'], '1', { urgent: true })                  // the member moved on
    await serve(w, 200)
    const t = globalThis.__uctScanWarmTrace
    const wA = t.find((e) => e.ev === 'warm' && e.key === w.k('AAA'))
    const wB = t.find((e) => e.ev === 'warm' && e.key === w.k('BBB'))
    expect(wB.call).toBeGreaterThan(wA.call)
    expect(t.find((e) => e.ev === 'warm-abort' && e.key === w.k('AAA'))).toMatchObject({ by: wB.call })
    expect(t.find((e) => e.ev === 'warm-done' && e.key === w.k('AAA'))?.outcome).toMatch(/^aborted/)
    w.store.dispose()
  })
})
