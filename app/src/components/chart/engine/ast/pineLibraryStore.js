// app/src/components/chart/engine/ast/pineLibraryStore.js
//
// ─── THE CLIENT-SIDE PINE LIBRARY REGISTRY ──────────────────────────────────────
//
// `Author/Library/Version` → the library's published source, its licence and its
// attribution. The linker (`pineLibraries.js`) reads this when a translation is not
// handed `opts.libraries` itself.
//
// ⛔⛔ NOTHING IN THIS FILE IS A LIBRARY. It starts EMPTY in every process. Sources
// arrive from the server's store (`GET /api/pine/libraries/<Author>/<Library>/<N>`,
// `api/routers/pine_libraries.py`) through `ensurePineLibraries`, or from a test
// that registers its own small fixture. Third-party library code is never in this
// repository (it is public, and the code carries its authors' licences).
//
// ⛔ A VERSION IS DIFFERENT CODE: `TradingView/ta/7` and `TradingView/ta/10` are two
// entries and never stand in for each other.

import { sha256Hex } from './parse.js'

const IMPORT_PATH = /^([A-Za-z0-9_]{1,80})\/([A-Za-z0-9_]{1,80})\/([1-9][0-9]{0,5})$/
const SHA256 = /^[0-9a-f]{64}$/
const entries = new Map()
// ⭐ U15 — the paths the store answered for but would not SERVE (an entry with no
// verified sha256): path -> the sentence the lanes refuse the import line with.
const unservable = new Map()

/** ⭐ U15 — WHY a library entry may not be compiled, or null when it may. ONE rule for
 *  every source of entries (the server's store, `opts.libraries`, a test): a library
 *  is served only with the sha256 of its own source, and only when that sha256 IS
 *  its source's. A version is pinned by that sha: two fetches of `A/L/7` that differ
 *  are two different programs, and nothing here can tell them apart without it. */
export function libraryEntryProblem(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.source !== 'string' || !entry.source) {
    return 'its entry carries no source'
  }
  const sha = typeof entry.sha256 === 'string' ? entry.sha256.toLowerCase() : ''
  if (!SHA256.test(sha)) return 'its entry carries no sha256, so the code compiled could not be told from any other'
  // a source is hashed once per (entry, source, sha): every translation links it again
  const seen = verified.get(entry)
  if (seen && seen.source === entry.source && seen.sha === sha) return seen.problem
  const problem = sha256Hex(entry.source) !== sha ? 'its source does not match the sha256 recorded with it' : null
  verified.set(entry, { source: entry.source, sha, problem })
  return problem
}
const verified = new WeakMap()

/** Register one library version. Returns the stored entry, or null (and stores
 *  nothing) for an entry without a valid path, a source, a licence, or (U15) a
 *  sha256 that is its source's; such a path is remembered as UNSERVABLE, by name. */
export function registerPineLibrary(entry) {
  if (!entry || typeof entry !== 'object') return null
  const path = String(entry.path || '')
  if (!IMPORT_PATH.test(path) || typeof entry.source !== 'string' || !entry.source) return null
  if (!entry.licence) return null
  const problem = libraryEntryProblem(entry)
  if (problem) {
    unservable.set(path, problem)
    entries.delete(path)
    return null
  }
  const stored = Object.freeze({
    path,
    source: entry.source,
    sha256: entry.sha256.toLowerCase(),
    licence: String(entry.licence),
    licenceBasis: entry.licenceBasis || null,
    attribution: entry.attribution || null,
    url: entry.url || null,
  })
  unservable.delete(path)
  entries.set(path, stored)
  return stored
}

/** ⭐ U15 — remember that the server holds `path` but will not serve it, and why. */
export function markPineLibraryUnservable(path, reason) {
  if (!IMPORT_PATH.test(String(path || ''))) return
  unservable.set(String(path), String(reason || 'the library store will not serve it'))
}

/** The reason `path` is held but not served, or null. */
export function pineLibraryUnservable(path) { return unservable.get(String(path)) || null }

export function pineLibraryEntry(path) { return entries.get(String(path)) || null }
export function clearPineLibraries() { entries.clear(); unservable.clear() }
export function registeredPineLibraries() { return [...entries.keys()].sort() }

/** The import paths a source names (top-level `import A/B/N` lines). */
export function importPathsOf(source) {
  const out = []
  const re = /^import[ \t]+([A-Za-z0-9_]+)[ \t]*\/[ \t]*([A-Za-z0-9_]+)[ \t]*\/[ \t]*([1-9][0-9]*)/gm
  let m
  while ((m = re.exec(String(source || ''))) !== null) {
    const p = `${m[1]}/${m[2]}/${m[3]}`
    if (!out.includes(p)) out.push(p)
  }
  return out
}

/** Fetch every library `source` imports that the registry does not hold yet —
 *  and what THOSE import — from the server's store. Resolves to
 *  `{loaded: [path], missing: [path]}`; never rejects (a library the server does
 *  not hold stays missing, and the lanes refuse the import line naming it). */
export async function ensurePineLibraries(source, { fetchImpl, base = '/api/pine/libraries' } = {}) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null)
  const loaded = []
  const missing = []
  if (!f) return { loaded, missing: importPathsOf(source) }
  const queue = importPathsOf(source)
  const seen = new Set()
  while (queue.length) {
    const path = queue.shift()
    if (seen.has(path)) continue
    seen.add(path)
    let entry = pineLibraryEntry(path)
    if (!entry) {
      try {
        const res = await f(`${base}/${path}`, { credentials: 'include' })
        if (res && res.ok) entry = registerPineLibrary(await res.json())
        // ⭐ U15 — 409: the store holds this version but will not serve it (no
        // verified sha256). Remembered by name, so the import line says why.
        else if (res && res.status === 409) {
          let body = null
          try { body = await res.json() } catch { body = null }
          const d = body && body.detail
          markPineLibraryUnservable(path, d && typeof d === 'object' && d.reason ? d.reason : null)
          loaded.push(path)
        }
      } catch { entry = null }
      if (entry) loaded.push(path)
    }
    if (!entry) { missing.push(path); continue }
    for (const p of importPathsOf(entry.source)) if (!seen.has(p)) queue.push(p)
  }
  return { loaded, missing }
}
