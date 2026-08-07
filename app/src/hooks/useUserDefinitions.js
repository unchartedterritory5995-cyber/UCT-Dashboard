// app/src/hooks/useUserDefinitions.js
//
// ─── THE BUILDER'S ONLY DOOR TO STORAGE ─────────────────────────────────────
//
// Talks to `/api/user-definitions` (Task 10's append-only store,
// `api/routers/user_definitions.py`). Every route there declares
// `Depends(require_paid)` on its own handler, so a signed-out or free user gets
// 402 and this hook reports it rather than rendering an empty list that looks
// like "you have none".
//
// ⛔ IT DOES NOT WRITE `chart_settings`, AND THAT IS MEASURED RATHER THAN
// ASSUMED. `chartDefaults.mergeChartSettings` is a HARD ALLOW-LIST: a key absent
// from its return literal is DESTROYED on every read — the mechanism that
// deleted `engineEnabled` at seven sites, and the one Task 10 re-measured
// against a key called `userDefinitions`. A definition parked there survives
// until the next page load and then is gone, which is worse than a feature that
// refuses: the user's formula disappears with no error anywhere.
//
// ⛔ THE STORE'S REFUSAL SENTENCE IS NEVER REWRITTEN HERE. The caps live in one
// place (64 KiB a row, 50 live definitions a user) and their wording names the
// number that was exceeded; a client-side paraphrase is a second vocabulary for
// one decision, and the two rot apart the first time the store rewords a gate.
// The only sentences written in this file are the two the server cannot supply:
// a transport failure (it never answered) and a refusal whose body is
// unreadable. That is the same split `useIndicatorAlerts.createIndicatorAlert`
// draws, for the same reason.
import useSWR, { mutate } from 'swr'
import { useAuth } from '../context/AuthContext'

export const USER_DEFINITIONS_KEY = '/api/user-definitions'

/** ⚠️ THROWS on a non-ok response, deliberately.
 *
 *  A swallowed 402 renders as "you have no formulas", which is the same picture
 *  a paid user with an empty account sees — and the difference decides whether
 *  the Save button should exist at all. SWR only populates `error` if the
 *  fetcher rejects, so the throw is what makes the paywall visible. */
async function fetcher(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) {
    const err = new Error(`user-definitions ${r.status}`)
    err.status = r.status
    throw err
  }
  const body = await r.json()
  if (!Array.isArray(body?.definitions)) throw new Error('user-definitions: malformed response')
  return body.definitions
}

/**
 * Every live user definition, newest version of each.
 *
 * A row is the store's own shape: `{def_id, version, rev, ast_hash, definition,
 * repaint, created_at}` — `definition` being the document the builder wrote.
 *
 * @returns {{rows: object[], isLoading: boolean, error: any, refresh: () => void}}
 */
export function useUserDefinitions() {
  const { user } = useAuth()
  const { data, error, isLoading } = useSWR(user ? USER_DEFINITIONS_KEY : null, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  })
  return {
    rows: Array.isArray(data) ? data : [],
    // A signed-out user is LOADING, not an error: SWR is handed a null key then
    // and reports neither, and "offer nothing" is the safe reading of that.
    isLoading: !user || (isLoading && !data && !error),
    error: error || null,
    refresh: () => mutate(USER_DEFINITIONS_KEY),
  }
}

/**
 * Store a definition. POST when it is new, PUT when it already has an id.
 *
 * ⛔ THE SERVER MINTS THE ID ON A CREATE and this never sends one it made up: a
 * client-supplied id would let one member write into another's namespace by
 * guessing, and would let a definition claim a native id (`rsi`) whose bindings
 * a rev bump would then force-migrate.
 *
 * @returns {Promise<{ok: true, row: object} | {ok: false, error: string}>}
 *          — never null, on any branch. Callers read `.ok` unconditionally.
 */
export async function saveUserDefinition(definition, defId = null) {
  const url = defId ? `${USER_DEFINITIONS_KEY}/${encodeURIComponent(defId)}` : USER_DEFINITIONS_KEY
  let r
  try {
    r = await fetch(url, {
      method: defId ? 'PUT' : 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition }),
    })
  } catch {
    // ⛔ A TRANSPORT FAILURE AND A REFUSAL NEED DIFFERENT WORDS. One is "try
    // again", the other is "this formula cannot be stored". The same sentence
    // for both sends the user to the wrong fix.
    return { ok: false, error: 'Could not reach the server — check your connection and try again.' }
  }
  if (r.ok) {
    mutate(USER_DEFINITIONS_KEY)
    let row = null
    try { row = await r.json() } catch { /* a body-less 200 is still an accepted save */ }
    return { ok: true, row }
  }
  let detail = ''
  try {
    const body = await r.json()
    // ⚠️ `detail` IS ONLY USED WHEN IT IS A STRING. FastAPI answers a
    // schema-invalid body with `detail: [{loc, msg, type}, …]`; interpolating
    // that shows the user "[object Object]", which is worse than the silence.
    if (typeof body?.detail === 'string') detail = body.detail
  } catch { /* not JSON — an HTML error page, or an empty body */ }
  return { ok: false, error: detail || `The server refused this formula (${r.status}).` }
}

/** Soft-delete. The store appends a TOMBSTONE version rather than removing
 *  rows, so a `defId@version` pin still resolves afterwards. */
export async function deleteUserDefinition(defId) {
  try {
    const r = await fetch(`${USER_DEFINITIONS_KEY}/${encodeURIComponent(defId)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    mutate(USER_DEFINITIONS_KEY)
    return r.ok
  } catch {
    return false
  }
}
