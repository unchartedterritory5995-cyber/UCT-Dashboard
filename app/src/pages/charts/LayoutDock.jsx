// app/src/pages/charts/LayoutDock.jsx
//
// The Layout Dock — a 28px strip welded to the bottom of the .workspace frame:
// layouts as bare text, the open one lit gold with a 2px cap seated on the
// dock's top edge so the board reads as hanging from its own name.
//
// ⭐ THE MODEL — the LIBRARY owns layouts, the RAIL is only a working set.
//
//   Layout library : every layout you have ever made. The one durable store.
//                    Opened with ＋. The ONLY place a layout can be deleted.
//   The rail       : a positional set of slots that point INTO the library, for
//                    switching fast. A layout may sit on it twice. Closing a
//                    slot takes it off the bar and NEVER deletes it — whatever
//                    you close is still in your library.
//
// So the rail's menu offers "Close" and never "Delete", and ＋ opens the library
// rather than immediately making something.
//
// ⭐ Why this sits AFTER </main> inside .workspace rather than in Layout.jsx:
// `computeRowHeight()` divides whatever the ResizeObserver measures on
// .workspaceBody into FIXED_ROWS, so a flex sibling below <main> shrinks the
// board and re-tiles the grid with zero changes to the layout math. It also
// makes the dock start after the 60px nav rail, bracketing the workspace with
// the same frame the header opens.
//
// ⭐ YOUR layouts AUTO-SAVE into the library as you work (the workspace owns
// that; every switch flushes first). A PREBUILT layout is shared with every
// member, so it is never written automatically.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import usePreferences from '../../hooks/usePreferences'
import UIcon from '../../components/ui/UIcon'
import {
  DOCK_PREF, UCT_DEFAULT_ID, readDockPref, reconcilePins, sameDock,
  movePin, removePin, addPin,
} from './layoutDockPins'
import styles from './LayoutDock.module.css'

