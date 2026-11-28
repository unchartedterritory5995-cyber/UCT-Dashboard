// ⭐⭐ (2026-11-28, cold-arch report 3.3 item 2) A COLD TYPED TICKER IS FETCHED FROM ITS KEYSTROKE, FROM THE EDGE.
// Production, typed Enter on a never-opened ticker, D: the request left 27-50 ms AFTER Enter (the warm sent nothing:
// `if (!s0?.depth && !packIngesting()) return 'unknown'`, the daily pack's word for "a prefix"), and the first frame waited
// on the no-store origin tail, 209-315 ms after the key. Now the ticker universe the search holds (lib/tickerUniverse) is
// the first authority for "this text is a ticker" on every timeframe:
//   * D/W/M: a known ticker with nothing held asks its deep sealed history from the EDGE (calendar `d`) and only the
//     newest EDGE_TAIL_BARS rows of the origin, at the keystroke; both are joined before Enter, which then sends nothing;
//   * W/M carry the calendar's sealed date too (the previous week's Friday, the previous month's 1st: the server's own
//     labels), so their history leaves beside the tail instead of after it;
//   * text the universe does not hold asks the lake's index (the second authority, as intraday did) and only then sends;
//   * intraday: a known ticker skips the pack read and the lake index wait (up to 60 + 400 ms) and asks at once;
//   * every new text cancels the one before: at most ONE typed tail in flight, the older one aborted.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN, HISTORY_DAYS } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000          // Tue 2026-11-10 10:02:20 ET: D d = Mon 11-09, W d = Fri 11-06, M d = 10-01
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.setItem('barspack.version', 'test')   // the daily pack is held: uncached text used to read as a prefix
  localStorage.removeItem('uct.barsHistory.enabled')
  localStorage.setItem('uct.barsHistory.bucket', '5')
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem('barspack.version'); localStorage.removeItem('uct.barsHistory.bucket'); localStorage.removeItem('uct.tickerUniverse')
})

const UNIVERSE = ['AAA', 'AAPL', 'AM', 'AMZN', 'COLD', 'CRBG', 'GOOG', 'GOOGL', 'NVDA', 'WKLY']

async function boot({ universe = UNIVERSE, lake = () => false } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer()
  const tu = await import('../../lib/tickerUniverse')
  tu.__resetTickerUniverseForTests()
  if (universe) {
    await tu.ensureTickerUniverse({ fetchImpl: async () => ({ ok: true, json: async () => ({ v: 't1', symbols: universe }) }) })
  }
  const { createBarStore } = await import('./index')
  const { createPrefetch, DEEP_JOIN_WAIT_MS } = await import('./prefetch')
  const { EDGE_TAIL_BARS } = await import('./network')
  const { keyOf } = await import('./types')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  store.lakeHas = (sym) => Promise.resolve(lake(sym))
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  return { server, store, pf, tu, k: (sym, tf) => keyOf({ sym, tf }), DEEP_JOIN_WAIT_MS, EDGE_TAIL_BARS }
}
const settle = async (w) => { await w.server.flush(60); await vi.advanceTimersByTimeAsync(1); await w.server.flush(60) }
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10)
const hist = (w) => w.server.calls.filter((c) => c.q.history)
const what = (c) => (c.q.history ? `${c.q.sym} history ${c.q.tf} d=${c.q.d}` : `${c.q.sym} tail ${c.q.tf} bars=${c.q.bars}`)
const COVER = 2000   // a zoomed-out daily view (paintLog viewNeed): the chart's own cover

