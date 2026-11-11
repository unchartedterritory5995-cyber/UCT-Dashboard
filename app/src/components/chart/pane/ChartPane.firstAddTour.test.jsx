// ⭐ UCT RS Phase 4, 4-11 — Chart Settings → Indicators' first add reaches the chart's tour.
//
// The settings modal is a SIBLING of `<StockChart>` (ChartPane renders both), so its first
// add of a toured definition (`onIndicatorFirstAdd`, ChartSettingsIndicators `onFirstAdd`)
// travels through the toolbar API StockChart publishes (`indicatorFirstAdd`, the same
// handler the library's `onFirstAdd` reaches). ⛔ HELD UNTIL THE MODAL CLOSES: the door's
// own flow keeps the modal open on the new row's Inspector, and the tour must not open
// hidden behind it; the moment the member closes Chart Settings, the chart gets it, once.
import { render, act } from '@testing-library/react'
import { createRef } from 'react'
import { vi, test, expect, beforeEach } from 'vitest'

const seen = vi.hoisted(() => ({ modal: null, firstAdd: null }))
vi.mock('../../StockChart', () => ({
  default: (props) => {
    if (props.toolbarApiRef) props.toolbarApiRef.current = { indicatorFirstAdd: seen.firstAdd }
    return <div data-testid="chart" />
  },
}))
vi.mock('../SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((_p, ref) => { useImperativeHandle(ref, () => ({ openWith: () => {} })); return <span /> }) }
})
vi.mock('../ChartSettingsModal', () => ({ default: (props) => { seen.modal = props; return null } }))
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

beforeEach(() => { seen.modal = null; seen.firstAdd = vi.fn() })

function mount() {
  const ref = createRef()
  render(<ChartPane ref={ref} sym="NVDA" tf="D" chartId="w1" stored={null} onStore={() => {}} />)
  return ref
}

test('the modal is handed the first-add door', () => {
  mount()
  expect(typeof seen.modal.onIndicatorFirstAdd).toBe('function')
})

test('a first add made in Chart Settings opens the tour only once the modal closes, and only once', () => {
  const ref = mount()
  act(() => ref.current.openSettings('add'))
  expect(seen.modal.open).toBe(true)
  act(() => seen.modal.onIndicatorFirstAdd('rsLine'))
  expect(seen.firstAdd, 'never under the open modal').not.toHaveBeenCalled()
  act(() => seen.modal.onClose())
  expect(seen.modal.open).toBe(false)
  expect(seen.firstAdd).toHaveBeenCalledTimes(1)
  expect(seen.firstAdd).toHaveBeenCalledWith('rsLine')
  // reopening and closing with no add hands nothing over again
  act(() => ref.current.openSettings())
  act(() => seen.modal.onClose())
  expect(seen.firstAdd).toHaveBeenCalledTimes(1)
})

test('a session with no first add hands nothing to the chart', () => {
  const ref = mount()
  act(() => ref.current.openSettings('add'))
  act(() => seen.modal.onClose())
  expect(seen.firstAdd).not.toHaveBeenCalled()
})
