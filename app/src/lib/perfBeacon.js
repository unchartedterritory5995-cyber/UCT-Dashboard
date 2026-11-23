// Real-user speed measurement (desktop speed plan Step 10.1). One report per page load, from the
// member's own browser or desktop app, to POST /api/perf/beacon (api/services/perf_beacon.py).
//
// What it measures: time to first byte, first and largest paint, DOM ready, load, main-thread long
// tasks, and each /api/* call made in the first REPORT_AFTER_MS. What it sends: numbers, the page's
// FIRST path segment, `browser|desktop`, and each API call reduced to /api/<word>[/<word>] with no
// digits in the second word. Never a ticker, an id, a query string or anything typed. The server
// refuses (does not clean) any report that does not fit that shape.
//
// Cost: this file is loaded with import() only after the page's own load event, so it is not part of
// first-open bytes; observing performance entries is free; one sendBeacon per page load.
//
// ⭐ CHART-SWITCH SPEED (2026-11-23). The page-load report above is sent once, ~20 s in; a member switches
// charts for hours after it. lib/switchSpeed.js counts key-press-to-frame times into fixed buckets, and this
// file sends those COUNTS when the page is hidden or left: a second kind of report (`kind: 'switches'`) to
// the same door, at most one per SWITCH_SEND_GAP_MS while the page lives (plus the one as it is left), and
// none at all when no chart was switched. It is integers only: `switchesField` REBUILDS the field from
// whole numbers it has checked one by one, so nothing the page holds (a ticker, a list's name) can be in it,
// whatever handed it over. The instrument is found on `window`, never imported: this chunk stays as it was.
import { isDesktopApp } from './desktopBridge'

export const REPORT_AFTER_MS = 20000
export const MAX_API = 40
const ENDPOINT = '/api/perf/beacon'
// The mark barsPackClient.markFirstChartPaint sets. A literal, not an import: importing barsPackClient
// would pull it into this small after-load chunk. perfBeacon.test.js pins the two equal.
export const FIRST_CANDLES_MARK = 'uct:first-chart-paint'
// Where lib/switchSpeed.js leaves `{ take }`. A literal, not an import (as above); the test pins the two equal.
export const SWITCH_SPEED_GLOBAL = '__uctSwitchSpeed'
/** A hidden page sends its switch counts at most this often (they keep adding up in between). */
export const SWITCH_SEND_GAP_MS = 5 * 60_000
/** ...and a page sends at most this many switch reports in its life. */
export const MAX_SWITCH_SENDS = 40
// The transport's own bounds on the field (the server's are the exact ones: api/services/perf_beacon.py).
const SWITCH_MAX_CELLS = 64
const SWITCH_MAX_CELL_LEN = 32
const SWITCH_MAX_COUNTERS = 16
const SWITCH_MAX_INT = 100000

/** `/charts/NVDA?x=1` -> `/charts`. */
export function pageTemplate(pathname) {
  const seg = String(pathname || '/').split('/')[1] || ''
  return /^[a-z0-9-]{1,40}$/.test(seg) ? `/${seg}` : '/'
}

/** `https://host/api/bars/NVDA?tf=D` -> `/api/bars`; `/api/breadth-monitor/session/2026-11-11` ->
 * `/api/breadth-monitor/session`. null for anything that is not an /api call on this site. */
export function apiTemplate(url, origin) {
  let u
  try { u = new URL(url, origin) } catch { return null }
  if (u.origin !== origin) return null
  const parts = u.pathname.split('/')
  if (parts[1] !== 'api' || !/^[a-z][a-z0-9_-]{0,40}$/.test(parts[2] || '')) return null
  const second = parts[3] || ''
  return /^[a-z][a-z-]{0,40}$/.test(second) ? `/api/${parts[2]}/${second}` : `/api/${parts[2]}`
}

const ms = (v) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 120000) : undefined)

// With Early Hints, Chrome's responseStart is the 103's first byte (tens of ms) and the real page's
// first byte is finalResponseHeadersStart. Reporting responseStart would make the server look instant.
const pageFirstByte = (nav) => (nav.finalResponseHeadersStart > 0 ? nav.finalResponseHeadersStart : nav.responseStart)

// A failed call is the server or the network failing: 5xx, a timeout, rate limiting. A 401/403/404 is an
// answer (signed out, not allowed, nothing there), not a reliability failure. 0/undefined = not reported.
const failedStatus = (status) => status >= 500 || status === 408 || status === 429

/** Build the report from performance entries. Pure: the caller supplies everything it reads. */
export function buildReport({ pathname, origin, desktop, nav, fcp, lcp, candles, longTasks, resources }) {
  const api = []
  for (const r of resources || []) {
    if (api.length >= MAX_API) break
    if (r.initiatorType !== 'fetch' && r.initiatorType !== 'xmlhttprequest') continue
    const route = apiTemplate(r.name, origin)
    if (!route) continue
    api.push({ route, ms: ms(r.duration) ?? 0, ok: !failedStatus(r.responseStatus) })
  }
  const lt = longTasks || []
  return {
    page: pageTemplate(pathname),
    client: desktop ? 'desktop' : 'browser',
    ttfb: nav ? ms(pageFirstByte(nav)) : undefined,
    fcp: ms(fcp),
    lcp: ms(lcp),
    // When the page's first chart had its bars. Absent on pages without a chart.
    candles: ms(candles),
    dom_ready: nav ? ms(nav.domContentLoadedEventEnd) : undefined,
    load: nav ? ms(nav.loadEventEnd) : undefined,
    long_task_ms: ms(lt.reduce((t, e) => t + e.duration, 0)),
    long_tasks: lt.length,
    api,
  }
}

