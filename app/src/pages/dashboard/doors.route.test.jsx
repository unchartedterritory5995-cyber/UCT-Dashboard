// app/src/pages/dashboard/doors.route.test.jsx
//
// ─── 🔴 THE RAIL `doors.js` ALREADY CLAIMED TO HAVE ─────────────────────────
//
// `doors.js`'s own header said *"`doors.test.js` resolves these `to`s against
// the real route table (`app/src/App.jsx`)"*. It did not. `doors.test.js`
// checks key/label/route/icon FORMAT — that `to` starts with a `/` — and
// nothing else, so all eight doors could point at `/nowhere` and stay green.
// A comment making a false claim about what a rail does is worse than no rail:
// it is the reason nobody writes the real one.
//
// ⭐ SO THIS FILE RENDERS THE REAL `App` AT THE HREFS `ZoneDoors` ITSELF
// PRODUCED. Read `app/src/routes/lostDoors.route.test.jsx`'s header before
// changing anything here — it is the precedent, and it exists because three
// features shipped working, kept green component tests, and stopped being
// reachable without one test going red. Two rules carry over verbatim:
//
//   1. NEVER A TYPED URL. The hrefs come off the rendered component, so the
//      manifest and the route table cannot drift the way `/flow-scoreboard`
//      and its Dashboard tile drifted for a month. `ZoneDoors` is the
//      authority; this test is a reader. (`A SECOND AUTHORITY OVER ONE VALUE`
//      is this repo's most repeated defect.)
//   2. NOTHING ON THE PATH IS MOCKED. `App`, its route table, `AuthGuard`,
//      `Layout` and the eight pages are the shipped modules. The only stubs
//      are the network — which cannot make a `<Route>` match — and
//      `GlobalVoiceLayer`, for the identical off-path reason `lostDoors`
//      documents (it is a sibling of `<RouteErrorBoundary>`, outside
//      `<Routes>`, and its wake-word dependency has no vitest resolution).
//      A control below re-asserts that it is still outside the router.
//
// ⛔ THE ASSERTION IS "NOT THE 404 PAGE", NOT A PER-PAGE MARKER. Eight
// hand-written markers would be eight more hand-typed facts to drift, and
// several of these pages (Breadth, Screener, Journal) legitimately render a
// loading shell first. The honest question about a door is whether the URL
// resolves to a route at all, and `App`'s `path="*"` catch-all answers it
// exactly. The non-vacuity control proves the probe can see the 404.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The one off-path stub — see the header. Not a route, not a page, not a guard.
vi.mock('../../components/voice/GlobalVoiceLayer', () => ({ default: () => null }))

const App = (await import('../../App')).default
const ZoneDoors = (await import('./ZoneDoors')).default
const { DOORS } = await import('./doors')

/** Markup ONLY `pages/NotFound.jsx` puts on screen. A control below asserts
 *  it has exactly one owner, so "not the 404" cannot pass for a second reason. */
const NOT_FOUND_MARK = 'Page not found'

const json = (body) => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(body),
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    // An admin on a paid plan — several of these doors are behind AuthGuard,
    // and auth is not the wire under test. Stubbing the network is not mocking
    // the path: no fetch response can make a <Route> match.
    if (u.startsWith('/api/auth/me')) {
      return json({
        user: { id: 1, email: 'rail@local', name: 'Rail', role: 'admin', email_verified: true },
        plan: 'lifetime',
      })
    }
    if (u.startsWith('/api/maintenance')) return json({ maintenance: false })
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

/** The hrefs the SHIPPED component renders, read off the DOM — never typed.
 *  ⛔ NOT MOCKED, not even its data hook: `ZoneDoors` renders every door as a
 *  plain link when the signposts payload is missing (its own test pins that),
 *  so the stubbed `fetch` above is all this needs. One fewer mock is one fewer
 *  way for this rail to pass for the wrong reason. */
function hrefsFromZoneDoors() {
  const out = render(<MemoryRouter><ZoneDoors /></MemoryRouter>)
  const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
  out.unmount()
  cleanup()
  return hrefs
}

describe('🔴 every Zone D door opens onto a real route', () => {
  it('ZoneDoors renders one href per manifest entry — the set this rail then opens', () => {
    // The bridge between the manifest and the DOM. If ZoneDoors ever stopped
    // rendering a door, the per-door cases below would silently stop checking
    // it, so the count is asserted against the manifest here and only here.
    const hrefs = hrefsFromZoneDoors()
    expect(hrefs.sort()).toEqual(DOORS.map((d) => d.to).sort())
  })

  for (const door of DOORS) {
    it(`${door.label} (${door.to}) resolves against App's route table`, async () => {
      // ⛔ THE URL IS READ OFF THE SHIPPED COMPONENT, NEVER TYPED HERE.
      const hrefs = hrefsFromZoneDoors()
      const href = hrefs.find((h) => h === door.to)
      expect(href, `ZoneDoors no longer renders a link for ${door.key}`).toBeTruthy()

      open(href)
      // ⛔ WAIT ON A POSITIVE SIGNAL, NOT ON "SOME TEXT EXISTS". The first
      // draft waited for `document.body.textContent.length > 0` and then
      // asserted the 404 was absent — and a deliberately broken door
      // (`/breadth-nowhere`) STAYED GREEN, because the auth/lazy-chunk
      // loading shell satisfies "some text" long before the route resolves.
      // A rail that reads a page mid-flight measures the shell, not the route
      // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
      //
      // All eight doors are children of `<Layout />`; `NotFound` is declared
      // OUTSIDE it. So the sidebar appearing IS the statement "this URL
      // matched a real Layout route", and its absence is what the catch-all
      // looks like. A control below pins that NotFound renders no sidebar.
      expect(await screen.findByTestId('nav-sidebar', {}, { timeout: 10000 }),
        `Zone D's "${door.label}" card links to ${href}, and App never mounted `
        + 'the app chrome there — the URL fell through to the catch-all. Either '
        + 'the route was removed or doors.js drifted from it.')
        .toBeInTheDocument()
      expect(screen.queryByText(NOT_FOUND_MARK),
        `Zone D's "${door.label}" card links to ${href} and App renders its 404 `
        + 'page there — the door is a signpost to nothing.')
        .toBeNull()
    }, 45000)
  }
})

