/**
 * barsIDB — Browser IndexedDB cache for OHLCV bar data.
 *
 * Gives charts instant renders on second visit (0 ms, no network request).
 * After the server responds with fresh/delta bars, we update IDB and the
 * chart reflects the latest data — identical to how TradingView works.
 *
 * Key format:  "{SYM}_{tf}"  (e.g. "AAPL_D", "NVDA_5"; "NVDA_60e" = the extended-
 *               hours 60m series on the clock grid — barTime.seriesCacheTf)
 * Value shape: { bars: [...], lastT: <last bar's t value>, savedAt: <ms> }
 */

import { classifyIntradayTail } from './marketSession'
import { isOnSixtyMinGrid, logicTfOf } from '../components/chart/barTime'
import { mergeDelta, mergeMonotonic, _closeMismatch } from './barsMerge'

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
//
// Bumped 5→6 (2026-08-19): stale WRONG-SCALE daily bars — a server-side ticker-reuse
// cutoff / split self-heal applied at serve time (WYFI cached ~$220 vs the correct
// ~$27, HIVE ~$43 vs ~$2.78) — were stuck in caches indefinitely: the pack importer
// never-downgrades a deep-enough entry, and an up-to-date browser only takes the tail
// delta, so the corrected pack never overwrote the old values. This forces one clean
// full re-ingest of the (correct, sanitized) pack. Paired with the heal-on-mismatch
// guard in _importBatch (below) so FUTURE corrections self-heal without another bump.
//
// Bumped 6→7 (2026-08-31): today's bars.db corruption incident forced a resync-from-R2
// that RE-BASED many tickers' served prices (SOXL cached ~$293 vs the correct ~$111 —
// a serve-time re-adjustment applied AFTER browsers cached the old basis). Same failure
// mode as the 5→6 WYFI/HIVE case: the pack never-downgrades a deep-enough entry and an
// up-to-date browser only takes the tail delta, so the wrong basis rendered a blank /
// broken chart. This bump clears every poisoned entry in one clean refetch. Paired this
// time with a heal-on-mismatch guard in the RENDER path too (StockChart _idbBasisMismatch),
// not just the pack importer — so a chart rendering straight from IDB before any pack
// re-ingest also self-heals a future re-basis without another bump.
//
// ⛔ NOT bumped for the 2026-11-10 60m grid move (TradingView 09:30, 10:30 …
// 15:30; was 09:30 then clock hours). A bump would drop EVERY timeframe in
// every browser at once — the 2026-05-24 herd below. Old-layout 60m entries
// are discarded individually on read instead (`_hasOldSixtyMinGrid`).
const CACHE_LOGIC_VERSION = 7

// Intraday freshness is judged by BAR-DATA age against the last CLOSED trading session
// (weekend/holiday-aware) via marketSession.classifyIntradayTail — NOT a flat wall-clock
// age. The old flat gates (a 2-day save-time bound + a 26h bar-age wall) wrongly evicted
// a pre-seeded intraday pack holding Friday's 15:55 bar on a Monday (65h old but the last
// closed session), which is exactly what blocked intraday-instant. The classifier
// replaces both in idbGet below, and only its 'gapped' verdict evicts; anti-spike safety stays on the writer side
// (classifyLiveBar contiguity + provisionalStaleRef).
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
// Render cap for INTRADAY series handed to the chart. A dwell-warm/backfill (and the
// intraday pack + since-fetch merges) can grow a 5m entry to ~20k bars (≈a year of 5m),
// and rendering + re-merging that many candles on EVERY ticker switch is the 5-10s
// intraday stall (idbGet itself is 1-4ms — the cost is downstream in the chart). The
// chart only needs the recent window for the first paint; deep scroll-back re-fetches on
// pan. idbGet slices to the last INTRADAY_MAX_BARS. Daily/Weekly/Monthly are uncapped
// (they render fine and their history is bounded).
const INTRADAY_MAX_BARS = 3000

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

/**
 * A 60m entry written before the 2026-11-10 grid move (09:30, 10:00, 11:00 …)
 * carries off-grid bucket starts; merging a new-grid delta into it would put
 * 10:00 AND 10:30 candles side by side. Such an entry is treated as absent →
 * ONE full 60m refetch for that chart, spread over chart opens (no herd).
 * Probes both ends (an entry is wholly one layout: a mixed one is discarded
 * the first time it is read).
 */
