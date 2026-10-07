import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// TERM-088 -- the decision record's member surface.
//
// What this file has to be able to say RED for:
//   * a recorded rejection renders its STAGE (asserted on text);
//   * a ticker with no row renders "Not considered" -- never an empty list
//     that reads as "never rejected", and never a fabricated row;
//   * a record that could NOT be read renders as unavailable, and NEVER as
//     "not considered" (a layer that could not be read is not a layer that is empty);
//   * the youth caveat and the coverage are DERIVED from the payload -- a
//     different payload produces different numbers on screen;
//   * every figure is wrapped in the S8 <Provenance> primitive.

afterEach(() => { cleanup(); vi.resetModules(); vi.doUnmock('../hooks/useDecisionRecord') })

const COVERAGE = {
  issues_held: 3, first_issue: '2026-09-21', last_issue: '2026-09-25',
  span_days: 5, weekdays_in_span: 5, span_months: 0,
}
const SOURCE = { store: 'uct_intelligence.db', tables: ['wire_universe', 'wire_issues'], pack_installed_at: '2026-09-27T02:00:00+00:00' }

const considered = {
  ticker: 'AMD', status: 'considered', reason: null,
  rows: [
    { issue_id: '2026-09-25', sent_at: '2026-09-25 11:34:00', outcome: 'passed', dropped_at_stage: null, stage_label: null, drop_reason: null, is_exploration: true },
    { issue_id: '2026-09-23', sent_at: '2026-09-23 11:36:00', outcome: 'dropped', dropped_at_stage: 2, stage_label: 'gate', drop_reason: 'failed gate: extended from 10ema', is_exploration: false },
    { issue_id: '2026-09-21', sent_at: '2026-09-21 11:35:00', outcome: 'dropped', dropped_at_stage: 7, stage_label: null, drop_reason: null, is_exploration: false },
  ],
  counts: { rows: 3, issues_considered: 3, issues_passed: 1, issues_dropped: 2, by_stage: { 2: 1, 7: 1 } },
  coverage: COVERAGE, paging: { limit: 50, offset: 0, total_rows: 3 },
  entity: { enabled: false, distinct_entities: null }, source: SOURCE,
}

async function renderWith(result, isLoading = false) {
  vi.resetModules()
  vi.doMock('../hooks/useDecisionRecord', () => ({ default: () => ({ result, isLoading }) }))
  const { default: Tab } = await import('./DecisionRecordTab')
  return render(<Tab sym="AMD" />)
}

