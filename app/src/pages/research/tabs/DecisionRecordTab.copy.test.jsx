// Live sweep 2026-10-05: DR showed "market-cap-0.00B-below-1.0B-floor (tier passed but mcap
// floor failed)" and "Dropped at stage 2 · gate". Every engine format reads as plain English.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { dropReasonText, stageText } from './decisionRecordCopy'

let result
vi.mock('../hooks/useDecisionRecord', () => ({ default: () => ({ result, isLoading: false }) }))
import DecisionRecordTab from './DecisionRecordTab'

describe('dropReasonText covers every format the engine emits', () => {
  it.each([
    ['market-cap-0.00B-below-1.0B-floor (tier passed but mcap floor failed)',
      'Its market cap could not be read that morning, so it did not clear the $1.00B minimum.'],
    // terminal compact ladder (round 2): B two decimals, M one, on every panel
    ['market-cap-0.45B-below-1.0B-floor (tier passed but mcap floor failed)', 'Its market cap of $450.0M is below the $1.00B minimum.'],
    ['tier-D-never-trade-list (and 4/5 thresholds passed)', 'It is on the never-trade list. It passed 4 of 5 setup thresholds.'],
    ['tier-B-not-leading-and-gap-1.2<3.0 (and 2/5 thresholds passed)',
      'A tier-B name whose sector was not leading, and its 1.2% gap was under the 3.0% needed. It passed 2 of 5 setup thresholds.'],
    ['C-tier-no-gap-and-no-sector-lead-override (and 3/5 thresholds passed)',
      'A tier-C name with no gap and no leading sector to lift it. It passed 3 of 5 setup thresholds.'],
    ['tier-E-unrecognized-drop (and 1/5 thresholds passed)', 'It did not clear the tier check. It passed 1 of 5 setup thresholds.'],
    ['only 2/5 thresholds passed (need 3)', 'It passed only 2 of 5 setup thresholds; 3 were needed.'],
    ['exploration band: 3/5 (marginal); tier-A-always-playable', 'Picked as an exploration name: 3 of 5 setup thresholds passed (a marginal read).'],
    ["compute_error: KeyError: 'close'", 'The engine could not evaluate this name that morning.'],
    ['some-new-engine-slug', "It did not clear that morning's process."],
    ['failed gate: extended from 10ema', 'failed gate: extended from 10ema'],
  ])('%s', (raw, out) => { expect(dropReasonText(raw)).toBe(out) })

  it('stage names read as words; an unknown stage stays a number', () => {
    expect(stageText({ outcome: 'dropped', dropped_at_stage: 1, stage_label: 'universe' })).toBe('Dropped at the universe screen (stage 1)')
    expect(stageText({ outcome: 'dropped', dropped_at_stage: 3, stage_label: 'lens' })).toBe('Dropped at the final setup review (stage 3)')
    expect(stageText({ outcome: 'dropped', dropped_at_stage: 7, stage_label: null })).toBe('Dropped at stage 7')
  })
})

describe('DecisionRecordTab renders the translation, never the slug', () => {
  it('the swept row', () => {
    result = { ok: true, httpStatus: 200, body: {
      ticker: 'XYZ', status: 'considered',
      rows: [{ issue_id: '2026-10-05', outcome: 'dropped', dropped_at_stage: 2, stage_label: 'gate',
        drop_reason: 'market-cap-0.00B-below-1.0B-floor (tier passed but mcap floor failed)' }],
      counts: { issues_considered: 1, issues_passed: 0, issues_dropped: 1 },
      coverage: null, source: { tables: ['wire_universe', 'wire_issues'] } } }
    render(<DecisionRecordTab sym="XYZ" />)
    expect(screen.getByText('Dropped at the swing-trade gate (stage 2)')).toBeInTheDocument()
    expect(screen.getByTestId('decision-record-reason').textContent).toMatch(/market cap could not be read/)
    expect(document.body.textContent).not.toMatch(/market-cap-|mcap floor|· gate|wire_universe/)
  })

  it('an unavailable store gives no internal code', () => {
    result = { ok: true, httpStatus: 200, body: { status: 'unavailable', reason: 'table_missing:wire_universe' } }
    render(<DecisionRecordTab sym="XYZ" />)
    expect(screen.getByTestId('decision-record-unavailable').textContent).not.toMatch(/table_missing|wire_universe/)
  })
})
