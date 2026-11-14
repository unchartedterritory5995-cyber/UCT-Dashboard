// CAPABILITY REGRESSION (Mission 2) — the canonical registry, as production builds it.
//
// Two configurations, both read from the REAL register functions (builtins.js), never from a hand list:
//   • PROD_KINDS — production's data kinds (web, 2026-11-03; pinned by agentProdKinds.test.js): what an admin's
//     Agent registers today. The corpus and the golden workflows run under this one.
//   • ALL_KINDS  — every server-gated kind switched on: the WHOLE catalog, dark capabilities included. The
//     inventory and the "a new capability needs a regression entry" rail read this one, so a capability that
//     ships dark is caught the day it ships, not the day its flag flips.
import { vi } from 'vitest'
import { registerBuiltins, registerServerGatedBuiltins } from '../../../builtins'
import { allCapabilityNames } from '../../../capabilities'
import { loadAgentConfig, _resetAgentConfig } from '../../../agentClient'

// ⚠ keep equal to agentProdKinds.test.js PROD_KINDS (inventory.test.js pins the two by reading that file's text)
export const PROD_KINDS = ['instrument.resolve', 'quote', 'quotes', 'bars.daily', 'fundamentals', 'earnings', 'news.company', 'themes',
  'screen.run', 'screen.count', 'screen.saved']
export const ALL_KINDS = [...PROD_KINDS, 'history.eventStudy', 'research.company', 'knowledge.search', 'setup.playbook', 'setup.record',
  'index.quote', 'commodity.quote', 'crypto.quote', 'catalysts.board']

/** PKG2: the data kinds an entry runs under. `"kinds": "ALL"` marks a DARK entry (its kind is not in production's list yet:
 *  history.eventStudy, the asset quotes), run only by corpus.dark.test.jsx with every gated kind on; every other entry
 *  runs under PROD_KINDS. */
export const kindsFor = (entry) => (entry?.kinds === 'ALL' ? ALL_KINDS : PROD_KINDS)
export const isDark = (entry) => entry?.kinds === 'ALL'

/** The /api/agent/config answer for a kinds list (coach on only for the whole catalog). */
export const configFor = (kinds) => ({ stream: false, nl1: false, data: true, scan: kinds.includes('screen.run'), data_kinds: kinds, news: true,
  planner: 'v1', coach: kinds === ALL_KINDS })

/** Registers the built-ins and the server-gated capabilities a server serving `kinds` would activate. */
export async function registerCatalog(kinds = PROD_KINDS) {
  registerBuiltins()
  const ungated = new Set(allCapabilityNames())
  _resetAgentConfig()
  const saved = globalThis.fetch
  globalThis.fetch = vi.fn(async (url) => new Response(JSON.stringify(String(url).endsWith('/api/agent/config') ? configFor(kinds) : {}),
    { status: String(url).endsWith('/api/agent/config') ? 200 : 404, headers: { 'content-type': 'application/json' } }))
  await loadAgentConfig()
  registerServerGatedBuiltins()
  globalThis.fetch = saved
  const all = allCapabilityNames()
  return { all: [...all].sort(), ungated: [...ungated].sort(), gated: all.filter(n => !ungated.has(n)).sort() }
}
