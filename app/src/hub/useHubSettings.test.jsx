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
      // ⛔ The G0 gesture trace ships OFF. It is a diagnostic, and a diagnostic that is on because
      // nobody chose is the shape `project_feature_flag_ledger` exists to prevent.
      traceGestures: false,
      overrides: {},
    })
  })
})

describe('⛔ traceGestures — the G0 diagnostic is admin-only at the ONE authority', () => {
  // ⚠️ These are here, beside the five enable-gate scenarios, because this is the file that owns
  // "what does settings.X resolve to" — the Settings card only decides what to RENDER.
  it('a non-admin who stored traceGestures:true still resolves to false', async () => {
    mockPrefsFetch({ [JOYSTICK_HUB_PREF_KEY]: JSON.stringify({ enabled: true, traceGestures: true }) })
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'user' }) })
    await waitFor(() => expect(result.current.storedEnabled).toBe(true))
    expect(
      result.current.settings.traceGestures,
      'a member wrote the trace flag straight to the unvalidated preferences endpoint and got it — '
      + 'the card hiding the control is an exposure default, not a boundary',
    ).toBe(false)
  })

  it('CONTROL: an admin with the SAME stored blob does get it — so the case above is not vacuous', async () => {
    mockPrefsFetch({ [JOYSTICK_HUB_PREF_KEY]: JSON.stringify({ enabled: true, traceGestures: true }) })
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'admin' }) })
    await waitFor(() => expect(result.current.settings.traceGestures).toBe(true))
  })

  it('an admin who never chose resolves to false — unset is never ON', async () => {
    mockPrefsFetch({})
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'admin' }) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.settings.traceGestures).toBe(false)
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

  it('unset-non-admin: nothing stored, ordinary member -> ENABLED at stage 2', async () => {
    // ⚰️ THIS ASSERTED `false` UNTIL 2026-09-13, and flipping it IS the member-facing change the
    // stage-2 ruling makes. Stage 1 resolved an unset preference to `isAdmin`; stage 2 resolves it
    // to true for every authenticated user. ⛔ The expectation is not derived from `unsetDefault`
    // on purpose — a test that asks the resolver what to expect agrees with it by construction and
    // would have stayed green through the very change it exists to catch. The ladder itself is
    // owned by `exposureGate.test.js` (digest-pinned) and `stageLadderAgreement.test.js`.
    mockPrefsFetch({})
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'user' }) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.storedEnabled).toBeUndefined()
    expect(result.current.settings.enabled).toBe(true)
  })

  it('⛔ and an explicit false STILL beats the stage-2 default — the opt-out survives', async () => {
    // The whole opt-out story rests on this: a member who turns the hub off keeps it off when the
    // rollout widens. A stage that could overwrite a stored preference would be a stage that takes
    // someone's choice away.
    mockPrefsFetch({ [JOYSTICK_HUB_PREF_KEY]: JSON.stringify({ enabled: false }) })
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'user' }) })
    await waitFor(() => expect(result.current.storedEnabled).toBe(false))
    expect(result.current.settings.enabled).toBe(false)
  })

  it('unset-admin: nothing stored, admin -> enabled (the one default-on identity)', async () => {
    mockPrefsFetch({})
    const { result } = renderHook(() => useHubSettings(), { wrapper: wrapper({ role: 'admin' }) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.storedEnabled).toBeUndefined()
    expect(result.current.settings.enabled).toBe(true)
  })

  it('no-provider: with no AuthContext.Provider at all, it resolves the unset default and never throws', async () => {
    mockPrefsFetch({})
    // No `wrapper` option at all — useContext(AuthContext) falls through to
    // the context's own default value (createContext(null)), never throws.
    const { result } = renderHook(() => useHubSettings())
    await waitFor(() => expect(result.current.loading).toBe(false))
    // ⚰️ ASSERTED `false` UNTIL 2026-09-13. At stage 2 "no user" is not admin, and the unset
    // default for a non-admin is now true — so this reads ENABLED.
    //
    // ⛔⛔ AND THAT IS NOT A LOGGED-OUT HOLE, WHICH IS THE OBVIOUS WORRY. `settings.enabled` is a
    // preference, not the gate. `HubRoot` is mounted by `Layout.jsx:175`, and `App.jsx` nests
    // `<Route element={<Layout />}>` (:525) INSIDE `<Route element={<AuthGuard />}>` (:508) — an
    // unauthenticated visitor is redirected to /login and never renders the hub at all. ⭐ This
    // hook's own docstring anticipated the change and said so: flipping the unset default to true
    // for every authenticated user is "a one-line change here, not a new gate anywhere".
    // ⚠️ If `Layout` is ever moved outside `AuthGuard`, this stops being true and the gate has to
    // learn about authentication. That is why the reason is written here and not assumed.
    expect(result.current.settings.enabled).toBe(true)
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
      // ⭐ Written as the DEFAULT, not as the resolved value. This user is a member, so
      // `settings.traceGestures` reads false for them either way — but the blob must carry the
      // stored intent, never the admin-resolved answer, or an admin toggling handedness on a
      // member-shaped blob would silently stamp a diagnostic into it.
      traceGestures: false,
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
