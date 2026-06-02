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
  rating_changes: [{ firm: 'Goldman', action: 'upgrade', from_rating: 'Neutral', to_rating: 'Buy', price_target: 200 }],
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
    expect(screen.getByText(/"We are firing on all cylinders\."/)).toBeTruthy()
  })

  it('renders rating change', () => {
    render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
    expect(screen.getByText('Goldman')).toBeTruthy()
    expect(screen.getByText('Neutral → Buy')).toBeTruthy()
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
      expect(screen.getByText('🔊 Listen')).toBeTruthy()
    })

    it('does NOT show Listen button when speechSynthesis is unavailable', () => {
      // Remove speechSynthesis from window
      const descriptor = Object.getOwnPropertyDescriptor(window, 'speechSynthesis')
      if (descriptor) {
        Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true })
      }
      render(<CallRecapSection recap={FULL_RECAP} audio={null} />)
      expect(screen.queryByText('🔊 Listen')).toBeNull()
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
      fireEvent.click(screen.getByText('🔊 Listen'))
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
      expect(screen.getByText('▶ REPLAY')).toBeTruthy()
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
