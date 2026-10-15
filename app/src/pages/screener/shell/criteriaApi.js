// criteriaApi.js — the two calls behind the typed-criteria box (FT-026/029).
//
// ⛔ The server decides whether the box exists: `GET /api/screener/grammar`
// answers 404 while SCREENER_LOGIC_ENABLED is off, so `grammarAvailable()`
// returning false is the only signal the shell reads (no client-side flag).
//
// Kept out of the component on purpose: the provenance rail treats any JSX
// module that names a screener URL as a result surface, and this box is a
// criteria editor, not a result set.

// ⭐ ONE PROBE PER DOOR PER PAGE LIFETIME. Opening the Focus layout's Filters drawer mounts
// both "Describe a setup" (useDescribe) and CriteriaBox, and each used to ask both doors:
// `grammar` x2 and `compile` x2 on every open. The answer is now memoised per fetcher, so
// concurrent and later callers share one request. A door that answered "open" stays open
// for the page; a closed door or a failed request is FORGOTTEN, so the next caller asks
// again (a flag armed mid-session, or a network blip, is not latched shut).
// Keyed by the fetcher, so a caller (or a test) passing its own fetcher gets its own probe.
const probes = new Map() // path -> WeakMap<fetcher, Promise<boolean>>
function probeDoor(path, fetcher) {
  let byFetcher = probes.get(path)
  if (!byFetcher) { byFetcher = new WeakMap(); probes.set(path, byFetcher) }
  let p = byFetcher.get(fetcher)
  if (!p) {
    p = (async () => {
      try {
        const r = await fetcher(path, { credentials: 'include' })
        return !!r.ok
      } catch {
        return false
      }
    })().then(ok => { if (!ok && byFetcher.get(fetcher) === p) byFetcher.delete(fetcher); return ok })
    byFetcher.set(fetcher, p)
  }
  return p
}

// A door that answered "open" and then shuts (404: flag off; 402/403: plan or permission) must
// not stay "open" in the memo: the next caller asks again.
const DOOR_SHUT = new Set([402, 403, 404])
function forgetDoor(path, fetcher) { probes.get(path)?.delete(fetcher) }

/** Tests only: forget every memoised door answer. */
export function __resetCriteriaProbes() { probes.clear() }

export function grammarAvailable(fetcher = fetch) {
  return probeDoor('/api/screener/grammar', fetcher)
}

/** FT-024/030: is the plain-English compile door open? (404 while dark.) */
export function compileAvailable(fetcher = fetch) {
  return probeDoor('/api/screener/compile', fetcher)
}

/** English -> { criteria, logic, explanation, assumptions }. Throws with the server's sentence. */
export async function compileEnglish(text, fetcher = fetch) {
  const r = await fetcher('/api/screener/compile', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!r.ok) {
    if (DOOR_SHUT.has(r.status)) forgetDoor('/api/screener/compile', fetcher)
    let detail = `compile ${r.status}`
    try { const j = await r.json(); if (j?.detail) detail = String(j.detail) } catch { /* keep */ }
    // The message is unchanged; `status` rides along so a caller can tell a shut door from a refusal.
    throw Object.assign(new Error(detail), { status: r.status })
  }
  return r.json()
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
    // As compile: a grammar door that shuts mid-page is asked again next time, never latched open.
    if (DOOR_SHUT.has(r.status)) forgetDoor('/api/screener/grammar', fetcher)
    let detail = `parse ${r.status}`
    try { const j = await r.json(); if (j?.detail) detail = String(j.detail) } catch { /* keep */ }
    throw new Error(detail)
  }
  return r.json()
}
