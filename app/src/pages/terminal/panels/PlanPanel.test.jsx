// PLAN: trade plan -> alerts -> journal. Rails:
//   * NOTHING is written on mount (a reload, a restored board or a shared ?cmd= link writes nothing);
//   * Set alerts writes the buy point and the stop through the SAME POST /api/watchlist-alerts ALRT
//     uses, then says so in a rendered sentence; a refusal names which alert did not land and why;
//   * Log to journal writes one J2 notebook note (POST /api/j2/notes) and says so, with a link;
//     a failure says nothing was saved;
//   * a spent button cannot write twice until the plan changes;
//   * the registry: `NVDA PLAN` resolves here, ticker-only, prices prefill from the command.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: { NVDA: { price: 199 } }, error: null }) }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelListContext } from '../../../components/terminal'
import PlanPanel from './PlanPanel'
import { alertsResultText, planNote, readPlan } from './planModel'
import { BY_CODE, CODE_ALIASES, RETIRED, variantFor } from '../functions'
import { applyArgs } from '../args'
import { PANEL_IMPORTERS } from '../panels'

const ALERTS = '/api/watchlist-alerts'
const NOTES = '/api/j2/notes'

/** Route the one mocked fetcher by URL: live price for setAlert, then the two writes. */
function routeFetch({ alertFail = null, noteFail = null } = {}) {
  let alertN = 0
  jsonFetcher.mockImplementation(async (url, init) => {
    if (String(url).startsWith('/api/live-prices')) return { NVDA: { price: 199 } }
    if (url === ALERTS && init?.method === 'POST') {
      alertN += 1
      if (alertFail && alertFail(alertN)) throw Object.assign(new Error('x'), { status: 500 })
      return { id: alertN }
    }
    if (url === NOTES && init?.method === 'POST') {
      if (noteFail) throw Object.assign(new Error('x'), { status: noteFail })
      return { note: { id: 'n42' } }
    }
    throw new Error(`unexpected ${url}`)
  })
}
const posts = (url) => jsonFetcher.mock.calls.filter(([u, i]) => u === url && i?.method === 'POST')

