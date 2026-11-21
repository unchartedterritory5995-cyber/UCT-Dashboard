// MKTS's model: the snapshot, the Treasury curve and the Bitcoin quote -> the board's rows. Rails:
//   * a leg the server could not price (it sends a dash) is null, never a 0, and is named;
//   * the snapshot's read states (failed, no price at all, ok with some missing) are told apart;
//   * the snapshot's as-of is when the screen read it; the yields carry the curve's own date;
//   * the Bitcoin row is the quote route's price when it gave one, else the snapshot's leg, and only
//     the quote route's pair is a link.
// Every number is invented; the fixtures are the routes' real shapes.
import { describe, it, expect } from 'vitest'
import { pairQuoteView } from '../../../lib/cryptoPairs'
import { ratesRead } from './ratesModel'
import {
  MKTS_CODE, MKTS_FUNDS, MKTS_PAIR, MKTS_POLL_MS, MKTS_RATE_KEYS, MKTS_SNAPSHOT_SOURCE, MKTS_SNAPSHOT_URL, MKTS_WHAT, bitcoinRow, etClockOf, legOf,
  missingLine, pctText, ratesAsOf, ratesRows, snapshotAsOf, snapshotRead,
} from './marketsBoardModel'

const DASH = '—'
const SNAP = {
  etfs: {
    SPY: { price: '645.12', chg: '+0.43%', css: 'pos' }, QQQ: { price: '560.40', chg: '-0.21%', css: 'neg' },
    IWM: { price: '231.07', chg: '0.00%', css: '' }, DIA: { price: '448.90', chg: '+0.10%', css: 'pos' },
    VIX: { price: '17.20', chg: '-3.10%', css: 'neg' },
  },
  futures: { BTC: { price: '67,123.45', chg: '-1.20%', css: 'neg' } },
}
const H = (d1) => ({ d1, w1: null, m1: null, m3: null, y1: null })
const mat = (key, label, y, d1) => ({ key, label, months: 1, yield: y, was: H(null), change_bp: H(d1) })
const CURVE = {
  status: 'ok', as_of: '2026-11-17',
  maturities: [mat('1m', '1-month', 4.4, 1), mat('3m', '3-month', 4.3, -1), mat('2y', '2-year', 3.7, 0), mat('10y', '10-year', 4.12, 7), mat('30y', '30-year', 4.7, null)],
}

describe('MKTS constants', () => {
  it('reads the snapshot every 30 seconds and lists four funds and four maturities', () => {
    expect([MKTS_CODE, MKTS_WHAT, MKTS_SNAPSHOT_URL, MKTS_POLL_MS, MKTS_PAIR]).toEqual(['MKTS', 'The markets board', '/api/snapshot', 30000, 'BTCUSD'])
    expect([...MKTS_FUNDS]).toEqual(['SPY', 'QQQ', 'IWM', 'DIA'])
    expect([...MKTS_RATE_KEYS]).toEqual(['3m', '2y', '10y', '30y'])
    expect(MKTS_SNAPSHOT_SOURCE).toBe('UCT market snapshot (Massive for the funds, Yahoo Finance for VIX and Bitcoin)')
  })
})

describe('MKTS one snapshot leg', () => {
  it('keeps the server\'s own text and reads the direction from the change', () => {
    expect(legOf({ price: '645.12', chg: '+0.43%' })).toEqual({ price: '645.12', chg: '+0.43%', dir: 'up' })
    expect(legOf({ price: '67,123.45', chg: '-1.20%' })).toEqual({ price: '67,123.45', chg: '-1.20%', dir: 'down' })
    expect(legOf({ price: '231.07', chg: '0.00%' })).toEqual({ price: '231.07', chg: '0.00%', dir: 'flat' })
    expect(legOf({ price: ' 17.20 ', chg: ' -3.10% ' })).toEqual({ price: '17.20', chg: '-3.10%', dir: 'down' })
    expect(legOf({ price: 645.12, chg: '+0.43%' }).price).toBe('645.12')
  })

  it('a dash, a blank, a word or a 0 is no price, and a leg with no price has no change', () => {
    const none = { price: null, chg: null, dir: null }
    for (const bad of [{ price: DASH, chg: DASH }, { price: '', chg: '+0.43%' }, { price: 'N/A', chg: '+0.43%' }, { price: '0', chg: '0.00%' },
      { price: '0.00', chg: '+1.00%' }, { price: -5, chg: '+1.00%' }, { price: null }, {}, null, undefined, 'x']) {
      expect(legOf(bad), JSON.stringify(bad)).toEqual(none)
    }
    // a price with a change the server could not work out keeps the price and says no change
    expect(legOf({ price: '645.12', chg: DASH })).toEqual({ price: '645.12', chg: null, dir: null })
    expect(legOf({ price: '645.12', chg: '+0.43' })).toEqual({ price: '645.12', chg: null, dir: null })
  })
})

