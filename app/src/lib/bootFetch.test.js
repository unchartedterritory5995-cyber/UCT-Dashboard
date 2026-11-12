import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BOOT_MAX_AGE_MS, ME_URL, PREFS_URL, SIGNED_IN_HINT, __resetBootFetchForTests, noteBootUser, setSignedInHint,
  startBootFetches, takeBootMe, takeBootPreferences,
} from './bootFetch'

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }
}
const res = (tag) => ({ ok: true, tag })

describe('boot fetches: the sign-in check and the member preferences start as the page loads', () => {
  afterEach(() => { __resetBootFetchForTests(); vi.useRealTimers() })

  it('starts /me always and preferences only when this browser was signed in last time', async () => {
    const f1 = vi.fn((u) => Promise.resolve(res(u)))
    startBootFetches({ fetchImpl: f1, storage: memStorage() })
    await Promise.resolve(); await Promise.resolve()
    expect(f1.mock.calls.map((c) => c[0])).toEqual([ME_URL])
    __resetBootFetchForTests()
    const f2 = vi.fn((u) => Promise.resolve(res(u)))
    startBootFetches({ fetchImpl: f2, storage: memStorage({ [SIGNED_IN_HINT]: '1' }) })
    await Promise.resolve(); await Promise.resolve()
    expect(f2.mock.calls.map((c) => c[0])).toEqual([ME_URL, PREFS_URL])
  })

  it('each answer is taken once; a failed request is "no answer"', async () => {
    startBootFetches({ fetchImpl: (u) => (u === ME_URL ? Promise.reject(new Error('net')) : Promise.resolve(res(u))), storage: memStorage({ [SIGNED_IN_HINT]: '1' }) })
    const me = takeBootMe()
    expect(await me).toBeNull()
    expect(takeBootMe()).toBeNull()
  })

  it('preferences go only to the member the boot sign-in check named, and only once', async () => {
    startBootFetches({ fetchImpl: (u) => Promise.resolve(res(u)), storage: memStorage({ [SIGNED_IN_HINT]: '1' }) })
    noteBootUser('A')
    noteBootUser('B') // a later refetch can never re-point it
    expect(takeBootPreferences('B')).toBeNull()       // another member: dropped unread
    expect(takeBootPreferences('A')).toBeNull()       // and it is gone, not kept for later
    __resetBootFetchForTests()
    startBootFetches({ fetchImpl: (u) => Promise.resolve(res(u)), storage: memStorage({ [SIGNED_IN_HINT]: '1' }) })
    noteBootUser('A')
    expect((await takeBootPreferences('A')).tag).toBe(PREFS_URL)
  })

  it('never hands out preferences when the boot check said signed out, or before it answered', () => {
    startBootFetches({ fetchImpl: (u) => Promise.resolve(res(u)), storage: memStorage({ [SIGNED_IN_HINT]: '1' }) })
    expect(takeBootPreferences('A')).toBeNull()
    __resetBootFetchForTests()
    startBootFetches({ fetchImpl: (u) => Promise.resolve(res(u)), storage: memStorage({ [SIGNED_IN_HINT]: '1' }) })
    noteBootUser(null)
    expect(takeBootPreferences(null)).toBeNull()
  })

  it('an answer older than the freshness limit is never handed out', () => {
    vi.useFakeTimers()
    startBootFetches({ fetchImpl: (u) => Promise.resolve(res(u)), storage: memStorage({ [SIGNED_IN_HINT]: '1' }) })
    noteBootUser('A')
    vi.advanceTimersByTime(BOOT_MAX_AGE_MS + 1)
    expect(takeBootMe()).toBeNull()
    expect(takeBootPreferences('A')).toBeNull()
  })

  it('the hint follows every definitive answer', () => {
    const s = memStorage()
    setSignedInHint(true, s)
    expect(s.getItem(SIGNED_IN_HINT)).toBe('1')
    setSignedInHint(false, s)
    expect(s.getItem(SIGNED_IN_HINT)).toBeNull()
  })
})

describe('the three call sites stay wired', () => {
  const read = async (p) => (await import('node:fs')).readFileSync((await import('node:path')).resolve(globalThis.process.cwd(), p), 'utf8')
  it('main.jsx starts the boot fetches before any other import', async () => {
    const src = await read('src/main.jsx')
    const firstImport = src.split(/\r?\n/).find((l) => l.startsWith('import '))
    expect(firstImport).toBe("import './lib/bootFetchStart'")
  })
  it('AuthContext takes the boot /me and notes only that response as the boot member', async () => {
    const src = await read('src/context/AuthContext.jsx')
    expect(src).toMatch(/const boot = takeBootMe\(\)/)
    expect(src).toMatch(/if \(fromBoot\) noteBootUser\(data\.user\?\.id \?\? null\)/)
  })
  it('the preferences fetcher takes the boot answer only for the current member', async () => {
    const src = await read('src/hooks/usePreferences.js')
    expect(src).toMatch(/takeBootPreferences\(prefsUser\(\)\)/)
  })
})
