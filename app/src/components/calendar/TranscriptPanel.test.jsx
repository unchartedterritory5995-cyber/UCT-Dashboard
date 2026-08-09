// app/src/components/calendar/TranscriptPanel.test.jsx
//
// Moved out of callRecap.test.jsx when the transcript stopped being a child of
// the AI recap. The assertions are the originals -- lazy fetch, expand/collapse,
// segments, speakers, loading, unavailable, TTS -- re-pointed at the component
// that now owns them.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockUseTranscript = vi.fn(() => ({ data: undefined, isLoading: false }))
vi.mock('../../hooks/useTranscript', () => ({
  default: (...args) => mockUseTranscript(...args),
}))

import TranscriptPanel from './TranscriptPanel'

// ── TranscriptPanel — the verbatim transcript, standalone ─────────────────────

const SAMPLE_TRANSCRIPT = {
  symbol:   'AAPL',
  quarter:  '2025Q1',
  segments: [
    { speaker: 'Tim Cook',     title: 'CEO', content: 'Revenue grew strongly this quarter.', sentiment: null },
    { speaker: 'Luca Maestri', title: 'CFO', content: 'Margins expanded across all categories.', sentiment: 'positive' },
  ],
  resolved: true,
}

describe('TranscriptPanel', () => {
  beforeEach(() => {
    // Reset mock to default (no transcript, not loading)
    mockUseTranscript.mockReturnValue({ data: undefined, isLoading: false })
  })

  it('shows the Full Transcript toggle when a symbol is provided', () => {
    render(<TranscriptPanel sym="AAPL" />)
    expect(screen.getByText('FULL TRANSCRIPT')).toBeTruthy()
  })

  it('renders nothing without a symbol', () => {
    render(<TranscriptPanel />)
    expect(screen.queryByText('FULL TRANSCRIPT')).toBeNull()
  })

  it('is collapsed by default — transcript segments not visible', () => {
    mockUseTranscript.mockReturnValue({ data: SAMPLE_TRANSCRIPT, isLoading: false })
    render(<TranscriptPanel sym="AAPL" />)
    // Segments not rendered until expanded
    expect(screen.queryByText('Revenue grew strongly this quarter.')).toBeNull()
  })

  it('is LAZY — useTranscript not called with enabled=true until expanded', () => {
    render(<TranscriptPanel sym="AAPL" />)
    // All calls to useTranscript should have enabled=false (or falsy) while collapsed
    const calls = mockUseTranscript.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    calls.forEach(([_ticker, opts]) => {
      expect(opts?.enabled).toBeFalsy()
    })
  })

  it('triggers fetch (enabled=true) after expand click', () => {
    render(<TranscriptPanel sym="AAPL" />)
    mockUseTranscript.mockClear()
    const btn = screen.getByRole('button', { name: /FULL TRANSCRIPT/i })
    fireEvent.click(btn)
    // After expansion, hook should be called with enabled=true
    const callsAfter = mockUseTranscript.mock.calls
    const wasEnabled = callsAfter.some(([_t, opts]) => opts?.enabled === true)
    expect(wasEnabled).toBe(true)
  })

  it('renders transcript segments after expansion', () => {
    mockUseTranscript.mockReturnValue({ data: SAMPLE_TRANSCRIPT, isLoading: false })
    render(<TranscriptPanel sym="AAPL" />)
    // Expand the panel
    fireEvent.click(screen.getByRole('button', { name: /FULL TRANSCRIPT/i }))
    expect(screen.getByText('Revenue grew strongly this quarter.')).toBeTruthy()
    expect(screen.getByText('Margins expanded across all categories.')).toBeTruthy()
  })

  it('shows speaker names in transcript', () => {
    mockUseTranscript.mockReturnValue({ data: SAMPLE_TRANSCRIPT, isLoading: false })
    render(<TranscriptPanel sym="AAPL" />)
    fireEvent.click(screen.getByRole('button', { name: /FULL TRANSCRIPT/i }))
    // speakerName has CSS text-transform:uppercase — DOM text is unchanged; match case-insensitively
    expect(screen.getByText('Tim Cook')).toBeTruthy()
    expect(screen.getByText('Luca Maestri')).toBeTruthy()
  })

  it('shows loading message while transcript is fetching', () => {
    mockUseTranscript.mockReturnValue({ data: undefined, isLoading: true })
    render(<TranscriptPanel sym="AAPL" />)
    fireEvent.click(screen.getByRole('button', { name: /FULL TRANSCRIPT/i }))
    expect(screen.getByText('Loading transcript…')).toBeTruthy()
  })

  it('shows unavailable message when transcript is null after load', () => {
    mockUseTranscript.mockReturnValue({ data: null, isLoading: false })
    render(<TranscriptPanel sym="AAPL" />)
    fireEvent.click(screen.getByRole('button', { name: /FULL TRANSCRIPT/i }))
    expect(screen.getByText('Transcript not available.')).toBeTruthy()
  })

  describe('keyword highlighting', () => {
    // These drove the RECAP's search box, which this panel no longer has --
    // the transcript is no longer a passenger on the recap's UI. Phase 1 gives
    // the panel its own search (count + jump-to-match + filter); until then the
    // `query` prop is the seam, and the highlighting contract is unchanged.
    it('highlights the keyword inside segment content', () => {
      mockUseTranscript.mockReturnValue({ data: SAMPLE_TRANSCRIPT, isLoading: false })
      render(<TranscriptPanel sym="AAPL" query="Revenue" />)
      fireEvent.click(screen.getByRole('button', { name: /FULL TRANSCRIPT/i }))
      expect(screen.getByText(/grew strongly this quarter\./)).toBeTruthy()
      const marks = document.querySelectorAll('mark')
      expect(marks.length).toBeGreaterThan(0)
      expect([...marks].some(m => m.textContent === 'Revenue')).toBe(true)
    })

    it('leaves every segment visible -- highlighting is not filtering', () => {
      mockUseTranscript.mockReturnValue({ data: SAMPLE_TRANSCRIPT, isLoading: false })
      render(<TranscriptPanel sym="AAPL" query="Margins" />)
      fireEvent.click(screen.getByRole('button', { name: /FULL TRANSCRIPT/i }))
      expect(screen.getByText(/expanded across all categories\./)).toBeTruthy()
      expect(screen.getByText('Revenue grew strongly this quarter.')).toBeTruthy()
    })
  })

  it('shows Listen to call button when speechSynthesis is available and transcript loaded', () => {
    const mockSynth = { speak: vi.fn(), cancel: vi.fn() }
    Object.defineProperty(window, 'speechSynthesis', { value: mockSynth, configurable: true })
    mockUseTranscript.mockReturnValue({ data: SAMPLE_TRANSCRIPT, isLoading: false })
    render(<TranscriptPanel sym="AAPL" />)
    fireEvent.click(screen.getByRole('button', { name: /FULL TRANSCRIPT/i }))
    expect(screen.getByTitle('Listen to call')).toBeTruthy()
  })
})
