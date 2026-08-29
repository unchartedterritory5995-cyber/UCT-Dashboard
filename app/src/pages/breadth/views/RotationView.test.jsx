import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import RotationView from './RotationView'

// Newest-first: rsp/spy rising over the window = broadening.
const rows = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  rsp_spy_ratio: 0.70 - i * 0.002,
  iwm_qqq_ratio: 0.50 + i * 0.002,
  vix: 16, vxn: 21,
}))

describe('RotationView', () => {
  it('calls a rising equal-weight ratio broadening', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('verdict-rsp_spy_ratio').textContent).toMatch(/broadening/i)
  })

  it('calls a falling ratio narrowing', () => {
    const { getByTestId } = render(<RotationView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('verdict-iwm_qqq_ratio').textContent).toMatch(/narrowing/i)
  })

  it('marks a series absent rather than drawing it as zero', () => {
    const noVxn = rows.map(r => ({ ...r, vxn: null }))
    const { getByTestId } = render(<RotationView rows={noVxn} rowIdx={0} currentRow={noVxn[0]}
      onDrill={() => {}} options={{ lookback: 20 }} />)
    expect(getByTestId('verdict-vol_spread').textContent).toMatch(/not reported/i)
  })
})
