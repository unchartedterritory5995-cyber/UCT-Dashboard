// app/src/lib/panelContract.test.js — TERM-024: the contract's runtime behaviour.
//
//     cd app && npx vitest run src/lib/panelContract.test.js
//
// The static half (who may construct a transport; every call site states its
// delivery) is `panelContract.rail.test.js`. This file proves what a panel
// actually gets back, and that the required field has no default.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./priceStreamManager', () => ({
  subscribe: vi.fn(() => 'unsub-prices'),
  getSnapshot: vi.fn(() => ({ prices: { NVDA: 1 } })),
}))
vi.mock('./barsStreamManager', () => ({
  subscribe: vi.fn(() => 'unsub-bars'),
  getStatus: vi.fn(() => ({ connected: true, healthy: true, delivering: false })),
}))

import * as priceStreamManager from './priceStreamManager'
import * as barsStreamManager from './barsStreamManager'
import {
  declareNeed, deliveryOf, DELIVERY, NEED_KINDS, PanelContractError,
} from './panelContract'

beforeEach(() => { vi.clearAllMocks() })

describe('declareNeed — a panel gets a handle, never a URL', () => {
  it('the handle carries exactly kind, delivery, subscribe and read — no URL, no transport', () => {
    const h = declareNeed({ kind: 'bars', delivery: DELIVERY.LAST_VALUE_WINS })
    expect(Object.keys(h).sort()).toEqual(['delivery', 'kind', 'read', 'subscribe'])
    expect(Object.isFrozen(h)).toBe(true)
    const strings = Object.values(h).filter((v) => typeof v === 'string')
    expect(strings.some((s) => s.includes('/'))).toBe(false)
  })

  it('the bars handle forwards to the shared bars pool, arguments and return value intact', () => {
    const h = declareNeed({ kind: 'bars', delivery: DELIVERY.LAST_VALUE_WINS })
    const cbs = { onBar: () => {} }
    expect(h.subscribe('NVDA', '5', cbs)).toBe('unsub-bars')
    expect(barsStreamManager.subscribe).toHaveBeenCalledWith('NVDA', '5', cbs)
    expect(h.read('NVDA', '5')).toEqual({ connected: true, healthy: true, delivering: false })
    expect(barsStreamManager.getStatus).toHaveBeenCalledWith('NVDA', '5')
    expect(priceStreamManager.subscribe).not.toHaveBeenCalled()
  })

  it('the prices handle forwards to the shared price pool', () => {
    const h = declareNeed({ kind: 'prices', delivery: DELIVERY.LAST_VALUE_WINS })
    const listener = () => {}
    expect(h.subscribe(['NVDA'], listener)).toBe('unsub-prices')
    expect(priceStreamManager.subscribe).toHaveBeenCalledWith(['NVDA'], listener)
    expect(h.read()).toEqual({ prices: { NVDA: 1 } })
  })
})

describe('delivery — REQUIRED, no default, and checked against the stream', () => {
  it('ACCEPTANCE (b): omitting delivery throws, naming the stream — there is no default', () => {
    expect(() => declareNeed({ kind: 'bars' })).toThrow(PanelContractError)
    expect(() => declareNeed({ kind: 'bars' })).toThrow(/omits `delivery`.*no default/)
    expect(() => declareNeed({ kind: 'bars', delivery: undefined })).toThrow(/omits `delivery`/)
  })

  it('an unknown delivery value throws', () => {
    expect(() => declareNeed({ kind: 'bars', delivery: 'best-effort' }))
      .toThrow(/unknown delivery "best-effort"/)
  })

  it('a delivery that disagrees with the stream throws — a panel may not assume', () => {
    expect(() => declareNeed({ kind: 'bars', delivery: DELIVERY.EVERY_MESSAGE_MATTERS }))
      .toThrow(/declares "every-message-matters" but the stream is "last-value-wins"/)
    expect(() => declareNeed({ kind: 'tape', delivery: DELIVERY.LAST_VALUE_WINS }))
      .toThrow(/but the stream is "every-message-matters"/)
  })

  it('both semantics are live in the registry — the distinction is code, not a comment', () => {
    const kinds = NEED_KINDS.map((k) => [k, deliveryOf(k)])
    expect(kinds).toEqual([
      ['prices', 'last-value-wins'],
      ['bars', 'last-value-wins'],
      ['tape', 'every-message-matters'],
    ])
  })
})

describe('what a panel may NOT hand the contract', () => {
  it.each([
    ['a URL', { url: '/api/stream/prices?tickers=NVDA' }],
    ['a budget', { maxSubscribers: 300 }],
    ['a freshness opinion', { staleAfterMs: 120000 }],
  ])('%s is refused by name', (_label, extra) => {
    const [k] = Object.keys(extra)
    expect(() => declareNeed({ kind: 'prices', delivery: DELIVERY.LAST_VALUE_WINS, ...extra }))
      .toThrow(new RegExp(`refused "${k}"`))
  })

  it('an unknown kind is refused, naming the ones that exist', () => {
    expect(() => declareNeed({ kind: 'quotes', delivery: DELIVERY.LAST_VALUE_WINS }))
      .toThrow(/unknown need kind "quotes"; declare one of prices, bars, tape/)
  })

  it('a non-object spec is refused', () => {
    expect(() => declareNeed()).toThrow(PanelContractError)
    expect(() => declareNeed('bars')).toThrow(PanelContractError)
    expect(() => declareNeed([])).toThrow(PanelContractError)
  })

  it('the tape is declared but not yet servable, and says why rather than returning a dead handle', () => {
    expect(() => declareNeed({ kind: 'tape', delivery: DELIVERY.EVERY_MESSAGE_MATTERS }))
      .toThrow(/not yet servable: there is no shared client pool for the options tape/)
  })
})
