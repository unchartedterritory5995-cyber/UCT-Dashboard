import { describe, expect, it, vi } from 'vitest'
import { FIRST_CANDLES_MARK, MAX_API, MAX_SWITCH_SENDS, REPORT_AFTER_MS, SWITCH_SEND_GAP_MS, SWITCH_SPEED_GLOBAL, apiTemplate, buildReport, pageTemplate, startPerfBeacon, switchesField } from './perfBeacon'
import { FIRST_CHART_PAINT_EVENT } from './barsPackClient'
import { SWITCH_SPEED_GLOBAL as INSTRUMENT_GLOBAL } from './switchSpeed'

const O = 'https://uctintelligence.com'

describe('perfBeacon: what may leave the page', () => {
  it('a page is its first path segment only', () => {
    expect(pageTemplate('/charts/NVDA')).toBe('/charts')
    expect(pageTemplate('/options-flow')).toBe('/options-flow')
    expect(pageTemplate('/')).toBe('/')
    expect(pageTemplate('/Charts')).toBe('/') // anything unexpected collapses to "/"
    expect(pageTemplate('/journal%20x')).toBe('/')
  })

  it('an API call keeps at most two lowercase words: no tickers, ids, dates or query strings', () => {
    expect(apiTemplate(`${O}/api/bars/NVDA?tf=D`, O)).toBe('/api/bars')
    expect(apiTemplate(`${O}/api/breadth-monitor/session/2026-11-11`, O)).toBe('/api/breadth-monitor/session')
    expect(apiTemplate(`${O}/api/j2/notes/123`, O)).toBe('/api/j2/notes')
    expect(apiTemplate(`${O}/api/j2/a1b2c3d4`, O)).toBe('/api/j2')
    expect(apiTemplate('/api/live-prices?syms=AAPL,MSFT', O)).toBe('/api/live-prices')
    expect(apiTemplate('https://other.example/api/bars', O)).toBeNull()
    expect(apiTemplate(`${O}/assets/index-abc.js`, O)).toBeNull()
    expect(apiTemplate(`${O}/api/9bad`, O)).toBeNull()
  })

  it('builds a report of numbers, the page and the client', () => {
    const r = buildReport({
      pathname: '/charts/NVDA', origin: O, desktop: true,
      nav: { responseStart: 120.4, domContentLoadedEventEnd: 700, loadEventEnd: 1500 },
      fcp: 600, lcp: 900.6, longTasks: [{ duration: 60 }, { duration: 90 }],
      resources: [
        { name: `${O}/api/bars/NVDA`, initiatorType: 'fetch', duration: 140, responseStatus: 200 },
        { name: `${O}/api/watchlists`, initiatorType: 'fetch', duration: 80, responseStatus: 500 },
        { name: `${O}/assets/x.js`, initiatorType: 'script', duration: 30 },
        { name: `${O}/api/notes`, initiatorType: 'img', duration: 5 },
      ],
    })
    expect(r).toEqual({
      page: '/charts', client: 'desktop', ttfb: 120, fcp: 600, lcp: 901, dom_ready: 700, load: 1500,
      long_task_ms: 150, long_tasks: 2,
      api: [{ route: '/api/bars', ms: 140, ok: true }, { route: '/api/watchlists', ms: 80, ok: false }],
    })
    expect(JSON.stringify(r)).not.toMatch(/NVDA/)
  })

  it('with Early Hints the first byte is the real page, not the 103', () => {
    const nav = { responseStart: 79, finalResponseHeadersStart: 168, domContentLoadedEventEnd: 300, loadEventEnd: 500 }
    expect(buildReport({ pathname: '/', origin: O, desktop: false, nav, resources: [] }).ttfb).toBe(168)
    const noHint = { responseStart: 140, finalResponseHeadersStart: 0, domContentLoadedEventEnd: 300, loadEventEnd: 500 }
    expect(buildReport({ pathname: '/', origin: O, desktop: false, nav: noHint, resources: [] }).ttfb).toBe(140)
  })

  it('signed out, forbidden or missing is an answer; 5xx, timeout and rate limit are failures', () => {
    const call = (responseStatus) => ({ name: `${O}/api/auth/me`, initiatorType: 'fetch', duration: 50, responseStatus })
    const r = buildReport({ pathname: '/', origin: O, desktop: false, resources: [401, 403, 404, 200, undefined, 500, 503, 408, 429].map(call) })
    expect(r.api.map((a) => a.ok)).toEqual([true, true, true, true, true, false, false, false, false])
  })

  it('caps the API list and clamps absurd numbers', () => {
    const resources = Array.from({ length: MAX_API + 10 }, () => ({ name: `${O}/api/bars`, initiatorType: 'fetch', duration: 10 }))
    const r = buildReport({ pathname: '/', origin: O, desktop: false, nav: { responseStart: -5, domContentLoadedEventEnd: 1e9, loadEventEnd: NaN }, resources })
    expect(r.api).toHaveLength(MAX_API)
    expect(r.ttfb).toBeUndefined()
    expect(r.dom_ready).toBe(120000)
    expect(r.load).toBeUndefined()
  })
})

