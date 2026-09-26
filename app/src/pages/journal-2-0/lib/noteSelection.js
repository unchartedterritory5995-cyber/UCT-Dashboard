/**
 * Multi-select over the notes currently IN VIEW (list and table views).
 *
 * The rules, each a sentence a member would say:
 *  - a click on a checkbox toggles that note;
 *  - a Shift+click selects (or clears) every note between the last one clicked
 *    and this one, in the order they are shown — the range takes the state the
 *    clicked note is moving TO, so Shift+click can also clear a run;
 *  - "select all" means all notes IN VIEW — never notes on a page not loaded;
 *  - a note that leaves the view (moved to another folder, trashed, filtered
 *    out) leaves the selection, so an action can never touch a note the member
 *    cannot see.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** The next selection after a click on `id`. Pure, for the rails. */
export function applyToggle(prev, orderedIds, anchorId, id, { shift = false } = {}) {
  const next = new Set(prev)
  const turnOn = !prev.has(id)
  const a = shift && anchorId != null ? orderedIds.indexOf(anchorId) : -1
  const b = orderedIds.indexOf(id)
  if (a >= 0 && b >= 0) {
    const [lo, hi] = a < b ? [a, b] : [b, a]
    for (let i = lo; i <= hi; i += 1) {
      if (turnOn) next.add(orderedIds[i])
      else next.delete(orderedIds[i])
    }
    return next
  }
  if (turnOn) next.add(id)
  else next.delete(id)
  return next
}

/** Only the ids still in view, in view order. Same Set back when nothing left. */
export function pruneToVisible(prev, orderedIds) {
  const visible = new Set(orderedIds)
  let dropped = false
  const next = new Set()
  for (const id of prev) {
    if (visible.has(id)) next.add(id)
    else dropped = true
  }
  return dropped ? next : prev
}

export function useNoteSelection(orderedIds) {
  const [selected, setSelected] = useState(() => new Set())
  const anchorRef = useRef(null)
  const idsKey = orderedIds.join('\u0000')

  useEffect(() => {
    setSelected((prev) => (prev.size ? pruneToVisible(prev, orderedIds) : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const toggle = useCallback((id, { shift = false } = {}) => {
    // ⛔ READ THE ANCHOR NOW, not inside the updater. React runs the updater
    // later, after the line below has already moved the anchor to `id` — so a
    // lazily-read anchor made every Shift+click a range of one. (Caught by the
    // hook test, not the pure-function tests, which cannot see scheduling.)
    const anchor = anchorRef.current
    setSelected((prev) => applyToggle(prev, orderedIds, anchor, id, { shift }))
    anchorRef.current = id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const selectAll = useCallback(() => {
    setSelected(new Set(orderedIds))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const clear = useCallback(() => {
    setSelected((prev) => (prev.size ? new Set() : prev))
    anchorRef.current = null
  }, [])

  const selectedIds = useMemo(
    () => orderedIds.filter((id) => selected.has(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, idsKey],
  )

  return {
    selectedIds,
    count: selectedIds.length,
    isSelected: useCallback((id) => selected.has(id), [selected]),
    allSelected: orderedIds.length > 0 && selectedIds.length === orderedIds.length,
    toggle,
    selectAll,
    clear,
  }
}
