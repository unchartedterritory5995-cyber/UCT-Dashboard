// Review r1 M7 — the main CallSection.test.jsx suite mocks `CallRecapSection`
// wholesale and asserts on the PROPS handed to the mock ("hands CallRecapSection
// the FLAT shape it actually reads"). That's the right test for CallSection's
// OWN logic, but it's a proxy: if `normalizeCallRecap` or CallSection's wiring
// silently drifted out of sync with what the REAL CallRecapSection reads, that
// proxy test could keep passing while the shipped UI renders blank. This file
// renders the REAL CallRecapSection (nothing here mocks it) end-to-end, so the
// flat-merge actually has to survive contact with the component that reads it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import CallSection from './CallSection'

// The AI sentiment score is a separate, unrelated self-fetching widget (see
// CallSection.jsx's GATE e docblock) — mocked here purely so its own SWR
// round-trip doesn't need a third fetch branch below. useCallRecap,
// useEarningsAudio, normalizeCallRecap, and CallRecapSection are all REAL.
vi.mock('../../../hooks/useSentiment', () => ({
  default: () => ({ data: { score: 0.4, label: 'bullish', drivers: [] } }),
}))

const WRAPPER = {
  ticker: 'NVDA',
  recap: {
    headline: 'Data-centre beat, guidance raised', sentiment: 'bullish',
    bullets: ['Strong data-centre demand'], quotes: [{ speaker: 'CEO', text: 'Best quarter yet' }],
    guidance: 'raised', qa_highlights: [],
  },
  // OUTER fields — the whole point of the shape fix. `recapData?.recap` (the
  // historically-broken shape one other call site uses) would lose these.
  webcast_url: 'https://ir.example.com/replay',
  rating_changes: [{ firm: 'Morgan Stanley', action: 'upgrade', to_rating: 'Overweight' }],
}

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (url.includes('/api/earnings/call-recap/')) {
      return Promise.resolve({ ok: true, json: async () => WRAPPER })
    }
    if (url.includes('/api/earnings/audio/')) {
      return Promise.resolve({ ok: true, json: async () => null })
    }
    return Promise.resolve({ ok: true, json: async () => null })
  })
})

describe('CallSection integration (real CallRecapSection, not mocked)', () => {
  it('the flat merge reaches the real component — an INNER field renders', async () => {
    render(<CallSection sym="NVDA" row={{ sym: 'NVDA' }} lifecycle="POST" />)
    expect(await screen.findByText('Data-centre beat, guidance raised')).toBeTruthy()
  })

  it('the flat merge reaches the real component — an OUTER field (webcast_url) renders too', async () => {
    render(<CallSection sym="NVDA" row={{ sym: 'NVDA' }} lifecycle="POST" />)
    // CallRecapSection only shows "Listen live" from `recap.webcast_url` when
    // there's no audio stream — proves the OUTER wrapper field survived the
    // merge onto the SAME object the inner headline came from.
    const link = await screen.findByRole('link', { name: /listen live/i })
    expect(link.getAttribute('href')).toBe('https://ir.example.com/replay')
  })

  it('rating_changes (also an OUTER field) renders via the real RatingChanges block', async () => {
    render(<CallSection sym="NVDA" row={{ sym: 'NVDA' }} lifecycle="POST" />)
    expect(await screen.findByText('Morgan Stanley')).toBeTruthy()
  })
})
