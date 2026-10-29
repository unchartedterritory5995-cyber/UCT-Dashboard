// Two HIGH defects found in review of 94841fc6f7 (repro rails adapted from the reviewer's scratch):
//
//  N1 (rule H14): a NEW member whose first read hit a 502. The server holds `{}`; the good re-read
//     answers `{}`, SWR keeps the old (untagged) `{}` object because the two are deep-equal, the
//     cache never read as the server's, and the fetcher's reset of the attempt count made the
//     re-read series run forever: 601 GETs in ten minutes.
//  N2 (cross-account write): the hook's module state survives sign-out (no reload). A merge held
//     for member A replayed onto member B's preferences and POSTed into B's account, and B rendered
//     A's cached preferences.
//  N3: a merge still waiting for a base must not undo a NEWER confirmed write of the same key.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { SWRConfig, mutate as globalMutate } from 'swr'
import usePreferences, { __resetRevisionStateForTests } from './usePreferences'
import { publishPrefsUser, __resetPrefsSessionForTests } from '../lib/prefsSession'

const GROUPS = 'charts_workspace_groups'
let server, posts, gets, getAnswers
function installFetch() {
  global.fetch = vi.fn(async (url, init) => {
    if (init && init.method === 'POST') {
      const body = JSON.parse(init.body); posts.push(body); server[body.key] = body.value
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) }
    }
    gets += 1
    const mode = getAnswers.length ? getAnswers.shift() : 'ok'
    if (mode === '502') return { ok: false, status: 502, headers: { get: () => null }, json: async () => ({}) }
    const snapshot = { ...server }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => snapshot }
  })
}
// The app's own arrangement: the GLOBAL SWR cache (App.jsx's SWRConfig sets no provider).
const gwrapper = ({ children }) => <SWRConfig value={{ dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
)
const flush = async (n = 12) => { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve() }) }
async function advance(ms) {
  for (let t = 0; t < ms; t += 1000) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  }
}

