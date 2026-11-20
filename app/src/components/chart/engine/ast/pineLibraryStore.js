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
import DENY from './pineLibraryDeny.json'

// ⭐⭐ U15 (coordinator ruling 2026-11-15) — THE DENY LIST: a version named in
// `pineLibraryDeny.json` is never compiled, whatever a store holds (the Python store reads
// the same file). An entry is removed only by a re-grade to MATCH (the file says how).
/** ⭐⭐ U15 — the deny table of a parsed deny document: Map(path -> row), or NULL when the
 *  document cannot be read as a deny list. ⛔ FAIL CLOSED: null denies EVERY version (the
 *  Python store's `_deny_doc` answers the same way). A document with no `deny` array, or
 *  with one row that names no path, is unreadable as a whole: dropping the one bad row
 *  would serve exactly the version that row was written to withhold. An empty array is a
 *  readable list that denies nothing. */
export function denyTableOf(doc) {
  const rows = doc && typeof doc === 'object' ? doc.deny : null
  if (!Array.isArray(rows)) return null
  if (rows.some((d) => !d || typeof d !== 'object' || typeof d.path !== 'string' || !d.path)) return null
  return new Map(rows.map((d) => [d.path, d]))
}
const DENIED = denyTableOf(DENY)
export const LIBRARY_DENIED_SENTENCE = String((DENY && DENY.memberSentence)
  || 'this library version is withheld until its drawing is verified against TradingView')

/** ⭐⭐ U15 — the member's sentence when `path` is on the deny list (or the list could not
 *  be read), or null. `table` is the committed list's; a rail passes another. */
export function libraryDenied(path, table = DENIED) {
  return (!table || table.has(String(path))) ? LIBRARY_DENIED_SENTENCE : null
}

const IMPORT_PATH = /^([A-Za-z0-9_]{1,80})\/([A-Za-z0-9_]{1,80})\/([1-9][0-9]{0,5})$/
const SHA256 = /^[0-9a-f]{64}$/
const entries = new Map()
// ⭐ U15 — the paths the store answered for but would not SERVE (an entry with no
// verified sha256): path -> the sentence the lanes refuse the import line with.
const unservable = new Map()
// ⭐ THE PASTE WORKER — moves whenever the registry may have moved (`memberDoorImage.memberDoorStateVersion`)
let revision = 0
/** The registry's revision (its value is meaningless). */
export function pineLibraryStoreRevision() { return revision }

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

// ⭐⭐ U15 (coordinator ruling 2026-11-15) — `NC` as its own token in a licence id
// (CC-BY-NC, CC-BY-NC-SA, CC-BY-NC-ND …), or the words. The store's twin is
// `pine_library_store.licence_problem`; the rail holds the two to one answer.
const NON_COMMERCIAL = /(?:^|[^A-Za-z])NC(?:[^A-Za-z]|$)|non[\s-]?commercial/i

/** ⭐⭐ U15 — WHY a library's LICENCE keeps it off this paid product, or null: a
 *  non-commercial licence (in its id, or the `nonCommercial` flag the fetch records) is
 *  never served, whatever else the entry carries. */
export function libraryLicenceProblem(entry) {
  if (!entry || typeof entry !== 'object') return null
  const licence = typeof entry.licence === 'string' ? entry.licence : ''
  if (entry.nonCommercial === true || NON_COMMERCIAL.test(licence)) {
    return `its licence, ${licence || 'unnamed'}, is non-commercial, and this is a paid product, so its code is not served here`
  }
  return null
}

/** Register one library version. Returns the stored entry, or null (and stores
 *  nothing) for an entry without a valid path, a source, a licence, or (U15) a
 *  sha256 that is its source's, or a non-commercial licence; such a path is
 *  remembered as UNSERVABLE, by name. */
export function registerPineLibrary(entry) {
  if (!entry || typeof entry !== 'object') return null
  revision += 1
  const path = String(entry.path || '')
  if (!IMPORT_PATH.test(path) || typeof entry.source !== 'string' || !entry.source) return null
  if (!entry.licence) return null
  const denied = libraryDenied(path)
  if (denied) {
    unservable.set(path, { reason: denied, code: 'denied' })
    entries.delete(path)
    return null
  }
  const licence = libraryLicenceProblem(entry)
  const problem = licence || libraryEntryProblem(entry)
  if (problem) {
    unservable.set(path, { reason: problem, code: licence ? 'licence' : 'no-sha' })
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

/** ⭐ U15 — remember that the server holds `path` but will not serve it, and why
 *  (`code`: `'no-sha'`, or `'licence'` for a non-commercial licence). */
export function markPineLibraryUnservable(path, reason, code = 'no-sha') {
  if (!IMPORT_PATH.test(String(path || ''))) return
  revision += 1
  unservable.set(String(path), { reason: String(reason || 'the library store will not serve it'),
    code: code === 'licence' || code === 'denied' ? code : 'no-sha' })
}

/** The reason `path` is held but not served, or null. */
export function pineLibraryUnservable(path) { const h = unservable.get(String(path)); return h ? h.reason : null }

/** `{reason, code}` for a held, unservable `path`, or null. */
export function pineLibraryHeld(path) { return unservable.get(String(path)) || null }

/** ⭐ THE PASTE WORKER (2026-11-20) — the registry as plain data, for the member door's worker
 *  (`builder/memberPane/memberDoorImage.js`): a worker is its own module graph and starts EMPTY, and the
 *  translators there must link exactly the libraries this page holds. */
export function pineLibraryStoreImage() {
  return { entries: [...entries.values()], unservable: [...unservable] }
}
/** Hold exactly an image's libraries (`pineLibraryStoreImage`): the worker's side. Each entry was admitted by
 *  `registerPineLibrary` where the image was taken, so it is kept as it came (frozen), not admitted twice. */
export function applyPineLibraryStoreImage(img) {
  revision += 1
  entries.clear()
  unservable.clear()
  const m = img && typeof img === 'object' ? img : {}
  for (const e of Array.isArray(m.entries) ? m.entries : []) {
    if (e && typeof e.path === 'string') entries.set(e.path, Object.freeze({ ...e }))
  }
  for (const [p, h] of Array.isArray(m.unservable) ? m.unservable : []) {
    if (typeof p === 'string' && h && typeof h === 'object') unservable.set(p, { ...h })
  }
}

export function pineLibraryEntry(path) { return entries.get(String(path)) || null }
export function clearPineLibraries() { revision += 1; entries.clear(); unservable.clear() }
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
          const code = d && typeof d === 'object' ? d.code : null
          markPineLibraryUnservable(path, d && typeof d === 'object' && d.reason ? d.reason : null,
            code === 'library:licence' ? 'licence' : code === 'library:denied' ? 'denied' : 'no-sha')
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
