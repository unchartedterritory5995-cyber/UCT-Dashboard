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
  /**
   * Delete a saved screen.
   *
   * ⛔ X26 (W9c.1) — THE STORE'S REFUSAL SENTENCE, NOT A DISCARDED RESPONSE.
   * This used to fire the DELETE and ignore whatever came back, so a caller
   * had no way to tell a member a delete had failed — the same contract gap
   * `deleteUserDefinition` (`hooks/useUserDefinitions.js`) already closed for
   * the sibling formulas store, for the same reason: a caller handed nothing
   * can only stay silent or invent a sentence of its own, which is the
   * second-vocabulary defect that file's header forbids.
   *
   * ⚠️ THE BACKEND ANSWERS A LOGICAL MISS WITH 404 `detail: "not found"`
   * (mirrors `screener_saved_update`'s existing contract — `screener.py`'s
   * `screener_saved_delete` used to return 200 `{"deleted": false}` on a
   * screen that never existed or belonged to someone else, which is not a
   * refusal `r.ok` can see; fixed alongside this hook).
   *
   * @returns {Promise<{ok: true} | {ok: false, error: string}>} — never null;
   *          `error` is always a non-blank string when `ok` is false.
   */
  const remove = async id => {
    let r
    try {
      r = await fetch(`/api/screener/saved-screens/${id}`, { method: 'DELETE' })
    } catch {
      // A transport failure and a refusal need different words — one is "try
      // again", the other is "this screen cannot be deleted".
      return { ok: false, error: 'Could not reach the server — check your connection and try again.' }
    }
    // Fires on a refusal too: a request that was ANSWERED — even with a no —
    // means the client's picture of what exists is now a guess. Only a
    // request that never left (the catch above) skips it.
    mutate()
    if (r.ok) return { ok: true }
    let detail = ''
    try {
      const body = await r.json()
      // ⚠️ Only used when it is a string, and TRIMMED at the assignment —
      // FastAPI answers a schema-invalid request with `detail: [{…}]`, and a
      // store answering whitespace must not sail past the `||` fallback below
      // and render a role="alert" a screen reader announces as nothing.
      if (typeof body?.detail === 'string') detail = body.detail.trim()
    } catch { /* not JSON — an HTML error page, or an empty body */ }
    return { ok: false, error: detail || `The server refused to delete this screen (${r.status}).` }
  }

  return {
    saved: data?.saved ?? [],
    starters: data?.starters ?? [],
    error: error || null,
    create, update, remove, refresh: mutate,
  }
}
