// app/src/routes/lostDoors.route.test.jsx
//
// ─── 🔴 THE WIRE-CUT FOR THREE DOORS THAT WERE REACHABLE, THEN SILENTLY WEREN'T ──
//
// All three of these features shipped working, kept their green component tests,
// and stopped being reachable without one test going red:
//
//   * `/flow-scoreboard` — `93980419` folded the Flow Scoreboard into
//     `OptionsFlow.jsx` as a `?view=scoreboard` view mode. `ed608046`, a bare
//     "Update OptionsFlow.jsx" web-UI commit the SAME DAY, deleted it. For a
//     month the Dashboard tile AND the `/flow-scoreboard` redirect both opened
//     on the default Stocks tab.
//   * `/traders` — no route ever existed, while `GET /api/traders` stayed
//     mounted and the voice navigator sent members straight at it.
//   * `/alert-tester` — removed by an unexplained "Update App.jsx" web-UI
//     commit while `api/liveflow_worker.py` went on printing the URL as the
//     tuning procedure for the live alert gates.
//
// ⭐ SO THIS FILE RENDERS `App` AT THE REAL URLS, NOT THE COMPONENTS. The only
// honest question about a door is whether the URL puts the page on screen —
// and `FlowScoreboard.test.jsx`-style component rendering stays green for the
// entire time no route reaches it. That is precisely what "built, tested, green
// and connected to nothing" means, and why a component test cannot be the rail.
//
// ⛔ NOTHING ON THE PATH IS MOCKED. `App`, its route table, `AuthGuard`,
// `Layout` and the three pages are the shipped modules; the only stub is the
// network, which cannot make a route match.
//
// ⚠️ ONE EXCEPTION, AND IT IS OFF THE PATH BY CONSTRUCTION: `GlobalVoiceLayer`.
// All three doors sit behind `AuthGuard`, so the stubbed session has to be
// paid — and `GlobalVoiceGate` reacts to `isPaid` by lazily importing the
// wake-word layer, whose `@picovoice/web-voice-processor` dependency has no
// vitest resolution (only its `porcupine-web` sibling is aliased in
// `vite.config.js`, which this task must not edit). It is a fixed overlay
// mounted as a SIBLING of `<RouteErrorBoundary>`, never inside `<Routes>`, so
// it cannot make or break a route match; a control below asserts both that it
// is the only mock in this file and that it really does sit outside the router.
//
// ⭐ THE SCOREBOARD CASE NEVER TYPES A URL. It renders the shipped Dashboard
// tile, reads the href the tile itself produced, and opens THAT on the real
// app — so the tile and the route table cannot drift apart the way they did for
// a month. `A SECOND AUTHORITY OVER ONE VALUE` is this repo's most repeated
// defect; the tile is the authority here and the test is a reader.

import fs from 'node:fs'
import path from 'node:path'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The one off-path stub — see the header. Not a route, not a page, not a guard.
vi.mock('../components/voice/GlobalVoiceLayer', () => ({ default: () => null }))

const App = (await import('../App')).default
const FlowScoreboardTile = (await import('../components/tiles/FlowScoreboardTile')).default

/** Markup each page — and ONLY that page — puts on screen. The controls below
 *  prove exactly one shipped module emits each of these. */
const SCOREBOARD_MARK = 'Every pick, tracked. Every outcome, public.'
const ALERT_TESTER_MARK = 'ALERT TESTER'

const TRADERS = [
  { id: 'tsdr', name: 'TSDR', color: '#3cb868', tickers: ['NVDA', 'META'] },
  { id: 'bracco', name: 'Bracco', color: '#e74c3c', tickers: ['PLTR'] },
]

const SCOREBOARD = {
  picks_tracked: 12,
  too_new: 1,
  overall: { win_rate_25: 41.7, avg_max_gain: 63.2, oi_confirmed_rate: 58.0 },
  by_grade: [], recent_winners: [], recent_picks: [],
  methodology: 'Every Top Flow pick is snapshotted daily until expiration.',
}

const json = (body) => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(body),
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    // An admin on a paid plan — AuthGuard gates all three of these routes, and
    // auth is not the wire under test. Stubbing the network is not mocking the
    // path: no fetch response can make a <Route> match.
    if (u.startsWith('/api/auth/me')) {
      return json({
        user: { id: 1, email: 'rail@local', name: 'Rail', role: 'admin', email_verified: true },
        plan: 'lifetime',
      })
    }
    if (u.startsWith('/api/maintenance')) return json({ maintenance: false })
    if (u.startsWith('/api/traders')) return json(TRADERS)
    if (u.startsWith('/api/flow-scoreboard')) return json(SCOREBOARD)
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

