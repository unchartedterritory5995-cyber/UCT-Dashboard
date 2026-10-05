import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// DES in the Terminal -- the adapter must hand OverviewTab the read's error +
// retry, or a failed AI read shows "will appear here once available".
const mutate = vi.fn()
vi.mock('../../research/hooks/useResearchOverview', () => ({
  default: () => ({ sym: 'AAPL', stats: {}, analyst: {}, ai: {}, error: true, mutate }),
}))
vi.mock('../../research/hooks/useLatestReport', () => ({
  default: () => ({ row: null, state: 'empty', retry: () => {} }),
}))
vi.mock('../../research/tabs/OverviewTab', () => ({
  default: ({ error, mutate: m }) => (
    <div>
      <span data-testid="err">{String(error)}</span>
      <button type="button" onClick={() => m && m()}>Retry</button>
    </div>
  ),
}))

import OverviewPanel from './OverviewPanel'

describe('OverviewPanel', () => {
  it('passes error and mutate through to the Overview tab', () => {
    render(<OverviewPanel sym="AAPL" />)
    expect(screen.getByTestId('err').textContent).toBe('true')
    screen.getByText('Retry').click()
    expect(mutate).toHaveBeenCalled()
  })
})
