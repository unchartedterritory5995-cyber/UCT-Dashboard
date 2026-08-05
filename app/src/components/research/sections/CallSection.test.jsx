import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import CallSection from './CallSection'

const wrapper = {
  ticker: 'NVDA',
  recap: { headline: 'Data-centre beat', sentiment: 'bullish', bullets: ['a'],
           quotes: [], guidance: 'raised', qa_highlights: [] },
  webcast_url: 'https://ir.example/live',
  rating_changes: [],
}

let recapData = wrapper
vi.mock('../../../hooks/useCallRecap', () => ({ default: () => ({ data: recapData }) }))
vi.mock('../../../hooks/useEarningsAudio', () => ({ default: () => ({ data: null }) }))
// CallSection renders SentimentGauge (self-fetching via useSentiment) above the
// recap and asserts its testid SYNCHRONOUSLY (no `await`/`findBy`) — a real
// useSWR-backed hook can never satisfy that: `data` starts `undefined` on
// every mount regardless of what `fetch` resolves to, because the resolution
// is a microtask the assertion never waits for. Mocked here the same way
// useCallRecap/useEarningsAudio already are, so the gauge has synchronous data.
vi.mock('../../../hooks/useSentiment', () => ({
  default: () => ({ data: { score: 0.7, label: 'bullish', drivers: [] } }),
}))
// CallRecapSection is a big existing component; assert what we HAND it.
let handed = null
vi.mock('../../calendar/CallRecapSection', () => ({
  default: (props) => { handed = props; return <div data-testid="call-recap" /> },
}))

const renderCall = (props = {}) => render(
  <CallSection sym="NVDA" row={{ sym: 'NVDA' }} lifecycle="POST" {...props} />,
)

describe('CallSection', () => {
  it('hands CallRecapSection the FLAT shape it actually reads', () => {
    recapData = wrapper
    renderCall()
    expect(handed.recap.headline).toBe('Data-centre beat')     // inner
    expect(handed.recap.webcast_url).toBe('https://ir.example/live')  // outer
    expect(handed.ticker).toBe('NVDA')
  })

  it('renders the restyled sentiment gauge above the recap', () => {
    recapData = wrapper
    renderCall()
    expect(screen.getByTestId('sentiment-gauge')).toBeTruthy()
  })

  it('EmptyState with useful copy when no recap has posted yet', () => {
    recapData = { ticker: 'NVDA', recap: null, webcast_url: null, rating_changes: [] }
    renderCall({ lifecycle: 'PRINTED' })
    expect(screen.getByText(/typically posts within 2h of the call/i)).toBeTruthy()
    expect(screen.queryByTestId('call-recap')).toBeNull()
  })

  it('CALL_LIVE surfaces a Listen live affordance when a webcast URL exists', () => {
    recapData = { ticker: 'NVDA', recap: null, webcast_url: 'https://ir.example/live',
                  rating_changes: [] }
    renderCall({ lifecycle: 'CALL_LIVE' })
    const link = screen.getByRole('link', { name: /listen live/i })
    expect(link.getAttribute('href')).toBe('https://ir.example/live')
    expect(link.getAttribute('rel')).toMatch(/noopener/)
  })

  // §12: the recap is LLM-authored prose — attribute it visibly, and never
  // when there is no recap to attribute (an absent field must render as
  // absent, not as a claim about content that doesn't exist).
  it('shows the AI provenance line when a recap is present', () => {
    recapData = wrapper
    renderCall()
    expect(screen.getByTestId('call-provenance').textContent).toMatch(/^AI ·/)
  })

  // Review r1 I3 — this used to assert the OPPOSITE (no provenance without a
  // recap), which left the panel's first AI content unattributed: the
  // SentimentGauge (an AI score + rationale + drivers, "AI-derived" per
  // api/routers/earnings_intel.py) self-fetches and renders whenever this
  // section mounts, recap or not. §12 requires AI prose to be visibly
  // attributed, so the line moved ABOVE the gauge and now covers both
  // branches.
  it('attributes the AI gauge even when no recap has posted yet', () => {
    recapData = { ticker: 'NVDA', recap: null, webcast_url: null, rating_changes: [] }
    renderCall({ lifecycle: 'PRINTED' })
    expect(screen.getByTestId('call-provenance').textContent).toMatch(/^AI ·/)
  })

  // The attribution must precede the content it attributes — a provenance
  // line rendered BELOW the gauge leaves the first thing the reader sees
  // unlabelled, which is the defect I3 named.
  it('the provenance line renders BEFORE the gauge, not after it', () => {
    recapData = wrapper
    const { container } = renderCall()
    const prov = screen.getByTestId('call-provenance')
    const gauge = container.querySelector('[data-testid="sentiment-gauge"]')
    expect(gauge).toBeTruthy()
    // DOCUMENT_POSITION_FOLLOWING === the gauge comes after the provenance
    expect(prov.compareDocumentPosition(gauge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never says "verdict"', () => {
    recapData = wrapper
    const { container } = renderCall()
    expect(container.textContent.toLowerCase()).not.toContain('verdict')
  })
})

it('GATE e: the restyled gauge reports its tone as data, not as a class name', async () => {
  // M4: no `vi.mock('../../calendar/SentimentGauge', ...)` exists in this file
  // (only its `useSentiment` hook is mocked above), so there is nothing to
  // undo here — `vi.doUnmock` on a never-mocked module is a no-op. Dropped.
  const { SentimentGaugeDisplay } = await import('../../calendar/SentimentGauge')
  render(<SentimentGaugeDisplay data={{ score: 0.7, label: 'bullish', drivers: [] }} />)
  const el = screen.getByTestId('sentiment-gauge')
  expect(el.getAttribute('data-sentiment')).toBe('bullish')
})
