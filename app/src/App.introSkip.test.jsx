// Item 1 (Notebook 10/10, lane PX) — the intro-skip rail for the two PUBLIC
// "outsider" pages: a stranger who clicks a shared-note or published-note
// link must never wait through the ~9s brand film (IntroAnimation).
//
// This renders App AT THE REAL URL and mocks nothing on the path but the
// network — the `sharedNote.route.test.jsx` / `publishedNote.route.test.jsx`
// idiom — so it pins the WIRE (App.jsx's INTRO_SKIP_PREFIXES actually reaching
// these routes), not a re-implementation of the skip logic in isolation.
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { sharedNotePath } from './pages/journal-2-0/lib/noteShareLink'
import { publishedPath } from './pages/journal-2-0/lib/notePublishLink'

const App = (await import('./App')).default

const json = (body, status = 200) => Promise.resolve({
  ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body),
})

beforeEach(() => {
  // A stranger, signed out: /api/auth/me answers 401 (production behaviour for
  // an anonymous visitor); everything else an empty 200 so each public page
  // settles into its "gone" state without an unhandled rejection.
  vi.stubGlobal('fetch', vi.fn((url) => (String(url).includes('/api/auth/me') ? json({}, 401) : json({}))))
  // IntroAnimation plays once per ET day per browser (introStorage.js) — clear it
  // so an earlier test in this file can't suppress a later one.
  sessionStorage.clear()
  localStorage.clear()
})

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

const findIntroDialog = () => screen.findByRole('dialog', { name: 'Welcome' }, {}, { timeout: 15000 })
const queryIntroDialog = () => screen.queryByRole('dialog', { name: 'Welcome' })

describe('the intro film skips the public share/publish pages', () => {
  it('does not play on a note share link (/share/n/:token)', async () => {
    open(sharedNotePath('tokIntroSkip1'))
    await screen.findByTestId('shared-note-gone', {}, { timeout: 15000 })
    expect(queryIntroDialog()).toBeNull()
  }, 20000)

  it('does not play on a published note page (/p/:slug)', async () => {
    open(publishedPath('intro-skip-slug'))
    await screen.findByTestId('published-page-gone', {}, { timeout: 15000 })
    expect(queryIntroDialog()).toBeNull()
  }, 20000)

  it('does not play on a note within a published folder (/p/:slug/n/:pid)', async () => {
    open(publishedPath('intro-skip-slug', 'pidIntroSkip1'))
    await screen.findByTestId('published-page-gone', {}, { timeout: 15000 })
    expect(queryIntroDialog()).toBeNull()
  }, 20000)

  // CONTROL — proves the skip is scoped to these paths and not a global
  // regression that silenced IntroAnimation everywhere.
  it('CONTROL: still plays on an ordinary route', async () => {
    open('/dashboard')
    expect(await findIntroDialog()).toBeInTheDocument()
  }, 20000)
})
