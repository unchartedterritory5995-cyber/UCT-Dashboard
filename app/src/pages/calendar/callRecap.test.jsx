// app/src/pages/calendar/callRecap.test.jsx
// Vitest + Testing Library tests for CallRecapSection and SentimentGauge.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ── Module mocks ──────────────────────────────────────────────────────────────

// Mock useSentiment so SentimentGauge doesn't hit the network
vi.mock('../../hooks/useSentiment', () => ({
  default: vi.fn(() => ({ data: null })),
}))

// Mock useEarningsAudio
vi.mock('../../hooks/useEarningsAudio', () => ({
  default: vi.fn(() => ({ data: null })),
}))

// Mock useTranscript — we control what the hook returns per test
const mockUseTranscript = vi.fn(() => ({ data: undefined, isLoading: false }))
vi.mock('../../hooks/useTranscript', () => ({
  default: (...args) => mockUseTranscript(...args),
}))

// Inline the actual components under test
import CallRecapSection from '../../components/calendar/CallRecapSection'
import { SentimentGaugeDisplay } from '../../components/calendar/SentimentGauge'

// ── Helpers ───────────────────────────────────────────────────────────────────

const FULL_RECAP = {
  headline:    'Strong Q1 beat on all metrics',
  sentiment:   'bullish',
  bullets:     ['Revenue grew 22% YoY', 'Guidance raised by $0.10 EPS', 'Margins expanded 150bps'],
  quotes:      [{ speaker: 'CEO', text: 'We are firing on all cylinders.' }],
  guidance:    'Full-year EPS guidance raised to $5.20–$5.30.',
  qa_highlights: ['Analyst asked about share buybacks', 'Management cited strong pipeline'],
  // The PRODUCER's shape (monthly bucket snapshots). The previous fixture here
  // invented a per-firm {firm, action, from_rating, to_rating} feed that
  // get_rating_changes has never emitted — which is exactly why the broken
  // renderer stayed green.
  rating_changes: [{ period: '2026-08-01', strong_buy: 6, buy: 18, hold: 3, sell: 0, strong_sell: 0, net: 24, net_delta: 2 }],
  webcast_url: 'https://example.com/webcast',
}

// ── CallRecapSection tests ────────────────────────────────────────────────────

