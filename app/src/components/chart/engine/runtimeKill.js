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
import { setRunHalfObjectEvidence } from './runHalfRailSeam.js'

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

// ─── ⭐⭐ THE FIRST READ, AND THE SIGNAL THAT IT LANDED (2026-11-17, RS Rating live) ─────────
//
// ⚰️ MEASURED ON PRODUCTION (engine 68): the ONLY reader that latched these lists was
// `MemberPane`'s mount read, and the recheck below returned at once while `_listsReadAt` was 0.
// So a tab that never opened the member door — every member who reloads a chart carrying RS
// Rating, or adds it from "Your indicators" — never read them at all: 0 GETs in 94 s, the
// allowlist empty, and every run half refused `pane:not-graded` ("hasn't been checked against
// TradingView") for a script the server had graded. Every rail ran under
// `__allowEveryRuntimeScriptForTests`, which skips exactly this.
// ⭐ So the first consult in a page DOES the first read (`ensureRuntimeListsRead`, also called
// by the chart on mount through `useRuntimeLists`), and every latch — the lists or a capability
// verdict — bumps `runtimeListsGeneration` and tells subscribers, so a chart asks again once
// they land: the `useServerColumns` shape (a generation, never the data).
const _listsListeners = new Set()
let _listsGeneration = 0

/** Subscribe to "the runtime lists (or a verdict) just latched". Returns the unsubscribe. */
export function subscribeRuntimeLists(fn) {
  if (typeof fn !== 'function') return () => {}
  _listsListeners.add(fn)
  return () => { _listsListeners.delete(fn) }
}

/** A number that changes whenever the lists or a verdict latch (the value is meaningless). */
export function runtimeListsGeneration() { return _listsGeneration }

function notifyRuntimeLists() {
  _listsGeneration += 1
  for (const fn of [..._listsListeners]) {
    try { fn() } catch { /* a subscriber's failure is its own */ }
  }
}

/** Read the lists once if this tab never has (a page only; never under the test grant). */
export function ensureRuntimeListsRead() {
  if (!_listsReadAt) maybeRefreshRuntimeLists()
}

function maybeRefreshRuntimeLists() {
  if (_listsInFlight || _allow === ALLOW_ANY) return
  // ⭐ never read (0): read NOW — the first read; read once: again when older than the recheck
  if (_listsReadAt && Date.now() - _listsReadAt < RUNTIME_LISTS_RECHECK_MS) return
  if (typeof window === 'undefined' || typeof fetch !== 'function') return
  _listsInFlight = true
  _listsReadAt = Date.now()            // a failure waits a full interval too
  try {
    Promise.resolve(fetch(RUNTIME_KILL_PATH, { credentials: 'include', cache: 'no-store' }))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        // WS-I Part 2 -- a switch-off of capability admission reaches the open tab here too
        latchRuntimeLists(d)
      })
      .catch(() => { /* the lists stay as they were */ })
      .finally(() => { _listsInFlight = false })
  } catch {
    _listsInFlight = false
  }
}

/** ⭐⭐ RS RATING L8 — LATCH EVERYTHING THE KILL READ CARRIES, ONE FUNCTION FOR BOTH READERS
 *  (`MemberPane`'s mount read and the recheck above), so a key the server adds reaches both or
 *  neither: the kill list, the allowlist, the capability-admission switch, and the run half's
 *  object evidence (`run_half_evidence`, from the same committed allowlist records:
 *  `api/services/runtime_definitions.py::run_half_evidence`). ⛔ An absent key latches EMPTY
 *  (nothing admitted), never "as it was". */
export function latchRuntimeLists(d) {
  if (!d || typeof d !== 'object') return
  setRuntimeKillList(d.kill)
  setRuntimeAllowList(d.allow)
  setRuntimeCapabilityAdmission(d.capability_admission)
  setRunHalfObjectEvidence(d.run_half_evidence)
  notifyRuntimeLists()
}

