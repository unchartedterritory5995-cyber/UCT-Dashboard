// TERM-065: the header-click sort decisions of the Options Flow / Dark Pool grids, on the
// DataGrid seed.
//
// `OptionsFlow.jsx` (four tables) and `DarkPool.jsx` (three panels) each hand-rolled "which way
// does a header click turn the sort". They now ask the seed's `nextSort` through the helpers
// below. COMPARATORS STAY IN THE GRIDS: only the click decision moved, so the rows sort exactly
// as they did. (`OptionsFlow_admin.jsx` is a self-contained artifact copy that cannot import a
// local module; it stays on the rail's baseline, see `dataGridSeed.rail.test.js`.)
//
// ⭐ BYTE-IDENTICAL, NOT "EQUIVALENT FOR THE STATES WE EXPECT". Most of the hand-rolled toggles
// tested `d === "desc" ? "asc" : "desc"`, the seed tests `dir === ASC ? DESC : ASC`. The two
// agree for "asc" and "desc" and disagree for anything else (undefined, a typo). `descTested`
// normalises first, so even an unexpected value turns the way the hand-rolled code turned it.
// `flowGridSort.seedParity.test.js` holds each hand-rolled toggle copied verbatim and walks the
// whole state space, unexpected values included, through both.
//
// ⛔ PARTNER FILES, REBASE-SAFE HOOKS. Each partner site is one call into this module; the
// sort machinery lives here and in `lib/presentation/dataGrid`.

import { useState } from 'react'
import { ASC, DESC, nextSort } from '../../lib/presentation/dataGrid'

/** A new column starts descending (every grid here except the ticker columns below). */
export const descFirst = () => DESC
/** A new column starts descending, except `ticker`, which starts A to Z. */
export const tickerAscFirst = (key) => (key === 'ticker' ? ASC : DESC)

/** The hand-rolled toggles asked "is it desc?"; anything else turned to desc. */
const descTested = (d) => (d === DESC ? DESC : ASC)

/** The direction after clicking the active column again, under the "is it desc?" toggle. */
export function flipDescTested(dir) {
  return nextSort({ key: 0, dir: descTested(dir) }, 0).dir
}

/** `{key, dir}` after a header click on `key`, under the "is it desc?" toggle. */
export function nextPairSort(prev, key, defaultDirFor = descFirst) {
  return nextSort({ key: prev.key, dir: descTested(prev.dir) }, key, defaultDirFor)
}

/**
 * A grid that keeps its sort as a key + a direction (Dark Pool's three panels).
 * Returns `{ sortKey, sortDir, toggleSort }`.
 */
export function usePairSort(initialKey, defaultDirFor = descFirst, initialDir = DESC) {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir })
  const toggleSort = (key) => setSort((prev) => nextPairSort(prev, key, defaultDirFor))
  return { sortKey: sort.key, sortDir: sort.dir, toggleSort }
}

/**
 * The same decision for a grid that keeps key and direction in two separate states it owns
 * (Options Flow's batch table). Calls the two setters exactly as the hand-rolled click did.
 */
export function clickPairSort(curKey, key, setKey, setDir, defaultDirFor = descFirst) {
  if (curKey !== key) setKey(key)
  setDir((d) => nextSort({ key: curKey, dir: descTested(d) }, key, defaultDirFor).dir)
}

/**
 * `{col, dir}` sort state (Options Flow's top-flow table). This toggle asked "is it asc?",
 * which is the seed's own question, so no normalisation.
 */
export function nextColSort(prev, col, defaultDirFor = descFirst) {
  const n = nextSort(prev ? { key: prev.col, dir: prev.dir } : null, col, defaultDirFor)
  return { col: n.key, dir: n.dir }
}

/**
 * `{col, dir, col2, dir2}` sort state (the OI tracker and the tracked-contracts tables): the
 * active column flips; a new column starts descending and the old one becomes the tiebreak.
 */
export function nextTwoLevelSort(prev, col) {
  const n = nextSort({ key: prev.col, dir: descTested(prev.dir) }, col, descFirst)
  return prev.col === col ? { ...prev, dir: n.dir } : { col, dir: n.dir, col2: prev.col, dir2: prev.dir }
}
