// Test support (Task 9.16): a fake routines and trackers server behind `fetch`, shaped as
// api/routers/notebook_routines.py answers. Nothing reaches the network. Each test can make the NEXT answer to a route
// a refusal with `net.refuseNext(method, path, status, detail)`; every request is recorded in `net.calls`.
import { vi } from 'vitest'

export const STARTERS = [
  { key: 'premarket', name: 'Pre-market routine', items: [
    { text: 'Read the morning wire', negative: false, suggest: null },
    { text: "Check today's economic calendar", negative: false, suggest: null },
    { text: 'Review open positions and stops', negative: false, suggest: null },
    { text: 'Mark key levels on my watchlist', negative: false, suggest: null },
    { text: 'Set my max loss for today', negative: false, suggest: null },
  ] },
  { key: 'preentry', name: 'Pre-entry checks', items: [
    { text: 'The setup is in my playbook', negative: false, suggest: null },
    { text: 'My stop is set before entry', negative: false, suggest: null },
  ] },
  { key: 'eod', name: 'End-of-day review', items: [{ text: 'Log every trade', negative: false, suggest: null }] },
  { key: 'rules', name: 'Rules I keep', items: [
    { text: 'Max 3 trades', negative: false, suggest: { rule: 'max_trades', n: 3 } },
    { text: 'No revenge trades', negative: true, suggest: { rule: 'no_revenge' } },
  ] },
]

export function routine(over = {}) {
  return {
    id: 'r1', name: 'Pre-market routine', etag: 7, archived: false, deleted: false, usedIn: 2,
    items: [
      { id: 'i1', text: 'Read the morning wire', negative: false, suggest: null },
      { id: 'i2', text: 'No revenge trades', negative: true, suggest: { rule: 'no_revenge' } },
    ],
    schedule: { kind: 'every' },
    settings: { done_share: 1, strict: false, reminder: null },
    createdDay: '2026-10-20', updatedAt: '2026-10-24T12:00:00Z', sourceTemplateKey: null,
    ...over,
  }
}

export function tracker(over = {}) {
  return {
    id: 't1', name: 'Sleep', kind: 'number', unit: 'hours', settings: { days: 'trading' }, etag: 3,
    archived: false, deleted: false, readOnly: false, usedIn: 1, createdDay: '2026-10-20',
    updatedAt: '2026-10-24T12:00:00Z', sourceTemplateKey: null,
    ...over,
  }
}

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

/** Install the fake server. `tools` maps an id to its stored tool; `labels` are the day rules to import. */
export function installServer({ tools = {}, labels = ['Stop on every trade', 'No trades in the first 5 minutes'] } = {}) {
  const store = new Map(Object.entries(tools))
  const once = []
  const net = {
    calls: [],
    store,
    refuseNext(method, path, status, detail) { once.push({ method, path, status, detail }) },
    sent(method, path) { return net.calls.filter((c) => c.method === method && (path === undefined || c.path === path)) },
  }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    const path = String(url).split('?')[0]
    const body = init.body ? JSON.parse(init.body) : undefined
    net.calls.push({ method, path, url: String(url), body, headers: init.headers || {} })
    const hit = once.findIndex((o) => o.method === method && o.path === path)
    if (hit >= 0) {
      const [o] = once.splice(hit, 1)
      return res(o.status, { detail: o.detail })
    }
    const m = /^\/api\/j2\/(routines|trackers)(?:\/([^/]+))?(?:\/([a-z-]+))?$/.exec(path)
    if (!m) return res(404, { detail: 'Not Found' })
    const [, kind, rawId, action] = m
    const id = rawId ? decodeURIComponent(rawId) : null
    if (kind === 'routines' && id === 'starters') return res(200, { starters: STARTERS })
    if (kind === 'routines' && id === 'import-day-rules') return res(200, { labels })
    if (!id) {
      if (method === 'GET') return res(200, { [kind]: [...store.values()] })
      const made = kind === 'routines'
        ? routine({ id: 'r-new', etag: 1, usedIn: 0, ...body, items: (body.items || []).map((it, i) => ({ id: `n${i}`, ...it })) })
        : tracker({ id: 't-new', etag: 1, usedIn: 0, unit: null, ...body })
      store.set(made.id, made)
      return res(200, made)
    }
    const tool = store.get(id)
    if (!tool) return res(404, { detail: 'Not Found' })
    if (!action && method === 'GET') return res(200, tool)
    if (!action && method === 'PUT') {
      const etag = Number(init.headers?.['If-Match'])
      if (etag !== tool.etag) return res(409, { detail: { code: 'conflict', message: 'Changed in another tab. Reload to see the newer version.' } })
      const next = { ...tool, ...body, etag: tool.etag + 1 }
      store.set(id, next)
      return res(200, next)
    }
    if (action === 'used-in') {
      return res(200, { notes: Array.from({ length: tool.usedIn || 0 }, (_, i) => ({ noteId: `n${i + 1}`, title: `Note ${i + 1}`, updatedAt: '2026-10-24T12:00:00Z' })) })
    }
    if (action === 'archive') { const next = { ...tool, archived: true }; store.set(id, next); return res(200, next) }
    if (action === 'unarchive') { const next = { ...tool, archived: false }; store.set(id, next); return res(200, next) }
    if (action === 'delete') { store.set(id, { ...tool, deleted: true }); return res(200, { id, deletedAt: '2026-10-24T12:00:00Z' }) }
    if (action === 'undelete') { const next = { ...tool, deleted: false }; store.set(id, next); return res(200, next) }
    if (action === 'duplicate') {
      const copy = { ...tool, id: `${id}-copy`, name: `${tool.name} copy`, etag: 1, usedIn: 0, archived: false }
      store.set(copy.id, copy)
      return res(200, copy)
    }
    return res(404, { detail: 'Not Found' })
  })
  return net
}
