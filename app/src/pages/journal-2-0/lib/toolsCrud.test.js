// Wave 9 Task 9.16: the routine and tracker CRUD client. Every assertion reads what the server is SENT (method, path,
// If-Match, body) or what the caller gets back ({ok, data} | {ok: false, code, message}); nothing reads module state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const api = vi.hoisted(() => ({ unarchive: vi.fn() }))
vi.mock('./blocks/toolsApi', async (orig) => ({ ...(await orig()), unarchive: api.unarchive }))

import {
  listTools, getTool, createTool, saveTool, archiveTool, unarchiveTool, deleteTool, undeleteTool, duplicateTool,
  usedIn, starters, importDayRules, CRUD_COPY,
} from './toolsCrud'
import { TOOL_COPY } from './blocks/toolsApi'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
let fetchMock
beforeEach(() => {
  setOnline(true)
  fetchMock = vi.fn(async () => json(200, {}))
  globalThis.fetch = fetchMock
  api.unarchive.mockReset()
})
afterEach(() => { setOnline(true) })

const sent = (i = 0) => {
  const [url, init = {}] = fetchMock.mock.calls[i]
  return { url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined }
}

describe('toolsCrud: the routes and the bodies', () => {
  it('lists by filter, answering the list itself', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { routines: [{ id: 'r1' }] }))
    expect(await listTools('routine', 'archived')).toEqual({ ok: true, data: [{ id: 'r1' }] })
    expect(sent()).toMatchObject({ url: '/api/j2/routines?filter=archived', method: 'GET' })
    fetchMock.mockResolvedValueOnce(json(200, { trackers: [{ id: 't1' }] }))
    expect(await listTools('tracker')).toEqual({ ok: true, data: [{ id: 't1' }] })
    expect(sent(1)).toMatchObject({ url: '/api/j2/trackers?filter=active', method: 'GET' })
  })

  it('reads one tool, creates one, and saves with If-Match: <etag>', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'r 1', etag: 4 }))
    expect(await getTool('routine', 'r 1')).toEqual({ ok: true, data: { id: 'r 1', etag: 4 } })
    expect(sent(0)).toMatchObject({ url: '/api/j2/routines/r%201', method: 'GET' })
    await createTool('tracker', { name: 'Sleep', kind: 'number' })
    expect(sent(1)).toMatchObject({ url: '/api/j2/trackers', method: 'POST', body: { name: 'Sleep', kind: 'number' } })
    await saveTool('routine', 'r1', 4, { name: 'X' })
    expect(sent(2)).toMatchObject({ url: '/api/j2/routines/r1', method: 'PUT', body: { name: 'X' } })
    expect(sent(2).headers['If-Match']).toBe('4')
  })

  it('a save with no usable etag sends no If-Match (the server answers 428, read as a conflict)', async () => {
    fetchMock.mockResolvedValueOnce(json(428, { detail: { code: 'conflict', message: 'Reload to see the newer version.' } }))
    const out = await saveTool('tracker', 't1', '*', { name: 'X' })
    expect(sent().headers['If-Match']).toBeUndefined()
    expect(out).toEqual({ ok: false, code: 'conflict', message: 'Reload to see the newer version.' })
  })

  it('archive, delete (with the typed name), undelete, duplicate, used-in, starters and the day rules', async () => {
    fetchMock.mockResolvedValue(json(200, { notes: [{ noteId: 'n1' }], starters: [{ key: 'premarket' }], labels: ['A'] }))
    await archiveTool('routine', 'r1')
    await deleteTool('tracker', 't1', 'Sleep')
    await undeleteTool('routine', 'r1')
    await duplicateTool('tracker', 't1')
    expect(await usedIn('routine', 'r1')).toEqual({ ok: true, data: [{ noteId: 'n1' }] })
    expect(await starters()).toEqual({ ok: true, data: [{ key: 'premarket' }] })
    expect(await importDayRules()).toEqual({ ok: true, data: ['A'] })
    expect(fetchMock.mock.calls.map((_, i) => `${sent(i).method} ${sent(i).url}`)).toEqual([
      'POST /api/j2/routines/r1/archive',
      'POST /api/j2/trackers/t1/delete',
      'POST /api/j2/routines/r1/undelete',
      'POST /api/j2/trackers/t1/duplicate',
      'GET /api/j2/routines/r1/used-in',
      'GET /api/j2/routines/starters',
      'GET /api/j2/routines/import-day-rules',
    ])
    expect(sent(1).body).toEqual({ typedName: 'Sleep' })
  })

  it('W9-R42: unarchive is the block layer\'s ONE restore write, never a second fetch', async () => {
    api.unarchive.mockResolvedValueOnce({ ok: true, entry: { id: 'r1', archived: false } })
    expect(await unarchiveTool('routine', 'r1')).toEqual({ ok: true, data: { id: 'r1', archived: false } })
    expect(api.unarchive).toHaveBeenCalledWith('routine', 'r1')
    expect(fetchMock).not.toHaveBeenCalled()
    api.unarchive.mockResolvedValueOnce({ ok: false, code: 'count_cap', message: 'SERVER: the cap.' })
    expect(await unarchiveTool('tracker', 't1')).toEqual({ ok: false, code: 'count_cap', message: 'SERVER: the cap.' })
    api.unarchive.mockRejectedValueOnce(new Error('boom'))
    expect((await unarchiveTool('tracker', 't1')).ok).toBe(false)
  })
})

