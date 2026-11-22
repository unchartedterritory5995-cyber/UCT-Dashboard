// The Watchlist library — Prebuilt (UCT-curated, grouped by category) · Community (shared) ·
// My Lists (Flagged + the member's own) — shared by the full-widget picker (WatchlistPicker)
// and the library rail beside an open list (LibraryRail, owner 11-13). ONE grouping and ONE
// pick key per row, so the two surfaces can never disagree about what a list is or opens to.
import useSWR, { mutate as swrMutate } from 'swr'
import { useFlagged } from '../../../hooks/useFlagged'
import { aliasKey } from '../../watchlist/communityPick'
import { PREBUILT_DIRECTORY_URL, PICKER_MY_LISTS_URL } from '../../watchlist/prebuiltDirectory'

export const COMMUNITY_URL = '/api/watchlists/public'
export const libraryFetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : []))
export const countOf = (wl) => wl?.item_count ?? wl?.count ?? (Array.isArray(wl?.symbols) ? wl.symbols.length : (Array.isArray(wl?.items) ? wl.items.length : null))

export const LIBRARY_TABS = [
  { key: 'prebuilt', label: 'Prebuilt', icon: 'star' },
  { key: 'community', label: 'Community', icon: 'community' },
  { key: 'mine', label: 'My Lists', icon: 'library' },
]

// Prebuilt lists render grouped under section headers (their `category` from the config —
// e.g. "UCT ETF Lists"). Category order is first-seen. Within a section, DATED lists (the
// server tags each Sunday Scans issue list with `issue_date`) come first, newest first —
// A→Z would scramble April < August < July — and a dated section renders as ONE column so
// the full dated name stays readable. Everything else sorts A→Z.
// A row carrying a stable `alias` (the newest Sunday Scans issue) ALSO offers a "follows
// each issue" entry, pinned first: picking it stores community:alias:<alias>, which resolves
// to whichever row carries the alias when the next issue lands — a dated pick stays on its
// date. (Synthetic row: same count, its own pick key.) `count` = real lists.
export function groupPrebuiltLists(prebuilt) {
  const order = []
  const byCat = new Map()
  for (const wl of prebuilt) {
    const cat = wl.category || 'UCT ETF Lists'
    if (!byCat.has(cat)) { byCat.set(cat, []); order.push(cat) }
    byCat.get(cat).push(wl)
  }
  const byIssueThenName = (a, b) => {
    const da = a.issue_date || '', db = b.issue_date || ''
    if (da !== db) return !da ? 1 : !db ? -1 : db.localeCompare(da)
    return (a.name || '').localeCompare(b.name || '')
  }
  order.forEach((c) => byCat.get(c).sort(byIssueThenName))
  return order.map((c) => {
    const lists = byCat.get(c)
    const follow = lists.filter((l) => l.alias).map((l) => ({
      ...l, id: `alias:${l.alias}`, name: l.alias_label || `${l.name} (latest)`,
      pickKey: aliasKey(l.alias), hint: `Always the newest issue — today ${l.name}`,
    }))
    return { category: c, lists: [...follow, ...lists], count: lists.length, dated: lists.some((l) => !!l.issue_date) }
  })
}

// The pick each row makes — the exact selections the picker has always made.
export const prebuiltPick = (wl) => ({ key: wl.pickKey || `community:${wl.id}`, name: wl.name, tab: 'prebuilt' })
export const communityPick = (wl) => ({ key: `community:${wl.id}`, name: wl.name, tab: 'community' })
export const minePick = (wl) => ({ key: `user:${wl.id}`, name: wl.name, tab: 'mine' })
export const flaggedPick = (label) => ({ key: 'flagged', name: label, tab: 'mine' })

