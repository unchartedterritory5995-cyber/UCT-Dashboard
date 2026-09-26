// app/src/components/Layout.pageTracking.test.jsx
//
// The tracking chain shipped complete — hook, endpoint, service, table,
// 3 indexes, 4 read queries, Admin UI — and recorded zero rows for its
// whole life, because the hook gated on `document.cookie` while the
// session cookie is HttpOnly. jsdom's document.cookie is "" by default,
// which is exactly production's value. This rail asserts the POST fires
// under that condition.
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'
import Layout from './Layout'

// `NAV_ITEMS` must survive this mock: `surfaces/pageTitle.js` (imported by
// Layout since S1 CP2, 8baca199b) builds its label map from the REAL
// `NAV_ITEMS` at module-evaluation time, so a mock exporting only `default`
// throws "No NAV_ITEMS export is defined on the ./NavBar mock" before a single
// test runs -- the whole file fails to load. Spreading the original keeps every
// real export, present and future, in sync while still replacing the rendered
// component: the same "mock reflects the REAL module surface" rule the
// `usePreferences` mock below already follows. Evaluating the real module is
// safe -- Layout.pageTitle.test.jsx renders the real NavBar outright.
vi.mock('./NavBar', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => null,
}))
vi.mock('./MobileNav', () => ({ default: () => null }))
vi.mock('./FeedbackWidget', () => ({ default: () => null }))
vi.mock('./mobile/MoreSheet', () => ({ default: () => null }))
vi.mock('./mobile/TickerHubSheet', () => ({ default: () => null }))
// `parsePref` is included so this mock reflects the REAL module surface —
// `hub/useHubSettings.js` reaches for it (namespace import, defensively) and
// HubRoot mounts inside this Layout render tree. `useHubSettings.js` already
// guards a missing export with try/catch, so this addition isn't required to
// avoid a crash today, but a mock missing an export the real module has is a
// latent trap for the next file that imports it less defensively — keep the
// two surfaces in sync. Mirrors `usePreferences.js`'s own
// `parsePref(raw, fallback)` contract.
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: {} }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))
vi.mock('../lib/barsPackClient', () => ({ initBarsPack: () => {} }))

beforeEach(() => { global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => ({}) })) })
afterEach(() => { vi.restoreAllMocks() })

test('posts a page view even though document.cookie is empty (HttpOnly session)', async () => {
  expect(document.cookie).toBe('')          // control: matches production
  render(<MemoryRouter initialEntries={['/dashboard']}><Layout /></MemoryRouter>)
  await waitFor(() => {
    const calls = global.fetch.mock.calls.filter(c => c[0] === '/api/auth/track')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0][1].body)).toEqual({ page: '/dashboard' })
  })
})
