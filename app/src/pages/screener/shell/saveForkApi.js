// saveForkApi.js — the save-time fork (AC-11 / UC-4). The server decides which
// of the three choices exist: GET answers 404 while SCREENER_SAVE_FORK_ENABLED
// is off, mirroring promoteApi.js/criteriaApi.js's "the door exists or it
// doesn't, the client never guesses" idiom.
//
// ⛔ The server NEVER defaults `choice` — a POST with no choice is a 400, and
// this client mirrors that by never picking one on the caller's behalf either.

export async function saveForkOffer(fetcher = fetch) {
  try {
    const r = await fetcher('/api/screener/save-fork', { credentials: 'include' })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

/** Commits the chosen fork. Throws with the server's sentence on failure. */
export async function saveFork({ choice, name, spec, mode } = {}, fetcher = fetch) {
  const r = await fetcher('/api/screener/save-fork', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      choice: choice ?? null,
      spec,
      ...(name ? { name } : {}),
      ...(mode ? { mode } : {}),
    }),
  })
  let json = null
  try { json = await r.json() } catch { /* empty */ }
  if (!r.ok) throw new Error(json?.detail ? String(json.detail) : `Could not save (${r.status})`)
  return json
}
