// TickerPopup anchorDate contract (spec 2026-08-11): the popup forwards the
// anchor into ChartPane's stockChartProps with a Back-to-today pill wired to
// un-anchor; reopening restores the anchor. anchorDate=null forwards nothing.
//
// Providers + mock idiom: copied from TickerPopup.test.jsx (renderWithProviders
// wraps AuthProvider/VoiceProvider/MemoryRouter, which is what TickerPopup's
// useFlagged/useTickerTags/useTickerHub/useRealtimePrices need to not throw)
// plus the prefetchBars mock that test file uses to suppress SWR side effects
// from the trigger's onClick/onMouseEnter. ChartPane itself is mocked here
// (rather than its child StockChart, as TickerPopup.test.jsx does) so the
// `stockChartProps` spread TickerPopup hands it can be inspected directly.
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, act } from '@testing-library/react'
import { renderWithProviders, screen } from '../test-utils'

vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(),
  prefetchBars: vi.fn(),
  prefetchBar: vi.fn(),
  default: vi.fn(),
}))

const paneProps = vi.fn()
vi.mock('./chart/pane/ChartPane', () => ({
  default: (props) => { paneProps(props); return <div data-testid="pane-stub" /> },
}))

import TickerPopup from './TickerPopup'

const lastPane = () => paneProps.mock.calls.at(-1)[0]

describe('TickerPopup anchorDate', () => {
  it('forwards anchorDate + Back-to-today wiring into stockChartProps', async () => {
    renderWithProviders(<TickerPopup sym="NVDA" anchorDate="2026-02-11">NVDA</TickerPopup>)
    fireEvent.click(screen.getByText('NVDA'))
    await screen.findByTestId('pane-stub')
    const scp = lastPane().stockChartProps
    expect(scp.anchorDate).toBe('2026-02-11')
    expect(scp.exitReplayLabel).toBe('⟲ Back to today')
    expect(typeof scp.onExitReplay).toBe('function')
  })

  it('onExitReplay un-anchors; closing + reopening re-anchors', async () => {
    renderWithProviders(<TickerPopup sym="NVDA" anchorDate="2026-02-11">NVDA</TickerPopup>)
    fireEvent.click(screen.getByText('NVDA'))
    await screen.findByTestId('pane-stub')
    act(() => { lastPane().stockChartProps.onExitReplay() })
    expect(lastPane().stockChartProps.anchorDate).toBeUndefined()
    // close via the component's actual close affordance (overlay click — see
    // TickerPopup.test.jsx's "closes modal on overlay click"; Escape is ALSO
    // wired in TickerPopup.jsx's keydown handler, so either drives closeModal)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByText('NVDA'))
    await screen.findByTestId('pane-stub')
    expect(lastPane().stockChartProps.anchorDate).toBe('2026-02-11')
  })

  it('anchorDate absent -> no anchor keys in stockChartProps (existing surfaces untouched)', async () => {
    renderWithProviders(<TickerPopup sym="NVDA">NVDA</TickerPopup>)
    fireEvent.click(screen.getByText('NVDA'))
    await screen.findByTestId('pane-stub')
    const scp = lastPane().stockChartProps
    expect('anchorDate' in scp).toBe(false)
    expect('onExitReplay' in scp).toBe(false)
  })
})
