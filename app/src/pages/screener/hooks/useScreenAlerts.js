import useSWR from 'swr'

// ─── ⭐⭐ THE PRODUCER FOR A BACKEND THAT HAD NONE ────────────────────────────
//
// `GET/POST /api/screener/alerts` and `DELETE /api/screener/alerts/{def_hash}`
// have shipped behind `require_paid` over a complete service and a prod-armed
// nightly job, with tests. Nothing in `app/src` called them: `grep -rn
// "api/screener/alerts" app/src` returned nothing at all. A member could write a
// screener, save it, run it — and had no way to be told when a name entered it.
//
// ⚠️ THE DIFF IS NIGHTLY BY CONSTRUCTION and the route says so in its own
// docstring: the sweep runs once, off a 03:00 snapshot. Any copy this hook's
// callers write has to say "overnight" rather than imply a live watch.

/** ⛔ THROWS on a non-ok response, for the reason `useSavedScreens` does: a
 *  silent 402 renders as "no alerts", which looks exactly like a paid account
 *  with none set — and those two want different words on the screen. */
const fetcher = async (url) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`screen-alerts ${r.status}`)
  return r.json()
}

/** The modes the service declares (`screen_alerts.MODES`). */
export const ALERT_MODES = Object.freeze(['entry', 'exit', 'both'])

export default function useScreenAlerts() {
  const { data, error, mutate } = useSWR('/api/screener/alerts', fetcher)
  const subscriptions = (data && Array.isArray(data.subscriptions))
    ? data.subscriptions : []

  /** ⭐ KEYED BY `def_hash`, WHICH IS WHAT THE SERVICE KEYS ON. A screen's
   *  `ast_hash` never moves while its tree does not, so a renamed or re-saved
   *  screen keeps its subscription — that is the property this key is chosen
   *  for, and looking it up by `def_id` here would quietly lose it. */
  const subscribedHashes = new Set(subscriptions.map((s) => String(s.def_hash)))

  /**
   * ⛔ RETURNS THE REFUSAL, never swallows it — the contract `deleteUserDefinition`
   * and `useSavedScreens.remove` already set for this codebase. A caller handed
   * nothing can only stay silent or invent a sentence of its own.
   * @returns {Promise<{ok: true} | {ok: false, error: string}>}
   */
  const subscribe = async (defHash, defId, name, mode = 'both') => {
    if (!defHash) return { ok: false, error: 'This screen has no hash to watch.' }
    if (!ALERT_MODES.includes(mode)) {
      return { ok: false, error: `Unknown alert mode ${mode}.` }
    }
    try {
      const r = await fetch('/api/screener/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          def_hash: String(defHash),
          def_id: String(defId || ''),
          name: String(name || 'Untitled screen'),
          mode,
        }),
      })
      if (!r.ok) {
        let detail = ''
        try { detail = (await r.json()).detail || '' } catch (e) { detail = '' }
        return { ok: false, error: detail || `Could not set the alert (${r.status}).` }
      }
      await mutate()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: 'Could not reach the alerts service.' }
    }
  }

  /** @returns {Promise<{ok: true} | {ok: false, error: string}>} */
  const unsubscribe = async (defHash) => {
    if (!defHash) return { ok: false, error: 'This screen has no hash to watch.' }
    try {
      const r = await fetch(`/api/screener/alerts/${encodeURIComponent(String(defHash))}`,
        { method: 'DELETE' })
      if (!r.ok) return { ok: false, error: `Could not remove the alert (${r.status}).` }
      await mutate()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: 'Could not reach the alerts service.' }
    }
  }

  return {
    subscriptions,
    subscribedHashes,
    // ⚠️ `loading` IS NOT `!subscriptions.length`. An account with no alerts and
    // an account whose request has not landed look identical by that test, and
    // they want different controls.
    loading: !data && !error,
    error: error || null,
    subscribe,
    unsubscribe,
  }
}
