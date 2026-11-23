// ⭐ (2026-11-23, the typed ticker) THE PANE HANDS ITS HOST THE SETTLED TYPED TEXT. The symbol search tells the pane
// what is being typed once the text holds still (SymbolSearch TYPED_INTENT_SETTLE_MS); the pane runs its chart's own
// typed warm, as before, and now also tells its HOST (`onTypedIntent`): on /charts, ChartWidget starts the linked
// group's device reads then (typedIntentPrime.js), so Enter finds the copies in. A host that throws never breaks the
// pane's own warm; a pane with no host warms exactly as before.
// ⭐ AND THE ENTER PATH STAYS AS IT IS (pinned here): the host's onSymbolChange runs SYNCHRONOUSLY in the key handler
// (so the board's same-task decision applies), and only the refocus of the chart waits a frame.
import { render, screen, cleanup } from '@testing-library/react'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'

const search = { props: [] }
vi.mock('../SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((p, ref) => { search.props.push(p); useImperativeHandle(ref, () => ({ openWith: () => {} })); return <span /> }) }
})
const storeWarm = vi.fn()
const legacyWarm = vi.fn()
vi.mock('../../../data/barStore/prefetch', async (orig) => ({ ...(await orig()), warmTypedSymbol: (...a) => storeWarm(...a) }))
vi.mock('../../../utils/prefetchBars', async (orig) => ({ ...(await orig()), warmTypedSymbol: (...a) => legacyWarm(...a) }))
vi.mock('../barStoreSwitch', () => ({ BARSTORE: true }))
vi.mock('../../StockChart', () => ({ default: () => <div data-testid="chart" /> }))
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

/** The chart's own symbol search: the one handed a typed-intent callback. */
const chartSearch = () => [...search.props].reverse().find((p) => typeof p.onTypedIntent === 'function')
const region = () => screen.getByRole('region', { name: /NVDA/ })

beforeEach(() => { search.props.length = 0; storeWarm.mockClear(); legacyWarm.mockClear() })
afterEach(() => { cleanup() })

test('the settled typed text reaches the host, beside the chart\'s own typed warm (same text, the pane\'s timeframe)', () => {
  const host = vi.fn()
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} onTypedIntent={host} />)
  chartSearch().onTypedIntent('AMD')
  expect(storeWarm).toHaveBeenCalledWith('AMD', 'D')
  expect(host).toHaveBeenCalledWith('AMD')
  expect(host).toHaveBeenCalledTimes(1)
  expect(legacyWarm).not.toHaveBeenCalled()
})

test('a host that throws never breaks the chart\'s own warm; a pane with no host warms exactly as before', () => {
  const host = vi.fn(() => { throw new Error('host') })
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} onTypedIntent={host} />)
  expect(() => chartSearch().onTypedIntent('AMD')).not.toThrow()
  expect(host).toHaveBeenCalledTimes(1)
  expect(storeWarm).toHaveBeenCalledWith('AMD', 'D')
  cleanup(); search.props.length = 0; storeWarm.mockClear()
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} />)
  expect(() => chartSearch().onTypedIntent('AMD')).not.toThrow()
  expect(storeWarm).toHaveBeenCalledWith('AMD', 'D')
})

test('PIN: Enter hands the host the symbol synchronously; only the chart\'s refocus waits a frame', async () => {
  const onSymbolChange = vi.fn()
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={onSymbolChange} />)
  chartSearch().onSymbolChange('AMD')
  expect(onSymbolChange).toHaveBeenCalledWith('AMD')                 // in the key handler, before anything is awaited
  expect(document.activeElement).not.toBe(region())
  await new Promise((r) => requestAnimationFrame(() => r()))
  expect(document.activeElement).toBe(region())
})
