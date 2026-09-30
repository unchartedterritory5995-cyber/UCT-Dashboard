// TERM-055 — the split label: says only what the adjustment-basis endpoint knows.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import AdjustmentLabel, { adjustmentText } from './AdjustmentLabel'

let body
beforeEach(() => {
  body = null
  global.fetch = vi.fn(() => Promise.resolve({ ok: body !== undefined, json: () => Promise.resolve(body) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderLabel = (props) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <AdjustmentLabel {...props} />
  </SWRConfig>,
)
const basis = (b) => ({ adjustment_basis: { splits: null, dividends: null, as_of: null, applied_by: null, ...b } })

describe('AdjustmentLabel (TERM-055)', () => {
  it('a vendor-adjusted split names its date and its source, and never mentions dividends', async () => {
    body = basis({ splits: true, as_of: '2024-06-10', applied_by: 'vendor' })
    renderLabel({ sym: 'nvda', tf: 'D' })
    const el = await screen.findByTestId('adjustment-label')
    expect(el.textContent).toBe('Split-adjusted · last split 2024-06-10')
    expect(el.getAttribute('title')).toBe('Prices are split-adjusted through the 2024-06-10 split, by the data vendor.')
    expect(el.getAttribute('title')).not.toMatch(/dividend/i)
  })

  it('a split UCT repaired says UCT did it', () => {
    const t = adjustmentText({ splits: true, as_of: '2025-01-02', applied_by: 'bars_sanitize' })
    expect(t.full).toMatch(/by UCT \(the vendor.s bars were not adjusted\)/)
  })

  it('no split on record, undetermined, and a failed request all render nothing', async () => {
    for (const b of [basis({ splits: false, applied_by: 'vendor' }), basis({}), undefined]) {
      body = b
      const { unmount } = renderLabel({ sym: 'AAPL', tf: 'D' })
      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      expect(screen.queryByTestId('adjustment-label')).toBeNull()
      unmount()
      global.fetch.mockClear()
    }
  })

  it('an intraday chart or an index symbol does not ask at all', () => {
    renderLabel({ sym: 'NVDA', tf: '5' })
    renderLabel({ sym: '$IDX:AI', tf: 'D' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
