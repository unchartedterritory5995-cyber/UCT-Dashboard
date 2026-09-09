// Joystick hub — useHubSettings(): defaults, the enable-gate five scenarios, and the JSON-patch merge.
// See docs/plans/joystick/00-master-spec-v1.3.md §8, §B11 (enable-gate, tightened at the Phase 1 gate).

import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import useHubSettings, { HUB_SETTINGS_DEFAULTS, JOYSTICK_HUB_PREF_KEY } from './useHubSettings'
import { AuthContext } from '../context/AuthContext'

const wrapper = (user) => ({ children }) => (
  <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>
)

/** Mock `global.fetch` for both the SWR GET (usePreferences' fetcher does
 *  `fetch(url).then(r => r.ok ? r.json() : {})`, no init object) and any POST
 *  writes, recording the last POST body for assertions. */
function mockPrefsFetch(getBody) {
  const posts = []
  global.fetch = vi.fn((url, init) => {
    if (init && init.method === 'POST') {
      posts.push(JSON.parse(init.body))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(getBody) })
  })
  return posts
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HUB_SETTINGS_DEFAULTS — the one authority for "what a fresh account starts with"', () => {
  it('is off, right-handed, haptics on, sticky fan on, no overrides (spec v1.3 §8 schema)', () => {
    expect(HUB_SETTINGS_DEFAULTS).toEqual({
      enabled: false,
      handedness: 'right',
      haptics: true,
      holdMs: 500,
      travelPx: 24,
      doubleTapMs: 280,
      stickyFan: true,
      highContrast: false,
      overrides: {},
    })
  })
})

describe('useHubSettings — the five enable-gate scenarios (spec v1.3 §B11, Phase 1 gate wording)', () => {
  it('explicit-on: a non-admin who explicitly enabled it gets the hub', async () => {
    mockPrefsFetch({ [JOYSTICK_HUB_PREF_KEY]: JSON.stringify({ enabled: true }) })
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'user' }) })
    await waitFor(() => expect(result.current.storedEnabled).toBe(true))
    expect(result.current.settings.enabled).toBe(true)
  })

  it('explicit-off-as-admin: an explicit false beats the admin default', async () => {
    mockPrefsFetch({ [JOYSTICK_HUB_PREF_KEY]: JSON.stringify({ enabled: false }) })
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'admin' }) })
    await waitFor(() => expect(result.current.storedEnabled).toBe(false))
    expect(result.current.settings.enabled).toBe(false)
  })

  it('unset-non-admin: nothing stored, ordinary member -> disabled', async () => {
    mockPrefsFetch({})
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'user' }) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.storedEnabled).toBeUndefined()
    expect(result.current.settings.enabled).toBe(false)
  })

  it('unset-admin: nothing stored, admin -> enabled (the one default-on identity)', async () => {
    mockPrefsFetch({})
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'admin' }) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.storedEnabled).toBeUndefined()
    expect(result.current.settings.enabled).toBe(true)
  })

  it('no-provider: with no AuthContext.Provider at all, resolves the same as "no user" -> disabled', async () => {
    mockPrefsFetch({})
    // No `wrapper` option at all — useContext(AuthContext) falls through to
    // the context's own default value (createContext(null)), never throws.
    const { result } = renderHook(() => useHubSettings())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.settings.enabled).toBe(false)
  })
})

describe('useHubSettings — updateHubSettings is a JSON-patch merge, not a replace', () => {
  it("an admin's first settings write persists their in-effect admin-on state, not the flat default", async () => {
    const posts = mockPrefsFetch({})
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'admin' }) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.settings.enabled).toBe(true) // admin default-on, nothing stored yet

    await act(async () => {
      await result.current.updateHubSettings((current) => ({ ...current, handedness: 'left' }))
    })

    expect(posts).toHaveLength(1)
    expect(posts[0].key).toBe(JOYSTICK_HUB_PREF_KEY)
    const patched = JSON.parse(posts[0].value)
    expect(patched.handedness).toBe('left')
    // The load-bearing assertion: this write must NOT silently persist the flat
    // `enabled: false` default over the admin's currently-in-effect "on" state.
    expect(patched.enabled).toBe(true)
  })

  it('a partial update preserves every other stored field (patch semantics)', async () => {
    const stored = { enabled: true, travelPx: 32, haptics: false }
    const posts = mockPrefsFetch({ [JOYSTICK_HUB_PREF_KEY]: JSON.stringify(stored) })
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'user' }) })
    await waitFor(() => expect(result.current.settings.travelPx).toBe(32))

    await act(async () => {
      await result.current.updateHubSettings((current) => ({ ...current, handedness: 'left' }))
    })

    expect(posts).toHaveLength(1)
    const patched = JSON.parse(posts[0].value)
    expect(patched).toEqual({
      enabled: true,          // preserved, explicit
      travelPx: 32,           // preserved, non-default
      haptics: false,         // preserved, non-default
      handedness: 'left',     // the actual change
      holdMs: 500,
      doubleTapMs: 280,
      stickyFan: true,
      highContrast: false,
      overrides: {},
    })
  })

  it('returning undefined from the updater abandons the write (setPrefMerged contract)', async () => {
    const posts = mockPrefsFetch({ [JOYSTICK_HUB_PREF_KEY]: JSON.stringify({ enabled: true }) })
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'user' }) })
    await waitFor(() => expect(result.current.storedEnabled).toBe(true))

    await act(async () => {
      await result.current.updateHubSettings(() => undefined)
    })

    expect(posts).toHaveLength(0)
  })
})
