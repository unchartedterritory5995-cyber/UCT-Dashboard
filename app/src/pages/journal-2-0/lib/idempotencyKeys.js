// Notebook widgets phase 2 (Task 9.6c): the ONE idempotency-key helper (rulings R-43, R-48, R-49, R-50, W9-R48).
//
// Lifted out of lib/builtWidgets (which re-exports every name below, so its callers are unchanged) so that
// lib/toolsCrud's routine and tracker Duplicate uses the SAME generator and the SAME per-intent rule as the widget
// doors. ⛔ There is no second key generator in the Notebook: a new keyed door imports from here.
// ⛔ LAZY like its two importers: it is reached only from builtWidgets and toolsCrud, both lazy.

/** A uuid4 for one request's `Idempotency-Key`. Built from `crypto.getRandomValues` (available outside a secure context,
 *  unlike `crypto.randomUUID`); `Math.random` only where there is no `crypto` at all. */
export function newIdempotencyKey() {
  const b = new Uint8Array(16)
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40          // version 4
  b[8] = (b[8] & 0x3f) | 0x80          // the RFC 4122 variant
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const IDEMPOTENCY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
/** Whether `k` is a key this client makes (the server's own check is the same shape). */
export const isIdempotencyKey = (k) => typeof k === 'string' && IDEMPOTENCY_KEY_RE.test(k)

/** The server's answer settles what happened to a request: it landed, or it was refused. Only a lost answer (no status:
 *  the network, a timeout) or a bare 5xx from in front of the app leaves it unknown, and only then may the same request
 *  be sent again under the same key. This reads builtWidgets' answer shape (`{ok, code, status}`, `code: 'failed'` for
 *  an unreadable answer); a caller with another shape passes its own `confirmed` to keyedSender. */
export const outcomeConfirmed = (got) => !!got && (got.ok
  || (Number.isInteger(got.status) && (got.status < 500 || got.code !== 'failed')))

/**
 * One keyed request per member intent (ruling R-50, for the doors that have no draft: My tools, and W9-R48 the routine
 * and tracker Duplicate). `send(intent, body, fetchWith)` sends `fetchWith(key)` under the intent's key: the SAME key
 * while that intent's earlier request is unconfirmed and carried the same body (a retry after a lost answer, so the
 * server replays it), else a fresh one. A confirmed answer ends the intent, so the next press is a new intent with a new
 * key. `confirmed(got)` decides what settled an answer (default outcomeConfirmed).
 */
export function keyedSender({ confirmed = outcomeConfirmed } = {}) {
  const pending = new Map()
  return async (intent, body, fetchWith) => {
    const same = JSON.stringify(body ?? {})
    let p = pending.get(intent)
    if (!p || p.same !== same) p = { key: newIdempotencyKey(), same }
    pending.set(intent, p)
    const got = await fetchWith(p.key)
    if (confirmed(got) && pending.get(intent) === p) pending.delete(intent)
    return got
  }
}
