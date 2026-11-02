// TEST FIXTURE (owner agent-md): a gateway answer for `instrument.resolve` over symbol-index.json, following MD-1 §4.7.2.
// The SERVER classifier is api/services/uct_agent/marketdata/instruments.py; tests/test_uct_agent_data_instruments.py
// holds it to the same index and to the same outcome column of MD-1-phrasings.md, so this fixture cannot drift from it
// without one of the two suites failing.
import INDEX from './symbol-index.json'

const ROWS = INDEX.rows.map(([sym, name, type]) => ({ sym, name, type }))
const BY_SYM = new Map(ROWS.map(r => [r.sym, r]))
const SUFFIX = /\b(incorporated|inc|corporation|corp|company|co|ltd|limited|plc|holdings?|group|sa|nv|ag|se|lp|llc|trust|the|class [a-z]|common stock|ordinary shares|ads|adr)\b/g
const normName = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
  .replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim()

export function classifyFixture(text, form) {
  const word = String(text).replace(/^\$/, '')
  const sym = word.toUpperCase().replace('.', '-')
  const out = { input: text, form, class: 'unknown', symbol: null, name: null, type: null, candidate: null }
  const row = BY_SYM.get(sym)
  if (row) {
    if (row.type === 'stock' || row.type === 'etf') {
      const info = { symbol: row.sym, name: row.name, type: row.type }
      return form === 'lower' ? { ...out, class: 'symbol_typed_lowercase', candidate: info } : { ...out, class: 'symbol', ...info }
    }
    return { ...out, class: 'non_equity', type: row.type, name: row.name }
  }
  if (form === 'cashtag') return out
  const hits = ROWS.filter(r => (r.type === 'stock' || r.type === 'etf') && normName(r.name) === normName(word))
  return hits.length === 1 ? { ...out, class: 'name_match', candidate: { symbol: hits[0].sym, name: hits[0].name, type: hits[0].type } } : out
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
