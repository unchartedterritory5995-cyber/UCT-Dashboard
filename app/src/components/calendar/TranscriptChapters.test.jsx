// D-4 — transcript chapters in the real TranscriptPanel, and the recap's
// review label in the real CallRecapSection. Asserted on rendered text.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockUseTranscript = vi.fn(() => ({ data: undefined, isLoading: false }))
vi.mock('../../hooks/useTranscript', () => ({ default: (...a) => mockUseTranscript(...a) }))
vi.mock('../../hooks/useTranscriptQuarters', () => ({ default: () => ({ quarters: [] }) }))
vi.mock('../../hooks/useTimedTranscript', () => ({
  default: () => ({ data: undefined }), buildWordIndex: () => ({ starts: [], keys: [] }), wordAt: () => -1,
}))
vi.mock('./TranscriptSearchAll', () => ({ default: () => null }))

import TranscriptPanel from './TranscriptPanel'
import CallRecapSection from './CallRecapSection'

const SEGS = [
  { speaker: 'Tim Cook', title: 'CEO', content: 'A record quarter.' },
  { speaker: 'Operator', title: '', content: 'We will now begin the question-and-answer session.' },
  { speaker: 'Amy Analyst', title: '', content: 'What about China?' },
  { speaker: 'Tim Cook', title: 'CEO', content: 'China was strong.' },
]
const TREE = {
  qa_boundary: 'stated',
  chapters: [
    { title: 'Prepared remarks', kind: 'prepared', level: 1, start: 0, end: 1,
      children: [{ title: 'Tim Cook', kind: 'speaker', level: 2, start: 0, end: 1 }] },
    { title: 'Q&A', kind: 'qa', level: 1, start: 2, end: 3,
      children: [{ title: 'Question from Amy Analyst', kind: 'question', level: 2, start: 2, end: 3 }] },
  ],
}

const open = () => fireEvent.click(screen.getByText('FULL TRANSCRIPT'))

describe('TranscriptPanel chapters (D-4)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    global.requestAnimationFrame = cb => { cb(); return 0 }
  })

  it('renders no chapter list when the payload carries none (flag off)', () => {
    mockUseTranscript.mockReturnValue({ data: { symbol: 'AAPL', segments: SEGS }, isLoading: false })
    render(<TranscriptPanel sym="AAPL" />)
    open()
    expect(screen.getByText('A record quarter.')).toBeInTheDocument()
    expect(screen.queryByTestId('transcript-chapters')).toBeNull()
  })

  it('lists the chapters and a click jumps to that turn', () => {
    mockUseTranscript.mockReturnValue({ data: { symbol: 'AAPL', segments: SEGS, chapters: TREE }, isLoading: false })
    const { container } = render(<TranscriptPanel sym="AAPL" />)
    open()
    const btns = screen.getAllByTestId('chapter')
    expect(btns.map(b => b.textContent)).toEqual([
      'Prepared remarks 2 turns', 'Tim Cook', 'Q&A 2 turns', 'Question from Amy Analyst',
    ])
    Element.prototype.scrollIntoView.mockClear()
    fireEvent.click(screen.getByText('Question from Amy Analyst'))
    const target = container.querySelector('[data-segment="2"]')
    expect(Element.prototype.scrollIntoView.mock.contexts).toContain(target)
  })

  it('says so when the transcript never states its Q&A boundary', () => {
    const flat = { qa_boundary: 'not_stated', chapters: [{ title: 'Call', kind: 'call', level: 1, start: 0, end: 3, children: [] }] }
    mockUseTranscript.mockReturnValue({ data: { symbol: 'AAPL', segments: SEGS, chapters: flat }, isLoading: false })
    render(<TranscriptPanel sym="AAPL" />)
    open()
    expect(screen.getByTestId('chapters-no-qa').textContent).toMatch(/never says where the Q&A begins/)
  })
})

describe('CallRecapSection review label (D-4)', () => {
  const RECAP = { ticker: 'AAPL', recap: { headline: 'Strong quarter', bullets: ['One.'] } }

  it('is absent when the server sends no review_status (flag off)', () => {
    render(<CallRecapSection recap={RECAP} audio={null} />)
    expect(screen.getByText('Strong quarter')).toBeInTheDocument()
    expect(screen.queryByTestId('recap-review-status')).toBeNull()
  })

  it('says AI-generated, not reviewed, when the server stamps it', () => {
    render(<CallRecapSection recap={{ ...RECAP, review_status: 'ai_unreviewed' }} audio={null} />)
    expect(screen.getByTestId('recap-review-status').textContent).toBe('AI-generated · not reviewed')
  })
})
