// ─── THE DARK SWITCH FOR UCT AGENT ───────────────────────────────────────────
//
// Same per-browser runtime-flag shape as createIndicatorFlag.js. DEFAULT OFF,
// and the button also requires `role === 'admin'` — two keys, like Create
// Indicator. The owner opts ONE browser in from DevTools:
//
//   window.__uctAgent(true)    // show the UCT Agent button on /charts
//   window.__uctAgent(false)   // hide it
//   window.__uctAgent(null)    // clear the override (= default, off)
//
// Rendering gate only. Every /api/agent/* route is require_paid + require_admin
// on the server, whatever this says.

import { useSyncExternalStore } from 'react'

export const AGENT_FLAG_KEY = 'uct.feature.agent'
export const AGENT_FLAG_EVENT = 'uct-agent-flag'
export const AGENT_OPEN_KEY = 'uct.agent.open'
export const AGENT_CONVERSATION_KEY = 'uct.agent.conversation'
// An Agent change to the board that STARTED but never reached its receipt (the page reloaded or
// closed mid-Apply). See useAgent "INTERRUPTED EXECUTION".
export const AGENT_INFLIGHT_KEY = 'uct.agent.inflight'
const DEFAULT_ON = false

export function resolveAgentFlag() {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(AGENT_FLAG_KEY) : null
    if (v === '1') return true
    if (v === '0') return false
  } catch { /* storage unavailable → default */ }
  return DEFAULT_ON
}

export function setAgentFlag(on) {
  try {
    if (on === true) localStorage.setItem(AGENT_FLAG_KEY, '1')
    else if (on === false) localStorage.setItem(AGENT_FLAG_KEY, '0')
    else localStorage.removeItem(AGENT_FLAG_KEY)
  } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(AGENT_FLAG_EVENT)) } catch { /* ignore */ }
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
  return useSyncExternalStore(subscribe, resolveAgentFlag, () => DEFAULT_ON)
}

// Per-viewer conveniences (never state that must be shared or durable).
export function readLocal(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v } catch { return fallback }
}
export function writeLocal(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, String(value)) } catch { /* ignore */ }
}
