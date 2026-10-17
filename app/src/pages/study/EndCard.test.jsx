/** EndCard rails (spec §13.7 D12, D17). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../../utils/alertSound', () => ({ playStudyTone: vi.fn() }))
import { playStudyTone } from '../../utils/alertSound'
import EndCard, { RING_SIZE, RING_STROKE } from './EndCard'

beforeEach(() => { vi.clearAllMocks(); window.localStorage.clear() })

describe('EndCard', () => {
  it('reads "8 of 10", the XP, up to two bonus rows, seven week dots, and the two buttons', () => {
    const onDone = vi.fn()
    const onKeep = vi.fn()
    render(
      <EndCard
        correct={8} total={10} xp={40}
        bonuses={[{ label: 'Refresher', xp: 10 }, { label: 'Streak day', xp: 5 }, { label: 'A third row that must not show', xp: 99 }]}
        weekDots={[true, true, false, true, false, false, false]}
        onDone={onDone} onKeepPractising={onKeep}
      />,
    )
    expect(screen.getByTestId('end-score')).toHaveTextContent('8 of 10')
    expect(screen.getByText('+40')).toBeInTheDocument()
    expect(screen.getByText('Refresher')).toBeInTheDocument()
    expect(screen.getByText('Streak day')).toBeInTheDocument()
    expect(screen.queryByText('A third row that must not show')).not.toBeInTheDocument()
    const week = screen.getByRole('list', { name: 'This week' })
    expect(week.querySelectorAll('li')).toHaveLength(7)
    expect(week.querySelectorAll('li[aria-label$=", done"]')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Keep practising' }))
    expect(onKeep).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('fills the ring to n/10 after the first frame', async () => {
    render(<EndCard correct={5} total={10} onDone={() => {}} />)
    const r = (RING_SIZE - RING_STROKE) / 2
    const circumference = 2 * Math.PI * r
    const fill = screen.getByTestId('end-ring-fill')
    await act(async () => { await new Promise((res) => requestAnimationFrame(() => res())) })
    expect(Number(fill.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * 0.5, 3)
  })

  it('shows a badge only when one was earned, as a 36px gold circle with its line', () => {
    const { rerender } = render(<EndCard correct={10} total={10} onDone={() => {}} />)
    expect(screen.queryByTestId('end-badge')).not.toBeInTheDocument()
    rerender(<EndCard correct={10} total={10} badge={{ name: 'VCP: 20 reps', line: 'Twenty clean reps on one setup.' }} onDone={() => {}} />)
    expect(screen.getByTestId('end-badge')).toHaveTextContent('VCP: 20 reps')
    expect(screen.getByText('Twenty clean reps on one setup.')).toBeInTheDocument()
  })

  it('plays the end chime once when sound is on, and not when it is off', () => {
    const { unmount } = render(<EndCard correct={1} total={10} profile={{ sound_on: true }} onDone={() => {}} />)
    expect(playStudyTone).toHaveBeenCalledWith('end')
    expect(playStudyTone).toHaveBeenCalledTimes(1)
    unmount()
    render(<EndCard correct={1} total={10} profile={{ sound_on: false }} onDone={() => {}} />)
    expect(playStudyTone).toHaveBeenCalledTimes(1)
  })
})