describe('MKTS the snapshot', () => {
  it('lists the four funds in the board\'s order, then VIX and Bitcoin, each with its name', () => {
    const view = snapshotRead(SNAP)
    expect(view.state).toBe('ok')
    expect(view.missing).toEqual([])
    expect(view.funds.map((r) => [r.sym, r.name, r.price, r.chg, r.dir])).toEqual([
      ['SPY', 'S&P 500 ETF', '645.12', '+0.43%', 'up'], ['QQQ', 'Nasdaq 100 ETF', '560.40', '-0.21%', 'down'],
      ['IWM', 'Russell 2000 ETF', '231.07', '0.00%', 'flat'], ['DIA', 'Dow 30 ETF', '448.90', '+0.10%', 'up'],
    ])
    expect(view.vix).toEqual({ sym: 'VIX', name: 'VIX, the volatility index', price: '17.20', chg: '-3.10%', dir: 'down' })
    expect(view.btc).toEqual({ sym: 'BTC', name: 'Bitcoin', price: '67,123.45', chg: '-1.20%', dir: 'down' })
  })

  it('a leg with no price is named as missing and stays null; the rest still read', () => {
    const view = snapshotRead({ etfs: { ...SNAP.etfs, IWM: { price: DASH, chg: DASH }, VIX: undefined }, futures: {} })
    expect(view.state).toBe('ok')
    expect(view.missing).toEqual(['IWM', 'VIX', 'Bitcoin'])
    expect(view.funds[2]).toEqual({ sym: 'IWM', name: 'Russell 2000 ETF', price: null, chg: null, dir: null })
    expect(view.vix.price).toBeNull()
    expect(view.btc.price).toBeNull()
    expect(view.funds[0].price).toBe('645.12')
    expect(missingLine(view.missing)).toBe('No price for IWM, VIX and Bitcoin in this read. That is a missing price, not a zero.')
    expect(missingLine(['VIX'])).toBe('No price for VIX in this read. That is a missing price, not a zero.')
    expect(missingLine(['IWM', 'VIX'])).toBe('No price for IWM and VIX in this read. That is a missing price, not a zero.')
    expect(missingLine([])).toBe('')
  })

  it('tells "not the route\'s answer" from "the route answered with no price at all"', () => {
    for (const bad of [null, undefined, [], 'x', {}, { detail: 'nope' }, { etfs: [], futures: 'x' }]) expect(snapshotRead(bad).state, JSON.stringify(bad)).toBe('failed')
    const dashes = Object.fromEntries(['SPY', 'QQQ', 'IWM', 'DIA', 'VIX'].map((s) => [s, { price: DASH, chg: DASH }]))
    const none = snapshotRead({ etfs: dashes, futures: { BTC: { price: DASH, chg: DASH } } })
    expect(none.state).toBe('none')
    expect(none.missing).toEqual(['SPY', 'QQQ', 'IWM', 'DIA', 'VIX', 'Bitcoin'])
    expect(snapshotRead({ etfs: {} }).state).toBe('none')
    // one priced leg is an answer
    expect(snapshotRead({ etfs: dashes, futures: SNAP.futures }).state).toBe('ok')
  })
})

describe('MKTS as-of words', () => {
  it('the snapshot carries no time, so its as-of is when the screen read it, in New York time', () => {
    expect(etClockOf('2026-11-19T19:32:00Z')).toBe('2:32 PM ET')
    expect(etClockOf('2026-07-01T13:05:00Z')).toBe('9:05 AM ET')          // daylight time is read, not guessed
    expect([etClockOf('nope'), etClockOf(null), etClockOf('')]).toEqual([null, null, null])
    expect(snapshotAsOf('2026-11-19T19:32:00Z')).toBe('prices read 2:32 PM ET')
    expect(snapshotAsOf(null)).toBe('prices carry no time')
  })

  it('the yields carry the curve\'s own date', () => {
    expect(ratesAsOf(ratesRead(CURVE))).toBe('as of Nov 17, 2026')
    expect(ratesAsOf({ state: 'computing' })).toBe('undated')
    expect(ratesAsOf(null)).toBe('undated')
  })
})

