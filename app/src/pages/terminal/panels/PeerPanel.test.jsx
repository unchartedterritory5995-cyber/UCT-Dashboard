// PEER: rendered text and real behaviour against a fake network. The peer route and the batched
// returns route are served by a fake `fetch`; only the shared live-price store is stood in for.
//   * the stock is row 1 and every peer follows it, each with live + period returns;
//   * a failed peer read is an ERROR with Retry (never "no peers"), a 402 says paid plan;
//   * an empty peer list says so in plain words;
//   * a failed returns read keeps the table and says which columns are missing;
//   * the registry: `NVDA PEER` resolves to this panel.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

const live = vi.hoisted(() => ({ prices: {} }))
vi.mock('../../../hooks/useLivePrices', () => ({
  default: () => ({ prices: live.prices, isLoading: false, error: null }),
}))

import PeerPanel, { PERF_URL, peerSyms, peersUrl } from './PeerPanel'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'
import parseCommand from '../parseCommand'

const PEERS = { seed: 'NVDA', group_id: 'ai', group_name: 'AI / GPU Chips', source: 'taxonomy',
  peers: ['AMD', 'nvda', 'AVGO', 'AMD'], also_in: [{ id: 's', name: 'Semiconductors' }] }

const realFetch = globalThis.fetch
function serve(routes) {
  globalThis.fetch = vi.fn(async (url) => {
    const hit = routes[String(url)]
    if (hit === undefined) return new Response('{}', { status: 404 })
    if (typeof hit === 'number') return new Response('{"detail":"x"}', { status: hit })
    return new Response(JSON.stringify(hit), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}
function renderPanel(sym = 'NVDA') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PeerPanel sym={sym} />
    </SWRConfig>,
  )
}

beforeEach(() => {
  live.prices = { NVDA: { price: 182.4, change_pct: 3.1 }, AMD: { price: 150.25, change_pct: -1.25 } }
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('peerSyms', () => {
  it('upper-cases, de-duplicates and drops the stock itself', () => {
    expect(peerSyms(PEERS, 'nvda')).toEqual(['AMD', 'AVGO'])
    expect(peerSyms({ peers: [{ sym: 'aapl' }, null, ''] }, 'MSFT')).toEqual(['AAPL'])
    expect(peerSyms(null, 'X')).toEqual([])
  })
})

describe('PeerPanel', () => {
  it('shows the stock as row 1, then its peers, with live and period returns', async () => {
    serve({ [peersUrl('NVDA')]: PEERS, [PERF_URL]: { NVDA: { '1w': 2, '1m': 10, '3m': 20, ytd: 80 }, AMD: { '1m': -4 } } })
    renderPanel()
    const table = await screen.findByTestId('terminal-peer-table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(
      ['terminal-peer-row-NVDA', 'terminal-peer-row-AMD', 'terminal-peer-row-AVGO'])
    expect(rows[0].textContent).toContain('(this stock)')
    expect(rows[0].textContent).toContain('+3.10%')
    await screen.findByText('+80.0%')
    expect(rows[1].textContent).toContain('-4.0%')
    expect(rows[2].textContent).toContain('n/a')
    expect(screen.getByTestId('terminal-peer-group').textContent).toBe('AI / GPU Chips')
    expect(screen.getByTestId('terminal-peer-source').textContent).toBe('UCT theme')
    expect(screen.getByTestId('terminal-peer-also').textContent).toContain('Semiconductors')
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/groups/peers?sym=NVDA&n=12', undefined)
  })

  it('a failed peer read is an error with Retry, never "no peers"', async () => {
    serve({ [peersUrl('NVDA')]: 500 })
    renderPanel()
    const err = await screen.findByTestId('terminal-peer-error')
    expect(err.textContent).toContain('Could not read the peers for NVDA')
    expect(screen.queryByTestId('terminal-peer-empty')).toBeNull()
    serve({ [peersUrl('NVDA')]: PEERS, [PERF_URL]: {} })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-peer-table')).toBeTruthy()
  })

  it('a 402 says peers are part of the paid plan, with no Retry', async () => {
    serve({ [peersUrl('NVDA')]: 402 })
    renderPanel()
    const err = await screen.findByTestId('terminal-peer-error')
    expect(err.textContent).toContain('paid plan')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('a 503 body from the route is an error, not an empty group', async () => {
    serve({ [peersUrl('NVDA')]: { error: 'groups unavailable: boom' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-peer-error')).textContent).toContain('not loaded')
  })

  it('no peers says so plainly', async () => {
    serve({ [peersUrl('ZZZ')]: { seed: 'ZZZ', peers: [], source: 'none' } })
    renderPanel('ZZZ')
    expect((await screen.findByTestId('terminal-peer-empty')).textContent).toContain('No peers found for ZZZ')
  })

  it('a failed returns read keeps the table and names what is missing', async () => {
    serve({ [peersUrl('NVDA')]: PEERS, [PERF_URL]: 500 })
    renderPanel()
    await screen.findByTestId('terminal-peer-table')
    expect(await screen.findByText(/1W, 1M, 3M and YTD could not be read/)).toBeTruthy()
  })

  it('with no ticker it asks for one and fetches nothing', () => {
    serve({})
    render(<PeerPanel sym={null} />)
    expect(screen.getByText('PEER needs a ticker.')).toBeTruthy()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('PEER in the registry', () => {
  it('NVDA PEER opens the Peer panel; PEER is a ticker function', async () => {
    expect(BY_CODE.PEER.group).toBe('Security')
    const { variant } = variantFor('PEER', true)
    expect(variant.panel).toBe('Peer')
    const cmd = parseCommand('NVDA PEER')
    expect(cmd).toMatchObject({ ok: true, type: 'function', code: 'PEER', sym: 'NVDA' })
    expect((await PANEL_IMPORTERS.Peer()).default).toBe(PeerPanel)
  })
})
