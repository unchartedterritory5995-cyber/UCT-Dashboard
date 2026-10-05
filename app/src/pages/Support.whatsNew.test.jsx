// Help > What's new (wave 14, lane W14-C2; default D4), over a FAKE registry -- this
// branch's real one holds only the base tour, which What's new never lists. Copy is
// asserted as rendered text; every request is read from fetch.mock.calls.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { AuthContext } from '../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from './journal-2-0/lib/offline/notebookFlags'
import { expectNoAxeViolations } from './journal-2-0/a11y/axeHarness'
import { WHATS_NEW_COPY } from './journal-2-0/components/notebook/onboarding/tourOfferCopy'

// Integration (C2 merged onto B1-B3): the fake tours borrow flags NO real tour is gated on,
// so the real registry's tours stay out of these lists (they borrowed real tour flags before).
const FLAG_A = 'notebook_voice_notes_enabled'
const FLAG_B = 'notebook_ai_actions_enabled'
const FLAG_OFF = 'notebook_trade_canvas_enabled'

vi.mock('./journal-2-0/components/notebook/onboarding/tourRegistry', async (importOriginal) => {
  const real = await importOriginal()
  const tour = (id, flag, title, extra = {}) => ({ id, flag, title, replayable: true, load: async () => ({}), ...extra })
  const FAKE = [
    ...real.TOUR_REGISTRY,
    tour('c2-a', 'notebook_voice_notes_enabled', 'Template gallery'),
    tour('c2-b', 'notebook_ai_actions_enabled', 'Chart fingerprint', { start: '/journal/notebook?view=all' }),
    tour('c2-off', 'notebook_trade_canvas_enabled', 'Setups board'),
  ]
  return { ...real, TOUR_REGISTRY: FAKE, replayableTours: () => FAKE.filter((t) => t.replayable) }
})

// imported AFTER the mock is declared (vitest hoists vi.mock)
const { default: Support } = await import('./Support')

let server
beforeEach(() => {
  __resetNotebookFlags()
  // W14-C1: task reminders reads ON when unset (a kill switch); pinned OFF so the fake tours are the list
  latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_task_reminders_enabled: false, [FLAG_A]: true, [FLAG_B]: true, [FLAG_OFF]: false })
  server = { prefs: {} }
  global.fetch = vi.fn(async (url) => {
    if (url === '/api/auth/preferences') return { ok: true, json: async () => ({ ...server.prefs }) }
    if (url === '/api/auth/faq-votes') return { ok: true, json: async () => ({ votes: [] }) }
    if (url === '/api/auth/tickets') return { ok: true, json: async () => [] }
    if (url === '/api/support/status') return { ok: true, json: async () => ({ status: 'operational', components: [] }) }
    return { ok: false, json: async () => ({}) }
  })
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

function Landed() {
  const loc = useLocation()
  return <p>landed at {loc.pathname}{loc.search} with {JSON.stringify(loc.state)}</p>
}

function renderSupport() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ user: { id: 'u1', email: 'm@local.dev' }, plan: 'pro', isPaid: true }}>
        <MemoryRouter initialEntries={['/support']}>
          <Routes>
            <Route path="/support" element={<Support />} />
            <Route path="/journal/notebook" element={<Landed />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}

const section = () => screen.findByRole('region', { name: WHATS_NEW_COPY.heading }, { timeout: 3000 })
const rows = (s) => within(s).getAllByRole('listitem').map((li) => li.firstChild.textContent)

