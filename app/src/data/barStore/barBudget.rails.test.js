// ⭐⭐ ONE PAGE BUDGET FOR EVERY PER-SYMBOL BAR CACHE (2026-11-27, the heap check; lib/barBudget.js).
//
// Measured on production's build (df6d39a8b6, V8's sampling heap profile after a forced GC, a 1m + 15m board, 50
// watchlist presses): 336.6 MB retained, ~90% bars kept per VISITED symbol: the registry's decoded rows (133.7 MB; its
// 2,500,000-bar bound never bound on that board), the adapter's legacy copies (68 MB; two memos with a budget EACH over
// the same copies), persist's saved copies in the mem cache (44 MB; 500,000 rows), the derived rows (~39 MB, inside their
// own budget). What these rails establish:
//   B1 the registry, at the DEFAULT bounds, on a 1m + 15m board scanned 24 rows (real depths: 20,000 1m bars, 25,000 15m
//      bars a row), never holds more than the page budget's registry share beyond what is pinned; and at every press the
//      rows on screen, the shadow's, the list's kept neighbours and the RECENT_SYMBOLS rows just left are all held.
//   B2 a pinned row (a subscriber: on screen, the shadow; a hold: the list's neighbours) is never evicted, however far
//      over the budget the page is; released, it goes like any other.
//   B3 the recently shown symbols go LAST: with room for them, every other idle entry (the dwell's first) goes before
//      them; under more pressure the oldest of them goes, never a pinned one.
//   B4 an entry the registry drops takes the adapter's slot of its key with it: the store's rows it held are collected.
//   B5 the adapter's copies obey ONE budget: the array legacyBars hands out and the sealed copy behind it share a slot, so
//      a re-read key (a chart's render hitting its snapshot) cannot keep copies alive past the budget.
//   B6 the mem cache (saved copies in front of IndexedDB) holds at most the page budget's mem share.
//   B7 an evicted symbol reloads its FULL history exactly (the server's answer and the lake's depth, one join) and its
//      chart reads the same rows as before the eviction.
//   B8 BY BYTES, THE DAILY BASES STAY (owner: instant full loads at any zoom or date; D/W/M carry the whole history since
//      listing): the registry evicts the intraday arrays first, every visited symbol's daily base stays while any
//      intraday array can go, and among daily bases a non-recent one goes before a recent one.
//   B9 the adapter's slots and the mem cache's entries drop an intraday one before a daily one.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import v8 from 'node:v8'
import vm from 'node:vm'
import { createRegistry, DEFAULT_BAR_BUDGET } from './registry'
import { createBarStore } from './index'
import { keyOf } from './types'
import { legacyBars, _adapterMemoStats, _resetAdapterMemos, _setAdapterMemoLimits } from './adapter'
import { BAR_BUDGET_DESKTOP, BAR_BUDGET_TOUCH, BYTES_PER_BAR, barsHeld } from '../../lib/barBudget'
import { memPut, memPeek, memClear, _memStats, MEM_CACHE_MAX_ROWS } from '../../utils/barsMemCache'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'

const gcNow = (() => { try { v8.setFlagsFromString('--expose-gc'); return vm.runInNewContext('gc') } catch { return null } })()
const settle = () => new Promise((res) => setTimeout(res, 0))

const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000     // Tue 09:30 ET
const NOW = (OPEN + 40 * 60) * 1000
const DAY = 86400

// `n` sealed rows `step` seconds apart, ending before today's session: regular-hours buckets of the weekdays before it
// (D: one a weekday, at 00:00 UTC of its date), so the reducer keeps every one of them
const _wire = new Map()
function rowsOf(n, step, k = 1) {
  const id = `${n}|${step}|${k}`
  if (!_wire.has(id)) {
    const ts = []
    for (let day = OPEN - DAY; ts.length < n; day -= DAY) {
      const wd = new Date(day * 1000).getUTCDay()
      if (wd === 0 || wd === 6) continue
      if (step >= DAY) { ts.push(day - (day % DAY)); continue }
      const dayTs = []
      for (let t = day; t < day + 390 * 60; t += step) dayTs.push(t)
      ts.push(...dayTs.reverse())
    }
    ts.length = n
    ts.reverse()
    _wire.set(id, ts.map((t, i) => {
      const p = 100 * k + (i % 97) * 0.01
      return { t, o: p, h: p + 0.5, l: p - 0.5, c: p + 0.1, v: 1000 + i }
    }))
  }
  return _wire.get(id)
}
const full = (n, step, k) => ({ type: 'rest-full', payload: { bars: rowsOf(n, step, k) } })
const K1 = (s) => keyOf({ sym: s, tf: '1' })
const K15 = (s) => keyOf({ sym: s, tf: '15' })
const SYMS = Array.from({ length: 40 }, (_, i) => `R${String(i).padStart(2, '0')}`)

