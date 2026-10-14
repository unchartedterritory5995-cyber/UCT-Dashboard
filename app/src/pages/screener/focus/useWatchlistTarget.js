import { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'

const KEY = 'uct.screener.watchlistTarget'
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

export default function useWatchlistTarget() {
  const { data, error } = useSWR('/api/watchlists?include_prebuilt=0', fetcher)
  const lists = useMemo(() => normalise(data), [data])
  const [chosen, setChosen] = useState(read)
  const target = useMemo(() => lists.find(l => String(l.id) === String(chosen)) || lists[0] || null, [lists, chosen])
  const setTarget = useCallback(id => { setChosen(String(id)); write(id) }, [])
  const add = useCallback(async sym => {
    if (error) return { ok: false, message: "Your watchlists couldn't be loaded, so nothing was added." }
    if (data === undefined) return { ok: false, message: 'Your watchlists are still loading. Try again in a moment.' }
    if (!target) return { ok: false, message: 'Create a watchlist first, then press W again.' }
    try {
      const r = await fetch(`/api/watchlists/${target.id}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sym, notes: '' }),
      })
      if (!r.ok) return { ok: false, message: `${sym} was not added to ${target.name}.` }
      return { ok: true, message: `Added ${sym} to ${target.name}` }
    } catch {
      return { ok: false, message: `${sym} was not added: the server could not be reached.` }
    }
  }, [target, data, error])
  return { target, lists, add, setTarget }
}
