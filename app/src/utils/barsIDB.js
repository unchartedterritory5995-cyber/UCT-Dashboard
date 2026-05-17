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
const CACHE_LOGIC_VERSION = 3

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
const DAILY_MAX_AGE_MS = 24 * 60 * 60 * 1000  // 24 hours

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
      _db.onversionchange = () => { try { _db.close() } catch {}; _db = null }
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
