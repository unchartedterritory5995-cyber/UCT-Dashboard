import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../../components/ui/UIcon'
import { useFlagged } from '../../../hooks/useFlagged'
import {
  LIBRARY_TABS, countOf, useWatchlistLibrary,
  prebuiltPick, communityPick, minePick, flaggedPick,
  createWatchlist, renameWatchlist, setWatchlistPublic, deleteWatchlist, ownListSymbols,
  duplicateWatchlist, refreshWatchlists,
} from './watchlistLibrary'
import styles from './LibraryRail.module.css'

// Watchlist widget, open list (owner 11-13: "library rail"): the whole library beside the
// list — Prebuilt · Community · My Lists as underline tabs, a search, then every list with
// its count (Prebuilt grouped by category, exactly as the picker groups it). One click opens
// a list through the widget's own `onPick` — the same selection the picker makes.
// My Lists (round 4): a new list is created right here (name → Enter → it opens), and each of
// the member's own lists has a ⋯ menu — Rename (in place), Duplicate, Copy tickers, Share with
// community / Make private, Delete (asks once more). Same server calls as the Watchlists page.
export default function LibraryRail({ currentKey, initialTab = 'prebuilt', tab: tabProp = null, onTab = null, onPick, overlay = false, closing = false,
  // My Lists' last row (owner 11-15): the widget's "track or freeze a saved screen" offer, when list subscriptions are on
  mineFooter = null }) {
  // The widget owns which tab shows (it remembers it per widget); uncontrolled when not given.
  const [tabState, setTabState] = useState(initialTab || 'prebuilt')
  const tab = tabProp || tabState
  const setTab = (t) => { setTabState(t); onTab?.(t) }
  const [q, setQ] = useState('')
  const lib = useWatchlistLibrary(q)
  const { isShared, toggleShare, renameFlagged } = useFlagged()

  // ── create ──
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)       // one short status line (errors, "Copied …")
  useEffect(() => {
    if (!note) return undefined
    const t = setTimeout(() => setNote(null), 2600)
    return () => clearTimeout(t)
  }, [note])
  const submitCreate = async (e) => {
    e?.preventDefault?.()
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const wl = await createWatchlist(name)
      await refreshWatchlists()
      setCreating(false); setNewName('')
      onPick?.(minePick(wl))
    } catch {
      setNote('Could not create that list.')
    } finally { setBusy(false) }
  }

  // ── per-list menu + rename ──
  const [menu, setMenu] = useState(null)        // { key, id, name, isPublic, flagged, x, y }
  const [renaming, setRenaming] = useState(null) // { key, id, flagged, value }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const run = async (fn, okNote) => {
    setMenu(null); setConfirmDelete(false)
    try { await fn(); if (okNote) setNote(okNote) } catch { setNote('That did not work. Try again.') }
  }
  const symbolsOf = async (m) => (m.flagged ? [...(lib.flagged || [])] : ownListSymbols(m.id))
  const commitRename = async () => {
    const r = renaming
    setRenaming(null)
    const name = String(r?.value || '').trim()
    if (!r || !name || name === r.original) return
    try {
      if (r.flagged) renameFlagged(name)
      else { await renameWatchlist(r.id, name); await refreshWatchlists() }
      if (r.key === currentKey) onPick?.({ key: r.key, name, tab: 'mine' })
    } catch { setNote('Could not rename that list.') }
  }

  const item = (sel, count, hint, own = null) => {
    if (renaming && renaming.key === sel.key) {
      return (
        <form key={sel.key} className={styles.editRow} onSubmit={(e) => { e.preventDefault(); commitRename() }}>
          <input
            id={`rail-rename-${sel.key}`}
            autoFocus
            aria-label={`Rename ${sel.name}`}
            value={renaming.value}
            maxLength={60}
            onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null) }}
            onBlur={commitRename}
          />
        </form>
      )
    }
    return (
      <div key={sel.key} className={`${styles.row}${own ? ' ' + styles.rowOwn : ''}`}>
        <button
          type="button"
          className={`${styles.item}${sel.key === currentKey ? ' ' + styles.itemOn : ''}`}
          aria-current={sel.key === currentKey ? 'true' : undefined}
          title={hint || sel.name}
          onClick={() => { if (sel.key !== currentKey) onPick?.(sel) }}
        >
          <span className={styles.itemName}>{sel.name}</span>
          {count != null && <span className={styles.itemCount}>{count}</span>}
        </button>
        {own && (
          <button
            type="button"
            className={`${styles.rowMenuBtn}${menu?.key === sel.key ? ' ' + styles.rowMenuBtnOn : ''}`}
            aria-label={`Options for ${sel.name}`}
            aria-haspopup="menu"
            aria-expanded={menu?.key === sel.key}
            title="List options"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setConfirmDelete(false)
              setMenu(menu?.key === sel.key ? null : { ...own, key: sel.key, name: sel.name, x: r.right, y: r.bottom + 4 })
            }}
          ><UIcon name="more" size={14} gold={false} /></button>
        )}
      </div>
    )
  }

  let body
  if (tab === 'prebuilt') {
    body = lib.prebuiltGroups.length
      ? lib.prebuiltGroups.map((g) => (
        <div key={g.category} className={styles.group}>
          <div className={styles.groupHead}><span>{g.category}</span><span className={styles.groupCount}>{g.count}</span></div>
          {g.lists.map((wl) => item(prebuiltPick(wl), countOf(wl), wl.hint))}
        </div>
      ))
      : <div className={styles.empty}>{q ? 'No matches.' : 'No prebuilt lists yet.'}</div>
  } else if (tab === 'community') {
    body = lib.community.length
      ? <div className={styles.group}><div className={styles.groupHead}><span>Shared by members</span><span className={styles.groupCount}>{lib.community.length}</span></div>{lib.community.map((wl) => item(communityPick(wl), countOf(wl), wl.owner_name ? `${wl.name} · ${wl.owner_name}` : null))}</div>
      : <div className={styles.empty}>{q ? 'No matches.' : 'No shared lists yet.'}</div>
  } else {
    const flaggedCount = lib.flagged?.length ?? lib.flagged?.size ?? null
    body = (
      <div className={styles.group}>
        <div className={styles.groupHead}><span>Your lists</span><span className={styles.groupCount}>{lib.mine.length + (lib.showFlagged ? 1 : 0)}</span></div>
        {lib.showFlagged && item(flaggedPick(lib.flaggedLabel), flaggedCount, null, { flagged: true, isPublic: isShared })}
        {lib.mine.map((wl) => item(minePick(wl), countOf(wl), null, { id: wl.id, isPublic: !!wl.is_public }))}
        {!lib.mine.length && !lib.showFlagged && <div className={styles.empty}>{q ? 'No matches.' : 'No lists of your own yet.'}</div>}
        {creating ? (
          <form className={styles.createCard} onSubmit={submitCreate}>
            <label className={styles.createLabel} htmlFor="rail-new-list">New list</label>
            <input
              id="rail-new-list"
              autoFocus
              placeholder="e.g. Swing ideas"
              value={newName}
              maxLength={60}
              disabled={busy}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setCreating(false); setNewName('') } }}
            />
            <div className={styles.createActions}>
              <button type="button" className={styles.createCancel} onClick={() => { setCreating(false); setNewName('') }}>Cancel</button>
              <button type="submit" className={styles.createGo} disabled={!newName.trim() || busy}>{busy ? 'Creating…' : 'Create'}</button>
            </div>
          </form>
        ) : (
          <button type="button" className={styles.newList} data-guide="watchlist.railNewList" onClick={() => { setTab('mine'); setCreating(true) }}>
            <UIcon name="plus" size={13} gold={false} /> New list
          </button>
        )}
        {mineFooter}
      </div>
    )
  }

  return (
    <nav className={`${styles.rail}${overlay ? ' ' + styles.overlay : ''}${closing ? ' ' + styles.overlayOut : ''}`} aria-label="Watchlist library" data-guide="watchlist.library">
      <div className={styles.seg} role="tablist" aria-label="Library">
        {LIBRARY_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={`${styles.segBtn}${tab === t.key ? ' ' + styles.segOn : ''}`}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <label className={styles.find}>
        <UIcon name="search" size={12} gold={false} />
        <input id="watchlist-library-find" placeholder="Find a list…" aria-label="Find a list" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className={styles.scroll}>{body}</div>
      {note && <div className={styles.note} role="status">{note}</div>}
      {menu && (
        <RailMenu menu={menu} onClose={() => { setMenu(null); setConfirmDelete(false) }}>
          <button type="button" role="menuitem" className={styles.menuItem}
            onClick={() => { setRenaming({ key: menu.key, id: menu.id, flagged: menu.flagged, value: menu.name, original: menu.name }); setMenu(null) }}>
            <UIcon name="edit" size={14} gold={false} /> Rename
          </button>
          <button type="button" role="menuitem" className={styles.menuItem}
            onClick={() => run(async () => {
              const syms = await symbolsOf(menu)
              const copy = await duplicateWatchlist(`${menu.name} copy`, syms)
              await refreshWatchlists()
              onPick?.(minePick(copy))
            }, 'Duplicated.')}>
            <UIcon name="copy" size={14} gold={false} /> Duplicate
          </button>
          <button type="button" role="menuitem" className={styles.menuItem}
            onClick={() => run(async () => {
              const syms = await symbolsOf(menu)
              await navigator.clipboard.writeText(syms.join(', '))
              setNote(`Copied ${syms.length} ${syms.length === 1 ? 'ticker' : 'tickers'}`)
            })}>
            <UIcon name="document" size={14} gold={false} /> Copy tickers
          </button>
          <button type="button" role="menuitem" className={styles.menuItem}
            onClick={() => run(async () => {
              if (menu.flagged) toggleShare()
              else { await setWatchlistPublic(menu.id, !menu.isPublic); await refreshWatchlists() }
            }, menu.isPublic ? 'Now private.' : 'Shared with the community.')}>
            <UIcon name="community" size={14} gold={false} /> {menu.isPublic ? 'Make private' : 'Share with community'}
          </button>
          {!menu.flagged && (
            <button type="button" role="menuitem" className={`${styles.menuItem} ${styles.menuDanger}`}
              onClick={() => {
                if (!confirmDelete) { setConfirmDelete(true); return }
                run(async () => {
                  await deleteWatchlist(menu.id)
                  await refreshWatchlists()
                  if (menu.key === currentKey) onPick?.(flaggedPick(lib.flaggedLabel))
                }, 'List deleted.')
              }}>
              <UIcon name="trash" size={14} gold={false} /> {confirmDelete ? 'Click again to delete' : 'Delete'}
            </button>
          )}
        </RailMenu>
      )}
    </nav>
  )
}

// The ⋯ menu: portaled to the button's own document and placed `fixed` (the rail scrolls and
// the widget clips), right-aligned under the button; closes on an outside press or Escape.
function RailMenu({ menu, onClose, children }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const win = el.ownerDocument.defaultView || window
    const w = el.offsetWidth, h = el.offsetHeight
    const left = Math.max(8, Math.min(menu.x - w, win.innerWidth - w - 8))
    const top = menu.y + h > win.innerHeight - 8 ? Math.max(8, menu.y - h - 32) : menu.y
    setPos({ left, top })
  }, [menu])
  useEffect(() => {
    const doc = ref.current?.ownerDocument || document
    const onDown = (e) => { if (!ref.current?.contains(e.target) && !e.target.closest?.('[aria-haspopup="menu"]')) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    doc.addEventListener('mousedown', onDown, true)
    doc.addEventListener('keydown', onKey)
    return () => { doc.removeEventListener('mousedown', onDown, true); doc.removeEventListener('keydown', onKey) }
  }, [onClose])
  return createPortal(
    <div ref={ref} role="menu" aria-label={`${menu.name} options`} className={styles.menu}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      {children}
    </div>,
    document.body,
  )
}