describe('toolsCrud: refusals carry the server\'s own code and sentence', () => {
  it('the server\'s detail wins; a write\'s 404 is missing, a read\'s 404 is unavailable; 402 is paid; 429 is rate', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { detail: { code: 'count_cap', message: 'SERVER: the cap.' } }))
    expect(await createTool('routine', {})).toEqual({ ok: false, code: 'count_cap', message: 'SERVER: the cap.' })
    fetchMock.mockResolvedValueOnce(json(404, { detail: 'Not Found' }))
    expect(await archiveTool('routine', 'r9')).toEqual({ ok: false, code: 'missing', message: TOOL_COPY.missing })
    fetchMock.mockResolvedValueOnce(json(404, { detail: 'Not Found' }))
    expect(await getTool('routine', 'r9')).toEqual({ ok: false, code: 'unavailable', message: TOOL_COPY.flagOff })
    fetchMock.mockResolvedValueOnce(json(402, { detail: 'Routines and trackers require a paid plan' }))
    expect(await listTools('tracker')).toEqual({ ok: false, code: 'paid', message: CRUD_COPY.paid })
    fetchMock.mockResolvedValueOnce(json(429, {}))
    expect((await saveTool('routine', 'r1', 1, {})).code).toBe('rate')
    fetchMock.mockResolvedValueOnce(json(400, { detail: { code: 'invalid', message: 'SERVER: a field.' } }))
    expect(await saveTool('routine', 'r1', 1, {})).toEqual({ ok: false, code: 'invalid', message: 'SERVER: a field.' })
  })
})

describe('toolsCrud_never_throws_and_offline_no_request', () => {
  it('offline: every call answers the offline sentence and sends NOTHING', async () => {
    setOnline(false)
    const calls = [
      listTools('routine'), getTool('routine', 'r1'), createTool('routine', {}), saveTool('routine', 'r1', 1, {}),
      archiveTool('tracker', 't1'), deleteTool('tracker', 't1', 'x'), undeleteTool('routine', 'r1'),
      duplicateTool('routine', 'r1'), usedIn('tracker', 't1'), starters(), importDayRules(),
    ]
    for (const out of await Promise.all(calls)) expect(out).toEqual({ ok: false, code: 'offline', message: CRUD_COPY.offline })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a thrown fetch, an unreadable answer, a non-object answer and an unknown kind never throw', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await getTool('routine', 'r1')).toEqual({ ok: false, code: 'network', message: CRUD_COPY.network })
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('x') } })
    expect(await getTool('routine', 'r1')).toEqual({ ok: false, code: 'network', message: CRUD_COPY.network })
    fetchMock.mockResolvedValueOnce(json(200, null))
    expect((await getTool('routine', 'r1')).ok).toBe(false)
    fetchMock.mockResolvedValueOnce(json(200, { routines: 'not a list' }))
    expect((await listTools('routine')).ok).toBe(false)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error('html') } })
    expect(await createTool('routine', {})).toEqual({ ok: false, code: 'network', message: CRUD_COPY.network })
    const n = fetchMock.mock.calls.length
    for (const out of await Promise.all([listTools('widget'), getTool(null, 'x'), createTool('x', {}), unarchiveTool('x', 'y')])) {
      expect(out).toEqual({ ok: false, code: 'missing', message: TOOL_COPY.missing })
    }
    expect(fetchMock.mock.calls.length).toBe(n)                  // an unknown kind sends nothing
    const cyclic = {}
    cyclic.self = cyclic
    expect((await createTool('routine', cyclic)).ok).toBe(false)  // a body that cannot be sent is a refusal, not a throw
  })
})
