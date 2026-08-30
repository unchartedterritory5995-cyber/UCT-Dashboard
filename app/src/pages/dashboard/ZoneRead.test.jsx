// app/src/pages/dashboard/ZoneRead.test.jsx
//
// Zone A is three things in 120px: which session this is, the one exposure
// number, and the index strip with the quote demoted out of it.
//
// ⛔ THE HOOK IS INJECTED, NOT CLOCKED. `useSessionState.test.js` owns the ET
// arithmetic; faking Date here would re-test that and nothing else
// (`lesson_a_half_faked_clock_manufactures_false_positives`).
//
// ⛔ `useMobileSWR` IS THE MOCK, NOT `swr`. ZoneRead polls through the
// mobile-aware wrapper (the ruling documented in ZoneRead.jsx). A bare `swr`
// mock would still work mechanically — useMobileSWR calls useSWR internally —
// but it would silently stop catching a regression back to a bare `useSWR`
// call, which is exactly what `pollingSites.rail.test.js` exists to refuse.
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  session: 'LIVE', breadth: undefined, opts: null, quote: undefined,
  boundary: { kind: 'close', ms: 0, label: 'Closes in 3h 02m' },
}))

vi.mock('./useSessionState', () => ({
  default: () => h.session,
  resolveSession: () => h.session,
  useNextBoundary: () => h.boundary,
}))

vi.mock('../../hooks/useMobileSWR', () => ({
  default: (key, fetcher, opts) => {
    const k = String(key)
    if (k.includes('/api/breadth')) {
      h.opts = opts
      return { data: h.breadth }
    }
    // useQuoteOfTheDay reads through the same wrapper.
    if (k.includes('/api/quote-of-the-day')) return { data: h.quote }
    return { data: undefined }
  },
}))

import ZoneRead from './ZoneRead'

const mount = () => render(<MemoryRouter><ZoneRead /></MemoryRouter>)

beforeEach(() => {
  h.session = 'LIVE'
  h.breadth = undefined
  h.opts = null
  h.quote = undefined
  h.boundary = { kind: 'close', ms: 0, label: 'Closes in 3h 02m' }
})
afterEach(cleanup)

describe('the session pill', () => {
  const CASES = [
    ['PREMARKET', 'Pre-market'],
    ['LIVE', 'Open'],
    ['CLOSED', 'Closed'],
    ['WEEKEND', 'Weekend'],
  ]
  for (const [state, label] of CASES) {
    test(`${state} reads "${label}"`, () => {
      h.session = state
      mount()
      expect(screen.getByText(label)).toBeInTheDocument()
      // …and no OTHER state's label is on screen, so the four cases cannot all
      // be satisfied by a component that renders every label at once.
      for (const [, other] of CASES) {
        if (other !== label) expect(screen.queryByText(other)).toBeNull()
      }
    })
  }
})

