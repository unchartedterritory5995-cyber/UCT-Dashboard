// ⭐ OWNER RULING 2026-10-02 (TERM-081 / OI-12): "Everything is paywall."
//
// The rail for "there are no free member pages". It holds three facts:
//   1. FREE_PAGES, the one authority, is empty, and every nav entry is paid.
//      Derived from the declared nav tables, not a hand-picked sample.
//   2. A signed-in member without a paid plan who opens the Morning Wire (or any
//      member page) lands on the EXISTING upgrade screen. Proven by the rendered
//      text of the real App, not by reading a redirect target.
//   3. That landing settles. With COMING_SOON on, PreLaunchGate used to send a
//      free member from /subscribe to the free page; with no free page that would
//      be /subscribe -> /subscribe forever, so it is rendered with the flag on too.
// The server half is `tests/test_wire_paywall.py`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { FREE_PAGES, UPGRADE_PATH } from './freePages'
import { NAV_GROUPS, navigableTargets } from '../components/navGroups'
import { NAV_ITEMS } from '../components/NavBar'

const flags = vi.hoisted(() => ({ comingSoon: false }))
vi.mock('../utils/comingSoon', () => ({
  get COMING_SOON() { return flags.comingSoon },
}))
// Same off-path stub as navGroups.route.test.jsx: outside <Routes>, and its
// wake-word dependency has no vitest resolution.
vi.mock('../components/voice/GlobalVoiceLayer', () => ({ default: () => null }))

const App = (await import('../App')).default

const UPGRADE_TEXT = 'Unlock the Intelligence Layer'

const FREE_AUTH = {
  user: { id: 7, email: 'free@local', display_name: 'Free', role: 'member', email_verified: true },
  plan: 'free',
}
const PAID_AUTH = {
  user: { id: 8, email: 'paid@local', display_name: 'Paid', role: 'member', email_verified: true },
  plan: 'pro',
}
let authResponse = FREE_AUTH

const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

beforeEach(() => {
  flags.comingSoon = false
  authResponse = FREE_AUTH
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.startsWith('/api/auth/me')) return json(authResponse)
    if (u.startsWith('/api/maintenance')) return json({ maintenance: false })
    if (u.startsWith('/api/watchlists')) return json([])
    if (u.startsWith('/api/tweets/feed')) return json([])
    return json({})
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

function open(url) {
  window.history.pushState({}, '', url)
  return render(<App />)
}

describe('the free-page set is empty and every nav entry requires paid', () => {
  it('FREE_PAGES is empty', () => {
    expect(Array.isArray(FREE_PAGES)).toBe(true)
    expect(FREE_PAGES).toEqual([])
  })

  it('no NavBar item, NAV_GROUPS route or navigable target is a free page', () => {
    const declared = [
      ...NAV_ITEMS.map((i) => i.to),
      ...NAV_GROUPS.flatMap((g) => g.routes),
      ...navigableTargets(),
    ]
    // Non-vacuity: the tables were read, and the Wire is among them.
    expect(declared.length).toBeGreaterThan(20)
    expect(declared).toContain('/morning-wire')
    // The call sites' own predicates (NavBar/MoreSheet exact, AuthGuard prefix).
    for (const to of declared) {
      expect(FREE_PAGES.includes(to), `${to} is a free nav entry`).toBe(false)
      expect(FREE_PAGES.some((p) => to.startsWith(p)), `${to} passes AuthGuard unpaid`).toBe(false)
    }
  })

  it('the upgrade destination is not a member page', () => {
    expect(UPGRADE_PATH).toBe('/subscribe')
    expect(NAV_ITEMS.map((i) => i.to)).not.toContain(UPGRADE_PATH)
  })
})

describe('a free member who opens the Wire gets the upgrade screen', () => {
  for (const comingSoon of [false, true]) {
    describe(`COMING_SOON=${comingSoon}`, () => {
      it('/morning-wire lands on the upgrade screen and stays there', async () => {
        flags.comingSoon = comingSoon
        open('/morning-wire')
        expect(await screen.findByText(UPGRADE_TEXT, {}, { timeout: 20000 })).toBeInTheDocument()
        expect(window.location.pathname).toBe(UPGRADE_PATH)
      }, 45000)

      it('/subscribe itself renders (does not bounce to itself)', async () => {
        flags.comingSoon = comingSoon
        open('/subscribe')
        expect(await screen.findByText(UPGRADE_TEXT, {}, { timeout: 20000 })).toBeInTheDocument()
        expect(window.location.pathname).toBe(UPGRADE_PATH)
      }, 45000)
    })
  }

  it('another member page (/dashboard) gives the same treatment', async () => {
    open('/dashboard')
    expect(await screen.findByText(UPGRADE_TEXT, {}, { timeout: 20000 })).toBeInTheDocument()
  }, 45000)

  it('control: a PAID member opens the Wire and is not sent to upgrade', async () => {
    authResponse = PAID_AUTH
    open('/morning-wire')
    await screen.findByTestId('nav-sidebar', {}, { timeout: 20000 })
    await waitFor(() => expect(window.location.pathname).toBe('/morning-wire'))
    expect(screen.queryByText(UPGRADE_TEXT)).toBeNull()
  }, 45000)
})
