// Wave 13 lane 13G-1 -- Passed setups on Research Home.
//
// The server decides every number and every label; this component only words them. So the rails
// are about WORDING, read off the rendered text:
//   * nothing renders and nothing is fetched while notebook_passed_setups_enabled is off;
//   * a scored horizon reads as a signed percentage; a horizon with no bar reads as the SERVER's
//     label for why, never as a number (a missing value must never render as 0.0%);
//   * a name with no stored bars says so instead of a row of blanks;
//   * traded names are counted, never silently dropped;
//   * Add sends the symbol and day; Remove sends a DELETE for that row.
//
// CONTRACT: the list, the added row, the removal and the refusals are the REAL server's answers
// (`__fixtures__/contract`, written by tools/notebook_contract_fixtures.py from
// /api/j2/research-capture/passed-setups and held current by tests/test_notebook_contract_fixtures.py).
// The recorded list holds one name in each state: scored, pending, a short store ("missing"),
// and no bars at all, plus one name the member went on to trade.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import PassedSetups from './PassedSetups'
import { contract, contractBody } from '../../__fixtures__/contract'

const LIST = contractBody('passed-setups.list')
const BASE = contract('passed-setups.list')._contract.path
const row = (symbol) => LIST.items.find((i) => i.symbol === symbol)

function installFetch(handler) {
  const calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const call = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }
    calls.push(call)
    const [status, body] = handler(call)
    return { ok: status < 300, status, json: async () => body }
  })
  return calls
}
const answer = (name) => { const c = contract(name); return [c._contract.status, c.body] }

const wrap = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter><PassedSetups /></MemoryRouter>
  </SWRConfig>)
const cellsOf = (li) => [...li.querySelectorAll('[data-outcome]')].map((c) => [c.dataset.outcome, c.textContent])

describe('the recorded list holds one name in each state (non-vacuity)', () => {
  it('scored, pending, a short store, and no bars; one traded name counted', () => {
    expect(Object.fromEntries(LIST.items.map((i) => [i.symbol, i.status]))).toEqual({
      // PSGP was 'scored' until the data lane counted horizons on the market calendar
      // (b6e7952586, b00ec816e6): a name with a session missing from the store is not scored yet.
      PSNV: 'scored', PSGP: 'pending', PSPD: 'pending', PSSH: 'pending', PSZZ: 'no_bars',
    })
    expect(LIST).toMatchObject({ horizons: [1, 5, 10, 20], bestWindow: 20, tradedWithin: 10, tradedCount: 1, lookbackDays: 60 })
    expect(new Set(row('PSSH').outcomes.map((o) => o.missing))).toEqual(new Set([null, 'missing']))
    expect(new Set(row('PSPD').outcomes.map((o) => o.missing))).toEqual(new Set([null, 'pending']))
  })
})

