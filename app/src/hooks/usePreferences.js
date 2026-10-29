import useSWR, { mutate as mutateGlobal } from 'swr'
import { useCallback, useEffect, useRef } from 'react'
import { mergeSettingsOverride } from '../components/chart/instanceShape'
import { noteWorkspaceDocResponse } from '../lib/workspaceDoc'
import { emitWorkspaceConflict } from '../lib/workspaceConflict'
import { onPrefsUserChange, prefsUser, beginPrefsOp } from '../lib/prefsSession'

export { onWorkspaceConflict } from '../lib/workspaceConflict'

// ─── ONE MEMBER PER OPERATION ────────────────────────────────────────────────
//
// ⛔⛔ EVERY ASYNC BOUNDARY IN THIS MODULE CHECKS THAT THE MEMBER IS STILL THE ONE IT STARTED FOR.
// Sign-out is not a reload; the member can change between any two steps of a read, a write, a
// refresh, a re-read timer or a cache merge, and each time one step ran for the next member it put
// the previous member's data in the next member's cache or account (four reviews in a row found
// another door). So an operation begins with `beginPrefsOp()`, and after EVERY `await`, inside
// EVERY `.then`/`.catch` callback, every timer callback and every SWR cache updater, the first
// thing it does is `if (op.stale()) …` — before any side effect. `usePreferences.asyncBoundaries
// .test.js` parses this file and fails on a boundary that does not, unless it is listed there with
// a reason.
let _prefsUser          // undefined = not yet known (the first answer of /api/auth/me)
// The session generation and `beginPrefsOp` live in lib/prefsSession.js (one authority for "is
// this still the member it began for"); re-exported here for the hook's callers.
export { beginPrefsOp }

// TERM-021 read-new: every preferences response says whether the versioned workspace
// document is armed (the `X-Workspace-Doc` header, absent while dark). Recording it here
// costs nothing — no request, and the body is read exactly as before.
//
// Whether the last read of the preferences answered. A refused read (a 502 during a pod swap) is served as `{}`
// below, so every consumer sees the defaults, and that is right for a consumer that only READS. A consumer that
// merges a WRITE onto the cached value is not served by it: it would be merging onto nothing, and its write would
// replace whatever the server holds with defaults. The hook returns this as `readFailed` so such a writer can
// refuse (P4a m1: the page-layout editor). null = no read has answered yet.
let _lastReadOk = null
const readFailedOnce = () => { _lastReadOk = false }
// The read in flight, if any. A MERGING write issued before the first read has answered waits on it
// (setPrefMerged, below): merging onto a cache that holds nothing yet builds the whole value from
// an empty base, and posting THAT replaces every field the server holds that the writer did not
// name. Measured 2026-10-28: a focus write fired while the read was in flight posted {A:'ENPH'}
// and would have erased the member's comparison slots B/C/D.
let _inflightRead = null

// ─── Where the cached value CAME FROM ────────────────────────────────────────
//
// ⛔⛔ "A read succeeded" is not "the cache holds that read's answer". A setPref during the FIRST
// read writes an optimistic `{...DEFAULTS, key}` into an empty cache, and SWR then DISCARDS the
// read's answer (a mutation started after the request) — while the fetcher has already recorded
// the read as good. A merge onto that cache is a merge onto DEFAULTS + one key, and posting it
// erased B/C/D (reproduced in review: POSTs [default_chart_tf:'W', groups:{"A":"AMD"}]).
// So every object the cache holds is TAGGED by origin: the fetcher's answer, `refreshPreferences`'
// answer, and anything derived from a tagged object by a write that merges onto it. A merge is
// posted only onto a tagged base. WeakSet: the tag dies with the object, and nothing else is
// keyed on it.
const _serverBased = new WeakSet()
const tagServer = (obj) => { if (obj && typeof obj === 'object') _serverBased.add(obj); return obj }
/** `next`, derived from `prev`, inherits prev's origin. */
const derive = (prev, next) => { if (prev && _serverBased.has(prev)) _serverBased.add(next); return next }
// ⛔ AND SWR CAN KEEP THE OLD OBJECT. When a good read's answer is deep-equal to what the cache
// holds (a new member: a refused first read served `{}`, then the server's own `{}`), SWR 2.4 keeps
// the cached object (`compare(cacheData, newData) ? cacheData : newData`), so the tag on the answer
// never reaches the cache. An untagged cache read as "no server base", re-scheduled the re-read,
// and the fetcher's reset of the attempt count made that run forever (review: 601 GETs in ten
// minutes). So the last good answer is kept, and a cached object EQUAL to it is the server's value
// and is tagged on sight.
let _lastGoodAnswer = null
const _stableKey = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))
const isServerBased = (obj) => {
  if (!obj || typeof obj !== 'object') return false
  if (_serverBased.has(obj)) return true
  if (_lastGoodAnswer && _stableKey(obj) === _stableKey(_lastGoodAnswer)) { _serverBased.add(obj); return true }
  return false
}

