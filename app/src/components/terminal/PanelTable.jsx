// UCT Terminal — ONE table header for every list panel: click-to-sort columns and a "Columns"
// menu, both kept in the panel's view (customization pass 1, 2026-11-27; usePanelView.js).
//
//   const t = usePanelTable({ columns: COLS, defaultSort: null, filters: { minPrice: 0 } })
//   const shown = useMemo(() => t.apply(rows), [rows, t.apply])
//   <PanelColumns table={t} testId="terminal-erns-columns" />
//   then, inside the panel's own table element (which keeps its own accessible name):
//     <PanelTableHead table={t} />
//     <tbody>{shown.map((r) => <tr key={r.id}>{t.shows('sym') && <td>…</td>} …</tr>)}</tbody>
//
// A column: `{ key, label, sort, type, firstDir, title, thClass, phoneHide, defaultHidden, required }`
//   sort          (row) => the value it sorts by, or null/absent for a column that does not sort
//   type          'number' (default) compares numbers; 'text' compares text
//   firstDir      the direction of the first click ('desc' default for numbers, 'asc' for text)
//   thClass       the panel's own header-cell class (its CSS module keeps the look of its cells)
//   phoneHide     the column steps aside on a phone / narrow panel (marketPanels `phoneHide`)
//   defaultHidden hidden until the member shows it      required  can never be hidden
//
// ⭐ THE LIST'S OWN ORDER IS THE DEFAULT. `defaultSort: null` keeps the order the server sent
// (rank, time, the list's meaning). A header click sorts; clicking the same header turns it round;
// a third click puts the list back in its own order (or the panel's default sort). "Reset" in the
// Columns menu puts both the sort and the columns back.
//
// The sort itself is the shared DataGrid seed (`lib/presentation/dataGrid`: nextSort, sortRows,
// ariaSortFor): blanks sink to the bottom both ways, equal values keep the list's order.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ASC, DESC, ariaSortFor, nextSort, sortCaretFor, sortRows } from '../../lib/presentation/dataGrid'
import Checkbox from '../ui/Checkbox'
import usePanelView from './usePanelView'
import mp from '../../pages/terminal/panels/marketPanels.module.css'
import styles from './PanelTable.module.css'

const isSortable = (c) => typeof c?.sort === 'function'
const firstDirOf = (c) => c?.firstDir || (c?.type === 'text' ? ASC : DESC)

/** Pure: the sort after a click on `col`, the three-step cycle described above. */
export function cycleSort(prev, col, defaultSort = null) {
  if (!isSortable(col)) return prev
  if (prev && prev.key === col.key && prev.dir !== firstDirOf(col)) {
    // Third click: back to the list's own order — unless that order IS this sort turned round,
    // in which case the default is where the second click already was going.
    if (defaultSort && defaultSort.key === col.key) return nextSort(prev, col.key)
    return defaultSort || null
  }
  return nextSort(prev, col.key, () => firstDirOf(col))
}

/** Pure: `rows` in the order `sort` asks for (a copy), or `rows` itself when there is no sort or
 *  the sort names a column this table does not sort by. */
export function applySort(rows, sort, columns) {
  const list = Array.isArray(rows) ? rows : []
  const col = sort ? columns.find((c) => c.key === sort.key) : null
  if (!col || !isSortable(col)) return list
  return sortRows(list, sort, {
    valueOf: (_k, r) => { const v = col.sort(r); return typeof v === 'number' && !Number.isFinite(v) ? null : v },
    isNumeric: () => col.type !== 'text',
  })
}

