import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const mockData = { current: null }
vi.mock('swr', () => ({ default: () => ({ data: mockData.current, isLoading: false, error: null }) }))

const { default: AnalogueDeckView } = await import('./AnalogueDeckView')
const { medianOf } = await import('./breadthViewShared')

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
    expect(getByTestId('analogues-card-2025-03-11').textContent).toMatch(/92\.4/)
    expect(getByTestId('analogues-card-2025-03-11').textContent).toMatch(/\+4\.5/)
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
    expect(getByTestId('analogues-summary').textContent).toMatch(/2 of 3 higher/i)
  })

  it('does not invent a return for a horizon the history cannot reach', () => {
    mockData.current = {
      reference_date: '2026-08-28',
      analogues: [{ date: 'a', similarity: 90, forward_returns: {} }],
    }
    const { getByTestId } = render(<AnalogueDeckView rows={[]} rowIdx={0} options={{ horizon: 'fwd_20d' }} />)
    expect(getByTestId('analogues-card-a').textContent).toMatch(/not yet/i)
  })

  it('says so plainly when nothing resembles today', () => {
    mockData.current = { reference_date: '2026-08-28', analogues: [] }
    const { getByTestId } = render(<AnalogueDeckView rows={[]} rowIdx={0} options={{ horizon: 'fwd_20d' }} />)
    expect(getByTestId('analogues-refusal').textContent).toMatch(/no historical session/i)
  })

  // 🔴 THE MEDIAN OF AN EVEN SET WAS THE UPPER-MIDDLE ELEMENT, not the average
  // of the two middle ones — a summary line biased upward by construction.
  describe('medianOf', () => {
    it('averages the two middle values on an even-length set', () => {
      expect(medianOf([-4, -1, 1, 5])).toBe(0)
      expect(medianOf([2, 4])).toBe(3)
    })
    it('still takes the middle value on an odd-length set', () => {
      expect(medianOf([5, 1, 3])).toBe(3)
    })
    it('is null with nothing to average', () => {
      expect(medianOf([])).toBeNull()
    })
  })

  it('reports the averaged median on screen, not the upper-middle return', () => {
    mockData.current = {
      reference_date: '2026-08-28',
      analogues: [-4, -1, 1, 5].map((r, i) => ({
        date: `d${i}`, similarity: 90 - i, forward_returns: { fwd_20d: r },
      })),
    }
    const { getByTestId } = render(<AnalogueDeckView rows={[]} rowIdx={0} options={{ horizon: 'fwd_20d' }} />)
    // Upper-middle would print "+1.0%"; the average of -1 and +1 is 0.0%.
    expect(getByTestId('analogues-summary').textContent).toMatch(/median \+0\.0%/)
  })
})
