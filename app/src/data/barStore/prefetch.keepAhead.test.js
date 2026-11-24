// ⭐ THE ROWS AHEAD STAY RESIDENT UNTIL THE MEMBER REACHES THEM (replay of the minute feed, 2026-11-24, store off, 1m + 15m,
// S&P 500, one press per 2.5 s, 80 presses: presses 39-79 asked IN FULL for rows whose server answer the registry had
// evicted before the press: "answered-then-gone" on 15-21 of them).
// The registry keeps DEFAULT_MAX_KEYS entries (and DEFAULT_BAR_BUDGET bars), least recently used out first
// (registry.js `_evict`). A row ahead was last used when the list warmed it, ~26 presses (65 s) before the member reaches
// it; every key created or touched since is newer, and the neighbour hold pins only +-6 rows.
// What these rails establish (and what they do not):
//   K1 the scan's real warm paths at the default caps (the hold's +-6 pins, sendWarm, the list's prewarm as its window
//      scrolls, the dwell's all-timeframes warm, the two charts' subscriptions; ~8 new keys a press): the key cap binds
//      (not the bars: precondition shown), and no row ahead the list has warmed may lose its server answer before the
//      member reaches it. Checked every press over the 30 rows ahead, not only at the press: here an evicted row comes back
//      a local copy two buckets old that the urgent next-row warm re-asks before the press (the cost the replay saw as a
//      request at the press: its copies were one bucket old, which that warm's legacy rule accepts, so nobody asked).
//   K1b the same with EXTRA_KEYS more entries a press that no request shows (`peekBars` of unseen symbols).
//   With `keep` (the hold pins the next NEIGHBOR_KEEP_AHEAD rows), none is evicted.
//   K4 the keep is budgeted per PAGE, not per hold (review of #2691, MEDIUM-1): a list on a colour with five chart
//      timeframes has five holds; 30 rows each pinned ~185 of the 200 keys and left the typed, hover, dwell and other
//      lists' warms a pool of ~15. The five keep at most NEIGHBOR_KEEP_TOTAL (60) rows in all, and with the registry
//      full at least 100 entries stay evictable.
//   K3 the pins never stick: reversing the scan releases the rows that were ahead (only the new direction's are kept), a
//      70-row jump releases all of them, and clear() releases what is left. A keep pins only a row the list's warm has
//      FILLED (the server's answer here): never an absent key (it would make an empty entry) and never an existing EMPTY
//      one (a read in flight, a shed or failed warm): pinned, either would hide the row's cached copies from the first
//      looks that hydrate only a key the registry does not hold. A row that stays kept never passes through 0 refs (the
//      registry could evict it there), and a row both held (+-6) and kept holds both pins: it keeps the hold's once the
//      member is past it.
// Real store, real network, real facade, real registry and reducer, a fake server answering within 100 ms.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'
import { scanNeighbors } from '../../utils/scanNeighbors'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const at = (h, m, s = 0) => (OPEN + ((h * 60 + m) - (9 * 60 + 30)) * 60 + s) * 1000   // ET wall clock on Tue 2026-11-10
const EXTRA_KEYS = 8
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

async function boot() {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor: () => 'ok' })
  const { createBarStore } = await import('./index')
  const P = await import('./prefetch')
  const R = await import('./registry')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = P.createPrefetch({ store, tickerMeta: () => {}, extended: () => false, visible: () => true, random: () => 0.5, deepNeighbors: () => false })
  return { server, store, P, R, pf }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
async function serve(w, ms) {
  for (let t = 0; t < ms; t += 100) {
    await tick(100)
    for (const c of w.server.open()) c.respond()
    await w.server.flush()
  }
}

/** The scan, as the watchlist and the switch make it; `extra`: entries created a press beyond its own warms; `tfs`: the
 *  chart timeframes on the list's colour (one hold each); `onPress(i, w)`: a look at the end of each press. */
