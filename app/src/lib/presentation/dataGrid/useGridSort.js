// app/src/lib/presentation/dataGrid/useGridSort.js
//
// ─── S10 — THE DATAGRID SEED: THE SORT HOOK (TERM-065) ───────────────────────
//
// Owns a grid's sort state and hands back the sorted rows plus the three things
// a header needs: the click handler, `aria-sort`, and the caret. HEADLESS on
// purpose — the grid keeps its own markup and its own CSS module, so adopting
// the seed changes no element, class or attribute a member (or a test) sees.
//
// Options:
//   initialKey, initialDir  the sort on first render
//   defaultDirFor(key)      direction a column takes on its first click
//   valueOf(key, row)       the cell's sortable value
//   isNumeric(key)          numeric compare for this column
//   tiebreak(a, b)          the grid's stable order for equal cells
//   omitInactiveAria        true ⇒ an inactive column gets NO aria-sort
//                           attribute (undefined) instead of 'none'
//
// ⚠️ `valueOf`, `isNumeric` and `tiebreak` are memo dependencies: pass stable
// references (module-level functions, or `useCallback` over the values they
// read), exactly as the hand-rolled `useMemo` listed its own inputs.

import { useCallback, useMemo, useState } from 'react'
import { ariaSortFor, nextSort, sortCaretFor, sortRows } from './gridSort'

export default function useGridSort(rows, {
  initialKey, initialDir, defaultDirFor, valueOf, isNumeric, tiebreak, omitInactiveAria = false,
}) {
  const [sort, setSort] = useState(() => nextSort(null, initialKey, () => initialDir))

  const requestSort = useCallback(
    (key) => setSort((prev) => nextSort(prev, key, defaultDirFor)),
    [defaultDirFor],
  )

  const sorted = useMemo(
    () => sortRows(rows, sort, { valueOf, isNumeric, tiebreak }),
    [rows, sort, valueOf, isNumeric, tiebreak],
  )

  const inactive = omitInactiveAria ? undefined : 'none'
  const ariaSort = (key) => ariaSortFor(sort, key, inactive)
  const caret = (key) => sortCaretFor(sort, key)

  return { sort, sorted, requestSort, ariaSort, caret }
}
