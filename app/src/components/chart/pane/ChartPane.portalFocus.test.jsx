// ⭐ a11y gate §12.2 (2026-11-08) — a click inside a PORTALLED popover does not move
// focus to the chart region. React bubbles portal clicks through the React tree, so
// the region's click-to-focus (type-to-search) used to fire for a click in the chip
// menu, its cards or the RS tour, and keyboard focus left the popover. A click on
// the chart itself still focuses the region.
import { render, screen, fireEvent } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { vi, test, expect } from 'vitest'

vi.mock('../../StockChart', () => ({
  default: () => (
    <div data-testid="chart">
      <canvas data-testid="canvas" />
      {createPortal(<div role="menu" data-testid="popover"><button type="button">Next</button></div>, document.body)}
    </div>
  ),
}))
vi.mock('../SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((_p, ref) => { useImperativeHandle(ref, () => ({ openWith: () => {} })); return <span /> }) }
})
vi.mock('../ChartSettingsModal', () => ({ default: () => null }))
vi.mock('../../../pages/charts/widgets/ChartMarketClock', () => ({ default: () => <span /> }))
vi.mock('../../../pages/charts/widgets/ChartDayGain', () => ({ default: () => <span /> }))
vi.mock('../../../pages/charts/widgets/TimeframeMenu', () => ({ default: () => <div /> }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: 'post' }) }))

import ChartPane from './ChartPane'

const region = () => screen.getByRole('region', { name: /NVDA/ })

test('a click inside a popover rendered through a portal does not move focus to the chart', () => {
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} />)
  const btn = screen.getByRole('button', { name: 'Next' })
  expect(region().contains(btn), 'the popover is portalled out of the region').toBe(false)
  btn.focus()
  fireEvent.click(btn)
  expect(document.activeElement, 'focus stays on the popover control').toBe(btn)
  expect(document.activeElement).not.toBe(region())
})

test('a click on the chart still focuses the chart region', () => {
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} />)
  expect(document.activeElement).not.toBe(region())
  fireEvent.click(screen.getByTestId('canvas'))
  expect(document.activeElement).toBe(region())
})
