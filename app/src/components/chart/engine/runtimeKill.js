// app/src/components/chart/engine/runtimeKill.js
//
// ─── ⭐⭐ RT1 — THE PER-SCRIPT KILL SWITCH FOR THE RUNTIME LANE ───────────────
//
// The runtime lane is the member door's general fallback (`runtimePaneGate.js`,
// `memberPaneDefinition::runtimeLaneDefinition`). If one script turns out to draw
// wrong, or to cost too much, it must be possible to take THAT script off the
// runtime lane without a deploy and without touching anybody's data.
//
// ⛔⛔ THE LIST IS THE SERVER'S, ONE AUTHORITY: `PINE_RUNTIME_KILL_LIST` on `web`
// (`api/services/runtime_definitions.py`). It reaches this client two ways, and
// neither is a second list:
//   1. `GET /api/user-definitions/runtime-kill`, fetched by `MemberPane` while the
//      runtime pane is on and latched here — the member door's preview reads it
//      (not the auth payload: that rides every page of the app, and this list is
//      read by one surface behind a dark flag);
//   2. the store stamps a killed runtime row as it serves it
//      (`definition.meta.runtimeKilled`) — the install door refuses that stamp.
//
// ⛔ A KILL IS NEVER A DELETE (memory rule `feedback_kill_switch_never_a_delete`).
// A killed script falls back to the host lane's answer — usually its refusal
// sentence — and its saved definition stays in the store, untouched, coming back
// the moment it is unlisted.
//
// An entry is either a definition id (`u_` + 12 hex) or the sha256 of the Pine
// source (64 hex; a prefix of at least 12 hex is accepted, as git accepts one).
import { sha256Hex } from './ast/parse.js'

/** The server's read of the list (`api/routers/user_definitions.py::runtime_kill`). */
export const RUNTIME_KILL_PATH = '/api/user-definitions/runtime-kill'

const ID_RE = /^u_[0-9a-f]{12}$/
const HASH_RE = /^[0-9a-f]{12,64}$/

let _entries = Object.freeze([])

// ─── ⭐⭐ WS-I (2026-10-31, gap S6) — THE LISTS REACH AN OPEN TAB ─────────────
//
// `MemberPane` reads `RUNTIME_KILL_PATH` once per mount, so a kill added (or an
// allowlist line removed) after the mount never reached a tab that stayed open.
// Now a tab that HAS read the lists re-reads them by itself: a consult
// (`runtimeKillOf` / `runtimeNotGradedOf`) that finds them older than
// `RUNTIME_LISTS_RECHECK_MS` fires ONE background GET of the same path and
// latches the answer; this consult answers from the lists as they stand.
// ⛔ No timer, no new endpoint, never in a worker (no session there), never
// under the test grant (`__allowEveryRuntimeScriptForTests`), never throws: a
// failed read keeps the lists as they were and waits another interval.

/** How stale the latched lists may grow before the next consult re-reads them. */
export const RUNTIME_LISTS_RECHECK_MS = 60000
let _listsReadAt = 0
let _listsInFlight = false

function maybeRefreshRuntimeLists() {
  if (!_listsReadAt || _listsInFlight || _allow === ALLOW_ANY) return
  if (Date.now() - _listsReadAt < RUNTIME_LISTS_RECHECK_MS) return
  if (typeof window === 'undefined' || typeof fetch !== 'function') return
  _listsInFlight = true
  _listsReadAt = Date.now()            // a failure waits a full interval too
  try {
    Promise.resolve(fetch(RUNTIME_KILL_PATH, { credentials: 'include', cache: 'no-store' }))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setRuntimeKillList(d.kill)
        setRuntimeAllowList(d.allow)
        // WS-I Part 2 -- a switch-off of capability admission reaches the open tab here too
        setRuntimeCapabilityAdmission(d.capability_admission)
      })
      .catch(() => { /* the lists stay as they were */ })
      .finally(() => { _listsInFlight = false })
  } catch {
    _listsInFlight = false
  }
}

