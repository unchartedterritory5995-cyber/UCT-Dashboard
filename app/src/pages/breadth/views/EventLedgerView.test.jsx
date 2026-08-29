import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import EventLedgerView from './EventLedgerView'

const base = { advancing: 2000, declining: 2000, up_vol_ratio: 1.0, mcclellan_osc: 0,
               hvc_52w: 5, atr_ext_7: 5, new_52w_lows: 10, is_ftd: 0 }
const rows = Array.from({ length: 40 }, (_, i) => ({
  ...base, date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  ...(i === 0 ? { up_vol_ratio: 9.5 } : {}),
}))

describe('EventLedgerView', () => {
  it('shows an event that fired today', () => {
    const { getByTestId } = render(<EventLedgerView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{}} />)
    expect(getByTestId('event-vol90up').textContent).toMatch(/today/i)
  })

  it('says how far back it looked when an event never fired', () => {
    const { getByTestId } = render(<EventLedgerView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{}} />)
    expect(getByTestId('event-ftd').textContent).toMatch(/not in the last 40 sessions/i)
  })

  it('shows the reason an event could not be evaluated', () => {
    const blind = rows.map(r => ({ ...r, advancing: null, declining: null }))
    const { getByTestId } = render(<EventLedgerView rows={blind} rowIdx={0} currentRow={blind[0]}
      onDrill={() => {}} options={{}} />)
    expect(getByTestId('event-zweig').textContent).toMatch(/advance\/decline counts cover 0/i)
  })
})
