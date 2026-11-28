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
//   available     false: this answer cannot fill it, so it is neither drawn nor offered
//   thProps       extra attributes for the header cell (a panel's own data- attributes)
//   defaultHidden hidden until the member shows it      required  can never be hidden
//
// ⭐ THE LIST'S OWN ORDER IS THE DEFAULT. `defaultSort: null` keeps the order the server sent
// (rank, time, the list's meaning). A header click sorts; clicking the same header turns it round;
// a third click puts the list back in its own order (or the panel's default sort). "Reset" in the
// Columns menu puts both the sort and the columns back.
//
// The sort itself is the shared DataGrid seed (`lib/presentation/dataGrid`: nextSort, sortRows,
// ariaSortFor): blanks sink to the bottom both ways, equal values keep the list's order.
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ASC, DESC, ariaSortFor, nextSort, sortCaretFor, sortRows } from '../../lib/presentation/dataGrid'
import Checkbox from '../ui/Checkbox'
import { PanelViewContext } from './terminalPanel'
import { normalizeView, readView, storedView, viewKey } from './panelView'
// One stylesheet with the panels' own (marketPanels): a stylesheet of its own would add a chunk name
// to every first open that preloads a panel (the Notebook budget, 2026-11-28).
import mp from '../../pages/terminal/panels/marketPanels.module.css'

const isSortable = (c) => typeof c?.sort === 'function'
const firstDirOf = (c) => c?.firstDir || (c?.type === 'text' ? ASC : DESC)

// ── usePanelView: the panel's view, kept with the board (was usePanelView.js, which re-exports it)
// UCT Terminal — `usePanelView(defaults)`: the panel's view (sort, hidden columns, filters), kept
// with the board (customization pass 1, 2026-11-27). The shape and its bounds: panelView.js.
//
//   const [view, setView] = usePanelView({ sort: null, hidden: ['volume'], filters: { minPrice: 0 } })
//   view     { sort: {key, dir} | null, hidden: [keys], filters: {…} }  defaults filled in
//   setView  setView({ sort })                    merge into the view (filters merge key by key)
//            setView((cur) => ({ ...cur, … }))     or compute the whole next view
//
// ⭐ INSIDE THE SHELL the view lives on the panel record: a write saves it with the board through
// the layout's own debounced save (useTerminalLayout `save`), never re-runs the command, so the
// panel is NOT remounted and keeps its data, scroll and open rows. OUTSIDE THE SHELL (a panel
// rendered on its own, a page) it is plain component state.
//
// Only what differs from `defaults` is stored (`storedView`), so a panel put back to its defaults
// stores nothing. A view written from outside (another tab's board, a board opened over this
// one under the same panel id) is adopted; the hook's own write echoing back is not re-read.
export function usePanelView(defaults = {}) {
  const ctx = useContext(PanelViewContext)
  const defKey = JSON.stringify(defaults || {})
  const defaultsRef = useRef(defaults || {})
  defaultsRef.current = defaults || {}

  const [stored, setStored] = useState(() => normalizeView(ctx?.view))
  const storedRef = useRef(stored)
  // The view key this hook last sent up (or adopted): an echo of it is not an outside change.
  const sentRef = useRef(viewKey(stored))

  const incoming = viewKey(ctx?.view)
  const incomingView = ctx?.view
  useEffect(() => {
    if (incoming === sentRef.current) return
    sentRef.current = incoming
    storedRef.current = normalizeView(incomingView)
    setStored(storedRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming])

  const pushRef = useRef(null)
  pushRef.current = ctx?.setView || null

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => readView(stored, defaultsRef.current), [stored, defKey])

  // The write goes up AT ONCE, not in an effect: a chip that writes the view and then re-runs
  // the command in the same click (MOST's lens) remounts the panel, and an effect of the
  // unmounted panel would never run, so the view would be lost.
  const getRef = useRef(null)
  getRef.current = ctx?.get || null
  const setView = useCallback((patch) => {
    // Two hooks in one panel (a table and the list it opens) each write the whole view: the base is
    // the record as it stands now (`get`), so one never writes back over the other's change.
    const prev = getRef.current ? normalizeView(getRef.current()) : storedRef.current
    const cur = readView(prev, defaultsRef.current)
    let next
    if (typeof patch === 'function') next = patch(cur)
    else {
      const p = patch || {}
      next = { ...cur, ...p, filters: p.filters ? { ...cur.filters, ...p.filters } : cur.filters }
    }
    const out = storedView(next, defaultsRef.current)
    const k = viewKey(out)
    if (k === viewKey(prev)) return
    storedRef.current = out
    sentRef.current = k
    setStored(out)
    pushRef.current?.(out)
  }, [])

  return [view, setView]
}

