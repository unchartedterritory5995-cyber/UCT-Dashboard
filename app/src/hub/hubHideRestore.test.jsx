// "Hide joystick" must never be a one-way door.
//
// ⛔ THE DEFECT THIS FILE EXISTS FOR. Hiding wrote `joystick_hub.enabled = false`, and the
// Settings toggle was scheduled for Phase 4 — so the only routes back were an admin editing the
// database or the member pasting a `fetch()` into a devtools console. The owner hit exactly
// that on the live admin preview, as an admin, on production.
//
// The fix is three parts and each has a section here:
//   1. hiding is SESSION-ONLY and writes nothing             → "session visibility store"
//   2. a PERSISTENT hide exists only beside a re-enable path → "Settings → Joystick"
//   3. hidden is never unrecoverable                         → "the restore tab"
//
// Plus a copy contract, because in this fix THE COPY IS THE FEATURE: the toast is the only
// thing that tells a member the hide is temporary, or where the permanent switch lives.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, renderHook, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'
import useHubSessionOverride, {
  hideForSession, showForSession, clearSessionOverride, resolveVisible,
} from './hubSessionVisibility'
import { restoreToast } from './HubEdgeTab'

// One mutable prefs bag + one spy on the write path, so a test can both SET the stored
// value and assert whether anything wrote it back. Same shape as HubRoot.test.jsx.
let mockPrefs = {}
const setPrefMerged = vi.fn()
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPrefMerged, loading: false }),
  parsePref: (raw) => {
    if (raw == null) return undefined
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return undefined }
  },
}))

const { default: HubRoot } = await import('./HubRoot.jsx')
const { default: JoystickSettingsCard } = await import('../pages/settings/JoystickSettingsCard.jsx')

const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')

/** Everything the capability floor needs, so the ONLY variable in a test is the one it names. */
function stubCapable() {
  globalThis.CSS = { supports: () => true }
  window.visualViewport = { width: 375, height: 812, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: /max-width:\s*1023px/.test(q),
    media: q,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(),
  }))
}

const renderIn = (ui, auth = {}) => render(
  <MemoryRouter initialEntries={['/dashboard']}>
    <AuthContext.Provider value={{ user: { role: 'user' }, plan: 'pro', isPaid: true, ...auth }}>
      {ui}
    </AuthContext.Provider>
  </MemoryRouter>,
)

beforeEach(() => {
  clearSessionOverride()
  mockPrefs = {}
  setPrefMerged.mockReset()
  stubCapable()
})

afterEach(() => {
  clearSessionOverride()
  vi.restoreAllMocks()
  delete globalThis.CSS
  if (realVisualViewport) Object.defineProperty(window, 'visualViewport', realVisualViewport)
  else delete window.visualViewport
})

describe('session visibility store', () => {
  it('starts with no override, so the stored preference decides', () => {
    const { result } = renderHook(() => useHubSessionOverride())
    expect(result.current).toBeNull()
    expect(resolveVisible(true, result.current)).toBe(true)
    expect(resolveVisible(false, result.current)).toBe(false)
  })

  it('a session hide beats a stored TRUE', () => {
    const { result } = renderHook(() => useHubSessionOverride())
    act(() => hideForSession())
    expect(result.current).toBe('hidden')
    expect(resolveVisible(true, result.current)).toBe(false)
  })

  it('a session show beats a stored FALSE — this is the way back', () => {
    const { result } = renderHook(() => useHubSessionOverride())
    act(() => showForSession())
    expect(result.current).toBe('shown')
    expect(resolveVisible(false, result.current)).toBe(true)
  })

  it('⛔ THE LOAD-BEARING ONE: hiding writes NOTHING that survives a reload', () => {
    // The store is module state with no persistence layer at all. If someone adds a
    // localStorage or preference write to `hideForSession`, "Reload to bring it back" — which
    // is what the toast promises — silently becomes a lie, and the one-way door is back.
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    act(() => hideForSession())

    expect(setItem, 'hiding must not persist to storage').not.toHaveBeenCalled()
    expect(setPrefMerged, 'hiding must not write the preference').not.toHaveBeenCalled()
  })

  it('a fresh module read (what a reload gives you) is back to no override', () => {
    act(() => hideForSession())
    act(() => clearSessionOverride())   // stands in for the module re-evaluating on load
    const { result } = renderHook(() => useHubSessionOverride())
    expect(result.current).toBeNull()
  })
})

describe('resolveVisible — the whole decision table', () => {
  it.each([
    [true, null, true],
    [false, null, false],
    [true, 'hidden', false],
    [false, 'hidden', false],
    [true, 'shown', true],
    [false, 'shown', true],
  ])('stored=%s override=%s -> visible=%s', (stored, override, expected) => {
    expect(resolveVisible(stored, override)).toBe(expected)
  })
})

