// app/src/pages/dashboard/ZoneDoors.clientFill.test.jsx
//
// journal/desk/community are permanently null from the SERVER (per-user data
// / uncached request path — see dashboard_signposts.py's docstring, and
// ZoneDoors.jsx's own header comment). This file covers the CLIENT fill that
// replaces those nulls from data other already-mounted tiles on /dashboard
// already fetch: JournalSnapshotTile (journal), TheWeek (desk, weekend-only),
// NavBar (community).
//
// ⛔ MOCKS NOTHING ON THE PATH UNDER TEST except the top-level signposts poll
// (`useMobileSWR`, mirroring ZoneDoors.route.test.jsx's own reasoning — a
// bare-`useSWR` mock there would silently stop catching a regression back to
// a bare call). The journal/desk/community reads go through the REAL `swr`
// package and the REAL SWR cache, seeded via `SWRConfig`'s `fallback` — the
// same idiom `TheWeek.errors.test.jsx` and `ZoneDoors.route.test.jsx` already
// use for a real (non-mocked) `useSWR` call. Each test gets a FRESH cache
// (`provider: () => new Map()`) or a later test would read an earlier test's
// answer.
//
// ⛔ "ZERO NEW REQUESTS" IS COVERED IN A SEPARATE FILE
// (`ZoneDoors.readOnly.test.jsx`), not here, and that split is deliberate —
// not an oversight. A real-`fetch`-spy version was tried here first and
// PASSED even after `READ_ONLY` was deleted outright: SWR defers a
// with-fallback-data mount revalidation to `requestAnimationFrame`
// (`node_modules/swr/dist/index/index.mjs`'s `rAF(softRevalidate)` branch),
// and jsdom's rAF interacts with `act()`/React's test scheduler badly enough
// that no amount of `await Promise.resolve()` / `setTimeout` flushing made
// the assertion trustworthy — it is a fixture that cannot discriminate
// (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). The reliable
// version mocks `swr` directly and asserts the CONFIG each hook is called
// with (`revalidateOnMount: false` etc.) — the actual mechanism the
// guarantee rests on, not an attempt to empirically outlast SWR's internal
// scheduling in jsdom.
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import ZoneDoors from './ZoneDoors'
import { DOORS } from './doors'

let mockData

vi.mock('../../hooks/useMobileSWR', () => ({
  default: () => ({ data: mockData }),
}))

beforeEach(() => { mockData = {} })
afterEach(() => { cleanup() })

const doorValue = (label) => {
  const link = screen.getByRole('link', { name: new RegExp(`^${label}`) })
  return link.textContent.slice(label.length) || null
}

/** A fresh cache per case, or SWR serves a previous test's answer. */
const mount = (fallback = {}) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, fallback }}>
    <MemoryRouter><ZoneDoors /></MemoryRouter>
  </SWRConfig>,
)

