// app/src/pages/calendar/impliedMoveReason.test.jsx
//
// A refused expected move used to reach the member as a bare `null` that stood
// for six different facts. The server now sends `{kind, reason}` beside it.
// These are the surface rails on saying it.
//
// Three properties, on every surface that renders the move:
//   REFUSED  → an explicit unavailable treatment, never a bare dash
//   PRICED   → byte-identical to before
//   PENDING  → still polling, and NEVER labelled  ← the regression that once
//              froze calendar rows permanently
//
// The reason vocabulary is DERIVED from the backend module that owns it, never
// retyped here — and the surfaces are asserted to be reason-AGNOSTIC, which is
// the stronger statement: a seventh reason cannot come out blank because no
// list is consulted at all.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ menu: null, openMenu: vi.fn(), closeMenu: vi.fn(), longPressProps: () => ({}) }),
}))

import CalendarDayTable from './CalendarDayTable'
import EarningsCard from './EarningsCard'
import EarningsTile from './EarningsTile'
import { MOVE_UNAVAILABLE, moveIsUnavailable } from './cardBits'
import { mergeEnrichment } from './useCalendarData'

// ── The vocabulary, read off the backend that owns it ────────────────────────
// `api/services/implied_move.py` declares every reason as a module constant.
// Reading them here means a seventh one is exercised by these tests the moment
// it is added, without anyone remembering to update a list on this side.
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

// The label a surface must show when it has no number and the server said why.
const NOT_LABELLED = new RegExp(MOVE_UNAVAILABLE)

describe('the reason vocabulary is derived, not typed', () => {
  it('reads every reason constant out of the backend module', () => {
    // Abort-on-zero: a broken extractor would make every parametrized case
    // below pass vacuously by iterating an empty list.
    expect(REASONS.length).toBeGreaterThanOrEqual(6)
    expect(new Set(REASONS).size).toBe(REASONS.length)
  })
})

// ── Surface 1: the day table ─────────────────────────────────────────────────

const dayRow = (over = {}) => ({
  sym: 'TSTX', name: 'Test Corp', _timing: 'bmo', mine: false,
  mc_b: 12, eps_est: 1.0, rev_est: 900, ...over,
})

// The Beats column renders its own '—'/'…' on the same row, so every day-table
// assertion is scoped to the Move CELL. Scoping by the module class the cell
// actually carries (hashed at build time) rather than by column index keeps
// this honest if the grid is reordered.
const renderTable = (entry, props = {}) => {
  const utils = render(
    <CalendarDayTable entries={[entry]} enrichReady onSelect={vi.fn()} {...props} />)
  const cell = utils.container.querySelector('[class*="dtMoveCell"]')
  expect(cell).toBeTruthy()
  return { ...utils, cell }
}

describe('CalendarDayTable — the Move column', () => {
  it('REFUSED: renders an explicit unavailable treatment, never a bare dash', () => {
    const { cell } = renderTable(dayRow({
      expected_move: null,
      expected_move_outcome: { kind: 'refused', reason: 'no_atm_strike' },
    }))
    const mark = within(cell).getByLabelText(NOT_LABELLED)
    expect(mark.textContent).toBe('n/a')
    // The specific cause travels with it, for support.
    expect(mark.getAttribute('title')).toContain('no atm strike')
    expect(cell.textContent).not.toContain('—')
  })

  it('PRICED: the number is byte-identical to before', () => {
    const { cell } = renderTable(dayRow({ expected_move: { pct: 3.1 } }))
    expect(cell.textContent).toBe('±3.1%')
    expect(within(cell).queryByLabelText(NOT_LABELLED)).toBeNull()
  })

  it('PENDING: enrichment still in flight keeps polling and is NEVER labelled', () => {
    // The regression this guards: an "unavailable" label rendered on a bare
    // null fired on every in-flight row, and the earlier guard that stopped
    // re-checking too early froze those rows permanently.
    const { cell } = renderTable(dayRow(), { enrichReady: false })
    expect(cell.textContent).toBe('…')
    expect(within(cell).queryByLabelText(NOT_LABELLED)).toBeNull()
  })

  it('PENDING: an outcome cannot label a row whose batch has not landed', () => {
    // Belt and braces on the ordering: even if an outcome somehow reached a
    // row before `enrichReady` flipped, the pending mark still wins.
    const { cell } = renderTable(dayRow({
      expected_move_outcome: { kind: 'refused', reason: 'no_atm_strike' },
    }), { enrichReady: false })
    expect(cell.textContent).toBe('…')
    expect(within(cell).queryByLabelText(NOT_LABELLED)).toBeNull()
  })

  it('NOTHING ATTEMPTED: a past report with no outcome keeps its em dash', () => {
    const { cell } = renderTable(dayRow({ expected_move: null, expected_move_outcome: null }))
    expect(cell.textContent).toBe('—')
    expect(within(cell).queryByLabelText(NOT_LABELLED)).toBeNull()
  })
})