describe('CallRecapSection', () => {
  it('returns null when recap is null', () => {
    const { container } = render(<CallRecapSection recap={null} audio={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders headline', () => {
    render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
    expect(screen.getByText('Strong Q1 beat on all metrics')).toBeTruthy()
  })

  it('renders all bullet points', () => {
    render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
    expect(screen.getByText('Revenue grew 22% YoY')).toBeTruthy()
    expect(screen.getByText('Guidance raised by $0.10 EPS')).toBeTruthy()
    expect(screen.getByText('Margins expanded 150bps')).toBeTruthy()
  })

  it('renders guidance block', () => {
    render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
    expect(screen.getByText('Full-year EPS guidance raised to $5.20–$5.30.')).toBeTruthy()
  })

  it('renders management quote', () => {
    render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
    // Quotes render with typographic quotation marks now; assert the words,
    // not the punctuation around them.
    expect(document.body.textContent).toContain('We are firing on all cylinders.')
  })

  it('renders the rating trend row', () => {
    render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
    expect(screen.getByText('Aug 2026')).toBeTruthy()
    expect(document.body.textContent).toContain('24 buy')
    expect(document.body.textContent).toContain('+2 net')
  })

  describe('Listen button (TTS)', () => {
    let originalSpeechSynthesis

    beforeEach(() => {
      originalSpeechSynthesis = window.speechSynthesis
    })

    afterEach(() => {
      if (originalSpeechSynthesis !== undefined) {
        Object.defineProperty(window, 'speechSynthesis', {
          value: originalSpeechSynthesis, configurable: true,
        })
      } else {
        delete window.speechSynthesis
      }
    })

    it('shows Listen button when speechSynthesis is available', () => {
      const mockSynth = { speak: vi.fn(), cancel: vi.fn() }
      Object.defineProperty(window, 'speechSynthesis', { value: mockSynth, configurable: true })
      render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
      expect(screen.getByText('Listen')).toBeTruthy()
    })

    it('does NOT show Listen button when speechSynthesis is unavailable', () => {
      // Remove speechSynthesis from window
      const descriptor = Object.getOwnPropertyDescriptor(window, 'speechSynthesis')
      if (descriptor) {
        Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true })
      }
      render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
      expect(screen.queryByText('Listen')).toBeNull()
    })

    it('calls speechSynthesis.speak when Listen is clicked', () => {
      const mockSpeak = vi.fn()
      const mockSynth = { speak: mockSpeak, cancel: vi.fn() }
      Object.defineProperty(window, 'speechSynthesis', { value: mockSynth, configurable: true })
      global.SpeechSynthesisUtterance = vi.fn().mockImplementation(function(text) {
        this.text = text
        this.onend = null
        this.onerror = null
      })
      render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
      fireEvent.click(screen.getByText('Listen'))
      expect(mockSpeak).toHaveBeenCalledOnce()
    })
  })

  describe('keyword search', () => {
    it('renders search input', () => {
      render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
      const input = screen.getByPlaceholderText('Search in recap…')
      expect(input).toBeTruthy()
    })

    it('filters bullets to only matching items', () => {
      render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
      const input = screen.getByPlaceholderText('Search in recap…')
      fireEvent.change(input, { target: { value: 'Revenue' } })
      // The matching bullet has its keyword wrapped in <mark>, so text is split
      // across elements. Use a regex or text-content check instead of exact string.
      expect(screen.getByText(/grew 22% YoY/)).toBeTruthy()
      expect(screen.queryByText('Guidance raised by $0.10 EPS')).toBeNull()
      expect(screen.queryByText('Margins expanded 150bps')).toBeNull()
    })

    it('clears filter when clear button is clicked', () => {
      render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
      const input = screen.getByPlaceholderText('Search in recap…')
      fireEvent.change(input, { target: { value: 'Revenue' } })
      // All 3 bullets were visible before filter; now only 1. Clear → all 3 back.
      fireEvent.click(screen.getByLabelText('Clear search'))
      expect(screen.getByText('Revenue grew 22% YoY')).toBeTruthy()
      expect(screen.getByText('Guidance raised by $0.10 EPS')).toBeTruthy()
      expect(screen.getByText('Margins expanded 150bps')).toBeTruthy()
    })

    it('shows no bullets when keyword matches nothing', () => {
      render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
      const input = screen.getByPlaceholderText('Search in recap…')
      fireEvent.change(input, { target: { value: 'xyzqwerty' } })
      expect(screen.queryByText('Revenue grew 22% YoY')).toBeNull()
    })
  })

  describe('audio player', () => {
    it('renders native audio player when stream_url present', () => {
      const audio = { stream_url: 'https://cdn.example.com/call.mp3', kind: 'recorded' }
      render(<CallRecapSection recap={FULL_RECAP} audio={audio} />)
      const audioEl = document.querySelector('audio')
      expect(audioEl).toBeTruthy()
      expect(audioEl.getAttribute('src')).toBe('https://cdn.example.com/call.mp3')
    })

    it('shows "REPLAY" label for recorded audio', () => {
      const audio = { stream_url: 'https://cdn.example.com/call.mp3', kind: 'recorded' }
      render(<CallRecapSection recap={FULL_RECAP} audio={audio} />)
      expect(screen.getByText('REPLAY')).toBeTruthy()
    })

    it('shows "LISTEN LIVE" label for live audio', () => {
      const audio = { stream_url: 'https://stream.example.com/live', kind: 'live' }
      render(<CallRecapSection recap={FULL_RECAP} audio={audio} />)
      expect(screen.getByText(/LISTEN LIVE/)).toBeTruthy()
    })

    it('does NOT render audio element when stream_url is absent', () => {
      render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
      expect(document.querySelector('audio')).toBeNull()
    })

    it('shows webcast link when no stream_url', () => {
      render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
      const links = screen.getAllByRole('link')
      const webcastLink = links.find(l => l.getAttribute('href') === 'https://example.com/webcast')
      expect(webcastLink).toBeTruthy()
    })
  })

  it('renders empty bullets list safely (no crash)', () => {
    const recap = { ...FULL_RECAP, bullets: [] }
    render(<CallRecapSection recap={recap} audio={null} />)
    // Headline should still render
    expect(screen.getByText('Strong Q1 beat on all metrics')).toBeTruthy()
  })
})

