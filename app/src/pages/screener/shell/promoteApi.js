// promoteApi.js — scan -> watchlist (FT-027). The server decides whether the
// door exists: GET answers 404 while SCREENER_PROMOTE_ENABLED is off.
// Kept out of the component for the provenance rail's reason (see criteriaApi.js).

export async function promoteAvailable(fetcher = fetch) {
  try {
    const r = await fetcher('/api/screener/to-watchlist', { credentials: 'include' })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

export async function promoteScreen({ spec, name, watchlistId } = {}, fetcher = fetch) {
  const r = await fetcher('/api/screener/to-watchlist', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec, ...(name ? { name } : {}), ...(watchlistId ? { watchlist_id: watchlistId } : {}) }),
  })
  let json = null
  try { json = await r.json() } catch { /* empty */ }
  if (!r.ok) throw new Error(json?.detail ? String(json.detail) : `Could not create the list (${r.status})`)
  return json
}