/**
 * `usePanelSort(defaultSort)`: a panel's sort `{ key, dir }` kept in its view, the drop-in for
 * `useState(defaultSort)` in a panel that already sorts (it takes a value or an updater, like the
 * state setter it replaces). The default is not stored, so a panel left on it stores nothing.
 * One per panel: a panel's view holds one sort.
 */
export function usePanelSort(defaultSort) {
  const [view, setView] = usePanelView({ sort: defaultSort })
  const defRef = useRef(defaultSort)
  defRef.current = defaultSort
  const sort = view.sort || defaultSort
  const setSort = useCallback((next) => {
    setView((cur) => ({ ...cur, sort: typeof next === 'function' ? next(cur.sort || defRef.current) : next }))
  }, [setView])
  return [sort, setSort]
}

/** The view filter a sort slot is kept under (`s.rank`, `s.members`, `s.30D`). */
export const sortSlotKey = (slot) => `s.${String(slot || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30)}`
const SLOT_DIRS = ['asc', 'desc']
/** Pure: `key|dir` back to `{ key, dir }`, or null. */
export function readSortSlot(text) {
  if (typeof text !== 'string' || !text) return null
  const [key, dir] = text.split('|')
  return key && SLOT_DIRS.includes(dir) ? { key, dir } : null
}

/**
 * `usePanelSortSlot(slot, defaultSort)`: like `usePanelSort`, but the sort is kept under its own
 * name in the view's filters (`s.<slot>` = `key|dir`), so one panel keeps several: one per mode of
 * a table (GRPS rank / growth / ...), one for the stocks it opens, one per lens (LEAD 30D / 60D).
 * Changing `slot` shows that slot's own sort (or its default); the default is never stored.
 */
export function usePanelSortSlot(slot, defaultSort) {
  const name = sortSlotKey(slot)
  const [view, setView] = usePanelView({ filters: { [name]: '' } })
  const defRef = useRef(defaultSort)
  defRef.current = defaultSort
  const nameRef = useRef(name)
  nameRef.current = name
  const sort = readSortSlot(view.filters[name]) || defaultSort
  const setSort = useCallback((next) => {
    setView((cur) => {
      const k = nameRef.current
      const now = readSortSlot(cur.filters[k]) || defRef.current
      const want = typeof next === 'function' ? next(now) : next
      const d = defRef.current
      const same = !want || (d && want.key === d.key && want.dir === d.dir)
      return { ...cur, filters: { ...cur.filters, [k]: same ? '' : `${want.key}|${want.dir}` } }
    })
  }, [setView])
  return [sort, setSort]
}

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
  // A column the answer cannot fill (`available: false`, e.g. OIC's volume when none was sent) is not
  // drawn and not offered in the Columns menu.
  const visible = useMemo(() => columns.filter((c) => c.available !== false && !hidden.has(c.key)), [columns, hidden])
  const absent = useMemo(() => new Set(columns.filter((c) => c.available === false).map((c) => c.key)), [columns])

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
    shows: (key) => !hidden.has(key) && !absent.has(key),
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
            return <th key={c.key} scope="col" className={cls} title={c.title} {...(c.thProps || {})}>{c.label}</th>
          }
          const active = table.sort?.key === c.key
          const caret = sortCaretFor(table.sort, c.key)
          return (
            <th key={c.key} scope="col" className={cls} aria-sort={table.ariaSort(c.key)} title={c.title} {...(c.thProps || {})}>
              <button type="button" className={`${mp.ptSortBtn} ${active ? mp.ptSortActive : ''}`}
                onClick={() => table.requestSort(c.key)}
                data-testid={testId ? `${testId}-sort-${c.key}` : undefined}>
                {c.label}
                <span className={mp.ptCaret} aria-hidden="true">{caret}</span>
              </button>
            </th>
          )
        })}
      </tr>
    </thead>
  )
}

