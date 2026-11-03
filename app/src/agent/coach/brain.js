// ── UCT Agent COACH × Trading Brain (W3-4b, owner rule 2026-11-03) ───────────────────────────────────────────────
//
// The Wisdom vocabulary is authoritative and the Trading Brain is the source of UCT's setup definitions
// (docs/agent/coach/VOCABULARY-MAP.md). coach.explain therefore PREFERS an approved Brain passage when the server
// serves the gateway kind `knowledge.search` — read strictly through the MD-1 door (marketdata/client.readData, the
// open turn's id). Nothing here imports the knowledge package: the Brain is a gateway kind like any other, and while
// it is not served (`data_kinds` lacks it — UCT_AGENT_KNOWLEDGE off, the kind not enabled, or the gateway dark) this
// module makes NO request and the coach answers exactly as before.
//
// Only a passage's own title, excerpt and source name leave this module; never the envelope, its notes or a figure
// that is not in the passage text (the caller's mirror guard checks the composed answer against its inputs).

import * as agentClient from '../agentClient'
import { readData } from '../marketdata/client'
import { currentTurnId } from '../trace'

export const BRAIN_KIND = 'knowledge.search'
const MAX_Q = 400

/** True only while /api/agent/config lists `knowledge.search` in `data_kinds`. */
export function brainServed() {
  if (!agentClient.serverServesData()) return false
  const kinds = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(kinds) && kinds.includes(BRAIN_KIND)
}

const usable = (env) => !!env && (env.status === 'ok' || env.status === 'partial') && env.data && typeof env.data === 'object'
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

/** The top approved passage for the member's words → { title, excerpt, source, text } | null (never throws). */
export async function brainPassage(question) {
  const q = clean(question, MAX_Q)
  if (!q || !brainServed()) return null
  let env
  try {
    env = await readData('knowledge.search', { question: q, k: 1 }, { purpose: 'answer', turnId: currentTurnId() })
  } catch { return null }
  if (!usable(env)) return null
  const p = Array.isArray(env.data.passages) ? env.data.passages[0] : null
  if (!p || typeof p !== 'object') return null
  const title = clean(p.title, 160), excerpt = clean(p.excerpt, 900), source = clean(p.source, 80)
  if (!excerpt) return null
  const text = `From UCT's playbook${title ? ` — ${title}` : ''}: ${excerpt}${source ? ` (${source})` : ''}`
  return { title, excerpt, source, text }
}
