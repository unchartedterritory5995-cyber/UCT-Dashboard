import { useCallback, useMemo, useRef, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'

const KEY = 'uct.screener.watchlistTarget'
// ⭐ The SAME key the app shell reads (hooks/useUserTickerSet.js, mounted by LogoPrewarm at the
// app root), so the Focus layout adds no second request for the member's lists.
// ⚠️ That shell fetcher answers a failed read with `[]`, and SWR keeps ONE cache entry per key,
// so `data` here can be an empty array that is really a failed read. Nothing below trusts an
// empty `data` for anything that writes: see `confirmNoLists`.
export const LISTS_URL = '/api/watchlists?include_prebuilt=0'
// The list W creates for a member who has none (owner decision 4 / B15).
export const PICKS_NAME = 'Screener picks'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }
const write = v => { try { localStorage.setItem(KEY, String(v)) } catch { /* private mode */ } }
// A failed read must stay distinguishable from an empty one: throw so SWR reports `error`.
const fetcher = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`watchlists ${r.status}`)
  return r.json()
})
// GET /api/watchlists returns a BARE ARRAY of watchlist rows (string ids,
// is_flagged_list rows already excluded server-side). Curated (is_prebuilt)
// lists are not the member's to add to, so they are never a target. A LINKED
// list (row.origin.mode === 'link', set by watchlist_origin.annotate on the full
// read) refuses adds with 409 in the router, so it is not offered either.
const normalise = d => (Array.isArray(d) ? d : []).filter(w => w && w.id != null && !w.is_flagged_list && !w.is_prebuilt && w.origin?.mode !== 'link')
// Every list the member OWNS, usable or not (a linked list counts: they have watchlists).
const owned = d => (Array.isArray(d) ? d : []).filter(w => w && w.id != null && !w.is_flagged_list && !w.is_prebuilt)

// ⛔ "The member has zero watchlists" is decided by a FRESH read that can fail, never by the
// shared SWR cache (whose `[]` may be the shell's swallowed error) — creating a list on a
// failed read would hand every member with a 500 a duplicate "Screener picks".
// Returns {lists} on a good read, or {failed: true}.
async function confirmNoLists() {
  try {
    const r = await fetch(LISTS_URL, { credentials: 'include', cache: 'no-store' })
    if (!r.ok) return { failed: true }
    const d = await r.json()
    if (!Array.isArray(d)) return { failed: true }
    return { lists: d }
  } catch {
    return { failed: true }
  }
}

export default function useWatchlistTarget() {
  const { mutate } = useSWRConfig()
  const { data, error } = useSWR(LISTS_URL, fetcher)
  const lists = useMemo(() => normalise(data), [data])
  const [chosen, setChosen] = useState(read)
  const target = useMemo(() => lists.find(l => String(l.id) === String(chosen)) || lists[0] || null, [lists, chosen])
  const setTarget = useCallback(id => { setChosen(String(id)); write(id) }, [])
  // Two quick presses of W must not create two lists: the second waits on the first's create.
  const creating = useRef(null)
  const revalidate = useCallback(() => mutate(k => typeof k === 'string' && k.startsWith('/api/watchlists')), [mutate])

  // The list to add to when the member has none: "Screener picks", created once.
  // Resolves to {list, created} or {message} (nothing was created or added).
  const ensurePicks = useCallback(async sym => {
    const fresh = await confirmNoLists()
    if (fresh.failed) return { message: `Your watchlists couldn't be checked, so ${sym} was not added.` }
    const usable = normalise(fresh.lists)
    if (usable.length) return { list: usable[0], created: false }
    if (owned(fresh.lists).length) return { message: 'Your lists are linked and cannot take new names. Create a watchlist first, then press W again.' }
    try {
      const r = await fetch('/api/watchlists', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: PICKS_NAME, description: '', is_public: false }),
      })
      const row = r.ok ? await r.json() : null
      if (!row || row.id == null) return { message: `"${PICKS_NAME}" could not be created, so ${sym} was not added.` }
      return { list: { id: row.id, name: row.name || PICKS_NAME }, created: true }
    } catch {
      return { message: `"${PICKS_NAME}" could not be created: the server could not be reached.` }
    }
  }, [])

  const add = useCallback(async sym => {
    if (error) return { ok: false, message: "Your watchlists couldn't be loaded, so nothing was added." }
    if (data === undefined) return { ok: false, message: 'Your watchlists are still loading. Try again in a moment.' }
    let list = target
    let created = false
    // The cached lists were empty, so they are re-read once this add settles, whatever happened.
    const stale = !list
    if (!list) {
      // Lists exist but none can take a name (all linked): never create a second home for W.
      if (owned(data).length) return { ok: false, message: 'Your lists are linked and cannot take new names. Create a watchlist first, then press W again.' }
      const first = !creating.current
      if (first) creating.current = ensurePicks(sym).finally(() => { creating.current = null })
      const got = await creating.current
      if (!got.list) { revalidate(); return { ok: false, message: got.message } }
      list = got.list
      created = got.created && first
      setTarget(list.id)
    }
    try {
      const r = await fetch(`/api/watchlists/${list.id}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sym, notes: '' }),
      })
      if (!r.ok) return { ok: false, message: created ? `Created "${list.name}", but ${sym} was not added to it.` : `${sym} was not added to ${list.name}.` }
      if (created) return { ok: true, created: true, message: `Created a watchlist "${list.name}" and added ${sym} to it` }
      return { ok: true, message: `Added ${sym} to ${list.name}` }
    } catch {
      return { ok: false, message: `${sym} was not added: the server could not be reached.` }
    } finally {
      if (stale) revalidate()
    }
  }, [target, data, error, ensurePicks, revalidate, setTarget])
  return { target, lists, add, setTarget }
}
