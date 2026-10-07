// app/src/lib/presentation/dataGrid/pageGrids.seedParity.test.js
//
// ─── TERM-065 — FIVE PAGE GRIDS ONTO THE SEED'S HEADER DECISIONS, UNCHANGED ──
//
//     cd app && npx vitest run src/lib/presentation/dataGrid/pageGrids.seedParity.test.js
//
// ModelBook, LiveFlow, CalendarWidget, UCT20 and CatalystTable each hand-rolled
// "which way does a header click turn the sort" (and UCT20 its `aria-sort`,
// CatalystTable its caret). They now ask the seed (`nextSort`, `ariaSortFor`,
// `sortCaretFor`). Their COMPARATORS stay in the grid — what a cell's sortable
// value is, how blanks and ties fall, is a fact about the grid's data (the
// seed's own header says so), exactly as the screener's VirtualResults moved
// only its header decisions.
//
// ⭐ THE REFERENCE IS THE HAND-ROLLED CODE, COPIED VERBATIM from each module as
// it stood at a4389e3b2a, before the migration. Each test walks the WHOLE state
// space a grid can be in (every column, every direction, the empty/default
// state) and asserts the seed-backed decision equals the hand-rolled one at
// every point — and drives a click sequence through both so a difference that
// only shows on the third click (UCT20's and CatalystTable's reset) is seen.
import { describe, it, expect } from 'vitest'
import { nextModelBookSort } from '../../../pages/ModelBook'
import { nextLiveFlowSort } from '../../../pages/LiveFlow'
import { nextCalendarWidgetSort } from '../../../pages/charts/widgets/CalendarWidget'
import { nextUct20Sort, uct20AriaSort, uct20Caret } from '../../../pages/UCT20'
import { nextCatalystSort, flipCatalystChangeSort, catalystCaret } from '../../../components/tiles/CatalystTable'

const DIRS = ['asc', 'desc']

/** Every state, and every click from it, agree; then a long click run agrees too. */
function assertParity(states, cols, hand, seed) {
  for (const s of states) {
    for (const c of cols) expect({ s, c, next: seed(s, c) }).toEqual({ s, c, next: hand(s, c) })
  }
  let a = states[0]; let b = states[0]
  const run = [...cols, ...cols, cols[0], cols[0], cols[0], cols[1], cols[1], cols[0]]
  for (const c of run) {
    a = hand(a, c); b = seed(b, c)
    expect(b).toEqual(a)
  }
}

describe('ModelBook gallery — nextSort with gain defaulting to top gainers', () => {
  // ModelBook.jsx toggleSort, verbatim
  const hand = (s, key) => (s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'gain' ? 'desc' : 'asc' })
  const cols = ['gain', 'rank']
  const states = [{ key: 'gain', dir: 'desc' }, ...cols.flatMap((key) => DIRS.map((dir) => ({ key, dir })))]
  it('every state and click sequence matches the hand-rolled toggle', () => {
    assertParity(states, cols, hand, nextModelBookSort)
  })
})

describe('LiveFlow table — same column flips, a new column starts desc', () => {
  // LiveFlow.jsx handleSort's setSortBy updater, verbatim
  const hand = (prev, col) => {
    if (prev.col === col) {
      return { col, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
    }
    return { col, dir: 'desc' }
  }
  const cols = ['time', 'premium', 'grade', 'ticker']
  const states = [{ col: 'time', dir: 'desc' }, ...cols.flatMap((col) => DIRS.map((dir) => ({ col, dir })))]
  it('every state and click sequence matches the hand-rolled toggle', () => {
    assertParity(states, cols, hand, nextLiveFlowSort)
  })
})

describe('CalendarWidget earnings sections — {by, dir}', () => {
  // CalendarWidget.jsx clickCol's updater, verbatim
  const hand = (s, col) => (s.by === col ? { by: col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { by: col, dir: 'desc' })
  const cols = ['mcap', 'eps', 'rev', 'im']
  const states = [{ by: 'mcap', dir: 'desc' }, ...cols.flatMap((by) => DIRS.map((dir) => ({ by, dir })))]
  it('every state and click sequence matches the hand-rolled toggle', () => {
    assertParity(states, cols, hand, nextCalendarWidgetSort)
  })
})

describe('UCT20 list — numeric ±1, desc → asc → back to rank order', () => {
  // UCT20.jsx toggleSort's updater, aria-sort and caret, verbatim
  const hand = (prev, key) => (prev?.key === key
    ? (prev.dir === -1 ? { key, dir: 1 } : null)
    : { key, dir: -1 })
  const handAria = (sort, k) => (sort?.key === k ? (sort.dir === -1 ? 'descending' : 'ascending') : 'none')
  const handCaret = (sort, k) => (sort?.key === k ? (sort.dir === -1 ? ' ▼' : ' ▲') : '')
  const cols = ['rating', 'chg', 'ret']
  const states = [null, ...cols.flatMap((key) => [-1, 1].map((dir) => ({ key, dir })))]
  it('every state and click sequence matches the hand-rolled toggle', () => {
    assertParity(states, cols, hand, nextUct20Sort)
  })
  it('aria-sort and the caret say the same thing in every state', () => {
    for (const s of states) {
      for (const k of cols) {
        expect(uct20AriaSort(s, k)).toBe(handAria(s, k))
        expect(uct20Caret(s, k)).toBe(handCaret(s, k))
      }
    }
  })
})

describe('CatalystTable — header tri-state, the compact Gainers/Losers flip, the caret', () => {
  // CatalystTable.jsx toggleSort's updater, the compact button's updater, and SortableTh's arrow, verbatim
  const hand = (prev, col) => {
    if (!prev || prev.col !== col) return { col, dir: 'desc' }
    if (prev.dir === 'desc') return { col, dir: 'asc' }
    return null
  }
  const handFlip = (prev) => ({ col: 'change', dir: prev?.dir === 'asc' ? 'desc' : 'asc' })
  const handCaret = (sortBy, col) => {
    const active = sortBy && sortBy.col === col
    return !active ? '' : (sortBy.dir === 'asc' ? ' ▲' : ' ▼')
  }
  const cols = ['sym', 'price', 'change', 'volx', 'when']
  const states = [null, ...cols.flatMap((col) => DIRS.map((dir) => ({ col, dir })))]
  it('every state and click sequence matches the hand-rolled header toggle', () => {
    assertParity(states, cols, hand, nextCatalystSort)
  })
  it('the compact Gainers/Losers button flips exactly as before, from every state', () => {
    for (const s of states) expect(flipCatalystChangeSort(s)).toEqual(handFlip(s))
  })
  it('the header caret is the same text in every state', () => {
    for (const s of states) for (const c of cols) expect(catalystCaret(s, c)).toBe(handCaret(s, c))
  })
})
