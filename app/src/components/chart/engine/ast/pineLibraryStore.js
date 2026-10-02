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

const IMPORT_PATH = /^([A-Za-z0-9_]{1,80})\/([A-Za-z0-9_]{1,80})\/([1-9][0-9]{0,5})$/
const entries = new Map()

/** Register one library version. Returns the stored entry, or null (and stores
 *  nothing) for an entry without a valid path, a source, or a licence. */
export function registerPineLibrary(entry) {
  if (!entry || typeof entry !== 'object') return null
  const path = String(entry.path || '')
  if (!IMPORT_PATH.test(path) || typeof entry.source !== 'string' || !entry.source) return null
  if (!entry.licence) return null
  const stored = Object.freeze({
    path,
    source: entry.source,
    licence: String(entry.licence),
    licenceBasis: entry.licenceBasis || null,
    attribution: entry.attribution || null,
    url: entry.url || null,
  })
  entries.set(path, stored)
  return stored
}

export function pineLibraryEntry(path) { return entries.get(String(path)) || null }
export function clearPineLibraries() { entries.clear() }
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
      } catch { entry = null }
      if (entry) loaded.push(path)
    }
    if (!entry) { missing.push(path); continue }
    for (const p of importPathsOf(entry.source)) if (!seen.has(p)) queue.push(p)
  }
  return { loaded, missing }
}