describe('B1 the registry at its default bounds: a 1m + 15m board scanned', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  it('holds at most the page share beyond what is pinned; on screen, shadow, neighbours and recent rows stay held', () => {
    expect(DEFAULT_BAR_BUDGET).toBe(BAR_BUDGET_DESKTOP.registry)
    expect(BAR_BUDGET_TOUCH.registry).toBeLessThan(BAR_BUDGET_DESKTOP.registry)
    const reg = createRegistry({ ctx: () => ({ nowMs: NOW }) })   // the defaults: what the app's store is built with
    const subs = new Map()   // key -> unsubscribe (the front pane and the shadow pane, one per timeframe)
    const holds = new Set()  // keys the list's hold pins (acquire)
    const show = (keys) => {
      for (const [k, off] of [...subs]) if (!keys.includes(k)) { off(); subs.delete(k) }
      for (const k of keys) if (!subs.has(k)) subs.set(k, reg.subscribe(k, () => {}))
    }
    const hold = (keys) => {
      for (const k of [...holds]) if (!keys.includes(k)) { holds.delete(k); reg.release(k) }
      for (const k of keys) if (!holds.has(k)) { holds.add(k); reg.acquire(k) }
    }
    const SHARE = BAR_BUDGET_DESKTOP.registry, RECENT = BAR_BUDGET_DESKTOP.recentSymbols
    let maxOver = 0
    const deep = new Set()   // rows loaded at full depth (a row's two keys: the lake's ~20k 1m and ~25k 15m bars)
    const PRESSES = 24
    for (let i = 0; i < PRESSES; i++) {
      const row = SYMS[i], shadow = SYMS[i + 1]
      // the list's warm of the rows ahead: first-paint depth, held by the list (keep)
      const ahead = SYMS.slice(i + 2, i + 6)
      for (const s of ahead) if (!reg.peek(K1(s))?.bars.length) { reg.dispatch(K1(s), full(1100, 60, 1)); reg.dispatch(K15(s), full(1100, 900, 2)) }
      hold(ahead.flatMap((s) => [K1(s), K15(s)]))
      // the press: the row and the shadow (the row ahead) are shown, at their full depth
      show([K1(row), K15(row), K1(shadow), K15(shadow)])
      for (const s of [row, shadow]) {
        if (deep.has(s)) continue
        deep.add(s)
        reg.dispatch(K1(s), full(20000, 60, 1))
        reg.dispatch(K15(s), full(25000, 900, 2))
      }
      // the dwell's warm of the row's other timeframes (5m, 60m): first out once the row is left
      for (const tf of ['5', '60']) {
        const k = keyOf({ sym: row, tf })
        reg.dispatch(k, full(tf === '5' ? 8000 : 4000, tf === '5' ? 300 : 3600, 3))
        reg.setDwell(k)
      }
      let pinned = 0
      for (const k of reg.keys()) if (reg.refs(k) > 0 || subs.has(k)) pinned += reg.peek(k).depth
      const st = reg.stats()
      maxOver = Math.max(maxOver, st.bars - Math.max(SHARE, pinned))
      expect(st.bars, `press ${i}: ${st.bars} bars held, pinned ${pinned}`).toBeLessThanOrEqual(Math.max(SHARE, pinned))
      // what must stay warm: on screen, the shadow, the kept rows ahead, and the RECENT_SYMBOLS rows just left
      for (const k of [...subs.keys(), ...holds]) expect(reg.has(k), `press ${i}: pinned ${k}`).toBe(true)
      const left = SYMS.slice(Math.max(0, i - RECENT + 2), i)   // the shadow + row take two of the recent slots
      for (const s of left) {
        expect(reg.has(K1(s)) && reg.has(K15(s)), `press ${i}: ${s}, left ${i - SYMS.indexOf(s)} presses ago, is cold`).toBe(true)
        expect(reg.peek(K1(s)).depth).toBeGreaterThan(19000)   // (the reducer drops the holidays' rows)
      }
    }
    expect(maxOver).toBeLessThanOrEqual(0)
    expect(reg.stats().bars, 'the scan reached the share: the budget, not the scan, bounds it').toBeGreaterThan(SHARE * 0.8)
  })
})

