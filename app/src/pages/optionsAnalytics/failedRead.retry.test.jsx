// Completeness audit 2026-10-07, ERROR/RETRY gap 1: every options panel that reads through
// `useDarkSection` (IVH, VOL, POS, OHIS, TIDE, STRS, OSCR, OBT) said "unavailable right now" with
// no way to ask again, because the hook exposed no refetch. The hook now returns `retry` (SWR's
// mutate) and every failed branch is the shared error block (PanelState) with a Retry.
//
// Each case: the read answers 500 once (not a transient status, so the fetcher's one warm retry
// does not fire), the failure is shown with a Retry, and clicking it asks the SAME url again —
// the second answer clears the failure.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import IvHistoryPanel from '../research/tabs/IvHistoryPanel'
import { VolStatsPanel, IvRankBadge, OptionMonitorStrip } from './VolPanels'
import PositioningPanel from './PositioningPanel'
import OptionsHistoryPanel from './OptionsHistoryPanel'
import MarketTidePanel from './MarketTidePanel'
import StrategyScreensPanel from './StrategyScreensPanel'
import OptionsScreener from '../screener/options/OptionsScreener'
import BacktestPanel from '../research/tabs/BacktestPanel'

const res = (status, body = {}) => Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) })

/** `fail` matches a url (substring) that answers 500 the first time and `after` the next; every
 *  other url answers `rest(u)` (default 404 = the switch is off, so that section renders nothing). */
function stub(fail, after = [404, {}], rest = () => [404, {}]) {
  const seen = { n: 0 }
  vi.stubGlobal('fetch', vi.fn((u, init) => {
    if (typeof u === 'string' && u.includes(fail) && (!init || !init.method || init.method === 'GET')) {
      seen.n += 1
      return seen.n === 1 ? res(500) : res(...after)
    }
    return res(...rest(u, init))
  }))
  return seen
}

const mount = (el) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{el}</SWRConfig>,
)

async function retryClears(seen, sentence) {
  const block = await screen.findByText(sentence)
  const state = block.closest('[data-kind="error"]')
  expect(state, 'the failure is the shared error block').toBeTruthy()
  expect(seen.n).toBe(1)
  fireEvent.click(within(state).getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(seen.n).toBe(2))
  await waitFor(() => expect(screen.queryByText(sentence)).toBeNull())
}

describe('useDarkSection panels: a failed read carries a Retry that asks again', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('IVH: the IV history', async () => {
    const seen = stub('/api/research/iv-history/TST')
    mount(<IvHistoryPanel sym="tst" offNotice />)
    await retryClears(seen, 'The IV history is unavailable right now. That does not mean TST has none.')
  })

  it('VOL: the volatility stats (one Retry re-asks the failed read)', async () => {
    const seen = stub('/vol/TST/realized')
    mount(<VolStatsPanel sym="TST" offNotice />)
    await retryClears(seen, 'A volatility read failed. A line marked unavailable is a failed read, not a value.')
  })

  it('VOL: the IV-rank badge', async () => {
    const seenRank = stub('/vol/TST/iv-rank')
    mount(<IvRankBadge sym="TST" />)
    await screen.findByTestId('iv-rank-badge-failed')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(seenRank.n).toBe(2))
  })

  it('VOL: the option monitor strip', async () => {
    const seen = stub('/options/TST/monitor')
    mount(<OptionMonitorStrip sym="TST" />)
    await retryClears(seen, 'The option monitor is unavailable right now.')
  })

  it('POS: a positioning block', async () => {
    const seen = stub('/positioning/TST/levels')
    mount(<PositioningPanel sym="TST" />)
    await retryClears(seen, 'The positioning levels is unavailable right now. That is a failed read, not an empty one.')
  })

  it('OHIS: a history block', async () => {
    const seen = stub('/options-history/TST/straddle')
    mount(<OptionsHistoryPanel sym="TST" />)
    await retryClears(seen, 'The straddle history is unavailable right now.')
  })

  it('TIDE: the tide itself', async () => {
    const seen = stub('/api/options/market-tide?scope=all')
    mount(<MarketTidePanel />)
    await retryClears(seen, 'Market Tide is unavailable right now. That does not mean the tape is quiet.')
  })

  it('TIDE: the sector tide', async () => {
    const seen = stub('/market-tide/sectors?scope=all')
    mount(<MarketTidePanel />)
    await retryClears(seen, 'The sector tide is unavailable right now. That does not mean the tape is quiet.')
  })

  it('STRS: the strategy catalog', async () => {
    const seen = stub('/api/options-screener/strategies')
    mount(<StrategyScreensPanel />)
    await retryClears(seen, 'The strategy screen is unavailable right now. That is not "nothing matched".')
  })

  it('STRS: Sizzle', async () => {
    const seen = stub('/api/options-screener/sizzle')
    mount(<StrategyScreensPanel />)
    await retryClears(seen, 'Sizzle is unavailable right now. That is not "no unusual volume".')
  })

  it('OSCR: the screen', async () => {
    const seen = stub('/api/options-screener/screen')
    mount(<OptionsScreener />)
    await retryClears(seen, 'The option screener is unavailable right now. That does not mean there is nothing to show.')
  })

  it('OBT: a failed strategy catalog is said, never a silent fall-back to the first slice', async () => {
    const seen = stub('/backtest-catalog')
    mount(<BacktestPanel sym="TST" />)
    await retryClears(seen, 'The full strategy list could not be read right now, so only the first set of strategies is offered.')
  })

  it('OBT: a failed result poll carries a Retry', async () => {
    const seen = stub('/backtest/j1', [200, { job: 'j1', state: 'failed', error: 'The run failed: no data.' }],
      (u, init) => (init?.method === 'POST' ? [200, { job: 'j1', state: 'queued' }] : [404, {}]))
    mount(<BacktestPanel sym="TST" />)
    fireEvent.click(screen.getByTestId('backtest-simulate'))
    const sentence = 'The backtest result is unavailable right now.'
    const block = await screen.findByText(sentence)
    fireEvent.click(within(block.closest('[data-kind="error"]')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(seen.n).toBe(2))
    expect(await screen.findByText('The run failed: no data.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(sentence)).toBeNull())
  })
})
