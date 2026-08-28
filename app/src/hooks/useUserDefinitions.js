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
import { useContext, useMemo } from 'react'
import useSWR, { mutate } from 'swr'
import { AuthContext } from '../context/AuthContext'
import {
  installUserDefinitions, clearUserDefinitions, registryGeneration,
} from '../components/chart/engine/nativeRegistry'
import { META_KEY } from '../pages/screener/hooks/useScreenerMeta'

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
  // ⚠️ `useContext(AuthContext)` RATHER THAN `useAuth()`, AND FOR THE REASON
  // `useIsPaid` gives one file over. `useAuth` THROWS outside an `AuthProvider`;
  // this hook is now mounted on the CHART path (`StockChart` calls
  // `useInstalledUserDefinitions` below), and a chart legitimately renders in
  // surfaces — and in a great many suites — that mount no provider. The hook
  // already had a defined answer for "no user" (LOADING, offer nothing), so the
  // throw only added a crash where there was already a correct reading.
  const ctx = useContext(AuthContext)
  const user = ctx ? ctx.user : null
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
 *          — never null, on any branch. Callers read `.ok` unconditionally, and
 *          `error` is a NON-BLANK string whenever `ok` is false.
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
    // K3: a saved definition can just have become (or stopped being) a
    // scannable "My Scans" filter entry — revalidate the rail's category so
    // every door (BuilderSheet included) sees it without waiting out
    // useScreenerMeta's 6h SWR dedupe.
    mutate(META_KEY)
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
    //
    // ⛔ AND IT IS TRIMMED AT THE ASSIGNMENT, WHICH IS THE ONLY PLACE THAT MAKES
    // THE GUARANTEE STRUCTURAL. The gate below is `detail || <fallback>` —
    // TRUTHINESS, not emptiness — so a store answering `detail: "   "` sailed
    // past the fallback and the caller rendered a refusal made of spaces
    // (measured 2026-08-26, review round 1, in BOTH doors). Trimming here means
    // `detail` is either '' or a real sentence, and the `||` is then honest.
    if (typeof body?.detail === 'string') detail = body.detail.trim()
  } catch { /* not JSON — an HTML error page, or an empty body */ }
  return { ok: false, error: detail || `The server refused this formula (${r.status}).` }
}

/** HTTP statuses that are an AUTHORITATIVE "this session has no definitions".
 *
 *  ⛔ 5xx IS NOT IN HERE, AND THAT IS LOAD-BEARING TWICE. A transport failure or
 *  a 500 is not evidence that a user's formulas are gone, so clearing on one
 *  would take a drawn indicator off a chart on a network blip. And the parity
 *  route's hermetic mode answers every `/api/` call with **503** by design
 *  (`ChartRender.installHermeticFetch`) — a clear-on-any-error would wipe the
 *  definitions `?userdefs=` had just installed and put the gate straight back to
 *  the zero it exists to move. */
const AUTHORITATIVE_EMPTY = new Set([401, 402, 403])