describe('B2 a pinned row is never evicted', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  it('on screen, shadow (subscribers) and the list hold (acquire) survive any pressure; released they go', () => {
    const reg = createRegistry({ barBudget: 1000, recentSymbols: 0, ctx: () => ({ nowMs: NOW }) })
    const front = K1('FRONT'), shadow = K1('SHADOW'), kept = K1('KEPT')
    const offF = reg.subscribe(front, () => {}), offS = reg.subscribe(shadow, () => {})
    reg.acquire(kept)
    for (const k of [front, shadow, kept]) reg.dispatch(k, full(900, 60, 1))   // 2,700 bars pinned: 2.7x the budget
    for (let i = 0; i < 30; i++) reg.dispatch(K1(SYMS[i]), full(400, 60, 2))
    for (const k of [front, shadow, kept]) {
      expect(reg.has(k), k).toBe(true)
      expect(reg.peek(k).depth).toBe(900)
    }
    expect(reg.stats().bars).toBeLessThanOrEqual(2700 + 400)   // the pinned rows and the newest idle one at most
    offF(); offS(); reg.release(kept)
    for (let i = 30; i < 36; i++) reg.dispatch(K1(SYMS[i]), full(400, 60, 2))
    for (const k of [front, shadow, kept]) expect(reg.has(k), `${k} released`).toBe(false)
    expect(reg.stats().bars).toBeLessThanOrEqual(1000)
  })
})

describe('B3 the recently shown symbols go last', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  it('every other idle entry (the dwell\'s first) goes before them; under more pressure the oldest goes', () => {
    const reg = createRegistry({ barBudget: 3000, recentSymbols: 3, ctx: () => ({ nowMs: NOW }) })
    // a warm nobody showed, older than everything
    reg.dispatch(K1('WARM'), full(500, 60, 1))
    // three rows shown in turn, then left
    for (const s of ['A', 'B', 'C']) {
      const off = reg.subscribe(K1(s), () => {})
      reg.dispatch(K1(s), full(600, 60, 1))
      off()
    }
    // the dwell's warm of C's other timeframe, then fresh warms that push the registry over budget
    reg.dispatch(keyOf({ sym: 'C', tf: '5' }), full(500, 300, 1)); reg.setDwell(keyOf({ sym: 'C', tf: '5' }))
    expect(reg.recentSymbols()).toEqual(['C', 'B', 'A'])
    reg.dispatch(K1('NEW1'), full(1000, 60, 2))  // 3,800 > 3,000: the dwell's (C 5m), then WARM go, never A/B/C
    expect(reg.has(keyOf({ sym: 'C', tf: '5' }))).toBe(false)
    expect(reg.has(K1('WARM'))).toBe(false)
    for (const s of ['A', 'B', 'C']) expect(reg.has(K1(s)), `${s} recent`).toBe(true)
    reg.dispatch(K1('NEW2'), full(500, 60, 2))   // only idle entries left: NEW1 (older) and the recent ones
    expect(reg.has(K1('NEW1'))).toBe(false)
    for (const s of ['A', 'B', 'C']) expect(reg.has(K1(s)), `${s} recent`).toBe(true)
    reg.dispatch(K1('NEW3'), full(1300, 60, 2))  // NEW2 goes, still over: NEW3 just landed stays, the OLDEST recent row goes, A
    expect(reg.has(K1('A'))).toBe(false)
    expect(reg.has(K1('B')) && reg.has(K1('C')) && reg.has(K1('NEW3'))).toBe(true)
    expect(reg.stats().bars).toBeLessThanOrEqual(3000)
  })
})