// ── SentimentGaugeDisplay tests ───────────────────────────────────────────────

describe('SentimentGaugeDisplay', () => {
  it('returns null when data is null', () => {
    const { container } = render(<SentimentGaugeDisplay data={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders label pill', () => {
    render(<SentimentGaugeDisplay data={{ score: 0.7, label: 'bullish', rationale: 'Strong beats.', drivers: [] }} />)
    expect(screen.getByText('BULLISH')).toBeTruthy()
  })

  it('renders score number', () => {
    render(<SentimentGaugeDisplay data={{ score: 0.7, label: 'bullish', rationale: 'Strong beats.', drivers: [] }} />)
    expect(screen.getByText('+0.70')).toBeTruthy()
  })

  it('renders rationale text', () => {
    render(<SentimentGaugeDisplay data={{ score: 0.5, label: 'bullish', rationale: 'Strong beats.', drivers: [] }} />)
    expect(screen.getByText('Strong beats.')).toBeTruthy()
  })

  it('renders negative sentiment label', () => {
    render(<SentimentGaugeDisplay data={{ score: -0.6, label: 'bearish', rationale: 'Weak guidance.', drivers: [] }} />)
    expect(screen.getByText('BEARISH')).toBeTruthy()
    expect(screen.getByText('-0.60')).toBeTruthy()
  })

  it('renders drivers list', () => {
    const data = {
      score: 0.3,
      label: 'neutral',
      rationale: 'Mixed signals.',
      drivers: ['Strong EPS', 'Weak guidance'],
    }
    render(<SentimentGaugeDisplay data={data} />)
    expect(screen.getByText('Strong EPS')).toBeTruthy()
    expect(screen.getByText('Weak guidance')).toBeTruthy()
  })

  it('renders with null score gracefully', () => {
    const { container } = render(
      <SentimentGaugeDisplay data={{ score: null, label: 'neutral', rationale: null, drivers: [] }} />
    )
    expect(container.firstChild).toBeTruthy()
  })
})

// ── The producer/consumer shape defects, at the surface ───────────────────────

describe('CallRecapSection — the shape the service actually sends', () => {
  // call_recap.py asks the model for {topic, quote}; this component read
  // {speaker, text}. Rendering gave empty quotation marks, and the search
  // filter did `(q.text || q).toLowerCase()` — on an object that throws
  // "q.toLowerCase is not a function", taking the section down mid-keystroke.
  const SERVICE_SHAPE = {
    headline: 'Beat on adjusted EPS',
    sentiment: 'positive',            // NOT 'bullish' — the service's vocabulary
    bullets: ['Record Experiences revenue'],
    quotes: [
      { topic: 'Margins', quote: 'We expect continued margin expansion.' },
      { topic: 'Buyback', quote: 'We raised the repurchase programme.' },
    ],
    guidance: 'raised',
    qa_highlights: [],
  }

  it('renders quote text rather than empty quotation marks', () => {
    render(<CallRecapSection recap={SERVICE_SHAPE} audio={null} />)
    expect(screen.getByText(/We expect continued margin expansion\./)).toBeTruthy()
  })

  it('does not crash when searching a recap that has quotes', () => {
    render(<CallRecapSection recap={SERVICE_SHAPE} audio={null} />)
    const input = screen.getByPlaceholderText('Search in recap…')
    expect(() => fireEvent.change(input, { target: { value: 'margin' } })).not.toThrow()
    // The surviving quote's text is split across <mark> nodes by the highlight.
    expect(document.body.textContent).toContain('We expect continued margin expansion.')
    // …and it really filters: the non-matching quote is gone.
    expect(screen.queryByText(/raised the repurchase programme/)).toBeNull()
  })

  it('styles a positive call as positive — the badge tested a dead vocabulary', () => {
    const { container } = render(<CallRecapSection recap={SERVICE_SHAPE} audio={null} />)
    const badge = screen.getByText('POSITIVE')
    expect(badge.className).toBe(container.querySelector('[class*="sentBull"]')?.className)
  })

  it('renders the guidance enum ONCE, as the chip', () => {
    render(<CallRecapSection recap={SERVICE_SHAPE} audio={null} />)
    expect(screen.getByText(/GUIDANCE RAISED/)).toBeTruthy()
    // The old code also emitted a "GUIDANCE" heading over a one-word paragraph.
    expect(screen.queryByText('GUIDANCE')).toBeNull()
  })

  it('still renders real guidance PROSE when the field carries a sentence', () => {
    render(<CallRecapSection
      recap={{ ...SERVICE_SHAPE, guidance: 'Full-year EPS guidance raised to $5.20–$5.30.' }}
      audio={null} />)
    expect(screen.getByText(/Full-year EPS guidance raised/)).toBeTruthy()
    expect(screen.queryByText(/GUIDANCE RAISED/)).toBeNull()
  })
})

describe('rating trend — the shape the SERVER actually sends', () => {
  // Captured verbatim from GET /api/earnings/call-recap/CVS in production.
  // The renderer used to read rc.firm / rc.action / rc.to_rating — a per-firm
  // upgrade-downgrade feed that get_rating_changes has never emitted — so
  // every field was undefined and the panel drew bare "→" arrows against four
  // rows of real data. A fixture in the PRODUCER's shape is the only kind that
  // could have caught it.
  const LIVE = [
    { period: '2026-08-01', strong_buy: 6, buy: 18, hold: 3, sell: 0, strong_sell: 0, net: 24, net_delta: 0 },
    { period: '2026-06-01', strong_buy: 6, buy: 18, hold: 4, sell: 0, strong_sell: 0, net: 24, net_delta: -1 },
    { period: '2026-05-01', strong_buy: 7, buy: 18, hold: 4, sell: 0, strong_sell: 0, net: 25, net_delta: null },
  ]

  it('renders the bucket counts, not an empty row', () => {
    render(<CallRecapSection recap={{ ...FULL_RECAP, rating_changes: LIVE }} audio={null} />)
    expect(document.body.textContent).toContain('24 buy')
    expect(document.body.textContent).toContain('25 buy')
    expect(document.body.textContent).toContain('3 hold')
  })

  it('labels each period rather than leaving the row nameless', () => {
    render(<CallRecapSection recap={{ ...FULL_RECAP, rating_changes: LIVE }} audio={null} />)
    expect(screen.getByText('Aug 2026')).toBeTruthy()
    expect(screen.getByText('May 2026')).toBeTruthy()
  })

  it('shows a net move only when there IS one, and never for a null delta', () => {
    render(<CallRecapSection recap={{ ...FULL_RECAP, rating_changes: LIVE }} audio={null} />)
    // -1 in June is a real move; 0 in August and null in May are not.
    expect(screen.getByText('-1 net')).toBeTruthy()
    expect(screen.queryByText('0 net')).toBeNull()
    expect(screen.queryByText(/null/)).toBeNull()
  })
})
