// Wave 8 seam S8-4 — the wire-cut rail for PUBLISHED pages (the sharedNote.route idiom):
// render App AT THE REAL URL (a published page is a URL somebody pastes), mock nothing
// on the path but the network, and assert markup only PublishedPage writes. A component
// test would stay green with no route registered — "built, tested, green and connected
// to nothing".
//
// Today PublishedPage is a stub that shows the gone state; lane 8B replaces it. What this
// file pins is the WIRE: both route patterns reach the page, outside AuthGuard (a
// signed-out reader is never sent to a login screen), from paths DERIVED from
// notePublishLink.js.
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { PUBLISHED_PATH, PUBLISHED_ROUTE, PUBLISHED_NOTE_ROUTE } from './lib/notePublishLink'

const App = (await import('../../App')).default

const json = (body, status = 200) => Promise.resolve({
  ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body),
})

beforeEach(() => {
  // Signed out: /api/auth/me answers 401, everything else an empty 200.
  vi.stubGlobal('fetch', vi.fn((url) => (String(url).includes('/api/auth/me') ? json({}, 401) : json({}))))
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

describe('🔴 a published-page URL reaches PublishedPage (signed out, no login wall)', () => {
  it('the route patterns are derived from PUBLISHED_PATH', () => {
    expect(PUBLISHED_ROUTE.startsWith(`${PUBLISHED_PATH}/`)).toBe(true)
    expect(PUBLISHED_NOTE_ROUTE.startsWith(`${PUBLISHED_ROUTE}/`)).toBe(true)
  })

  it.each([
    ['a publication', `${PUBLISHED_PATH}/weekly-plan`],
    ['one note inside a published folder', `${PUBLISHED_PATH}/weekly-plan/n/p1`],
  ])('%s', async (_label, url) => {
    open(url)
    const page = await screen.findByTestId('published-page-gone', {}, { timeout: 15000 })
    expect(page, `${url} rendered nothing — the route in App.jsx or PublishedPage is cut`).toBeInTheDocument()
    expect(page).toHaveTextContent('This page is no longer available.')
  }, 40000)
})
