// F2 (ruling R60, privacy audit M-6): a stored value used as a lookup key reads only a map's OWN entries.
// "__proto__" once made TickerFlowEmbed throw ("Objects are not valid as a React child") and the embed fell to its
// error boundary; "constructor" and "toString" reach Object.prototype the same way. Asserted by RENDERED TEXT.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { widgetEmbedNode } from '../../../lib/notebookWidgets'
import { requestParamsOf } from '../../../lib/notebookWidgetsFetch'
import { presetParams } from '../../../lib/notebookSets'
import { own, safeKey } from './SnapshotFrame'
import TickerFlowEmbed from './TickerFlowEmbed'
import MyMistakesEmbed from './MyMistakesEmbed'
import MyNamesReportingEmbed from './MyNamesReportingEmbed'
import MyPositionsRiskEmbed from './MyPositionsRiskEmbed'

const ASOF = '2026-10-20T13:14:00Z'
const BAD = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']
const attrs = (kind, payload) => widgetEmbedNode(kind, { asOf: ASOF, ...payload }).attrs

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))) })
afterEach(() => vi.unstubAllGlobals())

describe('own / safeKey', () => {
  it('answer only a map\'s own entries', () => {
    const MAP = { Bull: 'Bullish' }
    expect(own(MAP, 'Bull')).toBe('Bullish')                         // control
    for (const k of BAD) expect(own(MAP, k), k).toBeUndefined()
    expect(own(MAP, 7)).toBeUndefined()
    expect(safeKey('bmo')).toBe('bmo')                               // control
    for (const k of BAD) expect(safeKey(k), k).toBeUndefined()
  })
})

describe('the embeds render a prototype-shaped stored value as unknown, never crash', () => {
  for (const k of BAD) {
    it(`options flow with direction and side "${k}"`, () => {
      render(<TickerFlowEmbed attrs={attrs('tickerFlow', { source: 'market', symbol: 'NVDA', window: 'Today',
        topPrints: [{ cp: k, strike: 180, exp: '2026-11-21', premium: 1e6, volume: 900, direction: k }] })} />)
      const tr = screen.getByText(/180 Option, 2026-11-21/).closest('tr')
      expect(within(tr).getByRole('button', { name: 'n/a: No direction on record for this contract' })).toBeInTheDocument()
    })
  }

  it('mistakes with trend "__proto__" say the trend is not available', () => {
    render(<MyMistakesEmbed attrs={attrs('myMistakes', { source: 'manual', rows: [
      { mistake: 'fomo', cost30d: -120, countNow: 3, countPrior: 1, trend: '__proto__' }] })} />)
    expect(screen.getByRole('button', { name: 'n/a: Trend not available' })).toBeInTheDocument()
  })

  it('names reporting with timing and source "constructor" reads as not announced, with no stray text', () => {
    render(<MyNamesReportingEmbed attrs={attrs('myNamesReporting', { source: 'market', rows: [
      { symbol: 'NVDA', day: '2026-10-22', timing: 'constructor', sources: ['constructor', 'watchlist'], impliedMovePct: 7.1 }] })} />)
    const tr = screen.getByText('NVDA').closest('tr')
    expect(within(tr).getByText(/time not announced/)).toBeInTheDocument()
    expect(within(tr).getByText('Watchlist')).toBeInTheDocument()
    expect(tr.textContent).not.toMatch(/function|\[object/)
  })

  it('positions with source and priceBasis "toString" show no generated text', () => {
    render(<MyPositionsRiskEmbed attrs={attrs('myPositionsRisk', { source: 'toString', priceBasis: 'toString', rows: [
      { symbol: 'NVDA', kind: 'stock', sizePct: 8, openPnl: 1, stopPrice: 170, distToStopPct: 6, noStop: false }] })} />)
    expect(document.body.textContent).not.toMatch(/function|native code|\[object/)
  })
})

describe('a stored listLabel never becomes a list request key', () => {
  it('requestParamsOf and presetParams drop a prototype-shaped label', () => {
    for (const k of BAD) {
      expect(requestParamsOf({ listLabel: k }), k).toEqual({})
      expect(presetParams({ params: { listLabel: k } }), k).toEqual({ share: false })
    }
    // Control: a real label still maps.
    expect(requestParamsOf({ listLabel: 'Flagged' })).toEqual({ list: 'flagged' })
    expect(presetParams({ params: { listLabel: 'Watchlist' } })).toEqual({ list: 'watchlist', share: false })
  })
})
