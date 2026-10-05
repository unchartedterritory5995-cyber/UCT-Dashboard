// ─── B1P — the grid cell's bounded deepen to the listing ──────────────────────
//
// Pins three things, each of which fails silently if cut:
//   1. the FILTER: only a Pine-origin document carrying a switched recurrence
//      (the ceyhun trailing stop) asks for the deepen; a plain script does not;
//   2. the DECISION: only a grid cell (backgroundWarm false, not the maximized
//      deepWarm cell) on DAILY, not pinned to its own window;
//   3. the GATE: a 6-cell board never has more than LISTING_DEEPEN_MAX deepens in
//      flight, and every cell is eventually served.
// Plus the wiring: StockChart routes the deepen through the gate, and the grid
// cell still passes backgroundWarm={false} (CLAUDE.md, Multi-Chart Grid Mode).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  definitionWithholdsOffListing, wantsListingDeepen, createListingDeepenGate, LISTING_DEEPEN_MAX,
} from '../listingDeepen'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const CAP = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'vendor', 'harness',
  'atr-trailing-stop-by-ceyhun-spy-1d-2026-10-02.json')

describe('1 — the filter: which definitions ask for the listing', () => {
  it('⭐ the ceyhun trailing stop (a switched ratchet) asks', () => {
    const source = JSON.parse(fs.readFileSync(CAP, 'utf8')).source.text
    const built = memberPaneDefinition({ source, id: 'u_b1p-ceyhun' })
    expect(built.ok, built.reason).toBe(true)
    expect(definitionWithholdsOffListing(built.definition)).toBe(true)
  })

  it('⛔ a plain moving average does not', () => {
    const source = '//@version=5\nindicator("plain", overlay=true)\nplot(ta.sma(close, 20))\n'
    const built = memberPaneDefinition({ source, id: 'u_b1p-plain' })
    expect(built.ok, built.reason).toBe(true)
    expect(definitionWithholdsOffListing(built.definition)).toBe(false)
  })

  it('⛔ the same recurrence WITHOUT the Pine declaration does not (a TC2000 window is an accum too)', () => {
    const source = JSON.parse(fs.readFileSync(CAP, 'utf8')).source.text
    const built = memberPaneDefinition({ source, id: 'u_b1p-ceyhun2' })
    const def = { ...built.definition, meta: { ...built.definition.meta, recurrenceOrigin: 'pcf' } }
    expect(definitionWithholdsOffListing(def)).toBe(false)
  })

  it.each([null, undefined, {}, { meta: {} }])('no definition -> no: %j', (d) => {
    expect(definitionWithholdsOffListing(d)).toBe(false)
  })
})

describe('2 — the decision', () => {
  const grid = { backgroundWarm: false, deepWarm: false, tf: 'D', carries: true, pinned: false }
  it('⭐ a daily grid cell carrying such a pane deepens', () => {
    expect(wantsListingDeepen(grid)).toBe(true)
  })
  it.each([
    ['a standalone chart (already full depth)', { backgroundWarm: true }],
    ['the maximized cell (its own dwell deepens it)', { deepWarm: true }],
    ['a weekly cell', { tf: 'W' }],
    ['an intraday cell', { tf: '5' }],
    ['a plain pane', { carries: false }],
    ['a pinned window', { pinned: true }],
  ])('no: %s', (_why, patch) => {
    expect(wantsListingDeepen({ ...grid, ...patch })).toBe(false)
  })
})

describe('3 — the gate: a 6-cell board', () => {
  afterEach(() => vi.useRealTimers())

  it(`⭐ never more than ${LISTING_DEEPEN_MAX} in flight, and every cell is served`, () => {
    const gate = createListingDeepenGate({ setTimer: () => 0, clearTimer: () => {} })
    const releases = []
    let peak = 0
    const served = []
    for (let cell = 0; cell < 6; cell += 1) {
      gate.request((release) => {
        served.push(cell)
        releases.push(release)
        peak = Math.max(peak, gate.inFlight())
      })
    }
    expect(gate.inFlight()).toBe(LISTING_DEEPEN_MAX)
    expect(gate.queued()).toBe(6 - LISTING_DEEPEN_MAX)
    while (releases.length) {
      releases.shift()()
      peak = Math.max(peak, gate.inFlight())
      expect(gate.inFlight()).toBeLessThanOrEqual(LISTING_DEEPEN_MAX)
    }
    expect(peak).toBe(LISTING_DEEPEN_MAX)
    expect(served).toEqual([0, 1, 2, 3, 4, 5])        // FIFO, nobody starved
    expect(gate.inFlight()).toBe(0)
  })

  it('a release is idempotent, and cancel withdraws a queued request', () => {
    const gate = createListingDeepenGate({ max: 1, setTimer: () => 0, clearTimer: () => {} })
    let rel = null
    gate.request((r) => { rel = r })
    let secondServed = false
    const cancelSecond = gate.request(() => { secondServed = true })
    cancelSecond()
    rel(); rel()
    expect(gate.inFlight()).toBe(0)
    expect(secondServed).toBe(false)
  })

  it('a slot whose bars never arrive is freed by the safety timer', () => {
    vi.useFakeTimers()
    const gate = createListingDeepenGate({ max: 1, safetyMs: 1000 })
    gate.request(() => {})
    let served = false
    gate.request(() => { served = true })
    expect(served).toBe(false)
    vi.advanceTimersByTime(1001)
    expect(served).toBe(true)
  })
})

describe('4 — the wiring', () => {
  const src = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8')
  it('⭐ StockChart routes the deepen through the page gate, on the decision, deepening only the daily depth', () => {
    const sc = src('../../../StockChart.jsx')
    const at = sc.indexOf('return listingDeepenGate.request(')
    expect(at, 'NON-VACUITY: the gated request was not found').toBeGreaterThan(0)
    const effect = sc.slice(sc.lastIndexOf('useEffect(', at), sc.indexOf('}, [', at))
    expect(effect).toMatch(/if \(!_wantsListingDeepen\) return undefined/)
    expect(effect).toMatch(/setFetchDepth\(_fullTarget\)/)
    expect(effect).not.toMatch(/prefetch/i)
    expect(sc).toMatch(/const _wantsListingDeepen = wantsListingDeepen\(\{\s*backgroundWarm, deepWarm, tf: resolvedTf, carries: _carriesListingRecurrence/)
  })
  it('⛔ the grid cell still passes backgroundWarm={false}', () => {
    expect(src('../../../../pages/charts/grid/GridChartCell.jsx')).toMatch(/backgroundWarm=\{false\}/)
  })
})
