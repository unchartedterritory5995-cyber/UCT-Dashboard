// HUB_PREVIEW_ENABLED — the Phase 2.5 kill switch, railed in BOTH directions.
//
// ⛔ A KILL SWITCH NOBODY HAS WATCHED KILL SOMETHING IS NOT A KILL SWITCH
// (`lesson_gate_that_cannot_fail`). The rollback plan for the whole preview release
// is "flip this variable in Railway", so the expensive failure is not the switch
// refusing to work — it is the switch appearing to work while the hub still mounts,
// discovered at the moment the owner needs it.
//
// The backend reads `HUB_PREVIEW_ENABLED` PER REQUEST and carries the answer on the
// auth payload the client already polls, so no redeploy is needed; the client half is
// `useHubActive`, and that is what these tests exercise. The server half is covered by
// `tests/test_hub_preview_flag.py`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { AuthContext } from '../context/AuthContext'
import useHubActive from './useHubActive'

vi.mock('./useHubSettings', () => ({
  default: () => ({ settings: { enabled: true } }),
}))

let originalCSS
let originalMatchMedia

beforeEach(() => {
  originalCSS = globalThis.CSS
  originalMatchMedia = window.matchMedia
  // Everything the capability floor needs, so the ONLY variable is the flag.
  globalThis.CSS = { supports: () => true }
  window.visualViewport = window.visualViewport || {}
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: q === '(max-width: 1023px) and (pointer: coarse)',
    media: q,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(),
    onchange: null, dispatchEvent: vi.fn(),
  }))
})

afterEach(() => {
  globalThis.CSS = originalCSS
  window.matchMedia = originalMatchMedia
  vi.restoreAllMocks()
})

const wrapperWith = (value) => ({ children }) => (
  <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
)

describe('HUB_PREVIEW_ENABLED kill switch', () => {
  it('MOUNTS when the flag is true', () => {
    const { result } = renderHook(() => useHubActive(), {
      wrapper: wrapperWith({ hubPreviewEnabled: true }),
    })
    expect(result.current).toBe(true)
  })

  it('DOES NOT MOUNT when the flag is false — this is the direction that matters', () => {
    const { result } = renderHook(() => useHubActive(), {
      wrapper: wrapperWith({ hubPreviewEnabled: false }),
    })
    expect(result.current).toBe(false)
  })

  it('the flag OUTRANKS an explicit stored preference of enabled:true', async () => {
    // The switch must beat a user who has deliberately turned the hub ON, or it is
    // not a kill switch — it is a default.
    const { result } = renderHook(() => useHubActive(), {
      wrapper: wrapperWith({ hubPreviewEnabled: false }),
    })
    expect(result.current).toBe(false)
  })

  it('treats a MISSING field as "not killed", never as off', () => {
    // `undefined` means an older backend or a payload that did not parse. Reading
    // that as a shutdown would hide a shipped feature the first time /api/auth/me
    // hiccuped — which is why useHubActive tests `=== false`, not truthiness.
    const { result } = renderHook(() => useHubActive(), {
      wrapper: wrapperWith({}),
    })
    expect(result.current).toBe(true)
  })

  it('still mounts with NO AuthContext provider at all', () => {
    // HubRoot's own tests render bare; the hook must not require a provider.
    const { result } = renderHook(() => useHubActive())
    expect(result.current).toBe(true)
  })
})
