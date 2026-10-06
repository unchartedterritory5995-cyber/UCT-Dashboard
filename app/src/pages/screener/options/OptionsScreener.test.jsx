import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { AuthContext } from '../../../context/AuthContext'
import OptionsScreener, { screenUrl } from './OptionsScreener'
import Screener from '../../Screener'

// COV-02/03 — the Screener's Options view. Seeded payloads, no network.

vi.mock('../shell/ScannerShell', () => ({ default: () => <div data-testid="scanner-shell" /> }))

const S = '2026-10-02'
const COVERAGE = { evaluated: 5, answered: 4, dropped: 0, not_computable: 1,
  dropped_symbols: [{ ticker: 'O:BBB', reason: 'not-computable', detail: 'no vendor delta' }] }

const PAYLOADS = {
  screen: {
    status: 'ok', session: S, matched: 1, shown: 1, data_basis: 'end-of-day snapshot',
    presets: { high_iv_short_premium: { label: 'High-IV short-premium candidates', description: 'IV of 60% or more.' } },
    rows: [{ contract: 'O:AAA261120P00090000', underlying: 'AAA', type: 'put', strike: 90, expiration: '2026-11-20',
      dte: 49, otm_pct: 10, delta: -0.25, iv: 0.85, bid: 1.5, ask: 1.6, spread_pct: 6.5, open_interest: 2000,
      volume: 300, session: S, data_basis: 'end-of-day snapshot' }],
    coverage: COVERAGE, note: `End-of-day snapshot of ${S}: not a live chain.`, screen_rule: 'rule.', source: 'UCT options log',
  },
  'unusual-volume': {
    status: 'ok', session: S, sessions_logged: 2, prior_sessions: 1, ranked: [], available_on: '2026-10-15',
    not_ranked: [{ underlying: 'AAA', session: S, volume: 1450, call_volume: 1150, put_volume: 300, n_sessions: 1,
      note: '1 session, needs 10' }],
    coverage: { evaluated: 1, answered: 0, dropped: 0, not_computable: 1, dropped_symbols: [] },
    missing_sessions: ['2026-10-01'], note: '1 prior session held; the ratio needs 10.', method: 'm.', source: 's',
    volume_source: 'flow_tape',
    volume_rule: 'Flow-tape volume: the contracts in the prints our options-flow tape keeps (aggregated prints of 50+ contracts and $10K+ premium), not every option trade.',
    fallback_note: 'The options log carries no option volume (its 2026-10-02 volume column is empty), so this ranks the flow tape.',
  },
  'iv-percentile': {
    status: 'ok', session: S, sessions_logged: 2, rankable_sessions: 1, ranked: [], available_on: '2026-10-29',
    coverage: { evaluated: 1, answered: 0, dropped: 0, not_computable: 1, dropped_symbols: [] },
    note: '1 session logged under the current ATM read; the percentile needs 20.', method: 'm.', source: 's',
  },
}

let calls
beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(url)
    const key = url.split('/api/options-screener/')[1].split('?')[0]
    return { ok: true, status: 200, json: async () => PAYLOADS[key] }
  }))
})
afterEach(() => vi.unstubAllGlobals())

// `Screener` reads `useSearchParams` (OSCR's "Full page" `?tab=options` deep link), so it
// needs a Router in the tree even here, where no test actually drives the URL.
const wrap = (ui, auth = {}) => render(
  <MemoryRouter>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={auth}>{ui}</AuthContext.Provider>
    </SWRConfig>
  </MemoryRouter>,
)

describe('Screener page — the Options mode exists only while the flag rides the payload', () => {
  it('flag absent: no mode strip, the scanner renders, nothing is fetched', () => {
    wrap(<Screener />, {})
    expect(screen.queryByRole('tablist', { name: 'Screener mode' })).toBeNull()
    expect(screen.getByTestId('scanner-shell')).toBeTruthy()
    expect(calls).toEqual([])
  })

  it('flag on: Stocks | Options, and Options mounts the option screener', async () => {
    wrap(<Screener />, { optionsScreenerEnabled: true })
    fireEvent.click(screen.getByRole('tab', { name: 'Options' }))
    expect(await screen.findByTestId('options-screener')).toBeTruthy()
    expect(screen.queryByTestId('scanner-shell')).toBeNull()
  })

  it('embedded (Charts widget): never shows the strip', () => {
    wrap(<Screener embedded />, { optionsScreenerEnabled: true })
    expect(screen.queryByRole('tablist', { name: 'Screener mode' })).toBeNull()
  })

  it('UCT Terminal\'s OSCR "Full page" link (?tab=options) lands on the Options tab, not Stocks', async () => {
    // Before the fix, functions.js's `full` pointed at bare `/screener`, which always opened
    // Stocks — Screener.jsx's tab mode had no URL hook to read. Now `?tab=options` is honoured
    // as the INITIAL tab.
    render(
      <MemoryRouter initialEntries={['/screener?tab=options']}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <AuthContext.Provider value={{ optionsScreenerEnabled: true }}><Screener /></AuthContext.Provider>
        </SWRConfig>
      </MemoryRouter>,
    )
    expect(screen.getByRole('tab', { name: 'Options', selected: true })).toBeTruthy()
    expect(await screen.findByTestId('options-screener')).toBeTruthy()
    expect(screen.queryByTestId('scanner-shell')).toBeNull()
  })

  it('no ?tab= param still defaults to Stocks (unchanged behavior)', () => {
    render(
      <MemoryRouter initialEntries={['/screener']}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <AuthContext.Provider value={{ optionsScreenerEnabled: true }}><Screener /></AuthContext.Provider>
        </SWRConfig>
      </MemoryRouter>,
    )
    expect(screen.getByRole('tab', { name: 'Stocks', selected: true })).toBeTruthy()
    expect(screen.getByTestId('scanner-shell')).toBeTruthy()
  })
})

