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
}

/** The list currently latched (tests, diagnostics). */
export function runtimeKillList() {
  return _entries
}

/** The script's identity: the sha256 of its Pine source, UTF-8, as written. */
export function runtimeSourceHash(source) {
  return sha256Hex(String(source == null ? '' : source))
}

/** Why this script is killed, or null.
 *  @param {{source?: string, defId?: string, hash?: string}} arg
 *  @returns {string|null} */
export function runtimeKillOf({ source, defId, hash } = {}) {
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
