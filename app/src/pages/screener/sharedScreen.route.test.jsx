// app/src/pages/screener/sharedScreen.route.test.jsx
//
// ─── 🔴 THE WIRE-CUT FOR THE SHARE LINK ─────────────────────────────────────
//
// `GET /api/screener/shared/{share_token}` shipped served, tested and deliberately
// public — and **no route rendered its answer**. The reachability audit found it
// as the thirteenth measured instance of this codebase's signature defect
// (`.superpowers/sdd/audit/reachability-report.md` §3a).
//
// ⭐ SO THIS FILE RENDERS `App` AT A REAL URL, NOT THE COMPONENT. A share link
// is a URL somebody pastes into a browser; the only honest question is whether
// *that URL* puts the screen on screen. `SharedScreen.test.jsx`-style component
// rendering would stay green for the entire time no route existed — which is
// exactly what "built, tested, green and connected to nothing" means, and why a
// component test cannot be the rail here.
//
// ⛔ NOTHING ON THE PATH IS MOCKED. `App`, its route table, `SharedScreen`,
// `screenShareLink.js` and the fetch the page makes are all the shipped modules;
// the only stub is the network itself, which cannot make a `shared-screen`
// element appear because no fetch renders markup.
//
// The controls below are what stop this passing for the wrong reason:
//   * a URL that is NOT the route renders nothing — so the assertion is about
//     the route match, not about `App` happening to contain the markup;
//   * exactly one module in the repo emits `data-testid="shared-screen"`;
//   * the page reads the token FROM THE URL, so a hardcoded fixture cannot
//     satisfy it.

import fs from 'node:fs'
import path from 'node:path'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  SHARED_SCREEN_ROUTE,
  sharedScreenPath,
  sharedScreenReadUrl,
} from './screenShareLink'

const App = (await import('../../App')).default

const TOKEN = 'Ab3xY9_qLm'
const SCREEN = Object.freeze({
  id: 41,
  name: 'Leaders pulling back to 20EMA',
  spec: {
    filters: [
      { key: 'rs_rank', op: 'gte', min: 80 },
      { key: 'pct_vs_ema20', op: 'between', min: -2, max: 2 },
    ],
    view: 'technical',
    sort: { key: 'rs_rank', dir: 'desc' },
  },
  is_public: true,
  share_token: TOKEN,
})

const H = { calls: [], screen: SCREEN }

const json = (body) => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(body),
})

