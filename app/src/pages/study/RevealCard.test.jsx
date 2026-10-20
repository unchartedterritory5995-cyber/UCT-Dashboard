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