/** Diagnostics and rails. */
export const runtimeListsDebug = () => ({ readAt: _listsReadAt, inFlight: _listsInFlight })
/** Rails only. */
export function __resetRuntimeListsRecheck() { _listsReadAt = 0; _listsInFlight = false; _listsListeners.clear() }

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
const _askedAt = new Map()         // hash -> when a source with NO verdict was last re-asked (bounded)
const _admissionInFlight = new Map() // hash -> Promise
// ⭐ (2026-11-18, the first-paste race) the hashes a consult ANSWERED "still being checked" for (bounded): a build
// minted on that answer is waiting for one, and `runtimeConsultPendingOf` says so until the answer changes
const _consultedPending = new Set()
// ⭐ (2026-11-19) WHY the server's last answer for a hash was "still being checked" (`pending_reason`): the dock and
// the editor panel word it, and a "paused" script stops re-checking early. Bounded; cleared when a verdict lands.
const _pendingReasons = new Map()  // hash -> 'busy' | 'starting' | 'paused'
/** The server's reasons a verdict is still pending (`api/services/runtime_definitions.py`: `PENDING_BUSY`,
 *  `PENDING_STARTING`, `PENDING_PAUSED`). Anything else the server sends is ignored, never kept. */
export const RUNTIME_PENDING_REASONS = Object.freeze(['busy', 'starting', 'paused'])

function keepPendingReason(h, reason) {
  _pendingReasons.delete(h)
  if (!RUNTIME_PENDING_REASONS.includes(reason)) return
  _pendingReasons.set(h, reason)
  while (_pendingReasons.size > RUNTIME_ADMISSION_MAX) _pendingReasons.delete(_pendingReasons.keys().next().value)
}

/** Latch the server's switch (`capability_admission` on the kill read). Anything but
 *  `true` is OFF, and switching it off forgets every verdict. */
export function setRuntimeCapabilityAdmission(on) {
  _capabilityAdmission = on === true
  if (!_capabilityAdmission) { _verdicts.clear(); _pendingReasons.clear() }
}

/** Is capability admission latched ON in this tab? */
export function runtimeCapabilityAdmissionOn() {
  return _capabilityAdmission
}

/** Latch one verdict. Only a 64-hex hash, a boolean `admitted` and a boolean `historyOnly`
 *  (G6: admitted for CLOSED-BAR HISTORY only, `runtimeFormingRefusalOf`) are kept. */
export function latchRuntimeAdmission(hash, verdict) {
  const h = typeof hash === 'string' ? hash.toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(h) || !verdict || typeof verdict.admitted !== 'boolean') return
  _verdicts.delete(h)
  _pendingReasons.delete(h)      // a verdict is not pending: whatever the last pending answer said no longer holds
  _verdicts.set(h, { admitted: verdict.admitted, historyOnly: verdict.historyOnly === true, at: Date.now() })
  while (_verdicts.size > RUNTIME_ADMISSION_MAX) _verdicts.delete(_verdicts.keys().next().value)
  notifyRuntimeLists()          // ⭐ a verdict that lands later changes the answer too
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

/** TERM-033: what a FAILED admission request resolves to. It is "no verdict", never a verdict:
 *  nothing is latched, the script stays "being checked" (fail closed), and `watchRuntimeAdmission`
 *  asks again on its recheck. Never read as admitted or as refused. */
const NO_ADMISSION_VERDICT = null
const noAdmissionVerdict = () => NO_ADMISSION_VERDICT

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
          keepPendingReason(h, d.pending_reason)   // ⭐ why, for the window's words (a malformed one is dropped)
          if (_attempt + 1 >= RUNTIME_ADMISSION_PENDING_RETRIES) return null
          return { retry: true }
        }
        // ⭐ G6 — `historyOnly` (the ids admitted for closed-bar history only) latches as ONE boolean.
        // ⛔ FAIL CLOSED: anything present that is not an empty list reads as history-only.
        const historyOnly = d.historyOnly !== undefined
          && !(Array.isArray(d.historyOnly) && d.historyOnly.length === 0)
        latchRuntimeAdmission(h, { admitted: d.admitted === true, historyOnly })
        return _verdicts.get(h) || null
      })
      .catch(noAdmissionVerdict)
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

