// The door probes are memoised: the Focus layout's Filters drawer mounts both useDescribe and
// CriteriaBox, and each used to ask both doors (grammar x2, compile x2 per open).
import { vi, test, expect, beforeEach } from 'vitest'
import { grammarAvailable, compileAvailable, compileEnglish, __resetCriteriaProbes } from './criteriaApi'

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
