// P3-S1 — the BarStore adapter items pinned by docs/architecture/barstore.md §P2c, wired behind the
// BARSTORE switch (chart/barStoreSwitch.js). Synthetic prices only.
//
//   1. typed 'stale-answer'   — the store's typed warm never answers it (prefetch.review.test pins
//                               the facade); here: no runtime consumer branches on it, and the
//                               type-to-search door calls the store's warm under the switch.
//   2. SWR preload key        — there is none: the handoff prepares THE store key the chart
//                               subscribes to (`chartKeyFor` === the facade's `keyFor`, every tf ×
//                               session), so a prepared set is the chart's first frame.
//   3. memPeek readers        — the handoff's daily fast path and useDayFacts read what the STORE
//                               holds (`peekBars`), not only the mem cache.
//   4. prepareForDisplay signal — the handoff passes one and aborts it when the request is left.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { loadWithBarStore } from '../../testing/barStoreModes'

const calls = vi.hoisted(() => ({ prepare: [] }))
vi.mock('../../data/barStore/prefetch', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    // The intraday prepare never settles here: the test is about who owns its abort.
    prepareForDisplay: vi.fn((sym, tf, opts) => { calls.prepare.push({ sym, tf, signal: opts?.signal ?? null }); return new Promise(() => {}) }),
    prefetchBarsToIDB: vi.fn(),
    peekDisplayable: vi.fn(() => false),
  }
})

const SRC = path.resolve(globalThis.process.cwd(), 'src')
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name)
  if (e.isDirectory()) return walk(p)
  return /\.(js|jsx)$/.test(e.name) && !/\.test\.(js|jsx)$/.test(e.name) ? [p] : []
})

// ⚠️ FIRST in the file: a vi.mock'd module stays in the MOCK registry across vi.resetModules(),
// so the graph that first imports the mocked facade must be this switch-ON one.
describe('P3-S1 adapter items 3 + 4 under BARSTORE', () => {
  let mods
  beforeAll(async () => {
    mods = await loadWithBarStore(true, async () => ({
      useSymbolHandoff: (await import('../../hooks/useSymbolHandoff')).default,
      useDayFacts: (await import('../../pages/breadth/drill/scan/useDayFacts')).default,
      index: await import('../../data/barStore/index'),
      types: await import('../../data/barStore/types'),
      mem: await import('../../utils/barsMemCache'),
    }))
  })
  beforeEach(() => { calls.prepare.length = 0 })

  it('the graph holds the switch ON (non-vacuity)', () => { expect(mods.__barStore).toBe(true) })

  it('4: the intraday prepare carries a signal, aborted when the request is left', () => {
    const { rerender } = renderHook(({ s }) => mods.useSymbolHandoff(s, '5'), { initialProps: { s: 'AAA' } })
    rerender({ s: 'BBB' })
    const first = calls.prepare.find((c) => c.sym === 'BBB')
    expect(first?.signal).toBeTruthy()
    expect(first.signal.aborted).toBe(false)
    rerender({ s: 'CCC' })                     // B is left before it was ever prepared
    expect(first.signal.aborted).toBe(true)
    expect(calls.prepare.some((c) => c.sym === 'CCC' && c.signal && !c.signal.aborted)).toBe(true)
  })

  it('4b: once the handoff COMMITTED, its prepare is not aborted (the chart owns the key now)', async () => {
    const pf = await import('../../data/barStore/prefetch')   // the mock (shared by this graph)
    const { rerender, result } = renderHook(({ s }) => mods.useSymbolHandoff(s, '5'), { initialProps: { s: 'EEE' } })
    rerender({ s: 'FFF' })
    const c = calls.prepare.find((x) => x.sym === 'FFF')
    pf.peekDisplayable.mockReturnValue(true)                  // the poll finds it displayable
    try {
      await act(async () => { await new Promise((r) => setTimeout(r, 80)) })
      expect(result.current).toBe('FFF')
      expect(c.signal.aborted).toBe(false)
    } finally { pf.peekDisplayable.mockReturnValue(false) }
  })

  it('3: a daily set the STORE holds (mem empty) commits the handoff at once and feeds useDayFacts', async () => {
    const store = mods.index.getBarStore()
    const key = mods.types.keyOf({ sym: 'DDD', tf: 'D' })
    const rows = []
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10)
      rows.push({ t: d, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
    }
    store.registry.dispatch(key, { type: 'rest-full', key, gen: store.getSnapshot(key).gen, payload: { ticker: 'DDD', tf: 'D', bars: rows } })
    expect(mods.mem.memPeek('DDD', 'D')).toBeFalsy()            // nothing in mem: the store is the reader
    const { result: facts } = renderHook(() => mods.useDayFacts('DDD', null))
    expect(facts.current?.close).toBe(10.5)
    const { result, rerender } = renderHook(({ s }) => mods.useSymbolHandoff(s, 'D'), { initialProps: { s: 'AAA' } })
    await act(async () => { rerender({ s: 'DDD' }) })
    expect(result.current).toBe('DDD')                          // the held set committed in the same tick
  })
})

describe('P3-S1 adapter item 1 — typed stale-answer', () => {
  it('only the LEGACY warmer produces it, and no runtime module branches on it', () => {
    // Code, not prose: a line's text before any `//` comment.
    const inCode = (f) => fs.readFileSync(f, 'utf8').split(/\r?\n/).some((l) => l.split('//')[0].includes("'stale-answer'"))
    const hits = walk(SRC).filter(inCode)
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    expect(hits).toEqual(['utils/prefetchBars.js'])
  })
  it('the type-to-search door warms through the chart\'s own source', () => {
    const pane = fs.readFileSync(path.join(SRC, 'components/chart/pane/ChartPane.jsx'), 'utf8')
    expect(pane).toMatch(/\(BARSTORE \? storeWarmTypedSymbol : legacyWarmTypedSymbol\)\(s, effectiveTf\)/)
  })
})

describe('P3-S1 adapter item 2 — no SWR preload: the prepared key IS the chart key', () => {
  it('facade keyFor === chartKeyFor for every tf × session (incl. 60m grids and custom tfs)', async () => {
    const { chartKeyFor } = await import('./useBarSnapshotBars')
    // importActual: a mocked module stays in the MOCK registry across `vi.resetModules()`, so
    // importing the mock here would pin it to this (switch-off) graph's store for the suite below.
    const { createPrefetch } = await vi.importActual('../../data/barStore/prefetch')
    for (const ext of [false, true]) {
      const f = createPrefetch({ extended: () => ext })
      for (const tf of ['1', '5', '15', '30', '60', 'D', 'W', 'M', '2', '45', '120']) {
        const chart = chartKeyFor({ sym: 'aaa', resolvedTf: tf, showExtended: ext, replayCutoff: null, hasOverride: false })
        expect(chart, `${tf} ext=${ext}`).toBeTruthy()
        expect(f.keyFor('aaa', tf), `${tf} ext=${ext}`).toBe(chart)
      }
    }
  })
})
