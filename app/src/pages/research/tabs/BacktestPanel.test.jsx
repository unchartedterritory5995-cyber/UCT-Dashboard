// BRK-01 increment 4 -- the options strategy backtester panel, asserted on rendered text.
// The payloads are RECORDED from the backend (backtestFixtures.json, see its _readme); no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BacktestPanel from './BacktestPanel'
import OptionsChainTab from './OptionsChainTab'
import FX from './backtestFixtures.json'
import { summaryFacts, legsLabel, excludedText, money } from './optionBacktest'

const CHAIN = {
  ticker: 'SPY', expiration: '2026-10-23', spot: 764.2, cache_seconds: 60,
  calls: [{ strike: 760, bid: 21.1, ask: 21.4, iv: 0.1462 }], puts: [{ strike: 760, bid: 17.0, ask: 17.3, iv: 0.151 }],
}

let result
let postStatus
let postBody
let polls
beforeEach(() => {
  result = FX.full
  postStatus = 202
  postBody = null
  polls = 0
  global.fetch = vi.fn((url, init) => {
    const u = String(url)
    const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
    if (u.endsWith('/backtest') && init?.method === 'POST') {
      postBody = JSON.parse(init.body)
      if (postStatus !== 202) return json(postStatus, { detail: 'At most 6 new backtests per hour. Try again in 12 min.' })
      return json(202, { job: 'j1', state: 'queued', budget_text: 'At most 400 vendor requests per run.' })
    }
    if (u.includes('/backtest/j1')) {
      polls += 1
      return json(200, { job: 'j1', state: 'done', result })
    }
    if (u.includes('/expirations')) return json(200, { expirations: ['2026-10-23'] })
    if (u.includes('/iv-history')) return json(404, {})
    return json(200, CHAIN)
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const wrap = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>)

async function simulate() {
  fireEvent.click(screen.getByTestId('backtest-simulate'))
  return screen.findByTestId('backtest-result')
}

describe('BacktestPanel', () => {
  it('posts the rule and renders each trade with its basis, window and summary', async () => {
    wrap(<BacktestPanel sym="SPY" />)
    await simulate()
    expect(postBody).toEqual({ strategy: 'long_call', dte: 30, offset: 0, width: 0 })
    expect(screen.getByTestId('backtest-basis').textContent).toMatch(/historical simulation, not advice/)
    expect(screen.getByTestId('backtest-basis').textContent).toMatch(/One contract per leg.*mid.*before commissions/)
    expect(screen.getByTestId('backtest-window').textContent)
      .toBe('Lookback of 12 months: monthly expirations after 2025-10-02. The first simulated entry is 2025-09-05.')
    expect(screen.getByTestId('backtest-summary').textContent).toBe(summaryFacts(FX.full.summary))
    expect(screen.getByTestId('backtest-summary').textContent).toMatch(/^9 trades · Win rate 44% · .*Max drawdown -\$4,462$/)
    const rows = screen.getByTestId('backtest-trades').querySelectorAll('tbody tr')
    expect(rows.length).toBe(9)
    const t0 = FX.full.trades[0]
    expect(rows[0].textContent).toContain('2025-09-05')
    expect(rows[0].textContent).toContain(legsLabel(t0.legs))
    expect(rows[0].textContent).toContain(money(t0.debit))
    expect(rows[0].textContent).toContain('held to expiry')
  })

  it('COUNTS the excluded expirations with their reasons, never drops them', async () => {
    wrap(<BacktestPanel sym="SPY" />)
    await simulate()
    const ex = screen.getByTestId('backtest-excluded').textContent
    expect(ex).toBe(excludedText(FX.full))
    expect(ex).toMatch(/^3 expirations were excluded and not simulated/)
    expect(ex).toContain('2026-01-16: no two-sided quote for the')
  })

  it('under six trades it says the sample is too small, and shows no summary', async () => {
    result = FX.small
    wrap(<BacktestPanel sym="SPY" />)
    await simulate()
    expect(screen.getByTestId('backtest-small-sample').textContent)
      .toBe('Only 4 trades could be simulated; a sample under 6 is too small to summarise.')
    expect(screen.queryByTestId('backtest-summary')).toBeNull()
    expect(screen.getByTestId('backtest-not-run').textContent).toMatch(/not run — .*vendor request budget ran out/)
    expect(screen.getByTestId('backtest-budget').textContent).toBe('Used 10 of at most 10 vendor requests for this run.')
  })

  it('labels the IV as computed, never as the vendor\'s', async () => {
    wrap(<BacktestPanel sym="SPY" />)
    await simulate()
    expect(screen.getByText('IV (computed)')).toBeTruthy()
    expect(screen.getByTestId('backtest-iv-source').textContent).toMatch(/COMPUTED here, not the vendor's/)
    expect(screen.getByTestId('backtest-trades').querySelector('tbody tr').textContent).toContain('20.0%')
  })

  it('a spread shows both legs and sends its width', async () => {
    result = FX.spread
    wrap(<BacktestPanel sym="SPY" />)
    fireEvent.change(screen.getByLabelText('Backtest strategy'), { target: { value: 'bull_call' } })
    fireEvent.change(screen.getByLabelText('Spread width'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Entry days before expiry'), { target: { value: '14' } })
    await simulate()
    expect(postBody).toEqual({ strategy: 'bull_call', dte: 14, offset: 0, width: 2 })
    expect(screen.getByTestId('backtest-trades').querySelector('tbody tr').textContent).toMatch(/long \d+ call \/ short \d+ call/)
  })

  it('a refused start says the server\'s sentence', async () => {
    postStatus = 429
    wrap(<BacktestPanel sym="SPY" />)
    fireEvent.click(screen.getByTestId('backtest-simulate'))
    expect((await screen.findByTestId('backtest-error')).textContent).toBe('At most 6 new backtests per hour. Try again in 12 min.')
  })

  it('stops polling once the job is done', async () => {
    wrap(<BacktestPanel sym="SPY" />)
    await simulate()
    const n = polls
    await new Promise((r) => setTimeout(r, 2300))
    expect(polls).toBe(n)
  })
})

describe('OptionsChainTab with the backtester switched on', () => {
  it('renders the panel only when switched on', async () => {
    wrap(<OptionsChainTab sym="spy" />)
    await screen.findByTestId('options-chain')
    expect(screen.queryByTestId('backtest')).toBeNull()
    cleanup()
    wrap(<OptionsChainTab sym="spy" backtest />)
    await screen.findByTestId('backtest')
  })

  // The chain test "offers no trade, run or send action" asserts NO button with the panel off and
  // still passes unchanged. With it on there is exactly ONE button, and it is a simulation.
  it('its only button is Simulate -- no trade, order, send or broker action', async () => {
    wrap(<OptionsChainTab sym="spy" backtest />)
    await screen.findByTestId('backtest')
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent.trim())).toEqual(['Simulate'])
    expect(screen.queryByRole('link')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\b(buy now|place order|send to broker|execute|trade now)\b/i)
  })
})
