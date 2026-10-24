// Test fixtures for My tools: the member's widgets in three lists, and a fetch stand-in that answers the
// /api/j2/widget-definitions routes the way the server does ({detail: {code, message}} on a refusal).
import { vi } from 'vitest'

export const URL_BASE = '/api/j2/widget-definitions'

const plan = (view, extra = {}) => ({
  v: 1, source: 'closed_trades', range: { token: 'last_90d' }, measures: ['net_pnl'], view: { type: view, auto: false },
  display: { title: '', titleAuto: true, subtitle: '', accent: 'gold', showN: true, target: null }, ...extra,
})

export const LIVE = [
  {
    id: 'w1', name: 'Net P&L by setup', plan: plan('bar', { split: { by: 'setup' } }), rev: 3, placedRev: 2, etag: 7,
    archived: false, usedIn: 3, lastAnswer: null, summary: 'Net P&L, split by setup, for closed trades in the last 90 days.',
    createdAt: '2025-02-01T17:00:00Z', updatedAt: '2025-03-04T17:00:00Z',
  },
  {
    id: 'w2', name: 'Win rate', plan: plan('number'), rev: 1, placedRev: 1, etag: 1, archived: false, usedIn: 0,
    lastAnswer: null, summary: 'Win rate for closed trades in the last 90 days.',
    createdAt: '2025-02-01T17:00:00Z', updatedAt: '2025-02-10T17:00:00Z',
  },
]
export const ARCHIVED = [
  {
    id: 'a1', name: 'Old edge', plan: plan('table'), rev: 2, placedRev: 2, etag: 4, archived: true, usedIn: 2,
    lastAnswer: null, summary: 'Expectancy by setup.', createdAt: '2025-01-01T17:00:00Z', updatedAt: '2025-01-09T17:00:00Z',
  },
]
export const DELETED = [
  {
    id: 'x1', name: 'Gone', plan: plan('line'), rev: 1, placedRev: 1, etag: 1, archived: true, usedIn: 0,
    lastAnswer: null, summary: 'Equity.', createdAt: '2025-01-01T17:00:00Z', updatedAt: '2025-01-02T17:00:00Z',
    deletedAt: '2025-01-20T17:00:00Z',
  },
]
export const USED_IN = {
  w1: [
    { noteId: 'n1', title: 'Weekly review', updatedAt: '2025-03-03T17:00:00Z' },
    { noteId: 'n2', title: '', updatedAt: '2025-03-01T17:00:00Z' },
    { noteId: 'n3', title: 'Setup notes', updatedAt: '2025-02-20T17:00:00Z' },
  ],
}

const json = (status, body) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
})
export const refuse = (status, code, message) => json(status, { detail: { code, message } })

/**
 * `installFetch(overrides)` stubs fetch. `overrides` is a list of `[method, path, handler]` checked first, `path` the
 * part after URL_BASE (a string, or a RegExp), `handler(req)` returning a response (or a plain body for a 200).
 * Every call is recorded as `{method, url, path, headers, body}` on the returned `calls`.
 */
export function installFetch(overrides = []) {
  const calls = []
  const lists = { live: [...LIVE], archived: [...ARCHIVED], deleted: [...DELETED] }
  const fn = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const u = String(url)
    const path = u.startsWith(URL_BASE) ? u.slice(URL_BASE.length) : u
    const headers = init.headers || {}
    let body = null
    try { body = init.body ? JSON.parse(init.body) : null } catch { body = init.body }
    const req = { method, url: u, path, headers, body }
    calls.push(req)
    for (const [m, p, handler] of overrides) {
      if (m !== method) continue
      if (typeof p === 'string' ? p !== path : !p.test(path)) continue
      const out = await handler(req)
      return out && typeof out.ok === 'boolean' && typeof out.json === 'function' ? out : json(200, out)
    }
    if (method === 'GET') {
      const view = /^\?view=(\w+)$/.exec(path)
      if (view) return json(200, { widgets: lists[view[1]] || [] })
      const used = /^\/([^/]+)\/used-in$/.exec(path)
      if (used) return json(200, { notes: USED_IN[decodeURIComponent(used[1])] || [] })
    }
    return json(404, { detail: 'Not Found' })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls, lists }
}
