/**
 * UCT News Research Library — the page's ONE copy of the member's bookmarks and
 * collections (/api/trade-exchange-news/library/*).
 *
 * Every News widget marks saved rows from it and every Research Library widget lists
 * from it, so a save in one is seen by all at once. It is the member's server state:
 * re-read when the tab regains focus (another device may have changed it) and told to
 * the page's other tabs (BroadcastChannel), so it persists across sessions and devices.
 *
 * Saving never touches the live feed: a click is an optimistic local change plus one
 * request; a refusal rolls the change back and says why. The headlines themselves are
 * never changed by anything here — removing a bookmark removes only the member's
 * reference, note and collection places (the server's library.py).
 */
export const LIB_URL = '/api/trade-exchange-news/library'
const FOCUS_REFRESH_MS = 15_000
const CHANNEL = 'uct-news-library'

let _state = { status: 'idle', ids: new Set(), collections: [], limits: null, error: null, version: 0 }
const _listeners = new Set()
let _loading = null
let _lastLoad = 0
let _channel = null
let _wired = false

function emit(next) {
  _state = { ..._state, ...next, version: _state.version + 1 }
  for (const fn of [..._listeners]) fn(_state)
}

function tellOtherTabs() {
  try { _channel?.postMessage({ type: 'changed' }) } catch { /* a closed channel is harmless */ }
}

function wire() {
  if (_wired || typeof window === 'undefined') return
  _wired = true
  const onFocus = () => { if (Date.now() - _lastLoad > FOCUS_REFRESH_MS) load({ force: true }) }
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onFocus() })
  try {
    _channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null
    if (_channel) _channel.onmessage = () => load({ force: true })
  } catch { _channel = null }
}

export function subscribe(fn) {
  _listeners.add(fn)
  wire()
  if (_state.status === 'idle') load()
  return () => _listeners.delete(fn)
}
export const getSnapshot = () => _state

async function call(method, path, body) {
  let r
  try {
    r = await fetch(`${LIB_URL}${path}`, {
      method, credentials: 'include', cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    return { ok: false, status: 0, body: { detail: 'Could not reach UCT — check your connection and try again.' } }
  }
  let out = null
  try { out = await r.json() } catch { /* a non-JSON answer: the status speaks */ }
  if (!r.ok && !out?.detail) out = { ...(out || {}), detail: r.status === 401 ? 'Sign in to UCT to use your library.' : 'That did not save. Try again.' }
  return { ok: r.ok, status: r.status, body: out }
}

/** Re-read the saved ids and collections (deduplicated; `force` skips the cache). */
export function load({ force = false } = {}) {
  if (_loading) return _loading
  if (!force && _state.status === 'ready') return Promise.resolve(_state)
  if (_state.status === 'idle') emit({ status: 'loading' })
  _loading = (async () => {
    const r = await call('GET', '/state')
    _lastLoad = Date.now()
    if (r.ok) emit({ status: 'ready', ids: new Set(r.body.ids || []), collections: r.body.collections || [], limits: r.body.limits || null, error: null })
    else emit({ status: _state.status === 'ready' ? 'ready' : 'error', error: r.body.detail })
    return _state
  })().finally(() => { _loading = null })
  return _loading
}

export const isSaved = (id) => _state.ids.has(id)

function setIds(fn) {
  const ids = new Set(_state.ids)
  fn(ids)
  emit({ ids })
}

/** Save one headline. -> { ok, error? }. Optimistic; rolled back on a refusal. */
export async function save(id, restore = null) {
  const had = _state.ids.has(id)
  setIds((s) => s.add(id))
  const r = await call('PUT', `/bookmarks/${encodeURIComponent(id)}`, restore || {})
  if (!r.ok) {
    if (!had) setIds((s) => s.delete(id))
    return { ok: false, error: r.body.detail }
  }
  // An Undo moves collection counts, and a story saved under another of its delivery ids
  // (a rebuild changed its first) answers that id: re-read so every row's mark is right.
  if (restore || r.body.bookmark?.event_id !== id) await load({ force: true })
  tellOtherTabs()
  return { ok: true, bookmark: r.body.bookmark }
}

/** Remove one bookmark. -> { ok, removed } where `removed` is what Undo restores. */
export async function remove(id) {
  const had = _state.ids.has(id)
  setIds((s) => s.delete(id))
  const r = await call('DELETE', `/bookmarks/${encodeURIComponent(id)}`)
  if (!r.ok) {
    if (had) setIds((s) => s.add(id))
    return { ok: false, error: r.body.detail }
  }
  const removed = r.body.removed
  if (removed && (removed.collection_ids?.length || removed.event_id !== id)) await load({ force: true })
  tellOtherTabs()
  return { ok: true, removed: r.body.removed }
}

/** Put back exactly what `remove` answered (its note, collections and saved time). */
export function undoRemove(removed) {
  if (!removed?.event_id) return Promise.resolve({ ok: false })
  return save(removed.event_id, {
    note: removed.note, note_updated_at_ms: removed.note_updated_at_ms,
    collection_ids: removed.collection_ids, saved_at_ms: removed.saved_at_ms,
  })
}

export async function toggle(id) {
  return _state.ids.has(id) ? { ...(await remove(id)), saved: false } : { ...(await save(id)), saved: true }
}

async function mutate(method, path, body) {
  const r = await call(method, path, body)
  if (r.ok) {
    await load({ force: true })
    tellOtherTabs()
  }
  return r.ok ? { ok: true, body: r.body } : { ok: false, error: r.body.detail, reason: r.body.reason }
}

export const setNote = (id, note) => mutate('PUT', `/bookmarks/${encodeURIComponent(id)}/note`, { note })
export const createCollection = (name) => mutate('POST', '/collections', { name })
export const renameCollection = (cid, name) => mutate('PATCH', `/collections/${encodeURIComponent(cid)}`, { name })
export const deleteCollection = (cid) => mutate('DELETE', `/collections/${encodeURIComponent(cid)}`)
export const setMembership = (cid, id, member) =>
  mutate(member ? 'PUT' : 'DELETE', `/collections/${encodeURIComponent(cid)}/items/${encodeURIComponent(id)}`)

/** One page of the member's saved headlines, filtered by the server. */
export async function fetchItems(params) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  const r = await call('GET', `/items?${qs}`)
  return r.ok ? { ok: true, ...r.body } : { ok: false, error: r.body.detail, status: r.status }
}

export function _resetLibraryForTests() {
  _state = { status: 'idle', ids: new Set(), collections: [], limits: null, error: null, version: 0 }
  _listeners.clear()
  _loading = null
  _lastLoad = 0
}