beforeEach(async () => {
  __resetRevisionStateForTests(); __resetPrefsSessionForTests()
  await globalMutate(() => true, undefined, { revalidate: false })
  posts = []; gets = 0; getAnswers = []; installFetch()
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('N1 — the re-read series ends, even when SWR keeps the old object', () => {
  it('a new member (server {}), first read 502, a merge: bounded GETs over 10 min and 1 h; the merge lands once', async () => {
    vi.useFakeTimers()
    server = {}
    getAnswers = ['502']
    const { result } = renderHook(() => usePreferences(), { wrapper })
    await flush()
    let r
    await act(async () => { r = await result.current.setPrefMerged(GROUPS, (g) => ({ ...g, A: 'AMD' })) })
    expect(r).toBe(false)
    await advance(10 * 60 * 1000)
    // the refused read, then ONE good re-read that SWR answers by keeping the old `{}`: over
    expect(gets, `${gets} GETs in 10 min`).toBe(2)
    const at10 = gets
    await advance(50 * 60 * 1000)
    expect(gets, `${gets} GETs in 1 h`).toBe(at10)            // ended: nothing more in the next 50 min
    expect(posts.map((p) => [p.key, JSON.parse(p.value)])).toEqual([[GROUPS, { A: 'AMD' }]])
  })

  it('the same with no merge at all: bounded, and over within the hour', async () => {
    vi.useFakeTimers()
    server = {}
    getAnswers = ['502']
    renderHook(() => usePreferences(), { wrapper })
    await flush()
    await advance(10 * 60 * 1000)
    expect(gets).toBe(2)
    const at10 = gets
    await advance(50 * 60 * 1000)
    expect(gets).toBe(at10)
  })

  it('an endpoint that refuses for an hour: capped per series AND per session', async () => {
    vi.useFakeTimers()
    server = {}
    getAnswers = Array(10000).fill('502')
    renderHook(() => usePreferences(), { wrapper })
    await flush()
    await advance(60 * 60 * 1000)
    expect(gets).toBeLessThanOrEqual(1 + 24)
  })
})

describe('N2 — one member\'s state never reaches the next member', () => {
  it('A: refused read + held merge -> sign-out -> B signs in: no POST of A\'s value, and B never sees A\'s prefs', async () => {
    vi.useFakeTimers()
    publishPrefsUser('user-a')
    server = { [GROUPS]: JSON.stringify({ A: 'SPY', B: 'NVDA' }) }
    getAnswers = Array(20).fill('502')
    const { result } = renderHook(() => usePreferences(), { wrapper: gwrapper })
    await flush()
    await act(async () => { await result.current.setPrefMerged(GROUPS, (g) => ({ ...g, A: 'A_USER_PICK' })) })
    expect(JSON.parse(result.current.prefs[GROUPS]).A).toBe('A_USER_PICK')   // A's local edit
    expect(posts).toHaveLength(0)
    // A signs out (no reload)
    await act(async () => { publishPrefsUser(null) })
    await flush()
    expect(result.current.prefs[GROUPS], 'A\'s cached preferences still showing after sign-out').toBeUndefined()
    // B signs in; B's server state
    server = { [GROUPS]: JSON.stringify({ A: 'B1', B: 'B2' }) }
    getAnswers = []
    await act(async () => { publishPrefsUser('user-b') })
    await flush()
    await advance(10 * 60 * 1000)
    await flush()
    expect(JSON.stringify(posts)).not.toMatch(/A_USER_PICK/)
    expect(posts).toHaveLength(0)
    expect(JSON.parse(result.current.prefs[GROUPS])).toEqual({ A: 'B1', B: 'B2' })
  })

  it('CONTROL: the SAME member re-published (a /me refresh) clears nothing and the held merge still lands', async () => {
    vi.useFakeTimers()
    publishPrefsUser('user-a')
    server = { [GROUPS]: JSON.stringify({ A: 'SPY', B: 'NVDA' }) }
    getAnswers = ['502']
    const { result } = renderHook(() => usePreferences(), { wrapper: gwrapper })
    await flush()
    await act(async () => { await result.current.setPrefMerged(GROUPS, (g) => ({ ...g, A: 'AMD' })) })
    await act(async () => { publishPrefsUser('user-a') })
    await advance(5000)
    await flush()
    expect(posts.map((p) => JSON.parse(p.value))).toEqual([{ A: 'AMD', B: 'NVDA' }])
  })
})

describe('N3 — a newer confirmed write of the key wins over a merge still waiting', () => {
  it('held merge of groups, then setPref(groups) is confirmed: the replay does not post over it', async () => {
    vi.useFakeTimers()
    server = { [GROUPS]: JSON.stringify({ A: 'SPY', B: 'NVDA' }) }
    getAnswers = ['502']
    const { result } = renderHook(() => usePreferences(), { wrapper })
    await flush()
    await act(async () => { await result.current.setPrefMerged(GROUPS, (g) => ({ ...g, A: 'OLD_PICK' })) })
    await act(async () => { await result.current.setPref(GROUPS, JSON.stringify({ A: 'NEW', B: 'NVDA', C: 'QQQ' })) })
    expect(posts).toHaveLength(1)
    await advance(10000)
    await flush()
    expect(posts).toHaveLength(1)
    expect(JSON.parse(server[GROUPS])).toEqual({ A: 'NEW', B: 'NVDA', C: 'QQQ' })
  })
})

describe('the wire: AuthContext publishes every committed member change', () => {
  it('publishPrefsUser(user?.id ?? null), once auth has answered, on [user, loading]', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src', 'context', 'AuthContext.jsx'), 'utf8')
    expect(src).toMatch(/import \{ publishPrefsUser \} from '\.\.\/lib\/prefsSession'/)
    expect(src).toMatch(/useEffect\(\(\) => \{ if \(!loading\) publishPrefsUser\(user\?\.id \?\? null\) \}, \[user, loading\]\)/)
    // and the hook listens to it
    const hook = readFileSync(join(process.cwd(), 'src', 'hooks', 'usePreferences.js'), 'utf8')
    expect(hook).toMatch(/onPrefsUserChange\(\(id\) => setPreferencesUser\(id\)\)/)
  })
})