// ─── Re-reading after a read that did not produce the server's value ─────────
//
// A refused read (a 5xx is served as `{}`, so SWR sees success and never retries), or a cache whose
// answer was discarded (above), leaves the session without a base. Every merge would then stay
// local for good, silently. So the hook schedules a bounded re-read — 1 s, doubling, capped at
// REREAD_CAP_MS, at most REREAD_MAX_ATTEMPTS in a row — and merges refused meanwhile are kept and
// RE-APPLIED onto the real base once a good read lands (each updater runs again on the server's
// value, so nothing is merged onto a guess). A good read resets the series.
//
// ⛔ THE SERIES PROVABLY ENDS. The attempt count resets ONLY when the cache is seen to hold the
// server's value (never merely because some read answered 200), and a session ceiling
// (REREAD_SESSION_MAX) caps the total however often that happens; both reset only with the member.
const REREAD_BASE_MS = 1000
const REREAD_CAP_MS = 30000
const REREAD_MAX_ATTEMPTS = 8
const REREAD_SESSION_MAX = 24
let _rereadTimer = null
let _rereadAttempts = 0
let _rereadTotal = 0
// Refused merges waiting for the server's base: { key, user, run }. `user` is the member the merge
// was made for; one made for another member is DROPPED at replay, never posted (defence in depth
// behind `setPreferencesUser`, which clears the list on any change of member).
const _pendingMerges = []
function flushPendingMerges() {
  if (!_pendingMerges.length) return
  const replay = _pendingMerges.splice(0)
  for (const m of replay) if (!m.op.stale() && m.op.user === prefsUser()) m.run()
}
/** A confirmed write of `key` is newer than any merge still waiting for it: the replay must not undo it. */
function dropPendingFor(key) {
  for (let i = _pendingMerges.length - 1; i >= 0; i -= 1) if (_pendingMerges[i].key === key) _pendingMerges.splice(i, 1)
}
function scheduleReread(revalidate) {
  if (_rereadTimer || _rereadAttempts >= REREAD_MAX_ATTEMPTS || _rereadTotal >= REREAD_SESSION_MAX) return
  const delay = Math.min(REREAD_CAP_MS, REREAD_BASE_MS * 2 ** _rereadAttempts)
  _rereadAttempts += 1
  _rereadTotal += 1
  const op = beginPrefsOp()
  _rereadTimer = setTimeout(() => {
    if (op.stale()) return
    _rereadTimer = null
    // A refused re-read answers `{}` again, which SWR may treat as "no change" and not re-render
    // for, so the series is chained here rather than left to the effect: still no server base
    // after this read ⇒ the next, longer, wait.
    let p
    try { p = revalidate() } catch { p = null }
    Promise.resolve(p).then(
      (d) => {
        if (op.stale()) return
        if (isServerBased(d)) { noteServerBase(); flushPendingMerges() } else scheduleReread(revalidate)
      },
      () => {
        if (op.stale()) return
        scheduleReread(revalidate)
      },
    )
  }, delay)
}
/** The cache was SEEN holding the server's value: the series is over, and may start afresh later. */
function noteServerBase() {
  _rereadAttempts = 0
  if (_rereadTimer) { clearTimeout(_rereadTimer); _rereadTimer = null }
}

const fetcher = url => {
  // A read that answers after the member changed is about the PREVIOUS member: none of its side
  // effects (revision baseline, read-ok flag, last good answer) may land, and what it returns is an
  // untagged `{}` — SWR discards it anyway (the member change mutated the key after it started),
  // and if it ever did not, an untagged object can never be merged onto or posted.
  const op = beginPrefsOp()
  const p = fetch(url).then(
    r => {
      if (op.stale()) return {}
      noteWorkspaceDocResponse(r); noteRevision(r, false)
      if (!r.ok) { readFailedOnce(); return {} }
      return r.json().then(j => {
        if (op.stale()) return {}
        _lastReadOk = true
        if (j && typeof j === 'object') _lastGoodAnswer = j
        return tagServer(j)
      }, err => {
        if (op.stale()) throw err
        readFailedOnce(); throw err
      })
    },
    err => {
      if (op.stale()) throw err
      readFailedOnce(); throw err
    },
  )
  _inflightRead = p
  const clear = () => { if (_inflightRead === p) _inflightRead = null }
  p.then(clear, clear)
  return p
}

