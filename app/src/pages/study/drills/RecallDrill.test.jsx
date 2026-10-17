/** RecallDrill rails (spec §4.3 type 1, §13.7 D6/D8/D17). */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { Body, answerFromState, isAnswerable, choicesOf, kindOf } from './RecallDrill'

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

const mcq = { id: 'r1', type: 'recall', prompt_json: { question: 'What is a pivot?', kind: 'mcq', choices: ['The buy point', 'The stop', 'The target', 'The low'] } }
const tf = { id: 'r2', type: 'recall', prompt_json: { question: 'A stop goes above the entry.', kind: 'tf' } }
const fill = { id: 'r3', type: 'recall', prompt_json: { question: 'Fill the blank', kind: 'fill', sentence: 'Risk no more than ___ of the account on one trade.', bank: ['2%', '5%', '10%', '0.5%', '1%'] } }
const num = { id: 'r4', type: 'recall', prompt_json: { question: 'Dollars at risk on $50,000 at 1%?', kind: 'fill_numeric', prefix: '$', label: 'Dollars' } }

describe('RecallDrill', () => {
  it('renders multiple choice as a radiogroup with keys, and marks the pick gold with a check glyph', () => {
    render(<Host item={mcq} />)
    const group = screen.getByRole('radiogroup', { name: 'What is a pivot?' })
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(4)
    expect(group.querySelectorAll('li')).toHaveLength(4)
    expect(screen.getByTestId('answerable')).toHaveTextContent('false')
    fireEvent.click(screen.getByRole('radio', { name: /The stop/ }))
    expect(screen.getByRole('radio', { name: /The stop/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /The stop/ }).querySelector('svg')).toBeTruthy()
    expect(screen.getByTestId('answer')).toHaveTextContent('{"choice":"The stop"}')
    expect(screen.getByTestId('answerable')).toHaveTextContent('true')
  })

  it('arrow keys move the selection inside the radiogroup', () => {
    render(<Host item={mcq} />)
    const first = screen.getByRole('radio', { name: /The buy point/ })
    fireEvent.click(first)
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(screen.getByRole('radio', { name: /The stop/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(screen.getByRole('radio', { name: /The stop/ }), { key: 'ArrowUp' })
    expect(screen.getByRole('radio', { name: /The buy point/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('true / false defaults to two short choices in the 2x2 grid', () => {
    render(<Host item={tf} />)
    expect(kindOf(tf)).toBe('tf')
    expect(choicesOf(tf)).toEqual(['True', 'False'])
    expect(screen.getByRole('radio', { name: /True/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /False/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /False/ }))
    expect(screen.getByTestId('answer')).toHaveTextContent('{"choice":"False"}')
  })

  it('a term fill-in uses a chip word bank, never a text input, and fills the gold slot', () => {
    render(<Host item={fill} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    const bank = screen.getByRole('radiogroup', { name: 'Word bank' })
    expect(bank.querySelectorAll('button')).toHaveLength(5)
    expect(screen.getByText(/Risk no more than/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: '1%' }))
    expect(screen.getByLabelText('blank: 1%')).toHaveTextContent('1%')
    expect(screen.getByTestId('answer')).toHaveTextContent('{"choice":"1%"}')
    expect(screen.getByTestId('answerable')).toHaveTextContent('true')
  })

  it('a numeric fill-in keeps a real decimal input and sends the number', () => {
    render(<Host item={num} />)
    const input = screen.getByRole('textbox', { name: 'Dollars' })
    expect(input).toHaveAttribute('inputmode', 'decimal')
    expect(screen.getByText('$')).toBeInTheDocument()
    expect(screen.getByTestId('answerable')).toHaveTextContent('false')
    fireEvent.change(input, { target: { value: '5a00' } })
    expect(input).toHaveValue('500')
    expect(screen.getByTestId('answer')).toHaveTextContent('{"choice":500}')
    expect(screen.getByTestId('answerable')).toHaveTextContent('true')
  })

  it('locks every control after Check', () => {
    render(<Host item={mcq} locked />)
    screen.getAllByRole('radio').forEach((r) => expect(r).toBeDisabled())
  })

  it('a numeric field scrolls itself into view when the visual viewport shrinks (keyboard guard)', () => {
    const listeners = {}
    window.visualViewport = { addEventListener: (k, fn) => { listeners[k] = fn }, removeEventListener: vi.fn(), height: 400 }
    try {
      render(<Host item={num} />)
      const input = screen.getByRole('textbox', { name: 'Dollars' })
      input.scrollIntoView = vi.fn()
      input.focus()
      listeners.resize()
      expect(input.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    } finally {
      delete window.visualViewport
    }
  })
})
