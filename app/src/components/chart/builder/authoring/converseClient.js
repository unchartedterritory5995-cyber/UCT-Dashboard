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
//           chart: {sym, tf}  (SLICE 2: the server's deterministic pre-flight)
// Response: {ok: true, disposition, reply, turn, envelope, not_understood, unavailable}
//         | {ok: false, gate, reason, disposition?, preflight?, not_understood?, unavailable?}
//
// ⭐ SLICE 2 — `disposition` (change | answer | clarify | unsupported) is the
// server's EXPLICIT word for what the turn is. A success without one is refused
// here: mutation is never inferred from which optional fields are present.
//
// ⛔ THE ENVELOPE IS RETURNED, NEVER APPLIED HERE. The caller hands it to the
// deterministic engine (`applyTurn`), which validates it atomically. Nothing
// the server sends is shown as a description of the indicator: the readback is
// computed from the resulting definition.

import { compactView } from './compactView'
import { isNamingClause } from './derivedName'

export const CONVERSE_ENDPOINT = '/api/user-definitions/converse'
/** The server's bounds (`definition_conversation.py`), mirrored so the client
 *  never sends a body the server must refuse for size. */
export const CONVERSE_LIMITS = Object.freeze({ maxMessage: 2000, maxSnippets: 6, maxSnippetChars: 1200 })
export const DISPOSITIONS = Object.freeze(['change', 'answer', 'clarify', 'unsupported'])

const NETWORK = 'Could not reach the server — check your connection and try again.'

/** Recent turns, language only, bounded exactly as the server bounds them. */
export function boundedSnippets(snippets) {
  return (Array.isArray(snippets) ? snippets : [])
    .filter((s) => s && (s.role === 'member' || s.role === 'assistant') && typeof s.text === 'string' && s.text.trim())
    .slice(-CONVERSE_LIMITS.maxSnippets)
    .map((s) => ({ role: s.role, text: s.text.slice(0, CONVERSE_LIMITS.maxSnippetChars) }))
}

/**
 * ⭐ P3 — one transcript entry as a recent-turn snippet (LANGUAGE ONLY). An
 * assistant entry carries the assistant's own REPLY first (answer AND change
 * replies — a follow-up like "why might that be better?" refers to it), then the
 * deterministic lines; a line equal to the reply is not repeated.
 */
export function snippetOf(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (entry.role === 'member') return { role: 'member', text: String(entry.text || '') }
  const reply = typeof entry.reply === 'string' ? entry.reply.trim() : ''
  const lines = (Array.isArray(entry.lines) ? entry.lines : []).filter((l) => typeof l === 'string' && l && l !== reply)
  return { role: 'assistant', text: [reply, ...lines].filter(Boolean).join(' · ') }
}

/** The last turns of a transcript as snippets (bounded again by `boundedSnippets`). */
export function transcriptSnippets(transcript) {
  return (Array.isArray(transcript) ? transcript : []).slice(-CONVERSE_LIMITS.maxSnippets).map(snippetOf).filter(Boolean)
}

/**
 * ⭐ P3 — the gaps worth a line of their own. A refusal whose `reason` IS one
 * not-understood item's reason (the planner's refusal) already says it: listing
 * that item again made the member read the same sentence twice.
 */
export function distinctNotUnderstood(res) {
  // ⭐ "call it Swing Line" is a NAME the authoring door keeps (derivedName.memberCueNames),
  // not an unsupported concept — never listed as "I didn't understand" (prod 2026-10-08).
  const items = ((res && Array.isArray(res.notUnderstood)) ? res.notUnderstood : [])
    .filter((n) => !(n && isNamingClause(String(n.clause || n.text || ''))))
  if (!res || res.ok !== false || typeof res.reason !== 'string') return items
  return items.filter((n) => !(n && n.reason && n.reason === res.reason))
}

/** The request body for one turn — exported so tests can pin the wire shape. */
export function converseBody({ message, state, gateCtx = {}, snippets = [] }) {
  const view = compactView(state.working, state, gateCtx)
  const body = {
    message: String(message || '').slice(0, CONVERSE_LIMITS.maxMessage),
    view,
    authoring: { assumptions: view.assumptions, openQuestions: view.openQuestions },
    snippets: boundedSnippets(snippets),
    chart: {
      ...(typeof gateCtx.symbol === 'string' && gateCtx.symbol ? { sym: gateCtx.symbol.slice(0, 24) } : {}),
      ...(typeof gateCtx.tf === 'string' && gateCtx.tf ? { tf: gateCtx.tf.slice(0, 24) } : {}),
    },
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
 * @returns {Promise<{ok: true, disposition: string, reply: string, turn: string, envelope: object, notUnderstood: object[], unavailable: object[]}
 *                 | {ok: false, gate: string, reason: string, disposition?: string, preflight?: boolean, notUnderstood: object[], unavailable: object[]}>}
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
      ...(body && body.disposition === 'unsupported' ? { disposition: 'unsupported' } : {}),
      ...(body && body.preflight === true ? { preflight: true } : {}),
      notUnderstood, unavailable,
    }
  }
  if (!body.envelope || typeof body.envelope !== 'object') {
    return { ok: false, gate: 'converse:no-envelope', reason: 'The assistant gave no change to apply.', notUnderstood, unavailable }
  }
  if (!DISPOSITIONS.includes(body.disposition)) {
    return { ok: false, gate: 'converse:no-disposition', reason: 'The assistant did not say what kind of answer this was, so nothing was changed.', notUnderstood, unavailable }
  }
  return {
    ok: true, disposition: body.disposition, reply: typeof body.reply === 'string' ? body.reply : '',
    turn: body.turn || null, envelope: body.envelope, notUnderstood, unavailable,
  }
}
