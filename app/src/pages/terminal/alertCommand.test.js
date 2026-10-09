// ALRT and W through the REAL grammar: what a member types parses, echoes before Enter, and (for a
// price) creates exactly one alert through the existing /api/watchlist-alerts route.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = vi.hoisted(() => ({ snap: {} }))
vi.mock('../../hooks/livePriceStore', () => ({ getSnapshot: () => store.snap }))
vi.mock('swr', async (importOriginal) => ({ ...(await importOriginal()), mutate: vi.fn() }))

import parseCommand, { formatCommand } from './parseCommand'
import { describeCommand } from './grammar'
import { applyArgs } from './args'
import { BY_CODE } from './functions'
import { ALERTS_URL, inferDirection, parseAlertPrice, planAlert, setAlert } from './alertCommand'

beforeEach(() => { store.snap = {} })

describe('ALRT — the command parse', () => {
  it('NVDA ALRT 950 / >950 / <950 / $950 parse, and the price is an applied argument', () => {
    for (const [line, arg] of [['NVDA ALRT 950', '950'], ['nvda alrt >950', '>950'], ['NVDA ALRT <950.5', '<950.5'], ['ALRT NVDA $950', '$950']]) {
      const cmd = parseCommand(line)
      expect(cmd, line).toMatchObject({ ok: true, type: 'function', code: 'ALRT', sym: 'NVDA', args: [arg] })
      expect(applyArgs(BY_CODE.ALRT.ticker, cmd.args).ignored, line).toEqual([])
    }
    expect(parseCommand('ALRT')).toMatchObject({ ok: true, code: 'ALRT', sym: null, args: [] })
    expect(parseCommand('NVDA ALRT')).toMatchObject({ ok: true, code: 'ALRT', sym: 'NVDA', args: [] })
  })

  it('the echo says what will be set BEFORE Enter, and a bad price is refused with the reason', () => {
    expect(describeCommand(parseCommand('NVDA ALRT 950')))
      .toMatchObject({ tone: 'ok', text: 'Set a price alert: NVDA at $950.00 (above or below is worked out from the current price)' })
    expect(describeCommand(parseCommand('NVDA ALRT <950')).text).toBe('Set a price alert: NVDA below $950.00')
    const bad = describeCommand(parseCommand('NVDA ALRT abc'))
    expect(bad.tone).toBe('warn')
    expect(bad.text).toBe('"ABC" is not a price. Type a number, e.g. NVDA ALRT 950 (or <950 for below, >950 for above).')
    expect(describeCommand(parseCommand('ALRT 950')).text).toBe('Which stock? Put the ticker first: NVDA ALRT 950.')
    expect(describeCommand(parseCommand('NVDA ALRT')).text).toBe('ALRT: Price alerts (set one: NVDA ALRT 950) on NVDA')
  })

  it('parseAlertPrice / planAlert / inferDirection', () => {
    expect(parseAlertPrice('950')).toEqual({ price: 950, direction: null })
    expect(parseAlertPrice('>1,000')).toBeNull()        // a comma splits tokens before this
    expect(parseAlertPrice('0')).toBeNull()
    expect(parseAlertPrice('-5')).toBeNull()
    expect(parseAlertPrice('9.12345')).toBeNull()
    expect(planAlert({ sym: 'NVDA', args: [] })).toEqual({ ok: true, create: false })
    expect(planAlert({ sym: 'NVDA', args: ['950', '960'] }).error).toMatch(/one price at a time/)
    expect(planAlert({ sym: 'NVDA', args: ['<950'] })).toEqual({ ok: true, create: true, sym: 'NVDA', price: 950, direction: 'below' })
    expect(inferDirection(950, 900)).toBe('above')
    expect(inferDirection(850, 900)).toBe('below')
    expect(inferDirection(850, null)).toBeNull()
  })
})

