// ─── THE SWITCHES FOR UCT AGENT: the member door and the per-browser switch ─────────────────────────────────
//
// THE MEMBER DOOR (UCT_AGENT_MEMBERS_ENABLED; decided 2026-11-24 by the integrator under the owner's delegation of
// 2026-11-24, "you decide it all and get it all done"; docs/feature_flags.json). The server's answer is /api/auth/me
// `uct_agent_members_enabled` (true only for a PAID account while UCT_AGENT_MEMBERS_ENABLED=1), read from the payload's
// `feature_status` list (authDoor): no new AuthContext key, so the Notebook's first open stays inside its byte budget.
// While it is false a member's browser makes no Agent request at all (exactly as before).
//
// THE PER-BROWSER SWITCH (the createIndicatorFlag.js shape), from DevTools:
//
//   window.__uctAgent(true)    // show the UCT Agent button
//   window.__uctAgent(false)   // hide it in this browser
//   window.__uctAgent(null)    // clear the override (= the default)
//
// DEFAULT: ON while the door is open, OFF while it is closed (the admin-only Agent exactly as before 2026-11-24).
//
// WHO SEES THE AGENT (agentAccess): an ADMIN, by the switch (default as above); a PAID MEMBER, only while the door is
// open and the switch is not off in this browser. Rendering gate only. Every /api/agent/* route is require_paid AND
// (admin-only unless UCT_AGENT_MEMBERS_ENABLED=1) on the server, whatever this says.

import { useSyncExternalStore } from 'react'

export const AGENT_FLAG_KEY = 'uct.feature.agent'
export const AGENT_FLAG_EVENT = 'uct-agent-flag'
export const AGENT_OPEN_KEY = 'uct.agent.open'
export const AGENT_CONVERSATION_KEY = 'uct.agent.conversation'
// openAgent({conversationId}) (agent/newsAsk.js) on /charts: the workspace opens the panel on that chat.
export const AGENT_OPEN_EVENT = 'uct-agent-open'
// An Agent change to the board that STARTED but never reached its receipt (the page reloaded or
// closed mid-Apply). See useAgent "INTERRUPTED EXECUTION".
export const AGENT_INFLIGHT_KEY = 'uct.agent.inflight'

// ── the member door (kept small: this file is on the Notebook's first-open bytes) ──
// `dA` is the auth payload's door as the last gate render saw it, for the readers outside React (openAgent).
let dA = false
const emit = () => { try { window.dispatchEvent(new Event(AGENT_FLAG_EVENT)) } catch { /* ignore */ } }

/** The auth payload's door: `feature_status` lists `uct_agent_members_enabled` (released or preview) only while the
 *  server lets this PAID account in (api/routers/auth.py _uct_agent_members_flag; an explicit false is never listed).
 *  The emergency OFF reaches an open tab through the server (every Agent route answers 403 at once) and the next
 *  /api/auth/me (a refocused tab re-reads it), which drops the listing and closes the door. */
export const authDoor = (auth) => !!auth?.featureStatus?.features?.some((f) => f.id === 'uct_agent_members_enabled' && f.state !== 'unknown')

/** The door as the last gate render saw it (outside React). */
export const agentDoorOpen = () => dA
export const _resetAgentDoor = () => { dA = false }

/** This browser's switch: '1' (on), '0' (off) or null (no override: the default). */
export function agentSwitchStored() {
  try { const v = localStorage.getItem(AGENT_FLAG_KEY); return v === '1' || v === '0' ? v : null } catch { return null }
}

// The default (no override): on while the server lets members in, off otherwise (before 2026-11-24 a constant false).
export const resolveAgentFlag = () => { const v = agentSwitchStored(); return v ? v === '1' : dA }

export function setAgentFlag(on) {
  try {
    if (on === true) localStorage.setItem(AGENT_FLAG_KEY, '1')
    else if (on === false) localStorage.setItem(AGENT_FLAG_KEY, '0')
    else localStorage.removeItem(AGENT_FLAG_KEY)
  } catch { /* ignore */ }
  emit()
  return resolveAgentFlag()
}

if (typeof window !== 'undefined') window.__uctAgent = setAgentFlag

function subscribe(cb) {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e) => { if (!e || e.key === AGENT_FLAG_KEY) cb() }
  window.addEventListener(AGENT_FLAG_EVENT, cb)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(AGENT_FLAG_EVENT, cb)
    window.removeEventListener('storage', onStorage)
  }
}

export function useAgentFlag() {
  return useSyncExternalStore(subscribe, resolveAgentFlag, () => false)
}

/** Pure: may this account see UCT Agent? `stored` is this browser's switch ('1' | '0' | null), `door` the member door.
 *  An ADMIN: the switch, whose default is the door (closed: on only with '1', as before). A MEMBER: only while the door
 *  is open, on a PAID plan, and not switched off ('0') in this browser. */
export function agentAccess({ user, isPaid, door, stored } = {}) {
  const on = stored ? stored === '1' : door === true
  return !!user && (user.role === 'admin' ? on : on && door === true && isPaid === true)
}

/** The render gate every Agent door uses (AgentProvider, /charts, the news widget): the auth payload + this browser. */
export function useAgentAccess(auth) {
  const stored = useSyncExternalStore(subscribe, agentSwitchStored, agentSwitchStored)
  dA = authDoor(auth)
  return agentAccess({ user: auth?.user, isPaid: auth?.isPaid, door: dA, stored })
}

// Per-viewer conveniences (never state that must be shared or durable).
export function readLocal(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v } catch { return fallback }
}
export function writeLocal(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, String(value)) } catch { /* ignore */ }
}
