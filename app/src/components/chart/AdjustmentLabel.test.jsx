// TERM-055 — the split label: says only what the adjustment-basis endpoint knows.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
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

  it('an index symbol or an unsupported timeframe does not ask at all', () => {
    renderLabel({ sym: '$IDX:AI', tf: 'D' })
    renderLabel({ sym: 'NVDA', tf: '240' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  // ── TERM-055 remainder: the intraday split detector reaches the label ──
  it('an intraday chart asks, and a split the series shows as a cliff is said out loud', async () => {
    body = basis({ splits: false, as_of: '2024-06-10', unadjusted_split_at: '2024-06-10' })
    renderLabel({ sym: 'NVDA', tf: '5' })
    const el = await screen.findByTestId('adjustment-label')
    expect(global.fetch.mock.calls[0][0]).toBe('/api/adjustment-basis/NVDA?tf=5')
    expect(el.textContent).toBe('Not split-adjusted · cliff at 2024-06-10')
    expect(el.getAttribute('title')).toMatch(/NOT split-adjusted: the 2024-06-10 split shows as a price jump at 2024-06-10/)
  })

  it('splits=false WITHOUT a cliff (no split on record) still renders nothing', () => {
    expect(adjustmentText({ splits: false, as_of: null, applied_by: 'vendor', unadjusted_split_at: null })).toBeNull()
    expect(adjustmentText({ splits: null, unadjusted_split_at: null })).toBeNull()
  })

  // ── TERM-055 raw view: dark behind RAW_PRICE_VIEW_ENABLED ──
  it('gate OFF (no raw_view key): no toggle, the label renders alone', async () => {
    body = basis({ splits: true, as_of: '2024-06-10', applied_by: 'vendor' })
    renderLabel({ sym: 'NVDA', tf: 'D' })
    await screen.findByTestId('adjustment-label')
    expect(screen.queryByTestId('raw-toggle')).toBeNull()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('gate ON: the toggle opens the as-traded closes beside the adjusted ones', async () => {
    body = { ...basis({ splits: true, as_of: '2024-06-10', applied_by: 'vendor' }), raw_view: true }
    renderLabel({ sym: 'NVDA', tf: 'D' })
    const toggle = await screen.findByTestId('raw-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    body = {
      available: true,
      rows: [
        { t: '2024-06-07', raw: { c: 1208.88 }, adjusted: { c: 120.888 }, factor: 10 },
        { t: '2024-06-10', raw: { c: 121.79 }, adjusted: { c: 121.79 }, factor: 1 },
      ],
    }
    fireEvent.click(toggle)
    const rows = await screen.findAllByTestId('raw-row')
    expect(global.fetch.mock.calls.at(-1)[0]).toBe('/api/adjustment-basis/NVDA/raw?around=2024-06-10')
    expect(rows.map((r) => r.textContent)).toEqual([
      '2024-06-07$1208.88$120.8910',
      '2024-06-10$121.79$121.791',
    ])
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })
})
