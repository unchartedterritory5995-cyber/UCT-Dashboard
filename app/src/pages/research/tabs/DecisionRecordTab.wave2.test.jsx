// Audit wave 2 (lane A): DR rows carry their own date, the copy drops engine jargon, and
// inside a terminal panel the loading state is the terminal's one skeleton.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TerminalPanelContext } from '../../../components/terminal'

let hook = { result: null, isLoading: false, mutate: () => {} }
vi.mock('../hooks/useDecisionRecord', () => ({ default: () => hook }))
import DecisionRecordTab from './DecisionRecordTab'

afterEach(cleanup)

const body = (rows) => ({
  ok: true, httpStatus: 200, body: {
    ticker: 'NVDA', status: 'considered', rows,
    counts: { issues_considered: rows.length, issues_passed: 0, issues_dropped: rows.length },
    coverage: null, source: { pack_installed_at: '2026-09-27T02:00:00+00:00' },
  },
})

describe('DecisionRecordTab wave 2', () => {
  it('a row shows its issue DATE in the row, not "Issue 123"', () => {
    hook = { result: body([
      { issue_id: '2026-09-25', sent_at: '2026-09-25 11:34:00', outcome: 'dropped', dropped_at_stage: 2, stage_label: 'gate' },
      { issue_id: 123, sent_at: '2026-08-04 11:30:00', outcome: 'passed', dropped_at_stage: null },
      { issue_id: 124, sent_at: null, outcome: 'passed', dropped_at_stage: null },
    ]), isLoading: false, mutate: () => {} }
    render(<DecisionRecordTab sym="NVDA" />)
    const labels = screen.getAllByTestId('decision-record-issue').map((n) => n.textContent)
    expect(labels[0]).toBe('Sep 25, 2026 issue')
    expect(labels[1]).toBe('Issue 123 · Aug 4, 2026')
    expect(labels[2]).toBe('Issue 124 (date not recorded)')
  })

  it('no engine jargon: "died", "Brain Pack", "exploration pick"', () => {
    hook = { result: body([{ issue_id: '2026-09-25', outcome: 'passed', dropped_at_stage: null, is_exploration: true }]), isLoading: false, mutate: () => {} }
    render(<DecisionRecordTab sym="NVDA" />)
    expect(document.body.textContent).not.toMatch(/died|Brain Pack|exploration pick/)
    expect(document.body.textContent).toMatch(/where NVDA was dropped/)
  })

  it('inside a terminal panel, loading is the terminal skeleton', () => {
    hook = { result: null, isLoading: true, mutate: () => {} }
    render(
      <TerminalPanelContext.Provider value={{ code: 'DR', density: 'comfortable', inset: true }}>
        <DecisionRecordTab sym="NVDA" />
      </TerminalPanelContext.Provider>,
    )
    expect(screen.getByTestId('decision-record-loading')).toBeInTheDocument()
    expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument()
  })
})