describe('DecisionRecordTab', () => {
  it('a recorded rejection renders its STAGE, its reason and its issue -- beside the pass', async () => {
    await renderWith({ ok: true, httpStatus: 200, body: considered })
    expect(screen.getByText('Dropped at the swing-trade gate (stage 2)')).toBeInTheDocument()
    expect(screen.getByText('failed gate: extended from 10ema')).toBeInTheDocument()
    expect(screen.getByText('Passed every stage')).toBeInTheDocument()
    expect(screen.getAllByTestId('decision-record-row')).toHaveLength(3)
    expect(screen.queryByTestId('decision-record-not-considered')).not.toBeInTheDocument()
  })

  it('an unknown stage renders as its NUMBER, never a guessed label', async () => {
    await renderWith({ ok: true, httpStatus: 200, body: considered })
    expect(screen.getByText('Dropped at stage 7')).toBeInTheDocument()
  })

  it('a ticker with NO row says "Not considered" -- and renders no row at all', async () => {
    await renderWith({ ok: true, httpStatus: 200, body: { ...considered, ticker: 'ZZZZ', status: 'not_considered', rows: [], counts: { rows: 0, issues_considered: 0, issues_passed: 0, issues_dropped: 0, by_stage: {} } } })
    const node = screen.getByTestId('decision-record-not-considered')
    expect(node.textContent).toMatch(/Not considered/)
    expect(node.textContent).toMatch(/3 Morning Wire issues/)
    expect(screen.queryAllByTestId('decision-record-row')).toHaveLength(0)
    expect(screen.queryByText(/Dropped at stage/)).not.toBeInTheDocument()
    expect(screen.queryByText('Passed every stage')).not.toBeInTheDocument()
  })

  it('a readable but EMPTY record says so -- no row, and not "not considered"', async () => {
    await renderWith({ ok: true, httpStatus: 200, body: { ...considered, status: 'empty_record', rows: [], counts: null, coverage: { ...COVERAGE, issues_held: 0, first_issue: null, last_issue: null, span_days: null, weekdays_in_span: null, span_months: null } } })
    expect(screen.getByTestId('decision-record-empty')).toBeInTheDocument()
    expect(screen.queryAllByTestId('decision-record-row')).toHaveLength(0)
    expect(screen.queryByTestId('decision-record-not-considered')).not.toBeInTheDocument()
  })

  it.each([
    ['a failed request', { ok: false, httpStatus: 500, body: null }],
    // tq-panels: 402 is the paid gate (paywall402.test.jsx); a refusal here is a 403.
    ['a refused request', { ok: false, httpStatus: 403, body: null }],
    ['a store that could not be read', { ok: true, httpStatus: 200, body: { ...considered, status: 'unavailable', reason: 'source_file_missing', rows: [], counts: null, coverage: null } }],
  ])('%s is UNAVAILABLE, never "not considered"', async (_label, result) => {
    await renderWith(result)
    expect(screen.getByTestId('decision-record-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('decision-record-not-considered')).not.toBeInTheDocument()
    expect(screen.queryByText(/Not considered/)).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('decision-record-row')).toHaveLength(0)
  })

  it('the youth caveat and the coverage are DERIVED from the payload', async () => {
    await renderWith({ ok: true, httpStatus: 200, body: considered })
    const cov = screen.getByTestId('decision-record-coverage').textContent
    expect(cov).toMatch(/3 issues spanning 2026-09-21 → 2026-09-25 is a young record/)
    expect(cov).toMatch(/roughly 5 weekdays, so the archive is not every session/)
    cleanup()
    await renderWith({ ok: true, httpStatus: 200, body: { ...considered, coverage: { issues_held: 60, first_issue: '2026-04-29', last_issue: '2026-09-26', span_days: 151, weekdays_in_span: 108, span_months: 5 } } })
    const cov2 = screen.getByTestId('decision-record-coverage').textContent
    expect(cov2).toMatch(/60 issues spanning 2026-04-29 → 2026-09-26 is a young record/)
    expect(cov2).toMatch(/roughly 108 weekdays/)
    expect(cov2).toMatch(/The depth is 5 months, not 5 years\./)
  })

  it('states that this is the firm\'s own record, not a member\'s, and computes no rate', async () => {
    await renderWith({ ok: true, httpStatus: 200, body: considered })
    const safety = screen.getByTestId('decision-record-safety').textContent
    // ’ is what &rsquo; renders; match either apostrophe.
    expect(safety).toMatch(/UCT['’]s own decision record/)
    expect(safety).toMatch(/not a member['’]s/)
    expect(document.body.textContent).not.toMatch(/%/)
  })

  it('composes a REAL S8 Provenance for every figure and every row -- never a degraded one', async () => {
    await renderWith({ ok: true, httpStatus: 200, body: considered })
    // 3 rows + 3 counts (considered / passed / dropped) + 1 coverage figure
    expect(screen.getAllByTestId('provenance-present')).toHaveLength(7)
    expect(screen.queryByTestId('provenance-degraded')).not.toBeInTheDocument()
  })

  it('a loading state is distinct from every answer', async () => {
    await renderWith(null, true)
    expect(screen.getByTestId('decision-record-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('decision-record-not-considered')).not.toBeInTheDocument()
    expect(screen.queryByTestId('decision-record-unavailable')).not.toBeInTheDocument()
  })

  it('says so when this page of rows is not the whole record', async () => {
    await renderWith({ ok: true, httpStatus: 200, body: { ...considered, paging: { limit: 3, offset: 0, total_rows: 40 } } })
    expect(screen.getByTestId('decision-record-paging').textContent).toMatch(/Showing 3 of 40 recorded rows/)
  })

  it('flags a ticker that resolves to more than one company across the record', async () => {
    await renderWith({ ok: true, httpStatus: 200, body: { ...considered, entity: { enabled: true, distinct_entities: 2 } } })
    expect(screen.getByTestId('decision-record-entity-note').textContent).toMatch(/2 different companies/)
  })
})
