// ── NLM-1 · PLUGGABLE ROUTERS for scorers (the held-out scorer, the dev measurement) ──────────────────────────
//
// Every router has routing.selectGroups' interface: (message, { pendingActions, recentActions, names, correct }) →
// { selected, priority, matched, soft }. `matched: false` = the broad fallback (every group a candidate).
//   NLM1_ROUTER=v1     (default) routing.selectGroups — production today
//   NLM1_ROUTER=nlm1   nlm1/routingV2.selectGroupsV2 — the dark UCT_AGENT_ROUTING_V2 candidate
// Packing under the per-request budget: ROUTE_MANIFEST[name] (routeManifest's interface).
import { selectGroups, routeManifest } from '../routing'
import { selectGroupsV2, routeManifestV2 } from './routingV2'

export const ROUTERS = { v1: selectGroups, nlm1: selectGroupsV2 }
export const ROUTE_MANIFEST = { v1: routeManifest, nlm1: routeManifestV2 }

export function routerName(env = globalThis.process?.env) {
  const n = String(env?.NLM1_ROUTER || 'v1').trim()
  if (!ROUTERS[n]) throw new Error(`NLM1_ROUTER=${n}: unknown router (known: ${Object.keys(ROUTERS).join(', ')})`)
  return n
}
/** The selectGroups-shaped router NLM1_ROUTER names (default 'v1'). */
export const routerFromEnv = (env) => ROUTERS[routerName(env)]
/** The routeManifest-shaped packer NLM1_ROUTER names (default 'v1'). */
export const routeManifestFromEnv = (env) => ROUTE_MANIFEST[routerName(env)]
