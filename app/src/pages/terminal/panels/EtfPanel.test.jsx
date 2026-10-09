// ETF: rendered text and real behaviour against a fake network (the three routes are served by a
// fake `fetch`; nothing on the panel's path is mocked).
//   * a stock shows its leveraged / inverse family and says plainly that the reverse lookup is not held;
//   * an ETF shows its holdings, top weights first, with the rest counted;
//   * a leveraged ETF names its underlying and marks itself in the family;
//   * a 402 on the family is a plan note, an ETF with no holdings is an error with Retry,
//     and both reads failing is one error with Retry (never "no ETFs");
//   * the registry: `NVDA ETF` resolves to this panel.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import EtfPanel, { ETF_SYMBOLS_URL, HOLDINGS_SHOWN, familyRows, familyUrl, holdingsUrl } from './EtfPanel'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'
import parseCommand from '../parseCommand'

const NVDA_FAMILY = {
  underlying: 'NVDA', best_long: 'NVDL', best_short: 'NVDS',
  long: [{ ticker: 'NVDL', name: 'GraniteShares 2x Long NVDA', factor: 2, avg_dollar_vol: 1.2e9 }],
  short: [{ ticker: 'NVDS', name: 'Tradr 1.5x Short NVDA', factor: 1.5, avg_dollar_vol: 3.4e7 }],
}
const EMPTY_FAMILY = { underlying: null, long: [], short: [], best_long: null, best_short: null }
const SMH_HOLDINGS = {
  symbol: 'SMH',
  holdings: Array.from({ length: 30 }, (_, i) => ({ sym: i === 0 ? 'NVDA' : `S${i}`, name: `Name ${i}`, weight: 20 - i * 0.5, sector: 'Technology' })),
}

const realFetch = globalThis.fetch
function serve(routes) {
  globalThis.fetch = vi.fn(async (url) => {
    const hit = routes[String(url)]
    if (hit === undefined) return new Response('{}', { status: 404 })
    if (typeof hit === 'number') return new Response('{"detail":"x"}', { status: hit })
    return new Response(JSON.stringify(hit), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}
function renderPanel(sym) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <EtfPanel sym={sym} />
    </SWRConfig>,
  )
}
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('familyRows', () => {
  it('lists long then short, upper-cased, with a side', () => {
    expect(familyRows(NVDA_FAMILY).map((r) => `${r.ticker}:${r.dir}`)).toEqual(['NVDL:Long', 'NVDS:Short'])
    expect(familyRows(null)).toEqual([])
  })
})

describe('EtfPanel', () => {
  it('a stock: its leveraged and inverse ETFs, and an honest note about the reverse lookup', async () => {
    serve({ [holdingsUrl('NVDA')]: { symbol: 'NVDA', holdings: [] }, [familyUrl('NVDA')]: NVDA_FAMILY, [ETF_SYMBOLS_URL]: { symbols: ['SMH', 'SPY'] } })
    renderPanel('NVDA')
    const fam = await screen.findByTestId('terminal-etf-family')
    expect(within(fam).getByTestId('terminal-etf-family-row-NVDL').textContent).toContain('2x')
    expect(within(fam).getByTestId('terminal-etf-family-row-NVDS').textContent).toContain('Short')
    expect(within(fam).getByTestId('terminal-etf-family-row-NVDS').textContent).toContain('1.5x')
    expect(screen.getByTestId('terminal-etf-no-reverse').textContent).toContain('which index ETFs hold NVDA')
    expect(screen.queryByTestId('terminal-etf-holdings-error')).toBeNull()
  })

  it('an ETF: its holdings, top weights first, the rest counted', async () => {
    serve({ [holdingsUrl('SMH')]: SMH_HOLDINGS, [familyUrl('SMH')]: EMPTY_FAMILY, [ETF_SYMBOLS_URL]: { symbols: ['SMH'] } })
    renderPanel('SMH')
    const table = await screen.findByTestId('terminal-etf-holdings')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(HOLDINGS_SHOWN)
    expect(rows[0].textContent).toContain('NVDA')
    expect(rows[0].textContent).toContain('20%')
    expect(screen.getByTestId('terminal-etf-more').textContent).toContain(`top ${HOLDINGS_SHOWN} of 30`)
    expect(screen.getByTestId('terminal-etf-family-empty').textContent).toContain('No leveraged or inverse ETFs track SMH')
  })

  it('a leveraged ETF names its underlying and marks itself', async () => {
    serve({ [holdingsUrl('NVDL')]: { symbol: 'NVDL', holdings: [] }, [familyUrl('NVDL')]: NVDA_FAMILY, [ETF_SYMBOLS_URL]: { symbols: [] } })
    renderPanel('NVDL')
    await screen.findByTestId('terminal-etf-family')
    expect(screen.getByText('NVDL is a leveraged ETF on NVDA. The NVDA family:')).toBeTruthy()
    expect(screen.getByTestId('terminal-etf-family-row-NVDL').textContent).toContain('(this one)')
  })

  it('a 402 on the family is a plan note; the holdings still render', async () => {
    serve({ [holdingsUrl('SMH')]: SMH_HOLDINGS, [familyUrl('SMH')]: 402, [ETF_SYMBOLS_URL]: { symbols: ['SMH'] } })
    renderPanel('SMH')
    expect((await screen.findByTestId('terminal-etf-family-error')).textContent).toContain('paid plan')
    expect(screen.getByTestId('terminal-etf-holdings')).toBeTruthy()
  })

  it('a known ETF with no holdings is an error with Retry, never "holds nothing"', async () => {
    serve({ [holdingsUrl('SPY')]: { symbol: 'SPY', holdings: [] }, [familyUrl('SPY')]: EMPTY_FAMILY, [ETF_SYMBOLS_URL]: { symbols: ['SPY'] } })
    renderPanel('SPY')
    const err = await screen.findByTestId('terminal-etf-holdings-error')
    expect(err.textContent).toContain('Could not read the holdings of SPY')
    serve({ [holdingsUrl('SPY')]: { symbol: 'SPY', holdings: [{ sym: 'AAPL', weight: 7 }] }, [familyUrl('SPY')]: EMPTY_FAMILY, [ETF_SYMBOLS_URL]: { symbols: ['SPY'] } })
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-etf-holding-AAPL')).toBeTruthy()
  })

  it('both reads failing is one error with Retry', async () => {
    serve({ [holdingsUrl('NVDA')]: 500, [familyUrl('NVDA')]: 503, [ETF_SYMBOLS_URL]: 500 })
    renderPanel('NVDA')
    const err = await screen.findByTestId('terminal-etf-error')
    expect(err.textContent).toContain('Could not read ETF exposure for NVDA')
    expect(within(err).getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('with no ticker it asks for one and fetches nothing', () => {
    serve({})
    render(<EtfPanel sym={null} />)
    expect(screen.getByText('ETF needs a ticker.')).toBeTruthy()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('ETF in the registry', () => {
  it('NVDA ETF opens the Etf panel', async () => {
    expect(BY_CODE.ETF.group).toBe('Security')
    expect(variantFor('ETF', true).variant.panel).toBe('Etf')
    expect(parseCommand('SMH ETF')).toMatchObject({ ok: true, type: 'function', code: 'ETF', sym: 'SMH' })
    expect((await PANEL_IMPORTERS.Etf()).default).toBe(EtfPanel)
  })
})
