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
/** Pieces in flight at once for one load (the connection is shared: HTTP/2 or 3 to the edge).
 *  ⭐ 24, not 8 (2026-11-18): measured live, a cold 1h ticker with 9 yearly pieces fetched its NEWEST one
 *  only after the first eight landed (the list is oldest first), a whole extra edge round trip (~500 ms)
 *  before the depth could join; a 23-year 1h series (50,000 bars) paid three rounds. 24 asks a whole
 *  50k-bar 60m / 40k-bar 30m depth in one round; the pieces are 20-60 KB each. */
export const MAX_PARALLEL = 24
/** Symbols whose index a page keeps (least recently used forgotten first). */
export const INDEX_CACHE_MAX = 150

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
 *  oldest first: `[{ period, bars, bytes, crc, first, last }]`.
 *
 *  An entry may count only part of its piece (tools/history_lake/identity.py, 2026-11-17): `from`
 *  (inclusive) and `until` (exclusive) bound the bars that belong to this symbol's company (a reused
 *  ticker's earlier holder is cut away), and `sym` + `period` name a piece stored under the symbol
 *  the company traded as before (META's 2012-2022 bars are FB's pieces). `first` / `last` here are
 *  that window, and loadBars keeps only the bars inside it. */
export function periodsFor(index, series, { from = null, to = null } = {}) {
  const periods = index && index.series && index.series[series]
  if (!periods || typeof periods !== 'object') return []
  const out = []
  for (const [key, e] of Object.entries(periods)) {
    if (!e || !Number.isFinite(e.first) || !Number.isFinite(e.last)) continue
    const [lo, hi] = windowOf(e)
    if (hi < lo) continue
    if (from != null && hi < from) continue
    if (to != null && lo > to) continue
    out.push({ period: key, ...e, first: lo, last: hi })
  }
  out.sort((a, b) => a.first - b.first)
  return out
}

/** [first, last] of the bars an entry counts (its piece's, narrowed by `from` / `until`). */
function windowOf(e) {
  const lo = Number.isFinite(e.from) ? Math.max(e.first, e.from) : e.first
  const hi = Number.isFinite(e.until) ? Math.min(e.last, e.until - 1) : e.last
  return [lo, hi]
}

/** The symbol a piece is stored under: its own, or the one a stitched entry names. */
function ownerOf(symbol, entry) {
  return typeof entry.sym === 'string' && entry.sym ? entry.sym : symbol
}

/** Keep the bars inside the entry's window (no copy when nothing is cut). */
function clip(cols, entry) {
  const hasFrom = Number.isFinite(entry.from)
  const hasUntil = Number.isFinite(entry.until)
  if (!hasFrom && !hasUntil) return cols
  const t = cols.t
  let a = 0
  let b = t.length
  if (hasFrom) while (a < b && t[a] < entry.from) a++
  if (hasUntil) while (b > a && t[b - 1] >= entry.until) b--
  if (a === 0 && b === t.length) return cols
  const out = {}
  for (const k of Object.keys(cols)) out[k] = cols[k].subarray(a, b)
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

/** Resolves in a later task (never in the one that asked): `scheduler.yield()` where the browser has it, else a
 *  MessageChannel message (not clamped like a nested setTimeout), else a setTimeout. */
export function nextTask() {
  try {
    const s = globalThis.scheduler
    if (s && typeof s.yield === 'function') return s.yield()
  } catch { /* fall through */ }
  if (typeof MessageChannel === 'function') {
    return new Promise((resolve) => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => { ch.port1.close(); ch.port2.close(); resolve() }
      ch.port2.postMessage(0)
    })
  }
  return new Promise((resolve) => setTimeout(resolve, 0))
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
 * @param {{ fetch?: typeof fetch, base?: string, maxParallel?: number, yieldTask?: () => (Promise<void> | null) }} o
 *   `yieldTask` (also per `loadBars` call): asked before each piece's decode; a promise is awaited (the decode runs in a
 *   later task), null runs it at once. Default `nextTask`.
 */