describe('B4 an entry the registry drops takes the adapter slot of its key with it', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); _resetAdapterMemos() })
  afterEach(() => { vi.useRealTimers(); _resetAdapterMemos() })

  it('the slot goes, and the store rows it held are collected', async () => {
    expect(typeof gcNow).toBe('function')
    const reg = createRegistry({ barBudget: 2000, recentSymbols: 0, ctx: () => ({ nowMs: NOW }) })
    const D = (s) => keyOf({ sym: s, tf: 'D' })
    reg.dispatch(D('GONE'), full(800, DAY, 1))
    const { rowsRef, outRef } = (() => {   // (no strong reference outlives this scope)
      const s0 = reg.peek(D('GONE'))
      const out = legacyBars(s0, 'D')
      expect(out.length).toBe(800)
      expect(out).not.toBe(s0.bars)   // D: a legacy copy (t -> label)
      return { rowsRef: new globalThis.WeakRef(s0.bars), outRef: new globalThis.WeakRef(out) }
    })()
    expect(_adapterMemoStats().legacy.keys).toContain(`${D('GONE')}|D`)
    for (const s of ['X1', 'X2', 'X3']) reg.dispatch(D(s), full(800, DAY, 2))
    expect(reg.has(D('GONE'))).toBe(false)
    expect(_adapterMemoStats().legacy.keys).not.toContain(`${D('GONE')}|D`)
    await settle()
    gcNow()
    expect(rowsRef.deref(), "the dropped key's store rows").toBeUndefined()
    expect(outRef.deref(), "the dropped key's legacy copy").toBeUndefined()
  })
})

describe('B5 the adapter copies obey one budget', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); _resetAdapterMemos() })
  afterEach(() => { vi.useRealTimers(); _resetAdapterMemos() })

  it('a key re-read every render keeps no more copies alive than the budget', async () => {
    expect(typeof gcNow).toBe('function')
    _setAdapterMemoLimits({ maxEntries: 32, maxBars: 1000 })
    const reg = createRegistry({ ctx: () => ({ nowMs: NOW }) })
    const D = (s) => keyOf({ sym: s, tf: 'D' })
    const alive = []
    const read = (s) => { const out = legacyBars(reg.peek(D(s)), 'D'); if (!alive.some((r) => r.deref() === out)) alive.push(new globalThis.WeakRef(out)); return out }
    reg.dispatch(D('HOT'), full(400, DAY, 1))
    read('HOT')
    for (let i = 0; i < 6; i++) {
      reg.dispatch(D(SYMS[i]), full(400, DAY, 2))
      read(SYMS[i])
      read('HOT')   // the chart on screen re-reads its snapshot every render
    }
    await settle()
    gcNow()
    const held = alive.map((r) => r.deref()).filter(Boolean)
    const copies = new Set()
    for (const a of held) for (const b of a) copies.add(b)
    expect(copies.size, `${held.length} arrays alive`).toBeLessThanOrEqual(1000)
    expect(_adapterMemoStats().legacy.bars).toBeLessThanOrEqual(1000)
  })
})

describe('B6 the mem cache holds at most the page budget\'s mem share', () => {
  afterEach(() => memClear())
  it('twenty deep keys written: the newest stay, the share holds', () => {
    memClear()
    expect(MEM_CACHE_MAX_ROWS).toBe(BAR_BUDGET_DESKTOP.mem)
    const rows = rowsOf(20000, 60, 1)
    for (let i = 0; i < 20; i++) memPut(SYMS[i], '1', rows, { savedAt: NOW })
    expect(_memStats().rows).toBeLessThanOrEqual(BAR_BUDGET_DESKTOP.mem)
    expect(barsHeld().byCache.mem.bars).toBe(_memStats().rows)
    expect(barsHeld().byCache.mem.bytes).toBe(_memStats().rows * BYTES_PER_BAR.mem)
  })
})

