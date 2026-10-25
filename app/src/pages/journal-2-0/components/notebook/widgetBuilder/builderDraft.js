// Notebook widgets phase 2 (wave 8, Task 8.15): the builder's kept draft.
//
// One draft per member, in this browser only: `localStorage['uct.nb.widgetDraft.<uid>']` = `{v, at, plan,
// nameTouched, target, etag, session, key}`. It is a CONVENIENCE (spec 5.2: "Keep your changes?" -> "Resume your unsaved widget"
// within 24 h), so every read and write is wrapped: a private window, blocked storage or a full quota loses the
// draft, never the builder. `target` is the widget being edited (its id), or null for a new one, so reopening a
// widget offers only its own draft and /build offers only a new widget's.
//
// `session` (fix 4, NEW-5) is the builder open that kept the draft. A save that lands AFTER its builder closed may
// settle only its own open's draft (`settleDraft`), never one a later open kept; and a later open holds its resume
// offer while the earlier open's save is still out (`saveInFlight`), so resuming can never save the same widget twice.
//
// `key` (ruling R-43) is the create key of the widget the open is creating (new, or a copy of a ready-made or gone
// one): the `Idempotency-Key` it sent (or will send) on the create POST. A draft kept as an edit carries none. A reload ends `saveInFlight` with the page, so a draft resumed after one may belong to a POST that
// landed; resuming re-sends the same key, and the server answers the widget it already made, never a second one.

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

/** The create POST's `Idempotency-Key` (ruling R-43): a uuid4, made once for the widget a builder open is creating and
 *  kept in its draft, so a POST re-sent after a reload answers the widget it already made. Built from
 *  `crypto.getRandomValues` (available outside a secure context, unlike `crypto.randomUUID`); `Math.random` only where
 *  there is no `crypto` at all. */
export function newCreateKey() {
  const b = new Uint8Array(16)
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40          // version 4
  b[8] = (b[8] & 0x3f) | 0x80          // the RFC 4122 variant
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const CREATE_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
/** A kept draft's create key, or null when it has none (or an unreadable one). */
export const createKeyOf = (d) => (isRecord(d) && typeof d.key === 'string' && CREATE_KEY_RE.test(d.key) ? d.key : null)

/** Keep the draft. `etag` is the widget's save sequence when the draft was kept (null for a new widget), so a
 *  resumed draft can tell that the widget changed since (fix 1, I-7). Answers whether the write landed. */
export function writeDraft(uid, { plan, nameTouched, target, etag = null, session = null, key = null }, now = Date.now()) {
  try {
    window.localStorage.setItem(keyOf(uid), JSON.stringify({
      v: VERSION, at: now, plan, nameTouched: !!nameTouched, target: target || null,
      etag: Number.isInteger(etag) ? etag : null, session: typeof session === 'string' && session ? session : null,
      // R-43: the create key of the widget this open is creating (a new one, or a copy); null for an edit.
      key: typeof key === 'string' && CREATE_KEY_RE.test(key) ? key : null,
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

/** Remove the kept draft. With `target` (a widget id, or null for a new widget) only that widget's draft goes,
 *  so saving one widget never throws away another's unsaved work. */
export function clearDraft(uid, target) {
  try {
    if (target !== undefined) {
      const d = JSON.parse(window.localStorage.getItem(keyOf(uid)) || 'null')
      if (isRecord(d) && (d.target || null) !== (target || null)) return
    }
    window.localStorage.removeItem(keyOf(uid))
  } catch { /* nothing to clear */ }
}

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
    // Retargeted to the saved widget, the draft is an EDIT of it now: its create key has done its job.
    window.localStorage.setItem(keyOf(uid), JSON.stringify({
      ...d, target: target || null, etag: Number.isInteger(etag) ? etag : null, key: target ? null : d.key ?? null,
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
