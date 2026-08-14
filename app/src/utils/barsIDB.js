/**
 * barsIDB — Browser IndexedDB cache for OHLCV bar data.
 *
 * Gives charts instant renders on second visit (0 ms, no network request).
 * After the server responds with fresh/delta bars, we update IDB and the
 * chart reflects the latest data — identical to how TradingView works.
 *
 * Key format:  "{SYM}_{tf}"  (e.g. "AAPL_D", "NVDA_5")
 * Value shape: { bars: [...], lastT: <last bar's t value>, savedAt: <ms> }
 */

const DB_NAME    = 'uct_bars_v1'
// Stay at v2. The v3 bump caused a deadlock: existing v2 connections held by
// the page blocked the upgrade, idbGet hung forever, and charts never loaded.
// The cross-ticker corruption (e.g. "BE_D" with BearingPoint 2003 history) is
// now mitigated by DAILY_MAX_AGE_MS — stale entries get refetched within 24h.
const DB_VERSION = 2
const STORE      = 'bars'

// LOGICAL cache version — NOT the IndexedDB schema version (bumping
// DB_VERSION deadlocks, see above). Stored in every record; on mismatch
// idbGet treats the entry as absent, so bumping this one integer cleanly
// invalidates ALL cached bars after any change to bar-fetch/merge logic
// (e.g. the 2026-05-16 freshness fixes) with zero deadlock risk.
//
// Bumped to 4 on 2026-05-23: the FMP timezone bug (commit 87b7d88) wrote
// every browser's IDB with timestamp-shifted bars that survive across
// server-side wipes (server merge can only ADD newer bars, never overwrite
// the shifted-ts rows already in IDB). Bumping the version invalidates
// every browser's local cache on next page load, forcing a clean refetch
// from the now-correct server data. Without this, users keep seeing the
// "noon cutoff" symptom in their browser indefinitely even after the
// backend is fixed.
//
// Bumped to 5 on 2026-07-14: the intraday gap-fill fixes (delta gap-fill +
// on-demand deep-fill) completed the SERVER's stored history, but browsers
// hold pre-fix IDB caches with interior HOLES, and the `since=` delta refresh
// only ADDS newer bars — it never backfills an old missing interior bar (e.g.
// NVDA 30m 07-08 14:30). So every browser kept showing the gap even though the
// server now has the bar. This bump invalidates those stale caches → one clean
// full refetch → complete data.
const CACHE_LOGIC_VERSION = 5

// Max age by SAVE time — secondary bound only. The PRIMARY intraday
// guard is bar-data freshness (newest bar age), checked in idbGet:
// savedAt-based eviction missed the bug where stale bars get re-saved
// recently (savedAt new, bars week-old) and lingered for 7 days.
const INTRADAY_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000  // 2 days
// An intraday entry whose NEWEST BAR is older than this is missing >=1
// session — never serve it (forces a fresh full fetch). Mirrors the
// backend _is_cold_stale_intraday + StockChart idbStaleIntraday guards.
const INTRADAY_STALE_BAR_SEC = 26 * 60 * 60  // 26h
// Max age for daily/weekly/monthly. Without this, corrupted historical bars
// (wrong company, pre-split, etc.) persist indefinitely because delta fetches
// only ask for bars newer than the last cached timestamp.
//
// 48h (was 24h, 2026-08-14): the Universe Bars Pack (idbImportPack) pre-seeds
// D/W/M for the whole universe once per day, stamping savedAt at ingest. A
// user who opens the app daily always has entries <24h old; 48h just adds a
// full day of margin for a session that spans a day boundary before the next
// pack re-ingest. This is safe because D/W/M ALWAYS full-refetch on chart open
// (no `since=`), so the server replaces the entry within ~1s of a view
// regardless of the age bound — the bound only backstops entries never opened.
const DAILY_MAX_AGE_MS = 48 * 60 * 60 * 1000  // 48 hours

let _db = null

async function _open() {
  if (_db) return _db
  return new Promise((resolve, reject) => {
    // Hard timeout so a blocked / hung upgrade can never freeze the chart.
    // If IDB is unavailable, callers fall back to network-only — slower, but
    // the app stays usable.
    const timeout = setTimeout(() => reject(new Error('IDB open timeout')), 3000)
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      // Any upgrade drops the store — cached bars are pure derived data, so
      // a clean rebuild is always safe and avoids carrying forward corruption.
      if (db.objectStoreNames.contains(STORE)) {
        db.deleteObjectStore(STORE)
      }
      db.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = (e) => {
      clearTimeout(timeout)
      _db = e.target.result
      // When another tab opens this DB at a higher version, close our handle
      // so the upgrade can proceed. Without this, version bumps deadlock.
      _db.onversionchange = () => { try { _db.close() } catch { /* already closed */ }; _db = null }
      resolve(_db)
    }
    req.onerror   = (e) => { clearTimeout(timeout); reject(e.target.error) }
    req.onblocked = ()  => { clearTimeout(timeout); reject(new Error('IDB blocked')) }
  })
}

