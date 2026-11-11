// TEST FIXTURE (owner agent-md): a gateway answer for `instrument.resolve`, MD-1 §4.7.2 / §4.7.5.
// Every class comes from symbol-index-resolved.json, which tests/test_uct_agent_data_instruments.py GENERATES from the
// REAL server classifier (api/services/uct_agent/marketdata/instruments.py) over symbol-index.json and holds current.
// There is no second implementation here: a candidate the file lacks THROWS, so a test cannot silently use a guess.
import RESOLVED from './symbol-index-resolved.json'

export function classifyFixture(text, form) {
  const hit = RESOLVED.entries[`${text}|${form}`]
  if (!hit) throw new Error(`symbol-index-resolved.json lacks ${text}|${form}: add it to _CLIENT_EXTRA and regenerate`)
  return { ...hit }
}

/** The gateway's envelope for one instrument.resolve read; `ready: false` = a cold index. */
export function resolveEnvelope(params, { ready = true } = {}) {
  const base = { contract: 'MD-1.0', kind: 'instrument.resolve', params_echo: params, fetched_at: '2026-11-02T16:00:00Z',
    delay_s: null, source: 'uct-symbol-index', coverage: null, provider_calls: 0 }
  if (!ready) return { ...base, status: 'unavailable', freshness: 'unavailable', as_of: null, stale: false, data: null, notes: ['the symbol index is not loaded yet, so no word can be checked'] }
  const results = (params.symbols || []).map(e => classifyFixture(e.text, e.form))
  return { ...base, status: 'ok', freshness: 'periodic', as_of: '2026-11-02T14:00:00Z', stale: false, notes: [],
    data: { results, all_symbols: results.every(r => r.class === 'symbol') } }
}
