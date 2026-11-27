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
const lakeJoined = vi.fn(() => Promise.resolve(false))
vi.mock('../../../data/barStore/prefetch', async (orig) => ({ ...(await orig()), warmTypedSymbol: (...a) => storeWarm(...a), lakeJoined: (...a) => lakeJoined(...a) }))
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
  expect(storeWarm).toHaveBeenCalledWith('AMD', 'D', { alsoTfs: null })
  expect(host).toHaveBeenCalledWith('AMD')
  expect(host).toHaveBeenCalledTimes(1)
  expect(legacyWarm).not.toHaveBeenCalled()
})

// (review of #2624, section 2c) THE ORDER IS LOAD-BEARING: the chart's own warm hydrates the typing chart's key
// synchronously (it creates the entry), so the host's prime finds it held and skips a second hydrate (prefetch
// deviceWarm). Reversed, that key would be hydrated twice: two pairs of IndexedDB reads per settled text.
test('ORDER: the chart\'s own typed warm runs first, the host is told after it', () => {
  const seq = []
  storeWarm.mockImplementation(() => { seq.push('warm') })
  const host = vi.fn(() => { seq.push('host') })
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} onTypedIntent={host} />)
  chartSearch().onTypedIntent('AMD')
  expect(seq).toEqual(['warm', 'host'])
  storeWarm.mockReset()
})

test('a host that throws never breaks the chart\'s own warm; a pane with no host warms exactly as before', () => {
  const host = vi.fn(() => { throw new Error('host') })
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} onTypedIntent={host} />)
  expect(() => chartSearch().onTypedIntent('AMD')).not.toThrow()
  expect(host).toHaveBeenCalledTimes(1)
  expect(storeWarm).toHaveBeenCalledWith('AMD', 'D', { alsoTfs: null })
  cleanup(); search.props.length = 0; storeWarm.mockClear()
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} />)
  expect(() => chartSearch().onTypedIntent('AMD')).not.toThrow()
  expect(storeWarm).toHaveBeenCalledWith('AMD', 'D', { alsoTfs: null })
})

// (review of #2624, 2d) the host's linked timeframes ride the chart's own warm: it tells the columns lane about each of
// them once the text is a ticker (data/barStore/prefetch _tellTyped)
test('the host\'s linked timeframes (typedIntentTfs) go into the chart\'s own typed warm, as its alsoTfs', () => {
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} onTypedIntent={vi.fn()} typedIntentTfs={['30', 'D']} />)
  chartSearch().onTypedIntent('AMD')
  expect(storeWarm).toHaveBeenCalledWith('AMD', 'D', { alsoTfs: ['30', 'D'] })
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

// ⭐ (2026-11-26, typed vs arrow) THE TYPED TICKER'S FRAME IS PREPARED LIKE A LIST'S NEXT ROW. Once the chart's own typed
// warm has settled (its bars are in the store), the pane names the typed ticker as the NEXT symbol of the chart it shows
// (neighborFrames.publishTypedNext): every chart on that symbol prepares the typed ticker's derived frame in idle time
// (useNeighborFrames), so Enter finds it instead of deriving it inside the key task. Only the newest text; never a prefix.
test('after the typed warm settles, the typed ticker is the next symbol of the chart\'s current symbol', async () => {
  const nf = await import('../neighborFrames')
  nf.__setNeighborFramesForTests(true)
  nf.__resetScanForTests()
  let done
  storeWarm.mockImplementation(() => new Promise((r) => { done = r }))
  render(<ChartPane sym="NVDA" tf="5" onTfChange={() => {}} onSymbolChange={vi.fn()} onTypedIntent={vi.fn()} />)
  chartSearch().onTypedIntent('AMD')
  expect(nf.scanNeighborsFor('NVDA')).toEqual([])                   // not before its bars are in
  done('cache')
  await new Promise((r) => setTimeout(r, 0))
  expect(nf.scanNeighborsFor('NVDA')).toEqual(['AMD'])
  storeWarm.mockReset()
  nf.__setNeighborFramesForTests(null)
})

