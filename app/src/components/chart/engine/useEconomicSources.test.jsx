import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import * as registry from './nativeRegistry'
import useEconomicSources, { economicSymbolsOf } from './useEconomicSources'
import useEconomicCatalog from './useEconomicCatalog'
import { _resetEconomicForTests, setEconomicFetcher, SOURCE_STATUS } from './economicSeries'
import { CATALOG, cpiPayload } from '../economic/__fixtures__/econCatalog'

const defOf = (id) => registry.getDefinition(id)
const inst = (id, source) => ({ instanceId: id, defId: 'dataSeries', inputs: { source } })

beforeEach(() => { _resetEconomicForTests() })

describe('economicSymbolsOf', () => {
  test('only econ: sources, deduped, first-seen order', () => {
    const list = [inst('a', 'econ:USCPI'), inst('b', 'sym:QQQ:close'), inst('c', 'close'), inst('d', 'econ:UST10Y'), inst('e', 'econ:USCPI'),
      inst('f', 'fund:net_margin'), inst('g', 'econ:AAPL:close')]
    expect(economicSymbolsOf(list, defOf)).toEqual(['USCPI', 'UST10Y'])
  })
})

describe('useEconomicSources', () => {
  test('a chart with no econ: source costs nothing (null map, no request)', async () => {
    const f = vi.fn()
    setEconomicFetcher(f)
    const instances = () => [inst('a', 'sym:QQQ:close')]
    const { result } = renderHook(() => useEconomicSources(instances, defOf, 1))
    expect(result.current).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
  test('an econ: source is fetched once and lands in the map', async () => {
    const f = vi.fn(async (url) => (url.includes('/series/USCPI') ? cpiPayload() : CATALOG))
    setEconomicFetcher(f)
    const list = [inst('a', 'econ:USCPI'), inst('b', 'econ:USCPI')]
    const instances = () => list
    const { result } = renderHook(() => useEconomicSources(instances, defOf, 1))
    await waitFor(() => expect(result.current && result.current.get('USCPI').status).toBe(SOURCE_STATUS.AVAILABLE))
    expect(f.mock.calls.filter(([u]) => u.includes('/series/USCPI'))).toHaveLength(1)
  })
})

describe('useEconomicCatalog — THE switch every econ surface reads', () => {
  test.each([404, 401, 403])('catalogue %i -> not available', async (status) => {
    setEconomicFetcher(async () => { throw Object.assign(new Error('x'), { httpStatus: status }) })
    const { result } = renderHook(() => useEconomicCatalog(true))
    await waitFor(() => expect(result.current.status).not.toBe('loading'))
    expect(result.current.available).toBe(false)
    expect(result.current.list).toEqual([])
  })
  test('200 with rows -> available', async () => {
    setEconomicFetcher(async () => CATALOG)
    const { result } = renderHook(() => useEconomicCatalog(true))
    await waitFor(() => expect(result.current.available).toBe(true))
    expect(result.current.list).toHaveLength(CATALOG.series.length)
  })
  test('200 with NO rows is not available (nothing to offer)', async () => {
    setEconomicFetcher(async () => ({ series: [], attributions: {} }))
    const { result } = renderHook(() => useEconomicCatalog(true))
    await waitFor(() => expect(result.current.status).not.toBe('loading'))
    expect(result.current.available).toBe(false)
  })
  test('inactive -> no request at all', () => {
    const f = vi.fn()
    setEconomicFetcher(f)
    const { result } = renderHook(() => useEconomicCatalog(false))
    expect(result.current).toEqual({ status: 'idle', list: [], available: false })
    expect(f).not.toHaveBeenCalled()
  })
})