const wholeNumber = (v, max) => Number.isInteger(v) && v >= 0 && v <= max

/**
 * The `switches` field, REBUILT from what the instrument handed over: `{ v, cells: [[int...]...], counters: [int...] }`
 * with every number a whole one in range, or undefined (nothing is sent) if anything at all is not. Never a
 * pass-through: a string, a float, an extra key or an oversized list cannot reach the report.
 */
export function switchesField(raw) {
  if (!raw || typeof raw !== 'object' || !wholeNumber(raw.v, 99)) return undefined
  if (!Array.isArray(raw.cells) || raw.cells.length > SWITCH_MAX_CELLS) return undefined
  if (!Array.isArray(raw.counters) || raw.counters.length > SWITCH_MAX_COUNTERS) return undefined
  const cells = []
  for (const c of raw.cells) {
    if (!Array.isArray(c) || c.length > SWITCH_MAX_CELL_LEN) return undefined
    const row = []
    for (const v of c) {
      if (!wholeNumber(v, SWITCH_MAX_INT)) return undefined
      row.push(v)
    }
    cells.push(row)
  }
  const counters = []
  for (const v of raw.counters) {
    if (!wholeNumber(v, SWITCH_MAX_INT)) return undefined
    counters.push(v)
  }
  return { v: raw.v, cells, counters }
}

/** Observe, then send the page-load report once: after REPORT_AFTER_MS, or earlier if the page is hidden or left.
 *  After it, each time the page is hidden or left: the chart-switch counts, if there are any (see the top). */
export function startPerfBeacon({ win = window, doc = document, perf = window.performance, desktop = isDesktopApp() } = {}) {
  if (!perf || typeof perf.getEntriesByType !== 'function' || typeof win.navigator?.sendBeacon !== 'function') return () => {}
  let lcp
  const longTasks = []
  const observers = []
  const observe = (type, fn) => {
    try {
      const o = new win.PerformanceObserver((list) => list.getEntries().forEach(fn))
      o.observe({ type, buffered: true })
      observers.push(o)
    } catch { /* this browser lacks the entry type: that field is simply absent */ }
  }
  observe('largest-contentful-paint', (e) => { lcp = e.startTime })
  observe('longtask', (e) => { if (e.startTime < REPORT_AFTER_MS) longTasks.push(e) })

  let sent = false
  const send = () => {
    if (sent) return
    sent = true
    observers.forEach((o) => { try { o.disconnect() } catch { /* gone */ } })
    const nav = perf.getEntriesByType('navigation')[0]
    const fcpEntry = perf.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')
    const candlesEntry = (typeof perf.getEntriesByName === 'function' ? perf.getEntriesByName(FIRST_CANDLES_MARK, 'mark') : [])[0]
    const resources = perf.getEntriesByType('resource').filter((r) => r.startTime < REPORT_AFTER_MS)
    const report = buildReport({
      pathname: win.location.pathname, origin: win.location.origin, desktop, nav,
      fcp: fcpEntry?.startTime, lcp, candles: candlesEntry?.startTime, longTasks, resources,
    })
    try {
      win.navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify(report)], { type: 'application/json' }))
    } catch { /* measurement never breaks the page */ }
    win.clearTimeout(timer)
  }

  // The chart-switch counts. `leaving`: the page is going away, so the gap does not hold this one back.
  let switchSends = 0
  let lastSwitchSendAt = -Infinity
  const sendSwitches = (leaving) => {
    if (switchSends >= MAX_SWITCH_SENDS) return
    const now = perf.now()
    if (!leaving && now - lastSwitchSendAt < SWITCH_SEND_GAP_MS) return
    let switches
    try { switches = switchesField(win[SWITCH_SPEED_GLOBAL]?.take?.()) } catch { return }
    if (!switches) return
    switchSends += 1
    lastSwitchSendAt = now
    const body = { page: pageTemplate(win.location.pathname), client: desktop ? 'desktop' : 'browser', kind: 'switches', switches }
    try {
      win.navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify(body)], { type: 'application/json' }))
    } catch { /* measurement never breaks the page */ }
  }

  const onHide = () => { if (doc.visibilityState === 'hidden') { send(); sendSwitches(false) } }
  const onLeave = () => { send(); sendSwitches(true) }
  const timer = win.setTimeout(send, Math.max(0, REPORT_AFTER_MS - perf.now()))
  doc.addEventListener('visibilitychange', onHide)
  win.addEventListener('pagehide', onLeave)
  return function stop() {
    win.clearTimeout(timer)
    doc.removeEventListener('visibilitychange', onHide)
    win.removeEventListener('pagehide', onLeave)
  }
}
