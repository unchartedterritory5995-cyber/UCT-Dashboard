// app/src/pages/screener/screenSharing.mount.test.jsx
//
// ─── 🔴 THE WIRE-CUT FOR THE PUBLISH DOOR ───────────────────────────────────
//
// `saved_screens.update` mints `share_token = secrets.token_urlsafe(8)` ONLY
// when `is_public` is true, and **`is_public` was never sent true from anywhere
// in the app**. `useSavedScreens` had exactly two call sites, both in
// `SaveScreenBar.jsx`: `create(name, currentSpec)` (default false) and
// `update(id, { name })`. So no token was ever minted, `get_public()` could
// never match a row, and a complete public-sharing backend was unreachable by
// construction (`.superpowers/sdd/audit/reachability-report.md` §3a).
//
// ⭐ SO THIS FILE RENDERS `<Screener/>` — the module `App.jsx` mounts at
// `/screener`, the destination `NavBar` labels "Screener" — and drives the only
// controls a member has: open the menu, open the share panel, click publish.
// `SaveScreenBar.test.jsx` renders the bar directly with `useSavedScreens`
// MOCKED, so it stayed green for the whole time the publish path did not exist
// and would stay green if `<SaveScreenBar/>` were deleted from `ScannerPro`.
// That is the split: both halves of a severed wire remain individually correct.
//
// ⛔ NOTHING ON THE SHARING PATH IS MOCKED. `Screener`, `ScannerPro`,
// `SaveScreenBar`, `useSavedScreens`, `screenShareLink` and the network calls
// they make are all the shipped modules. The stubs are the scan data lane
// (`useScreenerMeta` / `useScreenerScan`, which own three polls and an
// append-on-identity hazard documented in `ScannerPro.test.jsx`), the SSE price
// pool, and the ticker popover — none of which can send `is_public: true` or
// render a share link, and `test_this_file_mocks_nothing_on_the_sharing_chain`
// asserts exactly that.
//
// ⚠️ SHARING IS OUTWARD-FACING, so the rail carries the safety cases too: a
// newly saved screen must go out PRIVATE, and unpublishing must be offered.

import fs from 'node:fs'
import path from 'node:path'
import { SWRConfig } from 'swr'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { AuthProvider } from '../../context/AuthContext'
import { VoiceProvider } from '../../context/VoiceContext'
import { sharedScreenUrl } from './screenShareLink'

// ── the scan data lane: three hooks, none of them on the sharing path ───────
// Frozen module constants, per the hazard `ScannerPro.test.jsx` documents: a
// fresh object literal per call gives `result` a new identity every render and
// re-fires the accumulate effect forever.
const { META, SCAN } = vi.hoisted(() => ({
  META: { meta: { categories: [], filters: [], views: [{ key: 'overview', label: 'Overview', columns: ['ticker'] }] } },
  SCAN: { result: { total: 0, page: 1, view: 'overview', view_columns: ['ticker'], rows: [], snapshot_date: '2026-08-08' }, isLoading: false },
}))
vi.mock('./hooks/useScreenerMeta', () => ({ default: () => META }))
vi.mock('./hooks/useScreenerScan', () => ({ default: () => SCAN }))
vi.mock('../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../components/TickerPopup', () => ({ default: ({ children, sym }) => <span>{children || sym}</span> }))
vi.mock('../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ menu: null, closeMenu: () => {}, longPressProps: () => ({}) }),
}))

const Screener = (await import('../Screener')).default

const SCREEN_ID = 9
const SCREEN_NAME = 'Leaders pulling back'
const TOKEN = 'Kd7_p2Qz'
const SPEC = { filters: [{ key: 'rs_rank', op: 'gte', min: 80 }], view: 'technical', sort: { key: 'rs_rank', dir: 'desc' } }

const H = { saved: null, calls: [] }

const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

/** The row the saved-screens route answers with. */
const row = (over = {}) => ({
  id: SCREEN_ID, name: SCREEN_NAME, spec: SPEC,
  is_public: false, share_token: null, ...over,
})