describe('🔴 the three doors open onto the pages they name', () => {
  it('/flow-scoreboard renders the Flow Scoreboard', async () => {
    open('/flow-scoreboard')
    expect(await screen.findByText(SCOREBOARD_MARK, {}, { timeout: 20000 }),
      '/flow-scoreboard rendered no scoreboard. The Dashboard tile and this '
      + 'route are the only two doors onto the verified track record, and both '
      + 'have opened onto the default Options Flow tab since ed608046.')
      .toBeInTheDocument()
  }, 45000)

  it('the Dashboard tile\'s own href opens the scoreboard', async () => {
    // ⛔ THE URL IS READ OFF THE SHIPPED TILE, NEVER TYPED HERE. This is the
    // exact drift that shipped: the tile kept pointing at a query param the
    // page had stopped honouring, and nothing measured the pair together.
    render(<MemoryRouter><FlowScoreboardTile /></MemoryRouter>)
    const link = await screen.findByLabelText('Open the Flow Scoreboard', {}, { timeout: 20000 })
    const href = link.getAttribute('href')
    expect(href, 'the Dashboard tile no longer links anywhere').toBeTruthy()
    cleanup()

    open(href)
    expect(await screen.findByText(SCOREBOARD_MARK, {}, { timeout: 20000 }),
      `the Dashboard tile links to ${href}, and that URL does not render the `
      + 'Flow Scoreboard — the tile is a door onto nothing again')
      .toBeInTheDocument()
  }, 45000)

  it('the old ?view=scoreboard deep link still forwards', async () => {
    // A month of live links and bookmarks point here. `OptionsFlowRoute` in
    // App.jsx honours them from OUTSIDE the partner-owned page.
    open('/options-flow?view=scoreboard')
    expect(await screen.findByText(SCOREBOARD_MARK, {}, { timeout: 20000 })).toBeInTheDocument()
  }, 45000)

  it('/traders renders the Traders page against the live endpoint', async () => {
    open('/traders')
    const heading = await screen.findByRole('heading', { name: 'Traders', level: 1 }, { timeout: 20000 })
    expect(heading,
      '/traders reached no route. GET /api/traders is mounted and paid-gated, '
      + 'and api/services/voice_client_action_tools.py navigates members here — '
      + 'so the voice assistant has been walking them into NotFound.')
      .toBeInTheDocument()
    // ⛔ A PAGE THAT RENDERS AND ASKS FOR NOTHING IS STILL A DEAD DOOR. Derived
    // from the fixture, so a page that invented its own names reds.
    for (const t of TRADERS) {
      expect(await screen.findByText(t.name, {}, { timeout: 20000 })).toBeInTheDocument()
    }
  }, 45000)

  it('/alert-tester renders the simulator the alert pipeline documents', async () => {
    open('/alert-tester')
    expect(await screen.findByText(ALERT_TESTER_MARK, {}, { timeout: 20000 }),
      'api/liveflow_worker.py prints uctintelligence.com/alert-tester as the '
      + 'procedure for tuning the live Discord gates, and the route 404s.')
      .toBeInTheDocument()
  }, 45000)
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
    throw new Error(`lostDoors.route.test: could not find the repo root from ${process.cwd()}`)
  })()
  const SRC = path.join(ROOT, 'app', 'src')

  /** Every non-test module under app/src whose source contains `needle`. */
  function owners(needle) {
    const out = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(abs); continue }
        if (!/\.jsx?$/.test(entry.name) || /\.test\.jsx?$/.test(entry.name)) continue
        if (fs.readFileSync(abs, 'utf8').includes(needle)) {
          out.push(path.relative(ROOT, abs).split(path.sep).join('/'))
        }
      }
    }
    walk(SRC)
    return out
  }

  it('NON-VACUITY: a URL that is not a route renders none of these pages', async () => {
    // If `App` put this markup on screen regardless of location, every
    // assertion above would be measuring nothing at all — which is the precise
    // shape of the bug: a door that looks open because the app still renders.
    open('/__definitely_not_a_route__')
    await waitFor(() => expect(document.body.textContent.length).toBeGreaterThan(0),
      { timeout: 20000 })
    expect(screen.queryByText(SCOREBOARD_MARK)).toBeNull()
    expect(screen.queryByText(ALERT_TESTER_MARK)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Traders', level: 1 }),
      'a page appeared on a URL no route declares — this rail cannot tell a '
      + 'mounted route from an unmounted one').toBeNull()
  }, 45000)

  it('exactly one shipped module emits each marker', () => {
    // If a second module wrote one of these strings, the assertions above could
    // pass without the page ever being reached.
    expect(owners(SCOREBOARD_MARK)).toEqual(['app/src/pages/FlowScoreboard.jsx'])
    expect(owners(`>${ALERT_TESTER_MARK}<`)).toEqual(['app/src/pages/AlertTester.jsx'])
  })

  it('only ONE AlertTester survives — the stale twin inside the Python package is gone', () => {
    // `api/AlertTester.jsx` was a shorter, non-identical copy sitting inside the
    // BACKEND package: unreachable by construction (Python cannot import JSX and
    // Vite's root is `app/`), but a second authority over an admin console that
    // the alert pipeline's documented procedure points at.
    expect(fs.existsSync(path.join(ROOT, 'api', 'AlertTester.jsx')),
      'api/AlertTester.jsx is back — two copies of the tuning console means the '
      + 'documented procedure has two answers').toBe(false)
    expect(fs.existsSync(path.join(SRC, 'pages', 'AlertTester.jsx'))).toBe(true)
  })

  it('this file mocks NOTHING on the path it measures', () => {
    const src = fs.readFileSync(
      path.join(SRC, 'routes', 'lostDoors.route.test.jsx'), 'utf8',
    ).replace(/\r\n/g, '\n')
    const mocked = [...src.matchAll(/vi\.mock\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
    expect(mocked,
      'a mock for App, its route table, AuthGuard, Layout or any of the three '
      + 'pages would let every assertion above pass with the routes deleted')
      .toEqual(['../components/voice/GlobalVoiceLayer'])
  })

  it('and the one thing it does mock is outside the router', () => {
    // ⭐ THE JUSTIFICATION, ASSERTED RATHER THAN CLAIMED. `GlobalVoiceGate` is a
    // sibling of `<RouteErrorBoundary>`, so no `<Route>` can reach it and
    // stubbing it cannot make a door appear open. The day someone moves the
    // voice layer inside `<Routes>`, this control reds and the exemption above
    // has to be re-argued instead of inherited.
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