// ── B8/B9: by bytes, the daily bases stay (owner: instant full loads at any zoom or date) ────────────────────────────
describe('B8 the registry lets the intraday arrays go first; the daily bases stay', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  it('a D + 1m board scanned past the budget: every visited D base stays while any intraday array can go', () => {
    const D = (s) => keyOf({ sym: s, tf: 'D' })
    // a whole daily history since listing (~20 years) is 5,000 bars; a 1m key 20,000
    const reg = createRegistry({ barBudget: 120_000, recentSymbols: 2, ctx: () => ({ nowMs: NOW }) })
    const subs = []
    for (let i = 0; i < 12; i++) {
      for (const off of subs.splice(0)) off()
      const s = SYMS[i]
      subs.push(reg.subscribe(D(s), () => {}), reg.subscribe(K1(s), () => {}))
      reg.dispatch(D(s), full(5000, DAY, 1))
      reg.dispatch(K1(s), full(20000, 60, 1))
      expect(reg.stats().bars, `press ${i}`).toBeLessThanOrEqual(120_000)
      // every daily base visited so far is held (12 x 5,000 = 60,000 fit; the intraday arrays paid for the room)
      for (let j = 0; j <= i; j++) expect(reg.has(D(SYMS[j])), `press ${i}: ${SYMS[j]} D base`).toBe(true)
      // ...and the recent symbols (the row on screen, the one just left) keep their intraday array too
      for (let j = Math.max(0, i - 1); j <= i; j++) expect(reg.has(K1(SYMS[j])), `press ${i}: ${SYMS[j]} 1m (recent)`).toBe(true)
    }
    expect(reg.has(K1(SYMS[0])), 'the oldest 1m array went').toBe(false)
  })

  it('under pressure only daily bases can relieve: a non-recent one goes before a recent one', () => {
    const D = (s) => keyOf({ sym: s, tf: 'D' })
    const reg = createRegistry({ barBudget: 9000, recentSymbols: 1, ctx: () => ({ nowMs: NOW }) })
    for (const s of ['OLD', 'RECENT']) { const off = reg.subscribe(D(s), () => {}); reg.dispatch(D(s), full(4000, DAY, 1)); off() }
    reg.dispatch(D('NEW'), full(4000, DAY, 2))
    expect(reg.has(D('OLD'))).toBe(false)
    expect(reg.has(D('RECENT')) && reg.has(D('NEW'))).toBe(true)
  })
})

describe('B9 the adapter and the mem cache drop an intraday slot before a daily one', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); _resetAdapterMemos(); memClear() })
  afterEach(() => { vi.useRealTimers(); _resetAdapterMemos(); memClear() })

  it('adapter: the daily copy read FIRST outlives every newer intraday copy', () => {
    _setAdapterMemoLimits({ maxEntries: 32, maxBars: 30_000 })
    const reg = createRegistry({ ctx: () => ({ nowMs: NOW }) })
    const D = keyOf({ sym: 'BASE', tf: 'D' })
    reg.dispatch(D, full(5000, DAY, 1))
    legacyBars(reg.peek(D), 'D')
    // four 15m keys of 9,000 bars each: their legacy copies (the store's rows carry rev/src/fin) need 36,000 > 30,000
    for (let i = 0; i < 4; i++) {
      const k = K15(SYMS[i])
      reg.dispatch(k, { type: 'rest-full', payload: { bars: rowsOf(9000, 900, 3) } })
      const s = reg.peek(k)
      expect(legacyBars(s, '15')).not.toBe(s.bars)   // a copy: it weighs
    }
    expect(_adapterMemoStats().legacy.keys).toContain(`${D}|D`)
    expect(_adapterMemoStats().legacy.bars).toBeLessThanOrEqual(30_000)
  })

  it('mem: a daily history written first outlives newer intraday entries over the share', () => {
    const daily = rowsOf(5000, DAY, 1)
    memPut('BASE', 'D', daily, { savedAt: NOW })
    const rows = rowsOf(20000, 60, 1)
    for (let i = 0; i < 20; i++) memPut(SYMS[i], '1', rows, { savedAt: NOW })
    expect(_memStats().rows).toBeLessThanOrEqual(BAR_BUDGET_DESKTOP.mem)
    expect(memPeek('BASE', 'D')).toBe(daily)
  })
})