describe('a cold typed D ticker the universe knows: the edge history and a short tail leave at the keystroke', () => {
  it('both on the wire before either answers; joined before Enter; Enter then sends nothing', async () => {
    const w = await boot()
    const typed = w.pf.warmTypedSymbol('COLD', 'D', { cover: COVER })
    await settle(w)
    expect(w.server.open().map(what).sort()).toEqual(['COLD history D d=2026-11-09', `COLD tail D bars=${w.EDGE_TAIL_BARS}`])
    expect(w.server.open().every((c) => !c.q.warm)).toBe(true)
    await w.server.drain()
    await expect(typed).resolves.toBe('network')
    expect(w.pf.deepPending('COLD', 'D')).toBe(false)                    // joined before the warm says "network"
    expect(day(w.store.peek(w.k('COLD', 'D')).bars[0].t)).toBe(HISTORY_DAYS[0])
    const n = w.server.calls.length
    await expect(w.pf.prepareDailyForDisplay('COLD', 'D', { cover: COVER })).resolves.toBe('current')
    await w.server.flush(40)
    expect(w.server.calls.length).toBe(n)
  })

  it('text the universe does not hold, and the lake does not know: nothing is sent', async () => {
    const w = await boot()
    await expect(w.pf.warmTypedSymbol('ZZQ', 'D', { cover: COVER })).resolves.toBe('unknown')
    await w.server.flush(40)
    expect(w.server.calls).toEqual([])
  })

  it('a real ticker outside the universe (an ETF, a small cap) is asked once the lake index knows it', async () => {
    const w = await boot({ lake: (s) => s === 'XLETF' })
    const typed = w.pf.warmTypedSymbol('XLETF', 'D', { cover: COVER })
    await w.server.drain()
    await expect(typed).resolves.toBe('network')
    expect(hist(w).map((c) => c.q.sym)).toEqual(['XLETF'])
  })

  it('a new member (no pack yet): a universe that does not hold the text is a word against it, the origin is not asked', async () => {
    localStorage.removeItem('barspack.version')     // the pack "ingests": before, every uncached text was asked
    const w = await boot()
    await expect(w.pf.warmTypedSymbol('ZZQ', 'D', { cover: COVER })).resolves.toBe('unknown')
    w.pf.warmTypedSymbol('ZZQ', '5')
    await settle(w)
    expect(w.server.calls).toEqual([])
  })

  it('no universe held yet (a first search still loading it): the old rule, a held pack reads uncached text as a prefix', async () => {
    const w = await boot({ universe: null })
    await expect(w.pf.warmTypedSymbol('COLD', 'D', { cover: COVER })).resolves.toBe('unknown')
    await w.server.flush(40)
    expect(w.server.calls).toEqual([])
  })
})

describe('W and M carry the calendar sealed date: their history leaves beside a short tail', () => {
  it('W: the previous week\'s Friday (the server\'s label), beside the tail, before either answers', async () => {
    const w = await boot()
    const typed = w.pf.warmTypedSymbol('WKLY', 'W', { cover: COVER })
    await settle(w)
    expect(w.server.open().map(what).sort()).toEqual(['WKLY history W d=2026-11-06', `WKLY tail W bars=${w.EDGE_TAIL_BARS}`])
    await w.server.drain()
    await expect(typed).resolves.toBe('network')
    expect(w.pf.deepPending('WKLY', 'W')).toBe(false)
  })
  it('M: the previous month\'s 1st', async () => {
    const w = await boot()
    w.pf.warmTypedSymbol('WKLY', 'M', { cover: 600 })   // (a cover of the whole 1,200-month depth asks the origin for all of it)
    await settle(w)
    expect(w.server.open().map(what).sort()).toEqual(['WKLY history M d=2026-10-01', `WKLY tail M bars=${w.EDGE_TAIL_BARS}`])
    await w.server.drain()
  })
})

describe('every keystroke that spells a known ticker is warmed; the newest text cancels the older ones', () => {
  it('four known tickers in a row: at most one typed tail in flight, each older one aborted', async () => {
    const w = await boot()
    const out = []
    for (const t of ['AAA', 'AAPL', 'AMZN', 'NVDA']) {
      out.push(w.pf.warmTypedSymbol(t, 'D', { cover: COVER }))
      await settle(w)
      // the newest text's tail AND its edge history alone are live: the older texts' were aborted, so they hold no lane slot
      expect(w.server.open().map(what).sort()).toEqual([`${t} history D d=2026-11-09`, `${t} tail D bars=${w.EDGE_TAIL_BARS}`])
    }
    await w.server.drain()
    const res = await Promise.all(out)
    expect(res.slice(0, 3).every((r) => r === false || r === 'superseded')).toBe(true)
    expect(res[3]).toBe('network')
    expect(w.pf.deepPending('NVDA', 'D')).toBe(false)
  })
})

