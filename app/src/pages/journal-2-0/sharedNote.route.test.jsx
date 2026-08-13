// The wire-cut rail for NOTE share links — the sharedScreen.route idiom:
// render App AT THE REAL URL (a share link is a URL somebody pastes), mock
// nothing on the path but the network, and assert the markup only
// SharedNotePage writes. A component test would stay green with no route
// registered — "built, tested, green and connected to nothing".
//
// The embed assertion is the security half: a live-capable chart embed in
// the payload must render as its ARCHIVED IMAGE on the public page (a public
// reader never mounts live components that poll auth-scoped APIs).
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { SHARED_NOTE_ENDPOINT, sharedNotePath } from './lib/noteShareLink'
import { buildWidgetEmbedAttrs } from './lib/widgetEmbedCore'

const App = (await import('../../App')).default

const TOKEN = 'nT7qK2_pWx'
const EMBED_ATTRS = {
  ...buildWidgetEmbedAttrs('chart', { symbol: 'AMD', tf: 'D', to: '2026-03-13' }),
  fallback: { url: `/api/j2/shared/${TOKEN}/att/inline/deadbeef.png`, w: 900, h: 500 },
}
const NOTE = Object.freeze({
  title: 'March AMD post-mortem',
  subtitle: 'what the tape said',
  bodyJson: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'The setup, frozen:' }] },
      { type: 'widgetEmbed', attrs: EMBED_ATTRS },
    ],
  },
  heroImageUrl: null,
  updatedAt: '2026-08-13T12:00:00Z',
})

const H = { calls: [], note: NOTE }
const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

beforeEach(() => {
  H.calls = []
  H.note = NOTE
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    H.calls.push(u)
    if (u.startsWith(`${SHARED_NOTE_ENDPOINT}/`)) {
      return H.note
        ? json({ note: H.note })
        : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
    }
    return json({})
  }))
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

describe('🔴 a note share link opens the note it points at', () => {
  it('the URL the owner copies renders the shared note, and asks about ITS token', async () => {
    open(sharedNotePath(TOKEN))
    const page = await screen.findByTestId('shared-note', {}, { timeout: 15000 })
    expect(page,
      'a note share link rendered nothing — the route in App.jsx, SharedNotePage, '
      + 'or its read of the public endpoint is cut.').toBeInTheDocument()
    expect(page).toHaveTextContent(NOTE.title)
    expect(page).toHaveTextContent('The setup, frozen:')
    expect(H.calls).toContain(`${SHARED_NOTE_ENDPOINT}/${TOKEN}`)
  }, 40000)

  it('a live-capable embed renders its ARCHIVED IMAGE publicly, never the live component', async () => {
    open(sharedNotePath(TOKEN))
    await screen.findByTestId('shared-note', {}, { timeout: 15000 })
    const img = await screen.findByRole('img', { name: /Chart — AMD/i }, { timeout: 15000 })
    expect(img.getAttribute('src')).toBe(EMBED_ATTRS.fallback.url)
    // The live chart pipeline must be COLD: no bars fetch ever left the page.
    expect(H.calls.filter((u) => u.includes('/api/bars/'))).toEqual([])
  }, 40000)

  it('a dead token says so instead of erroring', async () => {
    H.note = null
    open(sharedNotePath('revoked-token'))
    const gone = await screen.findByTestId('shared-note-gone', {}, { timeout: 15000 })
    expect(gone).toHaveTextContent(/no longer available/i)
  }, 40000)
})
