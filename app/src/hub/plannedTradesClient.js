// app/src/hub/plannedTradesClient.js — the hub's client for `POST /api/hub/planned-trades`.
//
// Phase 2a shipped the backend and its rails with the header "⛔ NO CLIENT IS WIRED TO THIS
// YET." This is that client, and it is deliberately the ONLY place in the browser that knows
// the endpoint's URL and its wire shape.
//
// ⛔ THE BODY IS snake_case ON ONE KEY AND camelCase NOWHERE ELSE. `PlannedTradeCreate`
// (`api/routers/hub_planned_trades.py`) declares `symbol · entry · stop · size · source_mode`.
// Pydantic v2 has no alias generator on that model, so `sourceMode` is silently DROPPED rather
// than rejected — a plan stored with no idea which section it came from, and a 200 either way.
// That is why the mapping happens here once instead of at each call site.
//
// ⛔ `stop === entry` IS A 422, NOT A WARNING (router, same file). The sheet refuses it first so
// the member gets a sentence instead of a status code, but this client does NOT re-validate:
// a second opinion about what makes a plan valid is the defect this repo keeps re-finding, and
// the server's answer is the one that decides whether a row exists.

/** The endpoint, in one place. */
export const PLANNED_TRADES_URL = '/api/hub/planned-trades'

/**
 * The plan's SIDE — derived from entry vs stop, never stored and never passed in.
 *
 * ⭐ A CLIENT MIRROR OF `hub_planned_trades.side_of`, deliberately in the same module as the
 * request body it describes. A planned trade with a stop below its entry IS long by definition;
 * carrying a side alongside would let the two disagree, and then a row would exist that says
 * "Long" with a stop above the entry and nothing could say which field was wrong.
 *
 * @param {number} entry
 * @param {number} stop
 * @returns {'Long'|'Short'}
 */
export function planSideOf(entry, stop) {
  return Number(stop) < Number(entry) ? 'Long' : 'Short'
}

/**
 * The request body, EXACTLY as the Pydantic model declares it.
 *
 * Exported so a test can assert the wire shape without a fetch — the half of this module that
 * can be wrong silently.
 *
 * @param {{symbol: string, entry: number, stop: number, size: number, sourceMode?: string|null}} plan
 * @returns {{symbol: string, entry: number, stop: number, size: number, source_mode: string|null}}
 */
export function plannedTradeBody({ symbol, entry, stop, size, sourceMode = null }) {
  return {
    symbol: String(symbol ?? '').trim().toUpperCase(),
    entry: Number(entry),
    stop: Number(stop),
    size: Number(size),
    source_mode: sourceMode == null ? null : String(sourceMode),
  }
}

/**
 * Create one planned trade. Resolves with the created row; rejects with the server's own
 * `detail` string when there is one.
 *
 * ⭐ The server's message is carried through verbatim rather than replaced with "Couldn't save".
 * Its 422s say something a member can act on ("stop must differ from entry …"); a generic
 * failure toast would throw that away and leave them guessing which field was wrong.
 *
 * @param {Parameters<typeof plannedTradeBody>[0]} plan
 * @param {{fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<object>}
 */
export async function createPlannedTrade(plan, opts = {}) {
  const doFetch = opts.fetchImpl || globalThis.fetch
  const res = await doFetch(PLANNED_TRADES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(plannedTradeBody(plan)),
  })
  if (!res.ok) {
    let message = `${res.status}`
    try {
      const data = await res.json()
      if (data && data.detail) message = String(data.detail)
    } catch {
      // A non-JSON error body (an HTML 502 from the edge) — the status code is all there is.
    }
    throw new Error(message)
  }
  return res.json()
}

/** The default client the sheet uses in the app; tests inject a fake with the same shape. */
export const plannedTradesClient = { create: createPlannedTrade }

export default plannedTradesClient
