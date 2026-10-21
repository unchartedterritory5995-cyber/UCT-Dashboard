/** RevealCard rails (spec §4.6, §4.9, §13.7 D9, D11). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../components/mobile/haptics', () => ({
  tap: vi.fn(), impact: vi.fn(), success: vi.fn(), warn: vi.fn(),
}))
vi.mock('../../utils/alertSound', () => ({
  playStudyTone: vi.fn(),
}))

import * as haptics from '../../components/mobile/haptics'
import { playStudyTone } from '../../utils/alertSound'
import RevealCard, { appendForwardBars, CORRECT_WORD, WRONG_WORD, lessonHrefFor } from './RevealCard'

const reveal = {
  sym: 'AAPL', asof: '2025-01-21', start: '2024-08-01',
  lesson: 'The pivot is where the buyers have to prove it.',
  provenance: { source_kind: 'fixture', source_ref: 'aapl_vcp_2025' },
  what_happened_next: 'Broke out on 3x volume and ran 18% in 14 bars.',
  lesson_key: 'm6-vcp-anatomy',
  answer: { answer: 'VCP' },
  forward_bars: [{ t: 20250122, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }],
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('RevealCard', () => {
  it('says "Correct" in words with the gold check, ticker and dates, the lesson, and a Why disclosure', () => {
    render(<RevealCard correct reveal={reveal} item={{ id: 'x', type: 'spot' }} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(CORRECT_WORD)
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('2024-08-01 to 2025-01-21')).toBeInTheDocument()
    expect(screen.getByText('The pivot is where the buyers have to prove it.')).toBeInTheDocument()
    expect(screen.getByText('Why')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Why'))
    expect(screen.getByText('fixture · aapl_vcp_2025')).toBeInTheDocument()
    expect(screen.getByText('Broke out on 3x volume and ran 18% in 14 bars.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Read the lesson' })).toHaveAttribute('href', '/desk?section=courses&lesson=m6-vcp-anatomy')
    expect(screen.queryByText(/The answer:/)).not.toBeInTheDocument()
  })

  it('says "Not quite" with the muted cross and names the answer; never the words green or red', () => {
    const { container } = render(<RevealCard correct={false} reveal={reveal} item={{ id: 'x', type: 'spot' }} />)
    expect(screen.getByRole('status')).toHaveTextContent(WRONG_WORD)
    expect(screen.getByText('The answer: VCP')).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/green|red|#2faf68|#df4646/i)
    expect(screen.getByTestId('reveal-card')).toHaveAttribute('data-correct', '0')
  })

  it('fires the success haptic and the correct tone once on the reveal, warn and the descending tone when wrong', () => {
    const { rerender, unmount } = render(<RevealCard correct reveal={reveal} profile={{ sound_on: true }} />)
    expect(haptics.success).toHaveBeenCalledTimes(1)
    expect(playStudyTone).toHaveBeenCalledWith('correct')
    rerender(<RevealCard correct reveal={reveal} profile={{ sound_on: true }} />)
    expect(haptics.success).toHaveBeenCalledTimes(1)
    unmount()
    render(<RevealCard correct={false} reveal={reveal} profile={{ sound_on: true }} />)
    expect(haptics.warn).toHaveBeenCalledTimes(1)
    expect(playStudyTone).toHaveBeenLastCalledWith('wrong')
  })

  it('the profile toggle silences the tone but keeps the haptic', () => {
    render(<RevealCard correct reveal={reveal} profile={{ sound_on: false }} />)
    expect(haptics.success).toHaveBeenCalledTimes(1)
    expect(playStudyTone).not.toHaveBeenCalled()
  })

  it('appends forward bars to the visible window in order, deduped, dates normalised', () => {
    const visible = [{ t: '2025-01-20', o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: '2025-01-21', o: 1, h: 1, l: 1, c: 1, v: 1 }]
    const out = appendForwardBars(visible, [{ t: 20250121, o: 9, h: 9, l: 9, c: 9, v: 9 }, { t: 20250122, o: 2, h: 2, l: 2, c: 2, v: 2 }, { t: '2025-01-23', o: 3, h: 3, l: 3, c: 3, v: 3 }])
    expect(out.map((b) => b.t)).toEqual(['2025-01-20', '2025-01-21', '2025-01-22', '2025-01-23'])
    expect(out[1].o).toBe(1)
    expect(out).toHaveLength(4)
    expect(appendForwardBars(visible, null)).toBe(visible)
  })

  it('renders Continue only when asked to, and no link without a lesson key', () => {
    const onContinue = vi.fn()
    render(<RevealCard correct reveal={{ ...reveal, lesson_key: undefined }} onContinue={onContinue} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onContinue).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Why'))
    expect(screen.queryByRole('link', { name: 'Read the lesson' })).not.toBeInTheDocument()
    expect(lessonHrefFor({})).toBeNull()
  })
})

// ── the six-part lesson + the feedback door (owner 2026-10-21) ───────────────
import { FEEDBACK_KINDS, LESSON_PART_LABELS, feedbackUrl, lessonParts } from './revealCardHelpers'

const PARTS = {
  shape: 'Two bars. A green body that covers the red one.',
  story: 'Sellers had the first session; buyers took it all back.',
  where: 'Only after a decline.',
  confirm: 'A close above the engulfing high.',
  cancel: 'A close below its low.',
  desk: 'Low is the stop, high is the trigger.',
}

describe('RevealCard lesson parts and feedback', () => {
  it('renders the six parts with their headings in order, instead of the one paragraph', () => {
    render(<RevealCard correct reveal={{ ...reveal, lesson_parts: PARTS, ref: '872a0a' }} item={{ id: 'si_872a0a87de98', type: 'recall' }} />)
    const dl = screen.getByTestId('lesson-parts')
    const labels = [...dl.querySelectorAll('dt')].map((d) => d.textContent)
    expect(labels).toEqual(LESSON_PART_LABELS.map(([, l]) => l))
    expect(dl).toHaveTextContent('Low is the stop, high is the trigger.')
    expect(screen.queryByText(reveal.lesson)).not.toBeInTheDocument()
    expect(screen.getByTestId('item-ref')).toHaveTextContent('ref 872a0a')
  })

  it('falls back to the paragraph when no parts are written, and a half-written set keeps what it has', () => {
    render(<RevealCard correct reveal={reveal} item={{ id: 'x', type: 'spot' }} />)
    expect(screen.getByText(reveal.lesson)).toBeInTheDocument()
    expect(screen.queryByTestId('lesson-parts')).not.toBeInTheDocument()
    expect(lessonParts({ lesson_parts: { shape: 'A', nope: 'B', desk: '  ' } })).toEqual([{ key: 'shape', label: 'The shape', text: 'A' }])
    expect(lessonParts({})).toBeNull()
  })

  it('a member sends a kind and a note with the attempt, and never sees the verdict row', async () => {
    const post = vi.fn(async () => ({ id: 1, applied: null }))
    render(<RevealCard correct={false} reveal={reveal} item={{ id: 'si_872a0a87de98', type: 'recall' }} attemptId={77} post={post} />)
    fireEvent.click(screen.getByTestId('feedback-open'))
    expect(screen.queryByTestId('verdict-row')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Lesson unclear' }))
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'the where part lost me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByTestId('feedback-done')).toHaveTextContent('Thanks, noted.')
    expect(post).toHaveBeenCalledWith(feedbackUrl('si_872a0a87de98'), {
      method: 'POST', body: { kind: 'unclear_lesson', text: 'the where part lost me', attempt_id: 77 },
    })
    expect(FEEDBACK_KINDS.map(([k]) => k)).toContain('great')
  })

  it('a reviewer approves from the card and reads back that it is live', async () => {
    const post = vi.fn(async () => ({ id: 2, applied: 'approve' }))
    render(<RevealCard correct reveal={reveal} item={{ id: 'si_a' }} reviewer post={post} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review this one' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Approve' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByTestId('feedback-done')).toHaveTextContent('Approved. It is live.')
    expect(post.mock.calls[0][1].body).toEqual({ kind: 'other', text: null, verdict: 'approve' })
  })

  it('a failed send says so and keeps the form', async () => {
    const post = vi.fn(async () => { throw new Error('500') })
    render(<RevealCard correct reveal={reveal} item={{ id: 'si_a' }} post={post} />)
    fireEvent.click(screen.getByTestId('feedback-open'))
    fireEvent.click(screen.getByRole('button', { name: 'Too hard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send that')
    expect(screen.getByTestId('feedback-form')).toBeInTheDocument()
  })

  it('no door without an item id, and none when feedback is off', () => {
    render(<RevealCard correct reveal={reveal} item={{ type: 'spot' }} />)
    expect(screen.queryByTestId('feedback-open')).not.toBeInTheDocument()
    render(<RevealCard correct reveal={reveal} item={{ id: 'si_b' }} feedback={false} />)
    expect(screen.queryByTestId('feedback-open')).not.toBeInTheDocument()
  })
})
