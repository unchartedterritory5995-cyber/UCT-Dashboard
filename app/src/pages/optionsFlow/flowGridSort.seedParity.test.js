// app/src/pages/optionsFlow/flowGridSort.seedParity.test.js
//
// ─── TERM-065 — DARKPOOL + OPTIONSFLOW HEADER TOGGLES ONTO THE SEED, UNCHANGED (lane P2) ──
//
//     cd app && npx vitest run src/pages/optionsFlow/flowGridSort.seedParity.test.js
//
// ⭐ THE REFERENCE IS THE HAND-ROLLED CODE, COPIED VERBATIM from each partner file as it stood
// at 25bab1588 (origin/master when lane P2 began), before the hooks replaced it. Each case walks
// the whole state space, including direction values the page never produces (undefined, a
// typo), and a click run through both, and asserts equality. The comparators were not moved, so
// an identical sort STATE after every click is an identical sort ORDER.
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  nextPairSort, usePairSort, clickPairSort, nextColSort, nextTwoLevelSort,
  flipDescTested, tickerAscFirst, descFirst,
} from './flowGridSort'

const DIRS = ['asc', 'desc', undefined, 'weird']

function runParity(states, cols, hand, seed) {
  for (const s of states) {
    for (const c of cols) expect({ s, c, next: seed(s, c) }).toEqual({ s, c, next: hand(s, c) })
  }
  let a = states[0]
  let b = states[0]
  const run = [...cols, ...cols, cols[0], cols[0], cols[0], cols[1], cols[1], cols[0]]
  for (const c of run) {
    a = hand(a, c)
    b = seed(b, c)
    expect(b).toEqual(a)
  }
}

// A pair of setState calls, replayed against a plain {key, dir} record so a "two setters" grid
// can be compared as one state machine.
function applySetters(state, fire) {
  let next = { ...state }
  const setKey = (v) => { next.key = typeof v === 'function' ? v(next.key) : v }
  const setDir = (v) => { next.dir = typeof v === 'function' ? v(next.dir) : v }
  fire(setKey, setDir)
  return next
}

describe('DarkPool NotableActivityPanel + BiggestPrintsPanel: every new column starts desc', () => {
  // DarkPool.jsx toggleSort (NotableActivityPanel, BiggestPrintsPanel), verbatim:
  //   function toggleSort(key){
  //     if(sortKey===key) setSortDir(d=>d==="desc"?"asc":"desc");
  //     else { setSortKey(key); setSortDir("desc"); }
  //   }
  const hand = (s, key) => applySetters(s, (setSortKey, setSortDir) => {
    const sortKey = s.key
    if(sortKey===key) setSortDir(d=>d==="desc"?"asc":"desc");
    else { setSortKey(key); setSortDir("desc"); }
  })
  const cols = ['signals', 'notional', 'ticker', 'mktcap']
  const states = cols.flatMap((key) => DIRS.map((dir) => ({ key, dir })))
  it('every state and click sequence matches the hand-rolled toggle', () => {
    runParity(states, cols, hand, (s, k) => nextPairSort(s, k))
  })
})

describe('DarkPool TickerFlowTable panel: ticker starts A to Z, every other column desc', () => {
  // DarkPool.jsx toggleSort (the notional/ticker table), verbatim:
  //   function toggleSort(key){
  //     if(sortKey===key) setSortDir(d=>d==="desc"?"asc":"desc");
  //     else { setSortKey(key); setSortDir(key==="ticker"?"asc":"desc"); }
  //   }
  const hand = (s, key) => applySetters(s, (setSortKey, setSortDir) => {
    const sortKey = s.key
    if(sortKey===key) setSortDir(d=>d==="desc"?"asc":"desc");
    else { setSortKey(key); setSortDir(key==="ticker"?"asc":"desc"); }
  })
  const cols = ['ticker', 'notional', 'prints', 'avgSize']
  const states = cols.flatMap((key) => DIRS.map((dir) => ({ key, dir })))
  it('every state and click sequence matches the hand-rolled toggle', () => {
    runParity(states, cols, hand, (s, k) => nextPairSort(s, k, tickerAscFirst))
  })
})

describe('usePairSort: the hook the DarkPool panels call drives the same machine', () => {
  it('starts at the given key, descending, and toggles like nextPairSort', () => {
    const { result } = renderHook(() => usePairSort('notional', tickerAscFirst))
    expect([result.current.sortKey, result.current.sortDir]).toEqual(['notional', 'desc'])
    let ref = { key: 'notional', dir: 'desc' }
    for (const c of ['notional', 'notional', 'ticker', 'ticker', 'prints', 'ticker']) {
      act(() => result.current.toggleSort(c))
      ref = nextPairSort(ref, c, tickerAscFirst)
      expect([result.current.sortKey, result.current.sortDir]).toEqual([ref.key, ref.dir])
    }
  })
})