// ⭐ (2026-11-28, owner ruling: "I would rather upgrade our infrastructure than downgrade the quality and speed") EVERY
// KEYSTROKE THAT SPELLS A KNOWN TICKER IS WARMED IN FULL, and nothing abandoned keeps running: the next text aborts the
// older one's tail AND its edge history, so they hold no lane slot the newest text needs.
describe('every known keystroke warmed in full; abandoned work cancelled', () => {
  const tails = (w) => w.server.calls.filter((c) => !c.q.history)
  it('GOOG typed through to GOOGL: GOOG was asked at once and aborted by GOOGL; only GOOGL requests stay live', async () => {
    const w = await boot()
    w.pf.warmTypedSymbol('GOOG', 'D', { cover: COVER })
    await settle(w)
    expect(w.server.open().map(what).sort()).toEqual(['GOOG history D d=2026-11-09', `GOOG tail D bars=${w.EDGE_TAIL_BARS}`])
    await vi.advanceTimersByTimeAsync(180)
    const last = w.pf.warmTypedSymbol('GOOGL', 'D', { cover: COVER })
    await settle(w)
    expect(w.server.calls.filter((c) => c.q.sym === 'GOOG').every((c) => c.aborted)).toBe(true)
    expect(w.server.open().map(what).sort()).toEqual(['GOOGL history D d=2026-11-09', `GOOGL tail D bars=${w.EDGE_TAIL_BARS}`])
    await w.server.drain()
    await expect(last).resolves.toBe('network')
  })
})

describe('intraday: a known ticker asks at once (no pack read, no lake index wait)', () => {
  it('a known cold ticker on 5m sends its tail in the keystroke\'s turn, before the lake index could answer', async () => {
    const w = await boot()
    w.store.lakeHas = () => new Promise(() => {})                   // an index that never answers
    w.pf.warmTypedSymbol('CRBG', '5')
    await settle(w)
    expect(w.server.open().filter((c) => !c.q.history).map((c) => `${c.q.sym} ${c.q.tf}`)).toEqual(['CRBG 5'])
    await w.server.drain()
  })
})

// (2026-11-28) the linked charts' fetches ride the typed text; a prime another caller joined is detached, never aborted
describe('linked charts and joined primes', () => {
  it('a linked prime the switch joined is detached by the next text, never aborted', async () => {
    const w = await boot()
    w.pf.warmTypedSymbol('COLD', 'D', { cover: COVER, alsoTfs: ['W'] })
    await settle(w)
    const wh = () => w.server.calls.find((c) => c.q.history && c.q.tf === 'W' && c.q.sym === 'COLD')
    for (let i = 0; i < 5 && !wh(); i++) await settle(w)
    expect(wh()).toBeTruthy()
    const press = w.pf.prepareDailyForDisplay('COLD', 'W', { cover: 600 })     // the W chart's own switch joins it
    await settle(w)
    w.pf.warmTypedSymbol('NVDA', 'D', { cover: COVER, alsoTfs: ['W'] })          // the next text cancels COLD's linked
    await settle(w)
    expect(wh().aborted).toBeFalsy()
    await w.server.drain()
    await press
  })
  it('CONTROL: a linked prime nobody joined IS aborted by the next text', async () => {
    const w = await boot()
    w.pf.warmTypedSymbol('COLD', 'D', { cover: COVER, alsoTfs: ['W'] })
    const wh = () => w.server.calls.find((c) => c.q.history && c.q.tf === 'W' && c.q.sym === 'COLD')
    for (let i = 0; i < 6 && !wh(); i++) await settle(w)
    expect(wh()).toBeTruthy()
    w.pf.warmTypedSymbol('NVDA', 'D', { cover: COVER, alsoTfs: ['W'] })
    await settle(w)
    expect(wh().aborted).toBe(true)
    await w.server.drain()
  })
})