// ── Surface 2: the earnings card ─────────────────────────────────────────────

const card = (over = {}) => (
  <EarningsCard entry={{ sym: 'TSTX', date: '2026-08-12', ...over }} timing="bmo" />
)

describe('EarningsCard — the Expected move line', () => {
  it('REFUSED: says the words, in plain English', () => {
    render(card({ expected_move_outcome: { kind: 'refused', reason: 'implausible_move' } }))
    expect(screen.getByText(MOVE_UNAVAILABLE)).toBeTruthy()
  })

  it('PRICED: the pair renders exactly as before', () => {
    render(card({ expected_move: { pct: 6.2 }, hist_stats: { avg_abs_move: 4.0 } }))
    expect(screen.getByText(/±6\.2%/)).toBeTruthy()
    expect(screen.queryByText(MOVE_UNAVAILABLE)).toBeNull()
  })

  it('PENDING: no outcome yet means no line at all, never a refusal', () => {
    // The card has no `enrichReady` prop and does not need one: the outcome
    // only EXISTS once the enrichment payload landed, so its absence IS the
    // pending signal. This test is what makes that claim load-bearing.
    render(card({}))
    expect(screen.queryByText(MOVE_UNAVAILABLE)).toBeNull()
    expect(screen.getByText('TSTX')).toBeTruthy()
  })
})

// ── Surface 3: the week/board tile ───────────────────────────────────────────

describe('EarningsTile — the one-signal slot', () => {
  it('REFUSED: the tile says so instead of going silently one line short', () => {
    render(<EarningsTile e={{ sym: 'TSTX', expected_move_outcome: { kind: 'unavailable', reason: 'chain_unavailable' } }} />)
    const mark = screen.getByLabelText(NOT_LABELLED)
    expect(mark.textContent).toBe('n/a')
  })

  it('PRICED: unchanged', () => {
    render(<EarningsTile e={{ sym: 'TSTX', expected_move: { pct: 8.4 } }} />)
    expect(screen.getByText('±8.4%')).toBeTruthy()
    expect(screen.queryByLabelText(NOT_LABELLED)).toBeNull()
  })

  it('PENDING: no outcome renders nothing extra', () => {
    render(<EarningsTile e={{ sym: 'TSTX' }} />)
    expect(screen.queryByLabelText(NOT_LABELLED)).toBeNull()
  })
})

// ── Reason-agnostic: the seventh reason, and the timeout ─────────────────────

describe('the surfaces are reason-agnostic', () => {
  it.each(REASONS)('renders a non-blank treatment for %s on both surfaces', (reason) => {
    const outcome = { kind: 'unavailable', reason }
    const { cell, unmount } = renderTable(dayRow({ expected_move_outcome: outcome }))
    const mark = within(cell).getByLabelText(NOT_LABELLED)
    expect(mark.textContent.trim()).not.toBe('')
    expect(mark.getAttribute('title')).toContain(reason.replace(/_/g, ' '))
    unmount()

    render(card({ expected_move_outcome: outcome }))
    expect(screen.getByText(MOVE_UNAVAILABLE)).toBeTruthy()
  })

  it('a reason no release has ever shipped still renders correctly on day one', () => {
    const novel = 'a_reason_no_release_has_ever_shipped'
    expect(REASONS).not.toContain(novel)
    const { cell } = renderTable(
      dayRow({ expected_move_outcome: { kind: 'unavailable', reason: novel } }))
    const mark = within(cell).getByLabelText(NOT_LABELLED)
    expect(mark.textContent).toBe('n/a')
    expect(mark.getAttribute('title')).toContain('a reason no release has ever shipped')
  })

  it('a timeout reads as a timeout, never as a refusal', () => {
    // The backend already refuses to call a timeout a refusal; this is the
    // display half of that promise — the cause the member and support see is
    // the one the server actually reported.
    const { cell } = renderTable(dayRow({
      expected_move_outcome: { kind: 'unavailable', reason: 'chain_timeout' },
    }))
    const title = within(cell).getByLabelText(NOT_LABELLED).getAttribute('title')
    expect(title).toContain('chain timeout')
    expect(title).not.toContain('atm')
    expect(title).not.toContain('refus')
  })

  it('an outcome missing its reason still renders the phrase, never a blank', () => {
    const { cell } = renderTable(dayRow({ expected_move_outcome: { kind: 'unavailable' } }))
    const mark = within(cell).getByLabelText(NOT_LABELLED)
    expect(mark.getAttribute('title')).toBe(MOVE_UNAVAILABLE)
  })

  it('kind ok is never treated as an absence', () => {
    const { cell } = renderTable(dayRow({
      expected_move: { pct: 2.5 },
      expected_move_outcome: { kind: 'ok', reason: null },
    }))
    expect(cell.textContent).toBe('±2.5%')
    expect(within(cell).queryByLabelText(NOT_LABELLED)).toBeNull()
  })
})

