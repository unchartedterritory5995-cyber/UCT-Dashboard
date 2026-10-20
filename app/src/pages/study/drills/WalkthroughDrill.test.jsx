/** WalkthroughDrill rails (spec §13.9 #1, VOICE.md §4 "A walk-through"). */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import WalkthroughDrill, { Body, answerFromState, isAnswerable, choicesOf, stepsOf, shownCount, unscored } from './WalkthroughDrill'
import { DRILLS, drillFor, isUnscoredDrill } from './index'

function Host({ item, locked = false }) {
  const [state, setState] = useState(null)
  return (
    <div>
      <Body item={item} state={state} setState={setState} locked={locked} />
      <output data-testid="answer">{JSON.stringify(answerFromState(state, item))}</output>
      <output data-testid="answerable">{String(isAnswerable(state, item))}</output>
    </div>
  )
}

const walk = {
  id: 'w1', type: 'walkthrough',
  prompt_json: { q: 'Regime', order: 1, part: 1, parts: 2, steps: ['The score maps to a band.', 'A band is permission, not prediction.', 'Say it that way every time.'] },
}

describe('WalkthroughDrill', () => {
  it('is registered for type walkthrough and declares itself unscored', () => {
    expect(DRILLS.walkthrough).toBe(WalkthroughDrill)
    expect(drillFor('walkthrough')).toBe(WalkthroughDrill)
    expect(unscored).toBe(true)
    expect(isUnscoredDrill(WalkthroughDrill)).toBe(true)
    expect(isUnscoredDrill(drillFor('recall'))).toBe(false)
    expect(choicesOf(walk)).toEqual([])
  })

  it('shows the label, then the steps one at a time on Next, with a dot per step', () => {
    render(<Host item={walk} />)
    expect(screen.getByText('Regime')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.getAllByTestId('walk-step')).toHaveLength(1)
    expect(screen.getByText('The score maps to a band.')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByTestId('walk-dots')).toHaveAttribute('aria-label', 'Step 1 of 3')
    expect(screen.getByTestId('walk-dots').querySelectorAll('li')).toHaveLength(3)
    expect(screen.getByTestId('answerable')).toHaveTextContent('false')
    expect(screen.getByTestId('answer')).toHaveTextContent('{"seen":1}')

    fireEvent.click(screen.getByTestId('walk-next'))
    expect(screen.getAllByTestId('walk-step')).toHaveLength(2)
    expect(screen.getByText('A band is permission, not prediction.')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('The score maps to a band.')).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('walk-dots')).toHaveAttribute('aria-label', 'Step 2 of 3')
    expect(screen.getByTestId('answerable')).toHaveTextContent('false')
    expect(screen.getByTestId('answer')).toHaveTextContent('{"seen":2}')
  })

  it('on the last step Next is gone and the walk-through is answerable as {seen: n}', () => {
    render(<Host item={walk} />)
    fireEvent.click(screen.getByTestId('walk-next'))
    fireEvent.click(screen.getByTestId('walk-next'))
    expect(screen.getAllByTestId('walk-step')).toHaveLength(3)
    expect(screen.queryByTestId('walk-next')).not.toBeInTheDocument()
    expect(screen.getByTestId('answerable')).toHaveTextContent('true')
    expect(screen.getByTestId('answer')).toHaveTextContent('{"seen":3}')
    expect(answerFromState({ shown: 99 }, walk)).toEqual({ seen: 3 })
  })

  it('nothing is scored: no Check, no choices, no radio, no input', () => {
    render(<Host item={walk} />)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Check')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button')).toHaveTextContent('Next')
  })

  it('locked keeps Next disabled; a stepless item is never answerable', () => {
    render(<Host item={walk} locked />)
    expect(screen.getByTestId('walk-next')).toBeDisabled()
    const bare = { id: 'w0', type: 'walkthrough', prompt_json: { q: 'Scan', steps: [] } }
    expect(stepsOf(bare)).toEqual([])
    expect(shownCount(null, bare)).toBe(0)
    expect(isAnswerable({ shown: 4 }, bare)).toBe(false)
    expect(answerFromState(null, bare)).toEqual({ seen: 0 })
    expect(stepsOf({ prompt_json: { steps: ['a', ' ', 2] } })).toEqual(['a', '2'])
  })
})
