// ⭐ THE MINUTE FEED'S SWITCHES (2026-11-23, minuteFeedSwitch.js): default OFF for every member, a tester's
// localStorage key turns it on, the server's chart-speed kill turns it off over that key, and with the device store ON
// it does not run at all (the device store's worker already downloads the same frames).
//
//   S1 no key: off; the chunk is never loaded (so nothing can be asked for)        S2 '1': on, started once, stoppable
//   S3 '0' and any value that is not a choice: off                                 S4 CHART_SPEED_ENABLED=0 (the cookie): off over '1'
//   S5 the device store ON: it runs CACHE-ONLY (it may not use the network: no second download)
//   S5b the device store ON and the feed key OFF: nothing new happens              S6 one decision per page load
//   S7 the store asks for it ONCE, at its first chart; never at creation, never for a warm; dispose stops it
//   S8 THE APP'S STORE, OFF: a chart mounts, three minutes pass, and not one request goes to the minute frames
//   S9 THE APP'S STORE, ON: the first chart starts it; it asks for a minute file, never for the day
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { statusResponse } from '../../lib/minuteFrames/testing/frameWriter'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = Date.UTC(2026, 10, 10, 15, 2, 20)                    // Tue 2026-11-10 10:02:20 ET
const clearCookie = (n) => { document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/` }
let fakeDb
/** What a test must undo even when it FAILS half way (a store left running would ask into the next test's fetch). */
const undo = []
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.resetModules()                                              // a new page load: every once-per-load answer is forgotten
  localStorage.removeItem('uct.minuteFeed')
  localStorage.removeItem('uct.deviceStore')
  clearCookie('uct_chart_speed'); clearCookie('uct_device_store')
  delete window.__uctMinuteFeed
})
afterEach(() => {
  for (const f of undo.splice(0)) { try { f() } catch { /* already gone */ } }
  vi.useRealTimers()
  localStorage.removeItem('uct.minuteFeed'); localStorage.removeItem('uct.deviceStore')
  clearCookie('uct_chart_speed'); clearCookie('uct_device_store')
})

/** A stand-in for the feed's chunk: records what the switch does with it. */
function chunk() {
  const made = []
  const load = vi.fn(async () => ({
    createPageMinuteFeed: (o) => { const f = { o, start: vi.fn(), stop: vi.fn(), status: () => ({ running: true }) }; made.push(f); return f },
  }))
  return { load, made }
}
const STORE = { registry: {}, isActive: () => false }

describe('the switch', () => {
  it('S1 no key: off, and the chunk is never loaded', async () => {
    const sw = await import('./minuteFeedSwitch')
    const c = chunk()
    expect(sw.MINUTE_FEED_DEFAULT_ON).toBe(false)
    expect(sw.minuteFeedEnabled()).toBe(false)
    expect(sw.appMinuteFeed(STORE, { load: c.load })).toBe(null)
    await Promise.resolve()
    expect(c.load).not.toHaveBeenCalled()
  })

  it('S2 the tester key: on; the feed is made for the store, started once, and the handle stops it', async () => {
    localStorage.setItem('uct.minuteFeed', '1')
    const sw = await import('./minuteFeedSwitch')
    const c = chunk()
    expect(sw.MINUTE_FEED_KEY).toBe('uct.minuteFeed')
    expect(sw.minuteFeedEnabled()).toBe(true)
    const h = sw.appMinuteFeed(STORE, { load: c.load })
    expect(await h.ready).toBe(c.made[0])
    expect(c.load).toHaveBeenCalledTimes(1)
    expect(c.made[0].o.store).toBe(STORE)
    expect(c.made[0].o.cacheOnly).toBe(false)                      // the device store is off here: the page downloads
    expect(c.made[0].start).toHaveBeenCalledTimes(1)
    expect(h.status()).toEqual({ running: true })
    expect(window.__uctMinuteFeed.status()).toEqual({ running: true })   // what a measurement harness reads
    h.stop()
    expect(c.made[0].stop).toHaveBeenCalledTimes(1)
  })

  it('S2b a stop before the chunk has loaded: the feed is never made', async () => {
    localStorage.setItem('uct.minuteFeed', '1')
    const sw = await import('./minuteFeedSwitch')
    const c = chunk()
    const h = sw.appMinuteFeed(STORE, { load: c.load })
    h.stop()
    expect(await h.ready).toBe(null)
    expect(c.made).toHaveLength(0)
  })

  it('S2c the chunk fails to load: ready is null, the failure is KEPT (loadError) and said, never swallowed', async () => {
    localStorage.setItem('uct.minuteFeed', '1')
    const sw = await import('./minuteFeedSwitch')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    undo.push(() => warn.mockRestore())
    const load = vi.fn(async () => { throw new Error('chunk 404') })
    const h = sw.appMinuteFeed(STORE, { load })
    expect(h.loadError()).toBe(null)                               // nothing known while it loads
    expect(await h.ready).toBe(null)
    expect(h.loadError()).toBe('chunk 404')
    expect(h.status()).toBe(null)                                  // the charts go on as with the feed off
    expect(warn).toHaveBeenCalledWith('[minuteFeed] did not start:', 'chunk 404')
  })

  it('S2d a feed that loads has no loadError, and a stop before load is not an error', async () => {
    localStorage.setItem('uct.minuteFeed', '1')
    const sw = await import('./minuteFeedSwitch')
    const c = chunk()
    const h = sw.appMinuteFeed(STORE, { load: c.load })
    await h.ready
    expect(h.loadError()).toBe(null)
    const h2 = sw.appMinuteFeed(STORE, { load: chunk().load })
    h2.stop()
    expect(await h2.ready).toBe(null)
    expect(h2.loadError()).toBe(null)
  })

  it.each(['0', 'true', 'on', '', ' 1', 'yes'])('S3 a stored %j is off', async (v) => {
    localStorage.setItem('uct.minuteFeed', v)
    const sw = await import('./minuteFeedSwitch')
    const c = chunk()
    expect(sw.minuteFeedEnabled()).toBe(false)
    expect(sw.appMinuteFeed(STORE, { load: c.load })).toBe(null)
    expect(c.load).not.toHaveBeenCalled()
  })

  it('S4 the server kill (CHART_SPEED_ENABLED=0: the cookie uct_chart_speed=0) turns it off over the member own 1', async () => {
    localStorage.setItem('uct.minuteFeed', '1')
    document.cookie = 'uct_chart_speed=0; path=/'
    const sw = await import('./minuteFeedSwitch')
    const c = chunk()
    expect(sw.minuteFeedEnabled()).toBe(false)
    expect(sw.appMinuteFeed(STORE, { load: c.load })).toBe(null)
    expect(c.load).not.toHaveBeenCalled()
  })

  it('S4b the device store OWN kill is not this switch kill: the chart-speed kill is', async () => {
    localStorage.setItem('uct.minuteFeed', '1')
    document.cookie = 'uct_device_store=0; path=/'
    const sw = await import('./minuteFeedSwitch')
    expect(sw.minuteFeedEnabled()).toBe(true)
  })

  it('S5 the device store ON: the feed runs CACHE-ONLY (its worker already downloads the frames; the page may not)', async () => {
    localStorage.setItem('uct.minuteFeed', '1')
    localStorage.setItem('uct.deviceStore', '1')
    const sw = await import('./minuteFeedSwitch')
    const c = chunk()
    expect(sw.minuteFeedEnabled()).toBe(true)
    const h = sw.appMinuteFeed(STORE, { load: c.load })
    await h.ready
    expect(c.made).toHaveLength(1)
    expect(c.made[0].o.cacheOnly).toBe(true)
    expect(c.made[0].start).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('S5b the device store ON and the feed key OFF (every desktop member today): nothing new happens', async () => {
    localStorage.setItem('uct.deviceStore', '1')
    const sw = await import('./minuteFeedSwitch')
    const c = chunk()
    expect(sw.minuteFeedEnabled()).toBe(false)
    expect(sw.appMinuteFeed(STORE, { load: c.load })).toBe(null)
    await Promise.resolve()
    expect(c.load).not.toHaveBeenCalled()
    expect(window.__uctMinuteFeed).toBeUndefined()
  })

  it('S5c the device store ON, the feed key ON, and the chart-speed kill: off', async () => {
    localStorage.setItem('uct.minuteFeed', '1')
    localStorage.setItem('uct.deviceStore', '1')
    document.cookie = 'uct_chart_speed=0; path=/'
    const sw = await import('./minuteFeedSwitch')
    const c = chunk()
    expect(sw.appMinuteFeed(STORE, { load: c.load })).toBe(null)
    expect(c.load).not.toHaveBeenCalled()
  })

  it('S6 one decision per page load: a key changed later takes effect on the next load', async () => {
    const sw = await import('./minuteFeedSwitch')
    expect(sw.minuteFeedEnabled()).toBe(false)
    localStorage.setItem('uct.minuteFeed', '1')
    expect(sw.minuteFeedEnabled()).toBe(false)
    sw.__resetMinuteFeedSwitchForTests()
    expect(sw.minuteFeedEnabled()).toBe(true)
  })
})

describe('the bar store starts it once, at its first chart', () => {
  async function store(minuteFeed) {
    const { createBarStore } = await import('./index')
    globalThis.fetch = vi.fn(() => new Promise(() => {}))        // the server never answers: nothing here needs it to
    const s = createBarStore({
      stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), history: null,
      isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), ...(minuteFeed !== undefined ? { minuteFeed } : {}),
    })
    undo.push(() => s.dispose())
    return s
  }

  it('S7 never at creation, never for a warm; once at the first subscriber; dispose stops it', async () => {
    const handle = { stop: vi.fn() }
    const starter = vi.fn(() => handle)
    const s = await store(starter)
    expect(starter).not.toHaveBeenCalled()
    s.ensure('AAA_1')                                            // a list warm: no chart on the page yet
    await Promise.resolve()
    expect(starter).not.toHaveBeenCalled()
    expect(s.minuteFeed()).toBe(null)
    const off1 = s.subscribe('AAA_1', () => {})
    expect(starter).toHaveBeenCalledTimes(1)
    expect(starter).toHaveBeenLastCalledWith(s)
    expect(s.minuteFeed()).toBe(handle)
    expect(s.isActive('AAA_1')).toBe(true)
    expect(s.isActive('BBB_1')).toBe(false)
    const off2 = s.subscribe('BBB_1', () => {})
    off1(); off2()
    s.subscribe('CCC_1', () => {})
    expect(starter).toHaveBeenCalledTimes(1)                     // once per page, not per chart
    expect(s.isActive('AAA_1')).toBe(false)
    s.dispose()
    expect(handle.stop).toHaveBeenCalledTimes(1)
  })

  it('S7b a store that is handed no starter has no feed (only the app store is handed one)', async () => {
    const s = await store(undefined)
    s.subscribe('AAA_1', () => {})
    expect(s.minuteFeed()).toBe(null)
    s.dispose()
  })
})

describe('the app store', () => {
  const live1m = () => globalThis.fetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/hist/live1m/'))
  async function appStore() {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    // the bars server never answers; the edge has no frame (404): only WHAT is asked matters here
    globalThis.fetch = vi.fn((url) => (String(url).includes('/api/hist/live1m/') ? Promise.resolve(statusResponse(404)) : new Promise(() => {})))
    // the app's store is made with the app's own live managers: stood in for (a chart's stream is not this rail's subject)
    vi.doMock('../../lib/barsStreamManager', async (orig) => ({ ...(await orig()), subscribe: () => () => {}, getStatus: () => ({ connected: true, healthy: true, delivering: true }) }))
    vi.doMock('../../lib/realtimeCandle', async (orig) => ({ ...(await orig()), subscribe: () => () => {}, getCandle: () => null, getLastTickAt: () => 0, getLastTrade: () => null }))
    vi.doMock('../../lib/priceStreamManager', async (orig) => ({ ...(await orig()), subscribe: () => () => {}, getSnapshot: () => ({ prices: {} }) }))
    const { getBarStore, _resetBarStoreForTests } = await import('./index')
    undo.push(_resetBarStoreForTests)
    return { s: getBarStore(), done: _resetBarStoreForTests }
  }

  it('S8 OFF (every member today): a chart mounts, three minutes pass, and nothing asks for a minute frame', async () => {
    const { s, done } = await appStore()
    s.subscribe('AAA_1', () => {})
    expect(s.minuteFeed()).toBe(null)
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(live1m()).toEqual([])
    expect(window.__uctMinuteFeed).toBeUndefined()
    done()
  })

  it('S9 ON: the first chart starts it; it asks for the minute file now due, never for head.json or today.bin', async () => {
    localStorage.setItem('uct.minuteFeed', '1')
    const { s, done } = await appStore()
    expect(live1m()).toEqual([])                                 // not before a chart is on the page
    s.registry.acquire('BBB_1')                                  // a row a list warmed: an idle 1m key to feed
    s.subscribe('AAA_1', () => {})
    const feed = await s.minuteFeed().ready
    expect(feed.running()).toBe(true)
    await vi.advanceTimersByTimeAsync(50)
    expect(live1m()).toEqual(['/api/hist/live1m/v1/2026-11-10/1001.bin'])
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    const asked = live1m()
    expect(asked.length).toBeGreaterThan(1)
    expect(asked.every((u) => /\/\d{4}\.bin$/.test(u))).toBe(true)
    done()
    const n = live1m().length
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(live1m().length).toBe(n)                              // the store is gone: so is its feed
  })
})
