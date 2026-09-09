// app/src/pages/charts/LayoutDock.jsx
//
// The Layout Dock — the workspace's FAST PATH between saved layouts. A 28px
// strip welded to the bottom of the .workspace frame: pinned layouts as bare
// text, the open one lit gold with a 2px cap seated on the dock's top edge so
// the board reads as hanging from its own name.
//
// It is a fast path, NOT a second management surface. Layouts ▾ keeps New /
// Open / Save / Save as / Multi Chart / Pop Out; the dock only switches, creates
// and (via ⋯) reaches whatever didn't fit. Anyone who ignores it loses nothing.
//
// ⭐ Why this sits AFTER </main> inside .workspace rather than in Layout.jsx:
// `computeRowHeight()` divides whatever the ResizeObserver measures on
// .workspaceBody into FIXED_ROWS, so a flex sibling below <main> shrinks the
// board and re-tiles the grid with zero changes to the layout math. It also
// makes the dock start after the 60px nav rail, bracketing the workspace with
// the same frame the header opens.
//
// Phase 1: render / switch / create / overflow. The unsaved-changes dot + the
// dirty-switch confirm (Phase 2), the right-click menu, ⋯ search and drag
// reorder (Phase 3), and Ctrl+1…9 (Phase 4) are deliberately not here yet —
// the pin model below is what they all build on.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import usePreferences from '../../hooks/usePreferences'
import UIcon from '../../components/ui/UIcon'
import { DOCK_PREF, UCT_DEFAULT_ID, readDockPref, reconcilePins, sameDock } from './layoutDockPins'
import styles from './LayoutDock.module.css'

export default function LayoutDock({
  entries, activeId, loading = false, merged = false,
  dirty = false, canSave = true, onOpen, onCreate, onSave,
}) {
  const { prefs, setPref, loading: prefsLoading } = usePreferences()
  const stored = useMemo(() => readDockPref(prefs?.[DOCK_PREF]), [prefs])

  const byId = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries])
  const dock = useMemo(() => reconcilePins(stored, entries), [stored, entries])

  // Persist only a CHANGED reconciliation, and never before both sides have
  // settled — seeding against a half-loaded list would write a pin order that
  // is missing everything still in flight.
  useEffect(() => {
    if (prefsLoading || loading) return
    if (sameDock(stored, dock)) return
    setPref(DOCK_PREF, JSON.stringify(dock))
  }, [prefsLoading, loading, stored, dock, setPref])

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

  const activeName = useMemo(
    () => entries.find(e => e.id === activeId)?.name || null,
    [entries, activeId],
  )

  const shownIds = useMemo(() => new Set(shown.map(e => e.id)), [shown])
  const overflow = useMemo(() => pinned.filter(e => !shownIds.has(e.id)), [pinned, shownIds])
  const unpinned = useMemo(() => entries.filter(e => !dock.pins.includes(e.id)), [entries, dock.pins])

  // ── ⋯ browser ───────────────────────────────────────────────────────────
  const [browseOpen, setBrowseOpen] = useState(false)
  const dockRef = useRef(null)
  useEffect(() => {
    if (!browseOpen) return
    const onDown = (e) => { if (!dockRef.current?.contains(e.target)) setBrowseOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setBrowseOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [browseOpen])

  // ── ＋ new layout ────────────────────────────────────────────────────────
  // Naming happens INLINE, in the slot the layout will occupy, so the thing you
  // just made is already where your hand will look for it.
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { if (creating) inputRef.current?.focus() }, [creating])

  const commitCreate = useCallback(() => {
    const name = draft.trim()
    setCreating(false)
    setDraft('')
    if (name) onCreate?.(name)
  }, [draft, onCreate])

  // ── the dirty-switch confirm ────────────────────────────────────────────
  // The ONE place friction is correct. applyTemplate() overwrites the working
  // board with no comparison, so before the dock existed three clicks of menu
  // hid this; at one click it would cost someone a morning's board. Fires only
  // when the open layout actually differs from what is stored for it.
  const [pending, setPending] = useState(null)

  const open = useCallback((entry) => {
    setBrowseOpen(false)
    // Re-opening the layout you are already in would reload the board and throw
    // away whatever you have changed since. Never do it.
    if (entry.id === activeId) return
    if (dirty) { setPending(entry); return }
    onOpen?.(entry)
  }, [activeId, dirty, onOpen])

  const saveAndSwitch = useCallback(() => {
    const entry = pending
    setPending(null)
    if (!entry) return
    onSave?.()
    onOpen?.(entry)
  }, [pending, onSave, onOpen])

  const discardAndSwitch = useCallback(() => {
    const entry = pending
    setPending(null)
    if (entry) onOpen?.(entry)
  }, [pending, onOpen])

  useEffect(() => {
    if (!pending) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setPending(null) }
      else if (e.key === 'Enter') { e.preventDefault(); if (canSave) saveAndSwitch(); else discardAndSwitch() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pending, canSave, saveAndSwitch, discardAndSwitch])

  if (dock.hidden) return null

  const renderItem = (entry) => {
    const active = entry.id === activeId
    return (
      <button
        key={entry.id}
        type="button"
        className={`${styles.item} ${active ? styles.itemActive : ''}`}
        onClick={() => open(entry)}
        title={entry.name}
        aria-current={active ? 'true' : undefined}
      >
        <span className={styles.label}>{entry.name}</span>
        {/* Only ever on the ACTIVE item — that single rule is what keeps the bar
            quiet as it fills up, and it puts "save this" where you are looking. */}
        {active && dirty && (
          <span
            className={styles.unsaved}
            role="button"
            tabIndex={0}
            aria-label={`Save changes to ${entry.name}`}
            title="Unsaved changes — click to save"
            onClick={(e) => { e.stopPropagation(); onSave?.() }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSave?.() } }}
          />
        )}
      </button>
    )
  }

  return (
    <div
      className={`${styles.dock} ${merged ? styles.dockMerged : ''}`}
      ref={dockRef}
      role="toolbar"
      aria-label="Saved layouts"
    >
      <div className={styles.strip} ref={stripRef}>
        {shown.map(renderItem)}
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
          onClick={() => setBrowseOpen(o => !o)}
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
          onClick={() => { setBrowseOpen(false); setDraft(''); setCreating(true) }}
          title="New layout"
          aria-label="New layout"
        >
          <UIcon name="plus" size={13} gold={false} />
        </button>
      </div>

      {pending && (
        <div className={styles.confirm} role="alertdialog" aria-label="Unsaved changes">
          <span className={styles.confirmMsg}>
            <b>{activeName || 'This layout'}</b> has unsaved changes
          </span>
          {canSave
            ? <button type="button" className={styles.confirmPrimary} onClick={saveAndSwitch}>Save &amp; switch</button>
            : <span className={styles.confirmNote}>Prebuilt layouts can&rsquo;t be overwritten</span>}
          <button type="button" className={styles.confirmBtn} onClick={discardAndSwitch}>Discard</button>
          <button type="button" className={styles.confirmBtn} onClick={() => setPending(null)}>Cancel</button>
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
