// SIZE: the arithmetic (sizeMath.js) and the rendered calculator. Rails:
//   * shares round DOWN so $ at risk never exceeds the budget; targets sit at 1R / 2R / 3R;
//   * a long needs its stop below the entry and a short above; the wrong side is refused in words;
//   * with a ticker the entry is prefilled ONCE from the live price and the member's typing wins;
//   * a failed price read leaves the entry for the member to type and says so;
//   * account and risk % are kept in localStorage only (no server preference), and a throwing
//     storage never breaks the panel;
//   * the registry: `SIZE` and `NVDA SIZE` both open this panel.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const live = vi.hoisted(() => ({ prices: {}, error: null, asked: [] }))
vi.mock('../../../hooks/useLivePrices', () => ({
  default: (tickers) => { live.asked.push(tickers); return { prices: live.prices, isLoading: false, error: live.error } },
}))

import SizePanel, { SIZE_STORE_KEY, loadSizePrefs } from './SizePanel'
import { computeSize, parseNum } from './sizeMath'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'
import parseCommand from '../parseCommand'

beforeEach(() => {
  live.prices = {}
  live.error = null
  live.asked = []
  window.localStorage.clear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const type = (key, value) => fireEvent.change(screen.getByTestId(`terminal-size-${key}`), { target: { value } })

describe('sizeMath', () => {
  it('parses typed numbers and refuses junk', () => {
    expect(parseNum('$25,000')).toBe(25000)
    expect(parseNum(' 1.5% ')).toBe(1.5)
    expect(parseNum('')).toBeNull()
    expect(parseNum('abc')).toBeNull()
  })

  it('sizes a long: shares round down, risk never exceeds the budget, targets at 1R/2R/3R', () => {
    const r = computeSize({ account: 100000, riskPct: 1, entry: 50, stop: 47, side: 'long' })
    expect(r.ok).toBe(true)
    expect(r.shares).toBe(333)                 // 1000 / 3 = 333.3, rounded down
    expect(r.dollarRisk).toBe(999)
    expect(r.dollarRisk).toBeLessThanOrEqual(r.budget)
    expect(r.position).toBe(16650)
    expect(r.positionPct).toBeCloseTo(16.65, 6)
    expect(r.targets.map((t) => t.price)).toEqual([53, 56, 59])
    expect(r.targets.map((t) => t.profit)).toEqual([999, 1998, 2997])
  })

  it('sizes a short with its stop above and targets below', () => {
    const r = computeSize({ account: 50000, riskPct: 2, entry: 100, stop: 104, side: 'short' })
    expect(r.ok).toBe(true)
    expect(r.side).toBe('short')
    expect(r.shares).toBe(250)
    expect(r.targets.map((t) => t.price)).toEqual([96, 92, 88])
  })

  it('refuses a stop on the wrong side, in words', () => {
    expect(computeSize({ account: 1e5, riskPct: 1, entry: 50, stop: 52, side: 'long' }).error).toMatch(/stop must be below the entry/)
    expect(computeSize({ account: 1e5, riskPct: 1, entry: 50, stop: 48, side: 'short' }).error).toMatch(/stop must be above the entry/)
    expect(computeSize({ account: 1e5, riskPct: 1, entry: 50, stop: 50, side: 'long' }).ok).toBe(false)
  })

  it('refuses bad inputs and a budget smaller than one share', () => {
    expect(computeSize({ account: 0, riskPct: 1, entry: 50, stop: 49 }).error).toMatch(/account size/)
    expect(computeSize({ account: 1e5, riskPct: 0, entry: 50, stop: 49 }).error).toMatch(/risk percent/)
    expect(computeSize({ account: 1e5, riskPct: 101, entry: 50, stop: 49 }).error).toMatch(/risk percent/)
    expect(computeSize({ account: 100, riskPct: 1, entry: 500, stop: 400 }).error).toMatch(/smaller than one share/)
  })

  it('a short target that would go to zero or below is not offered', () => {
    const r = computeSize({ account: 1e5, riskPct: 1, entry: 10, stop: 14, side: 'short' })
    expect(r.targets.map((t) => t.price)).toEqual([6, 2, null])
  })
})

describe('SizePanel', () => {
  it('works with no ticker: fill in the fields and it sizes the trade', () => {
    render(<SizePanel sym={null} />)
    expect(screen.getByTestId('terminal-size-prompt')).toBeTruthy()
    expect(screen.getByTestId('terminal-size-risk').value).toBe('1')
    type('account', '100000'); type('entry', '50'); type('stop', '47')
    expect(screen.getByTestId('terminal-size-shares').textContent).toBe('333 shares')
    expect(screen.getByTestId('terminal-size-side').textContent).toBe('Long')
    const table = screen.getByTestId('terminal-size-table').textContent
    expect(table).toContain('$999.00')
    expect(table).toContain('$16,650.00')
    expect(screen.getByTestId('terminal-size-target-3R').textContent).toContain('$59.00')
    expect(live.asked.every((t) => t.length === 0)).toBe(true)
  })

  it('a wrong-side stop is refused in words; picking Short sizes it, labelled Short', () => {
    render(<SizePanel sym={null} />)
    type('account', '100000'); type('entry', '50'); type('stop', '52')
    expect(screen.getByTestId('terminal-size-error').textContent).toMatch(/For a long, the stop must be below the entry/)
    fireEvent.click(screen.getByTestId('terminal-size-side-short'))
    expect(screen.getByTestId('terminal-size-side').textContent).toBe('Short')
    expect(screen.getByTestId('terminal-size-target-1R').textContent).toContain('$48.00')
  })

  it('with a ticker the entry is prefilled once from the live price, and typing wins', () => {
    live.prices = { NVDA: { price: 182.456, change_pct: 1 } }
    const { rerender } = render(<SizePanel sym="NVDA" />)
    expect(screen.getByTestId('terminal-size-entry').value).toBe('182.46')
    expect(screen.getByText('Live price for NVDA')).toBeTruthy()
    type('entry', '180')
    live.prices = { NVDA: { price: 190, change_pct: 2 } }
    rerender(<SizePanel sym="NVDA" />)
    expect(screen.getByTestId('terminal-size-entry').value).toBe('180')
  })

  it('a failed price read leaves the entry empty for the member and says so', () => {
    live.error = new Error('live prices down')
    render(<SizePanel sym="NVDA" />)
    expect(screen.getByTestId('terminal-size-entry').value).toBe('')
    expect(screen.getByText('No live price for NVDA right now; type the entry.')).toBeTruthy()
    type('account', '20000'); type('entry', '100'); type('stop', '95')
    expect(screen.getByTestId('terminal-size-shares').textContent).toBe('40 shares')
  })

  it('remembers account and risk % in localStorage only, and survives a throwing storage', () => {
    render(<SizePanel sym={null} />)
    type('account', '75000'); type('risk', '0.5')
    expect(JSON.parse(window.localStorage.getItem(SIZE_STORE_KEY))).toEqual({ account: '75000', riskPct: '0.5' })
    cleanup()
    render(<SizePanel sym={null} />)
    expect(screen.getByTestId('terminal-size-account').value).toBe('75000')
    cleanup()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(loadSizePrefs()).toEqual({ account: '', riskPct: '1' })
    render(<SizePanel sym={null} />)
    act(() => { type('account', '1000') })
    expect(screen.getByTestId('terminal-size-account').value).toBe('1000')
  })

  it('flags a position larger than the account', () => {
    render(<SizePanel sym={null} />)
    type('account', '10000'); type('risk', '2'); type('entry', '100'); type('stop', '99.5')
    expect(screen.getByTestId('terminal-size-margin').textContent).toContain('needs margin')
  })
})

describe('SIZE in the registry', () => {
  it('SIZE and NVDA SIZE both open the Size panel', async () => {
    expect(variantFor('SIZE', false).variant.panel).toBe('Size')
    expect(variantFor('SIZE', true).variant.panel).toBe('Size')
    expect(BY_CODE.SIZE.ticker.flag).toBeUndefined()
    expect(parseCommand('SIZE')).toMatchObject({ ok: true, type: 'function', code: 'SIZE' })
    expect(parseCommand('NVDA SIZE')).toMatchObject({ ok: true, type: 'function', code: 'SIZE', sym: 'NVDA' })
    expect((await PANEL_IMPORTERS.Size()).default).toBe(SizePanel)
  })
})