describe('ALRT — setting the alert', () => {
  it('works out "above" from the live price, POSTs ONE alert, and confirms in words', async () => {
    store.snap = { NVDA: { price: 912 } }
    const fetcher = vi.fn(async () => ({ id: 'x1' }))
    const out = await setAlert({ sym: 'NVDA', price: 950, direction: null }, { fetcher })
    expect(fetcher).toHaveBeenCalledTimes(1)               // the store answered: no price read
    expect(fetcher.mock.calls[0][0]).toBe(ALERTS_URL)
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ sym: 'NVDA', target_price: 950, direction: 'above' })
    expect(out.text).toBe('Alert set: NVDA above $950.00 (now $912.00). It rings the bell, and sends email or Discord if you have those on. ALRT lists your alerts.')
  })

  it('reads the price once when the store does not have it, and works out "below"', async () => {
    const fetcher = vi.fn(async (url) => (url.startsWith('/api/live-prices') ? { AMD: { price: 150 } } : { id: 'x2' }))
    const out = await setAlert({ sym: 'AMD', price: 140, direction: null }, { fetcher })
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(['/api/live-prices?tickers=AMD', ALERTS_URL])
    expect(out.direction).toBe('below')
  })

  it('an explicit direction needs no price; no price and no direction is refused in plain English', async () => {
    const fetcher = vi.fn(async (url) => { if (url.startsWith('/api/live-prices')) throw new Error('down'); return { id: 'x3' } })
    const out = await setAlert({ sym: 'ZZZ', price: 5, direction: 'above' }, { fetcher })
    expect(out.text).toBe('Alert set: ZZZ above $5.00. It rings the bell, and sends email or Discord if you have those on. ALRT lists your alerts.')
    await expect(setAlert({ sym: 'ZZZ', price: 5, direction: null }, { fetcher }))
      .rejects.toMatchObject({ memberText: 'No current price for ZZZ right now, so above or below cannot be worked out. Say which: ZZZ ALRT >5 or ZZZ ALRT <5.' })
  })

  it('a price ten times away is called a typo and nothing is posted', async () => {
    store.snap = { NVDA: { price: 180 } }
    const fetcher = vi.fn()
    await expect(setAlert({ sym: 'NVDA', price: 9500, direction: null }, { fetcher }))
      .rejects.toMatchObject({ memberText: expect.stringMatching(/looks like a typo\. Nothing was set\./) })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('a failed save says so — signed out, paywall and outage each in their own words', async () => {
    store.snap = { NVDA: { price: 900 } }
    const failWith = (status) => vi.fn(async () => { const e = new Error('x'); e.status = status; throw e })
    await expect(setAlert({ sym: 'NVDA', price: 950 }, { fetcher: failWith(401) })).rejects.toMatchObject({ memberText: expect.stringMatching(/session has ended/) })
    await expect(setAlert({ sym: 'NVDA', price: 950 }, { fetcher: failWith(402) })).rejects.toMatchObject({ memberText: 'Price alerts need a paid plan.' })
    await expect(setAlert({ sym: 'NVDA', price: 950 }, { fetcher: failWith(500) })).rejects.toMatchObject({ memberText: 'The alert for NVDA could not be saved just now. Nothing was set; try again.' })
  })
})

describe('W — the watchlist monitor from one letter', () => {
  it('W, W 2 and W FLAGGED open MON and say W is also a ticker; $W, W GP, GP W and DES W are untouched', () => {
    expect(parseCommand('W')).toMatchObject({ ok: true, code: 'MON', sym: null, args: [], collision: 'W' })
    expect(parseCommand('w 2')).toMatchObject({ ok: true, code: 'MON', args: ['2'] })
    expect(parseCommand('W flagged')).toMatchObject({ ok: true, code: 'MON', args: ['FLAGGED'] })
    expect(describeCommand(parseCommand('W')).text).toMatch(/W is also a ticker: type \$W for the stock\./)
    expect(formatCommand(parseCommand('W'))).toBe('MON')
    expect(parseCommand('$W')).toMatchObject({ code: 'DES', sym: 'W' })
    expect(parseCommand('W GP')).toMatchObject({ code: 'GP', sym: 'W' })
    expect(parseCommand('GP W')).toMatchObject({ code: 'GP', sym: null, args: ['W'] })
    expect(parseCommand('DES W')).toMatchObject({ code: 'DES', sym: 'W' })
    expect(parseCommand('W:3')).toMatchObject({ type: 'address', address: 'W:3' })
  })

  it('MON takes a list number, W:id or FLAGGED; anything else is said to be not applied', () => {
    expect(parseCommand('MON 2')).toMatchObject({ ok: true, code: 'MON', args: ['2'] })
    expect(applyArgs(BY_CODE.MON.market, ['W:AB12']).props).toEqual({ list: 'W:AB12' })
    expect(applyArgs(BY_CODE.MON.market, ['XYZ']).ignored).toEqual(['XYZ'])
  })
})
