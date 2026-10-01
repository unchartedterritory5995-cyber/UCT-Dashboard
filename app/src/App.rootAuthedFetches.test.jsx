// app/src/App.rootAuthedFetches.test.jsx
//
// Notebook 10/10, lane PF — the app shell was firing authenticated-only
// requests for EVERY visitor on EVERY route, including the public pages a
// stranger opens: the shared-note page (/share/n/:token), the published-note
// page (/p/:slug), and the marketing/login/signup pages. Three components
// mount unconditionally at the app root (App.jsx, outside <Routes>, outside
// <AuthGuard/>) and each pulled in a hook that fetched regardless of auth
// state:
//
//   GlobalAddPositionProvider → useJ2Settings/useJ2SelectedAccount
//       → GET /api/j2/settings (or /api/j2/accounts/{id}/settings)
//       → GET /api/j2/accounts
//     → useTagColors → usePreferences → GET /api/auth/preferences
//   LogoPrewarm → useUserTickerSet → GET /api/watchlists?include_prebuilt=0
//   GlobalVoiceGate → useHubActive → useHubSettings → usePreferences
//       → GET /api/auth/preferences (same endpoint, independent call site)
//
// MEASURED first (scratch rig, the sharedNote.route/App.introSkip idiom):
// rendering the real <App/> at /share/n/:token, /p/:slug and /login signed
// out recorded exactly these four authed-only URLs firing on every route,
// before /api/auth/me ever resolved — each a 401 a stranger has no business
// receiving, on the single web process, on a page that render nothing for
// them anyway.
//
// FIX: each hook above takes an `enabled` parameter defaulting to `true` (so
// every one of their ~30+ other callers — all inside <AuthGuard/>, where
// `user` is already resolved by the time they mount — is unaffected), and the
// three root-mounted callers pass `!loading && !!user`. `GlobalVoiceGate`
// cannot take that shape directly (`useHubActive`/`useHubSettings` live under
// app/src/hub/**, not touched here, and are deliberately safe to call with no
// signed-in user) — it is split into an outer auth gate and an inner
// component that only MOUNTS, and therefore only calls `useHubActive()`, once
// a member is signed in.
//
// This renders the REAL <App/> at the real URLs (the sharedNote.route /
// publishedNote.route idiom) and asserts on the recorded fetch list — never
// on a mock of the hooks under test.
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'

import { sharedNotePath } from './pages/journal-2-0/lib/noteShareLink'
import { publishedPath } from './pages/journal-2-0/lib/notePublishLink'

// Off-path, same exemption as routes/lostDoors.route.test.jsx: `GlobalVoiceGate`
// is a sibling of <RouteErrorBoundary>, outside every <Route>, so mocking it
// cannot make a door look open or closed. The signed-in control needs a PAID
// session (so the voice-orb half of the fetch pair is actually exercised),
// which lazily imports the wake-word layer — a dependency with no vitest
// resolution (only its porcupine-web sibling is aliased in vite.config.js,
// which this task must not edit).
vi.mock('./components/voice/GlobalVoiceLayer', () => ({ default: () => null }))

const App = (await import('./App')).default

const json = (body, status = 200) => Promise.resolve({
  ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body),
})

// The four root-mounted, authed-only requests this rail polices. Listed as
// exact URLs (not substrings) so a near-miss — a different query string, a
// per-account settings variant — cannot silently satisfy the assertion.
const AUTHED_ROOT_URLS = [
  '/api/j2/accounts',
  '/api/j2/settings',
  '/api/watchlists?include_prebuilt=0',
  '/api/auth/preferences',
]

let calls

function stubSignedOut() {
  calls = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    calls.push(String(url))
    return String(url).includes('/api/auth/me') ? json({}, 401) : json({})
  }))
}

function stubSignedInAdmin() {
  calls = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    calls.push(u)
    if (u.startsWith('/api/auth/me')) {
      return json({
        user: { id: 1, email: 'rail@local', display_name: 'Rail', role: 'admin', email_verified: true },
        plan: 'lifetime',
      })
    }
    if (u.startsWith('/api/maintenance')) return json({ maintenance: false })
    if (u.startsWith('/api/traders')) return json([])
    return json({})
  }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
  sessionStorage.clear()
  localStorage.clear()
})

function open(url) {
  window.history.pushState({}, '', url)
  return render(<App />)
}

describe('a signed-out visitor is never asked for a signed-in-only request', () => {
  it('at a shared-note link (/share/n/:token)', async () => {
    stubSignedOut()
    open(sharedNotePath('tokPfRoot1'))
    // Non-vacuity: prove the page actually settled (and so every root-mounted
    // effect had its chance to fire) before reading the call list.
    await screen.findByTestId('shared-note-gone', {}, { timeout: 15000 })
    const fired = AUTHED_ROOT_URLS.filter((u) => calls.includes(u))
    expect(fired, `fired while signed out, on a page meant for a stranger: ${fired.join(', ') || '(none — good)'}`)
      .toEqual([])
  }, 20000)

  it('at a published-note link (/p/:slug)', async () => {
    stubSignedOut()
    open(publishedPath('slugPfRoot1'))
    await screen.findByTestId('published-page-gone', {}, { timeout: 15000 })
    const fired = AUTHED_ROOT_URLS.filter((u) => calls.includes(u))
    expect(fired, `fired while signed out, on a page meant for a stranger: ${fired.join(', ') || '(none — good)'}`)
      .toEqual([])
  }, 20000)
})

// CONTROL — keeps the rail from passing by answering "nothing fires" for
// every visitor. A signed-in member still gets every one of these requests,
// because the root-mounted features they feed (the chart right-click →
// Add to Portfolio menu, the logo warm cache, the voice orb / hub) are real
// member features, not something this fix is allowed to quietly disable.
describe('CONTROL — a signed-in member still gets every one of these requests', () => {
  it('at /traders (an authed route an existing App-level rail already mounts)', async () => {
    stubSignedInAdmin()
    open('/traders')
    await screen.findByRole('heading', { name: 'Traders', level: 1 }, { timeout: 20000 })
    const missing = AUTHED_ROOT_URLS.filter((u) => !calls.includes(u))
    expect(missing, `a signed-in member must still request every one of these: ${missing.join(', ')}`)
      .toEqual([])
  }, 30000)
})
