// app/src/components/tiles/CatalystTable.renderLoop.test.jsx
//
// ⛔⛔ THE TILE MUST SETTLE WHEN THE API RETURNS NOTHING — AND WHEN IT RETURNS SOMETHING.
//
// 2026-09-10: after `80a520cb3` wired the joystick hub into this tile, every `/dashboard` visit
// put the hub-owning copy into an infinite render loop (~4,500 renders/s, ~28,000 DOM mutations
// per 4s against a healthy ~700). React Router's navigation transition never got to commit, so
// clicking any nav entry changed the URL and left the screen where it was; only a hard refresh
// recovered. The member was held on the exact page that was looping, which is why it read as
// app-wide.
//
// ⚰️ IT WAS FILED AS "only when the catalysts API returns no data" (401 locally, 503s during a
// restart in prod). Measured here under the REAL `HubProvider`: the owning tile never settled
// with a healthy payload, a 401 OR a network error alike, and settled in three renders when it
// was not the owner. The API state was a coincidence of when it was noticed — which is exactly
// why this file parametrizes over all three instead of trusting the report's trigger.
//
// The chain (fixed in three places, each with its own rail):
//   `useHubCursor` returned a fresh object per render → `catalystsSection`'s config memo was
//   keyed on that object → `useHubMode` re-registered every render → the hub context value
//   changed → the tile, a context consumer through `useHubMode`, re-rendered → …
//
// This test renders the REAL tile under the REAL provider and counts renders of the real
// component function. It is the one that would have caught the ship: the section's unit tests
// were green because they stub the cursor, and the Dashboard tests mock the tile away.
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Component } from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

import { AuthContext } from '../../context/AuthContext'
import { HubProvider } from '../../hub/HubContext'
import { _reset as resetCursors } from '../../hub/useHubCursor'

// Off-path: the Listen button needs a VoiceProvider and has nothing to do with rendering cost.
vi.mock('../voice/ReadAloudButton', () => ({ default: () => null }))

/** Past this many renders the tile is looping, not settling. A settled mount measures 3–6. */
const CAP = 60
let renders = 0

// Count renders of the REAL component function — a wrapper the tile cannot tell from itself.
vi.mock('./CatalystTable', async (importOriginal) => {
  const mod = await importOriginal()
  const Real = mod.default
  return {
    ...mod,
    default: function CountedCatalystTable(props) {
      renders += 1
      if (renders > CAP) throw new Error(`CatalystTable render loop: ${renders} renders`)
      return Real(props)
    },
  }
})

class Boundary extends Component {
  constructor(p) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? <div data-caught={this.state.error.message} /> : this.props.children }
}

const json = (body, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) })

const HEALTHY = {
  rows: [
    { ticker: 'NVDA', tag: 'Earnings', grade: 'A', price: 120, gap_pct: 3.2, vol_x: 2.1, thesis_text: 'beat' },
    { ticker: 'AMD', tag: 'Gapper', grade: 'B', price: 150, gap_pct: -1.1, vol_x: 1.4, thesis_text: 'gap' },
  ],
  market_date: '2026-09-11',
  refreshed_at: Math.floor(Date.now() / 1000),
}

/**
 * The four states the catalysts endpoint can be in: rows, a 401, a network error — and STILL
 * PENDING. The last one matters most: the 2026-09-10 loop began on the very first mount, before
 * the request had resolved, because `data?.rows || []` manufactured a fresh array per render for
 * as long as `data` was undefined. A rail that waits for the fetch to land never sees that phase.
 */
const API_MODES = {
  healthy: () => json(HEALTHY),
  unauthenticated: () => json({ detail: 'Not authenticated' }, false, 401),
  'network error': () => Promise.reject(new Error('Failed to fetch')),
  'still pending': () => new Promise(() => {}),
}

function stubFetch(catalysts) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.startsWith('/api/catalysts/today')) return catalysts()
    if (u.startsWith('/api/catalysts/my-feedback')) return json({ items: {} })
    if (u.startsWith('/api/watchlists')) return json([])
    if (u.startsWith('/api/live-prices')) return json({})
    return json({})
  }))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetCursors() })
beforeEach(() => { renders = 0 })

async function mountTile({ hubScope, catalysts }) {
  stubFetch(catalysts)
  const { default: CatalystTable } = await import('./CatalystTable')
  const utils = render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthContext.Provider value={{ user: null, plan: null }}>
        <HubProvider>
          <Boundary>
            <CatalystTable hubScope={hubScope} />
          </Boundary>
        </HubProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
  // Let the fetch resolve, SWR commit, and every passive effect run its course.
  await act(async () => { await new Promise((r) => setTimeout(r, 250)) })
  return utils
}

describe('CatalystTable settles — it cannot loop and freeze navigation', () => {
  for (const [name, catalysts] of Object.entries(API_MODES)) {
    it(`⛔⛔ the HUB-OWNING copy settles with the API ${name}`, async () => {
      const { container } = await mountTile({ hubScope: true, catalysts })
      const caught = container.querySelector('[data-caught]')
      expect(caught, caught?.getAttribute('data-caught') || '').toBeNull()
      expect(renders, `the owning tile rendered ${renders}× — the 2026-09-10 loop`).toBeLessThan(CAP)
      expect(renders).toBeGreaterThan(0) // non-vacuity: the real component function ran
    })

    it(`a non-owning copy settles with the API ${name}`, async () => {
      const { container } = await mountTile({ hubScope: false, catalysts })
      expect(container.querySelector('[data-caught]')).toBeNull()
      expect(renders).toBeLessThan(CAP)
      expect(renders).toBeGreaterThan(0)
    })
  }

  it('⭐ THE CONTROL: the healthy payload really renders rows — the loop cases were not an empty tile', async () => {
    const { container } = await mountTile({ hubScope: true, catalysts: API_MODES.healthy })
    const rows = container.querySelectorAll('[data-catalyst-row-id]')
    expect(rows.length).toBe(2)
    // And the owning copy painted its cursor onto the first visible row.
    expect(rows[0].getAttribute('data-hub-cursor')).toBe('active')
  })

  it('⛔ THE CONTROL for the pending case: the tile does not read `data?.rows || []` — a fresh array per render while loading', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    const src = readFileSync(path.join(here, 'CatalystTable.jsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code, 'allRows is derived with `|| []` again: a new array per render while the '
      + 'request is open, and everything memoized on it churns').not.toMatch(/rows\s*\|\|\s*\[\]/)
    expect(code).toMatch(/Array\.isArray\(data\?\.rows\) \? data\.rows : EMPTY_ROWS/)
  })

  it('⭐ THE CONTROL: the failing payloads really render the empty state — the tile was mounted, not blank', async () => {
    const { container } = await mountTile({ hubScope: true, catalysts: API_MODES.unauthenticated })
    expect(container.querySelectorAll('[data-catalyst-row-id]').length).toBe(0)
    expect(container.textContent).toMatch(/catalyst|scan|Markets are closed/i)
  })
})
