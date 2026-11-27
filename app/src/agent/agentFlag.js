// ─── THE SWITCHES FOR UCT AGENT: the member door and the per-browser switch ─────────────────────────────────
//
// THE MEMBER DOOR (UCT_AGENT_MEMBERS_ENABLED; decided 2026-11-24 by the integrator under the owner's delegation of
// 2026-11-24, "you decide it all and get it all done"; docs/feature_flags.json). The server's answer, in two halves:
//   • /api/auth/me `uct_agent_members_enabled`: true only for a PAID account while UCT_AGENT_MEMBERS_ENABLED=1, an
//     explicit false otherwise. The FIRST answer, with no request of its own: while it is false a member's browser
//     makes no Agent request at all (exactly as before). AgentProvider publishes it (usePublishAgentDoor).
//   • /api/agent/config `members`, once the Agent has read its config: false (or a refused 403 read) CLOSES the door
//     in an open tab, the emergency off reaching a page that loaded while it was on. It never opens a door the auth
//     payload has not opened.
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

import { useLayoutEffect, useSyncExternalStore } from 'react'

export const AGENT_FLAG_KEY = 'uct.feature.agent'
export const AGENT_FLAG_EVENT = 'uct-agent-flag'
export const AGENT_OPEN_KEY = 'uct.agent.open'
export const AGENT_CONVERSATION_KEY = 'uct.agent.conversation'
// openAgent({conversationId}) (agent/newsAsk.js) on /charts: the workspace opens the panel on that chat.
export const AGENT_OPEN_EVENT = 'uct-agent-open'
// An Agent change to the board that STARTED but never reached its receipt (the page reloaded or
// closed mid-Apply). See useAgent "INTERRUPTED EXECUTION".
export const AGENT_INFLIGHT_KEY = 'uct.agent.inflight'

// ── the member door: module state, the server's answer for the signed-in account ──
let doorAuth = false        // /api/auth/me `uct_agent_members_enabled` (AgentProvider publishes it)
let doorConfig = null       // /api/agent/config `members`: null until it has answered; false also on a refused read

const emit = () => { try { window.dispatchEvent(new Event(AGENT_FLAG_EVENT)) } catch { /* ignore */ } }

/** True only while the server says paid members are let in: the auth payload says so AND the config has not said no. */
export const agentDoorOpen = () => doorAuth === true && doorConfig !== false

/** The auth payload's answer for the signed-in account. A fresh "yes" forgets an older config "no". */
export function publishAgentDoor(open) {
  const v = open === true
  if (v === doorAuth) return
  doorAuth = v
  if (v) doorConfig = null
  emit()
}

/** agentClient.loadAgentConfig: the config's `members` (true / false), false for a refused read, null to forget. */
export function noteAgentDoorConfig(members) {
  const v = members === true ? true : (members === false ? false : null)
  if (v === doorConfig) return
  doorConfig = v
  emit()
}

export const _resetAgentDoor = () => { doorAuth = false; doorConfig = null }

/** This browser's switch: '1' (on), '0' (off) or null (no override: the default). */
export function agentSwitchStored() {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(AGENT_FLAG_KEY) : null
    return v === '1' || v === '0' ? v : null
  } catch { return null }  /* storage unavailable → default */
}

// DEFAULT_ON: on while the server lets members in, off otherwise (before 2026-11-24 a constant false).
const defaultOn = () => agentDoorOpen()

export function resolveAgentFlag() {
  const v = agentSwitchStored()
  if (v === '1') return true
  if (v === '0') return false
  return defaultOn()
}

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

/**
 * Pure: may this account see UCT Agent?  `stored` is this browser's switch ('1' | '0' | null), `door` the server's
 * member door.
 *   · an ADMIN: the switch, whose default is the door (door closed: on only with '1', exactly as before);
 *   · a MEMBER: only while the door is open, on a PAID plan, and not switched off ('0') in this browser.
 */
export function agentAccess({ user = null, isPaid = false, door = false, stored = null } = {}) {
  if (!user) return false
  const switchOn = stored === '1' ? true : (stored === '0' ? false : door === true)
  if (user.role === 'admin') return switchOn
  return door === true && isPaid === true && switchOn
}

const accessSnapshot = () => `${agentSwitchStored() || '-'}|${doorConfig === null ? '-' : (doorConfig ? 1 : 0)}`

/** The render gate every Agent door uses (AgentProvider, /charts, the news widget): the auth payload + this browser. */
export function useAgentAccess(auth) {
  const snap = useSyncExternalStore(subscribe, accessSnapshot, () => '-|-')
  const [stored, config] = snap.split('|')
  // the auth half straight from THIS render's payload (no one-render lag); the config half from the module
  const door = auth?.uctAgentMembersEnabled === true && config !== '0'
  return agentAccess({ user: auth?.user || null, isPaid: auth?.isPaid === true, door, stored: stored === '-' ? null : stored })
}

/** AgentProvider (mounted once): hands the auth payload's door to the readers outside React (openAgent). */
export function usePublishAgentDoor(auth) {
  const open = auth?.uctAgentMembersEnabled === true
  useLayoutEffect(() => { publishAgentDoor(open) }, [open])
}

// Per-viewer conveniences (never state that must be shared or durable).
export function readLocal(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v } catch { return fallback }
}
export function writeLocal(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, String(value)) } catch { /* ignore */ }
}
