// app/src/lib/userDefsCache.js
//
// ─── ⭐⭐ (2026-11-26, Fred RS load time) THE DEFINITIONS LIST THIS MEMBER WAS LAST SERVED ─────────────────────────────
// Kept so the next load starts from it (`hooks/useUserDefinitions.js` hands it to SWR as its first answer); forgotten on
// a definitive sign-out (`context/AuthContext.jsx`). A module with no imports, so the sign-in path (main bundle) can
// forget it without loading the chart engine.
// Rules: one record, keyed by member AND script engine (a read for another member or engine answers nothing), the raw
// rows as served, a record over DEFS_CACHE_MAX_CHARS is not kept, every storage failure is "nothing kept".
export const DEFS_CACHE_KEY = 'uct.userDefinitions.v1'
export const DEFS_CACHE_MAX_CHARS = 1_500_000

function defsStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

/** Keep `rows` (the list as served) as `owner`'s start for the next load on script engine `engine`. */
export function writeCachedDefinitionRows(owner, engine, rows, storage = defsStorage()) {
  if (owner == null || owner === '' || !Array.isArray(rows)) return false
  try {
    const text = JSON.stringify({ owner: String(owner), engine, rows })
    if (text.length > DEFS_CACHE_MAX_CHARS) { storage?.removeItem(DEFS_CACHE_KEY); return false }
    storage?.setItem(DEFS_CACHE_KEY, text)
    return true
  } catch { return false }
}

/** `owner`'s kept rows for script engine `engine`, as served, or undefined. */
export function readCachedDefinitionRows(owner, engine, storage = defsStorage()) {
  if (owner == null || owner === '') return undefined
  try {
    const rec = JSON.parse(storage?.getItem(DEFS_CACHE_KEY) || 'null')
    if (!rec || rec.owner !== String(owner) || rec.engine !== engine || !Array.isArray(rec.rows)) return undefined
    return rec.rows
  } catch { return undefined }
}

/** A definitive sign-out: the kept list is forgotten. */
export function clearCachedDefinitions(storage = defsStorage()) {
  try { storage?.removeItem(DEFS_CACHE_KEY) } catch { /* storage blocked */ }
}