describe("Help > What's new", () => {
  it('lists every armed tour the member has never seen, in registry order, each with Start', async () => {
    renderSupport()
    const s = await section()
    expect(s).toHaveTextContent(WHATS_NEW_COPY.lead)
    expect(rows(s)).toEqual(['Template gallery', 'Chart fingerprint'])        // flag-off one absent, base absent
    const start = within(s).getByRole('link', { name: 'Start the Chart fingerprint tour' })
    expect(start).toHaveTextContent(WHATS_NEW_COPY.start)
    expect(start).toHaveAttribute('href', '/journal/notebook?view=all')        // the tour's own start
  })

  it('a tour declined from the offer ("Not now", step null) is still new; one walked, finished or skipped from inside is not', async () => {
    server.prefs = {
      notebook_tours: JSON.stringify({
        'c2-a': { v: 1, state: 'dismissed', step: null },
        'c2-b': { v: 1, state: 'dismissed', step: 's2' },
      }),
    }
    renderSupport()
    expect(rows(await section())).toEqual(['Template gallery'])
  })

  it('nothing new: no section at all (never an empty heading)', async () => {
    server.prefs = {
      notebook_tours: JSON.stringify({ 'c2-a': { v: 1, state: 'done', step: 'x' }, 'c2-b': { v: 1, state: 'started', step: 'y' } }),
    }
    renderSupport()
    await screen.findByText('Walkthroughs', {}, { timeout: 3000 })               // the page did render
    expect(screen.queryByRole('region', { name: WHATS_NEW_COPY.heading })).toBeNull()
  })

  it('Start carries the registry state that opens THAT tour', async () => {
    const user = userEvent.setup()
    renderSupport()
    const s = await section()
    await user.click(within(s).getByRole('link', { name: 'Start the Template gallery tour' }))
    expect(await screen.findByText(/landed at \/journal\/notebook/)).toHaveTextContent('{"startRegistryTourId":"c2-a"}')
  })

  it('keyboard: each Start is reachable by Tab', async () => {
    const user = userEvent.setup()
    renderSupport()
    const s = await section()
    const links = within(s).getAllByRole('link')
    const reached = new Set()
    for (let i = 0; i < 60 && reached.size < links.length; i += 1) {
      await user.tab()
      if (links.includes(document.activeElement)) reached.add(document.activeElement)
    }
    expect(reached.size).toBe(links.length)
  })

  it('D4: rendering and following it never writes anything -- the checklist is never reopened', async () => {
    renderSupport()
    await section()
    const writes = global.fetch.mock.calls.filter(([, i = {}]) => i.method && i.method !== 'GET')
    expect(writes.map(([u, i]) => [u, i.body ? JSON.parse(i.body).key : null]).filter(([, k]) => k === 'notebook_getting_started')).toEqual([])
    expect(global.fetch.mock.calls.some(([u, i = {}]) => u === '/api/auth/preferences' && i.method === 'POST')).toBe(false)
  })

  it('axe: zero violations with the section on screen', async () => {
    const { container } = renderSupport()
    await section()
    await expectNoAxeViolations(container)
  }, 30_000)
})

describe('the Start control meets the touch tier', () => {
  it('shares the Replay control\'s class, which carries var(--tap-min) at <=1024px', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const css = fs.readFileSync(path.resolve(__dirname, 'Support.module.css'), 'utf8')
    const block = /@media \(max-width: 1024px\) \{\s*\.walkthroughReplay \{[^}]*min-height: var\(--tap-min\)/
    expect(css).toMatch(block)
    renderSupport()
    const s = await section()
    for (const a of within(s).getAllByRole('link')) expect(a.className).toMatch(/walkthroughReplay/)
  })
})

describe('first paint', () => {
  it('waits for the preferences rather than flashing a list that may be wrong', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const orig = global.fetch
    global.fetch = vi.fn(async (url, init) => {
      if (url === '/api/auth/preferences') { await gate; return { ok: true, json: async () => ({ ...server.prefs }) } }
      return orig(url, init)
    })
    server.prefs = { notebook_tours: JSON.stringify({ 'c2-a': { v: 1, state: 'done', step: 'x' } }) }
    renderSupport()
    await screen.findByText('Walkthroughs', {}, { timeout: 3000 })
    expect(screen.queryByRole('region', { name: WHATS_NEW_COPY.heading })).toBeNull()
    release()
    await waitFor(() => expect(rows(screen.getByRole('region', { name: WHATS_NEW_COPY.heading }))).toEqual(['Chart fingerprint']))
  })
})
