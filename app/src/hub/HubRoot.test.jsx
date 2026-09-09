// Joystick hub — HubRoot's gate evidence: the mount gate, the position, and the "off adds nothing" claim.
// See docs/plans/joystick/00-master-spec-v1.3.md §2c (position), §5 (mount conditions), §B11 (rollout).
//
// ⚠️ WHAT THIS FILE CAN AND CANNOT PROVE. jsdom performs NO LAYOUT: it never
// resolves `calc()`, never applies `env(safe-area-inset-bottom)`, and reports
// zero for every measured box. So this file does NOT prove the hub lands 68px
// above the home indicator on a real iPhone — only a device can prove that, and
// the Phase 3 device matrix is where it belongs.
//
// What it DOES prove, which is the part that can regress silently in code review:
//   1. the four mount conditions each independently gate the render,
//   2. the DECLARED position is exactly what the spec says,
//   3. a visualViewport resize does not change that declaration — i.e. position
//      really is pure CSS with no JS in the loop (spec §2c / Wave 0.5 §3), and
//   4. with the hub off, NOT ONE event listener is registered by anything in
//      this file's tree. That is the gate's literal wording and it is asserted
//      here rather than eyeballed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'

// One mutable prefs bag the mock reads, so each test can set the stored value.
let mockPrefs = {}
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPrefMerged: vi.fn(), loading: false }),
  parsePref: (raw) => {
    if (raw == null) return undefined
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return undefined }
  },
}))

const { default: HubRoot } = await import('./HubRoot.jsx')

// ── Capability stubs. jsdom ships none of these, which is itself meaningful:
// an unstubbed jsdom looks exactly like a browser too old for the hub. ───────
const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')

function stubCapable({ width = 375, height = 812, coarse = true } = {}) {
  globalThis.CSS = { supports: () => true }
  window.visualViewport = {
    width, height,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: coarse && /max-width:\s*1023px/.test(q),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
}

// ⚠️ A Router is REQUIRED, not scaffolding. Since Phase 2, HubRoot derives its mode from the
// route (`useHubViewport` -> `useLocation`), so rendering it bare throws
// "useLocation() may be used only in the context of a <Router>". The real app always has one:
// `BrowserRouter` wraps the whole tree in App.jsx.
const renderHub = (user = null, { route = '/dashboard' } = {}) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <AuthContext.Provider value={{ user, plan: 'pro', trial: null, isPaid: true }}>
        <HubRoot />
      </AuthContext.Provider>
    </MemoryRouter>,
  )

let executed = 0
const ran = () => { executed += 1 }

beforeEach(() => {
  mockPrefs = {}
  stubCapable()
})

afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.CSS
  if (realVisualViewport) Object.defineProperty(window, 'visualViewport', realVisualViewport)
  else delete window.visualViewport
})

describe('HubRoot — the mount gate', () => {
  it('renders nothing for a normal member with nothing stored (hub.enabled defaults off)', () => {
    ran()
    const { container } = renderHub({ role: 'user' })
    expect(container.innerHTML).toBe('')
  })

  it('renders for an admin with nothing stored (the one default-on identity)', () => {
    ran()
    renderHub({ role: 'admin' })
    expect(screen.getByTestId('hub-root')).toBeTruthy()
  })

  it('an explicit false beats the admin default — a choice always wins over a default', () => {
    ran()
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: false }) }
    const { container } = renderHub({ role: 'admin' })
    expect(container.innerHTML).toBe('')
  })

  it('an explicit true turns it on for a non-admin', () => {
    ran()
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    renderHub({ role: 'user' })
    expect(screen.getByTestId('hub-root')).toBeTruthy()
  })

  it('does not mount without backdrop-filter support', () => {
    ran()
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    globalThis.CSS = { supports: () => false }
    const { container } = renderHub({ role: 'user' })
    expect(container.innerHTML).toBe('')
  })

  it('does not mount without window.visualViewport', () => {
    ran()
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    delete window.visualViewport
    const { container } = renderHub({ role: 'user' })
    expect(container.innerHTML).toBe('')
  })

  it('does not mount on a fine pointer or a wide viewport', () => {
    ran()
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    stubCapable({ coarse: false })
    const { container } = renderHub({ role: 'user' })
    expect(container.innerHTML).toBe('')
  })
})

