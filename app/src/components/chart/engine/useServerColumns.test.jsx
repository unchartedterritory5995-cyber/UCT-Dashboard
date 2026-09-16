// app/src/components/chart/engine/useServerColumns.test.jsx
//
// ─── THE LANE'S MISSING HALF ────────────────────────────────────────────────
//
// ⚰️ MEASURED ON PRODUCTION 2026-09-16: `serverCompute.subscribe` was exported and
// documented ("Notified whenever an entry lands, so a host can repaint") and
// **imported by nobody**. The lane fetched, parsed, cached and notified into an
// empty Set, so the RS line appeared only if an UNRELATED repaint happened to
// follow. These cases hold the consumer, and — more importantly — hold that it
// lets go.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { useServerColumns } from './useServerColumns'
import * as lane from './serverCompute'

const HERE = resolve(fileURLToPath(import.meta.url), '..')

let seen = []
function Probe() {
  const generation = useServerColumns()
  seen.push(generation)
  return <i data-testid="g">{generation}</i>
}

afterEach(() => { cleanup(); seen = []; vi.restoreAllMocks() })

describe('⭐⭐ A LANDED FETCH REPAINTS, WITHOUT POLLING', () => {
  it('⛔ subscribes on mount — exactly once, and to THIS lane', () => {
    const spy = vi.spyOn(lane, 'subscribe')
    render(<Probe />)
    expect(spy, 'the hook did not subscribe at all').toHaveBeenCalledTimes(1)
    expect(typeof spy.mock.calls[0][0]).toBe('function')
  })

  it('⭐⭐ a notification changes the returned generation — no timer involved', () => {
    // ⛔ THE POINT OF A COUNTER RATHER THAN THE DATA: `computeFor` is the only
    // caller that knows which (def, sym, tf, inputs) each instance needs, so it
    // keeps reading the cache. All this has to say is "ask again".
    let fire = null
    vi.spyOn(lane, 'subscribe').mockImplementation((fn) => { fire = fn; return () => {} })
    render(<Probe />)
    const before = seen[seen.length - 1]
    act(() => fire('some-key'))
    expect(seen[seen.length - 1], 'a landed column did not move the generation')
      .not.toBe(before)
  })

  it('⛔ and it uses NO timer — a poll would pass the case above and still be wrong', () => {
    vi.useFakeTimers()
    try {
      const setI = vi.spyOn(globalThis, 'setInterval')
      const setT = vi.spyOn(globalThis, 'setTimeout')
      render(<Probe />)
      expect(setI, 'the hook polls on an interval').not.toHaveBeenCalled()
      expect(setT, 'the hook polls on a timeout').not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('⛔⛔ AND IT LETS GO — no listener survives its component', () => {
  it('⭐⭐ unmount removes the listener', () => {
    const unsub = vi.fn()
    vi.spyOn(lane, 'subscribe').mockReturnValue(unsub)
    const { unmount } = render(<Probe />)
    expect(unsub).not.toHaveBeenCalled()
    unmount()
    expect(unsub, 'the listener outlived the chart').toHaveBeenCalledTimes(1)
  })

  it('⭐⭐ REPEATED MOUNT/UNMOUNT DOES NOT ACCUMULATE — the real leak shape', () => {
    // A widget the member opens and closes, a symbol change that remounts, a
    // layout switch, a tab change. Each is one mount and one unmount; if the
    // count ever drifts upward, every landed column repaints N charts that are
    // no longer on screen.
    let live = 0
    vi.spyOn(lane, 'subscribe').mockImplementation(() => {
      live += 1
      return () => { live -= 1 }
    })
    for (let i = 0; i < 12; i++) {
      const { unmount } = render(<Probe />)
      expect(live, `after mount #${i + 1}`).toBe(1)
      unmount()
      expect(live, `after unmount #${i + 1}`).toBe(0)
    }
  })

  it('⛔ a notification that arrives DURING teardown updates nothing', () => {
    // `_notify` runs inside a promise's `finally`, so it can fire between React
    // deciding to unmount and the cleanup running. Without the `alive` latch
    // that is a setState on a dead component.
    let fire = null
    vi.spyOn(lane, 'subscribe').mockImplementation((fn) => { fire = fn; return () => {} })
    const { unmount } = render(<Probe />)
    const countAtUnmount = seen.length
    unmount()
    expect(() => act(() => fire('late-key'))).not.toThrow()
    expect(seen.length, 'a dead component re-rendered').toBe(countAtUnmount)
  })

  it('⛔ ONE listener per mount, NOT one per symbol or timeframe change', () => {
    // An empty dependency array is what makes "one mount, one listener, one
    // removal" provable. A dep on `sym`/`tf` would churn the Set on every
    // keystroke in the symbol box for no gain.
    const src = readFileSync(resolve(HERE, 'useServerColumns.js'), 'utf8')
    expect(src, 'the subscribe effect grew a dependency').toMatch(/\}, \[\]\)/)
    expect(src).toContain('let alive = true')
    expect(src).toContain('return () => { alive = false; unsub() }')
  })
})

describe('⛔ the chart actually consumes it', () => {
  it('⭐⭐ `StockChart` calls the hook AND joins it to the repaint deps', () => {
    // The hook existing and the chart ignoring it is precisely the failure this
    // whole file is about — `subscribe` was exported and unused for a release.
    const src = readFileSync(resolve(HERE, '../../StockChart.jsx'), 'utf8')
    expect(src).toContain("import { useServerColumns } from './chart/engine/useServerColumns'")
    expect(src).toContain('const serverColumnsGeneration = useServerColumns()')
    // ⚠️ ANCHOR ON `secondarySources`, NOT ON `[filteredBars`. There is a
    // one-element `[filteredBars]` array earlier in the file, and anchoring on
    // the opening bracket matched THAT and passed vacuously. `secondarySources`
    // is the sibling lane's signal and appears in exactly one dependency array
    // — the repaint one this must join.
    const deps = src.split(String.fromCharCode(10)).filter((l) => l.includes('secondarySources]')
      || l.includes('secondarySources, serverColumnsGeneration]'))
    expect(deps, 'the repaint dependency array moved — re-anchor this rail').toHaveLength(1)
    expect(deps[0], 'the generation reaches no dependency array')
      .toContain('serverColumnsGeneration')
  })
})