describe('the controls that keep the rail honest', () => {
  const ROOT = (() => {
    let dir = process.cwd()
    for (let i = 0; i < 8; i += 1) {
      if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
    throw new Error(`doors.route.test: could not find the repo root from ${process.cwd()}`)
  })()
  const SRC = path.join(ROOT, 'app', 'src')

  it('NON-VACUITY: a URL no route declares DOES render the 404', async () => {
    // Without this, every assertion above would pass on an app that never
    // renders NotFound at all — the exact shape of a rail that cannot fail.
    open('/__definitely_not_a_door__')
    expect(await screen.findByText(NOT_FOUND_MARK, {}, { timeout: 20000 }),
      'App did not render its 404 page for a URL no route declares, so "not the '
      + '404" proves nothing about the eight doors above').toBeInTheDocument()
    // …and the POSITIVE marker the per-door cases wait on must be absent here,
    // or "the sidebar appeared" would be true of a dead URL too.
    expect(screen.queryByTestId('nav-sidebar'),
      'the catch-all renders the app chrome, so waiting for the sidebar cannot '
      + 'tell a real route from a dead one').toBeNull()
  }, 45000)

  it('exactly one shipped module emits the chrome marker', () => {
    // The other half of the positive signal: if a second module rendered
    // `nav-sidebar`, a dead URL could satisfy the per-door wait.
    const owners = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(abs); continue }
        if (!/\.jsx?$/.test(entry.name) || /\.test\.jsx?$/.test(entry.name)) continue
        if (fs.readFileSync(abs, 'utf8').includes('data-testid="nav-sidebar"')) {
          owners.push(path.relative(ROOT, abs).split(path.sep).join('/'))
        }
      }
    }
    walk(SRC)
    expect(owners).toEqual(['app/src/components/NavBar.jsx'])
  })

  it('exactly one shipped module emits the 404 marker', () => {
    // If a second module wrote this string, "not the 404" could pass — or fail
    // — for a reason that has nothing to do with the route table.
    const owners = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(abs); continue }
        if (!/\.jsx?$/.test(entry.name) || /\.test\.jsx?$/.test(entry.name)) continue
        if (fs.readFileSync(abs, 'utf8').includes(NOT_FOUND_MARK)) {
          owners.push(path.relative(ROOT, abs).split(path.sep).join('/'))
        }
      }
    }
    walk(SRC)
    expect(owners).toEqual(['app/src/pages/NotFound.jsx'])
  })

  it('this file mocks NOTHING on the path it measures', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    // ⚠️ fileURLToPath + join, NOT `readFileSync(new URL(...))` — the latter
    // throws "The URL must be of scheme file" on this Windows/vitest setup
    // (see AlertBell.delivery.test.jsx).
    const src = fs.readFileSync(path.join(here, 'doors.route.test.jsx'), 'utf8')
      .replace(/\r\n/g, '\n')
    // ⛔ `vi.doMock` IS MATCHED TOO, case-insensitively on the method name. The
    // first draft of this control wrote `vi\.(?:do)?mock` and silently could
    // not see `vi.doMock` (capital M) — a guard that reads only the mock form
    // this file happens not to use is `lesson_gate_that_cannot_fail`.
    const mocked = [...src.matchAll(/vi\.(?:mock|doMock|mockObject)\(\s*['"]([^'"]+)['"]/g)]
      .map((m) => m[1])
    expect(mocked,
      'a mock for App, its route table, AuthGuard, Layout, ZoneDoors or any of '
      + 'the eight pages would let every assertion above pass with the routes '
      + 'deleted')
      .toEqual(['../../components/voice/GlobalVoiceLayer'])
  })

  it('and the one router-adjacent thing it mocks is outside the router', () => {
    // ⭐ THE JUSTIFICATION, ASSERTED RATHER THAN CLAIMED — copied from
    // lostDoors.route.test.jsx so the exemption has to be re-argued, not
    // inherited, the day the voice layer moves inside <Routes>.
    const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8').replace(/\r\n/g, '\n')
    const gate = app.indexOf('<GlobalVoiceGate />')
    const routesEnd = app.indexOf('</Routes>')
    expect(gate, 'App.jsx no longer renders <GlobalVoiceGate />').toBeGreaterThan(-1)
    expect(routesEnd, 'App.jsx no longer closes a <Routes> block').toBeGreaterThan(-1)
    expect(gate,
      'the voice layer moved INSIDE the router — mocking it is no longer '
      + 'off-path and this rail must stop doing it').toBeGreaterThan(routesEnd)
  })
})
