import useSWR from 'swr'
import { withRsAlert } from '../focus/rsAlerts'

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

/** `enabled: false` → a null SWR key: nothing is fetched (the Agent's screener host for a non-admin). */
export default function useSavedScreens({ enabled = true } = {}) {
  const { data, error, mutate } = useSWR(enabled ? '/api/screener/saved-screens' : null, fetcher)

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

  /**
   * RS screens unit U13: turn the daily "what joined and what left" message on or off for one RS
   * screen (POST / DELETE /api/screener/rs-alerts/{starter id}).
   *
   * OPTIMISTIC: the payload's own `rs_alerts.subscribed` changes at once, so the switch moves under
   * the finger, and SWR puts the earlier payload back if the server refuses or cannot be reached.
   * No second read of the payload: the answer to "is it on" is the one the request just gave.
   *
   * @returns {Promise<{ok: true} | {ok: false}>}
   */
  const setRsAlert = async (starterId, on) => {
    try {
      await mutate(async cur => {
        const r = await fetch(`/api/screener/rs-alerts/${encodeURIComponent(starterId)}`, { method: on ? 'POST' : 'DELETE' })
        if (!r.ok) throw new Error(`rs-alerts ${r.status}`)
        return withRsAlert(cur, starterId, on)
      }, { optimisticData: cur => withRsAlert(cur, starterId, on), rollbackOnError: true, revalidate: false })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  return {
    saved: data?.saved ?? [],
    starters: data?.starters ?? [],
    // RS screens unit U8: the market caution state the server puts in this payload while the RS
    // screens are on ({ state, text, asof }); null when it sent none.
    rsMarket: data?.rs_market ?? null,
    // The first night: { text } while the RS lists have not been built yet (no row has a place);
    // null when the payload carries no such key, which is every other day.
    rsPending: data?.rs_pending ?? null,
    // RS screens unit U13: { available, subscribed: [starter ids] } while the daily joined-and-left
    // message is on for this member; null when the payload carries no such key.
    rsAlerts: data?.rs_alerts ?? null,
    setRsAlert,
    error: error || null,
    // True once the read has answered (with screens or with a refusal).
    loaded: data !== undefined || !!error,
    create, update, remove, refresh: mutate,
  }
}