async function scan({ extra = 0, tfs = ['1', '15'], presses = 80, settle = 1_900, onPress = null }) {
  vi.setSystemTime(at(10, 7, 30))
  const w = await boot()
  const flat = Array.from({ length: 140 }, (_, i) => `S${String(i).padStart(3, '0')}`)
  // (the default board: a 1m and a 15m chart on the list's colour)
  const k = (sym, tf) => w.pf.keyFor(sym, tf)
  const keepAhead = w.P.NEIGHBOR_KEEP_AHEAD ?? 30
  const view = (i) => flat.slice(i, i + 26)                    // the list's rendered rows (the ones ahead)
  for (const tf of tfs) w.pf.prewarmVisibleList(view(0), { chartTf: tf })   // the list opens
  await serve(w, 3_000)
  const holds = new Map(tfs.map((tf) => [tf, w.pf.createNeighborHold()]))
  const subs = []
  let ctl = null
  const lost = []
  const evicted = []                                           // a row ahead whose server answer left the registry
  const answered = new Set()
  let maxKeys = 0
  let maxBars = 0
  for (let i = 1; i <= presses; i++) {
    const s = w.store.peek(k(flat[i], '1'))
    if (!s?.restSeen) lost.push(i)                             // what the switch finds at the press
    // every row ahead the list has warmed must still hold that answer (a re-ask after an eviction hides it at the press)
    for (let j = i; j <= i + 30; j++) {
      const held = !!w.store.peek(k(flat[j], '1'))?.restSeen
      if (held) answered.add(j)
      else if (answered.has(j)) { evicted.push(`${j}@${i}`); answered.delete(j) }
    }
    ctl?.abort()
    ctl = new AbortController()
    for (const tf of tfs) w.pf.prepareForDisplay(flat[i], tf, { signal: ctl.signal }).catch(() => {})
    for (const off of subs.splice(0)) off()
    for (const tf of tfs) subs.push(w.store.subscribe(k(flat[i], tf), () => {}))
    // the watchlist's sendWarm (Watchlists.jsx), after the paint
    const around = scanNeighbors(flat, i, 1, { ahead: 6, behind: 6 })
    const next = scanNeighbors(flat, i, 1, { ahead: 2, behind: 0 })
    const keep = scanNeighbors(flat, i, 1, { ahead: keepAhead, behind: 0 })
    for (const tf of tfs) {
      holds.get(tf).set(around, tf, { deep: next, tail: [...next, ...scanNeighbors(flat, i, 1, { ahead: 0, behind: 1 })], selected: flat[i], keep })
    }
    w.pf.warmMemFromIDB(around, tfs)
    for (const tf of tfs) w.pf.prefetchBarsToIDB(scanNeighbors(flat, i, 1, { ahead: 6, behind: 2 }), tf, { priority: true })
    for (const tf of tfs) w.pf.prefetchBars(next, tf, { urgent: true })
    for (const tf of tfs) w.pf.prewarmVisibleList(view(i), { chartTf: tf })
    for (let j = 0; j < extra; j++) w.pf.peekBars(`X${i}${String.fromCharCode(65 + j)}`, '5')   // entries no request shows
    await serve(w, 600)
    w.pf.prefetchAllTimeframes(flat[i])                        // the dwell (SCAN_DWELL_MS)
    await serve(w, settle)
    const st = w.store.registry.stats()
    maxKeys = Math.max(maxKeys, st.keys)
    maxBars = Math.max(maxBars, st.bars)
    onPress?.(i, w, flat)
  }
  for (const off of subs.splice(0)) off()
  for (const h of holds.values()) h.clear()
  w.store.dispose()
  return { lost, evicted, maxKeys, maxBars, R: w.R }
}

describe('the rows ahead stay resident until the member reaches them', () => {
  it("K1 the scan's own warms at the default caps: no row ahead loses its server answer before the member reaches it", async () => {
    const r = await scan({ extra: 0 })
    expect(r.R.DEFAULT_MAX_KEYS).toBe(200)
    expect(r.maxKeys).toBe(200)                                // the key cap binds...
    expect(r.maxBars).toBeLessThan(r.R.DEFAULT_BAR_BUDGET / 2) // ...not the bars
    expect(r.evicted, `rows ahead evicted (row@press): ${r.evicted.join(' ')}`).toEqual([])
    expect(r.lost).toEqual([])
  }, 240_000)

  it('K1b with more registry pressure (entries no request shows): the same', async () => {
    const r = await scan({ extra: EXTRA_KEYS })
    expect(r.maxKeys).toBe(200)
    expect(r.evicted, `rows ahead evicted (row@press): ${r.evicted.join(' ')}`).toEqual([])
    expect(r.lost).toEqual([])
  }, 240_000)
})

