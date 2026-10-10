// app/src/lib/presentation/dataGrid/pageGrids2.seedParity.test.js
//
// ─── TERM-065 — SIX MORE GRIDS ONTO THE SEED, UNCHANGED (lane f-l7) ──────────
//
//     cd app && npx vitest run src/lib/presentation/dataGrid/pageGrids2.seedParity.test.js
//
// CalendarDayTable, the Desk Shelf, HoldingsList, LiveFlowMassive (two tables),
// ThemeTrackerPage and Watchlists each hand-rolled "which way does a click turn the
// sort". They now ask the seed (`nextSort`, `ariaSortFor`, `sortCaretFor`, and for the
// Shelf `sortRows`). Comparators stay in the grids.
//
// ⭐ THE REFERENCE IS THE HAND-ROLLED CODE, COPIED VERBATIM from each module as it
// stood at 11fa16167 (origin/master when the lane began), before the migration. Each
// test walks the whole state space and a click run through both and asserts equality.
import { describe, it, expect } from 'vitest'
import { nextDayTableSort, dayTableSortWords, dayTableCaret } from '../../../pages/calendar/CalendarDayTable'
import { sortShelfEntries } from '../../../pages/desk/Shelf'
import { flipHoldingsSort, holdingsSortWords } from '../../../pages/journal-2-0/components/HoldingsList'
import { nextMassiveColSort, nextContractSort } from '../../../pages/LiveFlowMassive'
import { nextThemeTabSort, flipThemeSort } from '../../../pages/ThemeTrackerPage'
import { nextWatchColSort } from '../../../pages/Watchlists'

const DIRS = ['asc', 'desc']

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