export function usePanelTable({ columns, defaultSort = null, filters = undefined }) {
  const colsRef = useRef(columns)
  colsRef.current = columns
  const defaultHidden = useMemo(() => columns.filter((c) => c.defaultHidden && !c.required).map((c) => c.key),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns.map((c) => `${c.key}:${c.defaultHidden ? 1 : 0}:${c.required ? 1 : 0}`).join(',')])
  const [view, setView] = usePanelView({ sort: defaultSort, hidden: defaultHidden, ...(filters ? { filters } : {}) })
  const known = useMemo(() => new Set(columns.map((c) => c.key)), [columns])
  // A stored sort on a column this table does not have (a newer build's column) is ignored.
  const sort = view.sort && known.has(view.sort.key) && isSortable(columns.find((c) => c.key === view.sort.key))
    ? view.sort : (defaultSort || null)
  const required = useMemo(() => new Set(columns.filter((c) => c.required).map((c) => c.key)), [columns])
  const hidden = useMemo(() => new Set(view.hidden.filter((k) => known.has(k) && !required.has(k))), [view.hidden, known, required])
  const visible = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden])

  const sortKey = sort ? `${sort.key}:${sort.dir}` : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const apply = useCallback((rows) => applySort(rows, sort, colsRef.current), [sortKey])
  const requestSort = useCallback((key) => {
    const col = colsRef.current.find((c) => c.key === key)
    setView((cur) => ({ ...cur, sort: cycleSort(cur.sort, col, defaultSort) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setView, defaultSort?.key, defaultSort?.dir])
  const toggleColumn = useCallback((key) => {
    if (required.has(key)) return
    setView((cur) => {
      const set = new Set(cur.hidden)
      if (set.has(key)) set.delete(key)
      else set.add(key)
      return { ...cur, hidden: [...set] }
    })
  }, [setView, required])
  const reset = useCallback(() => setView((cur) => ({ ...cur, sort: defaultSort, hidden: defaultHidden })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setView, defaultSort?.key, defaultSort?.dir, defaultHidden])
  const isDefault = sortKey === (defaultSort ? `${defaultSort.key}:${defaultSort.dir}` : '')
    && [...hidden].sort().join(',') === [...defaultHidden].sort().join(',')

  return {
    columns, visible, sort, hidden, view, setView, apply, requestSort, toggleColumn, reset, isDefault,
    shows: (key) => !hidden.has(key),
    ariaSort: (key) => ariaSortFor(sort, key, isSortable(columns.find((c) => c.key === key)) ? 'none' : undefined),
  }
}

/** The header row: one `<th>` per visible column; a sortable one is a button. */
export function PanelTableHead({ table, testId = null }) {
  return (
    <thead>
      <tr>
        {table.visible.map((c) => {
          const cls = [c.thClass, c.phoneHide ? mp.phoneHide : null].filter(Boolean).join(' ') || undefined
          if (!isSortable(c)) {
            return <th key={c.key} scope="col" className={cls} title={c.title}>{c.label}</th>
          }
          const active = table.sort?.key === c.key
          const caret = sortCaretFor(table.sort, c.key)
          return (
            <th key={c.key} scope="col" className={cls} aria-sort={table.ariaSort(c.key)} title={c.title}>
              <button type="button" className={`${styles.sortBtn} ${active ? styles.sortActive : ''}`}
                onClick={() => table.requestSort(c.key)}
                data-testid={testId ? `${testId}-sort-${c.key}` : undefined}>
                {c.label}
                <span className={styles.caret} aria-hidden="true">{caret}</span>
              </button>
            </th>
          )
        })}
      </tr>
    </thead>
  )
}

/** The "Columns" menu: a soft-square list (a required column is ticked and fixed) and "Reset". */
export function PanelColumns({ table, testId = null, label = 'Columns' }) {
  const [open, setOpen] = useState(false)
  // The menu opens toward the side with room: from the button's left edge, unless that would run
  // past the window's right edge (a Columns button at the end of a wide toolbar).
  const [toEnd, setToEnd] = useState(false)
  const boxRef = useRef(null)
  const btnRef = useRef(null)
  const id = useId()
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btnRef.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true) }
  }, [open])
  const choosable = table.columns.filter((c) => c.label)
  return (
    <div className={styles.colsBox} ref={boxRef}>
      <button type="button" ref={btnRef} className={styles.colsBtn} aria-expanded={open} aria-controls={id}
        onClick={() => {
          const r = btnRef.current?.getBoundingClientRect?.()
          const room = typeof window !== 'undefined' ? window.innerWidth : 0
          setToEnd(!!r && room > 0 && r.left + 288 > room - 16)
          setOpen((o) => !o)
        }} data-testid={testId || undefined}>
        {label}{table.isDefault ? '' : ' (changed)'}
      </button>
      {open && (
        <div className={`${styles.colsMenu} ${toEnd ? styles.colsMenuEnd : ''}`} id={id} role="group" aria-label="Show columns"
          data-testid={testId ? `${testId}-menu` : undefined}>
          <p className={styles.colsHint}>Show columns</p>
          {choosable.map((c) => (
            <label key={c.key} className={`${styles.colsRow} ${c.required ? styles.colsFixed : ''}`}>
              <Checkbox className={styles.soft} checked={!table.hidden.has(c.key)} disabled={!!c.required}
                onChange={() => table.toggleColumn(c.key)}
                data-testid={testId ? `${testId}-col-${c.key}` : undefined} />
              <span>{c.label}{c.required ? <span className={styles.colsNote}> (always shown)</span> : null}</span>
            </label>
          ))}
          <button type="button" className={styles.colsReset} onClick={() => table.reset()} disabled={table.isDefault}
            data-testid={testId ? `${testId}-reset` : undefined}>
            Reset sort and columns
          </button>
        </div>
      )}
    </div>
  )
}

export default PanelTableHead