/**
 * 🔴 THE PRODUCT CALLER — read the user's stored definitions and INSTALL them
 * into the registry the binder resolves through.
 *
 * Phase D Task 16. Everything upstream of this existed: Task 10's store, Task
 * 11's builder and `useUserDefinitions` above, Task 8's `ast` lane and its
 * interpreter. Nothing joined them, so a saved formula was a row in SQLite that
 * no chart could draw.
 *
 * ⛔ THE INSTALL RUNS DURING RENDER, NOT IN AN EFFECT, AND THAT IS THE WHOLE
 * ORDERING POINT. `StockChart`'s repaint resolves instances through
 * `normalizeInstances(…, engineRegistry)` and `getDefinition`; an effect runs
 * AFTER the render that consumed them, so an install deferred to one produces a
 * chart that works on the SECOND paint and only if something else happens to
 * re-trigger it. Mutating a module-scoped Map during render is safe here in a
 * way React state would not be: the install is IDEMPOTENT (`installKey`), the
 * target is not React-owned, and a StrictMode double-render therefore installs
 * the same definitions twice to the same effect and bumps the generation once.
 *
 * ⚠️ AND THE GENERATION IS RETURNED SO THE CALLER CAN DEPEND ON IT — WHICH
 * `StockChart` DOES, AND WHICH IS REDUNDANT THERE TODAY. The rows arrive from
 * SWR asynchronously, after the first paint, so the repaint that dropped the
 * instance has to run again; this number changes iff the installed set changed,
 * and `StockChart` carries it in `updateChart`'s dependency list. Task 16's
 * gauntlet then removed it (mutation M3) and every test stayed green — some
 * other entry in that list is already unstable per render. It is reported as
 * SURVIVED and the dependency is kept anyway: it is the only one that names this
 * state, and the redundancy is an accident of a perf property nobody declared.
 * `paneLayout` reads the same number and there it is NOT redundant — mutation M6
 * (the generation never moves) kills four cases.
 *
 * ⚠️ A DEFINITION THAT NO LONGER VALIDATES IS NOT INSTALLED, and `errors` says
 * so. `installUserDefinitions` re-runs every gate; Task 10 recorded that a
 * stored verdict goes stale, and drawing on a verdict nobody re-measured is the
 * thing the repaint badge exists to prevent.
 *
 * @returns {{installedIds: string[], errors: string[], generation: number,
 *            isLoading: boolean, error: any, refresh: () => void}}
 */
export function useInstalledUserDefinitions() {
  const { rows, isLoading, error, refresh } = useUserDefinitions()

  // The rows' IDENTITY, not their contents: `def_id@version` is what the store
  // versions on and `rev` is what a maths change bumps, so two lists with the
  // same key are the same claim.
  const status = error && typeof error.status === 'number' ? error.status : 0
  const key = AUTHORITATIVE_EMPTY.has(status)
    ? '<refused>'
    : rows.map(r => `${r && r.def_id}@${r && r.version}#${r && r.rev}`).join('|')

  // ⚠️ `useMemo`, AND IT REPLACED A PAIR OF REFS BECAUSE THE LINTER WAS RIGHT.
  // The first shape of this hook kept `lastKeyRef` / `resultRef` and read
  // `.current` during render; `react-hooks/refs` flagged six sites, and the rule
  // is about exactly this class — a value read during render out of something
  // React does not track. `useMemo` says the same thing in the shape React
  // supports: it runs during render (which is the whole ordering point), and it
  // recomputes when the rows change, which is what the refs were hand-rolling.
  //
  // ⚠️ RE-RUNNING IT IS HARMLESS, and that is required rather than hoped for:
  // React may discard a memo and recompute it, and StrictMode double-invokes the
  // factory. `installUserDefinitions` is idempotent by `installKey` (same id,
  // version and compute handle ⇒ no write, no generation bump) and
  // `clearUserDefinitions` returns early on an empty index, so a second run
  // costs a loop and changes nothing a consumer can observe.
  const { installedIds, errors } = useMemo(() => {
    if (key === '<refused>') {
      clearUserDefinitions()
      return { installedIds: [], errors: [] }
    }
    const docs = rows
      .map(r => r && r.definition)
      .filter(d => d && typeof d === 'object')
    const { installed, errors: installErrors } = installUserDefinitions(docs)
    return { installedIds: installed.map(d => d.id), errors: installErrors }
  }, [key, rows])

  return {
    installedIds,
    errors,
    // Read AFTER the install above, so a caller that depends on this number sees
    // the value the registry holds for the definitions this render just put
    // there — not the one it held before them.
    generation: registryGeneration(),
    isLoading,
    error: error || null,
    refresh,
  }
}

