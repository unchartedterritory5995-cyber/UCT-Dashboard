// @vitest-environment jsdom
// P0.4 -- the Notices box sits on Research Home, right under the member's own notes (homeTop), in
// EVERY state that renders homeTop: the full home, the quiet home and the quiet home after a
// failed read. One element at one tree position in all three, so a home that flips between them
// keeps the box (and whether the member had it open) mounted -- the reason
// ResearchHome.quietAsk.test.jsx exists for the Ask door. The box is lazy (the Notebook's
// first-open bytes do not carry it), so every assertion waits for the chunk.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import fx from '../../lib/__fixtures__/notices.json'

const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
let hookResult
vi.mock('../../hooks/useNotebookHome', () => ({ default: () => hookResult }))
vi.mock('./AskPanel', () => ({ default: () => <div data-testid="ask-door">ask</div> }))

import ResearchHome from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'

const json = (body) => ({ ok: true, status: 200, json: async () => body })
function installFetch() {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u === '/api/alerts?limit=20') return json(fx.alertsBody)
    if (u === '/api/voice/insights') return json(fx.insightsBody)
    if (u === '/api/auth/preferences') return json({})
    return json({})
  })
}

const tree = (props = {}) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <AuthContext.Provider value={{ isPaid: true, user: { id: 'u1' } }}>
      <MemoryRouter>
        <ResearchHome hasAnyNotes onOpenNote={vi.fn()} onCreateNote={vi.fn()} onCreateThesis={vi.fn()}
          onImport={vi.fn()} {...props} />
      </MemoryRouter>
    </AuthContext.Provider>
  </SWRConfig>
)

const FAVORITES = { ...EMPTY, favorites: [{ id: 'n1', title: 'Fav note', updatedAt: '2026-09-01T00:00:00Z' }] }
const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

beforeEach(() => {
  window.localStorage.clear()
  hookResult = { home: EMPTY, isLoading: false, error: null, refresh: vi.fn() }
  installFetch()
})

describe('Research Home carries the Notices box', () => {
  it('quiet home: the box is there, after the search door and before the Ask door', async () => {
    render(tree())
    const summary = await screen.findByText(/Notices · 3/)
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument()
    // P0.13: the search door is a real search input now, not a button
    const search = screen.getByRole('searchbox', { name: /Search/ })
    expect(follows(search, summary)).toBe(true)
    expect(follows(summary, screen.getByTestId('ask-door'))).toBe(true)
  })

  it('quiet home after a failed read: the box is still there', async () => {
    hookResult = { home: EMPTY, isLoading: false, error: new Error('boom'), refresh: vi.fn() }
    render(tree())
    expect(await screen.findByText(/Notices · 3/)).toBeInTheDocument()
  })

  it('full home: the box is there once, above the sections', async () => {
    hookResult = { home: FAVORITES, isLoading: false, error: null, refresh: vi.fn() }
    render(tree())
    const summary = await screen.findByText(/Notices · 3/)
    expect(screen.getAllByText(/Notices · 3/)).toHaveLength(1)
    expect(follows(summary, screen.getByText('Favorites'))).toBe(true)
  })

  it('quiet -> full keeps the same box mounted (and open) across the flip', async () => {
    const { rerender, container } = render(tree())
    await screen.findByText(/Notices · 3/)
    const details = container.querySelector('details[data-tour="home-notices"]')
    details.open = true
    hookResult = { home: FAVORITES, isLoading: false, error: null, refresh: vi.fn() }
    rerender(tree())
    expect(screen.getByText('Favorites')).toBeInTheDocument()          // the layout DID flip
    const after = container.querySelector('details[data-tour="home-notices"]')
    expect(after).toBe(details)
    expect(after.open).toBe(true)
  })

  it('first run (no notes at all): no Notices box -- the welcome is one short screen', async () => {
    render(tree({ hasAnyNotes: false }))
    expect(screen.getByText('Welcome to your Notebook')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 40))
    expect(screen.queryByText(/Notices ·/)).toBeNull()
  })

  it('a member with nothing to be told sees no box and no empty shell', async () => {
    globalThis.fetch = vi.fn(async (url) => (String(url) === '/api/alerts?limit=20' ? json([]) : json({ insights: [] })))
    const { container } = render(tree())
    await new Promise((r) => setTimeout(r, 60))
    expect(container.querySelector('details[data-tour="home-notices"]')).toBeNull()
  })
})