/** Diagnostics and rails. */
export const runtimeListsDebug = () => ({ readAt: _listsReadAt, inFlight: _listsInFlight })
/** Rails only. */
export function __resetRuntimeListsRecheck() { _listsReadAt = 0; _listsInFlight = false }

/** Normalise the server's list: lowercase, trimmed, only well-formed entries. */
export function normaliseKillList(list) {
  const raw = Array.isArray(list) ? list : (typeof list === 'string' ? list.split(/[\s,]+/) : [])
  const out = []
  for (const e of raw) {
    const v = String(e == null ? '' : e).trim().toLowerCase()
    if (ID_RE.test(v) || HASH_RE.test(v)) out.push(v)
  }
  return Object.freeze([...new Set(out)])
}

/** Latch the server's list (auth payload). An absent key means an empty list. */
export function setRuntimeKillList(list) {
  _entries = normaliseKillList(list)
  _listsReadAt = Date.now()
}

/** The list currently latched (tests, diagnostics). */
export function runtimeKillList() {
  return _entries
}

// ─── ⭐⭐ GT (2026-10-02, owner ruling D6) — THE STARTER ALLOWLIST ──────────
//
// While the runtime pane is on for a member, the lane draws ONLY a script whose
// source sha256 is on the SERVER's allowlist (`api/data/pine_runtime_allowlist.json`
// ∪ `PINE_RUNTIME_ALLOWLIST`, served by the same read as the kill list). Today it
// holds only adx-and-di-for-v4, the one script graded MATCH on a TradingView
// capture. Any other script declines by name (`runtime:not-yet-graded`) and the
// member reads the HOST lane's sentence, as for every runtime decline.
//
// ⛔ THE INVERSE POLARITY OF THE KILL LIST, AND IT FAILS THE OTHER WAY: nothing
// latched (the read has not landed, or failed) means NOTHING IS GRADED, so the
// preview declines until the server's list arrives — never "everything".
// ⛔ Only hashes: grading is a property of the script, never of a definition id.

const ALLOW_ANY = Symbol('allow-any (tests only)')
let _allow = Object.freeze([])

/** Normalise the server's allowlist: lowercase, trimmed, sha256 or a >=12-hex prefix. */
export function normaliseAllowList(list) {
  const raw = Array.isArray(list) ? list : (typeof list === 'string' ? list.split(/[\s,]+/) : [])
  const out = []
  for (const e of raw) {
    const v = String(e == null ? '' : e).trim().toLowerCase()
    if (HASH_RE.test(v)) out.push(v)
  }
  return Object.freeze([...new Set(out)])
}

/** Latch the server's allowlist (`GET /api/user-definitions/runtime-kill` → `allow`). */
export function setRuntimeAllowList(list) {
  _allow = normaliseAllowList(list)
}

/** The allowlist currently latched (tests, diagnostics). */
export function runtimeAllowList() {
  return _allow === ALLOW_ANY ? ['*'] : _allow
}

/** Rails only (`src/test-setup.js`): the suites that exercise the runtime LANE
 *  run with every script graded, so they keep measuring the lane, not this list.
 *  The list itself is railed with it reset (`runtimeSwitchOn.test.js`). */
export function __allowEveryRuntimeScriptForTests() { _allow = ALLOW_ANY }
/** Rails only. */
export function __resetRuntimeAllowList() { _allow = Object.freeze([]) }