describe('CalendarDayTable — numeric ±1, Symbol starts A→Z, third click restores importance order', () => {
  // CalendarDayTable.jsx clickSort's updater, its aria-label words and caret, verbatim
  const hand = (s, key) => {
    if (!s || s.key !== key) return { key, dir: key === 'sym' ? 1 : -1 }
    if ((key === 'sym' && s.dir === 1) || (key !== 'sym' && s.dir === -1)) return { key, dir: -s.dir }
    return null
  }
  const handWords = (sort, key) => (sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : null)
  const handCaret = (sort, key) => (sort?.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')
  const cols = ['sym', 'mcap', 'eps', 'move']
  const states = [null, ...cols.flatMap((key) => [1, -1].map((dir) => ({ key, dir })))]
  it('every state and click sequence matches the hand-rolled toggle', () => {
    assertParity(states, cols, hand, nextDayTableSort)
  })
  it('the direction words and the caret say the same thing in every state', () => {
    for (const s of states) {
      for (const k of cols) {
        if (s?.key === k) expect(dayTableSortWords(s, k)).toBe(handWords(s, k))
        expect(dayTableCaret(s, k)).toBe(handCaret(s, k))
      }
    }
  })
})

describe('Desk Shelf — Newest / Oldest, ties by id in the same direction', () => {
  // Shelf.jsx gridEntries comparator, verbatim
  const hand = (entries, effSort) => {
    const dir = effSort === 'new' ? -1 : 1
    return [...entries].sort((a, b) => {
      const ka = a.video.created_at || 0
      const kb = b.video.created_at || 0
      return dir * ((ka - kb) || (a.video.id - b.video.id))
    })
  }
  const entries = [
    { video: { id: 3, created_at: 200 } }, { video: { id: 1, created_at: 100 } },
    { video: { id: 2, created_at: 200 } }, { video: { id: 7, created_at: 0 } },
    { video: { id: 5 } }, { video: { id: 4, created_at: 300 } }, { video: { id: 6, created_at: 100 } },
  ]
  it.each(['new', 'old'])('%s: the same order as the hand-rolled comparator, ties included', (order) => {
    const ids = (xs) => xs.map((en) => en.video.id)
    expect(ids(sortShelfEntries(entries, order))).toEqual(ids(hand(entries, order)))
  })
})

describe('HoldingsList — the direction button flips, and says so', () => {
  // HoldingsList.jsx dirBtn onClick + aria-label, verbatim
  const handFlip = (sort) => ({ ...sort, dir: sort.dir === 'desc' ? 'asc' : 'desc' })
  const handWords = (sort) => (sort.dir === 'desc' ? 'descending' : 'ascending')
  const states = ['value', 'symbol', 'dayPct'].flatMap((key) => DIRS.map((dir) => ({ key, dir })))
  it('every state flips and reads exactly as before', () => {
    for (const s of states) {
      expect(flipHoldingsSort(s)).toEqual(handFlip(s))
      expect(holdingsSortWords(s)).toBe(handWords(s))
    }
  })
})

describe('LiveFlowMassive alert table — first direction, flip, then back to time-descending', () => {
  // LiveFlowMassive.jsx handleSortColumn, verbatim, over {key, dir}
  const COLUMN_DIR = { time: 'desc', ticker: 'asc', premium: 'desc', exp: 'asc', grade: 'desc' }
  const hand = (s, key) => {
    const def = COLUMN_DIR[key] || 'desc'
    if (s.key !== key) return { key, dir: def }
    if (s.dir === def) return { key, dir: def === 'desc' ? 'asc' : 'desc' }
    return { key: 'time', dir: 'desc' }
  }
  const cols = ['ticker', 'premium', 'time', 'exp', 'grade']
  const states = [{ key: 'time', dir: 'desc' }, ...cols.flatMap((key) => DIRS.map((dir) => ({ key, dir })))]
  it('every state and click sequence matches the hand-rolled toggle', () => {
    assertParity(states, cols, hand, nextMassiveColSort)
  })
})

describe('LiveFlowMassive By-Contract table — flip, or a new column at its first direction', () => {
  // LiveFlowMassive.jsx onContractSort, verbatim, over {key: cSortCol, dir: cSortDir}
  const hand = (s, col) => (s.key === col
    ? { key: col, dir: s.dir === 'desc' ? 'asc' : 'desc' }
    : { key: col, dir: col === 'TICKER' || col === 'EXP' ? 'asc' : 'desc' })
  const cols = ['TICKER', 'PREMIUM', 'EXP', 'HITS']
  const states = [{ key: null, dir: 'desc' }, ...cols.flatMap((key) => DIRS.map((dir) => ({ key, dir })))]
  it('every state and click sequence matches the hand-rolled toggle', () => {
    assertParity(states, cols, hand, nextContractSort)
  })
})

describe('ThemeTrackerPage — period tabs and the column sort button', () => {
  // ThemeTrackerPage.jsx handleTabClick and the sort button's updater, verbatim, over {key: activeTab, dir: sortDir}
  const hand = (s, tab) => (tab === s.key
    ? { key: s.key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
    : { key: tab, dir: 'desc' })
  const handFlip = (s) => ({ key: s.key, dir: s.dir === 'desc' ? 'asc' : 'desc' })
  const cols = ['Today', '1W', '1M', '3M', 'YTD']
  const states = [{ key: 'Today', dir: 'desc' }, ...cols.flatMap((key) => DIRS.map((dir) => ({ key, dir })))]
  it('every state and click sequence matches the hand-rolled tab toggle', () => {
    assertParity(states, cols, hand, nextThemeTabSort)
  })
  it('the column sort button flips exactly as before, from every state', () => {
    for (const s of states) expect(flipThemeSort(s)).toEqual(handFlip(s))
  })
})

describe('Watchlists column header — Symbol A→Z, numbers high→low, same column flips', () => {
  // Watchlists.jsx handleColSort's `next`, verbatim
  const hand = (colSort, key) => ((!colSort || colSort.key !== key)
    ? { key, dir: key === 'sym' ? 'asc' : 'desc' }
    : { key, dir: colSort.dir === 'asc' ? 'desc' : 'asc' })
  const cols = ['sym', 'price', 'change', '1w', 'periodchg']
  const states = [null, ...cols.flatMap((key) => DIRS.map((dir) => ({ key, dir })))]
  it('every state and click sequence matches the hand-rolled toggle', () => {
    assertParity(states, cols, hand, nextWatchColSort)
  })
})
