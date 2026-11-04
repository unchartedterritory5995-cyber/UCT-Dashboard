// A synthetic, in-memory /api/trade-exchange-news/library server for tests: ONE member's
// bookmarks, collections and notes over a fixed set of synthetic headlines. It mirrors
// library.py's contract (session member only, 404 for unknown ids, idempotent save,
// remove answers what Undo restores). No real data.

export function fakeLibraryServer(headlines) {
  const byId = new Map(headlines.map((h) => [h.id, h]))
  const marks = new Map()            // id -> { event_id, saved_at_ms, note, note_updated_at_ms }
  const cols = new Map()             // cid -> { id, name }
  const items = new Map()            // cid -> Set(id)
  let clock = 1_800_000_000_000
  let n = 0
  const calls = []
  const ok = (body) => ({ ok: true, status: 200, json: async () => body })
  const err = (status, reason, detail) => ({ ok: false, status, json: async () => ({ reason, detail }) })
  const colIds = (id) => [...items.entries()].filter(([, s]) => s.has(id)).map(([c]) => c)
  const mark = (id) => ({ ...marks.get(id), collection_ids: colIds(id) })
  const colRows = () => [...cols.values()].map((c) => ({ ...c, count: items.get(c.id).size }))
    .sort((a, b) => a.name.localeCompare(b.name))

  async function fetch(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase()
    const u = new URL(url, 'http://x')
    const path = u.pathname.replace('/api/trade-exchange-news/library', '')
    const body = init.body ? JSON.parse(init.body) : {}
    calls.push(`${method} ${path}`)
    let m
    if (method === 'GET' && path === '/state') {
      return ok({ ids: [...marks.keys()].reverse(), collections: colRows(), limits: { bookmarks: 5000, collections: 100, name: 60, note: 4000 } })
    }
    if (method === 'GET' && path === '/items') {
      const qs = Object.fromEntries(u.searchParams)        // the request's filters, read as one object
      const q = (qs.q || '').toLowerCase()
      const t = (qs.ticker || '').toUpperCase()
      const c = qs.collection
      if (c && !cols.has(c)) return err(404, 'not_found', 'That collection could not be found.')
      let out = [...marks.keys()].map((id) => ({ ...byId.get(id), id, bookmark: mark(id) }))
      if (q) out = out.filter((i) => i.content.toLowerCase().includes(q) || i.bookmark.note.toLowerCase().includes(q))
      if (t) out = out.filter((i) => (i.tickers || []).includes(t))
      if (c) out = out.filter((i) => items.get(c).has(i.id))
      out.sort((a, b) => b.bookmark.saved_at_ms - a.bookmark.saved_at_ms)
      const limit = Number(qs.limit) || 60
      return ok({ items: out.slice(0, limit), total: out.length, offset: 0, limit })
    }
    if ((m = path.match(/^\/bookmarks\/([^/]+)$/))) {
      const id = decodeURIComponent(m[1])
      if (method === 'GET') return ok({ bookmark: marks.has(id) ? mark(id) : null })
      if (method === 'PUT') {
        if (!byId.has(id)) return err(404, 'not_found', 'That headline could not be found.')
        const created = !marks.has(id)
        if (created) {
          marks.set(id, { event_id: id, saved_at_ms: body.saved_at_ms || ++clock, note: body.note || '', note_updated_at_ms: body.note ? (body.note_updated_at_ms || clock) : null })
          for (const c of body.collection_ids || []) if (cols.has(c)) items.get(c).add(id)
        }
        return ok({ bookmark: mark(id), created })
      }
      if (method === 'DELETE') {
        if (!marks.has(id)) return ok({ removed: null })
        const removed = mark(id)
        marks.delete(id)
        for (const s of items.values()) s.delete(id)
        return ok({ removed })
      }
    }
    if ((m = path.match(/^\/bookmarks\/([^/]+)\/note$/)) && method === 'PUT') {
      const id = decodeURIComponent(m[1])
      if (!marks.has(id)) return err(404, 'not_saved', 'Save the headline before adding a note.')
      marks.get(id).note = (body.note || '').trim()
      marks.get(id).note_updated_at_ms = marks.get(id).note ? ++clock : null
      return ok({ bookmark: mark(id) })
    }
    if (path === '/collections' && method === 'POST') {
      const name = String(body.name || '').trim()
      if (!name) return err(422, 'bad_name', 'Give the collection a name.')
      if ([...cols.values()].some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        return err(409, 'duplicate', `You already have a collection named “${name}”.`)
      }
      const id = `c${++n}`
      cols.set(id, { id, name })
      items.set(id, new Set())
      return ok({ ...cols.get(id), count: 0 })
    }
    if ((m = path.match(/^\/collections\/([^/]+)$/))) {
      const cid = decodeURIComponent(m[1])
      if (!cols.has(cid)) return err(404, 'not_found', 'That collection could not be found.')
      if (method === 'PATCH') { cols.get(cid).name = String(body.name).trim(); return ok({ ...cols.get(cid), count: items.get(cid).size }) }
      if (method === 'DELETE') { cols.delete(cid); items.delete(cid); return ok({ deleted: cid }) }
    }
    if ((m = path.match(/^\/collections\/([^/]+)\/items\/([^/]+)$/))) {
      const [cid, id] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])]
      if (!cols.has(cid)) return err(404, 'not_found', 'That collection could not be found.')
      if (method === 'PUT') {
        if (!marks.has(id)) return err(404, 'not_saved', 'Save the headline before adding it to a collection.')
        items.get(cid).add(id)
      } else items.get(cid).delete(id)
      return ok({ bookmark: marks.has(id) ? mark(id) : null })
    }
    return err(404, 'not_found', 'not found')
  }
  return { fetch, calls, marks, cols, items, headlines: byId }
}
