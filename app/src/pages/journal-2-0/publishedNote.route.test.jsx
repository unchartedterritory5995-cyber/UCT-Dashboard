// Wave 8 seam S8-4 — the wire-cut rail for PUBLISHED pages (the sharedNote.route idiom):
// render App AT THE REAL URL (a published page is a URL somebody pastes), mock nothing
// on the path but the network, and assert markup only PublishedPage writes. A component
// test would stay green with no route registered — "built, tested, green and connected
// to nothing".
//
// What this file pins is the WIRE: both route patterns reach the page, outside AuthGuard (a
// signed-out reader is never sent to a login screen), from paths DERIVED from
// notePublishLink.js. Since lane 8B built the page (wave 8), it also pins what the page shows
// for each of the three payload shapes and for a dead page.
import { render, screen, cleanup, within } from '@testing-library/react'
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

// ── wave 8 lane 8B: the page itself ─────────────────────────────────────────────────────
// The payloads below are shaped exactly as api/services/journal_two/note_publish.py sends
// them (publish-mode reducer output). A body that is not one of the three shapes reads as
// gone -- which is why the stub's empty 200 in the wire cases below still lands on the gone
// state.
const NOTE_BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Weekly thesis body.' }] }] }
const PAYLOADS = {
  '/api/j2/published/notepage': { kind: 'note', note: { title: 'A published note', subtitle: 'the plan',
    bodyJson: NOTE_BODY, heroImageUrl: null, updatedAt: '2026-09-20T12:00:00Z' } },
  '/api/j2/published/folderpage': { kind: 'folder', title: 'Weekly plans', notes: [
    { pid: 'pidOne', title: 'Week 38 plan', updatedAt: '2026-09-20T12:00:00Z' },
    { pid: 'pidTwo', title: 'Week 39 plan', updatedAt: '2026-09-25T12:00:00Z' }] },
  '/api/j2/published/folderpage/n/pidOne': { kind: 'note', folder: { title: 'Weekly plans', path: '/p/folderpage' },
    note: { title: 'Week 38 plan', subtitle: null, bodyJson: NOTE_BODY, heroImageUrl: 'https://youtu.be/x', updatedAt: '2026-09-20T12:00:00Z' } },
}

function stubPublished() {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.includes('/api/auth/me')) return json({}, 401)
    if (PAYLOADS[u]) return json(PAYLOADS[u])
    if (u.startsWith('/api/j2/published/')) return json({ detail: 'Not found' }, 404)
    return json({})
  }))
}

describe('🔴 a published page renders what the server published, to a signed-out reader', () => {
  it('a published note: its title, its body, and the in-page noindex', async () => {
    stubPublished()
    open(`${PUBLISHED_PATH}/notepage`)
    const page = await screen.findByTestId('published-page', {}, { timeout: 15000 })
    expect(page).toHaveTextContent('A published note')
    expect(page).toHaveTextContent('Weekly thesis body.')
    expect(page).toHaveTextContent('Published with UCT Intelligence — Navigate the market, effectively.')
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer')
  }, 40000)

  it('a published folder: its name and its notes, each linking to its page by pid', async () => {
    stubPublished()
    open(`${PUBLISHED_PATH}/folderpage`)
    const page = await screen.findByTestId('published-page', {}, { timeout: 15000 })
    expect(screen.getByRole('heading', { name: 'Weekly plans' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Notes in Weekly plans' })
    expect(within(list).getByRole('link', { name: 'Week 38 plan' })).toHaveAttribute('href', `${PUBLISHED_PATH}/folderpage/n/pidOne`)
    expect(within(list).getByRole('link', { name: 'Week 39 plan' })).toHaveAttribute('href', `${PUBLISHED_PATH}/folderpage/n/pidTwo`)
    expect(page).toHaveTextContent('Updated Sep 20, 2026')
  }, 40000)

  it('a note of a published folder: its folder link back, and no YouTube hero', async () => {
    stubPublished()
    open(`${PUBLISHED_PATH}/folderpage/n/pidOne`)
    const page = await screen.findByTestId('published-page', {}, { timeout: 15000 })
    expect(screen.getByRole('link', { name: '← Weekly plans' })).toHaveAttribute('href', '/p/folderpage')
    expect(page).toHaveTextContent('Week 38 plan')
    expect(page.querySelector('img[src*="youtu"]')).toBeNull()
  }, 40000)

  it('a dead page says so, and still tells a crawler not to index it', async () => {
    stubPublished()
    open(`${PUBLISHED_PATH}/deadpage`)
    const gone = await screen.findByTestId('published-page-gone', {}, { timeout: 15000 })
    expect(gone).toHaveTextContent('This page is no longer available.')
    expect(gone).toHaveTextContent('It may have expired, or been unpublished or removed.')
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow')
  }, 40000)
})

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
