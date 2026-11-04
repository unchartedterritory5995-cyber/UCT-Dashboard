// ── NLM-1 "Flexible understanding" · the DARK switch (two keys, both default OFF) ──────────────────────────────
//
//   server   UCT_AGENT_ROUTING_V2=1  → GET /api/agent/config `routing_v2: true`
//   browser  localStorage `uct.agent.routingV2 = '1'`   (window.__uctAgentRoutingV2(true | false | null))
//
// Only BOTH on selects routing v2 (and the NLM-1 conversational readers). Anything else — either key off, the config
// not answered, storage unavailable — is v1, byte-identical (nlm1/routingV1Identity.test.js).
import { serverRoutingV2 } from '../agentClient'
import { routeManifest } from '../routing'
import { routeManifestV2 } from './routingV2'

export const ROUTING_V2_KEY = 'uct.agent.routingV2'

export function browserRoutingV2() {
  try { return globalThis.localStorage?.getItem(ROUTING_V2_KEY) === '1' } catch { return false }
}
export const routingV2Active = () => serverRoutingV2() && browserRoutingV2()

/** The router this turn uses: v1's routeManifest unless both keys are on. */
export const pickRouter = () => (routingV2Active() ? routeManifestV2 : routeManifest)

export function setRoutingV2(on) {
  try {
    if (on === true) localStorage.setItem(ROUTING_V2_KEY, '1')
    else if (on === false) localStorage.setItem(ROUTING_V2_KEY, '0')
    else localStorage.removeItem(ROUTING_V2_KEY)
  } catch { /* storage unavailable: stays off */ }
  return routingV2Active()
}
if (typeof window !== 'undefined') window.__uctAgentRoutingV2 = setRoutingV2
