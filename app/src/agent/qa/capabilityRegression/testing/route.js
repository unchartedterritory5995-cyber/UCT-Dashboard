// CAPABILITY REGRESSION (Mission 2) — level (a): what the PRODUCTION routed request carries for a message, built
// exactly as useAgent's legacy routed request builds it (the catalog for the Charts surface, the server's limit and
// the per-request budget, the member's names, the lexicon's typo readings, the last change's actions).
import { manifestFor, MANIFEST_CONTRACT } from '../../../capabilities'
import { routeManifest, routingNames } from '../../../routing'
import { correctTypos, lexiconFor } from '../../../nl/lexicon'
import { routeManifestV2 } from '../../../nlm1/routingV2'

// NLM-1 D1: `v2: true` routes with routing v2 (the dark UCT_AGENT_ROUTING_V2 path); `after` = the pending question's groups
export function routedNames(text, { host = null, recentActions = [], pendingActions = [], v2 = false, after = null, surface = 'charts' } = {}) {
  const full = manifestFor({ surface, createIndicator: true, manageIndicators: true })
  const opts = { enabled: true, pendingActions, recentActions, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold,
    names: routingNames(host), correct: (t) => (correctTypos(t, lexiconFor(host)) || []).map(v => v.text) }
  if (after) opts.after = after
  const r = (v2 ? routeManifestV2 : routeManifest)(full, text, opts)
  return { names: r.manifest.map(c => c.name), routing: r.routing, overBudget: r.overBudget || [], v2: r.v2 || null }
}
