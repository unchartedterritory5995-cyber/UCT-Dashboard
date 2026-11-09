import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { AnswerLessonApp, AnswerQuizShow, AnswerTicket } from './AnswerLooks'

// Focus round 2: three answer areas on the same inputs. Whatever they look like, each must let a member pick, check only
// once something is picked, and after the verdict mark the right answer, the wrong pick, and dim the rest.
const CH = ['Kicker', 'Oops Reversal', 'Nothing fired', 'Bear gap']
const LOOKS = [['lesson app', AnswerLessonApp], ['quiz show', AnswerQuizShow], ['order ticket', AnswerTicket]]
const states = (c) => [...c.querySelectorAll('[data-state]')].map((x) => x.dataset.state)

describe('the answer area, three versions', () => {
  it.each(LOOKS)('%s asks the fuller question', (_k, C) => {
    const { container } = render(<C choices={CH} />)
    expect(container.textContent).toContain('What fired on the last candle?')
    expect(container.textContent).toContain('The ringed candle is the last day on this chart')
  })
  it.each(LOOKS)('%s picks on a tap and checks only once something is picked', (_k, C) => {
    const onPick = vi.fn(); const onCheck = vi.fn()
    const { container, rerender, getByText } = render(<C choices={CH} onPick={onPick} onCheck={onCheck} />)
    fireEvent.click(getByText('Oops Reversal'))
    expect(onPick).toHaveBeenCalledWith(1)
    rerender(<C choices={CH} pick={1} onPick={onPick} onCheck={onCheck} />)
    expect(states(container)).toEqual(['idle', 'sel', 'idle', 'idle'])
    const check = [...container.querySelectorAll('button')].find((b) => /Check|Lock it in/.test(b.textContent))
    fireEvent.click(check)
    expect(onCheck).toHaveBeenCalledTimes(1)
  })
  it.each(LOOKS)('%s marks the right answer, the wrong pick and dims the rest', (_k, C) => {
    const onNext = vi.fn()
    const { container, getByText } = render(<C choices={CH} pick={1} state="bad" answer="Kicker" onNext={onNext} />)
    expect(states(container)).toEqual(['right', 'wrong', 'quiet', 'quiet'])
    fireEvent.click(getByText(/^Next/))
    expect(onNext).toHaveBeenCalled()
  })
  it('the lesson app keeps Check dark until an answer is picked', () => {
    const { getByText } = render(<AnswerLessonApp choices={CH} />)
    expect(getByText('Check').closest('button').disabled).toBe(true)
  })
})

describe('the lesson app in Hard mode', () => {
  it('Enter on the tile just picked checks the answer, and Enter after the verdict goes on', () => {
    const onCheck = vi.fn(); const onNext = vi.fn()
    const { getByText, rerender } = render(<AnswerLessonApp choices={CH} pick={0} hotkey onCheck={onCheck} onNext={onNext} />)
    const tile = getByText('Kicker').closest('button')
    tile.focus()
    fireEvent.keyDown(tile, { key: 'Enter' })
    expect(onCheck).toHaveBeenCalledTimes(1)
    rerender(<AnswerLessonApp choices={CH} pick={0} state="ok" answer="Kicker" hotkey onCheck={onCheck} onNext={onNext} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})