const DEFAULTS = {
  default_chart_tf: 'D',
  // OLED Black is the app-wide default theme for anyone who hasn't picked one in
  // Settings. setPref only ever persists an EXPLICIT choice, so users who chose a
  // theme (incl. Midnight) keep theirs; everyone else now loads on OLED.
  theme: 'oled',
}

const PREFS_URL = '/api/auth/preferences'
// Notebook widgets Task 16: a slash capture reads the preferences the way this hook serves them
// (DEFAULTS underneath), outside React. One authority for the URL and the defaults.
export { DEFAULTS as PREFERENCE_DEFAULTS, PREFS_URL }

/** The one pref whose value is a structured document several writers edit at
 *  once, and therefore the one that gets a merge rule of its own below. */
const CHART_SETTINGS_KEY = 'chart_settings'

// Preferences are stored server-side as TEXT. Reads can therefore come back as
// a JSON string (the normal case) OR — from the optimistic cache below — as an
// already-parsed object/array. Parse defensively and fall back on bad input.
export function parsePref(raw, fallback) {
  if (raw == null) return fallback
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return fallback }
}

// ─── Per-key write queue ─────────────────────────────────────────────────────
//
// MODULE-level, not per-hook, and that is the whole point: sixteen grid cells
// call `usePreferences()` sixteen times, so a ref inside the hook would give
// each writer its own queue and serialise nothing. The SWR cache these writers
// share is module-global too, so the queue that guards it has to live at the
// same scope.
//
// It exists because merging atomically is only half the fix. Two POSTs in
// flight at once can be delivered in either order, and the server keeps
// whichever ARRIVES last — which may be the earlier, smaller blob, undoing the
// merge that had just been computed correctly. One request per key at a time
// makes arrival order equal merge order.
const _writeChains = new Map()

// ─── Revision safety ─────────────────────────────────────────────────────────
//
// ⛔ The workspace (the board, the open-layout pointer, every Charts setting) is one shared
// per-member preference set, and a tab never re-reads it after it loads. An older tab — or
// another device — saving its copy would silently overwrite newer work. While the server's
// versioned workspace document is armed, every write names the document version at which THIS
// tab last read or wrote that key (`base_version`), and the server commits it only if the key is
// unchanged since then (`api/services/workspace_doc_store.write_pref_checked`); otherwise 409 and
// nothing is written.
//
// The revision comes from the server only — the `v=` in `X-Workspace-Doc` on a read, the
// `version` in a write's answer — never fabricated here. It advances only on a confirmed write.
//
// ⭐ A BACKGROUND RE-READ DOES NOT ADVANCE IT. The Charts board is hydrated ONCE from the first
// read; a later SWR refetch refreshes the cache, not the board on screen. Advancing the
// revision then would let the board, built from the OLD values, be saved over newer ones. Only
// `refreshPreferences()` — an explicit "take the server's state", after which its callers
// re-seed the board — adopts the newer revision.
let _revBaseline = null            // the document version this tab loaded at; null = store dark
const _keyRev = new Map()          // key -> version of this tab's last confirmed write of it
const _conflicted = new Set()      // keys refused as stale: no further writes until a reload

function revisionOf(res) {
  let stamp = null
  try { stamp = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('X-Workspace-Doc') : null } catch { stamp = null }
  if (!stamp) return undefined                 // dark (or no header): send no revision
  const m = /\bv=(\d+)/.exec(stamp)
  if (m) return Number(m[1])
  if (/reason=absent/.test(stamp)) return 0    // no document yet: the server compares against its first copy
  return undefined
}

function noteRevision(res, adopt) {
  if (!res || !res.ok) return
  const v = revisionOf(res)
  if (adopt) {
    _revBaseline = v === undefined ? null : v
    _keyRev.clear()
  } else if (_revBaseline === null && v !== undefined) {
    _revBaseline = v
  }
}