describe('HubRoot — off adds no listeners', () => {
  it('registers ZERO event listeners while disabled', () => {
    ran()
    const winSpy = vi.spyOn(window, 'addEventListener')
    const docSpy = vi.spyOn(document, 'addEventListener')

    const { container } = renderHub({ role: 'user' })

    expect(container.innerHTML).toBe('')
    expect(winSpy).not.toHaveBeenCalled()
    expect(docSpy).not.toHaveBeenCalled()
    // The visualViewport stub carries its own spy — the keyboard hook lives
    // inside HubPad, which a disabled HubRoot never mounts at all.
    expect(window.visualViewport.addEventListener).not.toHaveBeenCalled()
  })
})

describe('HubRoot — the declared position (spec §2c)', () => {
  it('is fixed at right:24px, bottom:calc(env(safe-area-inset-bottom) + 68px), 84x84', () => {
    ran()
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    renderHub({ role: 'user' })
    const el = screen.getByTestId('hub-root')

    expect(el.style.position).toBe('fixed')
    expect(el.style.right).toBe('24px')
    expect(el.style.width).toBe('84px')
    expect(el.style.height).toBe('84px')
    // jsdom does not resolve calc(); the declaration itself is the artifact.
    // ⚠️ Assert the OPERANDS, not the string. The source writes
    // `calc(env(safe-area-inset-bottom) + 68px)` and jsdom's CSS serializer
    // hands back `calc(68px + env(safe-area-inset-bottom))` — same declaration,
    // reordered. Pinning the literal string tests the serializer, not the hub.
    const bottom = el.style.bottom
    expect(bottom).toContain('68px')
    expect(bottom).toContain('env(safe-area-inset-bottom)')
  })

  it('DOM dump at 375x812 — the gate artifact', () => {
    ran()
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    stubCapable({ width: 375, height: 812 })
    renderHub({ role: 'user' })
    const el = screen.getByTestId('hub-root')
    // Printed so the gate report quotes a real dump rather than a description.
    // eslint-disable-next-line no-console
    console.log('[hub-root @375x812] ' + el.outerHTML)
    expect(el.outerHTML).toContain('data-testid="hub-root"')
  })

  it('the declaration is IDENTICAL with the browser toolbar collapsed — position is pure CSS', () => {
    ran()
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }

    // Toolbar expanded: the visual viewport is shorter than the layout viewport.
    stubCapable({ width: 375, height: 725 })
    const expanded = renderHub({ role: 'user' })
    const expandedStyle = screen.getByTestId('hub-root').getAttribute('style')
    // eslint-disable-next-line no-console
    console.log('[hub-root @375x812, toolbar EXPANDED (vv 725)] ' + expandedStyle)
    expanded.unmount()

    // Toolbar collapsed: the visual viewport grows to the full height.
    stubCapable({ width: 375, height: 812 })
    renderHub({ role: 'user' })
    const collapsedStyle = screen.getByTestId('hub-root').getAttribute('style')
    // eslint-disable-next-line no-console
    console.log('[hub-root @375x812, toolbar COLLAPSED (vv 812)] ' + collapsedStyle)

    // ⭐ The assertion IS the design claim: nothing in JS repositions the hub,
    // so the declaration cannot differ between the two toolbar states. If this
    // ever fails, someone has started driving position from visualViewport —
    // which buys a guaranteed frame of lag the compositor already avoids.
    expect(collapsedStyle).toBe(expandedStyle)
  })
})

describe('rail integrity', () => {
  it('actually executed its cases — a vitest -t regex matching nothing exits 0 and reads as a PASS', () => {
    expect(executed).toBeGreaterThanOrEqual(11)
  })
})