describe('the exposure number', () => {
  test('renders the score from /api/breadth exposure.score', () => {
    h.breadth = { exposure: { score: 87 } }
    mount()
    expect(screen.getByText('87')).toBeInTheDocument()
    expect(screen.getByText(/uct exposure/i)).toBeInTheDocument()
  })

  test('is OMITTED, never zero, when the payload has no score', () => {
    // ⛔ THE FAILURE DIRECTION THAT MATTERS. `score` absent must not render as
    // "0" — 0 is a real reading on the 0-150 scale and means "take no risk".
    // Fabricating it from a missing field would be a confident wrong number on
    // the paid home's most prominent line.
    h.breadth = { exposure: {} }
    mount()
    expect(screen.queryByText(/uct exposure/i)).toBeNull()
    expect(screen.queryByText('0')).toBeNull()
  })

  test('and is omitted on an outage — jsonFetcher throws, data stays undefined', () => {
    h.breadth = undefined
    expect(() => mount()).not.toThrow()
    expect(screen.queryByText(/uct exposure/i)).toBeNull()
    // The pill still renders: a missing number is not a missing zone.
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  test('a score of 0 DOES render — the guard is null-ness, not falsiness', () => {
    // The control for the omission tests above: `!score` would hide a real 0.
    h.breadth = { exposure: { score: 0 } }
    mount()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText(/uct exposure/i)).toBeInTheDocument()
  })
})

test('the poll is market-hours-aware, not a flat 5-minute tick forever', () => {
  mount()
  expect(h.opts?.refreshInterval).toBe(300_000)
  expect(h.opts?.marketHoursOnly,
    'the exposure score is pushed once a day by the morning wire; polling it '
    + 'every 5 minutes all weekend buys no freshness').toBe(true)
})

// ─── S2 · the countdown to the next bell ────────────────────────────────────
describe('the countdown', () => {
  test('renders the label the boundary hook produced', () => {
    mount()
    expect(screen.getByText('Closes in 3h 02m')).toBeInTheDocument()
  })

  test('CONTROL: it is READ from the hook, not composed here', () => {
    // Without this, the assertion above passes against a hardcoded string.
    h.boundary = { kind: 'open', ms: 0, label: 'Opens in 2d 17h' }
    mount()
    expect(screen.getByText('Opens in 2d 17h')).toBeInTheDocument()
    expect(screen.queryByText('Closes in 3h 02m')).toBeNull()
  })

  // 🔴 THE HOLIDAY FIX, AT THE PIXEL. `useNextBoundary` returns a null label
  // whenever the answer is not verifiable — the market calendar still in
  // flight, its endpoint down, or the boundary walked past the horizon the
  // NYSE closure table can speak for. Zone A must draw NOTHING then, not an
  // empty element and certainly not a stale string: on Thanksgiving the old
  // countdown said "Opens in 16h 16m", to the minute, about an open that
  // would not happen. The pill beside it still names the session.
  test('draws no countdown at all when the boundary cannot be verified', () => {
    h.boundary = { kind: null, ms: null, label: null, verified: false }
    mount()
    expect(screen.queryByText(/Opens in/)).toBeNull()
    expect(screen.queryByText(/Closes in/)).toBeNull()
    // The session pill — the load-bearing half — is still on screen…
    const pill = screen.getByText('Open')
    expect(pill).toBeInTheDocument()
    // …and NO EMPTY ELEMENT is left standing beside it. ⛔ Asserted on the
    // DOM, not on a class name: vitest does not process CSS modules here, so
    // `styles.countdown` is undefined and a `querySelector` on it would be a
    // check that can never fail (`lesson_gate_that_cannot_fail`).
    expect(pill.parentElement.children).toHaveLength(1)
  })

  test('CONTROL: that row really does carry two children when the countdown IS verified', () => {
    // Without this, the emptiness assertion above passes for a row that never
    // renders a countdown under any input.
    mount()
    expect(screen.getByText('Open').parentElement.children).toHaveLength(2)
  })
})

// ─── S1 · the one-line exposure note ────────────────────────────────────────
describe('the exposure note', () => {
  test('renders exposure.note beside the number', () => {
    h.breadth = { exposure: { score: 87, note: 'Leadership intact; add on strength.' } }
    mount()
    expect(screen.getByText(/Leadership intact/)).toBeInTheDocument()
  })

  test('is omitted when the payload carries no note', () => {
    h.breadth = { exposure: { score: 87 } }
    mount()
    expect(screen.queryByText(/Leadership intact/)).toBeNull()
  })
})

// ─── A3 · the wire-freshness stamp ──────────────────────────────────────────
//
// 🔴 On 2026-08-14 the 06:35 wire crashed before pushing, the dashboard served
// the prior day's rating all day, and a stale 55 was pixel-identical to a fresh
// 55. Zone A now LEADS with that number and desktop no longer renders
// MarketBreadth at all, so this is the only copy of the stamp on the page.
describe('the wire stamp', () => {
  test('renders the wire date the payload carries', () => {
    h.breadth = { exposure: { score: 87 }, wire_date: '2026-08-30', wire_status: 'fresh' }
    mount()
    expect(screen.getByText(/Wire 2026-08-30/)).toBeInTheDocument()
    expect(screen.queryByText(/not today/)).toBeNull()
  })

  test('SAYS SO when the wire is stale — the number is not today’s reading', () => {
    h.breadth = { exposure: { score: 55 }, wire_date: '2026-08-13', wire_status: 'stale' }
    mount()
    expect(screen.getByText(/not today/)).toBeInTheDocument()
    // The score still renders — a stale reading is shown AND labelled, never
    // hidden. Hiding it would replace one wrong impression with another.
    expect(screen.getByText('55')).toBeInTheDocument()
  })

  test('is omitted entirely when the payload carries no wire_date', () => {
    h.breadth = { exposure: { score: 87 } }
    mount()
    expect(screen.queryByText(/^Wire /)).toBeNull()
  })
})

// ─── S4 · the Quote of the Day, demoted to one line ─────────────────────────
describe('the quote', () => {
  test('renders as a single line by default — demoted, not deleted', () => {
    h.quote = { quote: { t: 'Risk comes from not knowing what you are doing.', a: 'Buffett' } }
    mount()
    expect(screen.getByText(/Risk comes from not knowing/)).toBeInTheDocument()
    expect(screen.getByText(/Buffett/)).toBeInTheDocument()
  })

  test('showQuote={false} drops it — the spec’s one reversible flag', () => {
    h.quote = { quote: { t: 'Risk comes from not knowing what you are doing.', a: 'Buffett' } }
    render(<MemoryRouter><ZoneRead showQuote={false} /></MemoryRouter>)
    expect(screen.queryByText(/Risk comes from not knowing/)).toBeNull()
  })

  test('renders nothing while the quote is still loading — never an empty frame', () => {
    h.quote = undefined
    mount()
    expect(screen.queryByText(/[“]/)).toBeNull()
  })
})

// ─── FIX ROUND 2 ────────────────────────────────────────────────────────────

describe('wire_status: "unknown"', () => {
  // ⛔ `engine.wire_freshness` emits 'unknown' for an absent or unparseable
  // date, and its docstring is explicit that this is "deliberately distinct
  // from 'stale': an absent date means we cannot tell, and claiming staleness
  // we cannot support is the same class of error as claiming freshness we
  // cannot support." Branching only on 'stale' left an unknown-vintage score
  // rendering completely unlabelled — the 2026-08-14 shape in milder form, on
  // the number Zone A now LEADS with.
  test('says freshness is unverified instead of rendering the score bare', () => {
    h.breadth = { exposure: { score: 55 }, wire_date: null, wire_status: 'unknown' }
    mount()
    expect(screen.getByText(/freshness unverified/),
      'an unknown-vintage exposure number rendered with nothing beside it')
      .toBeInTheDocument()
    expect(screen.getByText('55')).toBeInTheDocument()
  })

  test('CONTROL: a FRESH wire says none of that', () => {
    // Without this, "unverified" could be printed unconditionally.
    h.breadth = { exposure: { score: 55 }, wire_date: '2026-08-30', wire_status: 'fresh' }
    mount()
    expect(screen.queryByText(/freshness unverified/)).toBeNull()
    expect(screen.queryByText(/not today/)).toBeNull()
    expect(screen.getByText(/Wire 2026-08-30/)).toBeInTheDocument()
  })

  test('and a payload with no wire fields at all still renders nothing', () => {
    // 'unknown' is a STATEMENT the server made; its absence is not.
    h.breadth = { exposure: { score: 87 } }
    mount()
    expect(screen.queryByText(/freshness unverified/)).toBeNull()
    expect(screen.queryByText(/^Wire /)).toBeNull()
  })
})

test('the stale-wire warning icon is NOT brand gold', () => {
  // UIcon's `gold` prop DEFAULTS TO TRUE and overrides `stroke` with the
  // metallic gradient, so the one signal that says "this number may not be
  // today's" rendered as decoration beside --warning-coloured text.
  h.breadth = { exposure: { score: 55 }, wire_date: '2026-08-13', wire_status: 'stale' }
  mount()
  const warn = document.querySelector('[class*="metaStale"] svg')
  expect(warn, 'the stale-wire warning icon is gone').not.toBeNull()
  expect(warn.getAttribute('stroke'),
    'the warning icon is rendering with UIcon’s gold gradient instead of a '
    + 'semantic stroke — gold={false} is missing').not.toMatch(/url\(#uig/)
})

// ─── FIX ROUND 3 · the two edges of the `unknown` branch ────────────────────

describe('wire_status "unknown" — the edges', () => {
  test('with NO score, the stamp is silent — a caption needs a subject', () => {
    // 'unknown' fires exactly when there is no wire, i.e. the cold-start and
    // wire-outage shape, where there is usually no score either. A
    // warning-coloured "Wire date unknown" floating above nothing is a caption
    // for an absent subject; the missing number already says "nothing here".
    h.breadth = { exposure: {}, wire_date: null, wire_status: 'unknown' }
    mount()
    expect(screen.queryByText(/freshness unverified/),
      'a freshness warning rendered with no exposure number to be about')
      .toBeNull()
    expect(screen.queryByText(/uct exposure/i)).toBeNull()
  })

  test('CONTROL: with a score, the same payload DOES warn', () => {
    // Without this, the assertion above is satisfied by a stamp that never
    // renders at all.
    h.breadth = { exposure: { score: 55 }, wire_date: null, wire_status: 'unknown' }
    mount()
    expect(screen.getByText(/freshness unverified/)).toBeInTheDocument()
  })

  test('an UNPARSEABLE date is never printed as fact', () => {
    // engine.wire_freshness returns 'unknown' for a date that is PRESENT but
    // unparseable, and preferring wire_date rendered "Wire <garbage>" with no
    // explanation. Unknown wins over the date: if the server could not parse
    // it, we do not print it.
    h.breadth = { exposure: { score: 55 }, wire_date: 'not-a-date', wire_status: 'unknown' }
    mount()
    expect(screen.queryByText(/not-a-date/),
      'an unparseable wire date was rendered to the member as if it were one')
      .toBeNull()
    expect(screen.getByText(/freshness unverified/)).toBeInTheDocument()
  })

  test('CONTROL: a parseable date on a fresh wire IS printed', () => {
    h.breadth = { exposure: { score: 55 }, wire_date: '2026-08-30', wire_status: 'fresh' }
    mount()
    expect(screen.getByText(/Wire 2026-08-30/)).toBeInTheDocument()
  })

  test('the note still renders on its own when there is no wire stamp at all', () => {
    // The meta line must not vanish just because the stamp is silent.
    h.breadth = { exposure: { score: 55, note: 'Leadership intact.' }, wire_status: 'unknown', wire_date: null }
    mount()
    expect(screen.getByText(/Leadership intact/)).toBeInTheDocument()
  })
})