/**
 * Soft-delete. The store appends a TOMBSTONE version rather than removing
 * rows, so a `defId@version` pin still resolves afterwards.
 *
 * ⛔ IT ANSWERS THE STORE'S REFUSAL, NOT A BOOLEAN — and that is what makes a
 * caller able to say WHY. ⚰️ It used to `return r.ok`, which threw away every
 * sentence the store had just written: `"Not found"` for a definition that is
 * not yours, `require_paid`'s own 402 line for a lapsed plan. A surface handed a
 * boolean cannot honour this file's rule that the store's refusal sentence is
 * never rewritten here — it can only invent one, which is the second vocabulary
 * the header above forbids. `saveUserDefinition` has had this shape all along.
 *
 * ⚠️ THE REVALIDATION FIRES ON A REFUSAL TOO, deliberately and as before: a
 * request that was ANSWERED — even with a no — means the client's picture of
 * what exists is now a guess, and re-reading the store is how the row a member
 * still sees stays the store's claim rather than ours. Only a request that never
 * left (the `catch`) skips it, because nothing can have changed.
 *
 * @returns {Promise<{ok: true} | {ok: false, error: string}>} — never null, on
 *          any branch; `error` is a NON-BLANK string whenever `ok` is false,
 *          because a caller rendering it verbatim renders an alert that
 *          ANNOUNCES NOTHING otherwise, and a refusal a member cannot read is
 *          one they did not get.
 *
 * ⚰️ THAT GUARANTEE WAS PROSE AND THE CODE DID NOT HONOUR IT (review round 1).
 * The gate was `detail || <fallback>` — truthiness — so a store answering
 * `detail: "   "` produced `role="alert"` containing three spaces: announced by
 * a screen reader as nothing at all, and rendered on screen as a blank line
 * where the reason should be. A docstring stating the right principle over code
 * that does not is this wave's most repeated defect, and I wrote it thirty lines
 * above the line that broke it. The `.trim()` at the assignment is the fix, and
 * it is structural rather than a second check the next edit can forget.
 */
