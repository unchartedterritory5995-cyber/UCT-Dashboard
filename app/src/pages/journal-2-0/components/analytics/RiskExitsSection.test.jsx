import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Stub ECharts (same idiom as sibling analytics tests, e.g. PerformancePanel).
vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

import RiskExitsSection from './RiskExitsSection'

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Coverage too thin → the backend gates every aggregate to null / []. The FE
// must show the honest "check back" state, never an empty chart.
const NOT_READY = {
  coverage: { eligible: 8, computed: 3, optionsExcluded: 0 },
  coverageReady: false,
  avgExitEfficiency: null,
  efficiencySampleSize: null,
  efficiencyExcludedNoFavorable: null,
  missedRTotal: null,
  avgMissedR: null,
  missedRSampleSize: null,
  efficiencyBuckets: [],
  actualVsPotential: null,
}

const NO_TRADES = {
  coverage: { eligible: 0, computed: 0, optionsExcluded: 0 },
  coverageReady: false,
  avgExitEfficiency: null,
  efficiencySampleSize: null,
  efficiencyExcludedNoFavorable: null,
  missedRTotal: null,
  avgMissedR: null,
  missedRSampleSize: null,
  efficiencyBuckets: [],
  actualVsPotential: null,
}

const READY = {
  coverage: { eligible: 20, computed: 20, optionsExcluded: 2 },
  coverageReady: true,
  avgExitEfficiency: 0.62,
  efficiencySampleSize: 18,
  efficiencyExcludedNoFavorable: 2,
  missedRTotal: 4.5,
  avgMissedR: 0.25,
  missedRSampleSize: 18,
  efficiencyBuckets: [
    { bucket: '0-25%', count: 2 },
    { bucket: '25-50%', count: 5 },
    { bucket: '50-75%', count: 7 },
    { bucket: '75-100%', count: 4 },
  ],
  actualVsPotential: [
    { i: 1, actual: 0.5, potential: 0.9 },
    { i: 2, actual: 1.2, potential: 2.0 },
  ],
}

const READY_NO_CURVE = {
  coverage: { eligible: 12, computed: 12, optionsExcluded: 0 },
  coverageReady: true,
  avgExitEfficiency: 0.4,
  efficiencySampleSize: 12,
  efficiencyExcludedNoFavorable: 0,
  missedRTotal: 2.0,
  avgMissedR: 0.17,
  missedRSampleSize: 12,
  efficiencyBuckets: [
    { bucket: '0-25%', count: 4 },
    { bucket: '25-50%', count: 4 },
    { bucket: '50-75%', count: 2 },
    { bucket: '75-100%', count: 2 },
  ],
  actualVsPotential: [],
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RiskExitsSection', () => {
  it('shows the check-back state with coverage counts and NO chart when not ready', () => {
    render(<RiskExitsSection data={NOT_READY} />)
    expect(screen.getByText(/check back after tonight/i)).toBeInTheDocument()
    // real coverage counts surfaced, not fabricated
    expect(screen.getByText(/3 of 8 eligible trades are analyzed/i)).toBeInTheDocument()
    expect(screen.queryByTestId('echart')).not.toBeInTheDocument()
  })

  it('shows the "no closed equity trades" state when eligible is 0', () => {
    render(<RiskExitsSection data={NO_TRADES} />)
    expect(screen.getByText(/no closed equity trades/i)).toBeInTheDocument()
    expect(screen.queryByTestId('echart')).not.toBeInTheDocument()
  })

  it('renders both plain-language modules, headlines, and both charts when ready', () => {
    render(<RiskExitsSection data={READY} />)
    // Module 1 plain-language title + efficiency headline
    expect(screen.getByText(/how much of the move did you capture/i)).toBeInTheDocument()
    expect(screen.getByText('62.00%')).toBeInTheDocument()
    // Module 2 plain-language title + missed-R total headline
    expect(screen.getByText(/leave on the table/i)).toBeInTheDocument()
    expect(screen.getByText('+4.5R')).toBeInTheDocument()
    // both charts render (efficiency bar + actual-vs-potential line)
    expect(screen.getAllByTestId('echart')).toHaveLength(2)
    // the N-of-M coverage caveat PERSISTS into the ready state (honesty: the
    // numbers never look like they came from every trade)
    expect(screen.getByText(/Based on 20 of 20 closed trades analyzed/i)).toBeInTheDocument()
    // options excluded surfaced in the methodology footer
    expect(screen.getByText(/2 option trades excluded/i)).toBeInTheDocument()
    // no-favorable exclusion note
    expect(screen.getByText(/no favorable excursion/i)).toBeInTheDocument()
  })

  it('keeps the missed-R headline but hides the curve chart when actualVsPotential is empty', () => {
    render(<RiskExitsSection data={READY_NO_CURVE} />)
    expect(screen.getByText('+2.0R')).toBeInTheDocument()
    // only the efficiency chart renders; the curve is replaced by a note
    expect(screen.getAllByTestId('echart')).toHaveLength(1)
    expect(screen.getByText(/need at least 2/i)).toBeInTheDocument()
  })
})
