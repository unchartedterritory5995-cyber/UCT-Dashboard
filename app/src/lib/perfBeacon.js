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
import { isDesktopApp } from './desktopBridge'

export const REPORT_AFTER_MS = 20000
export const MAX_API = 40
const ENDPOINT = '/api/perf/beacon'

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
export function buildReport({ pathname, origin, desktop, nav, fcp, lcp, longTasks, resources }) {
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
    dom_ready: nav ? ms(nav.domContentLoadedEventEnd) : undefined,
    load: nav ? ms(nav.loadEventEnd) : undefined,
    long_task_ms: ms(lt.reduce((t, e) => t + e.duration, 0)),
    long_tasks: lt.length,
    api,
  }
}

/** Observe, then send once: after REPORT_AFTER_MS, or earlier if the page is hidden or left. */
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
    const resources = perf.getEntriesByType('resource').filter((r) => r.startTime < REPORT_AFTER_MS)
    const report = buildReport({
      pathname: win.location.pathname, origin: win.location.origin, desktop, nav,
      fcp: fcpEntry?.startTime, lcp, longTasks, resources,
    })
    try {
      win.navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify(report)], { type: 'application/json' }))
    } catch { /* measurement never breaks the page */ }
    cleanup()
  }
  const onHide = () => { if (doc.visibilityState === 'hidden') send() }
  const timer = win.setTimeout(send, Math.max(0, REPORT_AFTER_MS - perf.now()))
  doc.addEventListener('visibilitychange', onHide)
  win.addEventListener('pagehide', send)
  function cleanup() {
    win.clearTimeout(timer)
    doc.removeEventListener('visibilitychange', onHide)
    win.removeEventListener('pagehide', send)
  }
  return cleanup
}