// ⛔ WASTE, NOT QUALITY: a typed warm never asks the ORIGIN for rows the EDGE holds. A cold daily key's deep rows come from
// the edge's sealed history; the origin is asked only the newest EDGE_TAIL_BARS (a 2,000-row origin cover was the waste).
// ...and THE REQUEST COUNT OF A SCRIPTED MEMBER'S SEARCHES, printed per member and x500 (a measurement for the capacity
// work, not a cap): four keystrokes (N, NV, NVD, NVDA at 180 ms, told as SymbolSearch tells them), Enter, a paste (AMZN),
// Enter. Origin = /api/bars; edge = /api/bars-history.
describe('request count of a member typing and pasting (printed x500)', () => {
  it('two searches: the origin is asked only the newest rows, the edge the rest; the presses join the warms', async () => {
    const w = await boot()
    const t0 = Date.now()
    await vi.advanceTimersByTimeAsync(180)                      // N (one letter: the pause, overtaken by the next key)
    await vi.advanceTimersByTimeAsync(180)                      // NV (no ticker: the pause, overtaken)
    w.pf.warmTypedSymbol('NVDA', 'D', { cover: COVER }); await settle(w)   // NVD: its one completion, NVDA
    await vi.advanceTimersByTimeAsync(180)                      // NVDA: the same text, told once
    await vi.advanceTimersByTimeAsync(150)                      // Enter
    const e1 = w.pf.prepareDailyForDisplay('NVDA', 'D', { cover: COVER })
    await w.server.drain(); await e1
    await vi.advanceTimersByTimeAsync(2000)                     // looks at the chart
    w.pf.warmTypedSymbol('AMZN', 'D', { cover: COVER }); await settle(w)   // the paste: told at once
    await vi.advanceTimersByTimeAsync(80)                       // Enter
    const e2 = w.pf.prepareDailyForDisplay('AMZN', 'D', { cover: COVER })
    await w.server.drain(); await e2
    const secs = (Date.now() - t0) / 1000
    const origin = w.server.calls.filter((c) => !c.q.history)
    const edge = w.server.calls.filter((c) => c.q.history)
    const rate = origin.length / secs
    console.info(`[request-count] 2 searches in ${secs.toFixed(1)} s: origin ${origin.length} (${rate.toFixed(3)}/s per member, x500 = ${(rate * 500).toFixed(1)}/s), edge ${edge.length} (${(edge.length / secs).toFixed(3)}/s, x500 = ${(edge.length / secs * 500).toFixed(1)}/s)`)
    expect(origin.map((c) => `${c.q.sym} ${c.q.bars}`)).toEqual([`NVDA ${w.EDGE_TAIL_BARS}`, `AMZN ${w.EDGE_TAIL_BARS}`])   // never the edge's rows
    expect(edge.map((c) => c.q.sym)).toEqual(['NVDA', 'AMZN'])
  })
})

// (mutant M8, 2026-11-28) the warm reports the WHOLE chart: with its tail answered and its edge history still out, it has
// not reported yet; it reports once the history has joined (bounded by DEEP_JOIN_WAIT_MS), so a caller that treats the
// answer as the chart's rows (ChartPane's typed next) never sees the 30-row tail alone
describe('the typed warm reports once the deep history joined', () => {
  it('tail answered, history out: not reported; history in: reported, and the rows are whole', async () => {
    const w = await boot()
    const typed = w.pf.warmTypedSymbol('COLD', 'D', { cover: COVER })
    let done = false
    typed.then(() => { done = true })
    await settle(w)
    for (const c of w.server.open()) if (!c.q.history) c.respond()
    await settle(w)
    expect(done).toBe(false)
    await w.server.drain()
    await expect(typed).resolves.toBe('network')
    expect(day(w.store.peek(w.k('COLD', 'D')).bars[0].t)).toBe(HISTORY_DAYS[0])
  })
})
