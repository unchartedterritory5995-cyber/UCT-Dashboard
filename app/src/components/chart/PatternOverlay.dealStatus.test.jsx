// Deal status (DEAL_STATUS_ENABLED): a stock pending acquisition gets NO drawings from the server and
// the overlay shows one line saying why. Asserted by RENDERED TEXT. And the hook surfaces the marker
// only when the server sent one. Synthetic prices.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import PatternOverlay, { DEAL_STATUS_LABEL } from './PatternOverlay'
import { usePatternDetections } from '../../hooks/usePatternDetections'

const chart = {
  timeScale: () => ({
    timeToCoordinate: () => 10,
    subscribeVisibleTimeRangeChange: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleTimeRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    options: () => ({ barSpacing: 8 }),
  }),
}
const series = { priceToCoordinate: (p) => 1000 - p * 10 }
const containerRef = { current: { clientWidth: 800, clientHeight: 400 } }
const SERVER_LABEL = 'Pending acquisition — pattern drawings hidden'
const MARKER = { pending: true, label: SERVER_LABEL, source: ['news'], since: '2026-06-25', price: 72.5, confidence: 0.9 }

const draw = (props) => render(
  <PatternOverlay chart={chart} series={series} containerRef={containerRef} tf="D"
    detections={[]} enabled={true} {...props} />,
)

describe('PatternOverlay: pending acquisition', () => {
  it('shows the server label and draws nothing', () => {
    const { getByRole, container } = draw({ dealStatus: MARKER })
    expect(getByRole('status').textContent).toBe(SERVER_LABEL)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('falls back to its own label when the payload carries none', () => {
    const { getByRole } = draw({ dealStatus: { pending: true } })
    expect(getByRole('status').textContent).toBe(DEAL_STATUS_LABEL)
  })

  it('shows nothing while the overlay is disabled', () => {
    const { queryByTestId } = draw({ dealStatus: MARKER, enabled: false })
    expect(queryByTestId('pattern-deal-status')).toBeNull()
  })

  it('without a marker renders exactly as before (nothing for no detections)', () => {
    const { container } = draw({})
    expect(container.innerHTML).toBe('')
  })
})

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)
afterEach(() => { vi.unstubAllGlobals() })

describe('usePatternDetections: dealStatus', () => {
  it('returns the marker when the server sent one', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ detections: [], count: 0, deal_status: MARKER }),
    })))
    const { result } = renderHook(
      () => usePatternDetections('ZZZ', 'D', true, 50, { includeStructures: true }), { wrapper },
    )
    await waitFor(() => expect(result.current.dealStatus).not.toBeNull())
    expect(result.current.dealStatus.label).toBe(SERVER_LABEL)
  })

  it('is null when the response carries none', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ detections: [], count: 0 }),
    })))
    const { result } = renderHook(() => usePatternDetections('ZZZ', 'D', true, 50), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.dealStatus).toBeNull()
  })
})
