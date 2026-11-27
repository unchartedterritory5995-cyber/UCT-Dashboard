// app/src/lib/userDefsForget.js
//
// ⭐ (2026-11-26) The kept definitions list's KEY and its forgetting, alone: AuthContext (the main bundle, under the
// notebook first-open byte budget) imports only this; the list's reading and writing (`userDefsCache.js`) ride the
// chart's own chunk.
export const DEFS_CACHE_KEY = 'uct.userDefinitions.v1'

/** A definitive sign-out (AuthContext), or a refused list read: the kept list is forgotten. */
export function clearCachedDefinitions(storage) {
  try { (storage === undefined ? window.localStorage : storage)?.removeItem(DEFS_CACHE_KEY) } catch { /* storage blocked */ }
}
