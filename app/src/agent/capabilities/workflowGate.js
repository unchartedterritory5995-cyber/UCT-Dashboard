// Track D — ADVANCED TRADING WORKFLOWS (dark): the ONE gate every workflow capability registers through.
//
// A workflow registers only when (1) THIS server switches it on by name (UCT_AGENT_WORKFLOWS -> /api/agent/config
// `workflows`, api/services/uct_agent/workflows.py; default off) AND (2) the server serves the data gateway and lists
// every MD-1 kind the workflow reads (`data_kinds`, fail-closed). Either missing → nothing registers, the fast path
// claims nothing and the manifest is exactly what it was. docs/agent/TRADING-WORKFLOWS.md.
import * as agentClient from '../agentClient'
import { GROUPS } from '../routing'

/** The workflow names (api/services/uct_agent/workflows.py NAMES). */
export const WORKFLOWS = ['relativeStrength', 'watchlistChanges', 'setupSnapshot', 'themeRotation']

/** Is `name` switched on by this server AND are all of `kinds` served? Pure over the loaded config. */
export function workflowServed(name, kinds) {
  const on = typeof agentClient.serverWorkflows === 'function' ? agentClient.serverWorkflows() : []
  if (!WORKFLOWS.includes(name) || !on.includes(name)) return false
  if (!agentClient.serverServesData()) return false
  const served = typeof agentClient.serverDataKinds === 'function' ? agentClient.serverDataKinds() : null
  return Array.isArray(served) && kinds.every(k => served.includes(k))
}

/** The fixed closing line of every workflow card. */
export const DESCRIPTIVE = 'Descriptive, not a recommendation.'

// ── routing words, live ONLY while a workflow is registered (the knowledge.js pattern: routing.js is not edited) ──────
// A workflow adds its own words to its group's `words` when it registers and takes exactly those regexes out when it
// is reset, so with the flag off routing is byte-for-byte what it was.
export function armGroupWords(groupId, words, on) {
  const g = GROUPS.find(x => x.id === groupId)
  if (!g || !Array.isArray(g.words)) return
  for (const w of words) {
    const i = g.words.indexOf(w)
    if (on && i < 0) g.words.push(w)
    if (!on && i >= 0) g.words.splice(i, 1)
  }
}
