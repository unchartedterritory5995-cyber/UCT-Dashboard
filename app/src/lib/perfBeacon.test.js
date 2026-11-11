import { describe, expect, it, vi } from 'vitest'
import { MAX_API, REPORT_AFTER_MS, apiTemplate, buildReport, pageTemplate, startPerfBeacon } from './perfBeacon'

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
