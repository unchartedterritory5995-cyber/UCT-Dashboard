// SIZE: the arithmetic (sizeMath.js) and the rendered calculator. Rails:
//   * shares round DOWN so $ at risk never exceeds the budget; targets sit at 1R / 2R / 3R;
//   * a long needs its stop below the entry and a short above; the wrong side is refused in words;
//   * with a ticker the entry is prefilled ONCE from the live price and the member's typing wins;
//   * a failed price read leaves the entry for the member to type and says so;
//   * account and risk % are kept in localStorage only (no server preference), and a throwing
//     storage never breaks the panel;
//   * the registry: `SIZE` and `NVDA SIZE` both open this panel;
//   * the ADR stop (wave 9): one ADR below the entry from 20 completed daily bars, offered with a
//     button and NEVER applied on its own; no ticker, no read; no_data / 404 / warming say so.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'

const live = vi.hoisted(() => ({ prices: {}, error: null, asked: [] }))
vi.mock('../../../hooks/useLivePrices', () => ({
  default: (tickers) => { live.asked.push(tickers); return { prices: live.prices, isLoading: false, error: live.error } },
}))

import SizePanel, { SIZE_STORE_KEY, adrUrl, formingDate, loadSizePrefs } from './SizePanel'
import { ADR_BARS, adrFromBars, adrStop, computeSize, parseNum } from './sizeMath'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'
import parseCommand from '../parseCommand'

