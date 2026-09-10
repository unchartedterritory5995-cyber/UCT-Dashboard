/**
 * §8 auto-hide, at the PAD — not just at the hook.
 *
 * ⛔ A hook rail proves the hook. It cannot prove the pad is wired to it, which is the defect this
 * repo keeps re-finding: built, tested, green, and connected to nothing. This case focuses a real
 * field and reads the real `hidden` attribute off `hub-root`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'

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
  <MemoryRouter initialEntries={['/dashboard']}>
    <AuthContext.Provider value={{ user: { role: 'admin' }, plan: 'pro', isPaid: true }}>
      <HubRoot />
    </AuthContext.Provider>
  </MemoryRouter>,
)

beforeEach(() => { mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }; stubCapable() })
afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.CSS
  if (realVisualViewport) Object.defineProperty(window, 'visualViewport', realVisualViewport)
  else delete window.visualViewport
  document.body.innerHTML = ''
})

describe('§8 — the pad auto-hides while a text input is focused', () => {
  it('⛔ focus hides the pad, blur restores it', () => {
    renderHub()
    const pad = screen.getByTestId('hub-root')
    expect(pad.hasAttribute('hidden'), 'the pad started hidden with nothing focused').toBe(false)

    const input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
    act(() => { input.focus() })
    expect(pad.hasAttribute('hidden'), 'the pad did NOT hide while a text field had focus').toBe(true)

    act(() => { input.blur() })
    expect(pad.hasAttribute('hidden'), 'the pad did not come back after blur').toBe(false)
  })

  it('a button taking focus does not hide the pad', () => {
    renderHub()
    const pad = screen.getByTestId('hub-root')
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    act(() => { btn.focus() })
    expect(pad.hasAttribute('hidden'), 'a focused button hid the pad').toBe(false)
    act(() => { btn.blur() })
  })
})
