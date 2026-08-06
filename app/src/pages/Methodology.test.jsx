import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

import Methodology from './Methodology'
import { NOT_ADVICE, SETUP_GRADE_INFO, UCT_RATING_INFO, IMPLIED_MOVE_INFO, METHODOLOGY_PATH } from '../constants/disclaimer'

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

  it('carries the standing not-advice line verbatim', () => {
    expect(NOT_ADVICE).toBe('For informational purposes only — not investment advice.')
  })

  it('renders the not-advice line on the page', () => {
    renderPage()
    expect(screen.getByTestId('methodology-not-advice').textContent).toBe('For informational purposes only — not investment advice.')
  })

  it('exports all constants without the word "verdict"', () => {
    expect(NOT_ADVICE.toLowerCase()).not.toContain('verdict')
    expect(SETUP_GRADE_INFO.text.toLowerCase()).not.toContain('verdict')
    expect(UCT_RATING_INFO.text.toLowerCase()).not.toContain('verdict')
    expect(IMPLIED_MOVE_INFO.text.toLowerCase()).not.toContain('verdict')
  })

  it('pins weights from backend setup_grade.py to ensure parity', () => {
    // Compute path: from test file to api/services/setup_grade.py
    const __filename = fileURLToPath(import.meta.url)
    const testDir = resolve(__filename, '..')
    const setupGradePath = resolve(testDir, '../../../api/services/setup_grade.py')

    const content = readFileSync(setupGradePath, 'utf-8')

    // Extract WEIGHTS dictionary: "beat_streak": 0.30, etc.
    const weightsMatch = content.match(/WEIGHTS:\s*dict\[str,\s*float\]\s*=\s*\{([^}]+)\}/s)
    expect(weightsMatch).toBeTruthy()

    // Parse weight values: "0.30", "0.30", "0.25", "0.15"
    const weightsStr = weightsMatch[1]
    const beatStreakMatch = weightsStr.match(/"beat_streak":\s*([0-9.]+)/)
    const revision30dMatch = weightsStr.match(/"revision_30d":\s*([0-9.]+)/)
    const rsRankMatch = weightsStr.match(/"rs_rank":\s*([0-9.]+)/)
    const ivPremiumMatch = weightsStr.match(/"iv_premium":\s*([0-9.]+)/)

    expect(parseFloat(beatStreakMatch[1])).toBe(0.30)
    expect(parseFloat(revision30dMatch[1])).toBe(0.30)
    expect(parseFloat(rsRankMatch[1])).toBe(0.25)
    expect(parseFloat(ivPremiumMatch[1])).toBe(0.15)
  })

  it('pins letter ladder from backend LETTER_THRESHOLDS to ensure parity', () => {
    // Compute path: from test file to api/services/setup_grade.py
    const __filename = fileURLToPath(import.meta.url)
    const testDir = resolve(__filename, '..')
    const setupGradePath = resolve(testDir, '../../../api/services/setup_grade.py')

    const content = readFileSync(setupGradePath, 'utf-8')

    // Extract LETTER_THRESHOLDS: (93, "A+"), (15, "D-"), etc.
    const thresholdsMatch = content.match(/LETTER_THRESHOLDS:\s*list\[tuple\[float,\s*str\]\]\s*=\s*\[([^\]]+)\]/s)
    expect(thresholdsMatch).toBeTruthy()

    const thresholdsStr = thresholdsMatch[1]

    // Find A+ (93)
    const aPlusMatch = thresholdsStr.match(/\(93,\s*"A\+"\)/)
    expect(aPlusMatch).toBeTruthy()

    // Find F (FLOOR_LETTER)
    const floorLetterMatch = content.match(/FLOOR_LETTER\s*=\s*"(\w+)"/)
    expect(floorLetterMatch[1]).toBe('F')
  })

  it('exports info objects that point at this page', () => {
    expect(SETUP_GRADE_INFO.href).toBe(METHODOLOGY_PATH)
    expect(SETUP_GRADE_INFO.text.toLowerCase()).not.toContain('verdict')
  })
})
