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

/** From this share of the limit the composer shows the count. */
export const LENGTH_NOTE_FROM = 0.8

/**
 * ⭐ 2026-11-25 -- the composer's own count of a message against the server's limit, so a member knows before sending.
 * null below `LENGTH_NOTE_FROM` of the limit; `{over, text}` from there. Nothing is ever shortened: over the limit the
 * message is still sent whole and the server refuses it in the member's words.
 */
export function messageLengthNote(message) {
  const n = String(message || '').length
  const max = CONVERSE_LIMITS.maxMessage
  if (n < Math.floor(max * LENGTH_NOTE_FROM)) return null
  const fmt = (x) => x.toLocaleString('en-US')
  return n > max
    ? { over: true, text: `${fmt(n)} characters: the limit is ${fmt(max)}. Shorten it to send it.` }
    : { over: false, text: `${fmt(n)} of ${fmt(max)} characters` }
}

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

/**
 * ⭐ 2026-11-17 — THE BROWSER'S OWN REFUSAL, SENT BACK FOR ONE REPAIR. The door checks a patch's
 * structure; this engine applies it and holds rules of its own, so the door can offer a patch the
 * engine then refuses ("Nothing was changed" for a request the assistant had built). The turn is
 * sent once more with the refused patch and the engine's own words (`definition_conversation.
 * browser_refusal` decides whether to use them); the model's repair is spent on that.
 * The bounds are the server's (`BROWSER_REFUSAL_MAX_ERRORS`, `BROWSER_REFUSAL_MAX_CHARS`).
 */
export const BROWSER_REFUSAL_LIMITS = Object.freeze({ maxErrors: 4, maxChars: 300 })

/** `{envelope, errors}` as it goes on the wire, or null when there is nothing usable to send. */
export function browserRefusalBlock(refusal) {
  if (!refusal || typeof refusal !== 'object' || !refusal.envelope || typeof refusal.envelope !== 'object') return null
  const errors = (Array.isArray(refusal.errors) ? refusal.errors : [])
    .filter((e) => typeof e === 'string' && e.trim())
    .slice(0, BROWSER_REFUSAL_LIMITS.maxErrors)
    .map((e) => e.replace(/\s+/g, ' ').trim().slice(0, BROWSER_REFUSAL_LIMITS.maxChars))
  return errors.length ? { envelope: refusal.envelope, errors } : null
}

/**
 * What THIS build of the browser accepts beyond the first contract, told to the door on every turn.
 * The door adds an optional field to its answer only for a browser that names it here, so a tab
 * still running an older build never meets a field its own validator refuses.
 *   note.by: a note may say who wrote it (`by: "uct"`).
 *   offer:   an answer may carry one action to take with one tap (`builtInOffer.js`).
 */
export const ACCEPTS = Object.freeze(['note.by', 'offer'])

/**
 * ⭐ `script`: an answer may BE a Pine script. ⛔ NOT every sender of this build accepts one: only a
 * window that puts the script through its own engine and SHOWS it and its verdict (`scriptAnswer.js`).
 * A sender says so with `gateCtx.showsScripts === true`; with anything else the word is not sent and
 * the door answers with the formula turn it always gave.
 * ⚰️ 2026-11-19, found live while the lane was admin-only: this word was in `ACCEPTS`, so the builder's
 * own "Describe it" box (`ConverseBox`) and the UCT Agent door told the door they accept a script.
 * Neither shows one: an admin there read "This draws a zigzag ..." about a script that was nowhere
 * on the screen. The senders that show one are held by `scriptAccepts.test.js`.
 */
export const ACCEPTS_SCRIPT = 'script'

/** The bounds the server reads `addable` under (`definition_conversation.BUILT_INS_MAX`). */
export const BUILT_INS_LIMITS = Object.freeze({ max: 40, maxChars: 64 })

/** The built-in indicator ids to tell the door this window can add (from `gateCtx.builtIns`). */
export function builtInIds(list) {
  return (Array.isArray(list) ? list : [])
    .filter((id) => typeof id === 'string' && id && id.length <= BUILT_INS_LIMITS.maxChars)
    .slice(0, BUILT_INS_LIMITS.max)
}

