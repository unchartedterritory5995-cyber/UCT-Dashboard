// app/src/pages/calendar/refusalLastHops.test.jsx
//
// The last two hops the reason had to survive.
//
// `452290bd` put `{kind, reason}` on the wire and onto three calendar surfaces.
// Two places still dropped it, and one of them — `/api/research/expected-move`
// — is where refusals actually reach members TODAY: the calendar skips the live
// chain read for a past report, but the research modal asks for every symbol it
// opens, so `no_atm_strike` / `implausible_move` / `chain_timeout` land there
// first. The payload was correct, tested, and read by no code at all.
//
// ⛔ THESE ARE NOT "does the component render the prop" TESTS. That exact shape
// was green on all thirty cases while `mergeEnrichment`'s allow-list was cut.
// The chain cases below start from a RAW ENRICHMENT PAYLOAD and walk it through
// every real hop, so cutting any one of them fails here — and the structural
// rail that finds the hops without being told their names lives in
// `tests/test_refusal_reaches_every_surface.py`.
//
// The reason vocabulary is DERIVED from the backend module that owns it, and
// the surfaces are additionally asserted reason-AGNOSTIC, which is stronger
// than enumerating: a ninth reason cannot render blank because no list is
// consulted at all.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

// SetupSection owns two fetches of its own. Neither is under test here, and
// both are pinned to a settled value so the priced/refused renders differ ONLY
// by the outcome under test.
const mockUseFundamentals = vi.fn(() => ({ data: null }))
vi.mock('../../hooks/useFundamentals', () => ({
  default: (...args) => mockUseFundamentals(...args),
}))
vi.mock('swr', async (orig) => {
  const actual = await orig()
  return { ...actual, default: () => ({ data: null }) }
})

import SetupSection from '../../components/research/sections/SetupSection'
import { MOVE_UNAVAILABLE } from '../../constants/expectedMoveOutcome'
import { mergeEnrichment } from './useCalendarData'
import {
  toModalRow, enrichmentStillMissing, enrichmentGained,
} from './earningsModalRow'

// ── The vocabulary, read off the backend that owns it ────────────────────────
const IMPLIED_MOVE_PY = path.resolve(__dirname, '../../../../api/services/implied_move.py')

function backendReasons() {
  const src = fs.readFileSync(IMPLIED_MOVE_PY, 'utf8')
  const out = []
  const re = /^(?:REFUSED|UNAVAILABLE)_[A-Z0-9_]+\s*=\s*"([a-z0-9_]+)"\s*$/gm
  let m
  while ((m = re.exec(src)) !== null) out.push(m[1])
  return out
}

const REASONS = backendReasons()
const humanised = (reason) => reason.replace(/_/g, ' ')

it('reads the reason vocabulary off the backend, so these cases are not vacuous', () => {
  expect(REASONS.length).toBeGreaterThanOrEqual(6)
  expect(new Set(REASONS).size).toBe(REASONS.length)
})

const outcome = (reason) => ({ kind: reason ? 'refused' : 'ok', reason: reason ?? null })

// ── HOP 1+2 — the raw enrichment payload all the way to the modal row ────────
//
// Two separate allow-lists sit between the endpoint and the modal
// (`mergeEnrichment`, then `toModalRow`). Driving the pair together is the
// point: a cut in EITHER one fails these, where a test that hand-built the
// intermediate shape would only ever exercise the half it retyped.

const ENRICHED = (over = {}) => ({
  expected_move: null,
  expected_move_outcome: { kind: 'refused', reason: 'no_atm_strike' },
  beat_history: [{ period: '2026-06-30', beat: true, surprise: 3.4 }],
  hist_stats: { avg_abs_move: 6.4, last_n: [8.2, -4.1] },
  history_unresolved: false,
  ...over,
})

const throughBothHops = (enrichedRow, entry = { sym: 'TSTX' }) =>
  toModalRow(mergeEnrichment(entry, { TSTX: enrichedRow }))

describe('the reason survives every hop between the endpoint and the modal', () => {
  it.each(REASONS)('carries %s from the enrichment payload onto the modal row', (reason) => {
    const row = throughBothHops(ENRICHED({ expected_move_outcome: outcome(reason) }))
    expect(row.expected_move_outcome).toEqual(outcome(reason))
    expect(row.expected_move).toBeNull()
  })

  it('carries the priced verdict too, so `ok` is not a special-cased silence', () => {
    const row = throughBothHops(ENRICHED({
      expected_move: { pct: 6.8 }, expected_move_outcome: { kind: 'ok', reason: null },
    }))
    expect(row.expected_move_outcome).toEqual({ kind: 'ok', reason: null })
    expect(row.expected_move).toEqual({ pct: 6.8 })
  })

  it('leaves a symbol the overlay never covered UNANSWERED rather than refused', () => {
    // `mergeEnrichment` returns an unmarked row for a symbol absent from the
    // payload. A default of "refused" there would label every far-future week.
    const row = toModalRow(mergeEnrichment({ sym: 'TSTX' }, { OTHER: ENRICHED() }))
    expect(row.expected_move_outcome).toBeNull()
    expect(row.history_unresolved).toBe(true)
  })

  it('adds the outcome and changes nothing else about the modal row', () => {
    // An EXACT-SHAPE pin, not an additivity trick: comparing the new output
    // against the new output minus one key would pass while every other field
    // silently changed. This fails on an added, removed OR altered field.
    const row = toModalRow({
      sym: 'TSTX', eps_act: 8.17, eps_est: 6.25, rev_act: 1.2e9, rev_est: 1.1e9,
      expected_move_outcome: outcome('no_atm_strike'),
    })
    expect(row).toEqual({
      sym: 'TSTX',
      verdict: 'beat',
      reported_eps: 8.17,
      eps_estimate: 6.25,
      surprise_pct: '+30.7%',
      rev_actual: 1.2e9,
      rev_estimate: 1.1e9,
      rev_surprise_pct: '+9.1%',
      beat_history: null,
      hist_stats: null,
      expected_move: null,
      expected_move_outcome: outcome('no_atm_strike'),
      history_unresolved: false,
    })
  })
})

