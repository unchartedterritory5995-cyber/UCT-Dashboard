// (cold-arch 2026-11-28) LAKE PROBE, run in the signed-in page: for each symbol, its lake index (what series/periods
// exist, first/last bar per series), then for chosen series and periods ONE piece read twice (cold, then again =
// browser/edge copy), timed from resource timing, with the response headers that say where it came from, and the
// body's columns decoded by a port of FORMAT.md section 4 steps 6-7 (timed: what a main-thread decode costs).
// Read-only GETs. Returns a plain object. Called as: (LAKE_PROBE)(syms, picks)
async (syms, picks) => {
  const enc = (s) => 's-' + [...new TextEncoder().encode(s)].map((b) => (b >= 48 && b <= 57) || (b >= 65 && b <= 90) ? String.fromCharCode(b) : '_' + b.toString(16).toUpperCase().padStart(2, '0')).join('')
  const hdrs = (r) => { const o = {}; for (const k of ['cf-cache-status', 'cache-control', 'age', 'x-ubh-header', 'content-encoding', 'content-length', 'x-hist-source', 'x-edge-cache', 'server-timing', 'x-bars-edge']) { const v = r.headers.get(k); if (v != null) o[k] = k === 'x-ubh-header' ? v.slice(0, 400) : v } return o }
  const rt = (url) => { const es = performance.getEntriesByName(new URL(url, location.href).href); const e = es[es.length - 1]; return e ? { start: Math.round(e.startTime), ttfb: Math.round(e.responseStart - e.startTime), total: Math.round(e.responseEnd - e.startTime), tx: e.transferSize, enc: e.encodedBodySize, dec: e.decodedBodySize, proto: e.nextHopProtocol } : null }
  const decode = (buf, n) => {
    const b = new Uint8Array(buf); let pos = 0; const cols = []
    for (let c = 0; c < 8; c++) { const col = new Float64Array(n); for (let i = 0; i < n; i++) { let v = 0, m = 1, byte; do { byte = b[pos++]; v += (byte & 0x7f) * m; m *= 128 } while (byte >= 0x80); col[i] = v } cols.push(col) }
    const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), cl = new Float64Array(n)
    const uz = (u) => (u % 2 === 0 ? u / 2 : -(u + 1) / 2)
    let tp = 0, cp = 0
    for (let i = 0; i < n; i++) { t[i] = tp + cols[0][i]; o[i] = cp + uz(cols[1][i]); cl[i] = o[i] + uz(cols[4][i]); h[i] = Math.max(o[i], cl[i]) + uz(cols[2][i]); l[i] = Math.min(o[i], cl[i]) - uz(cols[3][i]); tp = t[i]; cp = cl[i] }
    return { ok: pos === b.length, n, firstT: t[0], lastT: t[n - 1] }
  }
  const out = { syms: {} }
  for (const sym of syms) {
    const S = (out.syms[sym] = {})
    const iu = `/api/hist/v1/index/${enc(sym)}.json`
    for (const rep of [0, 1]) {
      const t0 = performance.now(); let r; try { r = await fetch(iu, { credentials: 'same-origin', cache: 'no-store' }) } catch (e) { S['index' + rep] = { err: String(e) }; continue }
      const txt = await r.text(); const t1 = performance.now()
      S['index' + rep] = { st: r.status, ms: Math.round(t1 - t0), bytes: txt.length, h: hdrs(r) }
      if (r.ok && rep === 0) {
        const j = JSON.parse(txt); S.splits = (j.splits || []).length
        S.series = {}
        for (const [ser, per] of Object.entries(j.series || {})) { const ks = Object.keys(per).sort(); const tot = ks.reduce((a, k) => a + (per[k].bars || 0), 0); const by = ks.reduce((a, k) => a + (per[k].bytes || 0), 0); S.series[ser] = { periods: ks.length, firstPeriod: ks[0], lastPeriod: ks[ks.length - 1], lastBar: per[ks[ks.length - 1]].last, bars: tot, bytes: by } }
        S._idx = j
      }
    }
    const j = S._idx; delete S._idx
    if (!j) continue
    S.pieces = []
    for (const [ser, want] of picks) {
      const per = j.series && j.series[ser]; if (!per) { S.pieces.push({ ser, missing: 'series' }); continue }
      const ks = Object.keys(per).sort(); const k = ks.find((x) => x.startsWith(want)) || null
      if (!k) { S.pieces.push({ ser, want, missing: 'period', have: [ks[0], ks[ks.length - 1]] }); continue }
      const e = per[k]
      const url = `/api/hist/v1/${ser}/${enc(sym)}/${k}.ubh?c=${e.crc}&o=${e.off}&n=${e.bytes}`
      for (const rep of [0, 1]) {
        const t0 = performance.now(); const r = await fetch(url, { credentials: 'same-origin' }); const buf = await r.arrayBuffer(); const t1 = performance.now()
        let dec = null
        if (r.ok && rep === 0) { let hh = null; try { hh = JSON.parse(r.headers.get('x-ubh-header') || 'null') } catch (er) {} if (hh && hh.bars && r.headers.get('x-ubh-header')) { const d0 = performance.now(); const d = decode(buf, hh.bars); dec = { ms: Math.round((performance.now() - d0) * 100) / 100, ...d } } }
        S.pieces.push({ ser, period: k, rep, st: r.status, ms: Math.round(t1 - t0), bodyBytes: buf.byteLength, idxBytes: e.bytes, bars: e.bars, h: hdrs(r), rt: rt(url), dec })
      }
    }
  }
  return out
}