// The ADR read: a `fetch` stand-in answering the bars URL with `bars.answer` (a body and a status).
const bars = vi.hoisted(() => ({ answer: null, urls: [] }))
const barsFetch = (url) => {
  bars.urls.push(String(url))
  const a = typeof bars.answer === 'function' ? bars.answer() : bars.answer
  return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body })
}
/** n daily bars whose high/low range is `pct` percent, dated in 2026 before today (never forming). */
const rangeBars = (n, pct = 5) => Array.from({ length: n }, (_, i) => ({
  t: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`, o: 100, h: 100 * (1 + pct / 100), l: 100, c: 101, v: 1000,
}))

beforeEach(() => {
  live.prices = {}
  live.error = null
  live.asked = []
  bars.answer = { status: 200, body: { bars: [], no_data: true } }
  bars.urls = []
  vi.stubGlobal('fetch', vi.fn(barsFetch))
  window.localStorage.clear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

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

describe('sizeMath: the ADR', () => {
  it('ADR% is the mean of high/low - 1 over the last 20 bars', () => {
    expect(adrFromBars({ bars: rangeBars(25, 5) }).adrPct).toBeCloseTo(5, 9)
    const mixed = { bars: [...rangeBars(10, 9), ...rangeBars(10, 2), ...rangeBars(10, 4)] }
    expect(adrFromBars(mixed)).toMatchObject({ n: ADR_BARS })
    expect(adrFromBars(mixed).adrPct).toBeCloseTo(3, 9)              // the oldest 10 (9%) are past the window
  })

  it('fewer than 20 usable bars is no ADR; junk rows are skipped, never counted at zero', () => {
    expect(adrFromBars({ bars: rangeBars(19) })).toBeNull()
    expect(adrFromBars({ bars: [] })).toBeNull()
    expect(adrFromBars(null)).toBeNull()
    const junk = [...rangeBars(19), { t: '2026-03-01', h: null, l: 1 }, { t: '2026-03-02', h: 1, l: 0 }, { t: '2026-03-03', h: 1, l: 2 }]
    expect(adrFromBars({ bars: junk })).toBeNull()
  })

  it('a still-forming bar is left out', () => {
    const rows = [...rangeBars(20, 5), { t: '2026-03-01', o: 100, h: 150, l: 100, c: 120 }]
    const date = (b) => b.t
    expect(adrFromBars({ bars: rows }, { forming: '2026-03-01', barDate: date }).adrPct).toBeCloseTo(5, 9)
    expect(adrFromBars({ bars: rows }, { barDate: date }).adrPct).toBeGreaterThan(5)
  })

  it('the stop sits one ADR below a long entry and above a short one, to the cent', () => {
    expect(adrStop({ entry: '100', adrPct: 4.2, side: 'long' })).toBe(95.8)
    expect(adrStop({ entry: '$1,000', adrPct: 3.333, side: 'short' })).toBe(1033.33)
    expect(adrStop({ entry: '', adrPct: 4 })).toBeNull()
    expect(adrStop({ entry: '100', adrPct: 0 })).toBeNull()
    expect(adrStop({ entry: '100', adrPct: Number.NaN })).toBeNull()
  })

  it('a daily bar is forming only before the 4:00 PM ET close', () => {
    expect(formingDate(new Date('2026-10-09T15:00:00Z'))).toBe('2026-10-09')   // 11:00 ET
    expect(formingDate(new Date('2026-10-09T20:30:00Z'))).toBeNull()           // 16:30 ET
  })
})

describe('SizePanel: the ADR stop', () => {
  const phase = () => screen.getByTestId('terminal-size-adr').dataset.phase

  it('reads 30 daily bars, offers one ADR below the entry, and only the button applies it', async () => {
    live.prices = { NVDA: { price: 200, change_pct: 1 } }
    bars.answer = { status: 200, body: { ticker: 'NVDA', tf: 'D', bars: rangeBars(30, 4) } }
    render(<SizePanel sym="NVDA" />)
    const text = await screen.findByTestId('terminal-size-adr-text')
    expect(text.textContent).toBe('Suggested stop: $192.00 (1 ADR below entry, ADR 4.0%)')
    expect(bars.urls).toEqual([adrUrl('NVDA')])
    expect(adrUrl('NVDA')).toBe('/api/bars/NVDA?tf=D&bars=30')
    expect(screen.getByTestId('terminal-size-stop').value).toBe('')          // never auto-applied
    fireEvent.click(screen.getByTestId('terminal-size-adr-apply'))
    expect(screen.getByTestId('terminal-size-stop').value).toBe('192.00')
  })

  it('a short reads one ADR above the entry', async () => {
    bars.answer = { status: 200, body: { bars: rangeBars(30, 5) } }
    render(<SizePanel sym="NVDA" />)
    type('entry', '100')
    fireEvent.click(screen.getByTestId('terminal-size-side-short'))
    expect((await screen.findByTestId('terminal-size-adr-text')).textContent).toBe('Suggested stop: $105.00 (1 ADR above entry, ADR 5.0%)')
  })

  it('without an entry it gives the ADR and asks for an entry, with no button', async () => {
    bars.answer = { status: 200, body: { bars: rangeBars(30, 3) } }
    render(<SizePanel sym="NVDA" />)
    await waitFor(() => expect(phase()).toBe('ready'))
    expect(screen.getByTestId('terminal-size-adr').textContent).toBe('ADR 3.0%. Enter an entry to see a stop one ADR away.')
    expect(screen.queryByTestId('terminal-size-adr-apply')).toBeNull()
  })

  it('no ticker: no bars read and no suggestion', () => {
    render(<SizePanel sym={null} />)
    expect(screen.queryByTestId('terminal-size-adr')).toBeNull()
    expect(bars.urls).toEqual([])
  })

  it('a no_data answer says there is no ADR stop and offers nothing to apply', async () => {
    bars.answer = { status: 200, body: { ticker: 'ZZZZ', tf: 'D', bars: [], no_data: true, reason: 'symbol_not_carried' } }
    render(<SizePanel sym="ZZZZ" />)
    await waitFor(() => expect(phase()).toBe('none'))
    expect(screen.getByTestId('terminal-size-adr').textContent).toBe('No ADR stop: not enough daily history for ZZZZ.')
    expect(screen.queryByTestId('terminal-size-adr-apply')).toBeNull()
  })

  it('too few bars and a 404 are both no ADR, not an error', async () => {
    bars.answer = { status: 200, body: { bars: rangeBars(12) } }
    render(<SizePanel sym="NEWCO" />)
    await waitFor(() => expect(phase()).toBe('none'))
    cleanup()
    bars.answer = { status: 404, body: { detail: 'no data' } }
    render(<SizePanel sym="NOPE" />)
    await waitFor(() => expect(phase()).toBe('none'))
  })

  it('a warming answer says so, and Retry reads again', async () => {
    let calls = 0
    bars.answer = () => (++calls === 1
      ? { status: 503, body: { ticker: 'NVDA', bars: [], warming: true } }
      : { status: 200, body: { bars: rangeBars(30, 4) } })
    render(<SizePanel sym="NVDA" />)
    await waitFor(() => expect(phase()).toBe('warming'))
    expect(screen.getByTestId('terminal-size-adr').textContent).toContain('Daily history for NVDA is still loading.')
    fireEvent.click(screen.getByTestId('terminal-size-adr-retry'))
    await waitFor(() => expect(phase()).toBe('ready'))
    expect(bars.urls.length).toBe(2)
  })

  it('a 200 warming body and a failed read are told apart', async () => {
    bars.answer = { status: 200, body: { bars: [], warming: true } }
    render(<SizePanel sym="NVDA" />)
    await waitFor(() => expect(phase()).toBe('warming'))
    cleanup()
    bars.answer = { status: 500, body: {} }
    render(<SizePanel sym="NVDA" />)
    await waitFor(() => expect(phase()).toBe('error'))
    expect(screen.getByTestId('terminal-size-adr').textContent).toContain('Could not read the ADR for NVDA just now.')
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