// ─── ⭐⭐ WS-I PART 2 (2026-11-13) — ADMISSION BY CAPABILITY, PER-HASH VERDICTS ──
//
// A member's own copy of a script never hashes to a graded copy, so the allowlist
// above admits nothing a member brings. While the server says capability admission
// is ON (`capability_admission: true` on the `RUNTIME_KILL_PATH` read; the key is
// ABSENT while it is off), the member door also asks
// `POST RUNTIME_ADMISSION_PATH {source}` -> `{sha256, admitted, missing}` and latches
// the answer here, per source hash. ONE AUTHORITY: the server decides (one detector,
// `api/services/pine_capabilities.py`); this file only remembers its answers.
//
// ⛔ FAIL CLOSED: no verdict (not asked yet, in flight, failed) means NOT drawn, with
// its own sentence ("still being checked") so a member never reads "not graded" or
// "switched off" for a script that may be admitted a moment later.
// ⛔ The allowlist is asked FIRST; a verdict never overrides the kill list (asked
// before this at every door), and a verdict naming another hash is not latched.
// ⛔ Bounded (`RUNTIME_ADMISSION_MAX` hashes, least recently used dropped) and stale
// after `RUNTIME_LISTS_RECHECK_MS`: a consult that finds its verdict stale and has
// the source fires ONE background re-ask and answers from the verdict it has.
// Never in a worker or outside a page, never under the test grant, never throws.

/** The server's per-script verdict (`api/routers/user_definitions.py::runtime_admission`). */
export const RUNTIME_ADMISSION_PATH = '/api/user-definitions/runtime-admission'
/** How many per-hash verdicts a tab keeps. */
export const RUNTIME_ADMISSION_MAX = 64

let _capabilityAdmission = false
const _verdicts = new Map()        // hash -> { admitted, at }
const _admissionInFlight = new Map() // hash -> Promise

/** Latch the server's switch (`capability_admission` on the kill read). Anything but
 *  `true` is OFF, and switching it off forgets every verdict. */
export function setRuntimeCapabilityAdmission(on) {
  _capabilityAdmission = on === true
  if (!_capabilityAdmission) _verdicts.clear()
}

/** Is capability admission latched ON in this tab? */
export function runtimeCapabilityAdmissionOn() {
  return _capabilityAdmission
}

/** Latch one verdict. Only a 64-hex hash and a boolean `admitted` are kept. */
export function latchRuntimeAdmission(hash, verdict) {
  const h = typeof hash === 'string' ? hash.toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(h) || !verdict || typeof verdict.admitted !== 'boolean') return
  _verdicts.delete(h)
  _verdicts.set(h, { admitted: verdict.admitted, at: Date.now() })
  while (_verdicts.size > RUNTIME_ADMISSION_MAX) _verdicts.delete(_verdicts.keys().next().value)
}

/** The latched verdict for this script (`{admitted, at}`) or null. Touches the LRU. */
export function runtimeAdmissionOf({ source, hash } = {}) {
  const h = typeof hash === 'string' && hash ? hash.toLowerCase()
    : (typeof source === 'string' ? runtimeSourceHash(source) : '')
  const v = h ? _verdicts.get(h) : undefined
  if (!v) return null
  _verdicts.delete(h)
  _verdicts.set(h, v)
  return v
}

/** Ask the server about one script and latch the answer. Resolves to the verdict
 *  (`{admitted, at}`) or null (off, not a page, failed, or answered for another hash).
 *  One request per hash in flight. Never rejects. */
/** How often, and how many times, a "still being checked" answer (the server's detector gate was
 *  busy: `missing: ['pending']`) is asked again. A pending answer is never latched. */
export const RUNTIME_ADMISSION_PENDING_RETRY_MS = 1500
export const RUNTIME_ADMISSION_PENDING_RETRIES = 5