// ── B7: a real store (network, persist, the lake), a fake server ─────────────────────────────────────────────────────
const row = (t, k = 1) => ({ t, o: 100 * k, h: 101 * k, l: 99 * k, c: 100.5 * k, v: 10 })
const session = (open, upto = open + 390 * 60, k = 1) => {
  const out = []
  for (let t = open; t < open + 390 * 60 && t < upto; t += 300) out.push(row(t, k))
  return out
}
const today = (k = 1) => session(OPEN, OPEN + 35 * 60, k)
const LAKE = [OPEN - 6 * DAY, OPEN - 5 * DAY, OPEN - 4 * DAY, OPEN - DAY].flatMap((o) => session(o)).concat(today())
const answerFor = (sym) => ({
  bars: today(), contract: 1, grid: 'session', session: 'rth', cache_key: `b1:${sym}:5:session`, series_rev: 5000, history_rev: 7,
  verified_through: OPEN + 35 * 60, complete_through: OPEN + 30 * 60, developing: null, tail_status: 'verified',
})
const shape = (bars) => bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])

let fakeDb
describe('B7 an evicted symbol reloads its full history exactly', () => {
  beforeAll(() => { fakeDb = installFakeIndexedDB() })
  beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW); _resetAdapterMemos() })
  afterEach(() => { vi.useRealTimers(); memClear() })

  for (const tier of ['mem + IndexedDB copies kept', 'every saved copy gone too']) {
    it(`the server's answer and the lake's depth come back in one join (${tier})`, async () => {
      const request = vi.fn(async (url) => answerFor(['OTH1', 'OTH2', 'SIM'].find((s) => String(url).includes(s))))
      const olderBars = vi.fn(async (key, beforeT) => ({ bars: LAKE.filter((b) => b.t <= beforeT) }))
      const store = createBarStore({
        request, history: { olderBars }, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
        isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
        registry: createRegistry({ barBudget: LAKE.length + 50, recentSymbols: 0, ctx: () => ({ nowMs: Date.now() }) }),
      })
      const key = keyOf({ sym: 'SIM', tf: '5' })
      let off = store.subscribe(key, () => {})
      await vi.advanceTimersByTimeAsync(500)
      const before = store.getSnapshot(key)
      expect(before.restSeen).toBe(true)
      expect(before.bars[0].t).toBe(LAKE[0].t)
      const wantRows = shape(before.bars)
      const wantLegacy = shape(legacyBars(before))
      off()
      await vi.advanceTimersByTimeAsync(2000)   // persist's debounced write lands
      // other rows shown in turn push SIM out of the registry
      for (const s of ['OTH1', 'OTH2']) {
        const k = keyOf({ sym: s, tf: '5' })
        const o2 = store.subscribe(k, () => {})
        await vi.advanceTimersByTimeAsync(500)
        o2()
      }
      expect(store.registry.has(key), 'SIM evicted').toBe(false)
      if (tier === 'every saved copy gone too') { memClear(); fakeDb._clear() }
      off = store.subscribe(key, () => {})
      await vi.advanceTimersByTimeAsync(500)
      const after = store.getSnapshot(key)
      expect(after.restSeen).toBe(true)
      expect(shape(after.bars)).toEqual(wantRows)
      expect(shape(legacyBars(after))).toEqual(wantLegacy)
      expect(store.lakePending(key)).toBe(false)
      off()
      store.dispose()
    })
  }
})