/** ⭐ Re-review F2 — keep asking about ONE source until a verdict lands: now (after `delayMs`), and
 *  then on the lists' recheck interval while the answer is still "being checked", so a preview stuck
 *  pending recovers without an edit or a remount. `onVerdict(v)` fires once, with the latched verdict.
 *  Returns a cancel function. Never throws. */
export function watchRuntimeAdmission(source, onVerdict, { delayMs = 0, recheckMs = RUNTIME_LISTS_RECHECK_MS } = {}) {
  let alive = true
  let timer = null
  // ⭐ (2026-11-18, the first-paste race) no verdict yet: ask again SOON, then less often, up to the recheck. ⚰️ After
  // the server's busy detector answered "still being checked" five times (about 6 s), the next ask waited the full
  // recheck (60 s), and the first paste of a script the server had not met yet stayed the host copy for a minute.
  let wait = RUNTIME_ADMISSION_PENDING_RETRY_MS * 2
  const again = () => {
    const w = Math.min(recheckMs, wait)
    wait = Math.min(recheckMs, wait * 2)
    timer = setTimeout(ask, w)
  }
  const ask = () => {
    if (!alive) return
    Promise.resolve(requestRuntimeAdmission(source)).then((v) => {
      if (!alive) return
      if (v) { onVerdict(v); return }
      again()
    }).catch(() => { if (alive) again() })
  }
  timer = setTimeout(ask, delayMs)
  return () => { alive = false; if (timer) clearTimeout(timer) }
}

/** ⭐ (2026-11-18, the first-paste race) — whether a CONSULT for this script answered "still being checked" and
 *  would still answer so: a build minted on that answer is waiting for the admission verdict. False for a script no
 *  consult asked about (a door that never asked does not wait), and false once the answer changed (a verdict landed,
 *  the allowlist names it, admission switched off). The condition is `runtimeNotGradedOf`'s own "still being
 *  checked" branch, and a rail holds the two to each other over every state. */
export function runtimeConsultPendingOf({ source, hash } = {}) {
  const h = typeof hash === 'string' && hash ? hash.toLowerCase()
    : (typeof source === 'string' ? runtimeSourceHash(source) : '')
  if (!h || !_consultedPending.has(h)) return false
  if (_allow === ALLOW_ANY || !_capabilityAdmission) return false
  if (_allow.some((e) => h.startsWith(e))) return false
  return !_verdicts.has(h)
}

/** How long an Add pressed before a script's admission answered waits for the answer (MemberPane). */
export const RUNTIME_ADMISSION_ATTACH_WAIT_MS = 20000

/** ⭐ (2026-11-18, the first-paste race) — wait for this script's admission verdict: at once when no consult is
 *  waiting on one, else asking (`watchRuntimeAdmission`) until a verdict lands or `timeoutMs` runs out. Resolves to
 *  the latched verdict or null. Never rejects. */
export function awaitRuntimeAdmission(source, { timeoutMs = RUNTIME_ADMISSION_ATTACH_WAIT_MS } = {}) {
  if (!runtimeConsultPendingOf({ source })) return Promise.resolve(runtimeAdmissionOf({ source }))
  return new Promise((resolve) => {
    let done = false
    let cancel = null
    let timer = null
    const finish = (v) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      if (cancel) cancel()
      resolve(v || null)
    }
    timer = setTimeout(() => finish(runtimeAdmissionOf({ source })), timeoutMs)
    cancel = watchRuntimeAdmission(source, finish, { delayMs: 0 })
  })
}

/** ⭐ (2026-11-19) Why the server's LAST answer for this script was "still being checked": 'busy' (shared capacity
 *  in use; ask again soon), 'starting' (the server's checker is starting; ask again in a few seconds) or 'paused'
 *  (this script's check is paused after repeated failures; stop re-checking for now). Null when the last answer
 *  carried no reason (an older server), named none of those, or a verdict has landed since. Touches nothing.
 *  @param {{source?: string, hash?: string}} arg */