// ── The modal's re-open guard reads the outcome ──────────────────────────────

describe('a stated reason is an ANSWER, not a still-loading move', () => {
  const settled = { beat_history: [], hist_stats: {}, expected_move: null }

  it('stops chasing a move the server already explained', () => {
    expect(enrichmentStillMissing({
      ...settled, expected_move_outcome: outcome('no_atm_strike'),
    })).toBe(false)
  })

  it('keeps chasing a move nothing has answered at all', () => {
    expect(enrichmentStillMissing({ ...settled, expected_move_outcome: null })).toBe(true)
  })

  it('counts a newly arrived reason as a gain worth re-committing', () => {
    const row = { ...settled, expected_move_outcome: null }
    expect(enrichmentGained(row, { expected_move_outcome: outcome('chain_timeout') })).toBe(true)
  })

  it('does not re-commit when the fresh entry is just as unanswered', () => {
    const row = { ...settled, expected_move_outcome: null }
    expect(enrichmentGained(row, { expected_move: null, expected_move_outcome: null })).toBe(false)
  })
})

// ── The research canvas — the surface where refusals are live today ──────────

const LIVE = { pct: 6.8, dollar: 12.5, spot: 184.0, expiry: '2026-08-07', horizon: 'through 2026-08-07' }
const payload = (over = {}) => ({ live: null, history: [], history_since: null, grade: null, ...over })

function renderSetup(expectedMove) {
  return render(
    <SetupSection sym="TSTX" row={{ sym: 'TSTX' }} reportDate="2026-08-07"
                  expectedMove={expectedMove} />,
  )
}

describe('the Setup canvas says why it has no expected move', () => {
  it.each(REASONS)('names %s on the canvas', (reason) => {
    renderSetup(payload({ live_outcome: outcome(reason) }))
    const na = screen.getByTestId('setup-move-unavailable')
    expect(na).toHaveTextContent(MOVE_UNAVAILABLE)
    expect(na).toHaveTextContent(humanised(reason))
  })

  it('renders a reason no release has ever shipped, legibly', () => {
    // Reason-AGNOSTIC: the canvas consults no list, so a ninth reason invented
    // on the server reaches members the day it exists.
    const novel = 'a_reason_no_release_has_ever_shipped'
    expect(REASONS).not.toContain(novel)
    renderSetup(payload({ live_outcome: { kind: 'unavailable', reason: novel } }))
    expect(screen.getByTestId('setup-move-unavailable'))
      .toHaveTextContent('a reason no release has ever shipped')
  })

  it('says nothing while the payload is still in flight', () => {
    // `useExpectedMove` returns null until SWR resolves. The outcome's PRESENCE
    // is the arrival signal — this is the froze-rows regression, on the canvas.
    renderSetup(null)
    expect(screen.queryByTestId('setup-move-unavailable')).toBeNull()
    expect(screen.queryByText(new RegExp(MOVE_UNAVAILABLE))).toBeNull()
  })

  it('says nothing when the read was never attempted', () => {
    // A bare null outcome means "nobody asked" — labelling it would state a
    // reason the server never gave.
    renderSetup(payload({ live_outcome: null }))
    expect(screen.queryByTestId('setup-move-unavailable')).toBeNull()
  })

  it('leaves a priced canvas byte-identical to before the outcome existed', () => {
    const withoutField = renderSetup(payload({ live: LIVE }))
    const before = withoutField.container.innerHTML
    withoutField.unmount()
    const withOk = renderSetup(payload({ live: LIVE, live_outcome: { kind: 'ok', reason: null } }))
    expect(withOk.container.innerHTML).toBe(before)
    expect(screen.queryByTestId('setup-move-unavailable')).toBeNull()
    expect(screen.getByTestId('setup-breakeven')).toBeInTheDocument()
  })

  it('lets the number win when there is one, even if an outcome tags along', () => {
    renderSetup(payload({ live: LIVE, live_outcome: outcome('no_atm_strike') }))
    expect(screen.queryByTestId('setup-move-unavailable')).toBeNull()
    expect(screen.getByTestId('setup-breakeven')).toBeInTheDocument()
  })
})