describe('OptionsScreener', () => {
  it('every result row names its session and says end-of-day, with the coverage line', async () => {
    wrap(<OptionsScreener />)
    expect(await screen.findByText(`${S} EOD`)).toBeTruthy()
    expect(screen.getByTestId('opts-session').textContent).toContain(`session ${S} (end-of-day snapshot)`)
    expect(screen.getByTestId('coverage-line').textContent).toContain('1 not computable')
    expect(calls[0]).toBe('/api/options-screener/screen?preset=high_iv_short_premium')
  })

  it('has no trade buttons', async () => {
    wrap(<OptionsScreener />)
    await screen.findByText(`${S} EOD`)
    const labels = screen.getAllByRole('button').map((b) => b.textContent.toLowerCase())
    for (const banned of ['buy', 'sell', 'trade', 'order']) {
      expect(labels.some((l) => l.includes(banned)), banned).toBe(false)
    }
  })

  it('unusual volume below 10 sessions shows the count, never a ratio', async () => {
    wrap(<OptionsScreener />)
    fireEvent.click(screen.getByRole('tab', { name: 'Unusual volume' }))
    const cell = await screen.findByTestId('opts-vol-ratio')
    expect(cell.textContent).toBe('1 session, needs 10')
    expect(screen.getByTestId('opts-vol-state').textContent).toContain('available on 2026-10-15')
    // which volume it is, in words: the tape's large prints, not every trade
    const src = screen.getByTestId('opts-vol-source').textContent
    expect(src).toContain('not every option trade')
    expect(src).toContain('so this ranks the flow tape')
  })

  it('IV percentile below 20 sessions states the count and the date, and draws no table', async () => {
    wrap(<OptionsScreener />)
    fireEvent.click(screen.getByRole('tab', { name: 'IV percentile' }))
    const state = await screen.findByTestId('opts-iv-state')
    expect(state.textContent).toContain('1 sessions logged under the current ATM read')
    expect(state.textContent).toContain('available on 2026-10-29')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('screenUrl drops blanks and "any"', () => {
    expect(screenUrl('', { type: 'any', iv_min: '', oi_min: '5' })).toBe('/api/options-screener/screen?oi_min=5')
  })
})

describe('OSCR states that used to read wrong (quality pass 2026-10-05)', () => {
  const answer = (status, body = {}) => ({ ok: status < 400, status, json: async () => body })

  it('a 404 (the switch is off) reads as switched off, not as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(404)))
    wrap(<OptionsScreener />)
    expect((await screen.findByTestId('feature-off')).textContent)
      .toBe("The option screener isn't switched on yet. That is a setting on our side, not an empty result.")
    expect(screen.queryByTestId('opts-unavailable')).toBeNull()
  })

  it('a real failure still says unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(503)))
    wrap(<OptionsScreener />)
    expect((await screen.findByTestId('opts-unavailable')).textContent)
      .toMatch(/^The option screener is unavailable right now\./)
    expect(screen.queryByTestId('feature-off')).toBeNull()
  })

  it('the rankings name what they are loading, and a switched-off ranking says so', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const a = wrap(<OptionsScreener />)
    fireEvent.click(screen.getByRole('tab', { name: 'Unusual volume' }))
    expect(screen.getByText('Loading the unusual-volume ranking…')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'IV percentile' }))
    expect(screen.getByText('Loading the IV percentile ranking…')).toBeTruthy()
    a.unmount()

    vi.stubGlobal('fetch', vi.fn(async () => answer(404)))
    wrap(<OptionsScreener />)
    fireEvent.click(screen.getByRole('tab', { name: 'IV percentile' }))
    expect((await screen.findByTestId('feature-off')).textContent)
      .toBe("The IV percentile ranking isn't switched on yet. That is a setting on our side, not an empty result.")
  })
})