function fakeEnv() {
  const listeners = {}
  const beacons = []
  const win = {
    location: { pathname: '/dashboard', origin: O },
    navigator: { sendBeacon: vi.fn((url, blob) => { beacons.push({ url, blob }); return true }) },
    PerformanceObserver: class { constructor(cb) { this.cb = cb } observe() {} disconnect() {} },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h),
    addEventListener: (t, fn) => { listeners[t] = fn },
    removeEventListener: (t) => { delete listeners[t] },
  }
  const doc = { visibilityState: 'visible', addEventListener: (t, fn) => { listeners[`doc:${t}`] = fn }, removeEventListener: (t) => { delete listeners[`doc:${t}`] } }
  const perf = { now: () => 1000, getEntriesByType: (t) => (t === 'navigation' ? [{ responseStart: 50, domContentLoadedEventEnd: 300, loadEventEnd: 600 }] : []) }
  return { win, doc, perf, beacons, listeners }
}

describe('startPerfBeacon', () => {
  it('reports time to first candles from the mark the first chart sets, and omits it on pages with no chart', async () => {
    expect(FIRST_CANDLES_MARK).toBe(FIRST_CHART_PAINT_EVENT)
    vi.useFakeTimers()
    const withChart = fakeEnv()
    withChart.perf.getEntriesByName = (name, type) => (name === FIRST_CANDLES_MARK && type === 'mark' ? [{ startTime: 612.4 }] : [])
    startPerfBeacon({ ...withChart, desktop: true })
    const noChart = fakeEnv()
    noChart.perf.getEntriesByName = () => []
    startPerfBeacon({ ...noChart, desktop: false })
    vi.advanceTimersByTime(REPORT_AFTER_MS)
    vi.useRealTimers()
    expect(JSON.parse(await withChart.beacons[0].blob.text())).toMatchObject({ client: 'desktop', candles: 612 })
    expect(JSON.parse(await noChart.beacons[0].blob.text()).candles).toBeUndefined()
  })

  it('sends exactly once, after the report delay', async () => {
    vi.useFakeTimers()
    const env = fakeEnv()
    startPerfBeacon({ ...env, desktop: false })
    vi.advanceTimersByTime(REPORT_AFTER_MS - 1000 - 1)
    expect(env.beacons).toHaveLength(0)
    vi.advanceTimersByTime(2)
    expect(env.beacons).toHaveLength(1)
    expect(env.beacons[0].url).toBe('/api/perf/beacon')
    const body = JSON.parse(await env.beacons[0].blob.text())
    expect(body).toMatchObject({ page: '/dashboard', client: 'browser', ttfb: 50, load: 600 })
    env.listeners.pagehide?.()
    vi.advanceTimersByTime(REPORT_AFTER_MS)
    expect(env.beacons).toHaveLength(1)
    vi.useRealTimers()
  })

  it('sends early when the member leaves or hides the page, and never twice', () => {
    vi.useFakeTimers()
    const env = fakeEnv()
    startPerfBeacon({ ...env, desktop: true })
    env.doc.visibilityState = 'hidden'
    env.listeners['doc:visibilitychange']()
    expect(env.beacons).toHaveLength(1)
    vi.advanceTimersByTime(REPORT_AFTER_MS)
    expect(env.beacons).toHaveLength(1)
    vi.useRealTimers()
  })

  it('a hide and a page-leave arriving together still send once', () => {
    const env = fakeEnv()
    startPerfBeacon({ ...env, desktop: false })
    const onHide = env.listeners['doc:visibilitychange']
    const onLeave = env.listeners.pagehide
    env.doc.visibilityState = 'hidden'
    onHide()
    onLeave() // the browser had already queued it before our listener was removed
    expect(env.beacons).toHaveLength(1)
  })

  it('does nothing where sendBeacon is missing', () => {
    const env = fakeEnv()
    delete env.win.navigator.sendBeacon
    startPerfBeacon({ ...env, desktop: false })
    expect(env.beacons).toHaveLength(0)
  })
})