describe('MKTS the rates rows', () => {
  it('lists the 3-month, 2-year, 10-year and 30-year with the day\'s change in basis points', () => {
    expect(ratesRows(ratesRead(CURVE))).toEqual([
      { key: '3m', label: '3-month Treasury', yieldText: '4.30%', changeText: '-1 bp', dir: 'down' },
      { key: '2y', label: '2-year Treasury', yieldText: '3.70%', changeText: '0 bp', dir: 'flat' },
      { key: '10y', label: '10-year Treasury', yieldText: '4.12%', changeText: '+7 bp', dir: 'up' },
      { key: '30y', label: '30-year Treasury', yieldText: '4.70%', changeText: 'n/a', dir: null },
    ])
  })

  it('a maturity with no yield is left out, never listed as 0; no curve is no rows', () => {
    const thin = ratesRead({ ...CURVE, maturities: [mat('2y', '2-year', null, 3), mat('10y', '10-year', 4.12, 7)] })
    expect(ratesRows(thin).map((r) => r.key)).toEqual(['10y'])
    for (const none of [null, undefined, { state: 'computing' }, { state: 'unavailable' }, { state: 'failed' }, ratesRead({ status: 'computing' })]) {
      expect(ratesRows(none)).toEqual([])
    }
  })
})

describe('MKTS the Bitcoin row', () => {
  const leg = { sym: 'BTC', name: 'Bitcoin', price: '67,123.45', chg: '-1.20%', dir: 'down' }
  const noLeg = { sym: 'BTC', name: 'Bitcoin', price: null, chg: null, dir: null }
  const quote = (over = {}) => pairQuoteView({ symbol: 'BTCUSD', price: 67250.5, change_pct: 1.234, as_of: 1795116600, source: 'FMP', state: 'fresh', ...over })

  it('a percent change carries a plain sign', () => {
    expect([pctText(1.234), pctText(-0.456), pctText(0), pctText(-0.001), pctText(null), pctText('1')]).toEqual(['+1.23%', '-0.46%', '0.00%', '0.00%', null, null])
  })

  it('is the quote route\'s price when it gave one: the only Bitcoin row that is a link', () => {
    expect(bitcoinRow(quote(), 1.234, leg)).toEqual({ from: 'quote', price: '67,250.50', chg: '+1.23%', dir: 'up', linked: true, asked: false })
    expect(bitcoinRow(quote({ change_pct: -2 }), -2, null)).toMatchObject({ from: 'quote', chg: '-2.00%', dir: 'down' })
    expect(bitcoinRow(quote(), null, leg)).toMatchObject({ from: 'quote', chg: null, dir: null })
    expect(bitcoinRow(quote(), 0, leg)).toMatchObject({ chg: '0.00%', dir: 'flat' })
  })

  it('is the snapshot\'s leg when the quote route is off, and says it was asked when the route gave no price', () => {
    expect(bitcoinRow(null, undefined, leg)).toEqual({ from: 'snapshot', price: '67,123.45', chg: '-1.20%', dir: 'down', linked: false, asked: false })
    expect(bitcoinRow(quote({ price: null, state: 'failed' }), undefined, leg)).toMatchObject({ from: 'snapshot', linked: false, asked: true })
    expect(bitcoinRow(quote({ price: null, state: 'warming' }), undefined, leg)).toMatchObject({ from: 'snapshot', asked: true })
  })

  it('with no price from either it is "none", never a 0', () => {
    expect(bitcoinRow(null, undefined, noLeg)).toEqual({ from: 'none', price: null, chg: null, dir: null, linked: false, asked: false })
    expect(bitcoinRow(null, undefined, null)).toMatchObject({ from: 'none', price: null })
    expect(bitcoinRow(quote({ price: 0 }), 0, noLeg)).toMatchObject({ from: 'none', price: null, asked: true })
  })
})