export function runtimePendingReasonOf({ source, hash } = {}) {
  const h = typeof hash === 'string' && hash ? hash.toLowerCase()
    : (typeof source === 'string' ? runtimeSourceHash(source) : '')
  if (!h) return null
  return _pendingReasons.get(h) || null       // a verdict deletes it (`latchRuntimeAdmission`)
}

/** Rails only. */
export function __resetRuntimeAdmission() {
  _capabilityAdmission = false
  _pendingReasons.clear()
  _verdicts.clear()
  _admissionInFlight.clear()
  _askedAt.clear()
  _consultedPending.clear()
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
      _consultedPending.delete(h)
      _consultedPending.add(h)
      while (_consultedPending.size > RUNTIME_ADMISSION_MAX) _consultedPending.delete(_consultedPending.values().next().value)
      // ⭐ re-review F2 — a source with NO verdict is re-asked on the lists' recheck interval (at most
      // once per interval per hash), so the chart's own consults recover too
      if (typeof source === 'string' && Date.now() - (_askedAt.get(h) || 0) >= RUNTIME_LISTS_RECHECK_MS) {
        _askedAt.set(h, Date.now())
        while (_askedAt.size > RUNTIME_ADMISSION_MAX) _askedAt.delete(_askedAt.keys().next().value)
        requestRuntimeAdmission(source)
      }
      return `this script (sha256 ${h.slice(0, 12)}…) is still being checked against the parts of `
        + 'Pine graded against TradingView, so it is not drawn bar by bar yet'
    }
  }
  return `this script (sha256 ${h ? h.slice(0, 12) : '?'}…) has not yet been graded against `
    + 'TradingView, so it is not drawn bar by bar'
}

// ─── ⭐⭐ G6 (coordinator ruling 2026-11-15) — CLOSED-BAR HISTORY ONLY ───────────────
// `realtime-state` (barstate.*, timenow, ...) is admitted by capability on CLOSED-BAR
// evidence only: no capture grades what a script does on a FORMING bar. A script the
// server admitted with `historyOnly` is therefore drawn bar by bar only while this chart's
// newest bar is KNOWN to be closed (`newestBarIsForming === false`); on a forming bar, or
// when nobody has said, every run door refuses it BY NAME with the sentence below.
// ⛔ Admission by capability only: a script on the graded allowlist (its OWN capture) and
// the test grant are not asked. The kill list and "not graded" are asked first, elsewhere.

/** The guard a refused forming-bar run carries (runtime documents, run halves, run colours). */
export const RUNTIME_FORMING_GUARD = 'pane:forming-ungraded'

/** Why this script is NOT drawn bar by bar on THIS chart's newest bar (G6), or null.
 *  @param {{source?: string, hash?: string, newestBarIsForming?: boolean|null}} arg */
export function runtimeFormingRefusalOf({ source, hash, newestBarIsForming } = {}) {
  if (_allow === ALLOW_ANY || !_capabilityAdmission) return null
  const h = typeof hash === 'string' && hash ? hash.toLowerCase()
    : (typeof source === 'string' ? runtimeSourceHash(source) : '')
  if (!h || _allow.some((e) => h.startsWith(e))) return null
  const v = _verdicts.get(h)
  if (!v || !v.admitted || !v.historyOnly) return null
  if (newestBarIsForming === false) return null
  return newestBarIsForming === true
    ? 'this script reads the state of the bar as it forms (barstate or the clock), and that has only '
      + 'been checked against TradingView on finished bars, so it is not drawn bar by bar while this '
      + "chart's newest bar is still forming"
    : 'this script reads the state of the bar as it forms (barstate or the clock), and that has only '
      + "been checked against TradingView on finished bars; this chart cannot say yet whether its newest "
      + 'bar has finished, so the script is not drawn bar by bar'
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
