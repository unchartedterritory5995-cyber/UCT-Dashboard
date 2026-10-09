// app/src/components/chart/engine/__tests__/secondarySourcesRevalidate.test.jsx
//
// ─── ⭐ BATCH 2 — A SAVED INDICATOR'S OTHER SYMBOL IS ASKED FOR AFTER A RELOAD ───
//
// On a reload the chart restores its instances before the member's saved
// definitions finish loading, so `defOf(defId)` answers null on the first pass and
// the needed-symbol set is empty. `_defOf` never changes identity, so the set was
// never read again: a saved table's `sym("SPY", …)` cell stayed blank (measured in
// the 10-09 sandbox; OPEN-FINDINGS §6). StockChart now hands the hook a revalidate
// value that moves with `userDefsGeneration`.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import STOCKCHART_SRC from '../../../StockChart.jsx?raw'
import { useSecondarySources } from '../useSecondarySources'
import { clearSecondaryBars } from '../secondaryBars'

const SPY_TREE = { type: 'op', name: '/', args: [{ type: 'series', name: 'close' },
  { type: 'sym', value: 'SPY', args: [{ type: 'series', name: 'close' }] }] }
const SAVED = { id: 'u_aaaaaaaaaaaa', meta: {}, compute: { kind: 'ast', ast: SPY_TREE } }
const payload = { bars: [{ t: 1790343000, o: 1, h: 1, l: 1, c: 1, v: 1 }] }

beforeEach(() => { clearSecondaryBars() })

describe('the other-symbol supply re-asks when the definitions land', () => {
  it('⛔ nothing is fetched while the definition is unknown; a new revalidate value after it loads fetches SPY', () => {
    let loaded = false
    const defOf = (id) => (loaded && id === SAVED.id ? SAVED : null)
    const instances = () => [{ instanceId: `inst:${SAVED.id}:1`, defId: SAVED.id }]
    const fetcher = vi.fn(() => Promise.resolve(payload))
    const hook = renderHook((p) => useSecondarySources(instances, defOf, 'D', 600, fetcher, p.rev),
      { initialProps: { rev: { gen: 0 } } })
    expect(fetcher).not.toHaveBeenCalled()
    expect(hook.result.current).toBe(null)              // needs nothing yet: no key, no request

    loaded = true
    hook.rerender({ rev: { gen: 1 } })                  // the definitions land: a new value
    const map = hook.result.current
    expect(map && typeof map.get === 'function').toBe(true)
    expect(map.has('SPY')).toBe(true)                   // asked for (loading, then its bars)
    hook.unmount()
  })

  it('the SAME revalidate value does not re-ask (the bug, pinned so the wiring below is what fixes it)', () => {
    let loaded = false
    const defOf = (id) => (loaded && id === SAVED.id ? SAVED : null)
    const instances = () => [{ instanceId: `inst:${SAVED.id}:1`, defId: SAVED.id }]
    const fetcher = vi.fn(() => Promise.resolve(payload))
    const rev = { gen: 0 }
    const hook = renderHook((p) => useSecondarySources(instances, defOf, 'D', 600, fetcher, p.rev),
      { initialProps: { rev } })
    loaded = true
    hook.rerender({ rev })
    expect(hook.result.current).toBe(null)
    expect(fetcher).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('⭐ StockChart passes a revalidate value that moves with userDefsGeneration to both other-symbol hooks', () => {
    const SRC = STOCKCHART_SRC
    expect(SRC).toMatch(/const _otherSymbolsRevalidate = useMemo\(\(\) => \(\{ csView, userDefsGeneration \}\), \[csView, userDefsGeneration\]\)/)
    expect(SRC).toMatch(/useSecondarySources\(\s*_storedInstances, _defOf, resolvedTf, barCount, instFetcher, _otherSymbolsRevalidate\)/)
    expect(SRC).toMatch(/useOtherSymbolExchanges\(_storedInstances, _defOf, _otherSymbolsRevalidate\)/)
  })
})
