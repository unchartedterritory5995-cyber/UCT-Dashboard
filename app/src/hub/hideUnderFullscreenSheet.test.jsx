/**
 * Study spec 2026-10-17 §13.2 T16 — the hub hides while a fullscreen Sheet is mounted.
 *
 * The drill is a fullscreen Sheet; the hub mounts on every page at ≤1023px coarse pointer
 * and would sit over the drill's full-width chart. The Sheet announces itself on <html>
 * (`components/mobile/fullscreenSheetAttr.js`) and `hubViewport.js` reads that through the
 * same MutationObserver it already uses for the chart shell.
 *
 * ⛔ Proved at the PAD, not at the hook — the pattern hubAutoHideRoot.test.jsx sets: a hook
 * rail cannot see a severed wire. This renders the real HubRoot and a real Sheet and reads
 * the `hidden` attribute off `hub-root`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'
import Sheet from '../components/mobile/Sheet'
import { FULLSCREEN_SHEET_ATTR } from '../components/mobile/fullscreenSheetAttr'

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

const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')

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

const renderHub = () => render(
  <MemoryRouter initialEntries={['/desk']}>
    <AuthContext.Provider value={{ user: { role: 'admin' }, plan: 'pro', isPaid: true }}>
      <HubRoot />
    </AuthContext.Provider>
  </MemoryRouter>,
)

beforeEach(() => { mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }; stubCapable() })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete globalThis.CSS
  if (realVisualViewport) Object.defineProperty(window, 'visualViewport', realVisualViewport)
  else delete window.visualViewport
  document.documentElement.removeAttribute(FULLSCREEN_SHEET_ATTR)
  document.body.innerHTML = ''
})

// jsdom delivers MutationObserver callbacks as microtasks; flush them inside act.
const flush = () => act(async () => { await Promise.resolve() })

describe('T16 — the pad hides under a fullscreen Sheet', () => {
  it('a fullscreen Sheet mounting hides the pad; closing it brings the pad back', async () => {
    renderHub()
    const pad = screen.getByTestId('hub-root')
    expect(pad.hasAttribute('hidden'), 'the pad started hidden with no sheet open').toBe(false)

    const sheet = render(<Sheet open onClose={() => {}} variant="fullscreen" ariaLabel="Drill">drill</Sheet>)
    await flush()
    expect(pad.hasAttribute('hidden'), 'the pad did NOT hide under the fullscreen sheet').toBe(true)

    sheet.unmount()
    await flush()
    expect(pad.hasAttribute('hidden'), 'the pad did not come back after the sheet closed').toBe(false)
  })

  it('CONTROL: a bottom-sheet does not hide the pad', async () => {
    renderHub()
    const pad = screen.getByTestId('hub-root')
    render(<Sheet open onClose={() => {}} variant="bottom-sheet" ariaLabel="Jump to">rows</Sheet>)
    await flush()
    expect(pad.hasAttribute('hidden'), 'a bottom-sheet hid the pad').toBe(false)
  })
})
