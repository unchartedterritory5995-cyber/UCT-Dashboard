// Wave 8 (Task 8.15): test fixtures for the widget builder — the server's real catalog and a fetch router.
// Tests only; nothing in the product imports this file.
import { vi } from 'vitest'
import SERVER_CATALOG from './serverCatalog.json'

/** The REAL catalog the server serves, generated from `_static_vocabulary()` (tests/test_widget_definitions_router.py
 *  `test_builder_server_catalog_fixture_is_current` fails when it is stale and names the command that refreshes it). */
export const CATALOG = SERVER_CATALOG
export const REASONS = SERVER_CATALOG.reasons

export const SUMMARY = 'Net P&L for closed trades in the last 90 days, all accounts. 47 trades.'

/** A preview / run payload in the server's shape (widget_engine/payload.py), Number view. */
export function payload(over = {}) {
  return {
    asOf: '2026-10-24T14:00:00Z', source: 'manual', sourceKey: 'closed_trades', view: 'number',
    title: 'Net P&L, last 90 days', summary: SUMMARY, defId: null, defRev: null, latestRev: null,
    def: { v: 1, source: 'closed_trades' }, scopeLabel: 'All accounts', rangeLabel: 'Last 90 days',
    range: null, accountId: null, filter: null, count: 47, capped: false, sample: false, notice: null,
    truncated: 0, measures: [{ label: 'Net P&L', unit: 'trades', kind: 'sum', fmt: 'money' }],
    value: { v1: 2140, n1: 47, s1: '' }, compare: null, compareLabel: null, rows: [], series: [], points: [],
    cells: [], coverage: [null], footnotes: [], empty: null, defaultName: 'Net P&L, last 90 days',
    sourceDetail: 'Your closed trades in the Journal.',
    ...over,
  }
}

/** A fetch answer the client reads (`ok`, `status`, `json()`). */
export const answer = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data })
export const refusal = (status, code, message = '') => answer({ detail: { code, message } }, status)

/** A deferred answer: `.promise` for fetch, `.resolve(data, status)` later. */
export function deferred() {
  let res
  const promise = new Promise((r) => { res = r })
  return { promise, resolve: (data, status = 200) => res({ ok: status < 400, status, json: async () => data }) }
}

/**
 * A fetch router: `routes` is a list of `[method, test(url), reply(url, init)]`, consulted first to last after the
 * per-test ones. Every call is recorded on `fetchSpy.mock.calls`.
 */
export function installFetch(extra = []) {
  const routes = [
    ...extra,
    ['GET', (u) => u.endsWith('/vocabulary'), () => answer(CATALOG)],
    ['GET', (u) => u.includes('/vocabulary?field=setup'), () => answer({ field: 'setup', values: ['Flag', 'VCP', '__proto__'] })],
    ['GET', (u) => u === '/api/j2/accounts', () => answer({ accounts: [{ id: 'a1', name: 'Swing' }] })],
    ['POST', (u) => u.endsWith('/preview'), () => answer(payload())],
  ]
  const spy = vi.fn((url, init = {}) => {
    const method = init.method || 'GET'
    const u = String(url)
    const hit = routes.find(([m, test]) => m === method && test(u))
    return hit ? hit[2](u, init) : refusal(500, 'failed')
  })
  vi.stubGlobal('fetch', spy)
  return { spy, routes }
}

export const callsTo = (spy, method, test) => spy.mock.calls.filter(([u, init = {}]) => (init.method || 'GET') === method && test(String(u)))
export const bodyOf = (call) => JSON.parse(call[1].body)
