import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const mockData = { current: null }
vi.mock('swr', () => ({ default: () => ({ data: mockData.current, isLoading: false, error: null }) }))

const { default: ScoreAttributionView } = await import('./ScoreAttributionView')

const row = { date: '2026-08-28' }

describe('ScoreAttributionView', () => {
  it('draws a bar per component with its share of the total', () => {
    mockData.current = {
      ok: true, date: '2026-08-28', total: 80, min_weight_met: true,
      components: [
        { key: 'vix', label: 'VIX (inverted)', weight: 10, points: 10, max_points: 10, present: true, value: 18 },
        { key: 'ratio_5day', label: '5-day up/down ratio', weight: 15, points: 6, max_points: 15, present: true, value: 1.0 },
      ],
      prev: { date: '2026-08-27', total: 70,
              components: [{ key: 'vix', label: 'VIX (inverted)', weight: 10, points: 4, max_points: 10, present: true, value: 24 }] },
    }
    const { getByTestId } = render(<ScoreAttributionView rows={[row]} rowIdx={0} currentRow={row} options={{}} />)
    expect(getByTestId('component-vix').textContent).toMatch(/10 \/ 10/)
    expect(getByTestId('delta-vix').textContent).toMatch(/\+6/)
  })

  it('marks an absent component as dropped from the ratio, not as zero', () => {
    mockData.current = {
      ok: true, date: '2026-08-28', total: 80, min_weight_met: true,
      components: [
        { key: 'cboe_putcall', label: 'CBOE put/call (contrarian)', weight: 10, points: 0, max_points: 10, present: false, value: null },
      ],
      prev: null,
    }
    const { getByTestId } = render(<ScoreAttributionView rows={[row]} rowIdx={0} currentRow={row} options={{}} />)
    expect(getByTestId('component-cboe_putcall').textContent).toMatch(/not reported/i)
  })

  it('says so when the session was never recorded', () => {
    mockData.current = { ok: false, date: '2026-08-28', reason: 'no stored session for that date' }
    const { getByTestId } = render(<ScoreAttributionView rows={[row]} rowIdx={0} currentRow={row} options={{}} />)
    expect(getByTestId('attribution-unavailable').textContent).toMatch(/no stored session/i)
  })
})
