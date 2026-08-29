import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const mockData = { current: null }
vi.mock('swr', () => ({ default: () => ({ data: mockData.current, isLoading: false, error: null }) }))

const { default: AnalogueDeckView } = await import('./AnalogueDeckView')

describe('AnalogueDeckView', () => {
  it('ranks matches and shows what happened next', () => {
    mockData.current = {
      reference_date: '2026-08-28',
      analogues: [
        { date: '2025-03-11', similarity: 92.4, forward_returns: { fwd_5d: 1.2, fwd_20d: 4.5 } },
        { date: '2024-11-02', similarity: 88.1, forward_returns: { fwd_5d: -0.8, fwd_20d: -2.1 } },
      ],
    }
    const { getByTestId } = render(<AnalogueDeckView rows={[]} rowIdx={0} options={{ horizon: 'fwd_20d' }} />)
    expect(getByTestId('analogue-2025-03-11').textContent).toMatch(/92\.4/)
    expect(getByTestId('analogue-2025-03-11').textContent).toMatch(/\+4\.5/)
  })

  it('summarizes the forward distribution rather than only the top match', () => {
    mockData.current = {
      reference_date: '2026-08-28',
      analogues: [
        { date: 'a', similarity: 90, forward_returns: { fwd_20d: 4 } },
        { date: 'b', similarity: 80, forward_returns: { fwd_20d: 2 } },
        { date: 'c', similarity: 70, forward_returns: { fwd_20d: -3 } },
      ],
    }
    const { getByTestId } = render(<AnalogueDeckView rows={[]} rowIdx={0} options={{ horizon: 'fwd_20d' }} />)
    expect(getByTestId('analogue-summary').textContent).toMatch(/2 of 3 higher/i)
  })

  it('does not invent a return for a horizon the history cannot reach', () => {
    mockData.current = {
      reference_date: '2026-08-28',
      analogues: [{ date: 'a', similarity: 90, forward_returns: {} }],
    }
    const { getByTestId } = render(<AnalogueDeckView rows={[]} rowIdx={0} options={{ horizon: 'fwd_20d' }} />)
    expect(getByTestId('analogue-a').textContent).toMatch(/not yet/i)
  })
})
