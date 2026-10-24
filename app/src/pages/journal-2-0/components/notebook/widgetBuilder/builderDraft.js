// Notebook widgets phase 2 (wave 8, Task 8.15): the builder's kept draft.
//
// One draft per member, in this browser only: `localStorage['uct.nb.widgetDraft.<uid>']` = `{v, at, plan,
// nameTouched, target, etag}`. It is a CONVENIENCE (spec 5.2: "Keep your changes?" -> "Resume your unsaved widget"
// within 24 h), so every read and write is wrapped: a private window, blocked storage or a full quota loses the
// draft, never the builder. `target` is the widget being edited (its id), or null for a new one, so reopening a
// widget offers only its own draft and /build offers only a new widget's.

export const DRAFT_PREFIX = 'uct.nb.widgetDraft.'
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
const VERSION = 1

const keyOf = (uid) => `${DRAFT_PREFIX}${uid ? String(uid) : 'me'}`
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Keep the draft. `etag` is the widget's save sequence when the draft was kept (null for a new widget), so a
 *  resumed draft can tell that the widget changed since (fix 1, I-7). Answers whether the write landed. */
export function writeDraft(uid, { plan, nameTouched, target, etag = null }, now = Date.now()) {
  try {
    window.localStorage.setItem(keyOf(uid), JSON.stringify({
      v: VERSION, at: now, plan, nameTouched: !!nameTouched, target: target || null,
      etag: Number.isInteger(etag) ? etag : null,
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