export async function deleteUserDefinition(defId) {
  let r
  try {
    r = await fetch(`${USER_DEFINITIONS_KEY}/${encodeURIComponent(defId)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  } catch {
    // ⛔ A TRANSPORT FAILURE AND A REFUSAL NEED DIFFERENT WORDS — the save door's
    // rule, one function up, for the same reason: one is "try again", the other
    // is "this cannot be done".
    return { ok: false, error: 'Could not reach the server — check your connection and try again.' }
  }
  mutate(USER_DEFINITIONS_KEY)
  // K3: a deleted definition may have been the last scannable one — same
  // revalidation as the save path above.
  mutate(META_KEY)
  if (r.ok) return { ok: true }
  let detail = ''
  try {
    const body = await r.json()
    // ⚠️ `detail` IS ONLY USED WHEN IT IS A STRING — FastAPI answers a
    // schema-invalid request with `detail: [{loc, msg, type}, …]`, and
    // interpolating that shows a member "[object Object]".
    // ⛔ AND TRIMMED HERE, not checked for later: see the docstring. A blank
    // `detail` must reach the `||` as '' or the fallback never fires.
    if (typeof body?.detail === 'string') detail = body.detail.trim()
  } catch { /* not JSON — an HTML error page, or an empty body */ }
  return { ok: false, error: detail || `The server refused to delete this formula (${r.status}).` }
}

/**
 * The share link for a definition — mint it, read it, or turn it off.
 *
 * ⛔⛔ `read` NEVER MINTS, AND THAT SPLIT IS THE WHOLE SAFETY STORY. The panel
 * asks on open; if that call could create a token, opening a panel would publish
 * a formula. The server enforces it too (`GET {id}/share` is read-only) — this is
 * the second lock, not the only one.
 *
 * ⚠️ EVERY BRANCH RETURNS `{ok, …}`, never null, and a refusal's `error` is a
 * non-blank string — the same contract `saveUserDefinition` states above, so a
 * caller never has to know which of the four doors it went through.
 */
async function shareCall(method, defId) {
  let r
  try {
    r = await fetch(`${USER_DEFINITIONS_KEY}/${encodeURIComponent(defId)}/share`, {
      method,
      credentials: 'include',
    })
  } catch {
    return { ok: false, error: 'Could not reach the server — check your connection and try again.' }
  }
  let body = null
  try { body = await r.json() } catch { /* not JSON */ }
  if (r.ok) return { ok: true, token: (body && body.token) || null }
  const detail = typeof body?.detail === 'string' ? body.detail.trim() : ''
  return { ok: false, error: detail || `The server refused that (${r.status}).` }
}

export const readShareLink = (defId) => shareCall('GET', defId)
export const createShareLink = (defId) => shareCall('POST', defId)
export const revokeShareLink = (defId) => shareCall('DELETE', defId)

/**
 * Preview a share link somebody sent you, WITHOUT installing it.
 *
 * ⛔⛔ THE REFUSAL REASON IS CARRIED THROUGH, not flattened into a message. The
 * server distinguishes `revoked` (the owner turned it off), `gone` (they deleted
 * it) and `table-version` (this engine's grammar moved, so the same formula could
 * now compute something else). A panel that showed one sentence for all three
 * would be unable to tell a member which of them they can do something about —
 * and only the last one has an action: ask the owner to re-share.
 */
export async function previewSharedDefinition(token) {
  let r
  try {
    r = await fetch(`${USER_DEFINITIONS_KEY}/shared/${encodeURIComponent(token)}`, {
      credentials: 'include',
    })
  } catch {
    return { ok: false, error: 'Could not reach the server — check your connection and try again.' }
  }
  let body = null
  try { body = await r.json() } catch { /* not JSON */ }
  if (r.ok) return { ok: true, shared: body }
  const d = body && body.detail
  if (d && typeof d === 'object' && typeof d.message === 'string') {
    return { ok: false, reason: d.reason || null, error: d.message }
  }
  return {
    ok: false,
    reason: null,
    error: typeof d === 'string' && d.trim()
      ? d.trim()
      : `That link could not be opened (${r.status}).`,
  }
}

/** Install a shared definition as your own copy. */
export async function installSharedDefinition(token) {
  let r
  try {
    r = await fetch(`${USER_DEFINITIONS_KEY}/shared/${encodeURIComponent(token)}/install`, {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    return { ok: false, error: 'Could not reach the server — check your connection and try again.' }
  }
  let body = null
  try { body = await r.json() } catch { /* not JSON */ }
  // ⚠️ REVALIDATE BOTH, exactly as the save and delete doors do: an install adds
  // a live definition, which changes the list AND may change whether the screener
  // has anything scannable to offer.
  mutate(USER_DEFINITIONS_KEY)
  mutate(META_KEY)
  if (r.ok) return { ok: true, row: body }
  const d = body && body.detail
  if (d && typeof d === 'object' && typeof d.message === 'string') {
    return { ok: false, reason: d.reason || null, error: d.message }
  }
  return {
    ok: false,
    reason: null,
    error: typeof d === 'string' && d.trim()
      ? d.trim()
      : `That formula could not be installed (${r.status}).`,
  }
}

/** Every stored version of one definition, oldest first — tombstones included. */
export async function fetchDefinitionHistory(defId) {
  let r
  try {
    r = await fetch(`${USER_DEFINITIONS_KEY}/${encodeURIComponent(defId)}/history`, {
      credentials: 'include',
    })
  } catch {
    return { ok: false, error: 'Could not reach the server — check your connection and try again.' }
  }
  let body = null
  try { body = await r.json() } catch { /* not JSON */ }
  if (r.ok) return { ok: true, versions: (body && body.versions) || [] }
  const detail = typeof body?.detail === 'string' ? body.detail.trim() : ''
  return { ok: false, error: detail || `The version history could not be read (${r.status}).` }
}