describe('OptionsFlow batch table: two setters, ticker starts A to Z', () => {
  // OptionsFlow.jsx batch <th> onClick, verbatim:
  //   if(batchSort===sk) setBatchSortDir(d=>d==="desc"?"asc":"desc");
  //   else { setBatchSort(sk); setBatchSortDir(sk==="ticker"?"asc":"desc"); }
  const hand = (s, sk) => applySetters(s, (setBatchSort, setBatchSortDir) => {
    const batchSort = s.key
    if(batchSort===sk) setBatchSortDir(d=>d==="desc"?"asc":"desc");
    else { setBatchSort(sk); setBatchSortDir(sk==="ticker"?"asc":"desc"); }
  })
  const seed = (s, sk) => applySetters(s, (setKey, setDir) => clickPairSort(s.key, sk, setKey, setDir, tickerAscFirst))
  const cols = ['net', 'ticker', 'bull', 'pnl']
  const states = cols.flatMap((key) => DIRS.map((dir) => ({ key, dir })))
  it('every state and click sequence matches the hand-rolled click', () => {
    runParity(states, cols, hand, seed)
  })
  it('a click on a NEW column calls the key setter; a repeat click does not', () => {
    const calls = []
    clickPairSort('net', 'net', () => calls.push('key'), () => calls.push('dir'))
    expect(calls).toEqual(['dir'])
    calls.length = 0
    clickPairSort('net', 'bull', () => calls.push('key'), () => calls.push('dir'))
    expect(calls).toEqual(['key', 'dir'])
  })
})

describe('OptionsFlow top-flow table ({col, dir}, asks "is it asc?")', () => {
  // OptionsFlow.jsx tfSort onClick, verbatim:
  //   setTfSort(prev =>
  //     prev.col === h
  //       ? { col: h, dir: prev.dir === "asc" ? "desc" : "asc" }
  //       : { col: h, dir: "desc" }  // first click defaults to descending
  //   )
  const hand = (prev, h) => (
    prev.col === h
      ? { col: h, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { col: h, dir: "desc" }
  )
  const cols = ['score', 'Ticker', 'Premium', 'DTE']
  const states = cols.flatMap((col) => DIRS.map((dir) => ({ col, dir })))
  it('every state and click sequence matches the hand-rolled updater', () => {
    runParity(states, cols, hand, nextColSort)
  })
})

describe('OptionsFlow OI tracker + tracked-contracts tables ({col, dir, col2, dir2})', () => {
  // OptionsFlow.jsx oiSort toggleSort, verbatim:
  //   const toggleSort = (col) => setOiSort(prev => {
  //     if (prev.col===col) return {...prev, dir:prev.dir==="desc"?"asc":"desc"};
  //     return {col, dir:"desc", col2:prev.col, dir2:prev.dir};
  //   });
  const handOi = (prev, col) => {
    if (prev.col===col) return {...prev, dir:prev.dir==="desc"?"asc":"desc"};
    return {col, dir:"desc", col2:prev.col, dir2:prev.dir};
  }
  // OptionsFlow.jsx trkToggle, verbatim:
  //   const trkToggle = (col) => setTrkSort(prev => prev.col===col?{...prev,dir:prev.dir==="desc"?"asc":"desc"}:{col,dir:"desc",col2:prev.col,dir2:prev.dir});
  const handTrk = (prev, col) => (prev.col===col?{...prev,dir:prev.dir==="desc"?"asc":"desc"}:{col,dir:"desc",col2:prev.col,dir2:prev.dir})
  const cols = ['doi', 'premium', 'added', 'ticker']
  const states = cols.flatMap((col) => DIRS.flatMap((dir) => DIRS.map((dir2) => ({ col, dir, col2: 'premium', dir2 }))))
  it('the OI tracker toggle matches in every state and click sequence', () => {
    runParity(states, cols, handOi, nextTwoLevelSort)
  })
  it('the tracked-contracts toggle matches in every state and click sequence', () => {
    runParity(states, cols, handTrk, nextTwoLevelSort)
  })
})

describe('controls', () => {
  it('the "is it desc?" flip turns an unexpected value to desc, as the hand-rolled code did', () => {
    expect(flipDescTested('desc')).toBe('asc')
    expect(flipDescTested('asc')).toBe('desc')
    expect(flipDescTested(undefined)).toBe('desc')
    expect(flipDescTested('weird')).toBe('desc')
  })
  it('the parity harness can fail: a toggle that starts new columns ascending is caught', () => {
    const wrong = (s, k) => (s.key === k ? nextPairSort(s, k) : { key: k, dir: 'asc' })
    expect(() => runParity([{ key: 'a', dir: 'desc' }], ['a', 'b'], (s, k) => nextPairSort(s, k), wrong)).toThrow()
  })
  it('defaults: descFirst is always desc; tickerAscFirst only flips ticker', () => {
    expect(descFirst('ticker')).toBe('desc')
    expect(tickerAscFirst('ticker')).toBe('asc')
    expect(tickerAscFirst('net')).toBe('desc')
  })
})
