// ─── UCT NEWS → UCT AGENT: THE PUBLIC SEAM ───────────────────────────────────
//
// What UCT News imports from the Agent (its NewsAgentContext value is `{ useAsk: useAgentAsk, openAgent }`):
//
//   useAgentAsk({ newsId })  -> { ask(text), turns, busy, error, conversationId, available }
//                               available: true (the server serves headline chats, UCT_AGENT_NEWS), false (it
//                               does not, or the Agent is not available), null (its config is still loading)
//                               turns: [{ id, role: 'member' | 'agent', text }]   plain text, stable ids
//                               error: { text, retry } | null                    a sentence a member can read
//   openAgent({ conversationId })   the main Agent panel, on that same conversation
//   AgentIdentity, canUseAgent      branding and the render gate (News adopts them in a follow-up)
//
// ⛔ Only the headline's ID leaves the browser (`context: {news: {id}}`); the server reads the headline
// itself (api/services/uct_agent/news.py), answers only, and meters it like any Agent turn. Every
// /api/agent/* route is paid + admin on the server, whatever the browser shows.
//
// A thread lives HERE, outside any component, keyed by headline: closing and reopening a headline (or the
// widget remounting) shows the same thread. Its conversation id is kept per headline per ET day in this
// browser, so a reload reopens the same chat from the server's transcript.

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { agentConversation, agentTurn, loadAgentConfig, serverNewsState } from './agentClient'
import { AGENT_CONVERSATION_KEY, AGENT_OPEN_EVENT, AGENT_OPEN_KEY, readLocal, resolveAgentFlag, writeLocal } from './agentFlag'

export { AgentIdentity } from './AgentIdentity'

export const NEWS_ASK_MAX = 500
const FAILED = "UCT Agent couldn't answer that. Try again."
// Refusals that asking again will not change (the server's sentence is shown as it is).
const FINAL = new Set([400, 402, 403, 404, 422])

const EMPTY = Object.freeze({ turns: Object.freeze([]), busy: false, error: null, conversationId: null })
const threads = new Map()
const listeners = new Set()
let seq = 0

const etDay = () => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) } catch { return '' }
}
const keyFor = (newsId) => `uct.agent.news.${etDay()}.${newsId}`

function read(newsId) { return threads.get(newsId) || EMPTY }
function patch(newsId, fn) {
  threads.set(newsId, { ...read(newsId), ...fn(read(newsId)) })
  notify()
}
function subscribe(l) { listeners.add(l); return () => listeners.delete(l) }
const notify = () => { for (const l of listeners) l() }
// The Agent's ONE shared, cached config read (agentClient.loadAgentConfig) — never a request per headline.
let configAsked = false
function askConfig() {
  if (configAsked) return
  configAsked = true
  Promise.resolve(loadAgentConfig()).catch(() => {}).finally(() => { configAsked = false; notify() })
}
const turnId = () => `nt${++seq}`

/** The admin + switch gate News renders behind. Branding only — the server decides every request. */
export function canUseAgent(user) {
  return user?.role === 'admin' && resolveAgentFlag()
}

// A reload: the chat this browser had for this headline today, read back from the server's transcript.
async function restore(newsId) {
  const cid = readLocal(keyFor(newsId))
  if (!cid) return
  const conv = await agentConversation(cid)
  if (!conv || read(newsId).turns.length || read(newsId).busy) return
  const turns = (conv.turns || [])
    .filter(t => (t.role === 'member' || t.role === 'agent') && typeof t.text === 'string' && t.text)
    .map(t => ({ id: `nr${t.id}`, role: t.role, text: t.text }))
  patch(newsId, () => ({ turns, conversationId: cid }))
}
const restored = new Set()

async function ask(newsId, raw) {
  const text = String(raw ?? '').trim()
  const t = read(newsId)
  if (!text || t.busy) return
  if (text.length > NEWS_ASK_MAX) {
    patch(newsId, () => ({ error: { text: `Keep it under ${NEWS_ASK_MAX} characters.`, retry: false } }))
    return
  }
  // Retry: the failed question is already the last line — it is asked again, not shown twice.
  const last = t.turns[t.turns.length - 1]
  const again = t.error && last?.role === 'member' && last.text === text
  patch(newsId, (s) => ({ busy: true, error: null,
    turns: again ? s.turns : [...s.turns, { id: turnId(), role: 'member', text }] }))
  let res
  try {
    res = await agentTurn({ message: text, conversationId: read(newsId).conversationId, context: { news: { id: newsId } } })
  } catch {
    res = { ok: false }
  }
  if (!res?.ok) {
    patch(newsId, () => ({ busy: false,
      error: { text: res?.error || FAILED, retry: !FINAL.has(res?.status) } }))
    return
  }
  const env = res.data.envelope || {}
  const reply = String(env.reply || env.question?.text || '').trim() || FAILED
  const cid = res.data.conversationId || read(newsId).conversationId
  if (cid) writeLocal(keyFor(newsId), cid)
  patch(newsId, (s) => ({ busy: false, conversationId: cid,
    turns: [...s.turns, { id: turnId(), role: 'agent', text: reply }] }))
}

export function useAgentAsk({ newsId } = {}) {
  const id = newsId == null ? '' : String(newsId)
  const thread = useSyncExternalStore(subscribe, () => (id ? read(id) : EMPTY), () => EMPTY)
  const available = useSyncExternalStore(subscribe, serverNewsState, () => null)
  useEffect(() => { if (available === null) askConfig() }, [available])
  useEffect(() => {
    if (!id || restored.has(id)) return
    restored.add(id)
    restore(id).catch(() => {})
  }, [id])
  const send = useCallback((text) => (id ? ask(id, text) : undefined), [id])
  return { ask: send, turns: thread.turns, busy: thread.busy, error: thread.error, conversationId: thread.conversationId, available }
}

/**
 * Open the main UCT Agent panel on this conversation. On /charts the panel opens (or switches) now;
 * anywhere else the browser goes to /charts with the panel open on it. Nothing happens without the
 * Agent switch; the server still refuses anyone but an admin, and another member's id opens nothing.
 */
export function openAgent({ conversationId } = {}) {
  if (typeof conversationId !== 'string' || !conversationId || !resolveAgentFlag()) return
  writeLocal(AGENT_CONVERSATION_KEY, conversationId)
  writeLocal(AGENT_OPEN_KEY, '1')
  if (typeof window === 'undefined') return
  if (!String(window.location?.pathname || '').startsWith('/charts')) {
    window.location.assign('/charts')
    return
  }
  try { window.dispatchEvent(new CustomEvent(AGENT_OPEN_EVENT, { detail: { conversationId } })) } catch { /* ignore */ }
}

export const _resetNewsAsk = () => { threads.clear(); restored.clear(); seq = 0; configAsked = false; notify() }
