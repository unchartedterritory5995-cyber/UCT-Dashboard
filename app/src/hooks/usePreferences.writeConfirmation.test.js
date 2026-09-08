// @vitest-environment jsdom
/* MOB-09's other half — `setPref` learning to say whether the write LANDED.
 *
 * ⛔ WHY THIS IS A SEPARATE CONTRACT WORTH ITS OWN FILE. `useTracingsSync` keeps
 * a highwatermark meaning "the last version the SERVER has seen", and the whole
 * defect was that it advanced on the strength of a request nobody checked. The
 * fix is only as good as this hook's answer, so the answer is gated here rather
 * than inferred from the sync tests passing.
 *
 * ⚠️ AND A NON-OK RESPONSE USED TO READ EXACTLY LIKE SUCCESS. The old body
 * awaited `fetch` and caught only a THROW, so a 401 or a 500 left the optimistic
 * value sitting in the cache forever while the server held the old one — a
 * divergence with no symptom until the next reload. Both failure modes now
 * revert, and both report `false`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let calls = []
let respond = async () => ({ ok: true, json: async () => ({}) })

beforeEach(() => {
  calls = []
  respond = async () => ({ ok: true, json: async () => ({}) })
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url, init })
    if (String(url).includes('/api/auth/preferences') && init?.method === 'POST') return respond()
    return { ok: true, json: async () => ({ preferences: {} }) }
  })
})
afterEach(() => { vi.restoreAllMocks() })

const { default: usePreferences } = await import('./usePreferences')

const write = async (key, value) => {
  const { result } = renderHook(() => usePreferences())
  let out
  await act(async () => { out = await result.current.setPref(key, value) })
  return out
}

describe('setPref reports whether the write landed', () => {
  it('a 2xx returns true', async () => {
    expect(await write('tracings_doc', { updatedAt: 1, doc: {} })).toBe(true)
  })

  it('🔴 a 500 returns FALSE — it used to be indistinguishable from success', async () => {
    respond = async () => ({ ok: false, status: 500, json: async () => ({}) })
    expect(await write('tracings_doc', { updatedAt: 1, doc: {} })).toBe(false)
  })

  it('🔴 a 401 returns FALSE — an expired session is not a completed write', async () => {
    respond = async () => ({ ok: false, status: 401, json: async () => ({}) })
    expect(await write('tracings_doc', { updatedAt: 1, doc: {} })).toBe(false)
  })

  it('a thrown request (offline) returns false', async () => {
    respond = async () => { throw new TypeError('Failed to fetch') }
    expect(await write('tracings_doc', { updatedAt: 1, doc: {} })).toBe(false)
  })

  it('the POST is still made, and still carries a serialised value', async () => {
    // The return value is new; the write behaviour it reports on is not.
    await write('tracings_doc', { updatedAt: 7, doc: { a: 1 } })
    const post = calls.find((c) => c.init?.method === 'POST')
    expect(post, 'no POST was made at all').toBeTruthy()
    const body = JSON.parse(post.init.body)
    expect(body.key).toBe('tracings_doc')
    expect(typeof body.value, 'the value must reach the server as a string').toBe('string')
    expect(JSON.parse(body.value).updatedAt).toBe(7)
  })

  it('⛔ every existing caller can keep ignoring the return value', async () => {
    // The change is additive. A caller that awaits nothing must not throw, and
    // must not behave differently — this is the blast-radius guard.
    const { result } = renderHook(() => usePreferences())
    await act(async () => { result.current.setPref('theme', 'oled') })
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(true)
  })
})
