// tools/vendor_harness/tv_capture.js
//
// ─── THE TRADINGVIEW-SIDE HALF OF THE VENDOR-COMPARISON HARNESS ───────────────
//
// Paste this WHOLE FILE into a signed-in TradingView chart tab through a
// JavaScript-execution tool. It defines `window.__uctVH` and returns a one-line
// "ready" string. Then:
//
//   __uctVH.studies()                       // list what is on the chart (+ the control)
//   __uctVH.capture({                       // read ONE study off the chart model
//     study: 'UCTVH …',                     //   substring of the study's title — must match exactly one
//     source: '<the exact Pine you pasted>',//   hashed here (sha256) and carried verbatim
//     id: 'my-script-spy-1d-2026-09-27',    //   optional; becomes the capture id
//     newestBarIsForming: false,            //   say so when capturing after the close
//     startsAtBar0: false,                  //   true ONLY if the loaded history reaches bar 0
//     chunkSize: 60000,                     //   characters per chunk for transport
//   })                                      // → summary {ok, chars, fnv1a, chunks, …}
//   __uctVH.chunk(0) … __uctVH.chunk(n-1)   // → {i, n, text, fnv1a, total:{chars, fnv1a}}
//   __uctVH.cleanup()                       // remove every trace this added
//
// Write the chunks, in order, as `chunk-000.json` … and assemble + verify with
//   node tools/vendor_harness/verify_capture.mjs --assemble <dir> --out <capture.json>
// (docs/pine/VENDOR-HARNESS.md has the whole procedure).
//
// ⛔ READ-ONLY. It never changes the symbol, the interval, a study, the layout or
// the Pine editor buffer — the browser is shared (capture-procedure.md, "Leaving
// the chart as you found it").
// ⛔ NEVER `chart.exportData()` — plan-gated. Everything here is the model TradingView
// already exposes on `window._exposed_chartWidgetCollection`.
// ⛔ SELF-CONTAINED: no imports, no fetch, no network. The FNV-1a and sha256 here
// are asserted equal to `schema.mjs`'s by `vendorHarness.test.js`.

