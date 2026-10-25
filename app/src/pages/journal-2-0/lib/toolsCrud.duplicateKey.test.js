// Task 9.6c (ruling W9-R48): a routine or tracker Duplicate carries ONE `Idempotency-Key` per member intent
// (`duplicate:<kind>:<id>`), the same rule as R-50's keyedSender: the SAME key while the earlier answer is unconfirmed
// (a network error, an aborted request, a bare 5xx), a FRESH key after any confirmed answer (any 2xx, any 4xx including
// the server's 409 for a reused key, a 5xx carrying our code). Every assertion reads what the server is SENT (the header)
// or what the caller gets back; nothing reads module state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const api = vi.hoisted(() => ({ toolEdited: vi.fn() }))
vi.mock('./blocks/toolsApi', async (orig) => ({ ...(await orig()), toolEdited: api.toolEdited }))

import { duplicateTool, CRUD_COPY } from './toolsCrud'

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
// The server's own sentence for a reused key (api/services/journal_two/tool_create_keys.S_KEY_REUSED, W9-R53).
const S_KEY_REUSED = 'That Duplicate was already sent for a different routine or tracker. Press Duplicate again to copy this one.'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const bare = (status) => ({ ok: false, status, json: async () => { throw new SyntaxError('<html>Bad gateway</html>') } })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
let fetchMock
let n = 0
/** A source id no other test has pressed, so one test's unconfirmed intent never carries into the next. */
const fresh = () => `src${(n += 1)}`
beforeEach(() => {
  setOnline(true)
  fetchMock = vi.fn(async () => json(200, { id: 'copy' }))
  globalThis.fetch = fetchMock
  api.toolEdited.mockReset()
})
afterEach(() => { setOnline(true); vi.unstubAllGlobals() })

const keyOf = (i) => (fetchMock.mock.calls[i][1] || {}).headers?.['Idempotency-Key']
const urlOf = (i) => fetchMock.mock.calls[i][0]

