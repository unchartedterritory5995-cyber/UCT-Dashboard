// app/src/pages/formulas/sharedFormula.route.test.jsx
//
// ─── 🔴 THE WIRE-CUT FOR THE FORMULA SHARE LINK ─────────────────────────────
//
// `GET /api/user-definitions/shared/{token}` shipped served, tested and complete
// — six routes, an append-only share table, a revoke path, a grammar-version
// check — and **no route rendered its answer**. The reachability census found it
// on 2026-08-28: `SharePanel.jsx` hand-typed `${origin}/formulas/shared/${token}`
// into the Copy button and `App.jsx` carried no `/formulas` path of any kind, so
// every link a member had ever sent resolved to the catch-all 404.
//
// ⭐ SO THIS FILE RENDERS `App` AT A REAL URL, NOT THE COMPONENT. A share link is
// a URL somebody pastes into a browser; the only honest question is whether THAT
// URL puts the formula on screen. A `SharedFormula.test.jsx`-style component
// render would have stayed green for the entire time no route existed — which is
// exactly what "built, tested, green and connected to nothing" means, and why a
// component test cannot be the rail here.
//
// ⛔ AND THE SIBLING PROVES THE POINT TWICE OVER. `SharePanel.test.jsx` covers
// the paste box, which pulls the token OUT of a pasted URL — so it exercises the
// share flow end to end while being structurally incapable of noticing that the
// URL it pastes is dead. A green suite is not a reachable feature.
//
// ⛔ NOTHING ON THE PATH IS MOCKED. `App`, its route table, `SharedFormula`,
// `formulaShareLink.js` and the fetch the page makes are all shipped modules;
// the only stub is the network, which cannot make a `shared-formula` element
// appear because no fetch renders markup.
//
// The controls below are what stop this passing for the wrong reason:
//   * a URL that is NOT the route renders nothing — so the assertion is about the
//     route match, not about `App` happening to contain the markup;
//   * the page reads the token FROM THE URL and the stub asserts on it, so a
//     hardcoded fixture cannot satisfy it;
//   * the Copy button's URL is derived from the same module the route is, and a
//     test asserts they agree — the drift this whole module exists to prevent.

import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  SHARED_FORMULA_ROUTE,
  SHARED_FORMULA_PATH,
  sharedFormulaPath,
  sharedFormulaUrl,
  tokenFromShareInput,
} from './formulaShareLink'

const App = (await import('../../App')).default
const { shareUrlFor } = await import('../../components/chart/builder/SharePanel')

const TOKEN = 'sh_0123456789abcdef0123456789abcdef'

const SHARED = Object.freeze({
  definition: {
    meta: { name: 'Leaders pulling back to 20EMA', shortName: 'LP20' },
    repaint: 'non-repainting',
    compute: {
      kind: 'ast',
      scanPlot: 'value',
      source: 'close > ema(close, 20) and rsi(close, 14) < 45',
    },
  },
  author_id: 7,
  origin_def_id: 'u_abc123def456',
  origin_version: 3,
  origin_ast_hash: 'sha256:deadbeef',
  table_version: 41,
})

const H = { asked: [], status: 200, body: SHARED }

function goto(path) {
  window.history.pushState({}, '', path)
}

beforeEach(() => {
  H.asked = []
  H.status = 200
  H.body = SHARED
  vi.stubGlobal('fetch', vi.fn((url) => {
    H.asked.push(String(url))
    return Promise.resolve({
      ok: H.status >= 200 && H.status < 300,
      status: H.status,
      json: () => Promise.resolve(H.body),
    })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  goto('/')
})

describe('🔴 the URL a member copies is a URL the app answers', () => {
  it('⭐⭐ the share link renders the formula — the assertion the 404 failed', async () => {
    goto(sharedFormulaPath(TOKEN))
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('shared-formula')).toBeInTheDocument())
    expect(screen.getByText('Leaders pulling back to 20EMA')).toBeInTheDocument()
    // ⛔ THE TOKEN CAME OUT OF THE URL. A page that ignored the route param and
    // fetched a fixture would pass the assertion above and fail this one.
    expect(H.asked.some((u) => u.includes(TOKEN))).toBe(true)
  })

  it('⛔ CONTROL — a neighbouring URL renders nothing, so the test is about the ROUTE', async () => {
    goto('/formulas/not-a-share/anything')
    render(<App />)
    await waitFor(() => expect(screen.queryByTestId('shared-formula-loading')).toBeNull())
    expect(screen.queryByTestId('shared-formula')).toBeNull()
  })

  it('⭐ the Copy button and the route derive from ONE module, so they cannot drift', () => {
    // The exact defect this file was written for: two hand-typed strings that
    // agree on the day they are written. There is now one string.
    expect(sharedFormulaUrl(TOKEN, 'https://uctintelligence.com'))
      .toBe(`https://uctintelligence.com${SHARED_FORMULA_PATH}/${TOKEN}`)
    expect(shareUrlFor(TOKEN, 'https://uctintelligence.com'))
      .toBe(sharedFormulaUrl(TOKEN, 'https://uctintelligence.com'))
    // …and the route pattern is that same path plus the param, not a retype.
    expect(SHARED_FORMULA_ROUTE).toBe(`${SHARED_FORMULA_PATH}/:token`)
    // The round trip a recipient actually makes: copy a URL, paste it, get the
    // token back. `SharePanel`'s paste box and this page must agree on the shape.
    expect(tokenFromShareInput(sharedFormulaUrl(TOKEN, 'https://x.test'))).toBe(TOKEN)
  })
})

describe('a refusal reads as what it is, not as a broken link', () => {
  it('⛔ 403 is a MEMBERSHIP sentence — the server gates this on require_paid', async () => {
    H.status = 403
    H.body = { detail: 'Not permitted' }
    goto(sharedFormulaPath(TOKEN))
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('shared-formula-needs-plan')).toBeInTheDocument())
    // ⭐ AND IT IS NOT THE DEAD-LINK PAGE. These two answers needed opposite
    // words, which is why `previewSharedDefinition` now returns the HTTP status
    // beside the server's own `reason` — a 403 carries no reason at all.
    expect(screen.queryByTestId('shared-formula-refused')).toBeNull()
  })

  it('⛔ a REVOKED link shows the server sentence AND what to do about it', async () => {
    H.status = 410
    H.body = { detail: { reason: 'revoked', message: 'the member who shared this has since turned the link off' } }
    goto(sharedFormulaPath(TOKEN))
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('shared-formula-refused')).toBeInTheDocument())
    expect(screen.getByText(/turned the link off/)).toBeInTheDocument()
    expect(screen.getByTestId('shared-formula-advice')).toHaveTextContent('Ask them for a new link.')
    // The control that stops the advice being one sentence for every refusal:
    // this reason has an action, and `not-found` above has a different one.
    expect(screen.queryByTestId('shared-formula-needs-plan')).toBeNull()
  })
})
