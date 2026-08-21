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
import { prefetchBarsToIDB } from '../utils/prefetchBars'

const SHARD_CONCURRENCY = 2

// The tickers a brand-new user is most likely to open FIRST — major indices/ETFs
// + megacaps + high-traffic momentum names. Mirrors SymbolSearch's POPULAR list
// and the worker prewarmer's hardcoded priority set; kept as a LOCAL hint list
// because a miss here is non-functional (the name just isn't pre-warmed early —
// the normal serve path + the full pack still cover it). NOT the whole universe;
// the full pack covers that. Keep this ≤ ~60 so the eager daily warm stays cheap.
export const HOT_TICKERS = [
  'SPY', 'QQQ', 'IWM', 'DIA',
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'AVGO',
  'AMD', 'SMCI', 'PLTR', 'ARM', 'COIN', 'MSTR', 'HOOD', 'ANET', 'NFLX', 'CRM',
  'ORCL', 'UBER', 'MU', 'MRVL', 'SNOW', 'CRWD', 'NET', 'DDOG', 'SHOP',
  'LLY', 'COST', 'JPM', 'V', 'MA', 'UNH', 'XOM', 'WMT', 'HD',
  'XLF', 'XLE', 'XLK', 'XLV', 'SOXX', 'GLD', 'TLT', 'ARKK', 'IBIT',
]
// If we're further behind than this many days, the delta tail can't bridge the gap
// without leaving a hole → re-pull the full pack instead.
const MAX_DELTA_CATCHUP_DAYS = 6

// TWO packs share this client, ingested identically: the D/W/M pack and the
// intraday (5m/60m) pack (Phase 4). Each is a separate R2 artifact with its own
// route prefix + localStorage version/seed. The intraday pack no-ops on the client
// until the worker publishes it (manifest → {available:false}), so it's dark-safe.
// Daily is a large FIRST-VISIT ingest too — a new user downloads the whole-universe D/W/M
// pack and writes it in one go. Ingest in small YIELDING batches so it never write-locks
// the 'bars' store long enough to stall a chart read (the "new user waits 3-5s scrolling
// the theme tracker" — the same lock the intraday ingest hit). Returning users skip the
// ingest (already stamped), so this only affects the one-time first-visit warm.
const PACK_DAILY = {
  base: '/api/barspack', versionKey: 'barspack.version', seedKey: 'barspack.seed',
  ingestBatchSize: 60, ingestYield: true,
}
// The intraday pack is a large FRESH ingest (5m+60m, whole universe) that runs
// mid-session the first time it's enabled — so it ingests in SMALL, YIELDING batches so
// the readwrite train never write-locks the 'bars' store long enough to stall a ticker
// switch's idbGet. Daily keeps its fast 250-batch path (already-ingested for returners).
const PACK_INTRADAY = {
  base: '/api/intradaypack', versionKey: 'intradaypack.version', seedKey: 'intradaypack.seed',
  ingestBatchSize: 30, ingestYield: true,
}

let _started = false

export function initBarsPack() {
  if (_started) return
  _started = true
  // ── Cold-start bridge: warm the HOT SET before the idle-deferred full pack ──
  // The full pack (below) is gated behind requestIdleCallback (up to ~8s to even
  // START) and hash-sharded, so NO early shard is "the popular names" — a
  // brand-new user scanning in their first seconds has nothing local and every
  // chart is a server round-trip (the "first-signup user waits" report). Warm the
  // hot set into the SAME IndexedDB store StockChart paints from, RIGHT NOW,
  // through prefetchBars' bounded (3-concurrent) queue so it never starves the
  // user's own visible chart. First-visit only — a no-op for returning users, who
  // already hold the whole universe's D/W/M in IDB.
  _warmHotSetForNewUser()
  _whenIdle(() => { _run(PACK_DAILY).catch(() => {}) })
  // Intraday pack RE-ENABLED (2026-08-19). An offline Playwright harness
  // (tools/intraday_repro.py) proved the client path is sound: the prior-session pack
  // paints in ~200ms (render cap slices any bloat to 3k), the since-fetch fills today,
  // and the candles frame correctly. The earlier "10s stall / black" was NOT the client
  // — it was the server 5m serve hanging under Massive saturation from over-aggressive
  // prewarming (PREWARM_5M_CAP), now dialed back so 5m serves ~0.15s. The non-blocking
  // ingest below keeps a fresh full ingest from write-locking the store.
  _whenIdle(() => { _run(PACK_INTRADAY).catch(() => {}) })
}

