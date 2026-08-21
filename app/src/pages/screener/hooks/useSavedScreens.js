import useSWR from 'swr'

// ⛔ K7: THROWS on a non-ok response, deliberately. A silent 402 renders as
// "None saved yet" — which looks exactly like a paid, empty account — and the
// difference decides whether the Save/Share controls should exist at all.
// SWR only populates `error` when the fetcher rejects, so the throw is what
// makes a refusal visible to the manager.
const fetcher = async url => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`saved-screens ${r.status}`)
  return r.json()
}

export default function useSavedScreens() {
  const { data, error, mutate } = useSWR('/api/screener/saved-screens', fetcher)

  const create = async (name, spec, is_public = false) => {
    await fetch('/api/screener/saved-screens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, spec, is_public }),
    })
    mutate()
  }
  const update = async (id, fields) => {
    await fetch(`/api/screener/saved-screens/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    mutate()
  }
  const remove = async id => {
    await fetch(`/api/screener/saved-screens/${id}`, { method: 'DELETE' })
    mutate()
  }

  return {
    saved: data?.saved ?? [],
    starters: data?.starters ?? [],
    error: error || null,
    create, update, remove, refresh: mutate,
  }
}
