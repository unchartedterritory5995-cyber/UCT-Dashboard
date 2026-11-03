// app/src/components/chart/engine/__tests__/dataSourcesRevalidate.test.jsx
//
// ─── ⭐ 2026-11-01 — A SAVED `fund:` / MARKET CAP / `econ:` SOURCE IS ASKED FOR AFTER A RELOAD ───
//
// OPEN-FINDINGS-2026-10 §10. On a reload the chart restores its instances before the
// member's saved definitions finish loading, so `defOf(defId)` answers null on the
// first pass and the needed set is empty. `_defOf` never changes identity, and these
// three hooks were handed `csView` / `cs` to revalidate on — values that do not move
// when the definitions land — so the source stayed blank until the member changed the
// view. Same defect and same fix as the other-symbol hooks
// (`secondarySourcesRevalidate.test.jsx`): a revalidate value that moves with
// `userDefsGeneration`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import STOCKCHART_SRC from '../../../StockChart.jsx?raw'
import * as registry from '../nativeRegistry'
import useEconomicSources from '../useEconomicSources'
import { _resetEconomicForTests, setEconomicFetcher, SOURCE_STATUS } from '../economicSeries'
import { CATALOG, cpiPayload } from '../../economic/__fixtures__/econCatalog'

const inst = (id, source) => ({ instanceId: id, defId: 'dataSeries', inputs: { source } })

beforeEach(() => { _resetEconomicForTests() })

describe('a data source re-asks when the definitions land', () => {
  it('nothing is asked while the definition is unknown; a NEW revalidate value after it loads fetches it', async () => {
    let loaded = false
    const defOf = (id) => (loaded ? registry.getDefinition(id) : null)
    const f = vi.fn(async (url) => (url.includes('/series/USCPI') ? cpiPayload() : CATALOG))
    setEconomicFetcher(f)
    const list = [inst('a', 'econ:USCPI')]
    const instances = () => list
    const hook = renderHook((p) => useEconomicSources(instances, defOf, p.rev), { initialProps: { rev: { gen: 0 } } })
    expect(hook.result.current).toBeNull()
    expect(f).not.toHaveBeenCalled()

    loaded = true
    hook.rerender({ rev: { gen: 1 } })               // the definitions land: a new value
    await waitFor(() => expect(hook.result.current && hook.result.current.get('USCPI').status).toBe(SOURCE_STATUS.AVAILABLE))
    hook.unmount()
  })

  it('the SAME revalidate value does not re-ask (the bug, pinned so the wiring below is what fixes it)', () => {
    let loaded = false
    const defOf = (id) => (loaded ? registry.getDefinition(id) : null)
    const f = vi.fn(async () => CATALOG)
    setEconomicFetcher(f)
    const instances = () => [inst('a', 'econ:USCPI')]
    const rev = { gen: 0 }
    const hook = renderHook((p) => useEconomicSources(instances, defOf, p.rev), { initialProps: { rev } })
    loaded = true
    hook.rerender({ rev })
    expect(hook.result.current).toBeNull()
    expect(f).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('⭐ StockChart hands all three data-source hooks a revalidate value that moves with userDefsGeneration', () => {
    const SRC = STOCKCHART_SRC
    expect(SRC).toMatch(/useFundamentalSources\(_storedInstances, _defOf, sym, _otherSymbolsRevalidate\)/)
    expect(SRC).toMatch(/useMarketCapAuthority\(_storedInstances, _defOf, sym, _otherSymbolsRevalidate\)/)
    expect(SRC).toMatch(/const _economicRevalidate = useMemo\(\(\) => \(\{ cs, userDefsGeneration \}\), \[cs, userDefsGeneration\]\)/)
    expect(SRC).toMatch(/useEconomicSources\(_storedInstances, _defOf, _economicRevalidate\)/)
    // and the shared value is the one that moves with the definitions
    expect(SRC).toMatch(/const _otherSymbolsRevalidate = useMemo\(\(\) => \(\{ csView, userDefsGeneration \}\), \[csView, userDefsGeneration\]\)/)
  })
})
