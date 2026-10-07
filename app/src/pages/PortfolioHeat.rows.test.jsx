// RISK publishes its open positions (completeness audit 2026-10-07, column g), and prints the
// server's already-rounded percents through the shared primitives with unchanged output.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PanelListContext } from '../components/terminal'

let state
vi.mock('../hooks/useMobileSWR', () => ({ default: () => ({ ...state, mutate: vi.fn() }) }))
import PortfolioHeat, { pctAsSent } from './PortfolioHeat'

afterEach(cleanup)
function mount() {
  const api = { publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [{ code: 'GP', label: 'Chart' }], pageSize: 4 }
  render(<PanelListContext.Provider value={api}><PortfolioHeat /></PanelListContext.Provider>)
  return api
}
const HEAT = {
  ok: true, risk_heat_pct: 2.5, notional_exposure_pct: 40, room_to_add_pct: 7.5,
  per_position: [
    { symbol: 'NVDA', side: 'long', dist_to_stop_pct: 4.27, risk_pct: 1, placeholder_stop: false },
    { symbol: 'AMD', side: 'long', dist_to_stop_pct: 3, risk_pct: 0.75, placeholder_stop: false },
  ],
  by_sector: [], concentration_flags: [], caps: { aggregate_pct: 10, regime_ceiling_pct: 80 },
}

describe('RISK rows', () => {
  it('one `$SYM` row per position, in table order, and the positions as its list', () => {
    state = { data: HEAT, error: undefined }
    const api = mount()
    expect(api.publishRows).toHaveBeenLastCalledWith(['$NVDA', '$AMD'])
    expect(api.publish).toHaveBeenLastCalledWith({ syms: ['NVDA', 'AMD'], label: 'RISK positions' })
    expect(screen.getByTestId('risk-board-open')).toHaveTextContent('Open 2')
    expect(document.body.textContent).toContain('regime ceiling 80%')
    expect(document.body.textContent).toContain('4.27%')
  })

  it('CONTROL: a failed read and an `ok:false` answer publish nothing', () => {
    state = { data: undefined, error: Object.assign(new Error('x'), { status: 503 }) }
    let api = mount()
    expect(api.publishRows).toHaveBeenLastCalledWith([])
    cleanup()
    state = { data: { ok: false, per_position: [{ symbol: 'NVDA' }] }, error: undefined }
    api = mount()
    expect(api.publishRows).toHaveBeenLastCalledWith([])
    expect(api.publish).toHaveBeenLastCalledWith(null)
  })
})

describe('RISK percents: byte-identical to the old `${v}%` on every value the server sends', () => {
  // FROZEN ORACLE: the pre-migration cell body, verbatim.
  const old = (v) => (v != null ? `${v}%` : '—')
  it('every two-place value from -100 to 1000, and the whole-number ceilings', () => {
    for (let c = -10000; c <= 100000; c += 7) {
      const v = Math.round(c) / 100        // what Python's round(x, 2) hands JSON
      expect([v, pctAsSent(v)]).toEqual([v, old(v)])
    }
    for (const v of [0, 20, 40, 60, 80, 100, 0.1, 0.01, 12.5, null, undefined]) expect([v, pctAsSent(v)]).toEqual([v, old(v)])
  })
  it('the pinned edges (a change here is a decision)', () => {
    // ⚠️ a non-number used to print "NaN%"; it is the em dash now
    expect(old(NaN)).toBe('NaN%')
    expect(pctAsSent(NaN)).toBe('—')
    // ⚠️ a value at or above 1,000% stays ungrouped ("1234.5%"), exactly as before
    expect(pctAsSent(1234.5)).toBe('1234.5%')
  })
})
