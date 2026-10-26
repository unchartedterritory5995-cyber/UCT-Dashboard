// Test fixtures for My tools' Routines and Trackers tabs (Task 9.18): the member's routines and trackers in their three
// lists, and a fetch stand-in that answers /api/j2/routines and /api/j2/trackers the way the server does
// (api/routers/notebook_routines.py: `{routines|trackers: [...]}`, `{detail: {code, message}}` on a refusal, and on
// the active trackers list the two check-in trackers, `readOnly: true`).
import { vi } from 'vitest'

export const ROUTINES = {
  active: [
    {
      id: 'r1', name: 'Morning prep', items: [{ id: 'i1', text: 'Check futures' }], schedule: { kind: 'every' },
      settings: { done_share: 1 }, archived: false, deleted: false, etag: 5, usedIn: 2,
      updatedAt: '2025-03-04T17:00:00Z', sourceTemplateKey: null,
    },
    {
      id: 'r2', name: 'Rules I keep', items: [{ id: 'i2', text: 'No revenge trades' }],
      schedule: { kind: 'weekdays', days: [0, 2, 4] }, settings: {}, archived: false, deleted: false, etag: 1,
      usedIn: 0, updatedAt: '2025-02-10T17:00:00Z', sourceTemplateKey: null,
    },
    {
      // The server's shape (routines._shape): a template KEY and no name. It must read "From a template", never the key.
      id: 'r3', name: 'Trade-day check', items: [{ id: 'i3', text: 'Log every trade' }], schedule: { kind: 'traded' },
      settings: {}, archived: false, deleted: false, etag: 2, usedIn: 1, updatedAt: '2025-02-01T17:00:00Z',
      sourceTemplateKey: 'review',
    },
  ],
  archived: [
    {
      id: 'ra1', name: 'Old routine', items: [], schedule: { kind: 'every' }, settings: {}, archived: true,
      deleted: false, etag: 3, usedIn: 2, updatedAt: '2025-01-09T17:00:00Z', sourceTemplateKey: null,
    },
  ],
  deleted: [
    {
      id: 'rx1', name: 'Gone routine', items: [], schedule: { kind: 'every' }, settings: {}, archived: true,
      deleted: true, etag: 1, usedIn: 0, updatedAt: '2025-01-02T17:00:00Z', sourceTemplateKey: null,
      deletedAt: '2025-01-20T17:00:00Z',
    },
  ],
}

const builtin = (id, name) => ({
  id, name, kind: 'scale', unit: null, settings: { days: 'any' }, archived: false, deleted: false, etag: null,
  readOnly: true, usedIn: 0, createdDay: null, updatedAt: null, sourceTemplateKey: null,
})

export const TRACKERS = {
  // ⚠️ The server lists the two check-in trackers FIRST; this fixture puts one of them last on purpose, so the rail
  // that they are drawn first can fail (the tab puts them first itself, whatever order it is handed).
  active: [
    builtin('checkin:mood', 'Check-in mood'),
    {
      id: 't1', name: 'Sleep', kind: 'duration', unit: null, settings: { days: 'any' }, archived: false, deleted: false,
      etag: 4, readOnly: false, usedIn: 1, updatedAt: '2025-03-04T17:00:00Z', sourceTemplateKey: null,
    },
    {
      id: 't2', name: 'Coffee', kind: 'number', unit: 'cups', settings: { days: 'trading' }, archived: false,
      deleted: false, etag: 2, readOnly: false, usedIn: 0, updatedAt: '2025-02-10T17:00:00Z', sourceTemplateKey: null,
    },
    builtin('checkin:focus', 'Check-in focus'),
  ],
  archived: [
    {
      id: 'ta1', name: 'Old tracker', kind: 'yesno', unit: null, settings: { days: 'trading' }, archived: true,
      deleted: false, etag: 6, readOnly: false, usedIn: 3, updatedAt: '2025-01-09T17:00:00Z', sourceTemplateKey: null,
    },
  ],
  deleted: [
    {
      id: 'tx1', name: 'Gone tracker', kind: 'scale', unit: null, settings: { days: 'trading' }, archived: true,
      deleted: true, etag: 1, readOnly: false, usedIn: 0, updatedAt: '2025-01-02T17:00:00Z', sourceTemplateKey: null,
      deletedAt: '2025-01-20T17:00:00Z',
    },
  ],
}

export const TOOL_USED_IN = {
  r1: [
    { noteId: 'n1', title: 'Weekly review', updatedAt: '2025-03-03T17:00:00Z' },
    { noteId: 'n2', title: '', updatedAt: '2025-03-01T17:00:00Z' },
  ],
  t1: [{ noteId: 'n7', title: 'Sleep log', updatedAt: '2025-03-02T17:00:00Z' }],
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
export const refuse = (status, code, message) => json(status, { detail: { code, message } })

/**
 * `installToolsFetch(overrides)` stubs fetch. `overrides` is a list of `[method, path, handler]` checked first, `path`
 * the part after `/api/j2/` (a string, or a RegExp), `handler(req)` returning a response (or a plain body for a 200).
 * Every call is recorded as `{method, url, path, headers, body}` on the returned `calls`.
 */
export function installToolsFetch(overrides = []) {
  const calls = []
  const data = {
    routines: { active: [...ROUTINES.active], archived: [...ROUTINES.archived], deleted: [...ROUTINES.deleted] },
    trackers: { active: [...TRACKERS.active], archived: [...TRACKERS.archived], deleted: [...TRACKERS.deleted] },
  }
  const fn = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const u = String(url)
    const path = u.startsWith('/api/j2/') ? u.slice('/api/j2/'.length) : u
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
      const list = /^(routines|trackers)\?filter=(\w+)$/.exec(path)
      if (list) return json(200, { [list[1]]: data[list[1]][list[2]] || [] })
      const used = /^(routines|trackers)\/([^/]+)\/used-in$/.exec(path)
      if (used) return json(200, { notes: TOOL_USED_IN[decodeURIComponent(used[2])] || [] })
      const one = /^(routines|trackers)\/([^/?]+)$/.exec(path)
      if (one) {
        const id = decodeURIComponent(one[2])
        const all = Object.values(data[one[1]]).flat()
        const hit = all.find((t) => t.id === id)
        if (hit) return json(200, hit)
      }
    }
    return json(404, { detail: 'Not Found' })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls, data }
}