beforeEach(() => {
  H.calls = []
  H.screen = SCREEN
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    H.calls.push(u)
    if (u.startsWith('/api/screener/shared/')) {
      return H.screen
        ? json(H.screen)
        : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
    }
    // Auth, and everything else the shell touches: a well-formed empty answer.
    return json({})
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

/** Open a URL the way a recipient does — `App` uses `BrowserRouter`, which
 *  reads `window.location`, so the URL must be set BEFORE the render. */
function open(url) {
  window.history.pushState({}, '', url)
  return render(<App />)
}

describe('🔴 a share link opens the screen it points at', () => {
  it('the URL a member copies renders the shared screen', async () => {
    open(sharedScreenPath(TOKEN))

    // 🔴 THE WIRE-CUT ASSERTION. `shared-screen` is markup ONLY
    // `SharedScreen.jsx` writes. It is on screen here iff the route in
    // `App.jsx`, the page, and its read of the public endpoint are all intact.
    const card = await screen.findByTestId('shared-screen', {}, { timeout: 15000 })
    expect(card,
      'a share link rendered nothing. `GET /api/screener/shared/{share_token}` is '
      + 'served and public, and NO route in App.jsx answers it — every link a '
      + 'member copies is a 404, and the whole sharing feature is unreachable.')
      .toBeInTheDocument()
    expect(card).toHaveTextContent(SCREEN.name)
  }, 40000)

  it('and it asks the server about the token that was in the URL', async () => {
    open(sharedScreenPath(TOKEN))
    await screen.findByTestId('shared-screen', {}, { timeout: 15000 })
    // ⛔ A PAGE THAT RENDERS AND ASKS FOR NOTHING IS STILL A DEAD DOOR. Derived
    // from the same helper the route and the copy button use, never retyped.
    expect(H.calls).toContain(sharedScreenReadUrl(TOKEN))
  }, 40000)

  it('the filters that were shared are the ones on screen', async () => {
    open(sharedScreenPath(TOKEN))
    const list = await screen.findByTestId('shared-screen-filters', {}, { timeout: 15000 })
    // Derived from the fixture's own spec, so a page that invented labels reds.
    for (const f of SCREEN.spec.filters) expect(list).toHaveTextContent(f.key)
  }, 40000)

  it('and the recipient is told what did and did not cross the line', async () => {
    // Sharing is outward-facing. A surface that shows a stranger a screen
    // without saying what it contains is the part worth railing.
    open(sharedScreenPath(TOKEN))
    const note = await screen.findByTestId('shared-screen-disclosure', {}, { timeout: 15000 })
    expect(note).toHaveTextContent(/filters/i)
    expect(note).toHaveTextContent(/no results/i)
  }, 40000)

  it('an unshared or withdrawn link says so — it does not render a blank page', async () => {
    H.screen = null
    open(sharedScreenPath('gone'))
    expect(await screen.findByTestId('shared-screen-missing', {}, { timeout: 15000 }))
      .toBeInTheDocument()
    expect(screen.queryByTestId('shared-screen')).toBeNull()
  }, 40000)
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
    throw new Error(`sharedScreen.route.test: could not find the repo root from ${process.cwd()}`)
  })()
  const SRC = path.join(ROOT, 'app', 'src')

  it('NON-VACUITY: a URL that is not the route renders no shared screen', async () => {
    // If `App` put this markup on screen regardless of location, every
    // assertion above would be measuring nothing at all.
    open('/__definitely_not_a_route__/' + TOKEN)
    await waitFor(() => expect(document.body.textContent.length).toBeGreaterThan(0),
      { timeout: 15000 })
    expect(screen.queryByTestId('shared-screen'),
      'the shared-screen markup appeared on a URL that is not the share route — '
      + 'this rail cannot tell a mounted route from an unmounted one').toBeNull()
  }, 40000)

  it('exactly one module emits the shared-screen markup', () => {
    // If any other module wrote `data-testid="shared-screen"`, the headline
    // assertion could pass without `SharedScreen` ever being reached.
    const owners = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(abs); continue }
        if (!/\.jsx?$/.test(entry.name)) continue
        if (/\.test\.jsx?$/.test(entry.name)) continue
        const src = fs.readFileSync(abs, 'utf8')
        if (src.includes('data-testid="shared-screen"')) {
          owners.push(path.relative(ROOT, abs).split(path.sep).join('/'))
        }
      }
    }
    walk(SRC)
    expect(owners).toEqual(['app/src/pages/screener/SharedScreen.jsx'])
  })

  it('this file mocks NOTHING on the path it measures', () => {
    const src = fs.readFileSync(
      path.join(SRC, 'pages', 'screener', 'sharedScreen.route.test.jsx'), 'utf8',
    ).replace(/\r\n/g, '\n')
    const mocked = [...src.matchAll(/vi\.mock\(\s*'([^']+)'/g)].map((m) => m[1])
    expect(mocked,
      'a mock for App, SharedScreen or sharedScreen.js would let every assertion '
      + 'above pass with the route deleted').toEqual([])
  })

  it('App.jsx routes on the SHARED constant, not on a retyped path literal', () => {
    // ⛔ A SECOND AUTHORITY OVER ONE VALUE is this repo's most repeated defect.
    // The link the copy button builds and the route that answers it are the same
    // fact; a hand-typed path in either place is a silent 404 waiting for a
    // rename. Asserted structurally so the render cases above cannot mask it.
    const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8').replace(/\r\n/g, '\n')
    expect(app.includes('SHARED_SCREEN_ROUTE'),
      'App.jsx no longer derives the share route from `sharedScreen.js`').toBe(true)
    expect(SHARED_SCREEN_ROUTE.endsWith('/:token'),
      'the route pattern stopped carrying a token parameter').toBe(true)
  })
})
