// app/src/components/chart/builder/authoring/converseClient.js
//
// ─── ⭐ P2 — THE ONE CLIENT CALL INTO THE CONVERSATIONAL ENDPOINT ────────────
//
// ISOLATED ON PURPOSE: this is the only file that knows the route and the wire
// shape of `POST /api/user-definitions/converse` (server slice "p2/server",
// `api/routers/user_definitions.py::converse_definition`). The integrator
// reconciles here and nowhere else.
//
// Request : {message, view: compactView(working, state, gateCtx),
//            authoring: {assumptions, openQuestions}, snippets: [{role, text}]}
// Response: {ok: true, turn, envelope, not_understood, unavailable}
//         | {ok: false, gate, reason, not_understood?, unavailable?}
//
// ⛔ THE ENVELOPE IS RETURNED, NEVER APPLIED HERE. The caller hands it to the
// deterministic engine (`applyTurn`), which validates it atomically. Nothing
// the server sends is shown as a description of the indicator: the readback is
// computed from the resulting definition.

import { compactView } from './compactView'

export const CONVERSE_ENDPOINT = '/api/user-definitions/converse'
/** The server's bounds (`definition_conversation.py`), mirrored so the client
 *  never sends a body the server must refuse for size. */
export const CONVERSE_LIMITS = Object.freeze({ maxMessage: 2000, maxSnippets: 6, maxSnippetChars: 400 })

const NETWORK = 'Could not reach the server — check your connection and try again.'

/** Recent turns, language only, bounded exactly as the server bounds them. */
export function boundedSnippets(snippets) {
  return (Array.isArray(snippets) ? snippets : [])
    .filter((s) => s && (s.role === 'member' || s.role === 'assistant') && typeof s.text === 'string' && s.text.trim())
    .slice(-CONVERSE_LIMITS.maxSnippets)
    .map((s) => ({ role: s.role, text: s.text.slice(0, CONVERSE_LIMITS.maxSnippetChars) }))
}

/** The request body for one turn — exported so tests can pin the wire shape. */
export function converseBody({ message, state, gateCtx = {}, snippets = [] }) {
  const view = compactView(state.working, state, gateCtx)
  const body = {
    message: String(message || '').slice(0, CONVERSE_LIMITS.maxMessage),
    view,
    authoring: { assumptions: view.assumptions, openQuestions: view.openQuestions },
    snippets: boundedSnippets(snippets),
  }
  // ⭐ COST TELEMETRY ONLY — the conversation's opaque identity is its authoring
  // LINEAGE (`authoringState.mintLineage`: `auth_` + random hex, minted per
  // conversation, kept across the post-save reopen, fresh for a new one). It holds
  // no user data, no formula and no message text, and the server never treats it
  // as authorization or ownership: it only keys the per-conversation usage total
  // (`definition_conversation.conversation_usage`). Omitted when not well-formed.
  const id = state && state.lineage
  if (typeof id === 'string' && CONVERSATION_ID_RE.test(id)) body.conversationId = id
  return body
}

/** The server's accepted shape (`definition_conversation._CONVERSATION_ID`). */
export const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

/**
 * One conversational turn. NEVER throws.
 * @returns {Promise<{ok: true, turn: string, envelope: object, notUnderstood: object[], unavailable: object[]}
 *                 | {ok: false, gate: string, reason: string, notUnderstood: object[], unavailable: object[]}>}
 */
export async function converseTurn({ message, state, gateCtx = {}, snippets = [], fetchImpl = null }) {
  const doFetch = fetchImpl || globalThis.fetch
  let r
  try {
    r = await doFetch(CONVERSE_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(converseBody({ message, state, gateCtx, snippets })),
    })
  } catch {
    return { ok: false, gate: 'network', reason: NETWORK, notUnderstood: [], unavailable: [] }
  }
  if (!r || !r.ok) {
    const status = r ? r.status : 0
    let detail = ''
    try {
      const body = await r.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch { /* not JSON */ }
    const reason = status === 402 ? 'Custom indicators require a paid plan.'
      : (detail || `The assistant could not answer (${status}).`)
    return { ok: false, gate: `http:${status}`, reason, notUnderstood: [], unavailable: [] }
  }
  let body
  try { body = await r.json() } catch { body = null }
  const notUnderstood = (body && Array.isArray(body.not_understood)) ? body.not_understood : []
  const unavailable = (body && Array.isArray(body.unavailable)) ? body.unavailable : []
  if (!body || body.ok === false) {
    return {
      ok: false,
      gate: (body && body.gate) || 'converse:unreadable',
      reason: (body && typeof body.reason === 'string' && body.reason) || 'The assistant gave no usable answer.',
      notUnderstood, unavailable,
    }
  }
  if (!body.envelope || typeof body.envelope !== 'object') {
    return { ok: false, gate: 'converse:no-envelope', reason: 'The assistant gave no change to apply.', notUnderstood, unavailable }
  }
  return { ok: true, turn: body.turn || null, envelope: body.envelope, notUnderstood, unavailable }
}
