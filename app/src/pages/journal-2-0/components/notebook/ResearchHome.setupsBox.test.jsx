
// @vitest-environment jsdom
// P0.5 -- Active setups gets a real door on Research Home: a box near the top (right under the
// Notices box) that says how many plans are open and links to the board. It was a bare link at the
// very bottom of the page.
//
// What this holds:
//   * switch ON: "Active setups · N open" from the board's own read (examples are not the member's
//     setups, so they are not counted), "none open" in words, and ALWAYS the link;
//   * a failed read (a 500, a network error) leaves the box showing "Active setups" and its link,
//     with no count and no error: the door must not disappear because the count could not be read;
//   * switch OFF: no box and NO fetch;
//   * first run (no notes): not offered, and nothing fetched;
//   * position: straight after the Notices box in all three states, as ONE element at one tree
//     position, so a home that flips between quiet and full keeps the same node mounted;
//   * the count read is its own SWR entry, so a failure here can never become the board page's data.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import fx from '../../lib/__fixtures__/notices.json'

const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
const FAVORITES = { ...EMPTY, favorites: [{ id: 'n1', title: 'Fav note', updatedAt: '2026-09-01T00:00:00Z' }] }
let hookResult
vi.mock('../../hooks/useNotebookHome', () => ({ default: () => hookResult }))
vi.mock('./AskPanel', () => ({ default: () => <div data-testid="ask-door">ask</div> }))

import ResearchHome from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { SETUPS_BOARD_PATH, BOARD_URL } from '../../lib/setupsBoardLink'

const here = dirname(fileURLToPath(import.meta.url))
const json = (body) => ({ ok: true, status: 200, json: async () => body })
const BOARD = { cards: [{ noteId: 'a', example: false }, { noteId: 'b', example: false }, { noteId: 'x', example: true }] }

/** `routes` maps a path to a body (200), or to a function returning any response / throwing. */
function stubFetch(routes = {}) {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u in routes) {
      const r = routes[u]
      return typeof r === 'function' ? r() : json(r)
    }
    if (u === '/api/alerts?limit=20') return json(fx.alertsBody)
    if (u === '/api/voice/insights') return json(fx.insightsBody)
    return json({})
  })
}
const fetchUrls = () => globalThis.fetch.mock.calls.map((c) => String(c[0]))

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
const renderHome = (props) => render(tree(props))
const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const box = () => document.querySelector('[data-tour="home-setups"]')

beforeEach(() => {
  window.localStorage.clear()
  __resetNotebookFlags()
  hookResult = { home: EMPTY, isLoading: false, error: null, refresh: vi.fn() }
  stubFetch()
})
afterEach(() => __resetNotebookFlags())