beforeEach(() => {
  H.saved = row()
  H.calls = []
  vi.stubGlobal('fetch', vi.fn((url, init) => {
    const u = String(url)
    H.calls.push({ url: u, method: (init && init.method) || 'GET', body: init && init.body })
    if (u.startsWith('/api/auth/me')) {
      return json({ user: { id: 7, email: 'member@uct.test', role: 'user' }, plan: 'premium' })
    }
    if (u.startsWith('/api/screener/saved-screens')) {
      // A write answers with the row; the list read answers with the list.
      if (init && init.method && init.method !== 'GET') return json(H.saved)
      return json({ saved: [H.saved], starters: [] })
    }
    return json({})
  }))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function renderScreenerPage() {
  return render(
    <MemoryRouter initialEntries={['/screener']}>
      <AuthProvider>
        <VoiceProvider>
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
            <Screener />
          </SWRConfig>
        </VoiceProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

/** Do the only things a member can do to reach the publish control. ⛔ Located
 *  by ROLE and accessible name, never by a testid — a member finds these by
 *  reading them, and a rail keyed on a private attribute stays green through a
 *  control that renders invisible. */
async function openTheSharePanel(user) {
  await user.click(await screen.findByRole('button', { name: 'Screens ▾' }))
  await user.click(await screen.findByRole('button', { name: `Share ${SCREEN_NAME}` }))
}

const writes = () => H.calls.filter((c) => c.method !== 'GET' && c.url.startsWith('/api/screener/saved-screens'))

describe('🔴 a member can publish a saved screen and get its link', () => {
  it('the publish control exists on the page App.jsx routes to', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheSharePanel(user)

    const publish = await screen.findByRole('button', { name: /publish a share link/i })
    expect(publish,
      'there is no way to publish a saved screen from /screener. '
      + '`GET /api/screener/shared/{share_token}` is served and `saved_screens.update` '
      + 'mints a token only when `is_public` is true, so with no control that sends '
      + 'it, no token is ever minted and the whole sharing backend is unreachable.')
      .toBeInTheDocument()
  }, 30000)

  it('clicking it sends is_public TRUE for that screen — the fact the backend needs', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheSharePanel(user)
    await user.click(await screen.findByRole('button', { name: /publish a share link/i }))

    await waitFor(() => expect(writes().length).toBeGreaterThan(0))
    const put = writes().at(-1)
    expect(put.method).toBe('PUT')
    expect(put.url).toBe(`/api/screener/saved-screens/${SCREEN_ID}`)
    expect(JSON.parse(put.body),
      'the publish click did not send `is_public: true`, so no share_token is '
      + 'minted and the link the panel offers can never resolve')
      .toEqual({ is_public: true })
  }, 30000)

  it('and once published the copyable link is on screen, pointing at the share route', async () => {
    H.saved = row({ is_public: true, share_token: TOKEN })
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheSharePanel(user)

    const field = await screen.findByLabelText(`Share link for ${SCREEN_NAME}`)
    // ⛔ DERIVED from the same helper `App.jsx` routes on. A retyped URL here
    // would agree with today and silently stop agreeing after a rename — which
    // is the defect the shared module exists to prevent.
    expect(field).toHaveValue(sharedScreenUrl(TOKEN))
    expect(await screen.findByRole('button', { name: /copy/i })).toBeInTheDocument()
  }, 30000)

  it('a published screen offers the way back — publishing is reversible', async () => {
    H.saved = row({ is_public: true, share_token: TOKEN })
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheSharePanel(user)

    await user.click(await screen.findByRole('button', { name: /unpublish/i }))
    await waitFor(() => expect(writes().length).toBeGreaterThan(0))
    expect(JSON.parse(writes().at(-1).body)).toEqual({ is_public: false })
  }, 30000)

  it('and the member is told what a recipient can see, where they decide', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheSharePanel(user)
    const panel = await screen.findByTestId(`share-panel-${SCREEN_ID}`)
    expect(panel).toHaveTextContent(/filters/i)
    expect(panel).toHaveTextContent(/no results/i)
  }, 30000)
})

describe('⛔ nothing publishes itself', () => {
  it('a screen is PRIVATE until somebody publishes it', async () => {
    const user = userEvent.setup()
    renderScreenerPage()
    await openTheSharePanel(user)
    const panel = await screen.findByTestId(`share-panel-${SCREEN_ID}`)
    expect(panel).toHaveTextContent(/private/i)
    expect(screen.queryByLabelText(`Share link for ${SCREEN_NAME}`),
      'a link is being offered for a screen whose `is_public` is false — the '
      + 'panel is inventing a share the server has not granted').toBeNull()
  }, 30000)

  it('saving a NEW screen never sends is_public true', async () => {
    // The brief's hard line: do not auto-publish anything. `create(name, spec)`
    // leaves the third argument at its default false, and this is the assertion
    // that keeps it that way.
    const user = userEvent.setup()
    renderScreenerPage()
    await user.click(await screen.findByRole('button', { name: 'Screens ▾' }))
    await user.type(await screen.findByPlaceholderText('Name this screen…'), 'Breakouts')
    await user.click(await screen.findByRole('button', { name: 'Save current' }))

    await waitFor(() => expect(writes().length).toBeGreaterThan(0))
    const post = writes().at(-1)
    expect(post.method).toBe('POST')
    const body = JSON.parse(post.body)
    expect(body.name).toBe('Breakouts')
    expect(Boolean(body.is_public),
      'saving a screen published it. Sharing must be an explicit act; a default '
      + 'that leaks every saved screen to a public URL is the one outcome this '
      + 'feature must never have.').toBe(false)
  }, 30000)
})

// ─── the controls ───────────────────────────────────────────────────────────

describe('the controls that keep the rail honest', () => {
  const ROOT = (() => {
    let dir = process.cwd()
    for (let i = 0; i < 8; i += 1) {
      if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
    throw new Error(`screenSharing.mount.test: could not find the repo root from ${process.cwd()}`)
  })()
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

  /** Every module a source file stubs, by specifier.
   *  ⚠️ Used on THIS file too, so nothing below may spell a `vi``.mock('…')`
   *  call literally in prose — the scan cannot tell an assertion's example
   *  string from a real stub, and the first draft of this control failed on its
   *  own comment. Ask the regex, never the eye. */
  const mockedSpecifiers = (src) =>
    [...src.matchAll(/vi\.mock\(\s*'([^']+)'/g)].map((m) => m[1])

  it('this file mocks NOTHING on the sharing chain', () => {
    // ⛔ COMPARED ON THE MODULE'S OWN BASENAME, not by substring. A loose
    // `/Screener/` test matches `./hooks/useScreenerMeta`, which is a stub this
    // file is entitled to — a control that cannot tell those apart would have to
    // be loosened until it stopped measuring anything.
    const ON_THE_CHAIN = new Set([
      'Screener', 'ScannerPro', 'SaveScreenBar', 'useSavedScreens', 'screenShareLink',
    ])
    const mocked = mockedSpecifiers(read('app/src/pages/screener/screenSharing.mount.test.jsx'))
    expect(mocked.length, 'the mock scan found nothing — this control is vacuous')
      .toBeGreaterThan(0)
    for (const spec of mocked) {
      const base = spec.split('/').pop().replace(/\.jsx?$/, '')
      expect(ON_THE_CHAIN.has(base),
        `${spec} is mocked, and it is ON the chain this file claims to measure — `
        + 'every assertion above would then pass with the wire cut').toBe(false)
    }
    // …and the control can see a name that really is on the chain, so it is not
    // passing because the set is wrong.
    expect(ON_THE_CHAIN.has('useSavedScreens')).toBe(true)
  })

  it('exactly one module emits the share panel', () => {
    const owners = ['app/src/pages/screener/SaveScreenBar.jsx',
      'app/src/pages/screener/ScannerPro.jsx',
      'app/src/pages/Screener.jsx']
      .filter((rel) => read(rel).includes('data-testid={`share-panel-'))
    expect(owners).toEqual(['app/src/pages/screener/SaveScreenBar.jsx'])
  })

  it('the component test this replaces mocks the hook, and so cannot see the wire', () => {
    // The measurement, executable so it does not rot into folklore: the reason
    // `SaveScreenBar.test.jsx` stayed green through the whole defect.
    const mocked = mockedSpecifiers(read('app/src/pages/screener/SaveScreenBar.test.jsx'))
    expect(mocked,
      'SaveScreenBar.test.jsx no longer stubs the saved-screens hook — if it now '
      + 'drives the real one, this record is stale and should move')
      .toContain('./hooks/useSavedScreens')
  })
})