export function _hasOldSixtyMinGrid(bars, tf) {
  const _t = String(tf)
  if ((_t !== '60' && _t !== '60e') || !Array.isArray(bars) || !bars.length) return false
  // '60' holds the session grid, '60e' the clock grid: an entry on the OTHER grid
  // (or a mixed one) is absent, never merged into.
  const _ext = _t === '60e'
  const n = bars.length
  const idx = []
  for (let i = Math.max(0, n - 120); i < n; i++) idx.push(i)
  for (let i = 0; i < Math.min(40, n); i++) idx.push(i)
  for (const i of idx) {
    const t = bars[i]?.t
    if (typeof t === 'number' && !isOnSixtyMinGrid(t, _ext)) return true
  }
  return false
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
// ⭐ (2026-11-10) RETURNS WHERE THE HOLE STARTS (unix sec of the bar before it), or null.
// The caller no longer discards the cache on a hole — see idbGet.
export function _intradayGapStart(bars, tf) {
  tf = logicTfOf(tf)
  if (!['1','5','15','30','60'].includes(tf)) return null
  if (!bars || bars.length < 2) return null

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
    return bars[i - 1].t
  }
  return null
}

/**
 * Read cached bars for (sym, tf).
 * Returns { bars, lastT, savedAt } or null if not found / stale.
 */
export { INTRADAY_MAX_BARS }

/** The bars idbPut persists: intraday capped to the newest INTRADAY_MAX_BARS (what
 *  idbGet reads back); D/W/M untouched. */
export function _capForWrite(tf, bars) {
  if (Array.isArray(bars) && ['1','5','15','30','60'].includes(logicTfOf(String(tf))) && bars.length > INTRADAY_MAX_BARS) {
    return bars.slice(bars.length - INTRADAY_MAX_BARS)
  }
  return bars
}

/**
 * ⛔ ONE OWNER (W-L 2026-11-11, review of #1095): would `idbGet` hand this stored entry
 * back at all? Every rule that makes a stored entry read as ABSENT lives here, and both
 * the reader (`idbGet`) and the compare-and-write (`idbPutMonotonic`, which may only MERGE
 * into an entry that passes) call it — a write can never keep alive what a read refuses.
 */
export function _entryReadable(entry, tf, nowMs = Date.now(), { history = false } = {}) {
  if (!entry || !entry.bars?.length) return false
  // Logic-version invalidation: a stale schema/logic record is treated as absent.
  if (entry.v !== CACHE_LOGIC_VERSION) return false
  const isIntraday = ['1','5','15','30','60'].includes(logicTfOf(tf))
  // A deep-history SEGMENT (`@hist`) is old by definition: tail currentness is the tail
  // entry's question, not its. Version + grid rules still apply.
  // It EXPIRES HISTORY_SEGMENT_MAX_AGE_MS after the record was CREATED (merges carry
  // `createdAt` forward), so rows a server-side purge removed (the #1062 off-grid class)
  // can never be kept alive by being merged into forever.
  if (history) {
    const born = Number.isFinite(entry.createdAt) ? entry.createdAt : (entry.savedAt || 0)
    return isIntraday && (nowMs - born) <= HISTORY_SEGMENT_MAX_AGE_MS && !_hasOldSixtyMinGrid(entry.bars, tf)
  }
  if (isIntraday) {
    // Only a GAPPED tail is discarded (a BEHIND one is a sound repair base — see idbGet).
    if (classifyIntradayTail(entry.lastT, logicTfOf(tf)) === 'gapped') return false
  } else if ((nowMs - (entry.savedAt || 0)) > DAILY_MAX_AGE_MS) {
    // D/W/M: save-time bound catches corrupted historical bars delta can't heal
    // (wrong company / pre-split); refetched within DAILY_MAX_AGE_MS.
    return false
  }
  // 60m grid move (2026-11-10): an old-layout entry is refetched, per chart, never in bulk.
  if (_hasOldSixtyMinGrid(entry.bars, tf)) return false
  return true
}

