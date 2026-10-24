// Notebook widgets client lib (Task 7): the kinds, the one fetch, the node builder, the refresh merge.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WIDGET_KINDS, widgetEmbedNode } from './notebookWidgets'
import { SETTINGS_KEYS } from './notebookSets'
import {
  fetchWidgetPayload, refreshParams, requestParamsOf, REQUEST_KEYS, FETCH_TIMEOUT_MS,
  OFFLINE_SENTENCE, REFRESH_FAILED_SENTENCE, refreshFailureText,
} from './notebookWidgetsFetch'
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
  it('covers all sixteen kinds, in groups, with the account kinds marked', () => {
    expect(WIDGET_KINDS.map((k) => k.id)).toEqual([
      'myWatchlistToday', 'myNamesReporting', 'marketOnMyNames',
      'myScreenToday', 'roomBuzzOnMyNames', 'myEarningsReactions', 'tickerCard', 'tickerFlow',
      'myPnlStats', 'myPositionsRisk', 'myRulesCheck', 'myMistakes', 'tradeRecap', 'myPnlCalendar', 'mySetupEdge',
      'builtWidget',
    ])
    for (const k of WIDGET_KINDS) {
      expect(['open', 'plan', 'review']).toContain(k.group)
      expect(typeof k.title).toBe('string')
      // Wave 6 rows carry no keywords unless the title misses a word (first-open bytes); the title is matched.
      expect(k.keywords === undefined || Array.isArray(k.keywords)).toBe(true)
      expect(Number.isInteger(k.wave)).toBe(true)
    }
    expect(WIDGET_KINDS.filter((k) => k.account).map((k) => k.id))
      .toEqual(['myPnlStats', 'myPositionsRisk', 'myRulesCheck', 'myMistakes', 'tradeRecap', 'myPnlCalendar', 'mySetupEdge',
        'builtWidget'])
    // Wave 8: the built kind is the one `built` row, an account kind under Reviewing.
    expect(WIDGET_KINDS.filter((k) => k.built).map((k) => [k.id, k.wave, k.group, k.title]))
      .toEqual([['builtWidget', 8, 'review', 'Widget']])
    // The two that need a choice (a trade, a screen) are listed by the / menu, never inserted bare.
    expect(WIDGET_KINDS.filter((k) => k.pick).map((k) => k.id)).toEqual(['myScreenToday', 'tradeRecap'])
    expect(WIDGET_KINDS.filter((k) => k.wave === 6).map((k) => k.id).sort())
      .toEqual(['myEarningsReactions', 'myPnlCalendar', 'myScreenToday', 'mySetupEdge', 'roomBuzzOnMyNames', 'tradeRecap'])
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
  it('carries the wave-6 request keys (month, definitionId, tradeId) back to the endpoint', () => {
    expect(requestParamsOf({ month: '2026-09', days: [] })).toEqual({ month: '2026-09' })
    expect(requestParamsOf({ definitionId: 'u:abc', hits: [] })).toEqual({ definitionId: 'u:abc' })
    expect(requestParamsOf({ tradeId: 'tr-1', symbol: 'NVDA' })).toEqual({ tradeId: 'tr-1', symbol: 'NVDA' })
  })

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

  // F3 item 2: the 400 body is read with explicit handling, not `.catch(() => null)` (swallowedFetch census).
  it('a 400 carries the server sentence; a 400 with no readable sentence is failed with no message', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ detail: 'month must be between 2020-01 and 2026-10' }) })
    await expect(fetchWidgetPayload('myPnlCalendar', { month: '1999-01' })).resolves.toEqual({
      ok: false, reason: 'failed', message: 'month must be between 2020-01 and 2026-10',
    })
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 400, json: async () => { throw new SyntaxError('Unexpected token') } })
    await expect(fetchWidgetPayload('myPnlCalendar', { month: '1999-01' })).resolves.toEqual({ ok: false, reason: 'failed' })
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ detail: '' }) })
    await expect(fetchWidgetPayload('myPnlCalendar')).resolves.toEqual({ ok: false, reason: 'failed' })
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 400, json: async () => null })
    await expect(fetchWidgetPayload('myPnlCalendar')).resolves.toEqual({ ok: false, reason: 'failed' })
  })

  it('a request that never answers is given up as failed at FETCH_TIMEOUT_MS, never a throw', async () => {
    vi.useFakeTimers()
    try {
      fetchSpy.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }))
      const pending = fetchWidgetPayload('myPnlStats')
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
      await expect(pending).resolves.toEqual({ ok: false, reason: 'failed' })
      expect(refreshFailureText('failed')).toBe(REFRESH_FAILED_SENTENCE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks the kind path with only the request keys', async () => {
    const got = await fetchWidgetPayload('tickerCard', { symbol: 'NVDA', share: true, price: 3 })
    expect(got.ok).toBe(true)
    expect(got.payload.asOf).toBe('2026-10-20T13:14:00Z')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/j2/notebook-widgets/tickerCard?symbol=NVDA')
    // F3 item 5: a read, said as a literal GET (doorEnumeration reads the method through the signal spread).
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include' })
  })

  it('passes month, definitionId and tradeId, the server SETTING_KEYS, and still nothing else', async () => {
    await fetchWidgetPayload('tradeRecap', { tradeId: 'tr-1', pnl: 5, share: true })
    await fetchWidgetPayload('myPnlCalendar', { month: '2026-09', days: [] })
    await fetchWidgetPayload('myScreenToday', { definitionId: 'u:abc', hits: [] })
    expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual([
      '/api/j2/notebook-widgets/tradeRecap?tradeId=tr-1',
      '/api/j2/notebook-widgets/myPnlCalendar?month=2026-09',
      '/api/j2/notebook-widgets/myScreenToday?definitionId=u%3Aabc',
    ])
    // ONE list of request keys: the fetch reads the presets' SETTINGS_KEYS (the parity rail's client side).
    expect(REQUEST_KEYS).toBe(SETTINGS_KEYS)
  })

  it('a refresh keeps the wave-6 request keys it was asked with', () => {
    const next = refreshParams({ tradeId: 'tr-1', share: true }, { asOf: 'x', symbol: 'NVDA' })
    expect(next).toMatchObject({ tradeId: 'tr-1', symbol: 'NVDA', share: true })
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