// ─── Failed-write backoff ────────────────────────────────────────────────────
//
// ⛔⛔ A FAILED WRITE MUST NOT RE-FIRE ITSELF (rule H14). Measured 2026-10-28 in WebKit: the
// TickerPopup's focus write (`charts_workspace_groups`) against a failing endpoint sent 50 POSTs
// in ~18 s and never stopped. The cycle is not specific to that key: the throw path below reverts
// by re-reading the server, the re-read takes the optimistic value back out of the cache, `prefs`
// changes, and ANY `prefs`-keyed effect that writes a pref re-asserts its value — POST, fail,
// re-read, re-assert, entirely in microtasks, with nothing to slow it down.
//
// So the write path itself remembers, per key, the value whose POST last failed. Asking to save
// that SAME value again is answered without a request until its retry time, which doubles with
// each consecutive failure (RETRY_BASE_MS, 2x, 4x ... capped at RETRY_CAP_MS). A DIFFERENT value
// for the key is a new edit that supersedes the failed one and is sent at once; a confirmed write
// clears the record. There is no timer and no automatic resend: a retry is still a caller asking
// again, this only bounds how often an identical ask reaches the network.
//
// A 409 conflict is NOT recorded here: `_conflicted` already refuses every later write of the key
// without a request, per the revision design above.
//
// ⛔ AND A MEMBER'S OWN RETRY IS NEVER HELD. The loop this guards against re-asserts with NO
// input from anybody; a "Try again" button (AdoptLayoutSheet) or a second press of Save is a
// person asking again, and holding it answers "failed" without a request (that shipped in the
// first cut of this guard and broke LayoutLibrary's Try again). So every pointer, touch or click
// anywhere in the document advances `_inputSeq`, and an identical re-send is held only while
// no input has happened since that value's failure.
const RETRY_BASE_MS = 1000
const RETRY_CAP_MS = 60000
const _failedWrites = new Map()    // key -> { serialized, failures, retryAt, inputSeq }
let _inputSeq = 0
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const bump = () => { _inputSeq += 1 }
  // (no key listener: a keyboard press of a button arrives as a `click`, and raw key listeners go
  // through the shortcut registry — keyListenerCensus.test.js)
  for (const ev of ['pointerdown', 'touchstart', 'click']) {
    window.addEventListener(ev, bump, { capture: true, passive: true })
  }
}

function backoffHolds(key, serialized) {
  const f = _failedWrites.get(key)
  if (!f) return false
  if (f.serialized !== serialized) { _failedWrites.delete(key); return false }   // superseded
  if (_inputSeq !== f.inputSeq) return false                                     // a person asked again
  return Date.now() < f.retryAt
}

function noteWriteFailed(key, serialized) {
  const prev = _failedWrites.get(key)
  const failures = prev && prev.serialized === serialized ? prev.failures + 1 : 1
  const delay = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (failures - 1))
  _failedWrites.set(key, { serialized, failures, retryAt: Date.now() + delay, inputSeq: _inputSeq })
}

/** Resolves once every write queued so far for these keys has answered (success or not). */
export function whenWritesSettle(keys) {
  return Promise.all((keys || []).map(k => _writeChains.get(k) || Promise.resolve())).then(() => undefined)
}

// ─── One member's state, never another's ─────────────────────────────────────
//
// ⛔⛔ EVERYTHING ABOVE IS MODULE STATE, and sign-out is not a reload (AuthContext's logout sets
// the user to null; Settings and Subscribe navigate in-app). Kept across a change of member, a held
// merge made for A replayed onto B's preferences and POSTed into B's ACCOUNT (review repro:
// posts [{groups:{"A":"A_USER_PICK","B":"B2"}}]), and B rendered A's cached preferences until a
// read landed. `setPreferencesUser` is called by AuthContext on every committed user change
// (sign-out, sign-in as someone else, a session that died and came back as another member): it
// clears all of it AND the cached preferences, so B never renders or merges onto A's.
// (`_prefsUser` is declared at the top of the module; the generation lives in lib/prefsSession.)

/** Clear every piece of module state this hook keeps (not the SWR cache: see setPreferencesUser). */
export function resetPreferencesState() {
  _revBaseline = null; _keyRev.clear(); _conflicted.clear(); _writeChains.clear(); _lastReadOk = null
  _failedWrites.clear(); _inflightRead = null; _lastGoodAnswer = null
  if (_rereadTimer) clearTimeout(_rereadTimer)
  _rereadTimer = null; _rereadAttempts = 0; _rereadTotal = 0; _pendingMerges.length = 0
}

/** "Whose preferences these are" changed (AuthContext publishes it: lib/prefsSession.js). */
export function setPreferencesUser(id) {
  const next = id ?? null
  if (_prefsUser === undefined) { _prefsUser = next; return }   // first answer: nothing to clear
  if (next === _prefsUser) return
  _prefsUser = next                       // (lib/prefsSession has already moved the generation)
  resetPreferencesState()
  // Drop the previous member's cached preferences (no request), then read the new member's own.
  // A read still in flight for the previous member is discarded by SWR (a mutation started after it).
  mutateGlobal(PREFS_URL, undefined, { revalidate: false })
  if (next !== null) mutateGlobal(PREFS_URL)
}
onPrefsUserChange((id) => setPreferencesUser(id))
if (prefsUser() !== undefined) _prefsUser = prefsUser()   // published before this module loaded