describe('Active setups box, switch ON', () => {
  beforeEach(() => latchNotebookFlags({ notebook_setups_board_enabled: true }))

  it('shows "Active setups · N open" from the board read and links to the board', async () => {
    stubFetch({ [BOARD_URL]: BOARD })
    renderHome()
    expect(await screen.findByText('Active setups · 2 open')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the setups board' }).getAttribute('href')).toBe(SETUPS_BOARD_PATH)
    expect(BOARD_URL).toBe('/api/j2/setups-board')
  })

  it('zero open plans says so in words and still links', async () => {
    stubFetch({ [BOARD_URL]: { cards: [{ noteId: 'x', example: true }] } })
    renderHome()
    expect(await screen.findByText('Active setups · none open')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the setups board' }).getAttribute('href')).toBe(SETUPS_BOARD_PATH)
  })

  it('an empty board reads as none open, not as an unknown count', async () => {
    stubFetch({ [BOARD_URL]: { cards: [] } })
    renderHome()
    expect(await screen.findByText('Active setups · none open')).toBeTruthy()
  })

  it('before the read lands, and with no usable body, the box says only "Active setups" and keeps its link', async () => {
    stubFetch({ [BOARD_URL]: { weird: true } })
    renderHome()
    expect(screen.getByText('Active setups')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the setups board' })).toBeTruthy()
    await waitFor(() => expect(fetchUrls()).toContain(BOARD_URL))
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByText('Active setups')).toBeTruthy()
    expect(screen.queryByText(/open$/)).toBeNull()
    expect(screen.queryByText(/none open/)).toBeNull()
  })

  for (const [name, failing] of [
    ['a 500', () => ({ ok: false, status: 500, json: async () => ({ detail: 'boom' }) })],
    ['a network error', () => { throw new TypeError('Failed to fetch') }],
    ['a body that is not JSON', () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token') } })],
  ]) {
    it(`a failed read (${name}) leaves "Active setups" and the link: no count, never an error`, async () => {
      stubFetch({ [BOARD_URL]: failing })
      renderHome()
      await waitFor(() => expect(fetchUrls()).toContain(BOARD_URL))
      await new Promise((r) => setTimeout(r, 40))
      expect(screen.getByText('Active setups')).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Open the setups board' }).getAttribute('href')).toBe(SETUPS_BOARD_PATH)
      expect(box().textContent).not.toMatch(/\d/)
      expect(box().textContent).not.toMatch(/none open|error|failed|try again|boom/i)
      expect(screen.queryByRole('alert')).toBeNull()
    })
  }

  it('the link has a visually hidden description, tied to it by aria-describedby', async () => {
    stubFetch({ [BOARD_URL]: BOARD })
    renderHome()
    const link = await screen.findByRole('link', { name: 'Open the setups board' })
    const id = link.getAttribute('aria-describedby')
    expect(id).toBeTruthy()
    const desc = document.getElementById(id)
    expect(desc.textContent).toBe('Your open chart plans, closest to their entry first')
    expect(desc.className).toMatch(/srOnly/)
    // and it is read as a description, not as part of the link's name
    expect(link.getAttribute('title')).toBeNull()
  })

  it('is not offered on the first-run screen, and nothing is fetched for it', async () => {
    stubFetch({ [BOARD_URL]: BOARD })
    renderHome({ hasAnyNotes: false })
    expect(screen.getByText('Welcome to your Notebook')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 40))
    expect(box()).toBeNull()
    expect(fetchUrls()).not.toContain(BOARD_URL)
  })
})

describe('Active setups box, position', () => {
  beforeEach(() => latchNotebookFlags({ notebook_setups_board_enabled: true }))

  it('quiet home: straight after the Notices box and before the Ask door', async () => {
    stubFetch({ [BOARD_URL]: BOARD })
    renderHome()
    const notices = await screen.findByText(/Notices · 3/)
    expect(await screen.findByText('Active setups · 2 open')).toBeTruthy()
    expect(follows(notices, box())).toBe(true)
    expect(follows(box(), screen.getByTestId('ask-door'))).toBe(true)
    // it is no longer at the bottom of the page
    expect(follows(screen.getByText('Nothing needs your attention right now.'), box())).toBe(false)
  })

  it('quiet home after a failed home read: still there, after the Notices box', async () => {
    hookResult = { home: EMPTY, isLoading: false, error: new Error('boom'), refresh: vi.fn() }
    renderHome()
    const notices = await screen.findByText(/Notices · 3/)
    expect(follows(notices, box())).toBe(true)
  })

  it('full home: there once, above the sections', async () => {
    hookResult = { home: FAVORITES, isLoading: false, error: null, refresh: vi.fn() }
    renderHome()
    await screen.findByText(/Notices · 3/)
    expect(document.querySelectorAll('[data-tour="home-setups"]')).toHaveLength(1)
    expect(follows(box(), screen.getByText('Favorites'))).toBe(true)
  })

  it('quiet -> full keeps the very same box mounted across the flip', async () => {
    stubFetch({ [BOARD_URL]: BOARD })
    const { rerender } = renderHome()
    await screen.findByText('Active setups · 2 open')
    const before = box()
    hookResult = { home: FAVORITES, isLoading: false, error: null, refresh: vi.fn() }
    rerender(tree())
    expect(screen.getByText('Favorites')).toBeTruthy()          // the layout DID flip
    expect(box()).toBe(before)
    expect(box().textContent).toContain('Active setups · 2 open')
  })
})

describe('Active setups box, switch OFF', () => {
  it('no box, and no fetch of the board', async () => {
    latchNotebookFlags({ notebook_setups_board_enabled: false })
    renderHome()
    await screen.findByText(/Notices · 3/)
    expect(screen.queryByText(/Active setups/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open the setups board' })).toBeNull()
    expect(fetchUrls()).not.toContain(BOARD_URL)
  })

  it('a flag that was never latched is OFF too', async () => {
    renderHome()
    await screen.findByText(/Notices · 3/)
    expect(box()).toBeNull()
    expect(fetchUrls()).not.toContain(BOARD_URL)
  })
})

describe('Active setups box, source', () => {
  const src = (f) => readFileSync(resolve(here, f), 'utf8')

  it('the URL has ONE authority: the link module owns it and both the box and the board import it', () => {
    const lib = readFileSync(resolve(here, '../../lib/setupsBoardLink.js'), 'utf8')
    expect(lib).toMatch(/export const BOARD_URL\s*=\s*'\/api\/j2\/setups-board'/)
    expect(src('SetupsBoard.jsx')).not.toMatch(/const BOARD_URL\s*=/)
    expect(src('SetupsBoard.jsx')).toMatch(/BOARD_URL[^\n]*from '\.\.\/\.\.\/lib\/setupsBoardLink'/)
    expect(src('SetupsBox.jsx')).not.toMatch(/const BOARD_URL\s*=/)
    expect(src('SetupsBox.jsx')).toMatch(/BOARD_URL[^\n]*from '\.\.\/\.\.\/lib\/setupsBoardLink'/)
    expect(src('ResearchHome.jsx')).not.toMatch(/api\/j2\/setups-board/)
  })

  it('the old bottom link is gone: no leftover setupsLink element in the home', () => {
    expect(src('ResearchHome.jsx')).not.toMatch(/\{setupsLink\}/)
    expect(src('ResearchHome.jsx')).toMatch(/\{noticesBox\}\s*\n\s*\{setupsBox\}/)
    expect(src('ResearchHome.jsx').match(/\{setupsBox\}/g)).toHaveLength(3)
  })

  it('the count read is its own SWR entry, not the board page\'s key', () => {
    // A null-on-failure fetcher under the board's own key would hand the board page a "no data"
    // entry; the board page keeps its throwing fetcher under the bare URL.
    expect(src('SetupsBox.jsx')).not.toMatch(/useSWR\(\s*on \? BOARD_URL\s*:/)
    expect(src('SetupsBox.jsx')).toMatch(/\[BOARD_URL, 'open-count'\]/)
  })

  it('Research Home still never imports the board page, nor does the box', () => {
    for (const f of ['ResearchHome.jsx', 'SetupsBox.jsx']) {
      expect(src(f)).not.toMatch(/from\s+['"]\.\/SetupsBoard['"]/)
      expect(src(f)).not.toMatch(/import\(['"]\.\/SetupsBoard['"]\)/)
    }
  })
})
