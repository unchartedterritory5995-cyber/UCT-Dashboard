// ⛔⛔ A WRITE IS FOR THE MEMBER IT WAS MADE FOR, across every await (final review of 5db8284c62).
//
//  F1: a merge that waited on A's STALLED first read was stamped with whoever was current AFTER
//      the await (B), and B's re-read replayed A's updater into B's account (repro: POSTS
//      [{groups:{"A":"A_PICK","B":"B2"}}]); and a setPref queued behind an in-flight POST ran after
//      the member change and POSTed A's value under B's cookie.
//  F2: the member-change reset itself was unrailed: A's revision (base_version), A's 409 refusal
//      and A's failed-write backoff must not follow B.
//  F3: the per-session re-read ceiling was unrailed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { SWRConfig, mutate as globalMutate, useSWRConfig } from 'swr'
import usePreferences, { __resetRevisionStateForTests, PREFS_URL } from './usePreferences'
import { publishPrefsUser, __resetPrefsSessionForTests } from '../lib/prefsSession'

const GROUPS = 'charts_workspace_groups'
let servers, who, posts, gets, holdGet, heldGets, postGate, getStamp, postAnswer

function installFetch() {
  global.fetch = vi.fn(async (url, init) => {
    const account = who
    if (init && init.method === 'POST') {
      const body = JSON.parse(init.body)
      posts.push({ account, ...body })
      if (postGate) await postGate()
      if (postAnswer) return postAnswer(body)
      servers[account][body.key] = body.value
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) }
    }
    gets += 1
    if (holdGet && holdGet(gets)) await new Promise((r) => heldGets.push(r))
    const snapshot = { ...servers[account] }
    const stamp = getStamp ? getStamp(account) : null
    return { ok: true, status: 200, headers: { get: (h) => (h === 'X-Workspace-Doc' ? stamp : null) }, json: async () => snapshot }
  })
}
const gwrapper = ({ children }) => <SWRConfig value={{ dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
const flush = async (n = 12) => { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve() }) }
async function advance(ms) {
  for (let t = 0; t < ms; t += 500) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  }
}
const switchTo = async (id) => { who = id ?? who; await act(async () => { publishPrefsUser(id) }); await flush() }

