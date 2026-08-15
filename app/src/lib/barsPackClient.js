/**
 * Universe Bars Pack client (Phase 3).
 *
 * Pre-seeds this browser's IndexedDB with Daily/Weekly/Monthly bars for the
 * WHOLE universe, so a chart's FIRST view is an instant zero-network cache hit —
 * even for a brand-new user who has never opened that stock. The pack is a
 * static, edge-cached artifact the worker rebuilds once per ET day; the browser
 * downloads it once per version (then a tiny check no-ops).
 *
 * Flow: on app load, when idle, fetch the manifest. If its version differs from
 * what we last ingested, download the shards (bounded concurrency), reconstruct
 * each columnar shard into the server bar shape, and bulk-import into IDB via
 * idbImportPack (never-downgrade, quota-safe). Stamp the version only on a
 * COMPLETE ingest so a partial run retries next load.
 *
 * Safety: idle-deferred (never competes with the chart on screen); skipped on
 * metered/slow connections; requests persistent storage; every failure is
 * swallowed and falls through to the existing warm-server fetch + skeleton, so
 * the pack is strictly additive and can never regress a chart.
 */
import { idbImportPack, idbApplyDelta } from '../utils/barsIDB'

const MANIFEST_URL = '/api/barspack/manifest'
const VERSION_LS = 'barspack.version'
const TFS = ['D', 'W', 'M']
const SHARD_CONCURRENCY = 2
// If we're further behind than this many days, the delta tail (7 bars) can't
// bridge the gap without leaving a hole → re-pull the full pack instead.
const MAX_DELTA_CATCHUP_DAYS = 6

let _started = false

export function initBarsPack() {
  if (_started) return
  _started = true
  _whenIdle(() => { _run().catch(() => {}) })
}

function _whenIdle(fn) {
  try {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => fn(), { timeout: 8000 })
      return
    }
  } catch { /* fall through */ }
  setTimeout(fn, 3000)
}

// Don't burn a user's metered / very slow connection on a background pack.
function _connectionTooCostly() {
  try {
    const c = navigator.connection
    if (!c) return false
    if (c.saveData) return true
    if (c.effectiveType === 'slow-2g' || c.effectiveType === '2g') return true
  } catch { /* no NetworkInformation API */ }
  return false
}

async function _run() {
  if (_connectionTooCostly()) return

  let manifest
  try {
    const r = await fetch(MANIFEST_URL, { credentials: 'omit' })
    if (!r.ok) return
    manifest = await r.json()
  } catch { return }

  if (!manifest || manifest.available === false
      || !manifest.version || !Array.isArray(manifest.shards) || !manifest.shards.length) {
    return
  }
  const version = manifest.version
  let localV = null
  try { localV = localStorage.getItem(VERSION_LS) } catch { /* ignore */ }

  // Already current → nothing to do (the common daily case for an open app).
  if (localV === version) return

  // Best-effort persistent storage so the pack survives storage pressure.
  try { if (navigator.storage?.persist) await navigator.storage.persist() } catch { /* ignore */ }

  // Returning browser that's only a few days behind → cheap delta. Otherwise
  // (never seeded, or too far behind for the tail to bridge) → full pack.
  const canDelta = localV && manifest.delta && _daysBetween(localV, version) <= MAX_DELTA_CATCHUP_DAYS
  const ok = canDelta ? await _ingestDelta(version) : await _ingestFull(version, manifest.shards)

  // Stamp the version ONLY on a complete ingest; a partial (quota-aborted) run
  // retries next load rather than declaring this version done.
  if (ok) {
    try { localStorage.setItem(VERSION_LS, version) } catch { /* ignore */ }
  }
}

// Full pack: download every shard (bounded concurrency), import each as it
// arrives so a partial download still yields partial instant coverage.
async function _ingestFull(version, shards) {
  const queue = shards.slice()
  let cursor = 0
  let aborted = false
  async function worker() {
    while (cursor < queue.length && !aborted) {
      const s = queue[cursor++]
      const shardIdx = typeof s.idx === 'number' ? s.idx : parseInt(s.idx, 10)
      if (!Number.isFinite(shardIdx)) continue
      let entries
      try { entries = await _fetchShard(version, shardIdx) } catch { continue }
      if (!entries.length) continue
      try {
        const res = await idbImportPack(entries)
        if (res.aborted) aborted = true
      } catch { /* best-effort */ }
    }
  }
  await Promise.all(Array.from({ length: SHARD_CONCURRENCY }, worker))
  return !aborted
}

// Delta: one small file, merged into existing entries + re-stamps savedAt.
async function _ingestDelta(version) {
  let entries
  try {
    const r = await fetch(`/api/barspack/${version}/delta`, { credentials: 'omit' })
    if (!r.ok) return false
    entries = decodeShardPayload(await r.json())
  } catch { return false }
  if (!entries.length) return true  // nothing to apply, still "current"
  try {
    const res = await idbApplyDelta(entries)
    return !res.aborted
  } catch { return false }
}

// Whole days between two "YYYY-MM-DD" strings (Infinity if either is unparseable
// → forces a full pull rather than a possibly-gapped delta).
function _daysBetween(a, b) {
  const da = Date.parse(`${a}T00:00:00Z`), db = Date.parse(`${b}T00:00:00Z`)
  if (!Number.isFinite(da) || !Number.isFinite(db)) return Infinity
  return Math.abs(db - da) / 86400000
}

async function _fetchShard(version, shardIdx) {
  const r = await fetch(`/api/barspack/${version}/${shardIdx}`, { credentials: 'omit' })
  if (!r.ok) return []
  const obj = await r.json()  // browser transparently gunzips Content-Encoding: gzip
  return decodeShardPayload(obj)
}

/**
 * Reconstruct a shard's columnar arrays into [{ sym, tf, bars }] where `bars` is
 * the exact server bar shape [{t,o,h,l,c,v}] that idbImportPack stores verbatim.
 * Pure + defensive (tolerates missing tfs / ragged columns) so it can be unit
 * tested without a network or IDB. Exported for tests.
 */
export function decodeShardPayload(obj) {
  const tickers = obj && obj.tickers
  if (!tickers) return []
  const out = []
  for (const sym in tickers) {
    const tfs = tickers[sym]
    if (!tfs) continue
    for (let k = 0; k < TFS.length; k++) {
      const tf = TFS[k]
      const cols = tfs[tf]
      if (!cols || !cols.t || !cols.t.length) continue
      const n = cols.t.length
      const bars = new Array(n)
      for (let i = 0; i < n; i++) {
        bars[i] = { t: cols.t[i], o: cols.o[i], h: cols.h[i], l: cols.l[i], c: cols.c[i], v: cols.v[i] }
      }
      out.push({ sym, tf, bars })
    }
  }
  return out
}