// Eagerly warm the hot set for a browser that has no pack yet (first visit). Runs
// through the shared bounded IDB prefetch queue: Daily at the FRONT (the default
// 1D view that paints first), then the two intraday timeframes the intraday pack
// covers (5m/60m) behind it. Skipped once a daily pack version is stamped —
// returning users already have the whole universe durable, so this would be a pure
// idbGet no-op for them; gating keeps it off their load path entirely. W/M are left
// to the full daily pack (which carries D/W/M) so this stays a lean first-open warm.
export function _warmHotSetForNewUser() {
  let hasPack = null
  try { hasPack = localStorage.getItem(PACK_DAILY.versionKey) } catch { /* storage blocked → treat as new */ }
  if (hasPack) return                 // returning user — universe already in IDB
  if (_connectionTooCostly()) return  // respect metered / slow connections
  try {
    prefetchBarsToIDB(HOT_TICKERS, 'D', { priority: true })  // daily first, front of queue
    prefetchBarsToIDB(HOT_TICKERS, '5')                      // common intraday switches
    prefetchBarsToIDB(HOT_TICKERS, '60')
  } catch { /* best-effort; the chart's own fetch + the full pack remain the fallback */ }
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

async function _run(cfg) {
  if (_connectionTooCostly()) return

  let manifest
  try {
    const r = await fetch(`${cfg.base}/manifest`, { credentials: 'omit' })
    if (!r.ok) return
    manifest = await r.json()
  } catch { return }

  if (!manifest || manifest.available === false
      || !manifest.version || !Array.isArray(manifest.shards) || !manifest.shards.length) {
    return
  }
  const version = manifest.version
  let localV = null, localSeed = null
  try { localV = localStorage.getItem(cfg.versionKey); localSeed = localStorage.getItem(cfg.seedKey) } catch { /* ignore */ }

  // Already current (same data AND same ticker set) → nothing to do.
  if (localV === version && (!manifest.seed || localSeed === manifest.seed)) return

  // Best-effort persistent storage so the pack survives storage pressure.
  try { if (navigator.storage?.persist) await navigator.storage.persist() } catch { /* ignore */ }

  // The ticker SET changed (universe gained names, e.g. GRWG added) → a delta
  // can't seed a brand-new ticker, so force a full re-ingest.
  const seedChanged = !!manifest.seed && localSeed !== manifest.seed
  // Returning browser only a few days behind (and same ticker set) → cheap delta.
  // Otherwise (never seeded, seed changed, or too far behind) → full pack.
  const canDelta = localV && manifest.delta && !seedChanged
                   && _daysBetween(localV, version) <= MAX_DELTA_CATCHUP_DAYS
  const ok = canDelta ? await _ingestDelta(cfg, version) : await _ingestFull(cfg, version, manifest.shards)

  // Stamp version + seed ONLY on a complete ingest; a partial (quota-aborted)
  // run retries next load rather than declaring this version done.
  if (ok) {
    try {
      localStorage.setItem(cfg.versionKey, version)
      if (manifest.seed) localStorage.setItem(cfg.seedKey, manifest.seed)
    } catch { /* ignore */ }
  }
}

// Full pack: download every shard (bounded concurrency), import each as it
// arrives so a partial download still yields partial instant coverage.
async function _ingestFull(cfg, version, shards) {
  const queue = shards.slice()
  let cursor = 0
  let aborted = false
  async function worker() {
    while (cursor < queue.length && !aborted) {
      const s = queue[cursor++]
      const shardIdx = _shardIdx(s)
      if (!Number.isFinite(shardIdx)) continue
      let entries
      try { entries = await _fetchShard(cfg, version, shardIdx) } catch { continue }
      if (!entries.length) continue
      try {
        const res = await idbImportPack(entries, { batchSize: cfg.ingestBatchSize, yieldBetween: cfg.ingestYield })
        if (res.aborted) aborted = true
      } catch { /* best-effort */ }
    }
  }
  await Promise.all(Array.from({ length: SHARD_CONCURRENCY }, worker))
  return !aborted
}

// Delta: one small file, merged into existing entries + re-stamps savedAt.
async function _ingestDelta(cfg, version) {
  let entries
  try {
    const r = await fetch(`${cfg.base}/${version}/delta`, { credentials: 'omit' })
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

// Resolve a shard's numeric index. Prefers manifest `idx`, but falls back to
// parsing it from the shard NAME ("barspack/<date>/NNN.json.gz") so the client
// works with packs built before the manifest carried `idx` (the transition that
// broke ingest 2026-08-14: the deployed client read undefined idx → skipped
// every shard → nothing ever seeded).
export function _shardIdx(s) {
  if (typeof s?.idx === 'number' && Number.isFinite(s.idx)) return s.idx
  if (typeof s?.idx === 'string' && s.idx.trim() !== '') {
    const n = parseInt(s.idx, 10)
    if (Number.isFinite(n)) return n
  }
  const mm = typeof s?.name === 'string' ? s.name.match(/\/(\d+)\.json\.gz$/) : null
  return mm ? parseInt(mm[1], 10) : NaN
}

async function _fetchShard(cfg, version, shardIdx) {
  const r = await fetch(`${cfg.base}/${version}/${shardIdx}`, { credentials: 'omit' })
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
    // Iterate the tf keys the shard actually carries — so this decodes the D/W/M
    // pack AND the intraday pack ('5'/'60') with the same code (for daily shards
    // Object.keys is exactly ['D','W','M'], so behaviour is unchanged).
    for (const tf of Object.keys(tfs)) {
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
