/**
 * Volume Surge — custom scan lists.
 *
 * Lets a user scan their OWN set of tickers instead of the top-1,000 liquid universe.
 *  • ScopeControl — the toolbar pill + a slick dropdown to create / pick / rename / delete
 *    lists (the whole "make your own list" surface).
 *  • AddTickerBar — a predictive add-ticker bar shown at the bottom of the widget when a
 *    custom list is active.
 * Lists live in the widget opts (persisted with the workspace layout). Styling rides the
 * same --nh-* / --menu-* tokens + UIcon glyphs as the rest of the widget (no emoji).
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../../components/ui/UIcon'
import styles from './VolumeScanWidget.module.css'

const MENU_W = 216

// Anchor the dropdown under the pill in VIEWPORT coords (it's portaled to <body>, so it
// escapes the widget's overflow:hidden and overlays the chart). Clamps to the viewport
// and flips above when there isn't room below.
function placeMenu(btn) {
  if (!btn) return null
  const doc = btn.ownerDocument || document
  const win = doc.defaultView || window
  const r = btn.getBoundingClientRect()
  const vw = win.innerWidth, vh = win.innerHeight
  const left = Math.max(8, Math.min(r.left, vw - MENU_W - 8))
  const below = vh - r.bottom - 12
  const above = r.top - 12
  const openUp = below < 200 && above > below
  const maxH = Math.min(340, Math.max(140, openUp ? above : below))
  return openUp
    ? { left, bottom: vh - r.top + 4, maxHeight: maxH }
    : { left, top: r.bottom + 4, maxHeight: maxH }
}

let _idc = 0
const newId = () => `vl_${Date.now().toString(36)}_${(_idc++).toString(36)}`

// Build the list mutators once; each returns the next (lists, activeId) via `commit`.
export function makeListHelpers(lists, activeId, commit) {
  return {
    create(name) {
      const id = newId()
      const nm = (name || '').trim() || `List ${lists.length + 1}`
      commit([...lists, { id, name: nm, syms: [] }], id)
      return id
    },
    rename: (id, name) => commit(lists.map(l => (l.id === id ? { ...l, name: name.trim() || l.name } : l)), activeId),
    remove: (id) => commit(lists.filter(l => l.id !== id), activeId === id ? null : activeId),
    setActive: (id) => commit(lists, id),
    addSym(id, sym) {
      const s = String(sym || '').trim().toUpperCase()
      if (!s) return
      commit(lists.map(l => (l.id === id && !l.syms.includes(s) ? { ...l, syms: [...l.syms, s] } : l)), activeId)
    },
    removeSym: (id, sym) =>
      commit(lists.map(l => (l.id === id ? { ...l, syms: l.syms.filter(x => x !== sym) } : l)), activeId),
  }
}

// ── Scope pill + dropdown ──────────────────────────────────────────────────────
export function ScopeControl({ lists, activeId, helpers, themeVars }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const rootRef = useRef(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)
  const active = lists.find(l => l.id === activeId) || null
  const label = active ? active.name : 'Top 1,000'

  const openMenu = () => { setPos(placeMenu(btnRef.current)); setOpen(true) }

  useEffect(() => {
    if (!open) return
    // Clicks inside the pill OR the (portaled) menu must NOT close it — otherwise this
    // capture-phase close fires before an item's own handler.
    const onDown = (e) => {
      if (rootRef.current && rootRef.current.contains(e.target)) return
      if (menuRef.current && menuRef.current.contains(e.target)) return
      close()
    }
    const reflow = () => setPos(placeMenu(btnRef.current))
    const win = (btnRef.current?.ownerDocument || document).defaultView || window
    document.addEventListener('mousedown', onDown, true)
    win.addEventListener('scroll', reflow, true)
    win.addEventListener('resize', reflow)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      win.removeEventListener('scroll', reflow, true)
      win.removeEventListener('resize', reflow)
    }
  }, [open])

  const close = () => { setOpen(false); setEditingId(null); setCreating(false); setDraft('') }
  const commitCreate = () => {
    const n = draft.trim()
    if (n) helpers.create(n)
    setCreating(false); setDraft('')
    if (n) setOpen(false)
  }
  const commitRename = (id) => { if (draft.trim()) helpers.rename(id, draft); setEditingId(null); setDraft('') }

  const menu = open && (
    <div
      ref={menuRef}
      className={styles.scopeMenu}
      style={{ position: 'fixed', ...(pos || {}), ...(themeVars || {}) }}
      role="menu"
    >
          <button
            type="button"
            className={`${styles.scopeItem} ${!activeId ? styles.scopeItemActive : ''}`}
            onClick={() => { helpers.setActive(null); close() }}
          >
            <UIcon name="rows" size={12} gold={false} />
            <span className={styles.scopeItemName}>Top 1,000 <span className={styles.scopeItemHint}>· by $ volume</span></span>
            {!activeId && <UIcon name="check" size={12} gold={false} />}
          </button>

          {lists.length > 0 && <div className={styles.scopeDivider}>YOUR LISTS</div>}
          {lists.map(l => (
            <div key={l.id} className={`${styles.scopeItem} ${l.id === activeId ? styles.scopeItemActive : ''}`}>
              {editingId === l.id ? (
                <input
                  className={styles.scopeEdit}
                  autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(l.id); if (e.key === 'Escape') { setEditingId(null); setDraft('') } }}
                  onBlur={() => commitRename(l.id)}
                />
              ) : (
                <button type="button" className={styles.scopeItemMain} onClick={() => { helpers.setActive(l.id); close() }}>
                  <UIcon name="star" size={12} gold={false} />
                  <span className={styles.scopeItemName}>{l.name}</span>
                  <span className={styles.scopeItemHint}>{l.syms.length}</span>
                </button>
              )}
              <span className={styles.scopeItemBtns}>
                <button type="button" className={styles.scopeIconBtn} title="Rename"
                  onClick={() => { setEditingId(l.id); setDraft(l.name) }}><UIcon name="edit" size={11} gold={false} /></button>
                <button type="button" className={`${styles.scopeIconBtn} ${styles.scopeIconDanger}`} title="Delete list"
                  onClick={() => helpers.remove(l.id)}><UIcon name="trash" size={11} gold={false} /></button>
              </span>
            </div>
          ))}

          <div className={styles.scopeDivider} />
          {creating ? (
            <div className={styles.scopeItem}>
              <input
                className={styles.scopeEdit}
                autoFocus
                placeholder="List name…"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitCreate(); if (e.key === 'Escape') { setCreating(false); setDraft('') } }}
                onBlur={commitCreate}
              />
            </div>
          ) : (
            <button type="button" className={styles.scopeCreate} onClick={() => { setCreating(true); setDraft('') }}>
              <UIcon name="plus" size={12} gold={false} /><span>New list</span>
            </button>
          )}
        </div>
      )

  return (
    <div className={styles.scopeWrap} ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.scopeBtn} ${styles.scopeBtnCustom}`}
        onClick={() => (open ? close() : openMenu())}
        title="Choose what the scanner watches"
      >
        <UIcon name={active ? 'star' : 'rows'} size={11} gold={false} />
        <span className={styles.scopeLabel}>{label}</span>
        <UIcon name="more" size={11} gold={false} />
      </button>
      {menu && createPortal(menu, (btnRef.current?.ownerDocument || document).body)}
    </div>
  )
}

// ── Add-ticker bar (bottom) ────────────────────────────────────────────────────
// NO predictive dropdown by design: a suggestion menu that lags behind fast typing
// used to submit the wrong ticker on Enter (type "IWM" quickly → "IAC" went in). This
// takes EXACTLY what you typed and adds it verbatim on Enter — type as fast as you like.
export function AddTickerBar({ list, helpers }) {
  const [q, setQ] = useState('')

  const add = () => {
    const s = q.trim().toUpperCase()
    if (!s) return
    helpers.addSym(list.id, s)
    setQ('')
  }
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); add() }
    else if (e.key === 'Escape') { setQ('') }
  }

  return (
    <div className={styles.addBar}>
      <UIcon name="plus" size={12} gold={false} />
      <input
        className={styles.addInput}
        value={q}
        placeholder={`Add ticker to ${list.name}…`}
        onChange={e => setQ(e.target.value)}
        onKeyDown={onKey}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-label="Add a ticker to this list"
      />
      <span className={styles.addCount}>{list.syms.length} name{list.syms.length === 1 ? '' : 's'}</span>
    </div>
  )
}
