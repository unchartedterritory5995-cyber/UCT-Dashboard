/**
 * B1 rails — a note server that enforces BOTH of the server's refusals, in the
 * server's order, from the header the client ACTUALLY sent.
 *
 *   1. the schema guard (`notebook_schema.py::check_body_write`, run first): a
 *      body write whose `X-UCT-Notebook-Schema` is below the level the STORED
 *      body needs is a 409 with `SCHEMA_REFUSAL_DETAIL`. A missing or
 *      unparseable header is 0.
 *   2. the compare-and-set on `baseUpdatedAt`: a 409 with the ordinary detail.
 *
 * ⛔ A MODEL, NOT THE SERVER. The table it reads is the client's
 * `NOTEBOOK_TYPE_SCHEMA`, which `tests/test_notebook_schema_guard.py` pins equal
 * to the server's; the refusal itself is railed against the real router there.
 * What this fixture adds is the WIRE: the rails that use it assert on the header
 * a real client function put on a real `fetch` call, never on an argument a mock
 * was handed.
 */
import { NOTEBOOK_SCHEMA_HEADER, NOTEBOOK_TYPE_SCHEMA, SCHEMA_REFUSAL_DETAIL } from '../../notebookSchema'

/** The newest level any node or mark in `body` needs (unknown type ⇒ 0). */
export function requiredLevel(body) {
  let need = 0
  const stack = [body]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (typeof n.type === 'string') need = Math.max(need, NOTEBOOK_TYPE_SCHEMA[n.type] ?? 0)
    for (const m of Array.isArray(n.marks) ? n.marks : []) {
      if (m && typeof m.type === 'string') need = Math.max(need, NOTEBOOK_TYPE_SCHEMA[m.type] ?? 0)
    }
    if (Array.isArray(n.content)) stack.push(...n.content)
  }
  return need
}

/** The server's reading of the header: missing, blank, unparseable or negative ⇒ 0. */
export function declaredLevel(raw) {
  const v = Number.parseInt(String(raw ?? '').trim(), 10)
  return Number.isInteger(v) && v > 0 ? v : 0
}

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

/**
 * @returns a server with `.fetch` to install as `globalThis.fetch`, and the
 *          record of what reached it: `puts` (every PUT to the note, with the
 *          header it carried and the answer it got) and `forks` (every created
 *          note — a `(conflicted copy)` sibling is a create).
 */
export function makeSchemaServer({ id = 'n1', title = 'NVDA thesis', subtitle = '', body, updatedAt }) {
  let rev = 0
  const s = {
    note: { id, title, subtitle, folderId: null, ticker: null, tags: [], heroImageUrl: null, isFavorite: false, bodyJson: body, updatedAt },
    puts: [],
    forks: [],
    /** The stored body, serialised — compare before/after for byte identity. */
    storedBody: () => JSON.stringify(s.note.bodyJson),
    fetch: async (url, init = {}) => {
      const u = String(url)
      const method = (init.method || 'GET').toUpperCase()
      if (u === `/api/j2/notes/${id}` && method === 'GET') return reply(200, { note: { ...s.note } })
      if (u === `/api/j2/notes/${id}` && method === 'PUT') {
        const patch = JSON.parse(init.body || '{}')
        const header = init.headers?.[NOTEBOOK_SCHEMA_HEADER]
        const put = { patch, header: header ?? null, status: 0 }
        s.puts.push(put)
        if (Object.hasOwn(patch, 'bodyJson') && requiredLevel(s.note.bodyJson) > declaredLevel(header)) {
          put.status = 409
          return reply(409, { detail: SCHEMA_REFUSAL_DETAIL })
        }
        if (patch.baseUpdatedAt && patch.baseUpdatedAt !== s.note.updatedAt) {
          put.status = 409
          return reply(409, { detail: 'note changed — refresh and retry' })
        }
        for (const k of ['title', 'subtitle', 'bodyJson']) if (Object.hasOwn(patch, k)) s.note[k] = patch[k]
        rev += 1
        s.note.updatedAt = `2026-09-24T12:00:${String(10 + rev).padStart(2, '0')}.000000+00:00`
        put.status = 200
        return reply(200, { note: { ...s.note } })
      }
      if (u === '/api/j2/notes' && method === 'POST') {
        const created = JSON.parse(init.body || '{}')
        s.forks.push(created)
        return reply(200, { note: { id: `fork-${s.forks.length}`, ...created, updatedAt: '2026-09-24T12:30:00.000000+00:00' } })
      }
      return reply(200, {})
    },
  }
  return s
}