describe('ZoneDoors — client-filled journal/desk/community', () => {
  test('journal: sums open equity positions + open option strategies from the already-fetched keys', () => {
    mount({
      '/api/j2/positions': { positions: [{ id: 1 }, { id: 2 }] },
      '/api/j2/options?status=open': { strategies: [{ id: 'o1' }] },
    })
    expect(doorValue('Journal')).toBe('3')
  })

  test('journal: a genuine ZERO open positions renders "0", not a blank door', () => {
    mount({
      '/api/j2/positions': { positions: [] },
      '/api/j2/options?status=open': { strategies: [] },
    })
    expect(doorValue('Journal')).toBe('0')
  })

  test('journal: neither endpoint has answered yet — stays a plain link, never a fabricated 0', () => {
    mount({})
    const link = screen.getByRole('link', { name: 'Journal' })
    expect(link.textContent).toBe('Journal')
  })

  test('journal: one endpoint failed (nullOnErrorFetcher\'s null), the other answered — partial count, not "unknown"', () => {
    mount({
      '/api/j2/positions': { positions: [{ id: 1 }] },
      '/api/j2/options?status=open': null,
    })
    expect(doorValue('Journal')).toBe('1')
  })

  // ⚰️ THE DESK DOOR IS NO LONGER CLIENT-FILLED — it comes from
  // `dashboard_signposts.py`. The two cases that used to live here were a
  // 48h-window count and a "weekday, not fetched" blank, and BOTH described a
  // mechanism that could not work in production:
  //   • blank Mon–Fri, because the key was borrowed from `TheWeek`, which
  //     mounts only at the weekend;
  //   • structurally "0" whenever it DID render, because
  //     `substack_posts.published_at` is a unix EPOCH INT and the filter used
  //     `Date.parse(a.published_at)` — `NaN` for an integer, so every article
  //     failed `Number.isFinite`.
  // ⛔ AND THE OLD TEST COULD NOT SEE EITHER ONE, because its fixture built
  // ISO strings (`new Date(...).toISOString()`) that the real endpoint never
  // sends. A fixture that does not match the wire measures your own spelling
  // (`lesson_a_corpus_is_blind_beside_what_it_measures`).
  test('desk: the value comes from the SERVER now, and the client adds nothing', () => {
    mockData = { desk: { label: 'New', value: 3, tone: 'neutral' } }
    // Even with the old client-side source sitting in the cache, unfiltered.
    mount({ '/api/desk/articles?limit=12': { articles: [{ slug: 'a' }, { slug: 'b' }] } })
    expect(doorValue('The Desk')).toBe('3')
  })

  test('desk: a server ZERO renders "0" — a real answer, not a blank', () => {
    mockData = { desk: { label: 'New', value: 0, tone: 'neutral' } }
    mount({})
    expect(doorValue('The Desk')).toBe('0')
  })

  test('desk: the server answering null still leaves a plain link', () => {
    mockData = { desk: { label: 'New', value: null, tone: 'neutral' } }
    mount({})
    const link = screen.getByRole('link', { name: 'The Desk' })
    expect(link.textContent).toBe('The Desk')
  })

  test('community: mirrors NavBar\'s own floorUnread formula (forum unread + unseen mentions)', () => {
    mount({
      '/api/community/status': { enabled: true, mentions_unseen: 2 },
      '/api/community/unread': { total: 5 },
    })
    expect(doorValue('Community')).toBe('7')
  })

  test('community: status known but /unread not yet answered — stays a plain link, not "2"', () => {
    mount({
      '/api/community/status': { enabled: true, mentions_unseen: 2 },
    })
    const link = screen.getByRole('link', { name: 'Community' })
    expect(link.textContent).toBe('Community')
  })

  // ─── Server wins ────────────────────────────────────────────────────────
  test('SERVER WINS: a non-null server value is never overridden by a client-computed one', () => {
    mockData = { journal: { label: 'Open', value: 42, tone: 'neutral' } }
    mount({
      '/api/j2/positions': { positions: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      '/api/j2/options?status=open': { strategies: [] },
    })
    // The client data alone would say "3" — the server's 42 must win.
    expect(doorValue('Journal')).toBe('42')
  })

  test('CONTROL: with the server null again, the same client data now DOES show through', () => {
    mockData = { journal: { label: 'Open', value: null, tone: 'neutral' } }
    mount({
      '/api/j2/positions': { positions: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      '/api/j2/options?status=open': { strategies: [] },
    })
    expect(doorValue('Journal')).toBe('3')
  })
})

// ─── Format control — every door in DOORS still renders exactly once ───────
test('CONTROL: all eight doors still render (this file did not accidentally drop one)', () => {
  // Community is gated on its own dark-launch flag — seed it enabled so all
  // eight are in play, matching ZoneDoors.route.test.jsx's own convention.
  mount({ '/api/community/status': { enabled: true } })
  const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
  expect(hrefs.sort()).toEqual(DOORS.map((d) => d.to).sort())
})
