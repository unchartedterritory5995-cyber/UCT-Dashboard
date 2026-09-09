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
 * report `false`.
 *
 * ⚰️ THIS HEADER USED TO END "Both failure modes now revert". They do not, and
 * the correction is the point of the settle rails below. MOB-09 shipped that
 * revert and it deadlocked the app against any failing preferences endpoint:
 * every write to this cache re-renders each consumer, `prefs` is rebuilt fresh
 * on every render, and a `prefs`-keyed effect that writes then fires again. A
 * ROLLBACK is the worst shape available, because it restores the very value that
 * provoked the write, so the cycle cannot converge even in principle. Measured
 * at 100% CPU with no exit; `VideoDockSlot.returns.test.jsx` never terminated.
 * A failed write now changes NOTHING and reports `false` — the server stays the
 * authority, and the caller that keeps a durable mark declines to advance it.
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

const postCount = () => calls.filter(c => c.init?.method === 'POST').length
const getCount = () => calls.filter(c => c.init?.method !== 'POST').length

describe('a failed write SETTLES', () => {
  it('🔴 issues NO follow-up request — the revalidation form of the spin', async () => {
    respond = async () => ({ ok: false, status: 500 })
    const { result } = renderHook(() => usePreferences())
    // ⛔ THE BASELINE IS TAKEN BEFORE THE WRITE, not after it. A revalidation
    // fires from inside `setPref`'s own await, so a count sampled afterwards
    // has already absorbed it and the rail passes against the real bug — it
    // did exactly that on its first draft, and the mutation check is what
    // caught it.
    const before = getCount()
    await act(async () => { await result.current.setPref('tracings_doc', { updatedAt: 1, doc: {} }) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(getCount(), 'the failure asked the server to revalidate — that is the re-entry edge').toBe(before)
  })

  it('🔴 leaves the optimistic value in the cache — the ROLLBACK form of the spin', async () => {
    // ⛔ NON-OBVIOUS AND LOAD-BEARING. Reverting looks like the careful choice,
    // and it is the one that cannot terminate: it restores the value that caused
    // the write, so the next render writes again, forever. Removing the
    // revalidation alone did NOT fix the hang — this did.
    respond = async () => ({ ok: false, status: 500 })
    const { result } = renderHook(() => usePreferences())
    await act(async () => { await result.current.setPref('chart_settings', '{"a":1}') })
    expect(result.current.prefs.chart_settings,
      'the failed write rolled the cache back; that flip-flop is what spun at 100% CPU',
    ).toBe('{"a":1}')
  })

  it('⛔ repeated failure is BOUNDED — one POST per call, nothing self-scheduled', async () => {
    respond = async () => ({ ok: false, status: 503 })
    const { result } = renderHook(() => usePreferences())
    for (let i = 0; i < 3; i++) {
      await act(async () => { await result.current.setPref('tracings_doc', { updatedAt: i, doc: {} }) })
    }
    await act(async () => { await Promise.resolve() })
    expect(postCount(), 'a failing server produced more writes than it was asked for').toBe(3)
  })

  it('⛔ NON-VACUITY: the harness can see a request it is not looking for', async () => {
    // Without this, a rail asserting "no extra traffic" would pass just as well
    // against a broken counter.
    respond = async () => ({ ok: true, json: async () => ({}) })
    const before = postCount()
    await write('tracings_doc', { updatedAt: 1, doc: {} })
    expect(postCount()).toBeGreaterThan(before)
  })
})

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