// ── chart-switch speed (2026-11-23): the counts lib/switchSpeed.js keeps are sent when the page is hidden or left ──
const COUNTS = () => ({ v: 1, cells: [[0, 1, 0, 1, 1, 2, 14, 9, 3, 0, 0, 0, 0, 0, 0, 0]], counters: [4, 0, 2, 0, 0, 0] })
/** A page whose instrument hands over `next()` each time it is asked (null: nothing counted since the last send). */
function switchEnv(next) {
  const env = fakeEnv()
  let now = 1000
  env.perf.now = () => now
  env.at = (t) => { now = t }
  env.peeks = 0
  env.takes = 0
  env.win.location.pathname = '/charts'
  // the instrument: `peek` reads the counts, `take` reads AND forgets them
  env.win[SWITCH_SPEED_GLOBAL] = { peek: () => { env.peeks += 1; return next() }, take: () => { env.takes += 1; return next() } }
  env.hide = () => { env.doc.visibilityState = 'hidden'; env.listeners['doc:visibilitychange']() }
  env.show = () => { env.doc.visibilityState = 'visible'; env.listeners['doc:visibilitychange']() }
  env.bodies = () => Promise.all(env.beacons.map(async (b) => JSON.parse(await b.blob.text())))
  return env
}

describe('the chart-switch counts ride the same door', () => {
  it('the name the instrument is found under is the one it leaves itself under', () => {
    expect(SWITCH_SPEED_GLOBAL).toBe(INSTRUMENT_GLOBAL)
  })

  it('a hidden page sends ONE switches report beside its page-load report, and the page-load report carries none', async () => {
    const env = switchEnv(COUNTS)
    startPerfBeacon({ ...env, desktop: true })
    env.hide()
    const [load, sw] = await env.bodies()
    expect(env.beacons).toHaveLength(2)
    expect(env.beacons[1].url).toBe('/api/perf/beacon')
    expect(load.kind).toBeUndefined()
    expect(load.switches).toBeUndefined()
    expect(sw).toEqual({ page: '/charts', client: 'desktop', kind: 'switches', switches: COUNTS() })
    expect([env.peeks, env.takes]).toEqual([1, 1])       // read to build the report; forgotten once it was queued
  })

  it('a report the browser REFUSES keeps its counts: they are forgotten only once a report is queued', async () => {
    const env = switchEnv(COUNTS)
    let accept = false
    env.win.navigator.sendBeacon = vi.fn((url, blob) => { if (accept) env.beacons.push({ url, blob }); return accept })
    startPerfBeacon({ ...env, desktop: false })
    env.hide()                                           // the browser's queue is full: nothing goes
    expect(env.beacons).toHaveLength(0)
    expect([env.peeks, env.takes]).toEqual([1, 0])       // the counts stay with the instrument
    accept = true
    env.show()
    env.at(1000 + 5)                                     // nothing was sent, so there is no gap to wait out
    env.hide()
    expect(env.beacons).toHaveLength(1)
    expect((await env.bodies())[0]).toMatchObject({ kind: 'switches', switches: COUNTS() })
    expect([env.peeks, env.takes]).toEqual([2, 1])
    // a sendBeacon that THROWS is a refusal too
    const thrower = switchEnv(COUNTS)
    thrower.win.navigator.sendBeacon = vi.fn(() => { throw new Error('no') })
    startPerfBeacon({ ...thrower, desktop: false })
    thrower.hide()
    expect([thrower.peeks, thrower.takes]).toEqual([1, 0])
  })

  it('nothing counted: nothing sent, however often the page is hidden', () => {
    const env = switchEnv(() => null)
    startPerfBeacon({ ...env, desktop: false })
    env.hide()
    env.show()
    env.at(1000 + SWITCH_SEND_GAP_MS + 1)
    env.hide()
    env.listeners.pagehide()
    expect(env.beacons).toHaveLength(1)                  // the page-load report alone
  })

  it('a page hidden again inside the gap keeps its counts; past the gap, or as it is left, it sends them', () => {
    const env = switchEnv(COUNTS)
    startPerfBeacon({ ...env, desktop: false })
    env.hide()                                           // the page-load report + the first switches report
    expect(env.beacons).toHaveLength(2)
    env.show()
    env.at(1000 + SWITCH_SEND_GAP_MS - 1)
    env.hide()
    expect(env.beacons).toHaveLength(2)
    expect([env.peeks, env.takes]).toEqual([1, 1])       // not even asked: the counts stay with the instrument
    env.show()
    env.at(1000 + SWITCH_SEND_GAP_MS)
    env.hide()
    expect(env.beacons).toHaveLength(3)
    env.show()
    env.at(1000 + SWITCH_SEND_GAP_MS + 5)
    env.listeners.pagehide()                             // leaving: the gap does not hold the last counts back
    expect(env.beacons).toHaveLength(4)
  })

  it('a page sends at most MAX_SWITCH_SENDS switches reports in its life', () => {
    const env = switchEnv(COUNTS)
    startPerfBeacon({ ...env, desktop: false })
    for (let i = 0; i < MAX_SWITCH_SENDS + 5; i++) env.listeners.pagehide()
    expect(env.beacons).toHaveLength(1 + MAX_SWITCH_SENDS)
  })

  it('the field is REBUILT from whole numbers: anything else, anywhere in it, and nothing is sent', () => {
    expect(switchesField(COUNTS())).toEqual(COUNTS())
    const built = switchesField({ ...COUNTS(), sym: 'NVDA', cells: Object.assign([[0, 1, 0, 1, 1, 2]], { note: 'x' }) })
    expect(built).toEqual({ v: 1, cells: [[0, 1, 0, 1, 1, 2]], counters: [4, 0, 2, 0, 0, 0] })   // only the three keys, rebuilt
    const bad = [
      null, undefined, 'x', 7, [],
      { ...COUNTS(), v: '1' },
      { ...COUNTS(), cells: [[0, 1, 0, 1, 1, 'NVDA']] },
      { ...COUNTS(), cells: [[0, 1, 0, 1, 1, 2.5]] },
      { ...COUNTS(), cells: [[0, 1, 0, 1, 1, -1]] },
      { ...COUNTS(), cells: [[0, 1, 0, 1, 1, NaN]] },
      { ...COUNTS(), cells: [[0, 1, 0, 1, 1, 1e9]] },
      { ...COUNTS(), cells: [{ 0: 1 }] },
      { ...COUNTS(), cells: 'cells' },
      { ...COUNTS(), cells: Array.from({ length: 65 }, () => [0]) },
      { ...COUNTS(), cells: [Array.from({ length: 33 }, () => 0)] },
      { ...COUNTS(), counters: [1, 'two'] },
      { ...COUNTS(), counters: Array.from({ length: 17 }, () => 0) },
      { v: 1, cells: [] },
    ]
    for (const raw of bad) expect(switchesField(raw), JSON.stringify(raw)).toBeUndefined()
    const env = switchEnv(() => ({ ...COUNTS(), cells: [[0, 1, 0, 1, 1, 'NVDA']] }))
    startPerfBeacon({ ...env, desktop: false })
    env.hide()
    expect(env.beacons).toHaveLength(1)
    // an instrument that throws costs nothing either
    const thrower = switchEnv(() => { throw new Error('no') })
    startPerfBeacon({ ...thrower, desktop: false })
    thrower.hide()
    expect(thrower.beacons).toHaveLength(1)
  })

  it('a page with no instrument (no chart was ever loaded) sends only its page-load report', () => {
    const env = fakeEnv()
    startPerfBeacon({ ...env, desktop: false })
    env.doc.visibilityState = 'hidden'
    env.listeners['doc:visibilitychange']()
    env.listeners.pagehide()
    expect(env.beacons).toHaveLength(1)
  })
})