// ── B10 (review of #2935, E1): an answer in flight across its key's eviction never lands on the new life ───────────────
describe('B10 an answer in flight when its key is evicted: the entry is absent or full, never delta-only', () => {
  beforeAll(() => { fakeDb = fakeDb || installFakeIndexedDB() })
  beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW); _resetAdapterMemos() })
  afterEach(() => { vi.useRealTimers(); memClear() })

  it('acquire, ask a since= delta, release, evict, land: the request was aborted at the eviction and nothing lands', async () => {
    const full = { ...answerFor('SIM'), bars: LAKE }   // the key's first life: deep
    const asked = []
    let landDelta = null
    const request = vi.fn((url, { signal } = {}) => {
      asked.push({ url: String(url), signal })
      if (!String(url).includes('SIM')) return Promise.resolve({ ...answerFor('OTH'), bars: today(2), cache_key: 'b1:OTH:5:session' })
      if (!String(url).includes('since=')) return Promise.resolve(full)
      // the delta: answered LATE, and by a server that ignores the abort (the landing must still drop it)
      return new Promise((res) => { landDelta = () => res({ ...answerFor('SIM'), bars: today().slice(-2) }) })
    })
    const registry = createRegistry({ barBudget: LAKE.length + 20, recentSymbols: 0, ctx: () => ({ nowMs: Date.now() }), idle: (fn) => fn() })
    const store = createBarStore({
      request, history: null, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
      isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), registry,
    })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    await store.ensure(key, { priority: 'urgent' })
    expect(store.getSnapshot(key).depth).toBe(LAKE.length)
    const firstGen = store.peek(key).gen
    // a warm asks the key again (a since= delta of what it holds), and lets go before the answer (an aborted ensure)
    registry.acquire(key)
    store.network.fetchOnce(key, { priority: 'background' })
    registry.release(key)
    await vi.advanceTimersByTimeAsync(10)
    const delta = asked.find((a) => a.url.includes('SIM') && a.url.includes('since='))
    expect(delta, 'a since= delta is in flight').toBeTruthy()
    // other keys push SIM out of the registry
    for (let i = 0; i < 3; i++) registry.dispatch(keyOf({ sym: `OTH${i}`, tf: '5' }), { type: 'rest-full', payload: { bars: LAKE } })
    expect(registry.has(key), 'SIM evicted').toBe(false)
    expect(delta.signal?.aborted, 'the eviction aborted its request in flight').toBe(true)
    landDelta()
    await vi.advanceTimersByTimeAsync(50)
    expect(registry.has(key), 'the late answer created no entry').toBe(false)
    // the next life starts at its own generation: an action of the old life is refused there
    const s = registry.getSnapshot(key)
    expect(s.gen).not.toBe(firstGen)
    const after = registry.dispatch(key, { type: 'rest-delta', key, gen: firstGen, payload: { ...answerFor('SIM'), bars: today().slice(-2), since: today().at(-3).t } })
    expect(after.restSeen, "an old life's delta on the new, empty entry").toBe(false)
    expect(after.depth).toBe(0)
    store.dispose()
  })
})

describe('B10b the landing alone: a registry whose evictions no network hears still gets no entry from a late answer', () => {
  beforeAll(() => { fakeDb = fakeDb || installFakeIndexedDB() })
  beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW); _resetAdapterMemos() })
  afterEach(() => { vi.useRealTimers(); memClear() })

  it('the request is not aborted (nobody heard the eviction), lands, and is dropped: the key stays absent', async () => {
    let landDelta = null
    const request = vi.fn((url) => {
      if (!String(url).includes('since=')) return Promise.resolve({ ...answerFor('SIM'), bars: LAKE })
      return new Promise((res) => { landDelta = () => res({ ...answerFor('SIM'), bars: today().slice(-2) }) })
    })
    const registry = createRegistry({ barBudget: LAKE.length + 20, recentSymbols: 0, ctx: () => ({ nowMs: Date.now() }), idle: (fn) => fn() })
    registry.onEvict = undefined   // (a registry without per-instance eviction listeners: only the landing can refuse)
    const store = createBarStore({
      request, history: null, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
      isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), registry,
    })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    await store.ensure(key, { priority: 'urgent' })
    registry.acquire(key)
    store.network.fetchOnce(key, { priority: 'background' })
    registry.release(key)
    await vi.advanceTimersByTimeAsync(10)
    expect(typeof landDelta).toBe('function')
    for (let i = 0; i < 3; i++) registry.dispatch(keyOf({ sym: `OTH${i}`, tf: '5' }), { type: 'rest-full', payload: { bars: LAKE } })
    expect(registry.has(key)).toBe(false)
    landDelta()
    await vi.advanceTimersByTimeAsync(50)
    expect(registry.has(key), 'the late answer created no entry').toBe(false)
    store.dispose()
  })
})