beforeEach(async () => {
  __resetRevisionStateForTests(); __resetPrefsSessionForTests()
  await globalMutate(() => true, undefined, { revalidate: false })
  servers = {
    a: { [GROUPS]: JSON.stringify({ A: 'A1', B: 'A2' }) },
    b: { [GROUPS]: JSON.stringify({ A: 'B1', B: 'B2' }) },
  }
  who = 'a'; posts = []; gets = 0; holdGet = null; heldGets = []; postGate = null; getStamp = null; postAnswer = null
  installFetch()
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('F1 — a merge waiting on A\'s stalled read never lands in B', () => {
  for (const viaSignOut of [false, true]) {
    it(`A's merge waits on A's read; ${viaSignOut ? 'sign-out, then ' : ''}B signs in: no POST of A's pick, B never shows it`, async () => {
      vi.useFakeTimers()
      publishPrefsUser('a')
      holdGet = (n) => n === 1                                   // A's first read stalls
      const { result } = renderHook(() => usePreferences(), { wrapper: gwrapper })
      await flush()
      let p
      await act(async () => { p = result.current.setPrefMerged(GROUPS, (g) => ({ ...g, A: 'A_PICK' })) })
      if (viaSignOut) await switchTo(null)
      who = 'b'
      await switchTo('b')
      await advance(10000)
      await act(async () => { heldGets.splice(0).forEach((r) => r()) })   // A's stalled read finally answers
      await act(async () => { await p })
      await advance(60000)
      await flush()
      expect(JSON.stringify(posts)).not.toMatch(/A_PICK/)
      expect(posts).toHaveLength(0)
      expect(result.current.prefs[GROUPS] ? JSON.parse(result.current.prefs[GROUPS]).A : null).not.toBe('A_PICK')
      expect(JSON.parse(result.current.prefs[GROUPS])).toEqual({ A: 'B1', B: 'B2' })
    })
  }

  it('a setPref queued behind an in-flight POST is not sent after the member changes', async () => {
    publishPrefsUser('a')
    const { result } = renderHook(() => usePreferences(), { wrapper: gwrapper })
    await flush()
    let release
    postGate = () => new Promise((r) => { release = r; postGate = null })   // hold only the first POST
    let p1; let p2
    await act(async () => {
      p1 = result.current.setPref('theme', 'light')
      p2 = result.current.setPref('theme', 'dark')         // queued behind the first
    })
    await flush()
    expect(posts.map((x) => x.value)).toEqual(['light'])
    who = 'b'
    await switchTo('b')
    await act(async () => { release() })
    let r2
    await act(async () => { await p1; r2 = await p2 })
    await flush()
    expect(posts.map((x) => x.value), 'A\'s queued value went out under B').toEqual(['light'])
    expect(r2).toBe(false)
  })

  it('CONTROL: the same member throughout — the merge waits for the read and posts once', async () => {
    vi.useFakeTimers()
    publishPrefsUser('a')
    holdGet = (n) => n === 1
    const { result } = renderHook(() => usePreferences(), { wrapper: gwrapper })
    await flush()
    let p
    await act(async () => { p = result.current.setPrefMerged(GROUPS, (g) => ({ ...g, A: 'A_PICK' })) })
    await act(async () => { heldGets.splice(0).forEach((r) => r()) })
    await act(async () => { await p })
    await flush()
    expect(posts.map((x) => [x.account, JSON.parse(x.value)])).toEqual([['a', { A: 'A_PICK', B: 'A2' }]])
  })
})

describe('F2 — A\'s revision, refusal and backoff do not follow B', () => {
  it('A loaded at v=7 and was refused (409) on K; B (v=3) writes K: sent with B\'s base, and accepted', async () => {
    publishPrefsUser('a')
    getStamp = (acct) => (acct === 'a' ? 'v=7' : 'v=3')
    const { result } = renderHook(() => usePreferences(), { wrapper: gwrapper })
    await flush()
    postAnswer = () => ({ ok: false, status: 409, headers: { get: () => null }, json: async () => ({ detail: { code: 'workspace_conflict' } }) })
    await act(async () => { await result.current.setPref(GROUPS, 'x') })
    expect(posts.at(-1)).toMatchObject({ account: 'a', base_version: 7 })
    // A is now refused on K for the session; a second A write is not even sent
    await act(async () => { await result.current.setPref(GROUPS, 'y') })
    expect(posts).toHaveLength(1)
    postAnswer = null
    who = 'b'
    await switchTo('b')
    let ok
    await act(async () => { ok = await result.current.setPref(GROUPS, JSON.stringify({ A: 'B9' })) })
    expect(posts).toHaveLength(2)
    expect(posts.at(-1)).toMatchObject({ account: 'b', base_version: 3 })
    expect(ok).toBe(true)
  })

  it('A\'s failed-write backoff does not hold B\'s identical write', async () => {
    publishPrefsUser('a')
    const { result } = renderHook(() => usePreferences(), { wrapper: gwrapper })
    await flush()
    postAnswer = () => ({ ok: false, status: 502, headers: { get: () => null }, json: async () => ({}) })
    await act(async () => { await result.current.setPref('theme', 'light') })
    await act(async () => { await result.current.setPref('theme', 'light') })   // held: same value, no input
    expect(posts).toHaveLength(1)
    postAnswer = null
    who = 'b'
    await switchTo('b')
    await act(async () => { await result.current.setPref('theme', 'light') })
    expect(posts.map((x) => x.account)).toEqual(['a', 'b'])
  })
})

describe("an answer to A's POST that arrives after B signed in changes nothing of B's", () => {
  it("A's in-flight write answers {version: 99} after the switch: B's next write still sends B's base", async () => {
    publishPrefsUser('a')
    getStamp = (acct) => (acct === 'a' ? 'v=7' : 'v=3')
    const { result } = renderHook(() => usePreferences(), { wrapper: gwrapper })
    await flush()
    let release
    postGate = () => new Promise((r) => { release = r; postGate = null })
    postAnswer = (body) => { postAnswer = null; return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, version: 99 }) } }
    let p1
    await act(async () => { p1 = result.current.setPref(GROUPS, 'a-value') })
    await flush()
    who = 'b'
    await switchTo('b')
    await act(async () => { release(); await p1 })
    await flush()
    await act(async () => { await result.current.setPref(GROUPS, 'b-value') })
    expect(posts.at(-1)).toMatchObject({ account: 'b', value: 'b-value', base_version: 3 })
  })
})

describe('F3 — the session ceiling holds even when every series is reset by a good read', () => {
  it('refused read, one good re-read, again and again: series re-reads stop at the cap', async () => {
    vi.useFakeTimers()
    let external = false
    servers.a = { theme: 'light' }
    // a re-read the SERIES makes answers 200; an external revalidation answers 502 ({}), which
    // un-bases the cache and starts a new series — whose first re-read resets the series count
    let seriesGets = 0
    global.fetch = vi.fn(async (url, init) => {
      if (init && init.method === 'POST') return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
      if (external) { external = false; return { ok: false, status: 502, headers: { get: () => null }, json: async () => ({}) } }
      seriesGets += 1
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ...servers.a }) }
    })
    let swrMutate = null
    const { result } = renderHook(() => { swrMutate = useSWRConfig().mutate; return usePreferences() }, { wrapper: gwrapper })
    await flush()
    const initial = seriesGets                                  // the first, good read
    for (let i = 0; i < 40; i += 1) {
      external = true
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await swrMutate(PREFS_URL) })
      // eslint-disable-next-line no-await-in-loop
      await advance(1500)
    }
    void result
    expect(seriesGets - initial, 'series re-reads in the session').toBe(24)
  })
})
