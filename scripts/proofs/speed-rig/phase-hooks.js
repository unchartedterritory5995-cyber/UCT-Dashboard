// (cold-arch 2026-11-28, read-only instrumentation, this rig copy only) THE BAR PATH'S PHASES per request, in page time:
//   call   : when the app called fetch() for a bars URL (key -> call = client work before the request)
//   hdr    : when the fetch promise resolved (headers in)
//   bodyS/bodyE : the body read (text/arrayBuffer) the app asked for, and when the bytes were all in
//   parseS/parseE : JSON.parse of that body (Response.json() is re-done here as text() + JSON.parse, same result)
//   rows   : bars in the answer (bars/data/candles array length)
// Plus long tasks (>= 50 ms, the Long Tasks API floor) with start and duration. Nothing is changed but the timing record.
;(() => {
  if (window.top !== window || window.__phase) return
  const P = (window.__phase = { req: [], tasks: [], max: 4000 })
  const isBars = (u) => /\/api\/(bars|bars-history|hist|barspack|bars-pack)\//.test(u) || /\/api\/bars[-?]/.test(u)
  const rowsOf = (o) => { try { const b = Array.isArray(o) ? o : (o && (o.bars || o.data || o.candles || o.rows)); return Array.isArray(b) ? b.length : (b && b.t && b.t.length) || null } catch (e) { return null } }
  const of = window.fetch
  window.fetch = function (input, init) {
    const u = typeof input === 'string' ? input : (input && input.url) || String(input)
    if (!isBars(u)) return of.apply(this, arguments)
    const rec = { u: u.replace(location.origin, '').slice(0, 160), call: performance.now(), hdr: null, st: null, bodyS: null, bodyE: null, parseS: null, parseE: null, rows: null, bytes: null }
    if (P.req.length < P.max) P.req.push(rec)
    const pr = of.apply(this, arguments)
    pr.then((r) => { rec.hdr = performance.now(); rec.st = r.status; try { rec.cf = r.headers.get('cf-cache-status'); rec.age = r.headers.get('age'); rec.edge = r.headers.get('x-bars-edge'); rec.ubh = !!r.headers.get('x-ubh-header') } catch (e) {} try { r.__phase = rec } catch (e) {} }, () => { rec.hdr = -1 })
    return pr
  }
  const R = Response.prototype
  const text0 = R.text, ab0 = R.arrayBuffer
  R.json = function () {
    const rec = this.__phase
    const t0 = performance.now()
    return text0.call(this).then((txt) => {
      const t1 = performance.now()
      const o = JSON.parse(txt)
      const t2 = performance.now()
      if (rec) { rec.bodyS = t0; rec.bodyE = t1; rec.parseS = t1; rec.parseE = t2; rec.rows = rowsOf(o); rec.bytes = txt.length }
      return o
    })
  }
  R.arrayBuffer = function () {
    const rec = this.__phase
    const t0 = performance.now()
    return ab0.call(this).then((b) => { if (rec) { rec.bodyS = t0; rec.bodyE = performance.now(); rec.bytes = b.byteLength; rec.kind = 'arrayBuffer' } return b })
  }
  R.text = function () {
    const rec = this.__phase
    const t0 = performance.now()
    return text0.call(this).then((t) => { if (rec && rec.bodyS == null) { rec.bodyS = t0; rec.bodyE = performance.now(); rec.bytes = t.length; rec.kind = 'text' } return t })
  }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (P.tasks.length < 3000) P.tasks.push({ s: Math.round(e.startTime * 10) / 10, d: Math.round(e.duration) }) } }).observe({ type: 'longtask', buffered: false }) } catch (e) {}
})()