function _key(sym, tf) {
  return `${sym.toUpperCase()}_${tf}`
}

// Detect mid-session gaps in cached intraday bar series. mergeDelta can only
// ADD bars and cannot fill a gap older than the latest cached timestamp, so
// any gap that slipped in (FMP-shifted ts, dropped write, network failure
// mid-write, etc.) is permanent until the cache is fully refetched.
// Returning a stale signal here forces idbGet's caller to do a full no-since
// refetch, healing the IDB from the authoritative server.
//
// Active only for tf in {15, 30, 60}: 1m/5m series legitimately gap on
// illiquid tickers and a strict check would force a refetch on every chart
// open. For 15/30/60min, missing bars on a liquid ticker are nearly always
// real bugs.
//
// Deliberately NOT paired with a CACHE_LOGIC_VERSION bump: a bump would
// invalidate every browser's IDB simultaneously, and the resulting
// thundering herd of full-fetches (5000 bars × N mounted charts) can
// saturate SQLite's 2s busy_timeout on the web pod and trigger a deploy-
// window outage (verified 2026-05-24 incident, reverted in dd5ce85).
// Without the bump, this detector heals affected users gradually on each
// chart open instead of all at once.
function _hasIntradayGap(bars, tf) {
  if (!['1','5','15','30','60'].includes(tf)) return false
  if (!bars || bars.length < 2) return false

  // Max acceptable in-session gap. Tuned to catch a real interior hole without
  // false-flagging normal spacing or the 30-min open-bar adjustment on hourly
  // (09:30 → 10:00 = 1800s). 1/5min added 2026-07-30: the delta-merge can leave
  // an interior hole with a FRESH tail (a dropped/ts-shifted delta write), which
  // the tail-age freshness gate is blind to — so the 30s poll re-issues a `since=`
  // delta that can never backfill it, and only a TF-switch (full refetch) healed
  // it. Detecting the hole here forces a full no-`since` refetch on load instead.
  // 5min uses 600s (≥2 missing bars); 1min uses 900s (a clear multi-bar hole, not
  // the routine sub-minute sparseness of a thin ticker). Real halts / genuinely
  // sparse names just cost one harmless full refetch on open (idbGet runs per
  // mount, not per render — no refetch loop).
  const MAX_OK_GAP_SEC = { '1': 900, '5': 600, '15': 3600, '30': 5400, '60': 7200 }[tf]

  // Scan only the recent window. Old corruption is rarely user-visible and
  // a full-array scan adds avoidable latency on the hot cache-hit path.
  const start = Math.max(1, bars.length - 200)
  for (let i = start; i < bars.length; i++) {
    const gap = bars[i].t - bars[i - 1].t
    if (gap <= MAX_OK_GAP_SEC) continue
    // Cross-ET-day gaps are legit session boundaries (overnight, weekend,
    // holiday closure). Only same-day gaps over the threshold are bugs.
    const prevEtDate = new Date(bars[i - 1].t * 1000)
      .toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    const currEtDate = new Date(bars[i].t * 1000)
      .toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    if (prevEtDate !== currEtDate) continue
    return true
  }
  return false
}

/**
 * Read cached bars for (sym, tf).
 * Returns { bars, lastT, savedAt } or null if not found / stale.
 */
