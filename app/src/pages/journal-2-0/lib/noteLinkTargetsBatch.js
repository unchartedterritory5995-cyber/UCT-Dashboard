/**
 * Wave D (Internal Links / Backlinks) — micro-batches per-id lookups from
 * every mounted `noteLink` node view into as few `GET
 * /api/j2/notes/link-targets` requests as possible.
 *
 * Each `noteLink` node view is an INDEPENDENT React component instance with
 * no direct knowledge of its siblings, so a naive per-node `useSWR(noteId)`
 * would cost one request per DISTINCT id on the page (directive §37/§65: a
 * note with 20 different links must not fire 20 requests). Rather than
 * plumb a shared id list through editor storage, every node view calls
 * `requestNoteLinkTarget(id)`, which queues the id and fires ONE bulk
 * request per short window (`BATCH_WINDOW_MS`) covering every id that asked
 * within it — in practice, every noteLink on a freshly-opened note resolves
 * in one request.
 *
 * Module-level cache, deliberately NOT invalidated on note save/restore
 * elsewhere in the app (a known, accepted limitation for this first
 * version): a target's title/trashed-status can go stale until the next
 * full page load if it changes in another tab while this one is open. Not
 * load-bearing for correctness (worst case: a stale but still-honest title
 * shows briefly) and cheap to fix later by wiring a cache-bust into the
 * existing save/restore success paths if it proves to matter.
 */

const BATCH_WINDOW_MS = 30

let pendingIds = new Set()
let timer = null
const cache = new Map() // id -> {title, status} | null (null = resolved-but-unavailable)
const listeners = new Set()

function notify() {
  for (const fn of listeners) fn()
}

function flush() {
  const ids = [...pendingIds]
  pendingIds = new Set()
  timer = null
  if (!ids.length) return
  const qs = ids.map(encodeURIComponent).join(',')
  fetch(`/api/j2/notes/link-targets?ids=${qs}`, { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : { targets: {} }))
    .then((body) => {
      const targets = body?.targets || {}
      for (const id of ids) cache.set(id, targets[id] || null)
      notify()
    })
    .catch(() => {
      for (const id of ids) cache.set(id, null)
      notify()
    })
}

/** Returns the cached result for `id`: `undefined` (not yet resolved, still
 * loading/queued), `null` (resolved -- unavailable/foreign/nonexistent), or
 * `{title, status}`. Queues a fetch as a side effect on a cache miss --
 * call from render is fine (idempotent: re-queuing an already-pending id is
 * a no-op via the Set). */
export function requestNoteLinkTarget(id) {
  if (!id) return null
  if (cache.has(id)) return cache.get(id)
  pendingIds.add(id)
  if (!timer) timer = setTimeout(flush, BATCH_WINDOW_MS)
  return undefined
}

/** Subscribe to "a batch resolved" — returns an unsubscribe fn. */
export function subscribeNoteLinkTargets(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Test-only: reset all module state between test files/cases. */
export function _resetNoteLinkTargetsBatchForTests() {
  pendingIds = new Set()
  if (timer) clearTimeout(timer)
  timer = null
  cache.clear()
  listeners.clear()
}