export default function LayoutDock({
  entries, activeId, loading = false, merged = false, isAdmin = false,
  onOpen, onCreate, onSave, onDuplicate, onDelete, onRename,
}) {
  const { prefs, setPref, loading: prefsLoading } = usePreferences()
  const stored = useMemo(() => readDockPref(prefs?.[DOCK_PREF]), [prefs])

  const byId = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries])
  const dock = useMemo(() => reconcilePins(stored, entries), [stored, entries])

  const writeDock = useCallback((next) => {
    setPref(DOCK_PREF, JSON.stringify(next))
  }, [setPref])

  // Persist only a CHANGED reconciliation, and never before both sides have
  // settled — seeding against a half-loaded list would write a rail that is
  // missing everything still in flight.
  useEffect(() => {
    if (prefsLoading || loading) return
    if (sameDock(stored, dock)) return
    writeDock(dock)
  }, [prefsLoading, loading, stored, dock, writeDock])

  // SLOTS, not a set: [{ entry, index }], duplicates allowed.
  const slots = useMemo(
    () => dock.pins
      .map((id, index) => ({ entry: byId.get(id), index }))
      .filter(s => s.entry),
    [dock.pins, byId],
  )

  // ── overflow ────────────────────────────────────────────────────────────
  // A hidden mirror row holds every slot at its natural width, so the widths are
  // always measurable — measuring the VISIBLE row instead would lose the width
  // of an item the moment it was trimmed, and the fit could never be recomputed
  // when the workspace widens again.
  const stripRef = useRef(null)
  const mirrorRef = useRef(null)
  const [visibleCount, setVisibleCount] = useState(slots.length)

  const measure = useCallback(() => {
    const strip = stripRef.current
    const mirror = mirrorRef.current
    if (!strip || !mirror) return
    const avail = strip.clientWidth
    let used = 0
    let fit = 0
    for (const child of mirror.children) {
      used += child.offsetWidth
      if (used > avail) break
      fit += 1
    }
    // Always render at least one: max-width + ellipsis makes a single squeezed
    // name far more useful than an empty bar next to a "⋯ +12".
    setVisibleCount(Math.max(1, fit))
  }, [])

  // ONE writer: the ResizeObserver. It fires on observe(), so it also supplies
  // the first measurement — no setState-in-effect needed. Both elements are
  // watched because they change for different reasons: the strip when the
  // workspace is resized, the mirror when the rail itself changes.
  useEffect(() => {
    const strip = stripRef.current
    const mirror = mirrorRef.current
    if (!strip || !mirror || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(strip)
    ro.observe(mirror)
    return () => ro.disconnect()
  }, [measure])

  const shown = useMemo(() => {
    const list = slots.slice(0, visibleCount)
    // The dock's second job is answering "which layout am I in?", so an active
    // layout that would be overflowed takes the last visible slot rather than
    // vanishing. Losing the active state entirely is the worse compromise.
    if (activeId != null && slots.some(s => s.entry.id === activeId) && !list.some(s => s.entry.id === activeId)) {
      const active = slots.find(s => s.entry.id === activeId)
      return list.slice(0, Math.max(0, list.length - 1)).concat(active)
    }
    return list
  }, [slots, visibleCount, activeId])

  const shownIdx = useMemo(() => new Set(shown.map(s => s.index)), [shown])
  const overflow = useMemo(() => slots.filter(s => !shownIdx.has(s.index)), [slots, shownIdx])

  // A prebuilt (global-scope) layout is shared with every member, and the frozen
  // UCT Default is not a row at all — neither is yours to write or delete.
  const writable = useCallback(
    (entry) => !!entry && entry.id !== UCT_DEFAULT_ID && (entry.scope !== 'global' || isAdmin),
    [isAdmin],
  )

  const mine = useMemo(() => entries.filter(e => e.id !== UCT_DEFAULT_ID && e.scope !== 'global'), [entries])
  const prebuilt = useMemo(() => entries.filter(e => e.id === UCT_DEFAULT_ID || e.scope === 'global'), [entries])

  // ── popovers ────────────────────────────────────────────────────────────
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [menu, setMenu] = useState(null)          // { slot, x }
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const dockRef = useRef(null)

  const closePopovers = useCallback(() => {
    setLibraryOpen(false)
    setOverflowOpen(false)
    setMenu(null)
    setConfirmDeleteId(null)
  }, [])

  useEffect(() => {
    if (!libraryOpen && !overflowOpen && !menu) return
    const onDown = (e) => { if (!dockRef.current?.contains(e.target)) closePopovers() }
    const onKey = (e) => { if (e.key === 'Escape') closePopovers() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [libraryOpen, overflowOpen, menu, closePopovers])

  // ── new layout ──────────────────────────────────────────────────────────
  // Named INLINE, in the slot it will occupy, so the thing you just made is
  // already where your hand will look for it.
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { if (creating) inputRef.current?.focus() }, [creating])

  // The name lands on the bar the INSTANT you press Enter, while the POST is
  // still in flight. Derived, so it stops rendering the moment the real row
  // arrives and can never duplicate it.
  const [provisional, setProvisional] = useState(null)
  const showProvisional = provisional && !entries.some(e => e.name === provisional)
  useEffect(() => {
    if (!provisional) return
    const t = setTimeout(() => setProvisional(null), 8000)
    return () => clearTimeout(t)
  }, [provisional])

  const commitCreate = useCallback(() => {
    const name = draft.trim()
    setCreating(false)
    setDraft('')
    if (!name) return
    setProvisional(name)
    onCreate?.(name)
  }, [draft, onCreate])

  // ── rename ──────────────────────────────────────────────────────────────
  const [renaming, setRenaming] = useState(null)   // slot index
  const [renameDraft, setRenameDraft] = useState('')
  const renameRef = useRef(null)
  useEffect(() => { if (renaming != null) renameRef.current?.select() }, [renaming])

  const commitRename = useCallback(() => {
    const slot = slots.find(s => s.index === renaming)
    const name = renameDraft.trim()
    setRenaming(null)
    setRenameDraft('')
    if (!slot || !name || name === slot.entry.name) return
    onRename?.(slot.entry.id, name)
  }, [renaming, renameDraft, slots, onRename])

  const open = useCallback((entry) => {
    closePopovers()
    // Re-opening the layout you are already in would reload the board and throw
    // away whatever you have changed since. Never do it.
    if (entry.id === activeId) return
    onOpen?.(entry)
  }, [activeId, onOpen, closePopovers])

  // ── rail operations (all POSITIONAL) ────────────────────────────────────
  const move = useCallback((index, delta) => {
    writeDock({ ...dock, pins: movePin(dock.pins, index, delta) })
    setMenu(null)
  }, [dock, writeDock])

  // CLOSE, not delete. The layout stays in the library — that is the whole
  // contract of the rail, and why this menu has no destructive action at all.
  const closeSlot = useCallback((index) => {
    writeDock({ ...dock, pins: removePin(dock.pins, index) })
    closePopovers()
  }, [dock, writeDock, closePopovers])

  const addToBar = useCallback((entry) => {
    writeDock({ ...dock, pins: addPin(dock.pins, entry.id) })
    closePopovers()
    if (entry.id !== activeId) onOpen?.(entry)
  }, [dock, writeDock, closePopovers, activeId, onOpen])

  const renderItem = (slot, isProvisional = false) => {
    const { entry, index } = slot
    const active = !isProvisional && entry.id === activeId
    return (
      <button
        key={isProvisional ? '__provisional' : `${entry.id}@${index}`}
        type="button"
        className={`${styles.item} ${active || isProvisional ? styles.itemActive : ''}`}
        // Primary button only: a right-click that also emits a click (some
        // automation and a few input devices do) must open the MENU, not switch
        // the board out from under you.
        onClick={(e) => { if (!isProvisional && e.button === 0) open(entry) }}
        onContextMenu={(e) => {
          if (isProvisional) return
          e.preventDefault()
          setLibraryOpen(false)
          setOverflowOpen(false)
          const rect = dockRef.current?.getBoundingClientRect()
          setMenu({ slot, x: rect ? e.clientX - rect.left : 0 })
        }}
        title={entry.name}
        aria-current={active ? 'true' : undefined}
      >
        {renaming === index && !isProvisional ? (
          <input
            ref={renameRef}
            className={styles.nameInput}
            value={renameDraft}
            maxLength={60}
            aria-label={`Rename ${entry.name}`}
            onClick={e => e.stopPropagation()}
            onChange={e => setRenameDraft(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              else if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); setRenameDraft('') }
            }}
            onBlur={commitRename}
          />
        ) : (
          <span className={styles.label}>{entry.name}</span>
        )}
      </button>
    )
  }

  if (dock.hidden) return null

  const menuEntry = menu?.slot?.entry

  return (
    <div
      className={`${styles.dock} ${merged ? styles.dockMerged : ''}`}
      ref={dockRef}
      role="toolbar"
      aria-label="Saved layouts"
    >
      <div className={styles.strip} ref={stripRef}>
        {shown.map(s => renderItem(s))}
        {showProvisional && renderItem({ entry: { id: '__provisional', name: provisional }, index: -1 }, true)}
        {creating && (
          <span className={`${styles.item} ${styles.itemCreating}`}>
            <input
              ref={inputRef}
              className={styles.nameInput}
              value={draft}
              maxLength={60}
              placeholder="Name this layout"
              aria-label="New layout name"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitCreate() }
                // Escape abandons the NAME, not the board: you are left on the
                // blank workspace exactly as "New Layout" leaves you, with no
                // half-named row written to the library.
                else if (e.key === 'Escape') { e.preventDefault(); setCreating(false); setDraft('') }
              }}
              onBlur={commitCreate}
            />
          </span>
        )}
      </div>

      {/* Width oracle for the fit calculation — never shown, never focusable. */}
      <div className={styles.mirror} ref={mirrorRef} aria-hidden="true">
        {slots.map(s => (
          <span key={`${s.entry.id}@${s.index}`} className={styles.item}>
            <span className={styles.label}>{s.entry.name}</span>
          </span>
        ))}
      </div>

      <div className={styles.right}>
        {overflow.length > 0 && (
          <button
            type="button"
            className={styles.ctl}
            onClick={() => { setLibraryOpen(false); setMenu(null); setOverflowOpen(o => !o) }}
            title="Layouts that don't fit"
            aria-label="More layouts on the bar"
            aria-expanded={overflowOpen}
          >
            <UIcon name="more" size={13} gold={false} />
            <span className={styles.count}>+{overflow.length}</span>
          </button>
        )}
        <button
          type="button"
          className={styles.ctl}
          onClick={() => { setOverflowOpen(false); setMenu(null); setLibraryOpen(o => !o) }}
          title="Layout library"
          aria-label="Layout library"
          aria-expanded={libraryOpen}
        >
          <UIcon name="plus" size={13} gold={false} />
        </button>
      </div>

      {/* ── the layout library ──────────────────────────────────────────── */}
      {libraryOpen && (
        <div className={styles.library} role="menu" aria-label="Layout library">
          <div className={styles.libraryHead}>Layout library</div>
          <button
            type="button" role="menuitem" className={styles.libraryNew}
            onClick={() => { closePopovers(); setDraft(''); setCreating(true) }}
          >＋ New layout</button>
          <div className={styles.menuDiv} />
          {mine.length === 0 && <div className={styles.browseEmpty}>No saved layouts yet.</div>}
          {mine.map(e => (
            <div key={e.id} className={styles.libraryRow}>
              <button
                type="button" role="menuitem" className={styles.libraryPick}
                title={`Add ${e.name} to the bar`}
                onClick={() => addToBar(e)}
              >{e.name}</button>
              {/* The library is the ONLY place a layout can be destroyed. */}
              {confirmDeleteId === e.id ? (
                <button
                  type="button" className={styles.libraryDelConfirm}
                  onClick={() => { onDelete?.(e); setConfirmDeleteId(null) }}
                >Delete?</button>
              ) : (
                <button
                  type="button" className={styles.libraryDel}
                  title={`Delete ${e.name} permanently`}
                  aria-label={`Delete ${e.name} permanently`}
                  onClick={() => setConfirmDeleteId(e.id)}
                >✕</button>
              )}
            </div>
          ))}
          {prebuilt.length > 0 && (<>
            <div className={styles.browseSection}>Prebuilt</div>
            {prebuilt.map(e => (
              <div key={e.id} className={styles.libraryRow}>
                <button
                  type="button" role="menuitem" className={styles.libraryPick}
                  title={`Add ${e.name} to the bar`}
                  onClick={() => addToBar(e)}
                >{e.name}</button>
              </div>
            ))}
          </>)}
        </div>
      )}

      {/* ── overflow: what is on the bar but did not fit ────────────────── */}
      {overflowOpen && (
        <div className={styles.browse} role="menu" aria-label="More layouts on the bar">
          <div className={styles.browseSection}>On the bar</div>
          {overflow.map(s => (
            <button
              key={`${s.entry.id}@${s.index}`}
              type="button" role="menuitem" className={styles.browseRow}
              onClick={() => open(s.entry)}
            >{s.entry.name}</button>
          ))}
        </div>
      )}

      {/* ── right-click: rail actions ONLY. No delete lives here. ───────── */}
      {menu && (
        <div
          className={styles.menu}
          role="menu"
          aria-label={`${menuEntry.name} actions`}
          style={{ left: Math.max(6, menu.x - 20) }}
        >
          <div className={styles.menuHead}>{menuEntry.name}</div>
          <button
            type="button" role="menuitem" className={styles.menuItem}
            disabled={menu.slot.index <= 0}
            onClick={() => move(menu.slot.index, -1)}
          >← Move left</button>
          <button
            type="button" role="menuitem" className={styles.menuItem}
            disabled={menu.slot.index >= dock.pins.length - 1}
            onClick={() => move(menu.slot.index, 1)}
          >Move right →</button>
          <div className={styles.menuDiv} />
          {/* Only for the layout you are IN: saving the board into some OTHER
              layout would overwrite it with a board it never held. */}
          {menuEntry.id === activeId && writable(menuEntry) && (
            <button
              type="button" role="menuitem" className={styles.menuItem}
              onClick={() => { onSave?.(); setMenu(null) }}
            >Save layout to library</button>
          )}
          {writable(menuEntry) && (
            <button
              type="button" role="menuitem" className={styles.menuItem}
              onClick={() => { setRenameDraft(menuEntry.name); setRenaming(menu.slot.index); setMenu(null) }}
            >Rename layout</button>
          )}
          <button
            type="button" role="menuitem" className={styles.menuItem}
            onClick={() => { onDuplicate?.(menuEntry); setMenu(null) }}
          >Duplicate layout</button>
          <div className={styles.menuDiv} />
          <button
            type="button" role="menuitem" className={styles.menuItem}
            onClick={() => closeSlot(menu.slot.index)}
          >Close</button>
        </div>
      )}
    </div>
  )
}
