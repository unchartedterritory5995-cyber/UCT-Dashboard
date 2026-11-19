// The Calendar earnings modal's "The Street" canvas. Its Estimates column is the consensus view
// (FMP first, the labelled Yahoo Finance forward table only when FMP holds none, revisions as
// their own read): the view the Terminal's EE panel shows, and the /research Estimates tab shows
// when its flag is on. The modal does not read that flag.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const seen = vi.hoisted(() => ({ consensus: [], legacy: 0 }))
vi.mock('../fmpDepth/ConsensusEstimates', () => ({
  default: (props) => { seen.consensus.push(props); return <div data-testid="consensus-estimates" /> },
}))
vi.mock('../../../pages/research/tabs/EstimatesTab', () => ({
  default: () => { seen.legacy += 1; return <div data-testid="legacy-estimates" /> },
}))
vi.mock('../../../pages/research/tabs/AnalystRatingsTab', () => ({ default: () => <div data-testid="anr" /> }))
vi.mock('../../../pages/research/tabs/RatingsTab', () => ({ default: () => <div data-testid="rtg" /> }))
vi.mock('../../../pages/research/tabs/OwnershipTab', () => ({ default: ({ sym }) => <div data-testid="own" data-sym={sym} /> }))
vi.mock('../../../pages/research/hooks/useRatings', () => ({ default: () => ({ data: null }) }))

import AnalystsSection from './AnalystsSection'

afterEach(() => { cleanup(); seen.consensus.length = 0; seen.legacy = 0 })

describe('AnalystsSection (the earnings modal)', () => {
  it('mounts the consensus view for the symbol, without a second earnings trade card', () => {
    render(<AnalystsSection sym="NVDA" />)
    expect(screen.getByTestId('consensus-estimates')).toBeInTheDocument()
    expect(seen.consensus).toEqual([{ sym: 'NVDA', showTradeCard: false }])
  })

  it('does not mount the yfinance-only estimates tab, whatever the research flag says', () => {
    render(<AnalystsSection sym="NVDA" />)
    expect(screen.queryByTestId('legacy-estimates')).toBeNull()
    expect(seen.legacy).toBe(0)
    const src = readFileSync(join(process.cwd(), 'src/components/research/sections/AnalystsSection.jsx'), 'utf8')
    expect(src).not.toMatch(/import EstimatesTab/)
    expect(src).not.toMatch(/researchFmpDepthEnabled|research_fmp_depth_enabled/)
  })

  it('keeps ratings, analyst ratings and ownership beside it', () => {
    render(<AnalystsSection sym="NVDA" />)
    for (const id of ['rtg', 'anr', 'own']) expect(screen.getByTestId(id)).toBeInTheDocument()
    expect(screen.getByTestId('own').getAttribute('data-sym')).toBe('NVDA')
  })

  it('with no symbol it renders nothing', () => {
    const { container } = render(<AnalystsSection sym="" />)
    expect(container.textContent).toBe('')
  })
})
