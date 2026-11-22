// #1275 (AUDIT): the chartGrid.set receipt says "evenly" ONLY when every resulting chart cell is the same size.
//
// With #1275's reuse a request can end on an odd number of charts (GW-19: the board's NVDA reused + AAPL + MSFT → 3 charts,
// tiled 12x10, 12x10, 24x10). The receipt used to say "…re-tiled evenly" regardless. GENERATED: kept charts (1–2) × total
// charts (1–6) × board sizes × both receipt forms (new charts added; every ticker already on the board) — "evenly" appears
// iff the cells the plan writes are all one size. The truth is computed here from the plan's own rects (each kept chart's
// new or unchanged cell, then each added chart's), never from the flag under test.
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { planChartGrid } from './chartGrid'

const minOf = () => ({ minW: 2, minH: 3 })
const BOARDS = [[24, 20], [24, 10], [12, 20], [36, 24], [24, 30]]
const TICKERS = ['NVDA', 'AMD', 'AAPL', 'MSFT', 'TSLA', 'SPY', 'QQQ']
const EVENLY = /\bevenly\b/i

function keptBoard(k, cols, rows) {
  // k kept charts side by side across the whole board (equal cells to start)
  const w = Math.floor(cols / k)
  return Array.from({ length: k }, (_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * w, y: 0, w: i === k - 1 ? cols - i * w : w, h: rows, color: 'N' }))
}
// every chart on these boards is kept (new charts were asked for), so the resulting cells are each board chart's cell
// after the plan (moved or not) plus each added chart's — g.reuse lists only the kept charts that MOVED
const truthEqual = (board, g) => {
  const cells = [
    ...board.filter(w => w.type === 'chart').map(w => g.set[w.id] || w),
    ...g.add.filter(a => !a.type || a.type === 'chart').map(a => a.rect),
  ]
  return new Set(cells.map(r => `${r.w}x${r.h}`)).size === 1
}

const CASES = []
for (const [cols, rows] of BOARDS) {
  for (const k of [1, 2]) {
    for (let total = k; total <= 6; total++) {
      const n = total - k
      CASES.push({ cols, rows, k, n, form: n ? 'added' : 'alreadyThere' })
    }
  }
}

describe('#1275 — "evenly" in the chartGrid.set receipt iff every resulting cell is the same size (generated)', () => {
  let cap
  beforeAll(() => { registerBuiltins(); cap = getCapability('chartGrid.set') })

  const seen = { even: 0, uneven: 0 }
  for (const c of CASES) {
    it(`${c.k} kept + ${c.n} new on ${c.cols}x${c.rows} (${c.form})`, () => {
      const board = keptBoard(c.k, c.cols, c.rows)
      const charts = new Map(board.map((w, i) => [w.id, { ref: w.id, symbol: TICKERS[i], tf: 'D' }]))
      const symbols = c.n ? TICKERS.slice(c.k, c.k + c.n) : TICKERS.slice(0, c.k)
      const g = planChartGrid({ board, charts, symbols, timeframe: null, layout: null, newCharts: true, cols: c.cols, rows: c.rows, minOf, maxWidgets: 16 })
      if (!g.ok || g.noop) return      // a refused / no-op plan has no receipt to test
      const text = cap.describe({ board }, { board, grid: { ...g, removedNames: [] } })
      if (text == null) return
      const equal = truthEqual(board, g)
      seen[equal ? 'even' : 'uneven']++
      expect(EVENLY.test(text), `${text} — cells ${equal ? 'all equal' : 'unequal'}`).toBe(equal)
      // the neutral words when not even: still says the board was re-arranged
      if (!equal) expect(text).toMatch(c.n ? /re-tiled\b/ : /^Re-arranged your/)
    })
  }

  it('the generated set covers both outcomes (equal and unequal cells) — never vacuous', () => {
    expect(seen.even).toBeGreaterThan(0)
    expect(seen.uneven).toBeGreaterThan(0)
  })

  it("GW-19's shape: the board's chart reused + 2 new on a 24x20 board → 12x10, 12x10, 24x10 → no \"evenly\"", () => {
    const board = keptBoard(1, 24, 20)
    const charts = new Map([['c1', { ref: 'c1', symbol: 'NVDA', tf: 'D' }]])
    const g = planChartGrid({ board, charts, symbols: ['AAPL', 'MSFT'], timeframe: 'D', newCharts: true, cols: 24, rows: 20, minOf, maxWidgets: 16 })
    expect(g.ok).toBe(true)
    const sizes = [g.set.c1 || board[0], ...g.add.map(a => a.rect)].map(r => `${r.w}x${r.h}`).sort()
    expect(sizes).toEqual(['12x10', '12x10', '24x10'])
    expect(g.equalCells).toBe(false)
    const text = cap.describe({ board }, { board, grid: { ...g, removedNames: [] } })
    expect(text).toMatch(/re-tiled/)
    expect(text).not.toMatch(EVENLY)
  })

  it('a 2×2 (1 reused + 3 new on 24x20) is even and says so', () => {
    const board = keptBoard(1, 24, 20)
    const charts = new Map([['c1', { ref: 'c1', symbol: 'NVDA', tf: 'D' }]])
    const g = planChartGrid({ board, charts, symbols: ['AAPL', 'MSFT', 'TSLA'], timeframe: 'D', newCharts: true, cols: 24, rows: 20, minOf, maxWidgets: 16 })
    expect(g.equalCells).toBe(true)
    expect(cap.describe({ board }, { board, grid: { ...g, removedNames: [] } })).toMatch(/re-tiled evenly/)
  })
})
