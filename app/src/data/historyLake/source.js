// Deep intraday history for one symbol, from the edge (`/api/hist/`, edge/bars-edge-router/history.js).
//
//   const src = createHistorySource()
//   const bars = await src.loadBars('AAPL', '5', { from, to })   // -> { t, o, h, l, c, v, n, ... }
//
// One small index per symbol says which pieces exist and where each one sits in its pack; a piece is
// one period (a month of 1m bars, a quarter of 5m, a year of 15/30/60m). The pieces a time range needs
// are fetched together, decoded (piece.js), joined oldest to newest and split-adjusted (adjust.js).
// Every piece URL carries the piece's CRC, offset and length from the index, so the browser keeps it
// forever and a changed piece is a new URL.
//
// No dependency on React, the BarStore or the DOM: it runs on the page or in a Worker, and `fetch`
// is a parameter so the tests drive it.
import { PieceError, T_UNIT, encodeSymbol, decodeColumns, toFloats } from './piece'
import { adjustColumns, cleanSplitTable } from './adjust'

export const HIST_BASE = '/api/hist'
export const HEADER_NAME = 'X-Ubh-Header'
/** Pieces in flight at once for one load (the connection is shared: HTTP/2 or 3 to the edge). */
export const MAX_PARALLEL = 8

/** The app's chart timeframe -> the lake series. 60m has two series: regular-session buckets
 *  (09:30-aligned) and extended-hours buckets (clock hours). */
export function seriesFor(tf, { extended = false } = {}) {
  const s = String(tf)
  if (s === '60') return extended ? '60e' : '60'
  return Object.hasOwn(T_UNIT, s) && s !== '60e' ? s : null
}

/** The vendor's spelling of an app symbol: class shares use a dot (`BRK-B` -> `BRK.B`). */
export function lakeSymbol(sym) {
  return String(sym || '').trim().toUpperCase().replace(/-/g, '.')
}

/** The index's periods of one series that overlap [from, to] (epoch seconds, either may be null),
 *  oldest first: `[{ period, bars, bytes, crc, first, last }]`. */
export function periodsFor(index, series, { from = null, to = null } = {}) {
  const periods = index && index.series && index.series[series]
  if (!periods || typeof periods !== 'object') return []
  const out = []
  for (const [period, e] of Object.entries(periods)) {
    if (!e || !Number.isFinite(e.first) || !Number.isFinite(e.last)) continue
    if (from != null && e.last < from) continue
    if (to != null && e.first > to) continue
    out.push({ period, ...e })
  }
  out.sort((a, b) => a.first - b.first)
  return out
}

