// app/src/pages/charts/LayoutDock.jsx
//
// The Layout Dock — the workspace's FAST PATH between saved layouts. A 28px
// strip welded to the bottom of the .workspace frame: pinned layouts as bare
// text, the open one lit gold with a 2px cap seated on the dock's top edge so
// the board reads as hanging from its own name.
//
// It is a fast path, NOT a second management surface. Layouts ▾ keeps New /
// Open / Save / Save as / Multi Chart / Pop Out; the dock switches, creates,
// reorders and (via ⋯) reaches whatever didn't fit.
//
// ⭐ Why this sits AFTER </main> inside .workspace rather than in Layout.jsx:
// `computeRowHeight()` divides whatever the ResizeObserver measures on
// .workspaceBody into FIXED_ROWS, so a flex sibling below <main> shrinks the
// board and re-tiles the grid with zero changes to the layout math. It also
// makes the dock start after the 60px nav rail, bracketing the workspace with
// the same frame the header opens.
//
// ⭐ YOUR layouts AUTO-SAVE — the workspace owns that (see its auto-save
// effect), so there is no unsaved dot and no switch-away confirm: you leave a
// layout as you left it and it is there when you come back. A PREBUILT layout
// is shared with every member, so it is never written automatically and
// behaves exactly as it always has.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import usePreferences from '../../hooks/usePreferences'
import UIcon from '../../components/ui/UIcon'
import { DOCK_PREF, UCT_DEFAULT_ID, readDockPref, reconcilePins, sameDock } from './layoutDockPins'
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
  // settled — seeding against a half-loaded list would write a pin order that
  // is missing everything still in flight.
  useEffect(() => {
    if (prefsLoading || loading) return
    if (sameDock(stored, dock)) return
    writeDock(dock)
  }, [prefsLoading, loading, stored, dock, writeDock])

  const pinned = useMemo(
    () => dock.pins.map(id => byId.get(id)).filter(Boolean),
    [dock.pins, byId],
  )

  // ── overflow ────────────────────────────────────────────────────────────
  // A hidden mirror row holds every pin at its natural width, so the widths are
  // always measurable — measuring the VISIBLE row instead would lose the width
  // of an item the moment it was trimmed, and the fit could never be recomputed
  // when the workspace widens again.
  const stripRef = useRef(null)
  const mirrorRef = useRef(null)
  const [visibleCount, setVisibleCount] = useState(pinned.length)

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
  // workspace is resized, the mirror when the pin set itself changes (adding a
  // layout widens the mirror without touching the strip).
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
    const list = pinned.slice(0, visibleCount)
    // The dock's second job is answering "which layout am I in?", so an active
    // layout that would be overflowed takes the last visible slot rather than
    // vanishing. Rare — it needs a switch made from the ⋯ list — and losing the
    // active state entirely is the worse of the two compromises.
    if (activeId != null && pinned.some(e => e.id === activeId) && !list.some(e => e.id === activeId)) {
      const active = pinned.find(e => e.id === activeId)
      return list.slice(0, Math.max(0, list.length - 1)).concat(active)
    }
    return list
  }, [pinned, visibleCount, activeId])

  const shownIds = useMemo(() => new Set(shown.map(e => e.id)), [shown])
  const overflow = useMemo(() => pinned.filter(e => !shownIds.has(e.id)), [pinned, shownIds])
  const unpinned = useMemo(() => entries.filter(e => !dock.pins.includes(e.id)), [entries, dock.pins])

  // A prebuilt (global-scope) layout is shared with every member, and the frozen
  // UCT Default is not a row at all — neither is yours to write or delete.
  const writable = useCallback(
    (entry) => !!entry && entry.id !== UCT_DEFAULT_ID && (entry.scope !== 'global' || isAdmin),
    [isAdmin],
  )

  // ── popovers ────────────────────────────────────────────────────────────
  const [browseOpen, setBrowseOpen] = useState(false)
  const [menu, setMenu] = useState(null)   // { entry, x } — the right-click menu
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dockRef = useRef(null)

  const closePopovers = useCallback(() => {
    setBrowseOpen(false)
    setMenu(null)
    setConfirmDelete(false)
  }, [])

  useEffect(() => {
    if (!browseOpen && !menu) return
    const onDown = (e) => { if (!dockRef.current?.contains(e.target)) closePopovers() }
    const onKey = (e) => { if (e.key === 'Escape') closePopovers() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [browseOpen, menu, closePopovers])

  // ── ＋ new layout ────────────────────────────────────────────────────────
  // Naming happens INLINE, in the slot the layout will occupy, so the thing you
  // just made is already where your hand will look for it.
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { if (creating) inputRef.current?.focus() }, [creating])

  // The name lands on the bar the INSTANT you press Enter, while the POST is
  // still in flight. Waiting for the round-trip made a new layout take a beat
  // to appear, which reads as the app being slow rather than the network being
  // slow. Cleared as soon as the real row arrives from the API.
  const [provisional, setProvisional] = useState(null)
  // DERIVED, not an effect: the placeholder is simply "a name I typed that the
  // real list has not caught up with yet", so it stops rendering the moment the
  // row arrives — no state write, no extra render pass.
  const showProvisional = provisional && !entries.some(e => e.name === provisional)
  // Never strand a provisional name if the save failed.
  useEffect(() => {
    if (!provisional) return
    const t = setTimeout(() => setProvisional(null), 8000)
    return () => clearTimeout(t)
  }, [provisional])

  // ── rename ──────────────────────────────────────────────────────────────
  // Edited IN PLACE, in the slot the layout already occupies, so you can see the
  // new name land where you will look for it — same idiom as ＋.
  const [renaming, setRenaming] = useState(null)      // entry id
  const [renameDraft, setRenameDraft] = useState('')
  const renameRef = useRef(null)
  useEffect(() => { if (renaming != null) renameRef.current?.select() }, [renaming])

  const commitRename = useCallback(() => {
    const id = renaming
    const name = renameDraft.trim()
    const previous = entries.find(e => e.id === id)?.name
    setRenaming(null)
    setRenameDraft('')
    if (!id || !name || name === previous) return
    onRename?.(id, name)
  }, [renaming, renameDraft, entries, onRename])

  const commitCreate = useCallback(() => {
    const name = draft.trim()
    setCreating(false)
    setDraft('')
    if (!name) return
    setProvisional(name)
    onCreate?.(name)
  }, [draft, onCreate])

  const open = useCallback((entry) => {
    closePopovers()
    // Re-opening the layout you are already in would reload the board and throw
    // away whatever you have changed since. Never do it.
    if (entry.id === activeId) return
    onOpen?.(entry)
  }, [activeId, onOpen, closePopovers])

  // ── reorder ─────────────────────────────────────────────────────────────
  // Muscle memory is the whole value of a fixed bar, so the order is the user's
  // and it persists per-user.
  const move = useCallback((entry, delta) => {
    const pins = dock.pins.slice()
    const i = pins.indexOf(entry.id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= pins.length) return
    const swap = pins[i]
    pins[i] = pins[j]
    pins[j] = swap
    writeDock({ ...dock, pins })
    setMenu(null)
  }, [dock, writeDock])

  // Take a layout OFF the bar without destroying it. This is also the only
  // "remove" that can apply to UCT Default: the frozen default is an in-code
  // restore point, not a row, so there is nothing to delete — but it should not
  // have to occupy a slot forever. `known` remembers the choice, so an unpinned
  // layout does not quietly reappear on the next load; the ⋯ browser and
  // Layouts ▾ → Open Layout are how it comes back.
  const unpin = useCallback((entry) => {
    writeDock({ ...dock, pins: dock.pins.filter(id => id !== entry.id) })
    closePopovers()
  }, [dock, writeDock, closePopovers])

  const menuIndex = menu ? dock.pins.indexOf(menu.entry.id) : -1

  const renderItem = (entry, isProvisional = false) => {
    const active = !isProvisional && entry.id === activeId
    return (
      <button
        key={isProvisional ? '__provisional' : entry.id}
        type="button"
        className={`${styles.item} ${active || isProvisional ? styles.itemActive : ''}`}
        // Primary button only: a right-click that also emits a click (some
        // automation and a few input devices do) must open the MENU, not switch
        // the board out from under you.
        onClick={(e) => { if (!isProvisional && e.button === 0) open(entry) }}
        onContextMenu={(e) => {
          if (isProvisional) return
          e.preventDefault()
          setBrowseOpen(false)
          setConfirmDelete(false)
          const rect = dockRef.current?.getBoundingClientRect()
          setMenu({ entry, x: rect ? e.clientX - rect.left : 0 })
        }}
        title={entry.name}
        aria-current={active ? 'true' : undefined}
      >
        {renaming === entry.id ? (
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

  return (
    <div
      className={`${styles.dock} ${merged ? styles.dockMerged : ''}`}
      ref={dockRef}
      role="toolbar"
      aria-label="Saved layouts"
    >
      <div className={styles.strip} ref={stripRef}>
        {shown.map(e => renderItem(e))}
        {showProvisional && renderItem({ id: '__provisional', name: provisional }, true)}
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
                // blank workspace exactly as "New Layout" leaves you today, with
                // no half-named row written to the store.
                else if (e.key === 'Escape') { e.preventDefault(); setCreating(false); setDraft('') }
              }}
              onBlur={commitCreate}
            />
          </span>
        )}
      </div>

      {/* Width oracle for the fit calculation — never shown, never focusable. */}
      <div className={styles.mirror} ref={mirrorRef} aria-hidden="true">
        {pinned.map(e => (
          <span key={e.id} className={styles.item}><span className={styles.label}>{e.name}</span></span>
        ))}
      </div>

      <div className={styles.right}>
        <button
          type="button"
          className={styles.ctl}
          onClick={() => { setMenu(null); setBrowseOpen(o => !o) }}
          title="All layouts"
          aria-label="All layouts"
          aria-expanded={browseOpen}
        >
          <UIcon name="more" size={13} gold={false} />
          {overflow.length > 0 && <span className={styles.count}>+{overflow.length}</span>}
        </button>
        <button
          type="button"
          className={styles.ctl}
          onClick={() => { closePopovers(); setDraft(''); setCreating(true) }}
          title="New layout"
          aria-label="New layout"
        >
          <UIcon name="plus" size={13} gold={false} />
        </button>
      </div>

      {menu && (
        <div
          className={styles.menu}
          role="menu"
          aria-label={`${menu.entry.name} actions`}
          style={{ left: Math.max(6, menu.x - 20) }}
        >
          <div className={styles.menuHead}>{menu.entry.name}</div>
          <button
            type="button" role="menuitem" className={styles.menuItem}
            disabled={menuIndex <= 0}
            onClick={() => move(menu.entry, -1)}
          >← Move left</button>
          <button
            type="button" role="menuitem" className={styles.menuItem}
            disabled={menuIndex < 0 || menuIndex >= dock.pins.length - 1}
            onClick={() => move(menu.entry, 1)}
          >Move right →</button>
          <div className={styles.menuDiv} />
          {/* Only for the layout you are IN: saving the board into some OTHER
              layout would overwrite it with a board it never held. */}
          {menu.entry.id === activeId && writable(menu.entry) && (
            <button
              type="button" role="menuitem" className={styles.menuItem}
              onClick={() => { onSave?.(); setMenu(null) }}
            >Save layout</button>
          )}
          {writable(menu.entry) && (
            <button
              type="button" role="menuitem" className={styles.menuItem}
              onClick={() => { setRenameDraft(menu.entry.name); setRenaming(menu.entry.id); setMenu(null) }}
            >Rename layout</button>
          )}
          <button
            type="button" role="menuitem" className={styles.menuItem}
            onClick={() => { onDuplicate?.(menu.entry); setMenu(null) }}
          >Duplicate layout</button>
          <div className={styles.menuDiv} />
          <button
            type="button" role="menuitem" className={styles.menuItem}
            onClick={() => unpin(menu.entry)}
          >Remove from bar</button>
          {writable(menu.entry) && (<>
            {confirmDelete ? (
              <button
                type="button" role="menuitem" className={`${styles.menuItem} ${styles.menuDanger}`}
                onClick={() => { onDelete?.(menu.entry); closePopovers() }}
              >Click again to delete</button>
            ) : (
              <button
                type="button" role="menuitem" className={`${styles.menuItem} ${styles.menuDanger}`}
                onClick={() => setConfirmDelete(true)}
              >Delete layout</button>
            )}
          </>)}
        </div>
      )}

      {browseOpen && (
        <div className={styles.browse} role="menu">
          {overflow.length > 0 && (<>
            <div className={styles.browseSection}>Not on the bar</div>
            {overflow.map(e => (
              <button key={e.id} type="button" role="menuitem" className={styles.browseRow} onClick={() => open(e)}>{e.name}</button>
            ))}
          </>)}
          {unpinned.length > 0 && (<>
            <div className={styles.browseSection}>Unpinned</div>
            {unpinned.map(e => (
              <button key={e.id} type="button" role="menuitem" className={styles.browseRow} onClick={() => open(e)}>{e.name}</button>
            ))}
          </>)}
          {overflow.length === 0 && unpinned.length === 0 && (
            <div className={styles.browseEmpty}>Every layout is on the bar.</div>
          )}
        </div>
      )}
    </div>
  )
}