describe('the restore tab', () => {
  it('is ABSENT while the hub is showing — one control in that corner, never two', () => {
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    renderIn(<HubRoot />)
    expect(screen.getByTestId('hub-root')).toBeTruthy()
    expect(screen.queryByTestId('hub-edge-tab')).toBeNull()
  })

  it('appears when the stored preference is off', () => {
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: false }) }
    renderIn(<HubRoot />)
    expect(screen.queryByTestId('hub-root')).toBeNull()
    expect(screen.getByTestId('hub-edge-tab')).toBeTruthy()
  })

  it('appears after a SESSION hide too — a member cannot tell the two apart', () => {
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    renderIn(<HubRoot />)
    act(() => hideForSession())
    expect(screen.queryByTestId('hub-root')).toBeNull()
    expect(screen.getByTestId('hub-edge-tab')).toBeTruthy()
  })

  it('⛔ tapping it RESTORES THE HUB AND WRITES NOTHING', () => {
    // The whole point. A member who taps their way back must not silently acquire a stored
    // preference they never chose — and must not need one, either.
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: false }) }
    renderIn(<HubRoot />)

    fireEvent.click(screen.getByTestId('hub-edge-tab'))

    expect(screen.getByTestId('hub-root'), 'the hub is back').toBeTruthy()
    expect(setPrefMerged, 'restoring must not write the preference').not.toHaveBeenCalled()
  })

  it('names the ACTION for a screen reader, not the shape', () => {
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: false }) }
    renderIn(<HubRoot />)
    expect(screen.getByLabelText('Show joystick')).toBeTruthy()
  })

  it('⛔ the KILL SWITCH removes the tab as well as the hub', () => {
    // `HUB_PREVIEW_ENABLED=false` is the owner's rollback for the whole preview. A restore tab
    // surviving it would leave a live door into a feature that is supposed to be gone — and
    // one that promises a Settings toggle the member would then find does nothing.
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: false }) }
    renderIn(<HubRoot />, { hubPreviewEnabled: false })
    expect(screen.queryByTestId('hub-root')).toBeNull()
    expect(screen.queryByTestId('hub-edge-tab'), 'the kill switch kills the tab too').toBeNull()
  })

  it('is absent on a browser that cannot draw the hub — there would be nothing to restore', () => {
    globalThis.CSS = { supports: () => false }
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: false }) }
    renderIn(<HubRoot />)
    expect(screen.queryByTestId('hub-edge-tab')).toBeNull()
  })
})

describe('Settings → Joystick', () => {
  it('reflects the stored value', () => {
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    renderIn(<JoystickSettingsCard />)
    expect(screen.getByTestId('joystick-enabled-toggle').checked).toBe(true)
  })

  it('⛔ turning it OFF is the ONLY thing that writes a persistent hide', () => {
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    renderIn(<JoystickSettingsCard />)

    fireEvent.click(screen.getByTestId('joystick-enabled-toggle'))

    expect(setPrefMerged).toHaveBeenCalledTimes(1)
    const [key, updater] = setPrefMerged.mock.calls[0]
    expect(key).toBe('joystick_hub')
    expect(updater({ enabled: true }).enabled).toBe(false)
  })

  it('round-trips ON without clobbering the rest of the blob', () => {
    // `SetPreferenceRequest` stores ONE TEXT value per key, so the whole `joystick_hub` blob is
    // rewritten on every write. A toggle that spread nothing would silently drop the member's
    // handedness and re-show the coach mark they already dismissed.
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: false, handedness: 'left', coachMarkSeen: true }) }
    renderIn(<JoystickSettingsCard />)

    fireEvent.click(screen.getByTestId('joystick-enabled-toggle'))

    const next = setPrefMerged.mock.calls[0][1]({ enabled: false, handedness: 'left', coachMarkSeen: true })
    expect(next).toMatchObject({ enabled: true, handedness: 'left', coachMarkSeen: true })
  })

  it('⛔ clears the session override, or the toggle looks broken', () => {
    // A member who session-hid and then switched it ON here would see nothing happen: the
    // override outranks the preference, so the hub would stay hidden behind a control that
    // now reads "on". The card must drop the override as part of the same action.
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: false }) }
    act(() => hideForSession())
    renderIn(<JoystickSettingsCard />)

    fireEvent.click(screen.getByTestId('joystick-enabled-toggle'))

    const { result } = renderHook(() => useHubSessionOverride())
    expect(result.current).toBeNull()
  })

  it('is labelled as a preview, so nobody reads it as a settled feature', () => {
    // B6 hides this card from a member who never chose, so an admin is the only viewer who
    // reaches it with NO stored preference — which is the state this copy check is written in.
    renderIn(<JoystickSettingsCard />, { user: { role: 'admin' } })
    expect(screen.getByText('Joystick shortcuts (preview)')).toBeTruthy()
  })
})

describe('the copy contract — in this fix the words ARE the feature', () => {
  it('a SESSION hide promises a reload, and the code keeps that promise', () => {
    // These two facts must move together: the store persists nothing (asserted above) and the
    // toast says so. If a future change persists the hide, this sentence becomes a lie that no
    // structural test can see.
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    renderIn(<HubRoot />)
    // The sheet is the WCAG 2.5.1 door — "Hide joystick" lives there, not on the pad.
    fireEvent.click(screen.getByLabelText(/actions/i))
    fireEvent.click(screen.getByText('Hide joystick'))

    expect(screen.getByText('Hidden for now. Reload to bring it back.')).toBeTruthy()
    expect(setPrefMerged, 'the sheet must not write a persistent hide').not.toHaveBeenCalled()
  })

  it('a PERSISTENT hide points at the permanent switch by its real name', () => {
    expect(restoreToast(true)).toBe('Turn it back on permanently in Settings → Joystick')
  })

  it('a session restore does NOT send the member to Settings for nothing', () => {
    expect(restoreToast(false)).toBe('Joystick back for this session')
  })

  it('⛔ the restore toast actually RENDERS — a mis-named prop blanks it silently', () => {
    // `JournalToast` reads `msg`; it shipped here as `message` and rendered ''. Every
    // structural test above still passed, because the tab worked and the hub came back — the
    // only casualty was the sentence naming where the permanent switch lives.
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: false }) }
    renderIn(<HubRoot />)
    fireEvent.click(screen.getByTestId('hub-edge-tab'))
    expect(screen.getByText(restoreToast(true))).toBeTruthy()
  })
})
