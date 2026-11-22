// app/src/agent/watchlistCatalog.js — the lists a Watchlist widget's PICKER offers beyond the member's own: UCT's prebuilt
// directory and the community (public) lists, read from the SAME endpoints the picker reads (WatchlistPicker.jsx:
// PREBUILT_DIRECTORY_URL and /api/watchlists/public), through the host's watchlist source (host.js buildWatchlistSource
// registers its request). Names and ids only; no members. pl-exec, watchlist group A (C3-064).
import { PREBUILT_DIRECTORY_URL } from '../pages/watchlist/prebuiltDirectory'

export const COMMUNITY_URL = '/api/watchlists/public'
let reader = null
/** The host's watchlist source hands in its request (credentials included). */
export function setCatalogReader(fn) { reader = typeof fn === 'function' ? fn : null }

const rowsOf = (j) => (Array.isArray(j) ? j : Array.isArray(j?.watchlists) ? j.watchlists : [])
/** → { prebuilt: [{ id, name, key }], community: [{ id, name, key }] }, or null when it could not be read. */
export async function loadCatalog(request = reader) {
  if (typeof request !== 'function') return null
  try {
    const get = async (u) => { const r = await request(u, { cache: 'no-store' }); return r?.ok ? r.json() : null }
    const [pre, pub] = await Promise.all([get(PREBUILT_DIRECTORY_URL), get(COMMUNITY_URL)])
    if (pre == null && pub == null) return null
    // the picker's own pick keys: a prebuilt row's stable alias cell aside, a list is `community:<id>` (WatchlistPicker.jsx)
    const shape = (rows) => rowsOf(rows).filter(r => r && r.id != null && r.name).map(r => ({ id: String(r.id), name: String(r.name), key: `community:${r.id}` }))
    return { prebuilt: shape(pre), community: shape(pub) }
  } catch { return null }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** A name the member said, against list rows → { hit } (one exact match) | { near: [names] } (none or several: never picked). */
export function matchListName(rows, said) {
  const w = norm(said)
  if (!w) return { near: [] }
  const exact = rows.filter(r => norm(r.name) === w)
  if (exact.length === 1) return { hit: exact[0] }
  if (exact.length > 1) return { near: exact.map(r => r.name) }
  // (only ever LISTED back as "did you mean": a containment, one edit apart, or the same first three letters of a word)
  const pre = (x) => x.split(" ").map(t => t.slice(0, 3)).filter(t => t.length === 3)
  const near = rows.filter(r => norm(r.name).includes(w) || w.includes(norm(r.name)) || editClose(norm(r.name), w)
    || pre(norm(r.name)).some(p => pre(w).includes(p)))
  return { near: near.map(r => r.name).slice(0, 5) }
}
// one edit apart (a typo: "Leadrs" for "Leaders")
function editClose(a, b) {
  if (Math.abs(a.length - b.length) > 1 || !a || !b) return false
  let i = 0, j = 0, d = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++d > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return d + (a.length - i) + (b.length - j) <= 1
}