test('a held ticker (the warm has nothing to do: null) is named at once; a prefix ("unknown") and older text never are', async () => {
  const nf = await import('../neighborFrames')
  nf.__setNeighborFramesForTests(true)
  nf.__resetScanForTests()
  render(<ChartPane sym="NVDA" tf="5" onTfChange={() => {}} onSymbolChange={vi.fn()} onTypedIntent={vi.fn()} />)
  storeWarm.mockImplementation(() => null)
  chartSearch().onTypedIntent('AMD')
  await new Promise((r) => setTimeout(r, 0))
  expect(nf.scanNeighborsFor('NVDA')).toEqual(['AMD'])
  storeWarm.mockImplementation(() => Promise.resolve('unknown'))
  chartSearch().onTypedIntent('AM')
  await new Promise((r) => setTimeout(r, 0))
  expect(nf.scanNeighborsFor('NVDA')).toEqual([])                   // the prefix cleared it, named nothing
  let slow
  storeWarm.mockImplementation(() => new Promise((r) => { slow = r }))
  chartSearch().onTypedIntent('AMDL')
  storeWarm.mockImplementation(() => Promise.resolve('network'))
  chartSearch().onTypedIntent('AMZN')
  await new Promise((r) => setTimeout(r, 0))
  slow('cache')                                                     // the older text's warm lands last
  await new Promise((r) => setTimeout(r, 0))
  expect(nf.scanNeighborsFor('NVDA')).toEqual(['AMZN'])
  storeWarm.mockReset()
  nf.__setNeighborFramesForTests(null)
})

// (review of #2868) ...ONLY AFTER THE WARM'S LAKE JOIN: the join lands a new rows array, and a frame prepared on the array
// before it is filed under rows Enter no longer reads. And never for a chart that moved to another symbol meanwhile.
test('the typed ticker is named only once its lake join has landed', async () => {
  const nf = await import('../neighborFrames')
  nf.__setNeighborFramesForTests(true)
  nf.__resetScanForTests()
  let joined
  lakeJoined.mockImplementation(() => new Promise((r) => { joined = r }))
  storeWarm.mockImplementation(() => Promise.resolve('cache'))
  render(<ChartPane sym="NVDA" tf="5" onTfChange={() => {}} onSymbolChange={vi.fn()} onTypedIntent={vi.fn()} />)
  chartSearch().onTypedIntent('AMD')
  await new Promise((r) => setTimeout(r, 0))
  expect(lakeJoined).toHaveBeenCalledWith('AMD', '5')
  expect(nf.scanNeighborsFor('NVDA')).toEqual([])                   // the warm settled, its join has not
  joined(true)
  await new Promise((r) => setTimeout(r, 0))
  expect(nf.scanNeighborsFor('NVDA')).toEqual(['AMD'])
  storeWarm.mockReset(); lakeJoined.mockReset(); lakeJoined.mockImplementation(() => Promise.resolve(false))
  nf.__setNeighborFramesForTests(null)
})

test('nothing is named for a chart that moved to another symbol before the join landed', async () => {
  const nf = await import('../neighborFrames')
  nf.__setNeighborFramesForTests(true)
  nf.__resetScanForTests()
  let joined
  lakeJoined.mockImplementation(() => new Promise((r) => { joined = r }))
  storeWarm.mockImplementation(() => Promise.resolve('cache'))
  const view = render(<ChartPane sym="NVDA" tf="5" onTfChange={() => {}} onSymbolChange={vi.fn()} onTypedIntent={vi.fn()} />)
  chartSearch().onTypedIntent('AMD')
  await new Promise((r) => setTimeout(r, 0))
  view.rerender(<ChartPane sym="TSLA" tf="5" onTfChange={() => {}} onSymbolChange={vi.fn()} onTypedIntent={vi.fn()} />)
  joined(true)
  await new Promise((r) => setTimeout(r, 0))
  expect(nf.scanNeighborsFor('NVDA')).toEqual([])
  expect(nf.scanNeighborsFor('TSLA')).toEqual([])
  storeWarm.mockReset(); lakeJoined.mockReset(); lakeJoined.mockImplementation(() => Promise.resolve(false))
  nf.__setNeighborFramesForTests(null)
})
