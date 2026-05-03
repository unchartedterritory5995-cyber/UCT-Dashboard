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
// v3: clears all entries on upgrade. Some users had cross-ticker corruption
// (e.g. BearingPoint 2003 data persisted under "BE_D" because the data source
// backfilled the symbol with the prior company's history). Combined with
// `since=lastT` delta requests, the API never overwrote those historical bars.
const DB_VERSION = 3
const STORE      = 'bars'

// Max age for intraday data (stale session bars shouldn't linger forever)
const INTRADAY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000  // 7 days
// Max age for daily/weekly/monthly. Without this, corrupted historical bars
// (wrong company, pre-split, etc.) persist indefinitely because delta fetches
// only ask for bars newer than the last cached timestamp.
const DAILY_MAX_AGE_MS = 24 * 60 * 60 * 1000  // 24 hours

let _db = null

async function _open() {
  if (_db) return _db
  return new Promise((resolve, reject) => {
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
    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db) }
    req.onerror    = (e) => reject(e.target.error)
    req.onblocked  = ()  => reject(new Error('IDB blocked'))
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
        const age = Date.now() - (entry.savedAt || 0)
        const isIntraday = ['1','5','15','30','60'].includes(tf)
        const maxAge = isIntraday ? INTRADAY_MAX_AGE_MS : DAILY_MAX_AGE_MS
        if (age > maxAge) return resolve(null)
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
