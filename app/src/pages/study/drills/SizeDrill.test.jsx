/** SizeDrill rails (spec §4.3 type 3, §4.11, §13.7 D8). */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { Body, answerFromState, isAnswerable, variantOf } from './SizeDrill'

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

const forward = { id: 's1', type: 'size', prompt_json: { question: 'Size it.', account: 50000, risk_pct: 1, entry: 42.5, stop: 40 } }
const reverse = { id: 's2', type: 'size', prompt_json: { question: 'What is the risk?', variant: 'reverse', account: 50000, entry: 42.5, stop: 40, shares: 200 } }

describe('SizeDrill', () => {
  it('forward: shows the facts and takes shares plus dollars at risk as decimal inputs', () => {
    render(<Host item={forward} />)
    expect(variantOf(forward)).toBe('forward')
    expect(screen.getByText('Account')).toBeInTheDocument()
    expect(screen.getByText('$50,000')).toBeInTheDocument()
    expect(screen.getByText('Risk per trade')).toBeInTheDocument()
    expect(screen.getByText('1%')).toBeInTheDocument()
    expect(screen.getByText('$42.5')).toBeInTheDocument()
    expect(screen.getByText('$40')).toBeInTheDocument()
    const shares = screen.getByRole('textbox', { name: 'Shares' })
    const risk = screen.getByRole('textbox', { name: 'Dollars at risk' })
    expect(shares).toHaveAttribute('inputmode', 'decimal')
    expect(risk).toHaveAttribute('inputmode', 'decimal')
    expect(screen.getByTestId('answerable')).toHaveTextContent('false')
    fireEvent.change(shares, { target: { value: '200' } })
    expect(screen.getByTestId('answerable')).toHaveTextContent('false')
    fireEvent.change(risk, { target: { value: '$500' } })
    expect(risk).toHaveValue('500')
    expect(screen.getByTestId('answerable')).toHaveTextContent('true')
    expect(JSON.parse(screen.getByTestId('answer').textContent)).toEqual({ shares: 200, dollars: 500, risk_dollars: 500 })
  })

  it('reverse: shows the shares as a fact, asks for the dollars at risk and the percent', () => {
    render(<Host item={reverse} />)
    expect(variantOf(reverse)).toBe('reverse')
    expect(screen.getByText('Shares')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Shares' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Dollars at risk' }), { target: { value: '500' } })
    expect(screen.getByTestId('answerable')).toHaveTextContent('true')
    fireEvent.change(screen.getByRole('textbox', { name: 'Risk as a percent of the account' }), { target: { value: '1' } })
    expect(JSON.parse(screen.getByTestId('answer').textContent)).toEqual({ shares: 200, dollars: 500, risk_dollars: 500, risk_pct: 1 })
  })

  it('says the rounding rule and locks the fields after Check', () => {
    render(<Host item={forward} locked />)
    expect(screen.getByText('Whole shares. Round the dollars to the nearest dollar.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Shares' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Dollars at risk' })).toBeDisabled()
  })

  it('an empty or non-numeric field is not answerable', () => {
    expect(isAnswerable({ shares: '', risk_dollars: '500' }, forward)).toBe(false)
    expect(isAnswerable({ shares: 'abc', risk_dollars: '500' }, forward)).toBe(false)
    expect(isAnswerable({ shares: '10', risk_dollars: '' }, forward)).toBe(false)
    expect(isAnswerable({ shares: '10', risk_dollars: '25' }, forward)).toBe(true)
    expect(isAnswerable({ risk_dollars: '25' }, reverse)).toBe(true)
  })
})
