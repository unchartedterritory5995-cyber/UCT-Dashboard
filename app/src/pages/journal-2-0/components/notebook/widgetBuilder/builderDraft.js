// Notebook widgets phase 2 (wave 8, Task 8.15): the builder's kept draft.
//
// One draft per member, in this browser only: `localStorage['uct.nb.widgetDraft.<uid>']` = `{v, at, plan,
// nameTouched, target, etag, session, pending}`. It is a CONVENIENCE (spec 5.2: "Keep your changes?" -> "Resume your unsaved widget"
// within 24 h), so every read and write is wrapped: a private window, blocked storage or a full quota loses the
// draft, never the builder. `target` is the widget being edited (its id), or null for a new one, so reopening a
// widget offers only its own draft and /build offers only a new widget's.
//
// `session` (fix 4, NEW-5) is the builder open that kept the draft. A save that lands AFTER its builder closed may
// settle only its own open's draft (`settleDraft`), never one a later open kept; and a later open holds its resume
// offer while the earlier open's save is still out (`saveInFlight`), so resuming can never save the same widget twice.
//
// `pending` (rulings R-43, R-48, R-49) is the open's one unconfirmed save that MAKES a widget (the create POST or a
// `save_new` PUT): `{key, kind, body, planKey, defId, etag}`, its `Idempotency-Key` and exactly what it sent. A reload
// ends `saveInFlight` with the page, so a draft resumed after one may belong to a request that landed; resuming sends
// that SAME request again under its key, and the server answers the widget it already made, never a second one. A key
// is never reused for anything else: a different payload under it is refused by the server.

import { isIdempotencyKey } from '../../../lib/builtWidgets'

export const DRAFT_PREFIX = 'uct.nb.widgetDraft.'
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
const VERSION = 1

const keyOf = (uid) => `${DRAFT_PREFIX}${uid ? String(uid) : 'me'}`
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The edits a draft (or the builder) holds, as one comparable value: the plan and whether the name was typed. */
export const draftKey = (plan, nameTouched) => JSON.stringify([plan, !!nameTouched])

/** A token for one builder open. Not `crypto.randomUUID`: that exists only in a secure context. */
export function newSession() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** An unconfirmed keyed save as kept (`{key, kind, body, planKey, defId, etag}`), or null when it is unreadable. */
export function pendingOf(p) {
  if (!isRecord(p) || !isIdempotencyKey(p.key) || !isRecord(p.body)) return null
  if (p.kind !== 'create' && p.kind !== 'save_new') return null
  if (p.kind === 'save_new' && (typeof p.defId !== 'string' || !p.defId)) return null
  return {
    key: p.key, kind: p.kind, body: p.body, planKey: typeof p.planKey === 'string' ? p.planKey : null,
    defId: p.kind === 'save_new' ? p.defId : null, etag: Number.isInteger(p.etag) ? p.etag : null,
  }
}

/** Keep the draft. `etag` is the widget's save sequence when the draft was kept (null for a new widget), so a
 *  resumed draft can tell that the widget changed since (fix 1, I-7). Answers whether the write landed. */
export function writeDraft(uid, { plan, nameTouched, target, etag = null, session = null, pending = null }, now = Date.now()) {
  try {
    window.localStorage.setItem(keyOf(uid), JSON.stringify({
      v: VERSION, at: now, plan, nameTouched: !!nameTouched, target: target || null,
      etag: Number.isInteger(etag) ? etag : null, session: typeof session === 'string' && session ? session : null,
      // R-43 / R-48: the open's unconfirmed save that makes a widget, sent again as-is on resume; null otherwise.
      pending: pendingOf(pending),
    }))
    return true
  } catch {
    return false
  }
}

/** The kept draft for `target` (a widget id, or null for a new widget) if it is under 24 h old, else null. An
 *  expired draft is removed as it is read. */
export function readDraft(uid, target = null, now = Date.now()) {
  let raw = null
  try { raw = window.localStorage.getItem(keyOf(uid)) } catch { return null }
  if (!raw) return null
  let d = null
  try { d = JSON.parse(raw) } catch { d = null }
  if (!isRecord(d) || d.v !== VERSION || !isRecord(d.plan) || typeof d.at !== 'number') return null
  if (now - d.at > DRAFT_TTL_MS || now < d.at - 60_000) {
    try { window.localStorage.removeItem(keyOf(uid)) } catch { /* nothing to clear */ }
    return null
  }
  if ((d.target || null) !== (target || null)) return null
  return d
}

