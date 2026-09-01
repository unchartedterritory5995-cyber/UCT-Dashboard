// app/src/components/navGroups.route.test.jsx
//
// ─── 🔴 THE PLAN'S NAV_GROUPS SNIPPET LISTED A ROUTE THAT DOES NOT EXIST ────
//
// Task 15's brief put `/catalysts` in the `markets` group's `routes`, as
// though it were a real page. It is not — every route in App.jsx was
// checked by hand and the real page is `/catalysts/history`. It is harmless
// TODAY because `routes` is used only as a match-prefix list (a visit to
// `/catalysts/history` still needs to light the Markets tab/heading), but a
// future edit that starts treating a group's whole `routes` array as
// navigable `to`s would silently ship a dead door — the exact "built,
// tested, green, and connected to nothing" shape this repo keeps
// rediscovering (see App.jsx's own `lostDoors.route.test.jsx` and
// `pages/dashboard/doors.route.test.jsx`, both written for the identical
// reason).
//
// ⭐ SO THIS FILE RENDERS THE REAL `App` AT THE URLS THE SHARED MODULE
// ACTUALLY PRODUCES — never a typed URL for a POSITIVE resolution claim.
// `navigableTargets()` (navGroups.js) is the one formula nav consumers
// follow (routes[0] per group, plus home's routes[1] for the free-tier Wire
// entry — NavBar's rail and the MoreSheet directory since the bottom tab
// bar's removal, 2026-09-01); this rail resolves exactly that set against
// App's route table, and
// separately proves `/catalysts` on its own does NOT resolve — turning the
// known gap into a verified, standing fact instead of a landmine.
//
// ⛔ THE ASSERTION IS "renders the app chrome, not the 404 page" — not a
// per-page marker, and not "some text exists" (a loading/auth shell would
// satisfy that long before a route actually resolves — the sibling rail in
// this project shipped a first draft that stayed green on exactly that
// shell). Mirrors `pages/dashboard/doors.route.test.jsx` throughout.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import fs from 'node:fs'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NAV_GROUPS, navigableTargets } from './navGroups'

// The one off-path stub — identical reasoning to doors.route.test.jsx: a
// sibling of <RouteErrorBoundary>, outside <Routes>, whose wake-word
// dependency has no vitest resolution. Not a route, not a page, not a guard.
vi.mock('../components/voice/GlobalVoiceLayer', () => ({ default: () => null }))

const App = (await import('../App')).default

const NOT_FOUND_MARK = 'Page not found'

const json = (body) => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(body),
})

const PAID_AUTH = {
  user: { id: 1, email: 'rail@local', name: 'Rail', role: 'admin', email_verified: true },
  plan: 'lifetime',
}
let authResponse = PAID_AUTH

beforeEach(() => {
  authResponse = PAID_AUTH
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.startsWith('/api/auth/me')) return json(authResponse)
    if (u.startsWith('/api/maintenance')) return json({ maintenance: false })
    // /dashboard and /morning-wire (unlike the pages doors.route.test.jsx
    // covers) render CatalystTable, whose useUserTickerSet hook iterates
    // GET /api/watchlists as an array — the generic {} fallback below threw
    // "(watchlists || []) is not iterable" deep in a tile, which the
    // top-level ErrorBoundary (outside <Routes>, so it swallows the WHOLE
    // app tree, not just the tile) turned into "route never mounted", a
    // false negative unrelated to routing.
    if (u.startsWith('/api/watchlists')) return json([])
    // Same shape mismatch, same false-negative failure mode: MorningWire's
    // "ON THE TAPE" block calls tweets.map() on this response.
    if (u.startsWith('/api/tweets/feed')) return json([])
    return json({})
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

/** Open a URL the way a member does — `App` uses `BrowserRouter`, which reads
 *  `window.location`, so the URL must be set BEFORE the render. */
function open(url) {
  window.history.pushState({}, '', url)
  return render(<App />)
}

describe('🔴 every navigable target resolves against App\'s route table', () => {
  for (const to of navigableTargets()) {
    it(`${to} resolves to a real route`, async () => {
      open(to)
      // ⛔ WAIT ON A POSITIVE SIGNAL, NOT ON "SOME TEXT EXISTS" — a first
      // draft of the sibling rail (doors.route.test.jsx) stayed green on a
      // deliberately broken door because the auth/lazy-chunk loading shell
      // satisfies "some text" long before the route resolves.
      expect(await screen.findByTestId('nav-sidebar', {}, { timeout: 20000 }),
        `${to} never mounted the app chrome — it fell through to the `
        + 'catch-all. Either the route was removed or navGroups.js drifted '
        + 'from it.').toBeInTheDocument()
      expect(screen.queryByText(NOT_FOUND_MARK),
        `${to} renders the 404 page — it is a signpost to nothing.`).toBeNull()
    }, 45000)
  }
})

describe('🔴 /catalysts is a documented, verified gap — not a landmine', () => {
  it('the markets group lists /catalysts as a match-prefix (so /catalysts/history still lights it)', () => {
    const markets = NAV_GROUPS.find((g) => g.key === 'markets')
    expect(markets.routes).toContain('/catalysts')
  })

  it('/catalysts is never a navigableTargets() destination', () => {
    expect(navigableTargets()).not.toContain('/catalysts')
  })

  it('/catalysts on its own resolves to the 404 page — proving the gap is real, not assumed', async () => {
    // ⛔ THE ONE INTENTIONALLY TYPED URL IN THIS FILE. Every positive
    // resolution claim above is read off a rendered component; this is a
    // NEGATIVE claim about a route the plan invented, so there is nothing to
    // read it off — the real route (verified by hand against App.jsx) is
    // `/catalysts/history`, not `/catalysts`.
    open('/catalysts')
    expect(await screen.findByText(NOT_FOUND_MARK, {}, { timeout: 20000 }),
      '/catalysts resolved to a real page — the documented gap this test '
      + 'exists to pin has closed, and NAV_GROUPS\' comment (and this test) '
      + 'should be updated together').toBeInTheDocument()
    expect(screen.queryByTestId('nav-sidebar')).toBeNull()
  }, 45000)
})

describe('the controls that keep the rail honest', () => {
  it('NON-VACUITY: a URL that is not a route renders the 404, not the app chrome', async () => {
    open('/__definitely_not_a_nav_group_route__')
    expect(await screen.findByText(NOT_FOUND_MARK, {}, { timeout: 20000 }),
      'App did not render its 404 page for a URL no route declares, so "not '
      + 'the 404" proves nothing about the targets above').toBeInTheDocument()
    expect(screen.queryByTestId('nav-sidebar'),
      'the catch-all rendered the app chrome, so waiting for the sidebar '
      + 'cannot tell a real route from a dead one').toBeNull()
  }, 45000)

  it('this file mocks NOTHING on the path it measures', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    // ⚠️ fileURLToPath + join, NOT readFileSync(new URL(...)) — the latter
    // throws "The URL must be of scheme file" on this Windows/vitest setup.
    const src = fs.readFileSync(join(here, 'navGroups.route.test.jsx'), 'utf8')
      .replace(/\r\n/g, '\n')
    const mocked = [...src.matchAll(/vi\.(?:mock|doMock|mockObject)\(\s*['"]([^'"]+)['"]/g)]
      .map((m) => m[1])
    expect(mocked,
      'a mock for App, its route table, AuthGuard, Layout or '
      + 'NavBar would let every assertion above pass with the routes deleted')
      .toEqual(['../components/voice/GlobalVoiceLayer'])
  })
})