export async function idbGet(sym, tf) {
  try {
    const db = await _open()
    return await new Promise((resolve) => {
      const tx  = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(_key(sym, tf))
      req.onsuccess = () => {
        const entry = req.result
        if (!entry || !entry.bars?.length) return resolve(null)
        // Logic-version invalidation: a stale schema/logic record is
        // treated as absent so the caller refetches fresh.
        if (entry.v !== CACHE_LOGIC_VERSION) return resolve(null)
        const age = Date.now() - (entry.savedAt || 0)
        const isIntraday = ['1','5','15','30','60'].includes(tf)
        const maxAge = isIntraday ? INTRADAY_MAX_AGE_MS : DAILY_MAX_AGE_MS
        if (age > maxAge) return resolve(null)
        // PRIMARY intraday guard: never serve a series whose newest bar
        // is >=1 session old, regardless of when it was saved. This is
        // what stops the stale-cache-fused-to-live-price spike at the
        // source (lastT for intraday is unix seconds).
        if (isIntraday && typeof entry.lastT === 'number'
            && (Date.now() / 1000 - entry.lastT) > INTRADAY_STALE_BAR_SEC) {
          return resolve(null)
        }
        // Mid-session gap guard: delta-merge cannot heal interior gaps,
        // so a cached series with one is permanently broken until a full
        // refetch. Treat as absent → caller refetches without `since`.
        if (_hasIntradayGap(entry.bars, tf)) return resolve(null)
        resolve(entry)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/**
 * Write bars for (sym, tf) to IDB.
 * lastT = last bar's `t` value (used as the `since` param on next fetch).
 */
export async function idbPut(sym, tf, bars) {
  if (!bars?.length) return
  try {
    const db  = await _open()
    const lastT = bars[bars.length - 1]?.t
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({
        key: _key(sym, tf),
        bars,
        lastT,
        savedAt: Date.now(),
        v: CACHE_LOGIC_VERSION,
      })
      tx.oncomplete = resolve
      tx.onerror    = () => resolve()
    })
  } catch {
    // IDB writes are best-effort — never let them crash the chart
  }
}

/**
 * Bulk-import a "Universe Bars Pack" of D/W/M bars in batched transactions.
 *
 * `entries` = [{ sym, tf, bars }] where `bars` is the SERVER bar shape
 * [{t,o,h,l,c,v}] (t = ISO "YYYY-MM-DD" for D/W/M) — byte-identical to what a
 * normal /api/bars full-fetch produces, so StockChart reads each as `_idbFresh`
 * and paints instantly with zero network. Pre-seeds a brand-new user's cache so
 * their FIRST view of any stock is instant.
 *
 * NEVER DOWNGRADES: an existing current-version entry that holds AT LEAST as
 * many bars as the pack is left untouched. The pack is a shallow ~300-bar view
 * pack; it must never shrink a deeper local series (a user who scrolled back, or
 * a fresher per-session write).
 *
 * Quota-safe: writes in batches, each its own transaction, so a
 * QuotaExceededError aborts only the CURRENT batch — every prior batch is
 * already committed. On abort it stops early and reports what landed; callers
 * fall back to per-ticker fetch for the rest. Never throws.
 *
 * Returns { written, skipped, aborted }.
 */
export async function idbImportPack(entries, { batchSize = 250 } = {}) {
  if (!entries?.length) return { written: 0, skipped: 0, aborted: false }
  let db
  try { db = await _open() } catch { return { written: 0, skipped: 0, aborted: true } }
  let written = 0, skipped = 0, aborted = false
  for (let i = 0; i < entries.length && !aborted; i += batchSize) {
    const res = await _importBatch(db, entries.slice(i, i + batchSize))
    written += res.written
    skipped += res.skipped
    if (res.aborted) aborted = true  // quota / tx failure — keep prior batches, stop
  }
  return { written, skipped, aborted }
}

function _importBatch(db, batch) {
  return new Promise((resolve) => {
    let written = 0, skipped = 0
    let tx
    try {
      tx = db.transaction(STORE, 'readwrite')
    } catch {
      return resolve({ written, skipped, aborted: true })
    }
    const store = tx.objectStore(STORE)
    tx.oncomplete = () => resolve({ written, skipped, aborted: false })
    tx.onerror    = () => resolve({ written, skipped, aborted: true })
    tx.onabort    = () => resolve({ written, skipped, aborted: true })
    for (const e of batch) {
      const sym = e?.sym, tf = e?.tf, bars = e?.bars
      if (!sym || !tf || !bars?.length) { skipped++; continue }
      const key = _key(sym, tf)
      const getReq = store.get(key)
      getReq.onsuccess = () => {
        const cur = getReq.result
        // Never downgrade: keep a current-version local entry that is at least
        // as deep as the pack (deeper scroll-back or a fresher session write).
        if (cur && cur.v === CACHE_LOGIC_VERSION
            && (cur.bars?.length || 0) >= bars.length) {
          skipped++
          return
        }
        store.put({
          key,
          bars,
          lastT: bars[bars.length - 1]?.t,
          savedAt: Date.now(),
          v: CACHE_LOGIC_VERSION,
        })
        written++
      }
      getReq.onerror = () => { skipped++ }
    }
  })
}

/**
 * Merge a delta (new bars from server) into an existing bar array.
 * Delta bars REPLACE existing bars with the same timestamp — server data
 * is always fresher than a cached developing candle or stale IDB entry.
 */
export function mergeDelta(existing, delta) {
  if (!delta?.length) return existing
  if (!existing?.length) return delta
  const deltaMap = new Map(delta.map(b => [String(b.t), b]))
  // Keep existing bars whose timestamp is NOT in the delta (delta wins on conflict)
  const kept = existing.filter(b => !deltaMap.has(String(b.t)))
  const merged = [...kept, ...delta]
  // Sort: ISO date strings sort lexically; unix seconds sort numerically
  const isDate = typeof merged[0]?.t === 'string'
  merged.sort((a, b) => isDate
    ? (a.t > b.t ? 1 : a.t < b.t ? -1 : 0)
    : a.t - b.t
  )
  return merged
}
