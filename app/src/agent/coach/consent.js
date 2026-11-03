// ── UCT Agent COACH: per-conversation consent to use the member's journal (W3-3) ─────────────────────────────────
//
// The coach reads the member's journal ONLY after they allowed it in THIS chat ("yes, use my journal"), and stops
// the moment they revoke it ("stop using my journal"). The state is the conversation's own, kept by the server
// (store.STATE_KEYS `coachConsent`: GET/PUT /api/agent/conversations/{id}/state/coachConsent, owner-scoped,
// the server stamps `at`), read once per conversation here and cached. No conversation yet (a brand-new chat
// before its first turn) → nothing can be granted: the member is told to ask something first.

import * as agentClient from '../agentClient'

export const STATE_KEY = 'coachConsent'
const cache = new Map()                   // conversationId -> 'granted' | 'revoked' | 'unknown'

export const _resetConsentForTest = () => cache.clear()
const cid = () => (typeof agentClient.activeConversationId === 'function' ? agentClient.activeConversationId() : null)

/** The consent state of the active conversation, as last read (sync). */
export function consentState() {
  const id = cid()
  return id ? (cache.get(id) || 'unknown') : 'unknown'
}
export const consentGranted = () => consentState() === 'granted'

const stateOf = (value) => (value && typeof value === 'object' && typeof value.granted === 'boolean' ? (value.granted ? 'granted' : 'revoked') : 'unknown')

/** Read the server's record for the active conversation → 'granted' | 'revoked' | 'unknown' (cached). */
export async function readConsent({ force = false } = {}) {
  const id = cid()
  if (!id) return 'unknown'
  if (!force && cache.has(id)) return cache.get(id)
  let st = 'unknown'
  try {
    const r = await agentClient.agentConversationState(id, STATE_KEY)
    st = r?.ok ? stateOf(r.data?.value) : 'unknown'
  } catch { st = 'unknown' }
  cache.set(id, st)
  return st
}

/** Grant or revoke for the active conversation (PUT). Throws with a member sentence when it cannot be stored. */
export async function writeConsent(granted) {
  const id = cid()
  if (!id) throw new Error('ask me something first, then say “yes, use my journal” — consent belongs to a conversation')
  const r = await agentClient.agentConversationStateSet(id, STATE_KEY, { granted: granted === true })
  if (!r?.ok) throw new Error(r?.error || 'UCT could not store that for this chat')
  const st = stateOf(r.data?.value)
  cache.set(id, st === 'unknown' ? (granted ? 'granted' : 'revoked') : st)
  return cache.get(id)
}
