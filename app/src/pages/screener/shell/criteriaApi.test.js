// The door probes are memoised: the Focus layout's Filters drawer mounts both useDescribe and
// CriteriaBox, and each used to ask both doors (grammar x2, compile x2 per open).
import { vi, test, expect, beforeEach } from 'vitest'
import { grammarAvailable, compileAvailable, compileEnglish, parseCriteria, __resetCriteriaProbes } from './criteriaApi'

const answering = ok => vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => ({}) }))

beforeEach(() => { __resetCriteriaProbes() })

test('concurrent and later callers share ONE request per door', async () => {
  const f = answering(true)
  const [a, b] = await Promise.all([grammarAvailable(f), grammarAvailable(f)])
  expect([a, b]).toEqual([true, true])
  expect(await grammarAvailable(f)).toBe(true)
  expect(await compileAvailable(f)).toBe(true)
  expect(await compileAvailable(f)).toBe(true)
  const paths = f.mock.calls.map(([u]) => u)
  expect(paths).toEqual(['/api/screener/grammar', '/api/screener/compile'])
})

test('a closed door is forgotten, so the next caller asks again', async () => {
  const f = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 404 })
    .mockResolvedValueOnce({ ok: true, status: 200 })
  expect(await grammarAvailable(f)).toBe(false)
  expect(await grammarAvailable(f)).toBe(true)
  expect(await grammarAvailable(f)).toBe(true)
  expect(f).toHaveBeenCalledTimes(2)
})

test('a failed request is false, never a throw, and is forgotten', async () => {
  const f = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true })
  expect(await compileAvailable(f)).toBe(false)
  expect(await compileAvailable(f)).toBe(true)
  expect(f).toHaveBeenCalledTimes(2)
})

test('each fetcher gets its own probe (a caller passing its own is never answered from another)', async () => {
  const open = answering(true), dark = answering(false)
  expect(await grammarAvailable(open)).toBe(true)
  expect(await grammarAvailable(dark)).toBe(false)
  expect(open).toHaveBeenCalledTimes(1)
  expect(dark).toHaveBeenCalledTimes(1)
})

test('the default fetcher is the global fetch, probed once', async () => {
  const saved = globalThis.fetch
  globalThis.fetch = answering(true)
  try {
    await Promise.all([grammarAvailable(), grammarAvailable(), compileAvailable(), compileAvailable()])
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/screener/grammar', { credentials: 'include' })
  } finally { globalThis.fetch = saved }
})

test('compile itself is never memoised', async () => {
  const f = vi.fn(async () => ({ ok: true, json: async () => ({ criteria: 'x' }) }))
  await compileEnglish('a', f)
  await compileEnglish('a', f)
  expect(f).toHaveBeenCalledTimes(2)
})

test('a compile answer that says the door shut (404/402/403) forgets the memoised "open" probe', async () => {
  for (const status of [404, 402, 403]) {
    __resetCriteriaProbes()
    const detail = status === 404 ? 'Not Found' : 'The screener requires a paid plan'
    const f = vi.fn(async (url, opts) => (opts?.method === 'POST'
      ? { ok: false, status, json: async () => ({ detail }) }
      : { ok: true, status: 200 }))
    expect(await compileAvailable(f)).toBe(true)
    expect(await compileAvailable(f)).toBe(true)
    const probes = () => f.mock.calls.filter(([u, o]) => u === '/api/screener/compile' && !o?.method).length
    expect(probes()).toBe(1)
    const err = await compileEnglish('x', f).catch(e => e)
    // the message is what it always was; the status rides along
    expect(err.message).toBe(detail)
    expect(err.status).toBe(status)
    await compileAvailable(f)
    expect(probes()).toBe(2)
  }
})

test('a refusal (400/429) or a transient 503 keeps the memoised probe', async () => {
  for (const status of [400, 429, 503]) {
    __resetCriteriaProbes()
    const f = vi.fn(async (url, opts) => (opts?.method === 'POST' ? { ok: false, status, json: async () => ({ detail: 'no' }) } : { ok: true }))
    await compileAvailable(f)
    await compileEnglish('x', f).catch(() => {})
    await compileAvailable(f)
    expect(f.mock.calls.filter(([, o]) => !o?.method)).toHaveLength(1)
  }
})

test('a parse answer that says the grammar door shut (404/402/403) forgets its memoised "open" probe', async () => {
  for (const status of [404, 402, 403]) {
    __resetCriteriaProbes()
    const f = vi.fn(async (url, opts) => (opts?.method === 'POST'
      ? { ok: false, status, json: async () => ({ detail: 'shut' }) }
      : { ok: true, status: 200 }))
    expect(await grammarAvailable(f)).toBe(true)
    const probes = () => f.mock.calls.filter(([u, o]) => u === '/api/screener/grammar' && !o?.method).length
    expect(probes()).toBe(1)
    // the error is what it always was
    const err = await parseCriteria('x', f).catch(e => e)
    expect(err.message).toBe('shut')
    await grammarAvailable(f)
    expect(probes()).toBe(2)
  }
})
test('a parse refusal (400/429) or a transient 503 keeps the grammar probe', async () => {
  for (const status of [400, 429, 503]) {
    __resetCriteriaProbes()
    const f = vi.fn(async (url, opts) => (opts?.method === 'POST' ? { ok: false, status, json: async () => ({ detail: 'no' }) } : { ok: true }))
    await grammarAvailable(f)
    await parseCriteria('x', f).catch(() => {})
    await grammarAvailable(f)
    expect(f.mock.calls.filter(([, o]) => !o?.method)).toHaveLength(1)
  }
})