/** Tests only. */
export function __resetRevisionStateForTests() {
  resetPreferencesState()
  _prefsUser = undefined
}

// THE one POST. Runs inside the per-key queue, so the revision is read at SEND time — after this
// tab's previous write of the key has answered — and a tab's rapid edits never refuse each other.
async function postPref(key, serialized, op = beginPrefsOp()) {
  if (op.stale()) return { ok: false, stale: true }     // made for another member: never sent
  if (_conflicted.has(key)) return { ok: false, conflict: true }
  // Resolves (never throws) so a held write keeps the optimistic value and does NOT take the
  // throw path's re-read — the re-read is what re-arms the loop this guard exists to break.
  if (backoffHolds(key, serialized)) return { ok: false, backoff: true }
  const base = _keyRev.has(key) ? _keyRev.get(key) : _revBaseline
  const body = { key, value: serialized }
  if (base !== null && base !== undefined) body.base_version = base
  let res
  try {
    res = await fetch(PREFS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    if (op.stale()) throw err
    noteWriteFailed(key, serialized)
    throw err
  }
  // The member changed while this POST was in flight: its answer is about the previous member's
  // account and must not touch this member's revision, conflict or backoff state.
  if (op.stale()) return { ok: !!(res && res.ok), stale: true }
  if (res && res.ok) {
    _failedWrites.delete(key)
    dropPendingFor(key)
    try {
      const j = await res.json()
      if (op.stale()) return { ok: true, stale: true }
      if (j && Number.isInteger(j.version)) _keyRev.set(key, j.version)
    } catch { /* an answer without a version (dark store, non-board key) changes nothing */ }
    return { ok: true }
  }
  if (res && res.status === 409) {
    let d = null
    try { d = (await res.json())?.detail } catch { d = null }
    if (op.stale()) return { ok: false, stale: true }
    if (d && (d.code === 'workspace_conflict' || d.code === 'workspace_revision_required')) {
      _conflicted.add(key)
      emitWorkspaceConflict({ key, code: d.code, message: d.message || null })
      return { ok: false, conflict: true }
    }
  }
  noteWriteFailed(key, serialized)
  return { ok: false }
}

function queueWrite(key, task) {
  const previous = _writeChains.get(key) || Promise.resolve()
  const next = previous.then(task)
  // Store a NEUTRALISED handle, never `next` itself. If a failed write stayed in
  // the chain as a rejected promise, every later write for that key would be
  // skipped behind it — one flaky POST and settings silently stop saving until
  // reload, which is a worse bug than the one this queue exists to fix. The
  // caller still gets `next`, so it sees its own failure.
  _writeChains.set(key, next.then(() => {}, () => {}))
  return next
}

/**
 * Build the blob to persist for `chart_settings`.
 *
 * `mergeSettingsOverride` is IMPORTED, not reimplemented: it already carries the
 * merge-instances-by-`instanceId` rule (`chartDefaults.js:438-448`) that the
 * multi-chart grid needed for exactly the same reason, and a second copy of that
 * rule would be a second thing to keep correct.
 *
 * Applying it here is what protects an updater that ignores its argument — which
 * is the shape EVERY existing caller has, since they build a whole `persisted`
 * blob out of a possibly-stale `cs` and hand it over. Union-by-id means such a
 * writer cannot delete an instance it never knew about.
 *
 * REMOVAL is expressed with a TOMBSTONE, not by omission — `instanceTombstone(id)`
 * in the patch (`chartDefaults.js`). Omission cannot mean deletion here: a patch
 * that simply lacks an instance is indistinguishable from one written by a cell
 * that never heard of it, which is the case the union exists to protect. The
 * tombstone persists in the array precisely so the NEXT unrelated write from a
 * cell whose snapshot predates the delete — which names the instance in full —
 * cannot bring it back.
 *
 * The flip side, stated plainly: last-write-wins still governs any scalar both
 * writers name. This is add-and-delete protection, not a CRDT.
 */
function resolveWriteValue(key, current, next) {
  if (key !== CHART_SETTINGS_KEY) return next

  const patch = typeof next === 'string' ? parsePref(next, null) : next
  const isMergeable = v => v && typeof v === 'object' && !Array.isArray(v)
  if (!isMergeable(patch)) return next          // nothing to merge into shape
  if (!isMergeable(current)) return patch       // no base yet: the patch IS the blob
  return mergeSettingsOverride(current, patch)
}

/**
 * RE-READ the preferences from the server and put that answer in the shared
 * cache, so every mounted consumer re-renders from what the server now holds.
 *
 * For writes that land on the server WITHOUT going through `setPref` — today
 * two: TERM-051's version restore, whose route writes the restored values
 * straight into `user_preferences`, and TERM-021's one-write board apply
 * (`POST /api/workspace/doc/apply`). No optimistic value exists for such a
 * write, so the only honest source is a fresh read.
 *
 * Returns the merged prefs (defaults underneath, as the hook serves them), or
 * `null` when the read failed. A failed read touches NOTHING in the cache: the
 * caller says so rather than showing a board it could not confirm.
 *
 * `signal` (optional) aborts the read. An aborted read is a failed read: it
 * returns `null` and can never land in the cache later.
 */
export async function refreshPreferences({ signal } = {}) {
  // ⛔ A refresh that answers after the member changed returns NULL and touches nothing: its data is
  // the previous member's, and its callers re-seed boards from what it returns (review: B's cache
  // tagged as the server's with A's fields, then posted into B's account).
  const op = beginPrefsOp()
  let res
  let data
  try {
    res = await (signal ? fetch(PREFS_URL, { signal }) : fetch(PREFS_URL))
    if (op.stale()) return null
    if (signal?.aborted) return null
    if (res && res.ok) data = await res.json()
    if (op.stale()) return null
  } catch {
    return null
  }
  // The revision is noted only AFTER the body is in hand and the LAST abort check has passed. An
  // abort that fires during `res.json()` would otherwise leave this tab holding the newer revision
  // over a cache that never got its data, and the next write would pass the server's staleness
  // check on stale data (P4b-T8 m1, P4b final A1). A non-ok answer still gets its notes.
  if (signal?.aborted) return null       // a read the caller gave up on never lands, even if the fetch ignored the abort
  noteWorkspaceDocResponse(res)
  noteRevision(res, true)
  if (!res || !res.ok) return null
  if (!data || typeof data !== 'object') return null
  _lastReadOk = true
  _lastGoodAnswer = data
  noteServerBase()
  await mutateGlobal(PREFS_URL, tagServer(data), { revalidate: false })
  if (op.stale()) return null
  return { ...DEFAULTS, ...data }
}

/**
 * Put a value into the shared preferences cache WITHOUT a request -- for a write that
 * reaches the server through its own door and answers with what it stored (wave 14,
 * lane W14-C2: `PUT /api/j2/onboarding/tours/{id}` merges ONE tour's row on the server
 * and answers the merged `notebook_tours`). The sibling of `refreshPreferences` above,
 * minus the re-read: the door's answer IS the server's value.
 *
 * `updater(current) -> next` (current parsed, like `setPrefMerged`), or a plain value.
 * `undefined` changes nothing. Nothing loaded yet ⇒ nothing is fabricated: the next read
 * brings the server's value anyway. Never POSTs -- calling this is not a save.
 */
//
// ⛔ A caller that awaits a door's answer FIRST must capture the operation BEFORE that await and pass
// it (`const op = beginPrefsOp()` … `mergeIntoPreferenceCache(key, answer, op)`): a door answer for
// the previous member is then never merged into the next member's cache. Without `op` the
// operation starts at the call.
export async function mergeIntoPreferenceCache(key, updater, op = beginPrefsOp()) {
  await mutateGlobal(PREFS_URL, (prev) => {
    if (op.stale()) return prev
    if (!prev || typeof prev !== 'object') return prev
    const current = parsePref(prev[key], undefined)
    const next = typeof updater === 'function' ? updater(current) : updater
    if (next === undefined) return prev
    return derive(prev, { ...prev, [key]: typeof next === 'string' ? next : JSON.stringify(next) })
  }, { revalidate: false })
}

// `enabled` defaults to true, so every existing caller (all ~79 of them) is
// unaffected — it exists for a root-mounted caller that renders for EVERY
// visitor, signed in or not, so it can hold off this authed-only GET until a
// member is actually signed in. `null` is SWR's own "don't fetch" key.
export default function usePreferences(enabled = true) {
  const { data, mutate, isLoading } = useSWR(enabled ? PREFS_URL : null, fetcher, {
    dedupingInterval: 300000, // 5 min
    revalidateOnFocus: false,
  })

  // Merge server prefs over defaults
  const prefs = { ...DEFAULTS, ...(data || {}) }
  // The cache as of this render, for setPrefMerged's "has anything been read yet" check (a stable
  // callback must not close over `data`).
  const dataRef = useRef(data)
  dataRef.current = data

  // `givenOp` (optional): the operation a caller began BEFORE an await of its own (a door, an adopt
  // round trip). Given and stale — the member changed meanwhile — the write is refused with no side
  // effect at all: no cache change, no request.
  const setPref = useCallback(async (key, value, givenOp = null) => {
    if (givenOp && givenOp.stale()) return false
    // The backend's SetPreferenceRequest types `value` as a str, so an
    // object/array would be rejected with a 422. Coerce non-strings to JSON
    // here so callers can pass structured values transparently (read them
    // back with parsePref).
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    // Optimistic update
    // (derive: the result is server-based only when what it was built on was — an optimistic
    // write onto an EMPTY cache is not a base anyone may merge onto)
    const op = givenOp || beginPrefsOp()
    mutate(prev => {
      if (op.stale()) return prev
      return derive(prev, { ...DEFAULTS, ...prev, [key]: serialized })
    }, false)

    /** Report the failure and CHANGE NOTHING. This is the settle contract.
     *
     * ⛔⛔ A FAILED WRITE MUST NOT TOUCH THE CACHE. MOB-09 (`ecfec4a2c`) added a
     * bare `mutate()` here, and it deadlocked the app against any failing
     * preferences endpoint. Both obvious readings of that bug are wrong, and both
     * were measured before this comment was written:
     *
     *   1. "It is the revalidation." It is not. Replacing `mutate()` with a
     *      local, no-request rollback (`mutate(fn, false)`) STILL spun at 100%
     *      CPU indefinitely.
     *   2. "It is the failure itself." It is not that either — the pre-MOB-09
     *      code returned from this branch having done nothing, and settled.
     *
     * The actual driver is that ANY write here re-renders every consumer, and
     * `prefs` is rebuilt as a fresh object on each render (see below), so a
     * `prefs`-keyed effect that writes fires again — and a rollback is the worst
     * shape of all, because it flips the value back to the one that provoked the
     * write, so the cycle cannot converge even in principle. Leaving the
     * optimistic value in place is what terminates it: the second attempt sees
     * the value already applied and has no reason to write again.
     *
     * ⛔ SO THE OPTIMISTIC VALUE DELIBERATELY SURVIVES A FAILED WRITE, in memory,
     * for this session. That is the pre-MOB-09 behaviour and it is chosen, not
     * inherited: it keeps the user's own edit on screen instead of yanking it
     * back under them, and nothing durable is claimed by it — the SERVER is
     * still the authority, `false` is returned, and a caller that keeps a
     * durable mark (`useTracingsSync`) must not advance it. The cost is that a
     * rejected value can linger in the in-memory cache until the next successful
     * read; that is a smaller harm than an unbreakable render loop, and it is the
     * behaviour every release before MOB-09 shipped.
     */
    try {
      // Queued per key (see `postPref`): the revision it sends is read after this tab's previous
      // write of the key answered. A refused stale write keeps the local value on screen and
      // returns false — it is NOT saved and nothing claims it was.
      const r = await queueWrite(key, () => postPref(key, serialized, op))
      if (op.stale()) return false
      if (!r.ok || r.stale) {
        // A 4xx/5xx used to read exactly like success. It is still reported —
        // that is MOB-09's real requirement — but it is reported by the RETURN
        // VALUE, not by mutating shared cache state. See the settle note above.
        return false
      }
    } catch {
      // ⚠️ THE THROW PATH KEEPS ITS REVERT, AND THE ASYMMETRY IS DELIBERATE.
      // This branch is not the one MOB-09 added and not the one that spun: the
      // hang was driven by `{ok: false}`, which resolves and never lands here.
      // This revert predates MOB-09, has shipped for a long time, and carries
      // its own contract test (`usePreferences.test.js` — "still reverts on
      // failure", which drives `fetch` to THROW). Removing it here as well was
      // over-broad and turned that green test red; the narrow fix is the
      // non-ok branch alone.
      if (op.stale()) return false
      mutate()
      return false
    }
    // ⭐ RETURNS WHETHER THE WRITE WAS CONFIRMED. Every existing caller ignores
    // the return value and is unaffected. `useTracingsSync` does not ignore it,
    // because it keeps a highwatermark of "what the server has seen" and that
    // claim must never rest on a request nobody checked (MOB-09).
    return true
  }, [mutate])

  /**
   * Write a preference by TRANSFORMING the freshest value, instead of
   * overwriting it with a snapshot.
   *
   * `setPref(key, value)` takes a value the caller computed at some earlier
   * moment and blind-writes it. With up to sixteen chart widgets each holding
   * their own copy of `chart_settings`, "some earlier moment" is routinely
   * before another cell's write, and the second POST erases the first. This is
   * not a risk the engine introduces — it can already lose an indicator toggle
   * today (see `usePreferences.test.js`, which reproduces it).
   *
   *   setPrefMerged('chart_settings', cs => ({ ...cs, indicatorInstances: [...] }))
   *
   * `updater(current) -> next` runs INSIDE the SWR cache update, so `current` is
   * whatever the cache holds at that instant — after any write that has already
   * landed, never the value this component last rendered with. SWR's functional
   * mutate reads and writes the cache in one synchronous step, so two writers
   * cannot interleave between the read and the write.
   *
   * Returning `undefined` from the updater abandons the write entirely (nothing
   * to change ⇒ no request). An updater that THROWS abandons it too, and the
   * error is re-thrown rather than swallowed — a broken updater should be a
   * visible failure, not a setting that silently stops saving.
   *
   * Existing `setPref` callers are deliberately untouched: migrating them all is
   * a change to every settings surface in the app and belongs in its own step.
   *
   * @param {string} key
   * @param {(current: any) => any} updater
   */
  const setPrefMerged = useCallback(async (key, updater, givenOp = null) => {
    if (givenOp && givenOp.stale()) return false     // see setPref: begun for another member
    let serialized = null
    let updaterError = null
    let unknownBase = false
    const op = givenOp || beginPrefsOp()   // the member this merge is FOR

    // ⛔⛔ NEVER POST A MERGE ONTO A BASE THAT HAS NOT BEEN READ. Before the first read answers, the
    // cache holds nothing, and a merge onto nothing is a WHOLE value built from an empty base —
    // posting it replaces every field of the server's copy the updater did not name (the focus
    // write erasing B/C/D). So a merge issued while the cache is empty waits for the read in
    // flight. If no read has produced the server's value (still empty, or the last read was
    // refused and served as `{}`), the merge is applied to THIS TAB's cache only — the member's
    // edit still shows, and a surface keyed on it (the hub's focus symbol) still works — but it is
    // NOT POSTED, and `false` is returned. The next read that lands replaces the local value with
    // the server's, and a caller that re-asserts on `prefs` (TickerPopup's focus effect) then
    // writes properly, merged onto what the server actually holds.
    if (dataRef.current === undefined && _inflightRead) {
      try { await _inflightRead } catch { /* a failed read is judged below */ }
    }
    if (op.stale()) return false          // the member changed while it waited: dropped

    await mutate(prev => {
      if (op.stale()) return prev
      unknownBase = !isServerBased(prev)
      const base = { ...DEFAULTS, ...prev }
      const current = parsePref(base[key], undefined)

      let next
      try {
        next = typeof updater === 'function' ? updater(current) : updater
      } catch (err) {
        updaterError = err
        return prev            // leave the cache exactly as it was
      }
      if (next === undefined) return prev

      const resolved = resolveWriteValue(key, current, next)
      serialized = typeof resolved === 'string' ? resolved : JSON.stringify(resolved)
      return derive(prev, { ...base, [key]: serialized })
    }, false)
    if (op.stale()) return false

    if (updaterError) throw updaterError
    if (serialized === null) return
    if (unknownBase) {
      // Applied locally above, deliberately never posted. Kept, and re-applied onto the server's
      // value when a good read lands; a re-read is scheduled so that it does.
      _pendingMerges.push({ key, op, run: () => { setPrefMergedRef.current?.(key, updater) } })
      scheduleReread(() => mutate())
      return false
    }

    // The value is FROZEN at merge time and the POSTs are queued in that same
    // order, so what the server ends up with is what the last merge computed.
    //
    // The POST deliberately does NOT swallow its own failure: the queue has to
    // SEE a rejected write to keep itself unwedged, and a task that always
    // resolves would make that handling unreachable. The revert therefore hangs
    // off the returned promise, which still resolves — a fire-and-forget caller
    // never gets an unhandled rejection.
    return queueWrite(key, () => postPref(key, serialized, op)).catch(() => {
      // Revert on failure — same contract as setPref (and never into another member's cache).
      if (op.stale()) return
      mutate()
    })
  }, [mutate])
  const setPrefMergedRef = useRef(setPrefMerged)
  setPrefMergedRef.current = setPrefMerged

  // A cache that is NOT the server's answer (a refused read served as `{}`, or an answer SWR
  // discarded under an optimistic write) schedules the bounded re-read; a cache that IS re-applies
  // the merges refused meanwhile, each onto the real base.
  const cacheIsServer = isServerBased(data)
  useEffect(() => {
    if (!enabled || data === undefined) return
    if (!cacheIsServer) { scheduleReread(() => mutate()); return }
    noteServerBase()
    flushPendingMerges()
  }, [enabled, data, cacheIsServer, mutate])

  // `readFailed`: the last read of the preferences was refused or never arrived, so the cached value is NOT the
  // server's (see `_lastReadOk`). Read at render; every read that answers re-renders the consumers.
  return { prefs, setPref, setPrefMerged, loading: isLoading, readFailed: _lastReadOk === false }
}
