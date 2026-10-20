// Notebook widgets client lib (Task 7): the kinds, the one fetch, the node builder, the refresh merge.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  WIDGET_KINDS, fetchWidgetPayload, widgetEmbedNode, refreshParams, requestParamsOf,
  OFFLINE_SENTENCE, REFRESH_FAILED_SENTENCE, refreshFailureText,
} from './notebookWidgets'
import { resolveEmbedRender } from './widgetEmbedCore'

const setOnline = (value) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })

let fetchSpy
beforeEach(() => {
  setOnline(true)
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ asOf: '2026-10-20T13:14:00Z', rows: [] }) }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
  setOnline(true)
})

describe('WIDGET_KINDS', () => {
  it('covers all nine kinds, in groups, with the account kinds marked', () => {
    expect(WIDGET_KINDS.map((k) => k.id)).toEqual([
      'myWatchlistToday', 'myNamesReporting', 'marketOnMyNames', 'tickerCard', 'tickerFlow',
      'myPnlStats', 'myPositionsRisk', 'myRulesCheck', 'myMistakes',
    ])
    for (const k of WIDGET_KINDS) {
      expect(['open', 'plan', 'review']).toContain(k.group)
      expect(typeof k.title).toBe('string')
      expect(Array.isArray(k.keywords)).toBe(true)
      expect(Number.isInteger(k.wave)).toBe(true)
    }
    expect(WIDGET_KINDS.filter((k) => k.account).map((k) => k.id))
      .toEqual(['myPnlStats', 'myPositionsRisk', 'myRulesCheck', 'myMistakes'])
  })
})

describe('refreshParams', () => {
  it('keeps share: true and the symbol the snapshot was asked for', () => {
    const next = refreshParams(
      { symbol: 'NVDA', share: true, asOf: '2026-10-01T13:00:00Z', price: 100 },
      { asOf: '2026-10-20T13:14:00Z', symbol: 'NVDA', price: 187.4 },
    )
    expect(next.share).toBe(true)
    expect(next.symbol).toBe('NVDA')
    expect(next.price).toBe(187.4)
    expect(next.asOf).toBe('2026-10-20T13:14:00Z')
  })

  it('keeps the request keys list, from and to, and a missing share stays off', () => {
    const next = refreshParams({ list: 'flagged', from: '2026-10-13', to: '2026-10-17' }, { asOf: 'x', rows: [] })
    expect(next).toMatchObject({ list: 'flagged', from: '2026-10-13', to: '2026-10-17', share: false })
  })

  it('takes nothing else from the old params', () => {
    const next = refreshParams({ truncated: 3, empty: 'old', share: false }, { asOf: 'x', rows: [] })
    expect(next.truncated).toBeUndefined()
    expect(next.empty).toBeUndefined()
  })
})

describe('requestParamsOf', () => {
  it('recovers the request from what the payload recorded', () => {
    expect(requestParamsOf({ listLabel: 'Flagged' })).toEqual({ list: 'flagged' })
    expect(requestParamsOf({ range: { from: '2026-10-13', to: '2026-10-17' } })).toEqual({ from: '2026-10-13', to: '2026-10-17' })
    expect(requestParamsOf({ symbol: 'NVDA', price: 1 })).toEqual({ symbol: 'NVDA' })
  })
})

describe('fetchWidgetPayload', () => {
  it('returns offline and makes no request when the browser is offline', async () => {
    setOnline(false)
    await expect(fetchWidgetPayload('tickerCard', { symbol: 'NVDA' })).resolves.toEqual({ ok: false, reason: 'offline' })
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('a 404 is unavailable', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) })
    await expect(fetchWidgetPayload('myPnlStats', {})).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })

  it('another error status, a throw and a body with no asOf are failed, never a throw', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    await expect(fetchWidgetPayload('myPnlStats')).resolves.toEqual({ ok: false, reason: 'failed' })
    fetchSpy.mockRejectedValueOnce(new TypeError('network'))
    await expect(fetchWidgetPayload('myPnlStats')).resolves.toEqual({ ok: false, reason: 'failed' })
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ rows: [] }) })
    await expect(fetchWidgetPayload('myPnlStats')).resolves.toEqual({ ok: false, reason: 'failed' })
  })

  it('asks the kind path with only the request keys', async () => {
    const got = await fetchWidgetPayload('tickerCard', { symbol: 'NVDA', share: true, price: 3 })
    expect(got.ok).toBe(true)
    expect(got.payload.asOf).toBe('2026-10-20T13:14:00Z')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/j2/notebook-widgets/tickerCard?symbol=NVDA')
  })
})

describe('widgetEmbedNode', () => {
  it('builds a frozen snapshot whose capturedAt is the payload asOf', () => {
    const payload = { asOf: '2026-10-20T13:14:00Z', source: 'market', symbol: 'NVDA', price: 187.4, history: null }
    const node = widgetEmbedNode('tickerCard', payload)
    expect(node.type).toBe('widgetEmbed')
    expect(node.attrs.widgetId).toBe('tickerCard')
    expect(node.attrs.mode).toBe('snapshot')
    expect(node.attrs.capturedAt).toBe('2026-10-20T13:14:00Z')
    expect(node.attrs.params).toMatchObject({ symbol: 'NVDA', price: 187.4, share: false })
    expect(node.attrs.searchText).toBe('[ticker card: NVDA · as of 2026-10-20]')
    expect(resolveEmbedRender(node.attrs).kind).toBe('live')
  })
})

describe('failure copy', () => {
  it('is the two sentences, offline first', () => {
    expect(refreshFailureText('offline')).toBe(OFFLINE_SENTENCE)
    expect(OFFLINE_SENTENCE).toBe("You're offline. This shows the saved snapshot.")
    expect(refreshFailureText('failed')).toBe(REFRESH_FAILED_SENTENCE)
    expect(refreshFailureText('unavailable')).toBe("Couldn't refresh. The saved snapshot is unchanged.")
  })
})