/** The request body for one turn — exported so tests can pin the wire shape. */
export function converseBody({ message, state, gateCtx = {}, snippets = [], browserRefusal = null, scriptRefusal = null }) {
  const view = compactView(state.working, state, gateCtx)
  const body = {
    // ⛔ 2026-11-25 -- THE MESSAGE GOES WHOLE, NEVER SHORTENED HERE. This line was `.slice(0, maxMessage)`: any
    // request over the limit was CUT before it left the window, the member saw their whole paste in the transcript,
    // and the assistant answered the first 2,000 characters as if they were all of it (measured: two pasted Deepvue
    // indicators of 3,262 and 2,039 characters were answered from cut code). The server is the one authority on
    // the limit and says so in the member's words ("your request is N characters; the limit is 2,000"); the
    // composer counts as the member types (`messageLengthNote`).
    message: String(message || ''),
    view,
    accepts: [...ACCEPTS, ...(gateCtx && gateCtx.showsScripts === true ? [ACCEPTS_SCRIPT] : [])],
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
  const refused = browserRefusalBlock(browserRefusal)
  if (refused) body.browser_refusal = refused
  // ⭐ which of UCT's own built-in indicators this window can add to the chart right now: the
  // door offers to add one only when its id is here (omitted when there is none)
  const builtIns = builtInIds(gateCtx.builtIns)
  if (builtIns.length) body.addable = builtIns
  // ⭐ this window's own engine refused a script the door offered for this request: the script
  // and the engine's words go back for a repair (`scriptAnswer.refusalOf`)
  const refusedScript = scriptRefusalBlock(scriptRefusal)
  if (refusedScript) body.script_refusal = refusedScript
  return body
}

/** The server's accepted shape (`definition_conversation._CONVERSATION_ID`). */
export const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

/**
 * One conversational turn. NEVER throws.
 * @returns {Promise<{ok: true, disposition: string, reply: string, turn: string, envelope: object, notUnderstood: object[], unavailable: object[]}
 *                 | {ok: false, gate: string, reason: string, disposition?: string, preflight?: boolean, notUnderstood: object[], unavailable: object[]}>}
 */
/** The gate of a turn the MEMBER stopped waiting for (`signal` aborted). Not a failure. */
export const STOPPED_GATE = 'client:stopped'

/** `Retry-After` as whole seconds, or null when the header is absent or not a count. */
function retryAfterOf(r) {
  try {
    const raw = r && r.headers && typeof r.headers.get === 'function' ? r.headers.get('Retry-After') : null
    const n = raw == null || raw === '' ? NaN : Number(raw)
    return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null
  } catch { return null }
}

export async function converseTurn({ message, state, gateCtx = {}, snippets = [], fetchImpl = null, signal = null, browserRefusal = null, scriptRefusal = null }) {
  const doFetch = fetchImpl || globalThis.fetch
  let r
  try {
    r = await doFetch(CONVERSE_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(converseBody({ message, state, gateCtx, snippets, browserRefusal, scriptRefusal })),
      ...(signal ? { signal } : {}),
    })
  } catch {
    // The member pressed Stop: the browser gave up the request. The server may still
    // finish the turn; nothing it returns is read.
    if (signal && signal.aborted) return { ok: false, gate: STOPPED_GATE, reason: '', notUnderstood: [], unavailable: [] }
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
      : (detail || `The UCT Agent could not answer (${status}).`)
    const retryAfterS = status === 429 ? retryAfterOf(r) : null
    return { ok: false, gate: `http:${status}`, reason, notUnderstood: [], unavailable: [],
      ...(retryAfterS ? { retryAfterS } : {}) }
  }
  let body
  try { body = await r.json() } catch { body = null }
  const notUnderstood = (body && Array.isArray(body.not_understood)) ? body.not_understood : []
  const unavailable = (body && Array.isArray(body.unavailable)) ? body.unavailable : []
  if (!body || body.ok === false) {
    return {
      ok: false,
      gate: (body && body.gate) || 'converse:unreadable',
      reason: (body && typeof body.reason === 'string' && body.reason) || 'The UCT Agent gave no usable answer.',
      ...(body && body.disposition === 'unsupported' ? { disposition: 'unsupported' } : {}),
      ...(body && body.preflight === true ? { preflight: true } : {}),
      notUnderstood, unavailable,
      ...allowanceOf(body),
    }
  }
  if (!body.envelope || typeof body.envelope !== 'object') {
    return { ok: false, gate: 'converse:no-envelope', reason: 'The UCT Agent gave no change to apply.', notUnderstood, unavailable }
  }
  if (!DISPOSITIONS.includes(body.disposition)) {
    return { ok: false, gate: 'converse:no-disposition', reason: 'The UCT Agent did not say what kind of answer this was, so nothing was changed.', notUnderstood, unavailable }
  }
  return {
    ok: true, disposition: body.disposition, reply: typeof body.reply === 'string' ? body.reply : '',
    turn: body.turn || null, envelope: body.envelope, notUnderstood, unavailable,
    ...allowanceOf(body),
    ...offerOf(body),
    ...scriptOf(body),
  }
}

/** The bounds of a script answer and of its refusal (`pine_authoring.SCRIPT_MAX_CHARS`,
 *  `script_conversation.REFUSAL_MAX_*`). */
export const SCRIPT_LIMITS = Object.freeze({ maxChars: 24000, maxName: 60, maxErrors: 6, maxErrorChars: 300 })

/** ⭐ The script an answer IS, as the server sent it: text, a name and the repair round. What it
 *  is worth is the engine's to say (`scriptAnswer.checkScript`), never this function's. */
