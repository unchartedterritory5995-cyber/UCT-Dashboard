import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'

// ── A daily chart does not wait on a busy device cache (2026-11-14) ───────────────────
// Measured on production: on a list the device had never opened, 8 of 40 charts sat empty
// for 217-484 ms because their IndexedDB read queued behind writes and the request to the
// server did not start until it came back. For D/W/M that request is the same either way,
// so after `IDB_DWM_GRACE_MS` it goes out; whichever answers first paints.
// Contracts, on the REAL component:
//   1. a read that has not answered does not hold the request past the grace, and the
//      server's answer is drawn;
//   2. a read that answers at once is drawn first and the request is still made ONCE;
//   3. the server's answer is kept out of the stores while the read is out; when the read
//      lands, a deeper entry is folded under it and the DEEP series is what gets written
//      and drawn (the store is never left with the bare first-paint window);
//   4. an entry that is not a deeper, suffix-compatible series leaves the server's set;
//   5. all of that holds when the member left the symbol before the read answered;
//   6. the per-browser switch brings the wait back; an intraday chart is untouched.

const draws = vi.hoisted(() => ({ list: [] }))
const idb = vi.hoisted(() => ({ gets: [], puts: [], answer: null }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const series = {
    setData: (d) => {
      if (Array.isArray(d) && (d.length === 0 || d[0]?.open != null)) {
        draws.list.push({ n: d.length, firstT: d.length ? d[0].time : null, lastC: d.length ? d[d.length - 1].close : null })
      }
    },
    update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    getPane: () => ({ paneIndex: () => 0 }), priceFormatter: () => ({ format: (p) => String(p) }),
    dataByIndex: () => null, barsInLogicalRange: () => null,
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
      getVisibleLogicalRange: () => null, setVisibleRange: () => {}, scrollToPosition: () => {},
      subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {},
      timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600, logicalToCoordinate: () => 0,
      subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    paneSize: () => ({ width: 600, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return { ...real, createChart: () => chart, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})
vi.mock('../utils/barsIDB', async (orig) => {
  const real = await orig()
  return {
    ...real,
    // each read is answered by the test: `idb.answer(sym, tf)` returns the entry, or a promise of it
    idbGet: (sym, tf) => { idb.gets.push({ sym, tf, at: performance.now() }); return Promise.resolve(idb.answer ? idb.answer(sym, tf) : null) },
    idbPut: async (sym, tf, bars) => { idb.puts.push({ sym, tf, n: bars.length, firstT: bars[0]?.t, lastC: bars[bars.length - 1]?.c }) },
    idbGetHistory: async () => null, idbPutHistory: async () => null,
  }
})
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// Sat 2026-11-14 10:00 ET: the market is closed, so a daily series ending Fri 11/13 is current.
const clock = pinWallClock('2026-11-14T15:00:00Z')
afterAll(() => clock.restore())

const { default: StockChart } = await import('./StockChart')
const { memClear, memPeek } = await import('../utils/barsMemCache')
const { IDB_DWM_GRACE_MS, BARS_GRACE_OFF_KEY } = await import('./chart/useLegacyChartBars')

// `n` weekday sessions ending Fri 2026-11-13, oldest first. `c` marks whose bars they are.
function daily(n, c) {
  const out = []
  const d = new Date(Date.UTC(2026, 10, 13))
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift({ t: d.toISOString().slice(0, 10), o: c, h: c + 1, l: c - 1, c, v: 1000 })
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const SERVER = daily(600, 50)                      // the first-paint window, the server's values
const DEEP = daily(1500, 40)                       // what the device holds: deeper, older values
const entry = (bars) => ({ bars, lastT: bars[bars.length - 1].t, savedAt: Date.now() })
// 650 CALENDAR days ending the same Friday: longer than the answer, yet it starts LATER (it is
// not the same window going deeper), so it must not be folded under the answer.
function calendarDays(n, c) {
  const out = []
  const d = new Date(Date.UTC(2026, 10, 13))
  while (out.length < n) { out.unshift({ t: d.toISOString().slice(0, 10), o: c, h: c + 1, l: c - 1, c, v: 1 }); d.setUTCDate(d.getUTCDate() - 1) }
  return out
}
// 15-minute bars: 5 sessions ending Fri 2026-11-13 16:00 ET.
function intraday(c) {
  const out = []
  for (let day = 9; day <= 13; day++) {
    const open = Math.floor(Date.UTC(2026, 10, day, 14, 30) / 1000)
    for (let k = 0; k < 26; k++) out.push({ t: open + k * 900, o: c, h: c + 1, l: c - 1, c, v: 100 })
  }
  return out
}
const INTRA = intraday(50)
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
/** Step in short slices until `cond()` holds (a cold first render in jsdom takes its time). */
async function until(cond, ms = 4000) {
  for (let t = 0; t < ms && !cond(); t += 25) await wait(25)
  return cond()
}

let reqs
function serve(delayMs = 20) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (!u.includes('/api/bars/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    const ticker = decodeURIComponent(u.match(/\/api\/bars\/([^?]+)/)[1]).toUpperCase()
    const tf = (u.match(/[?&]tf=([^&]+)/) || [])[1]
    reqs.push({ url: u, ticker, tf, at: performance.now() })
    if (tf === '15' && ticker === 'GRACEI') {
      return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, json: async () => ({ ticker, tf: '15', bars: INTRA }) }), delayMs))
    }
    if (tf !== 'D') return new Promise(() => {})                 // other-tf warms: never answer
    const body = { ticker, tf: 'D', bars: SERVER }
    return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, json: async () => body }), delayMs))
  }))
}
const own = (sym) => reqs.filter((r) => r.ticker === sym && r.tf === 'D' && !r.url.includes('warm=1'))
const drawn = () => draws.list.filter((d) => d.n > 0)
const stored = (sym) => idb.puts.filter((p) => p.sym === sym && p.tf === 'D')
/** A read the test answers later (`fail: true` makes it reject instead). */
function heldRead() {
  let release, reject
  const p = new Promise((r, j) => { release = r; reject = j })
  p.catch(() => {})
  idb.answer = () => p
  return (value, { fail = false } = {}) => act(async () => {
    if (fail) reject(new Error('idb unavailable')); else release(value)
    await p.catch(() => {})
    await new Promise((r) => setTimeout(r, 30))
  })
}