export async function idbGet(sym, tf) {
  try {
    const db = await _open()
    return await new Promise((resolve) => {
      const tx  = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(_key(sym, tf))
      req.onsuccess = () => {
        const entry = req.result
        // Every "reads as absent" rule (version, gapped intraday tail, D/W/M age, the
        // retired 60m grid) is `_entryReadable` — shared with the monotonic writer. The
        // comments below explain each rule where it used to live.
        if (!_entryReadable(entry, tf)) return resolve(null)
        const isIntraday = ['1','5','15','30','60'].includes(logicTfOf(tf))
        // (rule history, enforced in `_entryReadable`:)
        if (isIntraday) {
          // Bar-data freshness vs the last CLOSED session (weekend/holiday-aware). A
          // pre-seeded pack ending at the prior session is FRESH (today's bars fill via
          // the live feed / a since-fetch); a series missing a whole closed session — or
          // the current session's recent closed bars — is stale → full refetch. Subsumes
          // the old 26h bar-age + 2-day save-time gates. lastT for intraday is unix secs.
          // ⛔⛔ ONLY 'gapped' MAY BE DISCARDED HERE, AND THIS GATE IS WHY THE
          // SESSION TAIL EXISTED ON PAPER ONLY. `isIntradayTailStale` is true for
          // BEHIND as well as GAPPED, so a cache that was merely a few hours short
          // was nulled at this layer — StockChart never saw it, never classified
          // it, and fell back to a full refetch. Caught by the browser harness
          // (tools/intraday_tail_harness.py): FRESH sent `since=`, BEHIND did not.
          // A BEHIND entry is structurally SOUND; handing it back is what lets the
          // chart paint history instantly and ask only for the gap.
        } else {
          // D/W/M: save-time bound catches corrupted historical bars delta can't heal
          // (wrong company / pre-split); refetched within DAILY_MAX_AGE_MS.
        }
        // RENDER CAP (intraday): hand back only the recent window so a bloated ~20k-bar
        // entry can't stall the chart. Freshness above used entry.lastT (the true tail,
        // unaffected by slicing the FRONT), so it stays correct. Run the gap guard on the
        // CAPPED window — a gap deep in the pruned history is irrelevant (deep scroll-back
        // re-fetches), and this also stops a deep-history gap from nulling the whole entry
        // into a slow full refetch.
        let bars = entry.bars
        if (isIntraday && bars.length > INTRADAY_MAX_BARS) {
          bars = bars.slice(bars.length - INTRADAY_MAX_BARS)
        }
        // Mid-session gap guard: a `since=<tail>` delta cannot heal an interior hole.
        // ⛔⛔ BUT A HOLE IS NOT A REASON TO THROW THE CACHE AWAY (2026-11-10). On a thin
        // name a same-day hole is usually LEGITIMATE (no prints for 20 minutes), and
        // nulling the entry made every open of that name a cold full refetch with nothing
        // on screen — forever, because the hole comes straight back from the server. Keep
        // the bars (the tail may well be current and paintable) and report where the hole
        // starts: the chart asks `since=<repairFromT-1>`, which returns every row after
        // it — the hole's bars if they exist, an empty stretch if the name simply did not
        // trade. `lastT` stays the TRUE tail so currentness is judged on what we hold.
        // 60m grid move (2026-11-10): an old-layout entry is refetched (`_entryReadable`).
        const repairFromT = _intradayGapStart(bars, tf)
        const out = (bars === entry.bars && repairFromT == null)
          ? entry
          : { ...entry, bars, lastT: bars[bars.length - 1]?.t, ...(repairFromT != null ? { repairFromT } : {}) }
        resolve(out)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/**
 * Delete ALL intraday entries (*_1/_5/_15/_30/_60). One-time cleanup to drop the
 * bloated ~20k-bar 5m series (and any leftover intraday pack) that stalled the chart;
 * daily/weekly/monthly are left intact. Best-effort; never throws.
 */
export async function idbDeleteIntraday() {
  let db
  try { db = await _open() } catch { return }
  return new Promise((resolve) => {
    let tx
    try { tx = db.transaction(STORE, 'readwrite') } catch { return resolve() }
    const store = tx.objectStore(STORE)
    const req = store.getAllKeys()
    req.onsuccess = () => {
      for (const k of req.result || []) {
        if (/_(1|5|15|30|60|60e)(@hist)?$/.test(String(k))) { try { store.delete(k) } catch { /* ignore */ } }
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

/**
 * Write bars for (sym, tf) to IDB.
 * lastT = last bar's `t` value (used as the `since` param on next fetch).
 */
export async function idbPut(sym, tf, bars) {
  if (!bars?.length) return
  // ⛔ WRITE WHAT idbGet CAN READ BACK (2026-11-10). idbGet hands the chart only the
  // newest INTRADAY_MAX_BARS, so persisting a 9k-32k scroll-back series bought nothing
  // on the next open — yet every 30s poll merge rewrote all of it (a multi-MB
  // structured clone per poll), and the deep warmer, comparing a 3000-bar read against
  // a 30000 target, re-downloaded deep history on every pass. Persist the window that
  // is read; deep scroll-back is a network fetch by design.
  bars = _capForWrite(tf, bars)
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

// ── MONOTONIC WRITES — ONE OWNER FOR "A WRITE NEVER MOVES A CACHE BACKWARDS" ──
// ⛔⛔ (W-L 2026-11-11, review of #1095) A background warmer reads an entry, awaits the
// network, and writes. Meanwhile the chart may have written a NEWER series under the same
// key; a blind put then rolled the cache back to the warmer's older base + tail. Every
// background writer goes through these instead: the answer lands on WHATEVER IS STORED NOW
// by the one write rule (barsMerge `mergeMonotonic`): answer wins overlaps, a full answer
// is authoritative over its own range, deeper history survives only across a clean seam,
// the stored tail is never moved backwards — and only onto an entry `_entryReadable`
// accepts (anything the reader would refuse is replaced, never merged into).
// (P2 seam: StockChart's own idbPut/memPut writers still put blindly — they are the
// newest writer by construction today, but should move onto these too.)


/** Compare-and-write in ONE readwrite transaction (no read/await/write gap). Returns the
 *  series now stored (capped as idbPut caps it), or null when nothing was written. */
// `meta`: the BarStore's provenance envelope (data/barStore/persist.js — seals, history_rev,
// cache_key). Stored only by the writer that passes it; every other write (idbPut, a
// monotonic write without it, a pack import, a pack delta) puts a record WITHOUT it, so a
// series another writer changed never carries a stale seal claim. NEVER on the `@hist`
// segment: the envelope describes the tail record's rows only.
export async function idbPutMonotonic(sym, tf, bars, { delta = false, startedAt = null, segment = 'tail', meta: metaIn = null } = {}) {
  if (!bars?.length) return null
  // `segment: 'history'` writes the deep-history record (`<key>@hist`, see below) by the
  // SAME rule; only its key and its cap differ.
  const history = segment === 'history'
  const meta = history ? null : metaIn
  if (history && !['1','5','15','30','60'].includes(logicTfOf(String(tf)))) return null
  try {
    const db = await _open()
    return await new Promise((resolve) => {
      let out = null
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const key = history ? _histKey(sym, tf) : _key(sym, tf)
      const req = store.get(key)
      req.onsuccess = () => {
        const e = req.result
        // ⛔ An entry idbGet would read as ABSENT (`_entryReadable`: other logic version,
        // gapped intraday tail, D/W/M past DAILY_MAX_AGE_MS — the wrong-company / pre-split
        // guard — or the retired 60m grid) is NOT a base: a full answer REPLACES it, a
        // delta writes nothing. Merging into it would keep its bad bars and re-stamp
        // savedAt, so the age eviction would never fire again.
        const cur = _entryReadable(e, tf, Date.now(), { history }) ? e.bars : null
        const curIsNewer = !!cur && Number.isFinite(startedAt) && Number.isFinite(e.savedAt) && e.savedAt > startedAt
        const next = mergeMonotonic(cur, bars, { delta, curIsNewer })
        if (next && next === cur && meta) store.put({ ...e, meta })   // same rows, newer provenance
        if (!next?.length || next === cur) { out = cur; return }
        const capped = history ? _capHistoryForWrite(next) : _capForWrite(tf, next)
        const born = history ? { createdAt: (cur && Number.isFinite(e.createdAt)) ? e.createdAt : (cur ? (e.savedAt || Date.now()) : Date.now()) } : {}
        store.put({ key, bars: capped, lastT: capped[capped.length - 1]?.t, savedAt: Date.now(), v: CACHE_LOGIC_VERSION, ...born, ...(meta ? { meta } : {}) })
        out = capped
      }
      tx.oncomplete = () => resolve(out)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    })
  } catch {
    return null
  }
}

/**
 * Delete the cached entry for (sym, tf). Used by the render-path basis-mismatch
 * heal: when a browser holds a stale WRONG-BASIS series (a serve-time split /
 * re-adjustment applied AFTER this browser cached the old prices), we drop the
 * poisoned entry so the next fetch is a clean full refetch — not a `since=` delta
 * merged onto the wrong basis (which would keep the bad deep history forever).
 * Best-effort; never throws.
 */
export async function idbDelete(sym, tf) {
  try {
    const db = await _open()
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(_key(sym, tf))
      // A poisoned series' deep history is poisoned too (same basis): drop it with it.
      tx.objectStore(STORE).delete(_histKey(sym, tf))
      tx.oncomplete = resolve
      tx.onerror    = () => resolve()
    })
  } catch {
    // best-effort
  }
}

// ── Intraday DEEP HISTORY segment (2026-11-11) ────────────────────────────────────────
// ⭐ A SEPARATE RECORD, SO THE 3000-BAR TAIL STAYS CHEAP. The tail entry above is written
// on every poll merge and read on every chart open — capping it (INTRADAY_MAX_BARS) is what
// keeps scanning fast. Deep history a member scrolled to (or the background prefetch
// loaded) lives in `<SYM>_<tf>@hist`: written only when history GROWS (a left window
// landed) or when the tail is about to outrun it, read once AFTER first paint and merged
// as a left-prepend. So depth survives a reload instead of being truncated to 3000 on
// write, and the poll path never touches it.
// Invalidation: same CACHE_LOGIC_VERSION and old-60m-grid rules as the tail; deleted with
// the tail by idbDelete (basis heal) and idbDeleteIntraday; and on read it is used ONLY if
// it reaches the tail (`historyReachesTail`) — a gap between the two is never drawn as if
// contiguous, the segment is just ignored and re-fetched.
export const HISTORY_SEGMENT_MAX = 20000
export const HISTORY_SEGMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
function _histKey(sym, tf) { return `${_key(sym, tf)}@hist` }

/** The bars idbPutHistory persists: the newest HISTORY_SEGMENT_MAX of `bars`. */
export function _capHistoryForWrite(bars) {
  if (!Array.isArray(bars)) return []
  return bars.length > HISTORY_SEGMENT_MAX ? bars.slice(bars.length - HISTORY_SEGMENT_MAX) : bars
}

export async function idbGetHistory(sym, tf) {
  if (!['1','5','15','30','60'].includes(logicTfOf(String(tf)))) return null
  try {
    const db = await _open()
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(_histKey(sym, tf))
      req.onsuccess = () => {
        const e = req.result
        resolve(_entryReadable(e, tf, Date.now(), { history: true }) ? e.bars : null)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/** Persist a deep series' history through THE one write path (`idbPutMonotonic`,
 *  barsMerge `mergeMonotonic`): `bars` is a full, contiguous answer over its range, so it
 *  wins that range, older stored history is kept only across a clean seam, and the record
 *  is capped to the newest HISTORY_SEGMENT_MAX. A series the tail entry holds whole
 *  (≤ INTRADAY_MAX_BARS) writes nothing. */
export async function idbPutHistory(sym, tf, bars) {
  if (!Array.isArray(bars) || bars.length <= INTRADAY_MAX_BARS) return null
  return idbPutMonotonic(sym, tf, bars, { segment: 'history' })
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
// Count stored keys ending in `suffix` (e.g. '_D'). A cheap presence probe for the
// pack self-heal: a stamped-but-empty store (an ingest that reported success on failed
// shards, or IDB evicted under storage pressure while the tiny localStorage stamp
// survived) reads far below the universe size, so the client re-ingests instead of
// trusting the stamp and staying cold forever. Returns 0 if the database cannot open; a failed read rejects.
//
// ⛔ THE READ IS IN PIECES ON PURPOSE. One getAllKeys() over the 45-47k keys took 1.1-3.0 s, each of
// the three packs ran one per load, and IndexedDB work queues behind it. A chart's idbGet then outlasted
// StockChart's 600 ms first-paint wait, which abandons a full local cache for a server fetch. Each piece
// is short and a macrotask runs between pieces, so a chart read gets through. The packs share one walk.
const KEY_WALK_PIECE = 1000
let _keyWalk = null

async function _readAllKeys(db) {
  const all = []
  let after
  for (;;) {
    const range = after === undefined ? undefined : IDBKeyRange.lowerBound(after, true)
    const piece = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys(range, KEY_WALK_PIECE)
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
    for (const k of piece) all.push(k)
    if (piece.length < KEY_WALK_PIECE) return all
    after = piece[piece.length - 1]
    await new Promise((r) => setTimeout(r, 0))
  }
}

export async function idbCountKeys(suffix = '') {
  let db
  try { db = await _open() } catch { return 0 }
  if (!_keyWalk) _keyWalk = _readAllKeys(db).finally(() => { _keyWalk = null })
  // A failed walk REJECTS instead of counting 0. "Could not read" is not "empty": a 0 here told every
  // pack sharing the walk to re-download the universe. _packDataPresent's catch reads it as unverified.
  const keys = await _keyWalk
  return suffix ? keys.filter((k) => String(k).endsWith(suffix)).length : keys.length
}

export async function idbImportPack(entries, { batchSize = 250, yieldBetween = false, replaceIfNewer = false } = {}) {
  if (!entries?.length) return { written: 0, skipped: 0, aborted: false }
  let db
  try { db = await _open() } catch { return { written: 0, skipped: 0, aborted: true } }
  let written = 0, skipped = 0, aborted = false
  for (let i = 0; i < entries.length && !aborted; i += batchSize) {
    const res = await _importBatch(db, entries.slice(i, i + batchSize), replaceIfNewer)
    written += res.written
    skipped += res.skipped
    if (res.aborted) aborted = true  // quota / tx failure — keep prior batches, stop
    // Yield a MACROTASK between readwrite batches so a chart's idbGet (readonly, SAME
    // 'bars' store) can interleave. IndexedDB serializes readwrite-vs-readonly on a
    // store, so a gap-free batch train write-locks it for seconds and stalls every
    // ticker switch — and because swrUrl is gated on idbGet resolving, that blocks BOTH
    // the instant paint AND the network fallback (the intraday-pack fresh-ingest hang).
    // Callers doing a large fresh ingest (intraday) pass yieldBetween + a small batch so
    // each lock window is tiny; daily keeps its 250-batch, no-yield fast path (it's
    // already-ingested for returning users, so it never runs mid-session).
    if (yieldBetween && i + batchSize < entries.length) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  return { written, skipped, aborted }
}

// Detect a cached series that predates a SERVER-SIDE price correction (ticker-reuse
// cutoff / split self-heal). Compare the pack's authoritative last (CLOSED) bar to the
// cached bar at the same timestamp: a material close mismatch means the cache holds the
// pre-correction, wrong-scale values (e.g. WYFI cached ~$220 vs the corrected ~$27).
// Scan only the tail (the shared ts sits at/near the cached series' end) → O(1) per
// ticker on ingest.
export function _findRecentBarByT(bars, t) {
  if (!bars?.length || t == null) return null
  const ts = String(t)
  for (let i = bars.length - 1, stop = Math.max(0, bars.length - 8); i >= stop; i--) {
    if (String(bars[i].t) === ts) return bars[i]
  }
  return null
}
// _closeMismatch lives in ./barsMerge (one owner for the seam test) and is re-exported.

/**
 * Should a pack import KEEP the cached entry `cur` instead of writing pack entry `e`?
 * Keep a current-version local entry at least as deep as the pack, unless the pack's tail
 * disagrees with it, or (`replaceIfNewer`, the Breadth Pack) the pack's tail is newer or
 * — (2026-10-11) — its per-series content hash differs (a corrected history inside the
 * window with the same length and last bar). Exported for tests.
 */
export const _CACHE_LOGIC_VERSION = CACHE_LOGIC_VERSION

export function _keepLocalOverPack(cur, e, replaceIfNewer = false) {
  const bars = e?.bars || []
  if (!cur || cur.v !== CACHE_LOGIC_VERSION) return false
  const packNewer = replaceIfNewer && String(bars[bars.length - 1]?.t || '') > String(cur?.lastT || '')
  const packDiffers = replaceIfNewer && !!e?.sha && cur?.sha !== e.sha
  if (packNewer || packDiffers) return false
  return (cur.bars?.length || 0) >= bars.length
    && !_closeMismatch(_findRecentBarByT(cur.bars, bars[bars.length - 1]?.t), bars[bars.length - 1])
}

function _importBatch(db, batch, replaceIfNewer = false) {
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
        // Never downgrade: keep a current-version local entry that is at least as deep
        // as the pack (deeper scroll-back or a fresher session write) — UNLESS the pack's
        // authoritative tail DISAGREES with the cached values. A stale wrong-scale series
        // (server-side ticker-reuse cutoff / split-heal applied AFTER this browser cached
        // the old prices) is internally consistent, so nothing else catches it and the
        // skip would preserve it — and its wrong DEEP history — forever. On a material
        // close mismatch at the shared session, fall through and REPLACE with the
        // sanitized pack (the discarded deep history re-warms on demand).
        // `replaceIfNewer` (the Breadth Pack): a deeper local entry whose tail is OLDER than the
        // pack's is replaced — breadth has no live tick to keep a cached tail current, so a deep
        // but stale entry would otherwise win forever and the instant paint would be refused.
        if (_keepLocalOverPack(cur, e, replaceIfNewer)) {
          skipped++
          return
        }
        store.put({
          key,
          bars,
          lastT: bars[bars.length - 1]?.t,
          savedAt: Date.now(),
          v: CACHE_LOGIC_VERSION,
          ...(e.sha ? { sha: e.sha } : {}),
        })
        written++
      }
      getReq.onerror = () => { skipped++ }
    }
  })
}

/**
 * Apply a daily pack DELTA (tail of each series) to already-seeded entries.
 *
 * For each { sym, tf, bars }: merge the tail into the existing IDB entry
 * (mergeDelta — new/revised bars win) and RE-STAMP savedAt. Re-stamping every
 * entry present in the delta is what keeps the whole universe from aging out of
 * cache (DAILY_MAX_AGE_MS) — so D/W/M stay instant FOREVER, even for stocks the
 * user never opens, at ~1MB/day instead of re-downloading the full pack.
 *
 * Only maintains entries that already exist at the current logic version — a
 * short tail is too shallow to seed a chart on its own (a never-seeded ticker
 * waits for the full pack). Batched + quota-safe like idbImportPack; never
 * throws. Returns { updated, skipped, aborted }.
 */
export async function idbApplyDelta(entries, { batchSize = 250 } = {}) {
  if (!entries?.length) return { updated: 0, skipped: 0, aborted: false }
  let db
  try { db = await _open() } catch { return { updated: 0, skipped: 0, aborted: true } }
  let updated = 0, skipped = 0, aborted = false
  for (let i = 0; i < entries.length && !aborted; i += batchSize) {
    const res = await _deltaBatch(db, entries.slice(i, i + batchSize))
    updated += res.updated
    skipped += res.skipped
    if (res.aborted) aborted = true
  }
  return { updated, skipped, aborted }
}

function _deltaBatch(db, batch) {
  return new Promise((resolve) => {
    let updated = 0, skipped = 0
    let tx
    try {
      tx = db.transaction(STORE, 'readwrite')
    } catch {
      return resolve({ updated, skipped, aborted: true })
    }
    const store = tx.objectStore(STORE)
    tx.oncomplete = () => resolve({ updated, skipped, aborted: false })
    tx.onerror    = () => resolve({ updated, skipped, aborted: true })
    tx.onabort    = () => resolve({ updated, skipped, aborted: true })
    for (const e of batch) {
      const sym = e?.sym, tf = e?.tf, bars = e?.bars
      if (!sym || !tf || !bars?.length) { skipped++; continue }
      const key = _key(sym, tf)
      const getReq = store.get(key)
      getReq.onsuccess = () => {
        const cur = getReq.result
        // Only maintain entries we already seeded at the current version.
        if (!cur || cur.v !== CACHE_LOGIC_VERSION || !cur.bars?.length) { skipped++; return }
        const merged = mergeDelta(cur.bars, bars)
        store.put({
          key,
          bars: merged,
          lastT: merged[merged.length - 1]?.t,
          savedAt: Date.now(),
          v: CACHE_LOGIC_VERSION,
        })
        updated++
      }
      getReq.onerror = () => { skipped++ }
    }
  })
}

// mergeDelta lives in ./barsMerge (pure, no IndexedDB) and is re-exported here.
export { mergeDelta, mergeMonotonic, _closeMismatch }