/** Pure: where the floating Columns menu goes, in viewport pixels (`position: fixed`). Under the
 *  button, its left edge on the button's, kept `GAP` inside the window on both sides; above the
 *  button when there is more room there than below; `maxHeight` is the room it has. */
export const MENU_GAP = 16
export function placeMenu(btn, menu, view) {
  const w = Math.min(menu.width || 0, Math.max(0, view.width - 2 * MENU_GAP))
  const left = Math.max(MENU_GAP, Math.min(btn.left, view.width - MENU_GAP - w))
  const below = view.height - MENU_GAP - (btn.bottom + 4)
  const above = btn.top - 4 - MENU_GAP
  const up = (menu.height || 0) > below && above > below
  const room = Math.max(120, up ? above : below)
  const h = Math.min(menu.height || 0, room)
  return { left, top: up ? Math.max(MENU_GAP, btn.top - 4 - h) : btn.bottom + 4, maxHeight: room, up }
}

/**
 * The "Columns" menu: a soft-square list (a required column is ticked and fixed) and "Reset".
 * ⛔ IT IS NEVER CUT. The panel body scrolls (`.panelBody { overflow: auto }`), the shell hides its
 * overflow (`.shell`), and a table box scrolls sideways (`.tableBox`), so a menu drawn inside the
 * panel was clipped by all three. It is drawn in a portal on `document.body`, fixed, placed from
 * the button (`placeMenu`) and placed again on scroll and resize. Focus moves into it when it opens
 * (the portal is at the end of the page, so Tab would not reach it otherwise), Escape closes it and
 * gives focus back, and focus leaving it closes it.
 */
export function PanelColumns({ table, testId = null, label = 'Columns' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)
  const id = useId()
  const close = useCallback((refocus) => { setOpen(false); setPos(null); if (refocus) btnRef.current?.focus() }, [])
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect?.()
    const m = menuRef.current?.getBoundingClientRect?.()
    if (!b || typeof window === 'undefined') return
    setPos(placeMenu(b, { width: m?.width || 0, height: m?.height || 0 }, { width: window.innerWidth, height: window.innerHeight }))
  }, [])
  useLayoutEffect(() => {
    if (!open) return undefined
    place()
    menuRef.current?.querySelector('input:not([disabled]), button:not([disabled])')?.focus()
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      close(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place, close])
  // Escape is the menu's own key (focus is inside it from the moment it opens), an element listener,
  // never one on the page (TERM-063: the raw key-listener census).
  const onMenuKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(true) } }
  const onBlur = (e) => {
    const to = e.relatedTarget
    if (to && (menuRef.current?.contains(to) || btnRef.current?.contains(to))) return
    if (to) close(false)
  }
  const choosable = table.columns.filter((c) => c.label && c.available !== false)
  const menu = open ? (
    <div ref={menuRef} className={mp.ptColsMenu} id={id} role="group" aria-label="Show columns" onBlur={onBlur} onKeyDown={onMenuKey}
      style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { visibility: 'hidden', left: 0, top: 0 }}
      data-placement={pos ? (pos.up ? 'above' : 'below') : undefined}
      data-testid={testId ? `${testId}-menu` : undefined}>
      <p className={mp.ptColsHint}>Show columns</p>
      {choosable.map((c) => (
        <label key={c.key} className={`${mp.ptColsRow} ${c.required ? mp.ptColsFixed : ''}`}>
          <Checkbox className={mp.ptSoft} checked={!table.hidden.has(c.key)} disabled={!!c.required}
            onChange={() => table.toggleColumn(c.key)}
            data-testid={testId ? `${testId}-col-${c.key}` : undefined} />
          <span>{c.label}{c.required ? <span className={mp.ptColsNote}> (always shown)</span> : null}</span>
        </label>
      ))}
      <button type="button" className={mp.ptColsReset} onClick={() => table.reset()} disabled={table.isDefault}
        data-testid={testId ? `${testId}-reset` : undefined}>
        Reset sort and columns
      </button>
    </div>
  ) : null
  return (
    <div className={mp.ptColsBox}>
      <button type="button" ref={btnRef} className={mp.ptColsBtn} aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : setOpen(true))} data-testid={testId || undefined}>
        {label}{table.isDefault ? '' : ' (changed)'}
      </button>
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
    </div>
  )
}

export default PanelTableHead
