// criteriaApi.js — the two calls behind the typed-criteria box (FT-026/029).
//
// ⛔ The server decides whether the box exists: `GET /api/screener/grammar`
// answers 404 while SCREENER_LOGIC_ENABLED is off, so `grammarAvailable()`
// returning false is the only signal the shell reads (no client-side flag).
//
// Kept out of the component on purpose: the provenance rail treats any JSX
// module that names a screener URL as a result surface, and this box is a
// criteria editor, not a result set.

export async function grammarAvailable(fetcher = fetch) {
  try {
    const r = await fetcher('/api/screener/grammar', { credentials: 'include' })
    return r.ok
  } catch {
    return false
  }
}

/** Text -> { logic, criteria, explanation }. Throws with the server's sentence. */
export async function parseCriteria(text, fetcher = fetch) {
  const r = await fetcher('/api/screener/grammar/parse', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!r.ok) {
    let detail = `parse ${r.status}`
    try { const j = await r.json(); if (j?.detail) detail = String(j.detail) } catch { /* keep */ }
    throw new Error(detail)
  }
  return r.json()
}