// ── The `ok` sentinel is what keeps the predicate honest ─────────────────────
// Without the `kind !== 'ok'` half, ANY outcome would read as an absence — so a
// symbol the server priced but whose pct never reached the row would be told
// "we could not price this". That is the false-statement class again, from the
// other direction, and the surface cases above cannot see it because the priced
// branch short-circuits first.

describe('moveIsUnavailable — the single decision point', () => {
  it('is false for a priced outcome and true for every other', () => {
    expect(moveIsUnavailable({ kind: 'ok', reason: null })).toBe(false)
    expect(moveIsUnavailable({ kind: 'refused', reason: 'no_atm_strike' })).toBe(true)
    expect(moveIsUnavailable({ kind: 'unavailable', reason: 'chain_timeout' })).toBe(true)
  })

  it('is false when nothing was attempted', () => {
    expect(moveIsUnavailable(null)).toBe(false)
    expect(moveIsUnavailable(undefined)).toBe(false)
  })

  it('a priced outcome with no number on the row still shows no refusal', () => {
    const { cell } = renderTable(dayRow({
      expected_move: null,
      expected_move_outcome: { kind: 'ok', reason: null },
    }))
    expect(cell.textContent).toBe('—')
    expect(within(cell).queryByLabelText(NOT_LABELLED)).toBeNull()

    render(card({ expected_move: null, expected_move_outcome: { kind: 'ok', reason: null } }))
    expect(screen.queryByText(MOVE_UNAVAILABLE)).toBeNull()
  })
})

// ── The WIRE, not the components ─────────────────────────────────────────────
// `mergeEnrichment` is an ALLOW-LIST: a field the server sends and it does not
// name is silently dropped, and every component on either side stays green
// while the member sees nothing. This is the seam that has to go red when the
// wire is cut. (Its backend twin — "the key the router emits is the key this
// allow-list names" — lives in tests/test_implied_reason_on_the_wire.py, which
// derives the key from a real router response instead of retyping it.)

describe('mergeEnrichment — the outcome survives the allow-list', () => {
  const entry = { sym: 'TSTX' }
  const payload = (over) => ({
    TSTX: {
      expected_move: null,
      expected_move_outcome: { kind: 'refused', reason: 'no_atm_strike' },
      beat_history: null, hist_stats: null, history_unresolved: false, ...over,
    },
  })

  it('carries the outcome through to the entry the surfaces render', () => {
    const merged = mergeEnrichment(entry, payload())
    expect(merged.expected_move_outcome).toEqual({ kind: 'refused', reason: 'no_atm_strike' })
    // …and the surface then labels it, so the whole chain is proven, not just
    // this one hop.
    const { cell } = renderTable({ ...dayRow(), ...merged })
    expect(within(cell).getByLabelText(NOT_LABELLED)).toBeTruthy()
  })

  it('a payload with no outcome merges to null, never to a refusal', () => {
    const merged = mergeEnrichment(entry, payload({ expected_move_outcome: null }))
    expect(merged.expected_move_outcome).toBeNull()
    const { cell } = renderTable({ ...dayRow(), ...merged })
    expect(cell.textContent).toBe('—')
  })

  it('a symbol absent from the payload is left unlabelled', () => {
    const merged = mergeEnrichment(entry, { OTHER: {} })
    expect(merged.expected_move_outcome ?? null).toBeNull()
  })
})