function renderPanel(props = { sym: 'NVDA', buy: '203', stop: '195' }) {
  const open = vi.fn()
  render(
    <MemoryRouter>
      <PanelListContext.Provider value={{ open, run: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
        <PlanPanel {...props} />
      </PanelListContext.Provider>
    </MemoryRouter>,
  )
  return { open }
}

beforeEach(() => {
  jsonFetcher.mockReset()
  try { window.localStorage.clear() } catch { /* none */ }
})
afterEach(cleanup)

describe('PLAN model', () => {
  it('derives the side, the risk and the R to target; refuses a bad plan with a sentence', () => {
    const p = readPlan({ buy: '203', stop: '195', target: '227' })
    expect(p).toMatchObject({ ok: true, side: 'long', perShare: 8, rTarget: 3 })
    expect(readPlan({ buy: '50', stop: '55' }).side).toBe('short')
    expect(readPlan({ buy: '50', stop: '50' }).error).toBe('The stop must differ from the buy point.')
    expect(readPlan({ buy: '50', stop: '45', target: '40' }).error).toBe('For a long, the target must be above the buy point.')
    expect(readPlan({ buy: '', stop: '45' }).error).toBe('Enter a buy point above zero.')
  })

  it('sizes through sizeMath when an account is given', () => {
    const p = readPlan({ buy: '203', stop: '195', account: '100000', riskPct: '1' })
    expect(p.size).toMatchObject({ ok: true, shares: 125 })
  })

  it('the note is a J2 notebook note tagged trade-plan with the plan in its body', () => {
    const n = planNote('NVDA', readPlan({ buy: '203', stop: '195' }))
    expect(n).toMatchObject({ title: 'NVDA trade plan', ticker: 'NVDA', tags: ['trade-plan'] })
    expect(n.bodyJson.type).toBe('doc')
    expect(JSON.stringify(n.bodyJson)).toContain('Buy point: $203.00')
    expect(JSON.stringify(n)).not.toMatch(/—/)
  })

  it('the result sentence names every alert, and which one failed', () => {
    const legs = [{ label: 'buy point', price: 203, direction: 'above' }, { label: 'stop', price: 195, direction: 'below' }]
    expect(alertsResultText('NVDA', [{ leg: legs[0], ok: true }, { leg: legs[1], ok: true }]))
      .toBe('Alerts set: NVDA above $203.00 (buy point) and NVDA below $195.00 (stop). ALRT lists them.')
    expect(alertsResultText('NVDA', [{ leg: legs[0], ok: false, text: 'No.' }, { leg: legs[1], ok: false, text: 'No.' }]))
      .toBe('No alerts were set. The buy point alert was not set: No. The stop alert was not set: No.')
  })
})

describe('PLAN panel', () => {
  it('prefills from the command and writes NOTHING on mount', async () => {
    routeFetch()
    renderPanel()
    expect(screen.getByTestId('terminal-plan-buy').value).toBe('203')
    expect(screen.getByTestId('terminal-plan-stop').value).toBe('195')
    expect(screen.getByTestId('terminal-plan-summary').textContent).toContain('Stop: $195.00 (risk $8.00 a share)')
    await new Promise((r) => setTimeout(r, 20))
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('a new command re-seeds the prices it names, and still writes nothing', () => {
    routeFetch()
    const tree = (p) => (
      <MemoryRouter>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          <PlanPanel sym="NVDA" {...p} />
        </PanelListContext.Provider>
      </MemoryRouter>
    )
    const { rerender } = render(tree({ buy: '203', stop: '195' }))
    rerender(tree({ buy: '>210', stop: '195' }))
    expect(screen.getByTestId('terminal-plan-buy').value).toBe('210')
    expect(screen.getByTestId('terminal-plan-stop').value).toBe('195')
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('Set alerts writes both alerts through the ALRT endpoint and confirms in words', async () => {
    routeFetch()
    renderPanel()
    fireEvent.click(screen.getByTestId('terminal-plan-set-alerts'))
    const out = await screen.findByTestId('terminal-plan-alerts-result')
    expect(out.textContent).toContain('Alerts set: NVDA above $203.00 (buy point) and NVDA below $195.00 (stop). ALRT lists them.')
    const bodies = posts(ALERTS).map(([, i]) => JSON.parse(i.body))
    expect(bodies).toEqual([
      { sym: 'NVDA', target_price: 203, direction: 'above' },
      { sym: 'NVDA', target_price: 195, direction: 'below' },
    ])
    // Spent until the plan changes: a second press writes nothing.
    const btn = screen.getByTestId('terminal-plan-set-alerts')
    expect(btn.textContent).toBe('Alerts set')
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(posts(ALERTS)).toHaveLength(2)
    fireEvent.change(screen.getByTestId('terminal-plan-stop'), { target: { value: '196' } })
    expect(screen.getByTestId('terminal-plan-set-alerts').disabled).toBe(false)
  })

  it('a refused alert says which one did not land and why', async () => {
    routeFetch({ alertFail: (n) => n === 2 })
    renderPanel()
    fireEvent.click(screen.getByTestId('terminal-plan-set-alerts'))
    const out = await screen.findByTestId('terminal-plan-alerts-result')
    expect(out.textContent).toContain('Alert set: NVDA above $203.00 (buy point).')
    expect(out.textContent).toContain('The stop alert was not set: The alert for NVDA could not be saved just now. Nothing was set; try again.')
    expect(out.getAttribute('role')).toBe('alert')
    expect(screen.getByTestId('terminal-plan-set-alerts').disabled).toBe(false)
  })

  it('Log to journal writes one J2 note, confirms, and links to it', async () => {
    routeFetch()
    renderPanel()
    fireEvent.click(screen.getByTestId('terminal-plan-log-journal'))
    const out = await screen.findByTestId('terminal-plan-journal-result')
    expect(out.textContent).toContain('Logged to your journal as a note: NVDA trade plan.')
    expect(screen.getByRole('link', { name: 'Open the note' }).getAttribute('href')).toBe('/journal?j2tab=notebook&note=n42')
    const [[, init]] = posts(NOTES)
    expect(JSON.parse(init.body)).toMatchObject({ title: 'NVDA trade plan', ticker: 'NVDA', tags: ['trade-plan'] })
    expect(posts(ALERTS)).toHaveLength(0)
    fireEvent.click(screen.getByTestId('terminal-plan-log-journal'))
    expect(posts(NOTES)).toHaveLength(1)
  })

  it('a failed journal save says nothing was saved; a 402 says paid plan', async () => {
    routeFetch({ noteFail: 500 })
    renderPanel()
    fireEvent.click(screen.getByTestId('terminal-plan-log-journal'))
    expect((await screen.findByTestId('terminal-plan-journal-result')).textContent)
      .toContain('The plan could not be saved to your journal just now. Nothing was saved; try again.')
    expect(screen.getByTestId('terminal-plan-log-journal').disabled).toBe(false)
    cleanup()
    jsonFetcher.mockReset()
    routeFetch({ noteFail: 402 })
    renderPanel()
    fireEvent.click(screen.getByTestId('terminal-plan-log-journal'))
    expect((await screen.findByTestId('terminal-plan-journal-result')).textContent).toContain('The journal needs a paid plan.')
  })

  it('a bad plan disables both writes and says why', async () => {
    routeFetch()
    renderPanel({ sym: 'NVDA', buy: '203', stop: '203' })
    expect(screen.getByTestId('terminal-plan-error').textContent).toBe('The stop must differ from the buy point.')
    expect(screen.getByTestId('terminal-plan-set-alerts').disabled).toBe(true)
    expect(screen.getByTestId('terminal-plan-log-journal').disabled).toBe(true)
  })

  it('sizes with an account, and asks for a ticker without one', async () => {
    routeFetch()
    renderPanel()
    fireEvent.change(screen.getByTestId('terminal-plan-account'), { target: { value: '100000' } })
    await waitFor(() => expect(screen.getByTestId('terminal-plan-summary').textContent).toContain('Size: 125 shares'))
    cleanup()
    renderPanel({ sym: null })
    expect(screen.getByTestId('terminal-plan-needs-ticker').textContent).toContain('NVDA PLAN')
  })
})

describe('PLAN registry', () => {
  it('is a ticker-only panel code whose two price arguments prefill buy and stop', async () => {
    expect(BY_CODE.PLAN.ticker.panel).toBe('Plan')
    expect(BY_CODE.PLAN.market).toBeUndefined()
    expect(variantFor('PLAN', true).variant.panel).toBe('Plan')
    expect(applyArgs(BY_CODE.PLAN.ticker, ['203.00', '195']).props).toEqual({ buy: '203', stop: '195' })
    const mod = await PANEL_IMPORTERS.Plan()
    expect(mod.default).toBe(PlanPanel)
  })

  it('collides with no alias, retired code or tracked ticker', () => {
    expect(CODE_ALIASES.PLAN).toBeUndefined()
    expect(RETIRED.PLAN).toBeUndefined()
    const uni = fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')
    expect(uni).not.toMatch(/"PLAN"/)
  })
})
