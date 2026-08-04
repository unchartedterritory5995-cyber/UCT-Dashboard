import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import Methodology from './Methodology'
import { NOT_ADVICE, SETUP_GRADE_INFO, METHODOLOGY_PATH } from '../constants/disclaimer'

const renderPage = () =>
  render(<MemoryRouter><Methodology /></MemoryRouter>)

describe('Methodology page (§12)', () => {
  it('names the Setup Grade and never says "verdict"', () => {
    const { container } = renderPage()
    expect(screen.getByRole('heading', { name: /methodology/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Earnings Setup Grade/i })).toBeTruthy()
    expect(container.textContent.toLowerCase()).not.toContain('verdict')
  })

  it('publishes all four inputs WITH their weights (an audit, not a label)', () => {
    renderPage()
    const table = screen.getByTestId('methodology-grade-weights')
    const rows = within(table).getAllByRole('row').slice(1)   // drop the header
    const cells = rows.map(r => within(r).getAllByRole('cell').map(c => c.textContent.trim()))
    expect(cells).toEqual([
      ['Beat streak', '30%', expect.any(String)],
      ['Estimate revisions (30d)', '30%', expect.any(String)],
      ['Relative strength rank', '25%', expect.any(String)],
      ['Options premium vs typical move', '15%', expect.any(String)],
    ])
  })

  it('publishes the letter ladder ends and the partial-basis rule', () => {
    renderPage()
    const ladder = screen.getByTestId('methodology-grade-ladder')
    expect(ladder.textContent).toContain('A+')
    expect(ladder.textContent).toContain('93')
    expect(ladder.textContent).toContain('F')
    expect(screen.getByTestId('methodology-partial-basis').textContent)
      .toMatch(/3 of 4 inputs/)
  })

  it('separates the Setup Grade (this event) from the UCT Rating (the stock)', () => {
    renderPage()
    expect(screen.getByTestId('methodology-scope').textContent)
      .toMatch(/this report[\s\S]*the stock/i)
  })

  it('carries the standing not-advice line', () => {
    renderPage()
    expect(screen.getByTestId('methodology-not-advice').textContent).toBe(NOT_ADVICE)
  })

  it('exports info objects that point at this page', () => {
    expect(SETUP_GRADE_INFO.href).toBe(METHODOLOGY_PATH)
    expect(SETUP_GRADE_INFO.text.toLowerCase()).not.toContain('verdict')
  })
})
