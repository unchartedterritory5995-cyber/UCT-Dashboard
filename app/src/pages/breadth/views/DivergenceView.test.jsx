import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import DivergenceView from './DivergenceView'

// Newest-first. Price climbs while participation falls → price-leads divergence.
const rows = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  sp500_close: 5000 + (40 - i) * 10,
  pct_above_50sma: 20 + i,
}))

describe('DivergenceView', () => {
  it('reports an active divergence and names its direction', () => {
    const { getByTestId } = render(<DivergenceView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ price: 'sp500_close', participation: 'pct_above_50sma', minGap: 5 }} />)
    expect(getByTestId('divergence-verdict').textContent).toMatch(/price leading/i)
  })

  it('says so plainly when the two series agree', () => {
    const agree = rows.map((r, i) => ({ ...r, pct_above_50sma: 20 + (40 - i) }))
    const { getByTestId } = render(<DivergenceView rows={agree} rowIdx={0} currentRow={agree[0]}
      onDrill={() => {}} options={{ price: 'sp500_close', participation: 'pct_above_50sma', minGap: 5 }} />)
    expect(getByTestId('divergence-verdict').textContent).toMatch(/in step/i)
  })

  it('refuses a window too short to z-score', () => {
    const { getByTestId } = render(<DivergenceView rows={rows.slice(0, 4)} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ price: 'sp500_close', participation: 'pct_above_50sma', minGap: 5 }} />)
    expect(getByTestId('divergence-insufficient').textContent).toMatch(/needs 20 sessions/i)
  })
})
