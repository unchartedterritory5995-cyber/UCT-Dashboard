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
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { PanelViewContext } from './terminalPanel'
import { normalizeView, readView, storedView, viewKey } from './panelView'

export default function usePanelView(defaults = {}) {
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