describe('the keep is budgeted per page, not per hold', () => {
  it('K4 five chart timeframes on one colour keep at most 60 rows ahead in all; with the registry full >= 100 entries stay evictable', async () => {
    const tfs = ['1', '5', '15', '30', '60']
    const over = []
    const starved = []
    let full = 0
    await scan({ tfs, presses: 40, settle: 5_000, onPress: (i, w, flat) => {
      const R = w.store.registry
      // a row beyond the hold's +-6 is pinned only by the keep; the 6 nearest of every hold's kept rows are also held
      let beyond = 0
      for (const tf of tfs) for (let j = i + 7; j <= i + 30; j++) if (R.refs(w.pf.keyFor(flat[j], tf)) > 0) beyond++
      if (beyond > 60 - tfs.length * 6) over.push(`${i}:${beyond}`)
      const keys = R.keys()
      if (keys.length >= 200) {
        full++
        const idle = keys.filter((x) => R.refs(x) === 0).length
        if (idle < 100) starved.push(`${i}:${idle}`)
      }
    } })
    expect(full).toBeGreaterThan(10)                           // the registry was full: eviction ran
    expect(over, `presses keeping more than 60 rows in all (press:rows kept beyond +-6): ${over.join(' ')}`).toEqual([])
    expect(starved, `presses with fewer than 100 evictable entries (press:idle): ${starved.join(' ')}`).toEqual([])
  }, 240_000)
})

describe('the rows kept ahead are released as the member moves', () => {
  it('K3 a reversal keeps only the new direction, a 70-row jump releases the old window, clear() releases the rest', async () => {
    vi.setSystemTime(at(10, 7, 30))
    const w = await boot()
    const flat = Array.from({ length: 140 }, (_, i) => `S${String(i).padStart(3, '0')}`)
    const k = (sym) => w.pf.keyFor(sym, '1')
    const N = w.P.NEIGHBOR_KEEP_AHEAD ?? 30
    const hold = w.pf.createNeighborHold()
    const press = (i, dir) => hold.set(scanNeighbors(flat, i, dir, { ahead: 6, behind: 6 }), '1', { keep: scanNeighbors(flat, i, dir, { ahead: N, behind: 0 }) })
    const refs = (sym) => w.store.registry.refs(k(sym))
    press(40, 1)                                               // nothing warmed yet: nothing kept, no entry made
    expect(w.store.registry.has(k(flat[60]))).toBe(false)
    // the list's warm: the server answers every row but one, which is left an EMPTY entry (a read in flight, a shed warm)
    w.pf.prefetchBarsToIDB(flat.filter((_, i) => i !== 61), '1', { priority: true, visible: true })
    await serve(w, 20_000)
    expect(w.store.peek(k(flat[60]))?.restSeen).toBe(true)
    w.store.registry.getSnapshot(k(flat[61]))
    expect(w.store.peek(k(flat[61]))?.bars?.length ?? 0).toBe(0)
    press(40, 1)                                               // scanning down at row 40
    expect(refs(flat[60])).toBe(1)                             // a row 20 ahead is pinned (kept, outside +-6)
    expect(refs(flat[70])).toBe(1)
    expect(refs(flat[61]), 'an existing EMPTY entry was pinned').toBe(0)
    expect(refs(flat[20])).toBe(0)                             // a row 20 behind is not
    expect(refs(flat[41]), 'a row held and kept: both pins').toBe(2)
    expect(refs(flat[45]), 'a row held and kept: both pins').toBe(2)
    // two rows down: a row that stays kept never drops to 0 refs on the way (released before it is pinned again)
    const release = w.store.registry.release
    const zeroed = []
    w.store.registry.release = (key) => { release(key); if (key === k(flat[65]) && w.store.registry.refs(key) === 0) zeroed.push(key) }
    press(42, 1)
    w.store.registry.release = release
    expect(zeroed, 'a row that stays kept dropped to 0 refs between two presses').toEqual([])
    expect(refs(flat[65])).toBe(1)
    expect(refs(flat[41]), 'a passed row still inside +-6 lost the hold pin').toBe(1)
    press(39, -1)                                              // the member turns back up
    expect(refs(flat[60])).toBe(0)                             // the rows that were ahead are released...
    expect(refs(flat[70])).toBe(0)
    expect(refs(flat[20])).toBe(1)                             // ...and the new direction's are kept
    press(109, 1)                                              // a 70-row jump, then down again
    expect(refs(flat[20])).toBe(0)
    expect(refs(flat[30])).toBe(0)
    expect(refs(flat[130])).toBe(1)
    hold.clear()
    expect(refs(flat[130])).toBe(0)
    w.store.dispose()
  }, 60_000)
})
