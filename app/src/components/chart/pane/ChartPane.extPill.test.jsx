import { render, screen, fireEvent } from '@testing-library/react'
import { vi, test, expect, beforeEach } from 'vitest'

// The pane's Regular/Extended pill shows, and writes over, what the CHART draws: the surface's raw
// blob over the ACCOUNT's chart_settings (StockChart's own merge), not over the defaults.
const { stockChartSpy } = vi.hoisted(() => ({ stockChartSpy: vi.fn() }))
vi.mock('../../StockChart', () => ({ default: (props) => { stockChartSpy(props); return <span data-testid="chart-sym">{props.sym}</span> } }))
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
let mockPrefs = {}
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: mockPrefs, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: true, isPremarket: false, isExtended: false }) }))
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: null }) }))

import ChartPane from './ChartPane'

beforeEach(() => { mockPrefs = {}; stockChartSpy.mockClear() })

const pill = () => ({
  regular: screen.getByRole('button', { name: 'Regular Hours' }),
  extended: screen.getByRole('button', { name: 'Extended Hours' }),
})
const active = (btn) => /sessionBtnActive/.test(btn.className)

test('a partial blob on an account with extended hours off: the pill says Regular, as the chart draws', () => {
  mockPrefs = { chart_settings: { extendedHoursShading: false, background: '#123456' } }
  render(<ChartPane sym="NVDA" tf="60" stored={{ indicatorInstances: [] }} onStore={() => {}} onTfChange={() => {}} />)
  const p = pill()
  expect(active(p.regular)).toBe(true)
  expect(active(p.extended)).toBe(false)
  // the chart really is handed a blob without the key, so it draws the account's value
  expect(stockChartSpy.mock.calls.at(-1)[0].settingsOverride).toEqual({ indicatorInstances: [] })
})

test('control: the same blob on an account with it on: the pill says Extended', () => {
  mockPrefs = { chart_settings: { extendedHoursShading: true } }
  render(<ChartPane sym="NVDA" tf="60" stored={{ indicatorInstances: [] }} onStore={() => {}} onTfChange={() => {}} />)
  expect(active(pill().extended)).toBe(true)
})

test('flipping it writes over what the chart shows, so nothing else on the chart changes', () => {
  mockPrefs = { chart_settings: { extendedHoursShading: false, background: '#123456' } }
  const onStore = vi.fn()
  render(<ChartPane sym="NVDA" tf="60" stored={{ indicatorInstances: [] }} onStore={onStore} onTfChange={() => {}} />)
  fireEvent.click(pill().extended)
  const written = onStore.mock.calls.at(-1)[0]
  expect(written.extendedHoursShading).toBe(true)
  expect(written.background).toBe('#123456')          // the account's background, not the default one
})
