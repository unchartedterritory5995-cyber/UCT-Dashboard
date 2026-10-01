// app/src/components/chart/engine/useLowerTfSources.test.jsx
//
// ─── ⭐⭐ C41 — THE SUPPLY HOOK FETCHES NOTHING IT WAS NOT ASKED FOR ────────────
//
// `request.security(syminfo.tickerid, "60", …)` on a daily chart reads the chart
// symbol's INTRADAY bars (`lowerTf.js`), and `useLowerTfSources` is the one place
// a chart asks for them. It is wired into `StockChart.jsx`, which every chart on
// every surface mounts — so the rule this file exists for is the cost rule:
//
//   ⛔ A CHART WITH NO SUCH INDICATOR MAKES NO EXTRA REQUEST. Zero.
//
// and, for the charts that do have one: one request per STORE timeframe the codes
// are built from (15, 60 and 240 are all built from the store's 15 → ONE request),
// never above the route's 60,000-bar cap, deduped through the same cache a `sym:`
// source uses.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { useLowerTfSources } from './useSecondarySources'
import { clearSecondaryBars, inflightCount } from './secondaryBars'
import { BARS_ROUTE_MAX } from './lowerTf'

const PINE = { recurrenceOrigin: 'pine' }
const DEFS = {
  plain: { id: 'plain', meta: {} },                                   // a native indicator
  pineNoLower: { id: 'pineNoLower', meta: { ...PINE } },              // a Pine script with no lower read
  pineOther: { id: 'pineOther', meta: { ...PINE, otherSymbols: [{ ticker: 'SPY', spellings: ['AMEX'] }] } },
  ribbon: { id: 'ribbon', meta: { ...PINE, lowerTf: ['15', '60', '240'] } }, // ema-ribbon's three reads
  mixed: { id: 'mixed', meta: { ...PINE, lowerTf: ['5', '60'] } },
}
const defOf = (id) => DEFS[id] || null
const payload = { bars: [{ t: 1790343000, o: 1, h: 1, l: 1, c: 1, v: 1 }] }

function mount(instanceList, { sym = 'RDDT', tf = 'D', barCount = 5000 } = {}) {
  const fetcher = vi.fn(() => Promise.resolve(payload))
  const instances = () => instanceList
  const hook = renderHook(
    (props) => useLowerTfSources(props.instances, defOf, props.sym, props.tf, props.barCount, fetcher, props.rev),
    { initialProps: { instances, sym, tf, barCount, rev: 0 } })
  return { fetcher, hook, instances }
}

beforeEach(() => { clearSecondaryBars() })

describe('C41 — a chart with no lower-timeframe read fetches NOTHING', () => {
  it('⛔ no instances, native instances, Pine scripts that read no lower timeframe: zero requests', () => {
    for (const list of [
      [],
      null,
      [{ instanceId: 'a', defId: 'plain' }],
      [{ instanceId: 'a', defId: 'pineNoLower' }, { instanceId: 'b', defId: 'pineOther' }],
      [{ instanceId: 'a', defId: 'not-installed' }],
    ]) {
      const { fetcher, hook } = mount(list)
      expect(fetcher).not.toHaveBeenCalled()
      expect(inflightCount()).toBe(0)
      expect(hook.result.current).toBe(null)
      hook.unmount()
    }
  })

  it('⛔ a chart period no lower read is served on (intraday, monthly) fetches nothing either', () => {
    for (const tf of ['60', '5', 'M']) {
      const { fetcher, hook } = mount([{ instanceId: 'a', defId: 'ribbon' }], { tf })
      expect(fetcher, tf).not.toHaveBeenCalled()
      expect(hook.result.current, tf).toBe(null)
      hook.unmount()
    }
  })

  it('⛔ a hidden indicator, and a chart with no symbol, fetch nothing', () => {
    const hidden = mount([{ instanceId: 'a', defId: 'ribbon', hidden: true }])
    expect(hidden.fetcher).not.toHaveBeenCalled()
    hidden.hook.unmount()
    const noSym = mount([{ instanceId: 'a', defId: 'ribbon' }], { sym: '' })
    expect(noSym.fetcher).not.toHaveBeenCalled()
  })

  it('control: the SAME chart with the indicator added does fetch (the rail can see a request)', async () => {
    const { fetcher, hook } = mount([{ instanceId: 'a', defId: 'pineNoLower' }])
    expect(fetcher).not.toHaveBeenCalled()
    hook.rerender({ instances: () => [{ instanceId: 'a', defId: 'pineNoLower' }, { instanceId: 'b', defId: 'ribbon' }],
      sym: 'RDDT', tf: 'D', barCount: 5000, rev: 1 })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  })
})