export function requestRuntimeAdmission(source, _attempt = 0) {
  if (!_capabilityAdmission || typeof source !== 'string' || !source) return Promise.resolve(null)
  if (typeof window === 'undefined' || typeof fetch !== 'function') return Promise.resolve(null)
  const h = runtimeSourceHash(source)
  const pending = _admissionInFlight.get(h)
  if (pending) return pending
  let p
  try {
    p = Promise.resolve(fetch(RUNTIME_ADMISSION_PATH, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    }))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => {
        // ⛔ a verdict for ANOTHER script (or none) is never latched under this one
        if (!d || typeof d.sha256 !== 'string' || d.sha256.toLowerCase() !== h) return null
        if (!_capabilityAdmission) return null
        // ⛔ "still being checked" is NOT a verdict: never latched (the row stays "being checked",
        // fail closed); asked again a few times, the in-flight slot released first
        if (Array.isArray(d.missing) && d.missing.includes('pending')) {
          if (_attempt + 1 >= RUNTIME_ADMISSION_PENDING_RETRIES) return null
          return { retry: true }
        }
        latchRuntimeAdmission(h, { admitted: d.admitted === true })
        return _verdicts.get(h) || null
      })
      .catch(() => null)
      .finally(() => { _admissionInFlight.delete(h) })
      .then((v) => (v && v.retry
        ? new Promise((resolve) => { setTimeout(resolve, RUNTIME_ADMISSION_PENDING_RETRY_MS) })
          .then(() => requestRuntimeAdmission(source, _attempt + 1))
        : v))
  } catch {
    return Promise.resolve(null)
  }
  _admissionInFlight.set(h, p)
  return p
}

/** Rails only. */
export function __resetRuntimeAdmission() {
  _capabilityAdmission = false
  _verdicts.clear()
  _admissionInFlight.clear()
}

/** Why this script is NOT drawn by the runtime lane (not yet graded), or null.
 *  WS-I Part 2: the allowlist first, then (while capability admission is latched ON)
 *  this tab's per-hash verdict; no verdict yet fails closed with its own sentence.
 *  @param {{source?: string, hash?: string}} arg */
export function runtimeNotGradedOf({ source, hash } = {}) {
  if (_allow === ALLOW_ANY) return null
  maybeRefreshRuntimeLists()
  const h = typeof hash === 'string' && hash ? hash.toLowerCase()
    : (typeof source === 'string' ? runtimeSourceHash(source) : '')
  if (h && _allow.some((e) => h.startsWith(e))) return null
  if (_capabilityAdmission && h) {
    const v = runtimeAdmissionOf({ hash: h })
    if (v && typeof source === 'string' && Date.now() - v.at >= RUNTIME_LISTS_RECHECK_MS) {
      v.at = Date.now()                         // a failed re-ask waits a full interval too
      requestRuntimeAdmission(source)           // re-ask once; answer from the verdict we hold
    }
    if (v && v.admitted) return null
    if (!v) {
      return `this script (sha256 ${h.slice(0, 12)}…) is still being checked against the parts of `
        + 'Pine graded against TradingView, so it is not drawn bar by bar yet'
    }
  }
  return `this script (sha256 ${h ? h.slice(0, 12) : '?'}…) has not yet been graded against `
    + 'TradingView, so it is not drawn bar by bar'
}

/** The script's identity: the sha256 of its Pine source, UTF-8, as written. */
export function runtimeSourceHash(source) {
  return sha256Hex(String(source == null ? '' : source))
}

/** Why this script is killed, or null.
 *  @param {{source?: string, defId?: string, hash?: string}} arg
 *  @returns {string|null} */
export function runtimeKillOf({ source, defId, hash } = {}) {
  maybeRefreshRuntimeLists()
  if (!_entries.length) return null
  const id = typeof defId === 'string' ? defId.toLowerCase() : ''
  if (id && _entries.includes(id)) {
    return `definition \`${defId}\` is on the server's runtime kill list, so it is not drawn bar by bar`
  }
  const h = typeof hash === 'string' && hash ? hash.toLowerCase()
    : (typeof source === 'string' ? runtimeSourceHash(source) : '')
  if (h && _entries.some((e) => !ID_RE.test(e) && h.startsWith(e))) {
    return `this script (sha256 ${h.slice(0, 12)}…) is on the server's runtime kill list, so it is not drawn bar by bar`
  }
  return null
}