beforeEach(() => {
  cleanup(); memClear()
  draws.list.length = 0; idb.gets.length = 0; idb.puts.length = 0; idb.answer = null; reqs = []
  try { localStorage.removeItem(BARS_GRACE_OFF_KEY); localStorage.removeItem('barspack.version') } catch { /* ignore */ }
})

describe('a daily chart and a busy device cache', { timeout: 30000 }, () => {
  it('a read that has not answered does not hold the request past the grace, and the answer is drawn', async () => {
    serve()
    // This browser HAS a cache and its pack has ingested: the case the old gate waited 4 s in.
    localStorage.setItem('barspack.version', '2026-11-13')
    idb.answer = () => entry(DEEP)
    const primed = render(<StockChart sym="PRIMED" tf="D" />)
    expect(await until(() => drawn().length > 0)).toBe(true)
    primed.unmount()
    draws.list.length = 0
    const answer = heldRead()
    render(<StockChart sym="GRACEA" tf="D" />)
    // (a bound well under 4 s, and no tighter: a loaded test run is slow, the old wait was 4 s)
    expect(await until(() => own('GRACEA').length > 0, 2500)).toBe(true)
    expect(await until(() => drawn().length > 0, 2500)).toBe(true)
    expect(own('GRACEA')).toHaveLength(1)
    const sinceRead = own('GRACEA')[0].at - idb.gets.find((g) => g.sym === 'GRACEA' && g.tf === 'D').at
    expect(sinceRead).toBeGreaterThanOrEqual(IDB_DWM_GRACE_MS - 5)   // not before the grace
    expect(drawn()[drawn().length - 1]).toMatchObject({ n: 600, lastC: 50 })
    // ... and nothing has been written to a store while the read is still out
    expect(stored('GRACEA')).toEqual([])
    expect(memPeek('GRACEA', 'D')).toBeFalsy()
    await answer(null)
  })

  it('CONTROL: a read that answers at once is drawn first, and the request is still made once', async () => {
    serve(120)
    idb.answer = () => entry(DEEP)
    render(<StockChart sym="GRACEB" tf="D" />)
    await wait(60)
    expect(drawn().length).toBeGreaterThan(0)
    expect(drawn()[0].lastC).toBe(40)                              // the device's bars, before any answer
    await wait(400)
    expect(own('GRACEB')).toHaveLength(1)
    const last = drawn()[drawn().length - 1]
    expect(last).toMatchObject({ n: 1500, lastC: 50 })             // deep history kept, the server wins the overlap
    expect(stored('GRACEB').at(-1)).toMatchObject({ n: 1500, lastC: 50 })
  })

  it('a deeper entry that lands late is folded under the answer, and the DEEP series is what is stored', async () => {
    serve()
    const answer = heldRead()
    render(<StockChart sym="GRACEC" tf="D" />)
    expect(await until(() => drawn().length > 0)).toBe(true)
    expect(drawn()[drawn().length - 1]).toMatchObject({ n: 600, lastC: 50 })
    await answer(entry(DEEP))
    await until(() => drawn()[drawn().length - 1].n === 1500, 1500)
    expect(drawn()[drawn().length - 1]).toMatchObject({ n: 1500, lastC: 50 })
    expect(stored('GRACEC')).toHaveLength(1)
    expect(stored('GRACEC')[0]).toMatchObject({ n: 1500, firstT: DEEP[0].t, lastC: 50 })   // never the bare 600
    expect(memPeek('GRACEC', 'D')).toHaveLength(1500)
    expect(own('GRACEC')).toHaveLength(1)                                                 // no second request
  })

  it("an entry that is not a deeper series of the same window leaves the server's set", async () => {
    serve()
    const answer = heldRead()
    render(<StockChart sym="GRACED" tf="D" />)
    expect(await until(() => drawn().length > 0)).toBe(true)
    // FEWER bars than the answer although it starts earlier: a series with holes in it (every
    // fifth session of the deep one). Folding it under would plant sparse old bars on the left.
    const sparse = DEEP.filter((_, i) => i % 5 === 0)
    expect(sparse.length).toBeLessThan(SERVER.length)
    expect(sparse[0].t < SERVER[0].t).toBe(true)
    await answer(entry(sparse))
    await wait(80)
    expect(drawn()[drawn().length - 1]).toMatchObject({ n: 600, lastC: 50 })
    expect(stored('GRACED')).toEqual([expect.objectContaining({ n: 600, lastC: 50 })])
  })

  it("a longer entry that starts later than the answer is not the same window: the server's set stands", async () => {
    serve()
    const answer = heldRead()
    render(<StockChart sym="GRACEJ" tf="D" />)
    expect(await until(() => drawn().length > 0)).toBe(true)
    const odd = calendarDays(650, 40)
    expect(odd.length).toBeGreaterThan(SERVER.length)
    expect(odd[0].t > SERVER[0].t).toBe(true)
    await answer(entry(odd))
    await wait(80)
    expect(drawn()[drawn().length - 1]).toMatchObject({ n: 600, lastC: 50 })
    expect(stored('GRACEJ')).toEqual([expect.objectContaining({ n: 600, firstT: SERVER[0].t, lastC: 50 })])
  })

  it('a device read that FAILS still leaves the answer stored', async () => {
    serve()
    const answer = heldRead()
    render(<StockChart sym="GRACEK" tf="D" />)
    expect(await until(() => drawn().length > 0)).toBe(true)
    expect(stored('GRACEK')).toEqual([])
    await answer(null, { fail: true })
    expect(stored('GRACEK')).toEqual([expect.objectContaining({ n: 600, lastC: 50 })])
    expect(memPeek('GRACEK', 'D')).toHaveLength(600)
    expect(drawn()[drawn().length - 1]).toMatchObject({ n: 600, lastC: 50 })
  })

  it('an INTRADAY chart is untouched: its answer is stored at once, with the read still out', async () => {
    serve()
    const answer = heldRead()
    render(<StockChart sym="GRACEI" tf="15" />)
    expect(await until(() => idb.puts.some((p) => p.sym === 'GRACEI'), 3000)).toBe(true)
    expect(idb.puts.filter((p) => p.sym === 'GRACEI')[0]).toMatchObject({ n: INTRA.length, lastC: 50 })
    await answer(null)
  })

  it('an empty device still gets the answer stored once the read says so', async () => {
    serve()
    const answer = heldRead()
    render(<StockChart sym="GRACEE" tf="D" />)
    expect(await until(() => drawn().length > 0)).toBe(true)
    expect(stored('GRACEE')).toEqual([])
    await answer(null)
    expect(stored('GRACEE')).toEqual([expect.objectContaining({ n: 600, lastC: 50 })])
    expect(memPeek('GRACEE', 'D')).toHaveLength(600)
  })

  it('the member left before the read answered: the store still gets the deep series, and nothing of it is drawn', async () => {
    serve()
    const answer = heldRead()
    const view = render(<StockChart sym="GRACEF" tf="D" />)
    expect(await until(() => drawn().length > 0)).toBe(true)
    expect(drawn()[drawn().length - 1]).toMatchObject({ n: 600, lastC: 50 })
    view.unmount()
    const before = draws.list.length
    await answer(entry(DEEP))
    expect(stored('GRACEF')).toEqual([expect.objectContaining({ n: 1500, firstT: DEEP[0].t, lastC: 50 })])
    expect(draws.list.length).toBe(before)
  })

  it('the per-browser switch brings the wait back', async () => {
    localStorage.setItem(BARS_GRACE_OFF_KEY, '1')
    serve()
    const answer = heldRead()
    render(<StockChart sym="GRACEG" tf="D" />)
    await until(() => idb.gets.some((g) => g.sym === 'GRACEG' && g.tf === 'D'))
    await wait(IDB_DWM_GRACE_MS + 250)
    expect(own('GRACEG')).toEqual([])                              // still waiting on the device (0.6 s here)
    await answer(entry(DEEP))
    expect(await until(() => own('GRACEG').length > 0)).toBe(true)
    expect(own('GRACEG')).toHaveLength(1)
  })
})