/** The three libraries, filtered by `query` (names only — counts, never items). */
export function useWatchlistLibrary(query = '', enabled = true) {
  const { flagged, flaggedName } = useFlagged()
  const { data: myLists, mutate: mutateMine } = useSWR(enabled ? PICKER_MY_LISTS_URL : null, libraryFetcher)
  const { data: communityLists } = useSWR(enabled ? COMMUNITY_URL : null, libraryFetcher)
  const { data: prebuiltLists } = useSWR(enabled ? PREBUILT_DIRECTORY_URL : null, libraryFetcher)
  const q = String(query || '').trim().toLowerCase()
  const match = (name) => !q || String(name || '').toLowerCase().includes(q)
  const flaggedLabel = flaggedName || 'Flagged'
  // The admin account OWNS every prebuilt list, so the owner's own fetch returns the UCT
  // names as "his" — they have their own tab; My Lists is for lists a person curates.
  const mine = (Array.isArray(myLists) ? myLists : []).filter((wl) => !wl?.is_prebuilt && match(wl.name))
  const community = (Array.isArray(communityLists) ? communityLists : []).filter((wl) => match(wl.name))
  const prebuilt = (Array.isArray(prebuiltLists) ? prebuiltLists : []).filter((wl) => match(wl.name))
  return {
    flagged, flaggedLabel, showFlagged: match(flaggedLabel),
    mine, community, prebuilt, prebuiltGroups: groupPrebuiltLists(prebuilt),
    myLists, mutateMine,
  }
}

// ── The member's most recent list (owner 11-13): a new Watchlist widget opens on it, with
// the library showing Prebuilt. Per browser (this is a convenience, not a record): an exact,
// namespaced key, and every read/write guarded — private mode or blocked storage → none.
export const LAST_LIST_KEY = 'uct.charts.watchlist.lastList.v1'
// Per ACCOUNT (owner 11-15): two people signing in on one browser must never open each other's
// last list (or see its saved name — "Flagged (<the other person>)"). `owner` = the user's id;
// without one the shared legacy key is used, exactly as before.
export const lastListKey = (owner) => (owner != null && owner !== '' ? `${LAST_LIST_KEY}.u${owner}` : LAST_LIST_KEY)
export function readLastList(storage = globalThis.localStorage, owner = null) {
  try {
    const v = JSON.parse(storage?.getItem(lastListKey(owner)) || 'null')
    return v && typeof v.key === 'string' && v.key ? { key: v.key, name: typeof v.name === 'string' ? v.name : null, tab: typeof v.tab === 'string' ? v.tab : null } : null
  } catch { return null }
}
export function rememberList(sel, storage = globalThis.localStorage, owner = null) {
  if (!sel?.key) return
  try { storage?.setItem(lastListKey(owner), JSON.stringify({ key: sel.key, name: sel.name || null, tab: sel.tab || null })) } catch { /* storage off: nothing to remember */ }
}

// ── List actions from the library rail (owner 11-13): the same server calls the Watchlists
// page makes (handleCreate / handleRename / handleTogglePublic / handleDeleteList / bulk add),
// then EVERY cached /api/watchlists* read revalidates — the rail (names + counts) and the open
// list (items) are separate SWR keys and must both see the change.
export const refreshWatchlists = () => swrMutate((k) => typeof k === 'string' && k.startsWith('/api/watchlists'))
const sendJson = (url, method, body) => fetch(url, {
  method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
export async function createWatchlist(name) {
  const res = await sendJson('/api/watchlists', 'POST', { name })
  if (!res.ok) throw new Error(String(res.status))
  const wl = await res.json()
  // A 2xx with no id is still a FAILED create (picking it would scope to `user:undefined`).
  if (!wl?.id) throw new Error('no id')
  return wl
}
export async function renameWatchlist(id, name) {
  const res = await sendJson(`/api/watchlists/${id}`, 'PUT', { name })
  if (!res.ok) throw new Error(String(res.status))
}
export async function setWatchlistPublic(id, isPublic) {
  const res = await sendJson(`/api/watchlists/${id}`, 'PUT', { is_public: !!isPublic })
  if (!res.ok) throw new Error(String(res.status))
}
export async function deleteWatchlist(id) {
  const res = await fetch(`/api/watchlists/${id}`, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) throw new Error(String(res.status))
}
/** The symbols of one of the member's own lists (the full read, items included). */
export async function ownListSymbols(id) {
  const res = await fetch('/api/watchlists', { credentials: 'include' })
  if (!res.ok) throw new Error(String(res.status))
  const all = await res.json()
  const wl = (Array.isArray(all) ? all : []).find((w) => String(w.id) === String(id))
  return (wl?.items || []).map((i) => i.sym).filter(Boolean)
}
/** A new list named `name` holding `symbols` (Duplicate). Returns the new list. */
export async function duplicateWatchlist(name, symbols) {
  const wl = await createWatchlist(name)
  if (symbols.length) {
    const res = await sendJson(`/api/watchlists/${wl.id}/items/bulk`, 'POST', { symbols })
    if (!res.ok) throw new Error(String(res.status))
  }
  return wl
}
