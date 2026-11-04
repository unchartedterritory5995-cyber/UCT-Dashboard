// CAPABILITY REGRESSION (Mission 2) — level (a): what the PRODUCTION routed request carries for a message, built
// exactly as useAgent's legacy routed request builds it (the catalog for the Charts surface, the server's limit and
// the per-request budget, the member's names, the lexicon's typo readings, the last change's actions).
import { manifestFor, MANIFEST_CONTRACT } from '../../../capabilities'
import { routeManifest, routingNames } from '../../../routing'
import { correctTypos, lexiconFor } from '../../../nl/lexicon'

export function routedNames(text, { host = null, recentActions = [], pendingActions = [] } = {}) {
  const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
  const opts = { enabled: true, pendingActions, recentActions, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold,
    names: routingNames(host), correct: (t) => (correctTypos(t, lexiconFor(host)) || []).map(v => v.text) }
  const r = routeManifest(full, text, opts)
  return { names: r.manifest.map(c => c.name), routing: r.routing, overBudget: r.overBudget || [] }
}