describe('PassedSetups', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_passed_setups_enabled: true })
  })
  afterEach(() => __resetNotebookFlags())

  it('renders nothing and fetches nothing while the gate is off', () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_passed_setups_enabled: false })
    global.fetch = vi.fn()
    const { container } = wrap()
    expect(container.innerHTML).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('words a scored horizon as a signed percentage and a missing one by the server\'s label', async () => {
    const calls = installFetch(() => [200, LIST])
    wrap()
    const scored = (await screen.findByText('$PSNV')).closest('li')
    expect(cellsOf(scored)).toEqual([
      ['r1', '+1 day+1.0%'], ['r5', '+5 days+5.0%'], ['r10', '+10 days+10.0%'],
      ['r20', '+20 days+20.0%'], ['best20', 'Best in 20+20.5%'],
    ])
    expect(within(scored).getByText(/Saved Aug 31 · from the Aug 31 close/)).toBeTruthy()
    expect(within(scored).getByText('Added by you')).toBeTruthy()
    expect(scored.dataset.status).toBe('scored')

    // The store holds two sessions after the save; the market has had more. One real number,
    // then the server's own label for the gap, never 0.0%.
    const short = screen.getByText('$PSSH').closest('li')
    const shortCells = Object.fromEntries([...short.querySelectorAll('[data-outcome]')].map((c) => [c.dataset.outcome, c]))
    expect(shortCells.r1.textContent).toBe('+1 day+2.5%')
    expect(shortCells.r5.textContent).toBe('+5 daysBars missing from the store')
    expect(shortCells.r5.dataset.missing).toBe('missing')
    expect(shortCells.best20.textContent).toBe('Best in 20Bars missing from the store')
    expect(short.textContent).not.toMatch(/0\.0%/)

    // Saved three sessions ago: later horizons have not happened yet.
    const pending = screen.getByText('$PSPD').closest('li')
    const pendingCells = Object.fromEntries([...pending.querySelectorAll('[data-outcome]')].map((c) => [c.dataset.outcome, c]))
    expect(pendingCells.r1.textContent).toBe('+1 day+1.4%')
    expect(pendingCells.r20.textContent).toBe('+20 daysNot yet')
    expect(pendingCells.r20.dataset.missing).toBe('pending')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${BASE}`])
  })

  it('a name with no stored bars says so, and traded names are counted', async () => {
    installFetch(() => [200, LIST])
    wrap()
    const z = (await screen.findByText('$PSZZ')).closest('li')
    expect(z.querySelector('[data-no-bars]').textContent).toBe(`${row('PSZZ').noBarsLabel}.`)
    expect(z.querySelector('[data-no-bars]').textContent).toBe('No stored daily bars for this name on or before the save.')
    expect(z.querySelectorAll('[data-outcome]').length).toBe(0)
    expect(within(z).getByText('Saved Aug 31')).toBeTruthy()                    // no base close to cite
    // The name the member went on to trade is not a row, and is counted out loud.
    expect(screen.queryByText('$PSTR')).toBeNull()
    expect(screen.getByRole('note').textContent).toBe('1 name you traded within 10 sessions of saving is not listed.')
  })

  it('words the plural, and the two other sources, when the server sends them', async () => {
    // Two values overridden on the real list: the recorded member added every name by hand.
    const items = LIST.items.map((i, n) => ({ ...i, source: ['scanner', 'watchlist'][n] || i.source }))
    installFetch(() => [200, { ...LIST, items, tradedCount: 2 }])
    wrap()
    await screen.findByText('$PSNV')
    expect(screen.getByText('Scanner')).toBeTruthy()
    expect(screen.getByText('Watchlist')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toBe('2 names you traded within 10 sessions of saving are not listed.')
  })

  it('an empty list has its help line, and is not an error', async () => {
    installFetch(() => answer('passed-setups.empty'))
    wrap()
    expect(await screen.findByText(/Nothing here yet\. Names you save from a scanner or add to a watchlist show up here/)).toBeTruthy()
    expect(screen.queryByRole('note')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a failed read is said, never shown as an empty list', async () => {
    installFetch(() => answer('passed-setups.free-plan'))
    const { container } = wrap()
    await waitFor(() => expect(screen.queryByText('Scoring your passed setups…')).toBeNull())
    expect(screen.queryByText(/Nothing here yet/)).toBeNull()
    expect(container.textContent).toMatch(/your passed setups/)
  })

  it('Add sends the symbol and the day; Remove sends a DELETE for that row', async () => {
    const added = contract('passed-setups.add')
    const first = row('PSZZ')
    let list = { ...LIST, items: [first], tradedCount: 0 }
    const calls = installFetch((c) => {
      if (c.method === 'POST') { list = { ...list, items: [...list.items, added.body.item] }; return [added._contract.status, added.body] }
      if (c.method === 'DELETE') { list = { ...list, items: list.items.filter((i) => !c.url.endsWith(`/${i.id}`)) }; return answer('passed-setups.dismiss') }
      return [200, list]
    })
    wrap()
    await screen.findByText('$PSZZ')
    const sent = added._contract.requestBody
    fireEvent.change(screen.getByLabelText('Ticker you passed on'), { target: { value: `$${sent.symbol.toLowerCase()}` } })
    fireEvent.change(screen.getByLabelText('Day you passed on it'), { target: { value: sent.savedOn } })
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    await screen.findByText('$PSNV')
    const post = calls.find((c) => c.method === 'POST')
    expect(post.url).toBe(added._contract.path)
    expect(post.body).toEqual(sent)                              // exactly the recorded request body

    fireEvent.click(screen.getByRole('button', { name: 'Remove PSZZ from passed setups' }))
    await waitFor(() => expect(screen.queryByText('$PSZZ')).toBeNull())
    expect(calls.find((c) => c.method === 'DELETE').url).toBe(`${BASE}/${first.id}`)
    expect(screen.getByText('$PSNV')).toBeTruthy()
  })

  it.each([
    ['a day more than sixty days back', 'passed-setups.add.too-old'],
    ['a day in the future', 'passed-setups.add.future-day'],
    ['something that is not a ticker', 'passed-setups.add.bad-symbol'],
  ])('a refused add shows the server\'s sentence for %s', async (_label, name) => {
    const sentence = contractBody(name).detail
    expect(sentence.length).toBeGreaterThan(20)
    installFetch((c) => (c.method === 'POST' ? answer(name) : answer('passed-setups.empty')))
    wrap()
    await screen.findByText(/Nothing here yet/)
    fireEvent.change(screen.getByLabelText('Ticker you passed on'), { target: { value: 'PSNV' } })
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    expect((await screen.findByRole('alert')).textContent).toBe(sentence)
  })
})

// fin-security I-3: the list is a plain read; the server refreshes after answering and says so.
describe('PassedSetups — the follow-up read after a queued refresh', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_passed_setups_enabled: true })
  })
  afterEach(() => __resetNotebookFlags())

  it('reads once more when the server says a refresh was queued, and only once', async () => {
    let n = 0
    const calls = installFetch(() => {
      n += 1
      return [200, { ...LIST, refreshQueued: n === 1 }]
    })
    wrap()
    await screen.findByText(`$${LIST.items[0].symbol}`)   // a recorded name, whichever is first
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2), { timeout: 5000 })
    await new Promise((r) => setTimeout(r, 2800))
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2)
  }, 12000)

  it('reads once when no refresh was queued', async () => {
    const calls = installFetch(() => [200, { ...LIST, refreshQueued: false }])
    wrap()
    await screen.findByText(`$${LIST.items[0].symbol}`)   // a recorded name, whichever is first
    await new Promise((r) => setTimeout(r, 2800))
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1)
  }, 8000)
})