export function scriptOf(body) {
  const s = body && body.script
  if (!s || typeof s !== 'object' || typeof s.pine !== 'string' || !s.pine.trim()) return {}
  if (s.pine.length > SCRIPT_LIMITS.maxChars) return {}
  return { script: {
    pine: s.pine,
    name: typeof s.name === 'string' ? s.name.slice(0, SCRIPT_LIMITS.maxName) : '',
    round: Number.isInteger(s.round) && s.round >= 0 ? s.round : 0,
    // (only when true: the server's detector says this script reads where the chart ends. What that means on
    // this chart depends on the lane that draws it, which only the window knows: `scriptAnswer.scriptEntry`)
    ...(s.waits_for_the_bar === true ? { waitsForTheBar: true } : {}),
    ...admissionOf(s.admission),
  } }
}

/** The bounds of the admission verdict a script answer may carry (`POST .../runtime-admission`'s own body). */
export const ADMISSION_LIMITS = Object.freeze({ maxIds: 32, maxIdChars: 80 })

/**
 * ⭐ THE ADMISSION VERDICT, IN THE ANSWER (2026-11-19). The chart may draw a script bar by bar only once the server
 * has said so. Asked afterwards, that question could wait behind other members' traffic and the answer read "still
 * being checked". The server now sends the verdict WITH the script: `{sha256, admitted, missing, historyOnly?}`,
 * the body its own door answers. Kept only when it is well formed; what it is worth, and whether it is THIS
 * script's, is decided where it is latched (`scriptAnswer.js`, by the script's own hash).
 */
export function admissionOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  if (typeof raw.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(raw.sha256) || typeof raw.admitted !== 'boolean') return {}
  const ids = (list) => Array.isArray(list) && list.length <= ADMISSION_LIMITS.maxIds
    && list.every((x) => typeof x === 'string' && x.length > 0 && x.length <= ADMISSION_LIMITS.maxIdChars)
  if (!ids(raw.missing)) return {}
  if (raw.historyOnly !== undefined && !ids(raw.historyOnly)) return {}
  return { admission: {
    sha256: raw.sha256.toLowerCase(), admitted: raw.admitted, missing: [...raw.missing],
    ...(raw.historyOnly !== undefined ? { historyOnly: [...raw.historyOnly] } : {}),
  } }
}

/** `{pine, errors, round}` as it goes on the wire, or null when there is nothing usable to send. */
export function scriptRefusalBlock(refusal) {
  if (!refusal || typeof refusal !== 'object' || typeof refusal.pine !== 'string' || !refusal.pine) return null
  if (refusal.pine.length > SCRIPT_LIMITS.maxChars) return null
  const errors = (Array.isArray(refusal.errors) ? refusal.errors : [])
    .filter((e) => typeof e === 'string' && e.trim())
    .slice(0, SCRIPT_LIMITS.maxErrors)
    .map((e) => e.replace(/[ \t\r\n]+/g, ' ').trim().slice(0, SCRIPT_LIMITS.maxErrorChars))
  if (!errors.length) return null
  return { pine: refusal.pine, errors, round: Number.isInteger(refusal.round) && refusal.round >= 1 ? refusal.round : 1 }
}

/** The settings an offer carries (one setting of a built-in), as a small map of short words, or
 *  null when what was sent is anything else. */
export const OFFER_INPUTS_LIMITS = Object.freeze({ max: 4, maxChars: 40 })
function offerInputs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const pairs = Object.entries(raw)
  const short = (s) => typeof s === 'string' && s.length > 0 && s.length <= OFFER_INPUTS_LIMITS.maxChars
  if (!pairs.length || pairs.length > OFFER_INPUTS_LIMITS.max || !pairs.every(([k, v]) => short(k) && short(v))) return null
  return Object.fromEntries(pairs)
}

/** ⭐ The one action an answer offers, as the server sent it (kind and indicator id, and the
 *  settings of an offer that is one setting of a built-in; what it means here is
 *  `builtInOffer.liveOffer`'s to say). Anything else is no offer. ⛔ An offer whose `inputs` do
 *  not read is NO offer, never the same offer without them: adding the built-in without its
 *  setting would add something other than what the answer said. */
export function offerOf(body) {
  const o = body && body.offer
  if (!o || typeof o !== 'object' || typeof o.kind !== 'string' || typeof o.indicator !== 'string') return {}
  if (!o.indicator || o.indicator.length > BUILT_INS_LIMITS.maxChars || o.kind.length > 40) return {}
  if (!('inputs' in o)) return { offer: { kind: o.kind, indicator: o.indicator } }
  const inputs = offerInputs(o.inputs)
  return inputs ? { offer: { kind: o.kind, indicator: o.indicator, inputs } } : {}
}

/** ⭐ F1: the share of today's allowance left (0 to 1) when the server sent one. */
export function allowanceOf(body) {
  const v = body && body.allowance_left
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? { allowanceLeft: v } : {}
}
