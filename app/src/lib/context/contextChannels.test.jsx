/**
 * TERM-079 (FB-S4-01) — THE TYPED CONTRACT OF A CONTEXT CHANNEL.
 *
 * A channel carries exactly one payload kind, and a publisher that hands it the
 * wrong kind is REFUSED BY NAME: the refusal names the publisher, the channel,
 * the kind the channel carries and the kind it was given, and the held value is
 * untouched. A refusal that said only "invalid" would be a guard nobody can act
 * on; one that silently stored the payload would be no guard at all.
 *
 * Render stability lives in `contextChannels.renderLoop.test.jsx`; the one
 * list-consuming panel lives in `widgets/ScatterWidget.linkedList.test.jsx`.
 */
import { render, screen, act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'

import {
  KIND,
  KINDS,
  channelFor,
  createChannelStore,
  symbolCtx,
  symbolSetCtx,
  listRefCtx,
  timeframeCtx,
  rangeCtx,
  ContextChannelsProvider,
  useChannel,
  usePublish,
} from './contextChannels'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../../pages/charts/WorkspaceContext'
import { ChartsSymContext, useChartsSym } from '../../pages/charts/ChartsSymContext'

// ⛔ DERIVED, never typed: the colour groups are whatever the workspace's own
// fallback says they are. A fifth group added there moves this rail with it.
const COLOR_GROUPS = Object.keys(WORKSPACE_FALLBACK.groupSyms)

describe('the vocabulary — five payload kinds, FDC3 names without the container', () => {
  it('names exactly the five kinds the capability matrix lists', () => {
    expect([...KINDS].sort()).toEqual(['list-ref', 'range', 'symbol', 'symbol-set', 'timeframe'])
  })

  it('every constructor stamps its own kind, so a payload says what it is', () => {
    expect(symbolCtx('NVDA').type).toBe(KIND.SYMBOL)
    expect(symbolSetCtx(['NVDA']).type).toBe(KIND.SYMBOL_SET)
    expect(listRefCtx({ source: 'watchlist', value: '42' }).type).toBe(KIND.LIST_REF)
    expect(timeframeCtx('D').type).toBe(KIND.TIMEFRAME)
    expect(rangeCtx('2026-01-02', '2026-02-03').type).toBe(KIND.RANGE)
  })

  it('channelFor refuses an unknown kind and an empty key BY NAME', () => {
    expect(() => channelFor('ticker', 'A')).toThrow(/unknown channel kind "ticker"/)
    expect(() => channelFor(KIND.LIST_REF, '')).toThrow(/needs a key/)
  })
})

describe('a channel carries ONE kind — the wrong kind is refused by name', () => {
  it('holds a valid list-ref and hands it back', () => {
    const store = createChannelStore()
    const ch = channelFor(KIND.LIST_REF, 'A')
    const res = store.publish(ch, listRefCtx({ source: 'watchlist', value: '42', label: 'Leaders' }), 'WatchlistWidget#1')
    expect(res).toMatchObject({ ok: true, changed: true })
    expect(store.get(ch)).toEqual({ type: 'list-ref', source: 'watchlist', value: '42', label: 'Leaders' })
  })

  it('⛔ a symbol-set published to a list-ref channel is REFUSED, and the refusal names all four facts', () => {
    const store = createChannelStore()
    const ch = channelFor(KIND.LIST_REF, 'A')
    store.publish(ch, listRefCtx({ source: 'flagged', value: '' }), 'WatchlistWidget#1')
    const before = store.get(ch)

    const res = store.publish(ch, symbolSetCtx(['NVDA', 'AMD']), 'ScannerWidget#7')
    expect(res.ok).toBe(false)
    expect(res.code).toBe('WRONG_TYPE')
    expect(res.message).toContain('ScannerWidget#7')    // who
    expect(res.message).toContain('"list-ref:A"')       // where
    expect(res.message).toContain('list-ref')           // what the channel carries
    expect(res.message).toContain('symbol-set')         // what it was handed
    // ...and the held value is exactly what it was, by identity.
    expect(store.get(ch)).toBe(before)
  })

  it('a payload with no type at all is refused as WRONG_TYPE, not stored', () => {
    const store = createChannelStore()
    const ch = channelFor(KIND.RANGE, 'A')
    const res = store.publish(ch, { start: '2026-01-02', end: '2026-01-03' }, 'Anon')
    expect(res).toMatchObject({ ok: false, code: 'WRONG_TYPE' })
    expect(res.message).toContain('(no type)')
    expect(store.get(ch)).toBeNull()
  })

  it('the right kind with a malformed body is refused as INVALID_PAYLOAD, naming the reason', () => {
    const store = createChannelStore()
    const bad = [
      [KIND.SYMBOL_SET, symbolSetCtx(['NVDA', ''])],
      [KIND.SYMBOL_SET, symbolSetCtx('NVDA')],
      [KIND.LIST_REF, listRefCtx({ source: '', value: '1' })],
      [KIND.TIMEFRAME, timeframeCtx('')],
      [KIND.RANGE, rangeCtx('2026-03-01', '2026-02-01')],
      [KIND.RANGE, rangeCtx('2026/03/01', '2026-04-01')],
      [KIND.SYMBOL, symbolCtx('NV DA')],
    ]
    for (const [kind, payload] of bad) {
      const ch = channelFor(kind, 'Z')
      const res = store.publish(ch, payload, 'Probe')
      expect(res, `${kind} ${JSON.stringify(payload)}`).toMatchObject({ ok: false, code: 'INVALID_PAYLOAD' })
      expect(res.message).toContain('Probe')
      expect(store.get(ch)).toBeNull()
    }
  })

  it('an unparseable channel id is refused as UNKNOWN_CHANNEL', () => {
    const store = createChannelStore()
    expect(store.publish('nonsense', symbolCtx('NVDA'), 'Probe')).toMatchObject({ ok: false, code: 'UNKNOWN_CHANNEL' })
  })

  it('onRefuse hears every refusal (the provider logs through it in dev)', () => {
    const onRefuse = vi.fn()
    const store = createChannelStore({ onRefuse })
    store.publish(channelFor(KIND.LIST_REF, 'A'), timeframeCtx('D'), 'Probe')
    expect(onRefuse).toHaveBeenCalledTimes(1)
    expect(onRefuse.mock.calls[0][0]).toMatchObject({ code: 'WRONG_TYPE', publisher: 'Probe' })
  })
})

describe('⛔ no second authority — symbol and timeframe on a colour group belong to WorkspaceContext', () => {
  it.each(COLOR_GROUPS)('symbol:%s is refused as OWNED_ELSEWHERE, naming groupSyms', (g) => {
    const store = createChannelStore()
    const res = store.publish(channelFor(KIND.SYMBOL, g), symbolCtx('NVDA'), 'Probe')
    expect(res).toMatchObject({ ok: false, code: 'OWNED_ELSEWHERE' })
    expect(res.message).toContain('WorkspaceContext.groupSyms')
  })

  it.each(COLOR_GROUPS)('timeframe:%s is refused as OWNED_ELSEWHERE, naming groupTfs', (g) => {
    const store = createChannelStore()
    const res = store.publish(channelFor(KIND.TIMEFRAME, g), timeframeCtx('D'), 'Probe')
    expect(res).toMatchObject({ ok: false, code: 'OWNED_ELSEWHERE' })
    expect(res.message).toContain('WorkspaceContext.groupTfs')
  })

  it('the kinds that had NO home before are free on every colour group', () => {
    const store = createChannelStore()
    for (const g of COLOR_GROUPS) {
      expect(store.publish(channelFor(KIND.LIST_REF, g), listRefCtx({ source: 'flagged' }), 'P').ok).toBe(true)
      expect(store.publish(channelFor(KIND.SYMBOL_SET, g), symbolSetCtx(['A']), 'P').ok).toBe(true)
      expect(store.publish(channelFor(KIND.RANGE, g), rangeCtx('2026-01-02', '2026-01-02'), 'P').ok).toBe(true)
    }
  })
})

describe('a board holds MORE than four linked contexts', () => {
  it('six list-ref channels hold six independent values at once', () => {
    const store = createChannelStore()
    const keys = ['A', 'B', 'C', 'D', 'compare-1', 'compare-2']
    keys.forEach((k, i) => store.publish(channelFor(KIND.LIST_REF, k), listRefCtx({ source: 'watchlist', value: String(i) }), 'P'))
    keys.forEach((k, i) => expect(store.get(channelFor(KIND.LIST_REF, k)).value).toBe(String(i)))
    expect(store.channels().length).toBeGreaterThan(4)
  })
})

describe('ownership, equality and immutability', () => {
  it('equal payload → accepted, changed:false, the held object is not replaced', () => {
    const store = createChannelStore()
    const ch = channelFor(KIND.SYMBOL_SET, 'A')
    store.publish(ch, symbolSetCtx(['NVDA', 'AMD']), 'P')
    const held = store.get(ch)
    expect(store.publish(ch, symbolSetCtx(['NVDA', 'AMD']), 'P')).toMatchObject({ ok: true, changed: false })
    expect(store.get(ch)).toBe(held)
  })

  it('clear() by a publisher that no longer owns the channel is a no-op', () => {
    const store = createChannelStore()
    const ch = channelFor(KIND.LIST_REF, 'A')
    store.publish(ch, listRefCtx({ source: 'watchlist', value: '1' }), 'first')
    store.publish(ch, listRefCtx({ source: 'watchlist', value: '2' }), 'second')
    expect(store.clear(ch, 'first')).toBe(false)
    expect(store.get(ch).value).toBe('2')
    expect(store.clear(ch, 'second')).toBe(true)
    expect(store.get(ch)).toBeNull()
  })

  it('the held value is a frozen copy — a caller mutating its own array changes nothing', () => {
    const store = createChannelStore()
    const ch = channelFor(KIND.SYMBOL_SET, 'A')
    const syms = ['NVDA']
    store.publish(ch, symbolSetCtx(syms), 'P')
    syms.push('AMD')
    expect(store.get(ch).symbols).toEqual(['NVDA'])
    expect(Object.isFrozen(store.get(ch))).toBe(true)
    expect(Object.isFrozen(store.get(ch).symbols)).toBe(true)
  })

  it('⛔ nothing is normalised — a lower-case symbol is held as given (focusDivergence.js rule)', () => {
    const store = createChannelStore()
    const ch = channelFor(KIND.SYMBOL, 'solo')
    store.publish(ch, symbolCtx('nvda'), 'P')
    expect(store.get(ch).symbol).toBe('nvda')
  })
})

describe('the hooks', () => {
  it('off a board, usePublish still refuses a wrong kind BY NAME before reporting NO_BOARD', () => {
    const { result } = renderHook(() => usePublish(channelFor(KIND.LIST_REF, 'A'), 'Loner'))
    const wrong = result.current.publish(symbolSetCtx(['NVDA']))
    expect(wrong).toMatchObject({ ok: false, code: 'WRONG_TYPE' })
    expect(wrong.message).toContain('Loner')
    expect(result.current.publish(listRefCtx({ source: 'flagged' }))).toMatchObject({ ok: false, code: 'NO_BOARD' })
  })

  it('off a board, useChannel reads null', () => {
    const { result } = renderHook(() => useChannel(channelFor(KIND.LIST_REF, 'A')))
    expect(result.current).toBeNull()
  })

  it('useChannel(null) subscribes to nothing and reads null, on a board too', () => {
    const { result } = renderHook(() => useChannel(null), { wrapper: ContextChannelsProvider })
    expect(result.current).toBeNull()
  })

  it('a publish through usePublish reaches useChannel on the same board', () => {
    const ch = channelFor(KIND.LIST_REF, 'B')
    function Pub() {
      const { publish } = usePublish(ch, 'Pub')
      return <button onClick={() => publish(listRefCtx({ source: 'uct20', label: 'UCT 20' }))}>go</button>
    }
    function Sub() {
      const v = useChannel(ch)
      return <span data-testid="v">{v ? v.label : 'none'}</span>
    }
    render(<ContextChannelsProvider><Pub /><Sub /></ContextChannelsProvider>)
    expect(screen.getByTestId('v').textContent).toBe('none')
    act(() => { screen.getByText('go').click() })
    expect(screen.getByTestId('v').textContent).toBe('UCT 20')
  })
})

describe('⛔ LOCKED — the colour-group shim order is unchanged under a channel board', () => {
  function Probe() {
    const { sym } = useChartsSym()
    return <span data-testid="sym">{sym ?? 'null'}</span>
  }

  it('1) an explicit ChartsSymContext still wins, inside a channel board', () => {
    render(
      <ContextChannelsProvider>
        <WorkspaceContext.Provider value={{ ...WORKSPACE_FALLBACK, groupSyms: { A: 'AMD', B: null, C: null, D: null } }}>
          <ChartsSymContext.Provider value={{ sym: 'AAPL', setSym: () => {} }}>
            <Probe />
          </ChartsSymContext.Provider>
        </WorkspaceContext.Provider>
      </ContextChannelsProvider>,
    )
    expect(screen.getByTestId('sym').textContent).toBe('AAPL')
  })

  it('2) without one, Group A of WorkspaceContext — a list-ref on channel A does not leak into the symbol', () => {
    function Host() {
      const [groupSyms] = useState({ A: 'AMD', B: null, C: null, D: null })
      const { publish } = usePublish(channelFor(KIND.LIST_REF, 'A'), 'Host')
      return (
        <WorkspaceContext.Provider value={{ ...WORKSPACE_FALLBACK, groupSyms }}>
          <button onClick={() => publish(listRefCtx({ source: 'watchlist', value: '9' }))}>pub</button>
          <Probe />
        </WorkspaceContext.Provider>
      )
    }
    render(<ContextChannelsProvider><Host /></ContextChannelsProvider>)
    act(() => { screen.getByText('pub').click() })
    expect(screen.getByTestId('sym').textContent).toBe('AMD')
  })

  it('3) outside everything, the null-safe fallback', () => {
    render(<ContextChannelsProvider><Probe /></ContextChannelsProvider>)
    expect(screen.getByTestId('sym').textContent).toBe('null')
  })
})
