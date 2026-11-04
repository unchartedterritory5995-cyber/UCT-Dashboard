// ── NLM-1 "Flexible understanding" · ON by default (owner policy 11-04: tested features go live for admins; the Agent
// is admin-only server-side). The two keys are KILL SWITCHES only:
//
//   server   UCT_AGENT_ROUTING_V2=0 (or false / off / no) → GET /api/agent/config `routing_v2: false` — off for everyone
//   browser  localStorage `uct.agent.routingV2 = '0'`  → off in this browser   (window.__uctAgentRoutingV2(false | true | null))
//
// The config not answered (or failed) is v1 too. With either switch off the panel is v1, byte-identical to master
// (nlm1/routingV1Identity.test.js). The in-plan rules keep their own key, default OFF (nlm1/inplan.js).
import { serverRoutingV2 } from '../agentClient'
import { routeManifest } from '../routing'
import { routeManifestV2 } from './routingV2'

export const ROUTING_V2_KEY = 'uct.agent.routingV2'

export function browserRoutingV2() {
  // on unless this browser's kill switch says '0'; storage unavailable → on (the server switch still decides)
  try { return globalThis.localStorage?.getItem(ROUTING_V2_KEY) !== '0' } catch { return true }
}
export const routingV2Active = () => serverRoutingV2() && browserRoutingV2()

/** The router this turn uses: v2 unless a kill switch is off (or the config has not said routing_v2), then v1. */
export const pickRouter = () => (routingV2Active() ? routeManifestV2 : routeManifest)

export function setRoutingV2(on) {
  try {
    if (on === true) localStorage.setItem(ROUTING_V2_KEY, '1')
    else if (on === false) localStorage.setItem(ROUTING_V2_KEY, '0')
    else localStorage.removeItem(ROUTING_V2_KEY)
  } catch { /* storage unavailable: the server switch decides */ }
  return routingV2Active()
}
if (typeof window !== 'undefined') window.__uctAgentRoutingV2 = setRoutingV2
