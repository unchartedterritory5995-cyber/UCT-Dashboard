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

const h = vi.hoisted(() => ({ session: 'LIVE', breadth: undefined, opts: null }))

vi.mock('./useSessionState', () => ({
  default: () => h.session,
  resolveSession: () => h.session,
}))

vi.mock('../../hooks/useMobileSWR', () => ({
  default: (key, fetcher, opts) => {
    if (String(key).includes('/api/breadth')) {
      h.opts = opts
      return { data: h.breadth }
    }
    return { data: undefined }
  },
}))

import ZoneRead from './ZoneRead'

const mount = () => render(<MemoryRouter><ZoneRead /></MemoryRouter>)

beforeEach(() => { h.session = 'LIVE'; h.breadth = undefined; h.opts = null })
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
