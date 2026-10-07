// OSCR publishes the rows of whichever view is on screen (completeness audit 2026-10-07, column
// g): each row loads its UNDERLYING (`$SYM`) into the linked group; the underlyings are the board
// list. A view with no table (loading, failed, below its minimum) publishes nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { PanelListContext } from '../../../components/terminal'
import OptionsScreener from './OptionsScreener'

const S = '2026-10-02'
const COV = { evaluated: 1, answered: 1, dropped: 0, not_computable: 0, dropped_symbols: [] }
const contract = (und, strike) => ({ contract: `O:${und}261120P${String(strike * 1000).padStart(8, '0')}`, underlying: und, type: 'put', strike,
  expiration: '2026-11-20', dte: 49, otm_pct: 10, delta: -0.25, iv: 0.85, bid: 1.5, ask: 1.6, spread_pct: 6.5,
  open_interest: 2000, volume: 300, session: S })
let payloads
beforeEach(() => {
  payloads = {
    screen: { status: 'ok', session: S, matched: 3, shown: 3, presets: {}, coverage: COV, note: 'n', screen_rule: 'r', source: 's',
      rows: [contract('AAA', 90), contract('BBB', 40), contract('AAA', 85)] },
    'unusual-volume': { status: 'ok', session: S, sessions_logged: 12, ranked: [
      { underlying: 'CCC', session: S, volume: 9000, call_volume: 6000, put_volume: 3000, average: 1000, ratio: 9, n_sessions: 10 },
      { underlying: 'DDD', session: S, volume: 5000, call_volume: 2500, put_volume: 2500, average: 1000, ratio: 5, n_sessions: 10 },
    ], not_ranked: [], coverage: COV, method: 'm', source: 's', volume_rule: 'v' },
    'iv-percentile': { status: 'ok', session: S, sessions_logged: 2, rankable_sessions: 1, ranked: [], coverage: COV,
      note: 'needs 20', method: 'm', source: 's' },
  }
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const key = url.split('/api/options-screener/')[1].split('?')[0]
    return { ok: true, status: 200, json: async () => payloads[key] }
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount() {
  const api = { publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [{ code: 'GP', label: 'Chart' }], pageSize: 4 }
  render(
    <MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PanelListContext.Provider value={api}><OptionsScreener /></PanelListContext.Provider>
    </SWRConfig></MemoryRouter>,
  )
  return api
}

describe('OSCR rows', () => {
  it('the option screen: one `$UND` row per contract row (repeats kept), the underlyings as its list', async () => {
    const api = mount()
    await screen.findByRole('table', { name: 'Option screener results' })
    await waitFor(() => expect(api.publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$AAA']))
    expect(api.publish).toHaveBeenLastCalledWith({ syms: ['AAA', 'BBB'], label: 'OSCR screen' })
    expect(screen.getByTestId('oscr-board-open')).toHaveTextContent('Open 2')
  })

  it('switching to the volume ranking publishes ITS rows instead', async () => {
    const api = mount()
    await screen.findByRole('table', { name: 'Option screener results' })
    fireEvent.click(screen.getByRole('tab', { name: 'Unusual volume' }))
    await screen.findByRole('table', { name: 'Option volume ranking' })
    await waitFor(() => expect(api.publishRows).toHaveBeenLastCalledWith(['$CCC', '$DDD']))
    expect(api.publish).toHaveBeenLastCalledWith({ syms: ['CCC', 'DDD'], label: 'OSCR unusual volume' })
  })

  it('CONTROL: a view with no table (IV below its minimum) addresses nothing', async () => {
    const api = mount()
    await screen.findByRole('table', { name: 'Option screener results' })
    fireEvent.click(screen.getByRole('tab', { name: 'IV percentile' }))
    await screen.findByTestId('opts-iv')
    await waitFor(() => expect(api.publishRows).toHaveBeenLastCalledWith([]))
    expect(api.publish).toHaveBeenLastCalledWith(null)
  })
})