export function createHistorySource(o = {}) {
  const doFetch = o.fetch ?? ((...a) => fetch(...a))
  const yieldTask = o.yieldTask ?? nextTask
  const base = o.base ?? HIST_BASE
  const maxParallel = o.maxParallel ?? MAX_PARALLEL
  const indexes = new Map()      // lake symbol -> Promise<index | null>

  const get = (url, signal) => doFetch(url, { credentials: 'same-origin', signal })

  /** The symbol's index, or null when the lake has nothing for it. Kept for the page's life;
   *  `refreshIndex` drops it. */
  function loadIndex(sym, { signal } = {}) {
    const symbol = lakeSymbol(sym)
    let p = indexes.get(symbol)
    if (p) { indexes.delete(symbol); indexes.set(symbol, p) }   // most recently used last
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
      // bounded (review of #1880: list warms load indexes too); a forgotten index is only read again
      if (indexes.size > INDEX_CACHE_MAX) indexes.delete(indexes.keys().next().value)
      p.catch(() => { if (indexes.get(symbol) === p) indexes.delete(symbol) })   // an error is not kept
    }
    return p
  }

  function refreshIndex(sym) { indexes.delete(lakeSymbol(sym)) }

  /** THE one piece URL (its cache key): `warmPieces` and `loadPiece` must never name a piece two ways. */
  const pieceUrl = (symbol, series, entry) =>
    `${base}/v1/${series}/${encodeSymbol(symbol)}/${entry.period}.ubh?c=${entry.crc}&o=${entry.off}&n=${entry.bytes}`
  const placed = (entry) => Number.isSafeInteger(entry.off) && entry.off >= 0 && Number.isSafeInteger(entry.bytes) && entry.bytes > 0

  async function loadPiece(symbol, series, entry, signal, wait = yieldTask) {
    // the piece is one ranged read of its pack: offset `off`, length `bytes` (edge history.js)
    if (!placed(entry)) {
      throw new HistoryError(`${symbol} ${series}/${entry.period}: the index gives no place for the piece`, { stale: true })
    }
    const owner = ownerOf(symbol, entry)
    const url = pieceUrl(owner, series, entry)
    const res = await get(url, signal)
    if (res.status === 409 || res.status === 404) {
      throw new HistoryError(`${symbol} ${series}/${entry.period}: the index is out of date`, { status: res.status, stale: true })
    }
    if (!res.ok) throw new HistoryError(`${symbol} ${series}/${entry.period}: HTTP ${res.status}`, { status: res.status })
    const headerJson = res.headers.get(HEADER_NAME)
    if (!headerJson) throw new HistoryError(`${symbol} ${series}/${entry.period}: no piece header in the answer`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    // ⭐ ONE PIECE PER TASK (smoothness trace 2026-11-26, 1m+15m board: the deep history's pieces decoded back to back
    // in 18-27 ms tasks, 160-215 ms after both charts showed the new symbol, each a dropped frame). Pieces whose bytes land
    // together are decoded in tasks of their own, so a frame can be drawn between two of them. Same decode, same check.
    // A load something is WAITING on to paint (network.lakeSeed `awaited`) passes a `wait` that answers nothing: it never
    // yields, so this cannot delay a first frame.
    const w = wait ? wait() : null
    if (w) {
      await w
      // a load given up while it waited is not decoded (the abort a fetch in flight would have thrown)
      if (signal?.aborted) throw signal.reason ?? new DOMException('The load was aborted', 'AbortError')
    }
    const d = decodeColumns(headerJson, bytes)
    const hd = d.header
    if (hd.symbol !== owner || hd.series !== series || hd.period !== entry.period || hd.crc !== entry.crc) {
      throw new PieceError(`${symbol} ${series}/${entry.period}: the answer is a different piece`)
    }
    return clip(toFloats(d), entry)
  }

  /**
   * Bars of `sym` at chart timeframe `tf` overlapping [from, to] (epoch seconds; null = open).
   * Resolves `null` when the lake has no such series for the symbol, otherwise
   * `{ symbol, series, t, o, h, l, c, v, n, pieces, adjusted }` with Float64Array columns, oldest
   * first, split-adjusted unless `raw: true`. Bars outside [from, to] in the edge pieces are kept:
   * a caller wanting an exact cut slices by `t`.
   * A piece the index names that the edge no longer has is retried ONCE against a fresh index.
   */
  async function loadBars(sym, tf, { from = null, to = null, extended = false, raw = false, signal, yieldTask: wait = yieldTask } = {}) {
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
        parts = await mapLimit(want, maxParallel, (e) => loadPiece(symbol, series, e, signal, wait))
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

  /**
   * Fetch pieces into the browser's HTTP cache (they are answered `immutable` for a year) without
   * decoding them: the read that follows (`loadPiece`, the same URL) is then answered from the cache.
   * Never rejects; a piece without a place is skipped.
   */
  async function warmPieces(sym, series, entries) {
    const symbol = lakeSymbol(sym)
    await mapLimit((entries || []).filter(placed), maxParallel, async (e) => {
      try { const res = await get(pieceUrl(ownerOf(symbol, e), series, e)); if (res.ok) await res.arrayBuffer() } catch { /* a warm only */ }
    })
  }

  /**
   * Warm the EDGE's copy of pieces without downloading them (edge history.js readObject keeps a piece
   * it validated, HEAD included; a HEAD answers no body). Measured 2026-11-18 (1h, 8 pieces): a first
   * read in a data center 300-950 ms; with the edge's copy, 70 ms for all eight. `limit` at a time.
   * Never rejects; resolves how many pieces it asked for.
   */
  async function warmEdge(sym, series, entries, { limit = 4, signal } = {}) {
    const symbol = lakeSymbol(sym)
    const list = (entries || []).filter(placed)
    await mapLimit(list, limit, async (e) => {
      if (signal?.aborted) return
      try { await doFetch(pieceUrl(ownerOf(symbol, e), series, e), { method: 'HEAD', credentials: 'same-origin', signal }) } catch { /* a warm only */ }
    })
    return list.length
  }

  return { loadIndex, refreshIndex, loadBars, warmPieces, warmEdge }
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