describe('duplicateTool sends one key per intent', () => {
  it('sends Idempotency-Key, a uuid4, on both kinds, to the literal route', async () => {
    const r = fresh()
    const t = fresh()
    await duplicateTool('routine', r)
    await duplicateTool('tracker', t)
    expect(urlOf(0)).toBe(`/api/j2/routines/${r}/duplicate`)
    expect(urlOf(1)).toBe(`/api/j2/trackers/${t}/duplicate`)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(keyOf(0)).toMatch(UUID4)
    expect(keyOf(1)).toMatch(UUID4)
    expect(keyOf(0)).not.toBe(keyOf(1))
  })

  it('two presses with a LOST first answer resend the SAME key, so the server makes exactly one copy', async () => {
    // A fake server that keeps its own (key -> copy) table, as tool_create_keys does: a repeat of a key replays.
    const made = new Map()
    globalThis.fetch = fetchMock = vi.fn(async (url, init) => {
      const k = init.headers['Idempotency-Key']
      const replayed = made.has(k)
      if (!replayed) made.set(k, { id: `copy${made.size + 1}`, name: 'Sleep copy' })
      if (fetchMock.mock.calls.length === 1) throw new TypeError('Failed to fetch')   // the answer is lost
      return json(200, { ...made.get(k), ...(replayed ? { replayed: true } : {}) })
    })
    const id = fresh()
    const first = await duplicateTool('tracker', id)
    expect(first).toEqual({ ok: false, code: 'network', message: CRUD_COPY.network })
    const second = await duplicateTool('tracker', id)
    expect(keyOf(1)).toBe(keyOf(0))
    expect(made.size).toBe(1)                                        // ONE copy on the server
    expect(second).toEqual({ ok: true, data: { id: 'copy1', name: 'Sleep copy', replayed: true } })
  })

  it('a bare 5xx (from in front of the app) is unconfirmed too: the retry carries the same key', async () => {
    const id = fresh()
    fetchMock.mockResolvedValueOnce(bare(502))
    expect((await duplicateTool('routine', id)).ok).toBe(false)
    await duplicateTool('routine', id)
    expect(keyOf(1)).toBe(keyOf(0))
  })

  it('a fresh press after a confirmed answer gets a NEW key: a 2xx, a 4xx and a 5xx carrying our code', async () => {
    const id = fresh()
    fetchMock
      .mockResolvedValueOnce(json(200, { id: 'c1' }))
      .mockResolvedValueOnce(json(409, { detail: { code: 'count_cap', message: 'SERVER: the cap.' } }))
      .mockResolvedValueOnce(json(503, { detail: { code: 'busy', message: 'SERVER: busy.' } }))
      .mockResolvedValueOnce(json(200, { id: 'c2' }))
    for (let i = 0; i < 4; i += 1) await duplicateTool('routine', id)
    expect(new Set([keyOf(0), keyOf(1), keyOf(2), keyOf(3)]).size).toBe(4)
  })

  it('a 4xx with no readable body is still a confirmed answer (the app answered): the next press takes a new key', async () => {
    const id = fresh()
    fetchMock.mockResolvedValueOnce(bare(400)).mockResolvedValueOnce(bare(413))
    expect(await duplicateTool('routine', id)).toEqual({ ok: false, code: 'network', message: CRUD_COPY.network })
    await duplicateTool('routine', id)
    await duplicateTool('routine', id)
    expect(new Set([keyOf(0), keyOf(1), keyOf(2)]).size).toBe(3)
  })

  it('a 409 for a reused key shows the server\'s sentence verbatim, and the next press works under a fresh key', async () => {
    const id = fresh()
    fetchMock
      .mockResolvedValueOnce(json(409, { detail: { code: 'conflict', message: S_KEY_REUSED } }))
      .mockResolvedValueOnce(json(200, { id: 'c9', name: 'Sleep copy' }))
    expect(await duplicateTool('tracker', id)).toEqual({ ok: false, code: 'conflict', message: S_KEY_REUSED })
    expect(await duplicateTool('tracker', id)).toEqual({ ok: true, data: { id: 'c9', name: 'Sleep copy' } })
    expect(keyOf(1)).not.toBe(keyOf(0))
    expect(api.toolEdited.mock.calls).toEqual([['tracker', 'c9']])   // only the landed copy is announced
  })

  it('the intent is the kind AND the id: another source, or the other kind, never reuses a pending key', async () => {
    const id = fresh()
    const other = fresh()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))     // every answer lost: each intent keeps its key
    await duplicateTool('routine', id)
    await duplicateTool('tracker', id)
    await duplicateTool('routine', other)
    await duplicateTool('routine', id)
    expect(new Set([keyOf(0), keyOf(1), keyOf(2)]).size).toBe(3)
    expect(keyOf(3)).toBe(keyOf(0))
  })

  it('offline sends nothing, and an unknown kind sends nothing', async () => {
    setOnline(false)
    expect(await duplicateTool('routine', fresh())).toEqual({ ok: false, code: 'offline', message: CRUD_COPY.offline })
    setOnline(true)
    expect((await duplicateTool('widget', fresh())).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the key outside a secure context', () => {
  it('no crypto.randomUUID (an http page): still a valid uuid4', async () => {
    const getRandomValues = (b) => { for (let i = 0; i < b.length; i += 1) b[i] = (i * 37 + 11) & 0xff; return b }
    vi.stubGlobal('crypto', { getRandomValues })
    await duplicateTool('routine', fresh())
    expect(keyOf(0)).toMatch(UUID4)
  })

  it('no crypto at all: still a valid uuid4', async () => {
    vi.stubGlobal('crypto', undefined)
    await duplicateTool('routine', fresh())
    await duplicateTool('routine', fresh())
    expect(keyOf(0)).toMatch(UUID4)
    expect(keyOf(1)).toMatch(UUID4)
    expect(keyOf(1)).not.toBe(keyOf(0))
  })
})
