// UCT Agent market data — the browser side of contract MD-1 (docs/agent/program/contracts/MD-1-market-data.md).
// Owner: agent-md. The ONLY way an Agent capability reads market data: capabilities never fetch() market
// endpoints themselves. Every answer is a DataEnvelope (source, as_of = the DATA's time, freshness class).
//
// Dark: while the server does not serve the gateway (GET /api/agent/config → data: false, the default), this
// answers `refused` locally and makes NO request.
import { agentDataRead, serverServesData } from '../agentClient'

export const CONTRACT = 'MD-1.0'
export const FRESHNESS = ['live', 'delayed', 'periodic', 'historical', 'unavailable']

function refusedLocally(kind, params, reason) {
  return {
    contract: CONTRACT, kind, params_echo: params, status: 'refused', freshness: 'unavailable', as_of: null,
    fetched_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), delay_s: null, stale: false,
    source: 'uct-agent-gateway', coverage: null, data: null, notes: [reason], provider_calls: 0,
  }
}

/** One gateway read. `turnId` groups the reads of one Agent turn (the server's per-turn budget). */
export async function readData(kind, params = {}, { purpose = 'answer', turnId } = {}) {
  if (!serverServesData()) return refusedLocally(kind, params, 'the Agent data gateway is off')
  if (!turnId) return refusedLocally(kind, params, 'a turn id is required')
  const r = await agentDataRead({ kind, params, purpose, turn_id: turnId })
  if (!r.ok || !r.data || typeof r.data !== 'object') return refusedLocally(kind, params, r.error || 'the data gateway did not answer')
  return r.data
}