describe('C41 — a chart WITH one: one request per store timeframe, capped, deduped', () => {
  it('⭐ ema-ribbon\'s 15 / 60 / 240 are ONE request — the chart\'s own ticker at tf=15', async () => {
    const { fetcher, hook } = mount([{ instanceId: 'a', defId: 'ribbon' }])
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(fetcher.mock.calls[0][0]).toBe(`/api/bars/RDDT?tf=15&bars=${BARS_ROUTE_MAX}`)
    await waitFor(() => expect(hook.result.current && hook.result.current.get('15').status).toBe('available'))
    expect([...hook.result.current.keys()]).toEqual(['15'])
    expect(hook.result.current.get('15').bars).toBe(payload.bars)
  })

  it('a script reading "5" and "60" is two requests (tf=5 and tf=15), never more', async () => {
    const { fetcher } = mount([{ instanceId: 'a', defId: 'mixed' }, { instanceId: 'b', defId: 'ribbon' }])
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(fetcher.mock.calls.map((c) => c[0]).sort()).toEqual([
      `/api/bars/RDDT?tf=15&bars=${BARS_ROUTE_MAX}`,
      `/api/bars/RDDT?tf=5&bars=${BARS_ROUTE_MAX}`,
    ])
  })

  it('⛔ the depth never exceeds the route\'s cap, and a shallow chart asks for less', async () => {
    const shallow = mount([{ instanceId: 'a', defId: 'ribbon' }], { barCount: 100 })
    await waitFor(() => expect(shallow.fetcher).toHaveBeenCalledTimes(1))
    const asked = Number(new URL(shallow.fetcher.mock.calls[0][0], 'http://x').searchParams.get('bars'))
    expect(asked).toBeGreaterThan(100 * 26)
    expect(asked).toBeLessThan(BARS_ROUTE_MAX)
    expect(BARS_ROUTE_MAX).toBe(60000)
  })

  it('a second chart on the same symbol, and a re-render that changes nothing, cost no further request', async () => {
    const first = mount([{ instanceId: 'a', defId: 'ribbon' }])
    await waitFor(() => expect(first.hook.result.current && first.hook.result.current.get('15').status).toBe('available'))
    const held = first.hook.result.current
    // a re-render with the same inputs keeps the SAME map (it joins `updateChart`'s dependencies)
    first.hook.rerender({ instances: first.instances, sym: 'RDDT', tf: 'D', barCount: 5000, rev: 0 })
    expect(first.hook.result.current).toBe(held)
    expect(first.fetcher).toHaveBeenCalledTimes(1)
    // a second chart (its own fetcher) reads the cache
    const second = mount([{ instanceId: 'z', defId: 'ribbon' }])
    await act(async () => { await Promise.resolve() })
    expect(second.fetcher).not.toHaveBeenCalled()
    expect(second.hook.result.current.get('15').bars).toBe(payload.bars)
  })

  it('the symbol changing asks for the new symbol\'s bars', async () => {
    const { fetcher, hook, instances } = mount([{ instanceId: 'a', defId: 'ribbon' }])
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    hook.rerender({ instances, sym: 'SPY', tf: 'D', barCount: 5000, rev: 0 })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(fetcher.mock.calls[1][0]).toBe(`/api/bars/SPY?tf=15&bars=${BARS_ROUTE_MAX}`)
  })
})

describe('C41 — the hook is wired into StockChart once, and reaches the binder', () => {
  const SRC = fs.readFileSync(path.resolve(__dirname, '../../StockChart.jsx'), 'utf8')

  it('one call, with the chart\'s own symbol, timeframe, depth and fetcher', () => {
    const calls = SRC.match(/useLowerTfSources\(/g) || []
    expect(calls).toHaveLength(1)
    expect(SRC).toMatch(/const lowerTfSources = useLowerTfSources\(\s*_storedInstances, _defOf, sym, resolvedTf, barCount, instFetcher, userDefsGeneration\)/)
    expect(SRC).toMatch(/import \{[^}]*\buseLowerTfSources\b[^}]*\} from '\.\/chart\/engine\/useSecondarySources'/)
  })

  it('its result is handed to `binder.sync` and is a dependency of the paint', () => {
    expect(SRC).toMatch(/exchangeOf: otherSymbolExchangeOf,\s*lowerTf: lowerTfSources,/)
    // every other mention is the declaration, the hand-off and ONE dependency list
    expect((SRC.match(/\blowerTfSources\b/g) || [])).toHaveLength(3)
    expect(SRC).toMatch(/otherSymbolExchangeOf, lowerTfSources, csView, secondarySources/)
  })
})