// (A by-target `clearDraft` was removed in consolidation round 2: every clear is by session, `clearOwnDraft`, so a
// draft another open kept is never cleared by accident: rulings N1, R-47, M-3.)

/**
 * Remove the kept draft only when one of `sessions` kept it (consolidation, 8.16 N1). "Discard them" throws away the
 * member's OWN changes: those this open kept, or the draft it resumed. A draft another open kept, which this open
 * offered and the member never chose, stays (and is offered again).
 */
export function clearOwnDraft(uid, sessions) {
  const own = sessions instanceof Set ? sessions : new Set(sessions || [])
  try {
    const raw = window.localStorage.getItem(keyOf(uid))
    const d = raw ? JSON.parse(raw) : null
    if (!isRecord(d) || !own.has(typeof d.session === 'string' && d.session ? d.session : null)) return
    window.localStorage.removeItem(keyOf(uid))
  } catch { /* nothing to clear */ }
}

/** The session of the draft in the member's ONE slot when another open kept it (not one of `sessions`), else
 *  undefined. Keeping a draft replaces the slot, so the Keep question says so when it would replace another's (M-2). */
export function slotHeldByOther(uid, sessions) {
  const own = sessions instanceof Set ? sessions : new Set(sessions || [])
  try {
    const raw = window.localStorage.getItem(keyOf(uid))
    const d = raw ? JSON.parse(raw) : null
    if (!isRecord(d) || !isRecord(d.plan)) return undefined
    const s = typeof d.session === 'string' && d.session ? d.session : null
    return own.has(s) ? undefined : s
  } catch {
    return undefined
  }
}

/**
 * A save from the builder open `session` landed after that builder closed (fix 4, NEW-5). Only THAT open's draft is
 * touched; a draft another open kept since is never this save's to clear. When the draft holds exactly what was
 * saved (`savedKey`), it goes. When it holds edits made after the save went out, those edits now belong to the
 * saved widget: the draft is retargeted to it (`target`, `etag`), so resuming it edits that widget and never saves
 * a second one.
 */
export function settleDraft(uid, { session, savedKey, target, etag = null }) {
  if (typeof session !== 'string' || !session) return
  try {
    const raw = window.localStorage.getItem(keyOf(uid))
    const d = raw ? JSON.parse(raw) : null
    if (!isRecord(d) || d.session !== session) return
    if (draftKey(d.plan, d.nameTouched) === savedKey) {
      window.localStorage.removeItem(keyOf(uid))
      return
    }
    // Retargeted to the saved widget, the draft is an EDIT of it now: its keyed save landed and has done its job.
    window.localStorage.setItem(keyOf(uid), JSON.stringify({
      ...d, target: target || null, etag: Number.isInteger(etag) ? etag : null, pending: null,
    }))
  } catch { /* the draft stays as it was */ }
}

// The saves still out, by the builder open that sent them: each settles `{landed, id, name}` (`landed` false when the
// save failed; `id` and `name` are the widget it saved). In memory on purpose: a reload ends the save with the page,
// so nothing here can outlive what it describes (the POST's idempotency key covers the reload, ruling R-43).
const inFlight = new Map()

const settled = (got) => {
  if (!got?.ok) return { landed: false, id: null, name: '' }
  const data = isRecord(got.data) ? got.data : {}
  return {
    landed: true, id: typeof data.id === 'string' && data.id ? data.id : null,
    name: typeof data.name === 'string' ? data.name : '',
  }
}

/** Record `promise` (a save's answer) as the open `session`'s save in flight until it settles. */
export function trackSave(session, promise) {
  if (typeof session !== 'string' || !session) return promise
  const landed = Promise.resolve(promise).then(settled, () => settled(null))
  inFlight.set(session, landed)
  landed.then(() => { if (inFlight.get(session) === landed) inFlight.delete(session) })
  return promise
}

/** The save the open `session` still has out (a promise of `{landed, id, name}`), or null. */
export function saveInFlight(session) {
  return (typeof session === 'string' && inFlight.get(session)) || null
}

/** Tests only: what a page reload does to the registry (every save in flight is forgotten with the page). */
export function __forgetSavesInFlight() {
  inFlight.clear()
}