(function () {
  'use strict'
  const SENTINEL = -1000000                          // model rows at/below this index are padding
  const EVENTS = new Set(['Splits', 'Earnings', 'Dividends'])   // chart events, not indicators

  // ── transport integrity ────────────────────────────────────────────────────
  function fnv1a(s) {
    let h = 2166136261 >>> 0
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
    return h
  }

  // sha256 over UTF-8 bytes, synchronous (a JS tool may not await a promise).
  function sha256Hex(str) {
    const bytes = new TextEncoder().encode(String(str))
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2])
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
    const len = bytes.length
    const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6)
    padded.set(bytes)
    padded[len] = 0x80
    const bitsHi = Math.floor((len * 8) / 0x100000000)
    const bitsLo = (len * 8) >>> 0
    const dv = new DataView(padded.buffer)
    dv.setUint32(padded.length - 8, bitsHi)
    dv.setUint32(padded.length - 4, bitsLo)
    const W = new Uint32Array(64)
    const rotr = (x, n) => (x >>> n) | (x << (32 - n))
    for (let off = 0; off < padded.length; off += 64) {
      for (let t = 0; t < 16; t++) W[t] = dv.getUint32(off + t * 4)
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3)
        const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10)
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0
      }
      let [a, b, c, d, e, f, g, h] = H
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
        const ch = (e & f) ^ (~e & g)
        const t1 = (h + S1 + ch + K[t] + W[t]) >>> 0
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
        const mj = (a & b) ^ (a & c) ^ (b & c)
        const t2 = (S0 + mj) >>> 0
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
    }
    return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('')
  }

  // ── reading helpers ────────────────────────────────────────────────────────
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  const tryOr = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v } catch (e) { return dflt } }

  /** A TradingView property node → a plain object. `properties().state()` throws
   *  on some studies ("(e ?? []) is not iterable"), hence the walker
   *  (capture_page.js carries the same one). */
  function plain(node, depth) {
    if (depth > 5 || node == null) return undefined
    if (typeof node.value === 'function' && typeof node.childNames !== 'function') return tryOr(() => node.value(), 'ERR')
    const out = {}
    const names = tryOr(() => (typeof node.childNames === 'function' ? node.childNames() : []), [])
    for (const n of names) {
      const c = tryOr(() => node.child(n), null)
      if (!c) continue
      const v = plain(c, depth + 1)
      if (v !== undefined) out[n] = v
    }
    if (!names.length && typeof node.value === 'function') return tryOr(() => node.value(), 'ERR')
    return Object.keys(out).length ? out : undefined
  }

  function model() {
    const col = window._exposed_chartWidgetCollection
    if (!col) throw new Error('no _exposed_chartWidgetCollection — is this a TradingView chart tab?')
    const cw = col.activeChartWidget.value()
    return { cw, mm: cw.model().model() }
  }

  /** The study census WITH ITS CONTROL (capture-procedure.md, "COUNTING
   *  STUDIES"): filter chart EVENTS by shortId, never by package — the built-in
   *  Volume is `tv-basicstudies` too. */
  function census(mm) {
    const all = mm.dataSources().filter((d) => d && typeof d.metaInfo === 'function')
    const rows = all.map((d) => {
      const mi = tryOr(() => d.metaInfo(), {}) || {}
      return {
        ds: d,
        id: mi.id || null,
        shortId: mi.shortId || null,
        title: tryOr(() => d.title(true), null),
        description: mi.description || null,
        shortDescription: mi.shortDescription || null,
      }
    })
    const events = rows.filter((r) => EVENTS.has(r.shortId))
    const indicators = rows.filter((r) => !EVENTS.has(r.shortId))
    return {
      rows,
      indicators,
      control: {
        studies: rows.length,
        events: events.map((r) => r.shortId),
        indicators: indicators.length,
        controlProbeSawSomething: rows.length > 0,
        controlFilterRemovedExactlyTheEvents: rows.length - indicators.length === events.length,
      },
    }
  }

  function studies() {
    const { mm } = model()
    const c = census(mm)
    return {
      ...c.control,
      list: c.indicators.map((r) => ({ id: r.id, shortId: r.shortId, title: r.title, description: r.description })),
    }
  }

  function readBars(series) {
    const b = series.bars()
    const out = []
    const push = (i, v) => {
      if (!(i > SENTINEL) || !v) return
      out.push([num(v[0]), num(v[1]), num(v[2]), num(v[3]), num(v[4]), num(v[5])])
    }
    if (b && typeof b.each === 'function') b.each((i, v) => { push(i, v); return false })
    else if (b && Array.isArray(b._items)) b._items.forEach((r) => push(r.index, r.value))
    return out.filter((r) => r[0] !== null)
  }

  function readStudyRows(ds) {
    const out = []
    const data = ds.data()
    const push = (i, v) => {
      if (!(i > SENTINEL) || !v) return
      out.push(Array.from(v, (x, k) => (k === 0 ? num(x) : num(x))))
    }
    if (data && typeof data.each === 'function') data.each((i, v) => { push(i, v); return false })
    else if (data && Array.isArray(data._items)) data._items.forEach((r) => push(r.index, r.value))
    return out.filter((r) => r[0] !== null)
  }

  /** Every drawing the study currently holds, verbatim, per family.
   *  `graphics().dwglines()` etc. are Map(name → Map(flag → collection)) whose
   *  collections carry `_primitivesDataById` (object-semantics capture,
   *  2026-09-08). Walked defensively: an unreadable family is reported, not zero. */
  function readGraphics(ds) {
    const g = tryOr(() => (typeof ds.graphics === 'function' ? ds.graphics() : null), null)
    if (!g) return null
    const families = { lines: 'dwglines', labels: 'dwglabels', boxes: 'dwgboxes', tables: 'dwgtables', tableCells: 'dwgtablecells', linefills: 'dwglinefills' }
    const out = { counts: {}, records: {}, texts: {}, unreadable: [] }
    for (const [fam, acc] of Object.entries(families)) {
      const root = tryOr(() => (typeof g[acc] === 'function' ? g[acc]() : null), null)
      if (!root) { out.unreadable.push(fam); continue }
      const recs = []
      const seen = new Set()
      const walk = (node, depth) => {
        if (!node || depth > 4 || seen.has(node)) return
        seen.add(node)
        const byId = node._primitivesDataById
        if (byId && typeof byId.forEach === 'function') { byId.forEach((v) => recs.push(v)); return }
        if (typeof node.forEach === 'function') node.forEach((v) => walk(v, depth + 1))
      }
      walk(root, 0)
      out.records[fam] = recs
      out.counts[fam] = recs.length
    }
    out.texts.labels = (out.records.labels || []).map((r) => (r && r.t !== undefined ? String(r.t) : ''))
    out.texts.tableCells = (out.records.tableCells || []).map((r) => (r && r.t !== undefined ? String(r.t) : ''))
    return out
  }

  const declaredTitle = (src) => {
    const m = /\bindicator\s*\(\s*(?:title\s*=\s*)?"([^"]*)"/.exec(String(src || ''))
    return m ? m[1] : null
  }

  let staged = null

  function capture(opts) {
    const o = opts || {}
    const warnings = []
    if (typeof o.study !== 'string' || !o.study) throw new Error('capture({study}) — name the study (substring of its title)')
    if (typeof o.source !== 'string' || !o.source.trim()) throw new Error('capture({source}) — pass the EXACT Pine text that was added to the chart')

    const { cw, mm } = model()
    const c = census(mm)
    if (!c.control.controlProbeSawSomething) throw new Error('the census saw no data sources at all — the probe looked nowhere')
    if (!c.control.controlFilterRemovedExactlyTheEvents) throw new Error('the event filter removed something that is not a chart event — refusing to trust the census')
    const hits = c.indicators.filter((r) => [r.title, r.description, r.shortDescription].some((t) => t && String(t).includes(o.study)))
    if (hits.length !== 1) {
      throw new Error(`study ${JSON.stringify(o.study)} matched ${hits.length} indicators — need exactly one. On the chart: `
        + c.indicators.map((r) => JSON.stringify(r.title)).join(', '))
    }
    const ds = hits[0].ds
    const status = tryOr(() => (typeof ds.status === 'function' ? ds.status() : null), null)
    if (status && status.type === 3) {
      throw new Error(`the study failed to compile: ${JSON.stringify((status.errorDescription || {}).error || status)}`)
    }
    const mi = ds.metaInfo()
    const series = mm.mainSeries()
    const si = tryOr(() => series.symbolInfo(), {}) || {}
    const interval = tryOr(() => series.interval(), null)
      || tryOr(() => series.properties().childs().interval.value(), null)
    const state = tryOr(() => ds.properties().state(), null) || plain(ds.properties(), 0) || {}

    const bars = readBars(series)
    const rows = readStudyRows(ds)
    const barTimes = new Set(bars.map((r) => r[0]))
    const onGrid = rows.filter((r) => barTimes.has(r[0]))
    if (onGrid.length !== rows.length) warnings.push(`${rows.length - onGrid.length} study rows are off the bar grid (a plot offset into the future?) and were dropped`)
    if (!bars.length) throw new Error('no bars read from mainSeries().bars()')
    if (!onGrid.length) throw new Error('the study has no rows on the bar grid — is it still computing? (status ' + JSON.stringify(status) + ')')

    // ⛔ ORDER FROM `metaInfo().plots`, NEVER `Object.keys(styles)`.
    const plots = (mi.plots || []).map((p) => ({
      id: p.id,
      type: p.type,
      ...(p.target ? { target: p.target } : {}),
      ...(p.palette ? { palette: p.palette } : {}),
      title: (mi.styles && mi.styles[p.id] && mi.styles[p.id].title) || null,
    }))
    const width = 1 + plots.length
    const valueRows = onGrid.map((r) => {
      const out = r.slice(0, width)
      while (out.length < width) out.push(null)
      return out
    })

    const palettes = {}
    for (const [pid, p] of Object.entries(mi.palettes || {})) {
      palettes[pid] = {
        valToIndex: p.valToIndex || null,
        colors: (mi.defaults && mi.defaults.palettes && mi.defaults.palettes[pid] && mi.defaults.palettes[pid].colors) || null,
      }
    }
    const inputs = (mi.inputs || []).map((inp) => ({
      id: inp.id, name: inp.name, type: inp.type, defval: inp.defval,
      value: state && state.inputs && inp.id in state.inputs ? state.inputs[inp.id] : null,
    }))

    const title = hits[0].title
    const srcTitle = declaredTitle(o.source)
    if (srcTitle && ![title, mi.description, mi.shortDescription].some((t) => t && String(t).startsWith(srcTitle))) {
      warnings.push(`the source declares indicator(${JSON.stringify(srcTitle)}) but the study on the chart is ${JSON.stringify(title)} — is this the right source?`)
    }

    const body = {
      schema: 'uct.vendor-capture/v1',
      id: o.id || String(srcTitle || title || 'capture').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      capturedAtUTC: new Date().toISOString(),
      tool: { snippet: 'tools/vendor_harness/tv_capture.js', version: 1 },
      page: { url: tryOr(() => location.href, null), visibilityState: tryOr(() => document.visibilityState, null), hasFocus: tryOr(() => document.hasFocus(), null) },
      symbol: {
        name: si.name || null, full_name: si.full_name || null, pro_name: si.pro_name || null,
        exchange: si.exchange || null, listed_exchange: si.listed_exchange || null, type: si.type || null,
        session: si.session || null, timezone: si.timezone || null,
        pricescale: num(si.pricescale), minmov: num(si.minmov), currency: si.currency_code || null,
      },
      timeframe: interval,
      newestBarIsForming: typeof o.newestBarIsForming === 'boolean' ? o.newestBarIsForming : null,
      history: { startsAtBar0: o.startsAtBar0 === true, why: o.startsAtBar0 === true ? (o.startsAtBar0Why || 'asserted by the capturer') : 'not asserted' },
      source: { text: o.source, sha256: sha256Hex(o.source), chars: o.source.length, declaredTitle: srcTitle },
      census: c.control,
      study: {
        id: mi.id || null, fullId: mi.fullId || null, title,
        description: mi.description || null, shortDescription: mi.shortDescription || null,
        status: status ? { type: status.type } : null,
        plots,
        styles: mi.styles || null,
        styleState: (state && state.styles) || null,
        palettes,
        paletteState: (state && state.palettes) || null,
        inputs,
      },
      window: {
        chartBarsLoaded: bars.length,
        studyBarsLoaded: rows.length,
        firstBarTime: bars[0][0], lastBarTime: bars[bars.length - 1][0],
      },
      bars: { fields: ['time', 'open', 'high', 'low', 'close', 'volume'], timeUnit: 'unix-s', count: bars.length, rows: bars },
      plotValues: { fields: ['time', ...plots.map((p) => p.id)], rows: valueRows },
      objects: readGraphics(ds),
      warnings,
    }
    const text0 = JSON.stringify(body)
    const sealed = { ...body, receipt: { algo: 'fnv1a32-utf16', over: 'JSON.stringify(capture without its receipt key)', chars: text0.length, fnv1a: fnv1a(text0) } }
    const text = JSON.stringify(sealed)
    const chunkSize = Number.isInteger(o.chunkSize) && o.chunkSize > 1000 ? o.chunkSize : 60000
    staged = { text, chunkSize, chunks: Math.ceil(text.length / chunkSize) }
    return {
      ok: true,
      id: body.id,
      study: title,
      symbol: body.symbol.pro_name || body.symbol.name,
      timeframe: interval,
      bars: bars.length,
      studyRows: rows.length,
      plots: plots.map((p) => `${p.id}:${p.type}:${p.title}`),
      objects: body.objects ? body.objects.counts : null,
      census: c.control,
      warnings,
      chars: text.length,
      fnv1a: fnv1a(text),
      chunkSize,
      chunks: staged.chunks,
    }
  }

  function chunk(i) {
    if (!staged) throw new Error('nothing staged — run capture() first')
    const n = staged.chunks
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`chunk index must be 0..${n - 1}`)
    const text = staged.text.slice(i * staged.chunkSize, (i + 1) * staged.chunkSize)
    return { i, n, text, fnv1a: fnv1a(text), total: { chars: staged.text.length, fnv1a: fnv1a(staged.text) } }
  }

  function cleanup() {
    staged = null
    try { delete window.__uctVH } catch (e) { window.__uctVH = undefined }
    return { globalsLeft: window.__uctVH === undefined ? [] : ['__uctVH'] }
  }

  window.__uctVH = { studies, capture, chunk, cleanup, _fnv1a: fnv1a, _sha256Hex: sha256Hex }
  return 'uct vendor harness ready: __uctVH.studies(), .capture({study, source, …}), .chunk(i), .cleanup()'
})()
