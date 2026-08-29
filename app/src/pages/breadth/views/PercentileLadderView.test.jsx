import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PercentileLadderView from './PercentileLadderView'

const mk = (key) => ({ key, label: key, group: 'G', polarity: 'bull',
                       getFmt: r => String(r[key]), getTier: () => 'g2' })
const metrics = [mk('a')]
// 24 rows because the view refuses to rank below MIN_READINGS (20). Today
// (row 0) is the max of the window → 100th percentile; a fixture where today
// sat mid-range could not tell a correct rank from a constant.
const rows = [90, ...Array.from({ length: 23 }, (_, k) => k * 3)]
  .map((a, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, a }))

describe('PercentileLadderView', () => {
  it('ranks today against its own window, not against other metrics', () => {
    const { getByTestId } = render(<PercentileLadderView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(getByTestId('pctile-a').textContent).toBe('100')
  })

  it('places the marker at the percentile position', () => {
    const { getByTestId } = render(<PercentileLadderView rows={rows} rowIdx={0} currentRow={rows[0]}
      metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(Number(getByTestId('marker-a').getAttribute('x'))).toBeCloseTo(100, 0)
  })

  it('refuses a metric with too few readings instead of inventing a rank', () => {
    const thin = [{ date: '2026-08-01', a: 5 }]
    const { getByTestId, queryByTestId } = render(<PercentileLadderView rows={thin} rowIdx={0}
      currentRow={thin[0]} metrics={metrics} onDrill={() => {}} options={{}} />)
    expect(queryByTestId('pctile-a')).toBeNull()
    expect(getByTestId('insufficient-a').textContent).toMatch(/needs 20/i)
  })
})