export class HistoryError extends Error {
  constructor(message, { status = null, stale = false } = {}) {
    super(message)
    this.name = 'HistoryError'
    this.status = status
    this.stale = stale        // the index named a piece the edge no longer has in that form
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return out
}

/**
 * @param {{ fetch?: typeof fetch, base?: string, maxParallel?: number }} o
 */
export function createHistorySource(o = {}) {
  const doFetch = o.fetch ?? ((...a) => fetch(...a))
  const base = o.base ?? HIST_BASE
  const maxParallel = o.maxParallel ?? MAX_PARALLEL
  const indexes = new Map()      // lake symbol -> Promise<index | null>

  const get = (url, signal) => doFetch(url, { credentials: 'same-origin', signal })

  /** The symbol's index, or null when the lake has nothing for it. Kept for the page's life;
   *  `refreshIndex` drops it. */
  function loadIndex(sym, { signal } = {}) {
    const symbol = lakeSymbol(sym)
    let p = indexes.get(symbol)
    if (!p) {
      p = (async () => {
        const res = await get(`${base}/v1/index/${encodeSymbol(symbol)}.json`, signal)
        if (res.status === 404) return null
        if (!res.ok) throw new HistoryError(`index ${symbol}: HTTP ${res.status}`, { status: res.status })
        const doc = await res.json()
        if (!doc || doc.symbol !== symbol || typeof doc.series !== 'object' || doc.series === null) {
          throw new HistoryError(`index ${symbol}: not this symbol's index`)
        }
        return doc
      })()
      indexes.set(symbol, p)
      p.catch(() => { if (indexes.get(symbol) === p) indexes.delete(symbol) })   // an error is not kept
    }
    return p
  }

  function refreshIndex(sym) { indexes.delete(lakeSymbol(sym)) }

  async function loadPiece(symbol, series, entry, signal) {
    // the piece is one ranged read of its pack: offset `off`, length `bytes` (edge history.js)
    if (!Number.isSafeInteger(entry.off) || entry.off < 0 || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) {
      throw new HistoryError(`${symbol} ${series}/${entry.period}: the index gives no place for the piece`, { stale: true })
    }
    const url = `${base}/v1/${series}/${encodeSymbol(symbol)}/${entry.period}.ubh?c=${entry.crc}&o=${entry.off}&n=${entry.bytes}`
    const res = await get(url, signal)
    if (res.status === 409 || res.status === 404) {
      throw new HistoryError(`${symbol} ${series}/${entry.period}: the index is out of date`, { status: res.status, stale: true })
    }
    if (!res.ok) throw new HistoryError(`${symbol} ${series}/${entry.period}: HTTP ${res.status}`, { status: res.status })
    const headerJson = res.headers.get(HEADER_NAME)
    if (!headerJson) throw new HistoryError(`${symbol} ${series}/${entry.period}: no piece header in the answer`)
    const d = decodeColumns(headerJson, new Uint8Array(await res.arrayBuffer()))
    const hd = d.header
    if (hd.symbol !== symbol || hd.series !== series || hd.period !== entry.period || hd.crc !== entry.crc) {
      throw new PieceError(`${symbol} ${series}/${entry.period}: the answer is a different piece`)
    }
    return toFloats(d)
  }

  /**
   * Bars of `sym` at chart timeframe `tf` overlapping [from, to] (epoch seconds; null = open).
   * Resolves `null` when the lake has no such series for the symbol, otherwise
   * `{ symbol, series, t, o, h, l, c, v, n, pieces, adjusted }` with Float64Array columns, oldest
   * first, split-adjusted unless `raw: true`. Bars outside [from, to] in the edge pieces are kept:
   * a caller wanting an exact cut slices by `t`.
   * A piece the index names that the edge no longer has is retried ONCE against a fresh index.
   */
  async function loadBars(sym, tf, { from = null, to = null, extended = false, raw = false, signal } = {}) {
    const symbol = lakeSymbol(sym)
    const series = seriesFor(tf, { extended })
    if (!series) return null
    for (let attempt = 0; ; attempt++) {
      const index = await loadIndex(symbol, { signal })
      if (!index) return null
      const want = periodsFor(index, series, { from, to })
      if (!want.length) return index.series[series] ? emptyResult(symbol, series) : null
      let parts
      try {
        parts = await mapLimit(want, maxParallel, (e) => loadPiece(symbol, series, e, signal))
      } catch (err) {
        if (err instanceof HistoryError && err.stale && attempt === 0) { refreshIndex(symbol); continue }
        throw err
      }
      const out = join(parts)
      const splits = raw ? [] : cleanSplitTable(index.splits)
      if (splits.length) adjustColumns(out, splits)
      return { symbol, series, ...out, pieces: want.length, adjusted: !raw }
    }
  }

  return { loadIndex, refreshIndex, loadBars }
}

function emptyResult(symbol, series) {
  const z = () => new Float64Array(0)
  return { symbol, series, t: z(), o: z(), h: z(), l: z(), c: z(), v: z(), n: z(), pieces: 0, adjusted: true }
}

/** Join decoded pieces (each oldest first, given oldest piece first) into one set of columns.
 *  Bar times must keep rising across the joins. */
function join(parts) {
  let total = 0
  for (const p of parts) total += p.t.length
  const out = {}
  for (const k of ['t', 'o', 'h', 'l', 'c', 'v', 'n']) {
    const col = new Float64Array(total)
    let at = 0
    for (const p of parts) { col.set(p[k], at); at += p[k].length }
    out[k] = col
  }
  let at = 0
  for (let i = 0; i < parts.length - 1; i++) {
    at += parts[i].t.length
    if (at > 0 && at < total && out.t[at] <= out.t[at - 1]) throw new PieceError('pieces overlap in time')
  }
  return out
}
