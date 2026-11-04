/**
 * UCT News -- the member's collections and notes, shared by the feed's ⋯ menu and the
 * Saved Headlines view (TradeExchangeNewsSaved.jsx). Every write goes through the page's
 * one library store (lib/tradeExchangeNewsLibrary.js), so all News widgets agree at once.
 *
 * ⛔ The archive is never changed from here: a collection, a membership or a note is the
 * member's own row (api/services/trade_exchange_news/library.py), never a headline.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import UIcon from '../../../components/ui/UIcon'
import Input from '../../../components/ui/Input'
import * as library from '../../../lib/tradeExchangeNewsLibrary'
import news from './TradeExchangeNewsWidget.module.css'
import styles from './TradeExchangeNewsSaved.module.css'

/** Which of the member's collections hold this headline (ticks), and a new one. Ticking one
 *  for a headline that is not saved yet saves it (a collection only holds saved headlines). */
export function CollectionPicker({ item }) {
  const lib = useSyncExternalStore(library.subscribe, library.getSnapshot)
  const saved = lib.ids.has(item.id)
  const [inSet, setInSet] = useState(() => new Set(item.bookmark?.collection_ids || []))
  const [known, setKnown] = useState(!!item.bookmark || !saved)
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // A feed row does not carry its memberships: read them once (only for a saved headline).
  useEffect(() => {
    if (item.bookmark || !saved) return undefined
    let live = true
    library.fetchBookmark(item.id).then((r) => {
      if (!live) return
      if (r.ok) setInSet(new Set(r.bookmark?.collection_ids || []))
      else setError(r.error)
      setKnown(true)
    })
    return () => { live = false }
  }, [item.id, item.bookmark, saved])
  const apply = (r) => {
    if (!r.ok) { setError(r.error); return false }
    setError(null)
    if (r.body?.bookmark) setInSet(new Set(r.body.bookmark.collection_ids || []))
    return true
  }
  const toggle = async (c) => {
    setBusy(true)
    apply(await library.setMembershipSaving(c.id, item.id, !inSet.has(c.id)))
    setBusy(false)
  }
  const create = async (e) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    const r = await library.createCollection(name)
    if (r.ok) {
      setName('')
      apply(await library.setMembershipSaving(r.body.id, item.id, true))
    } else setError(r.error)
    setBusy(false)
  }
  return (
    <div className={styles.picker}>
      {!saved && <div className={news.menuNote}>Choosing a collection also saves this headline.</div>}
      {!known && <div className={news.menuNote}>Loading…</div>}
      {known && !lib.collections.length && <div className={news.menuNote}>No collections yet — name one below.</div>}
      {known && lib.collections.map((c) => (
        <label key={c.id} className={styles.colCheck}>
          <input type="checkbox" checked={inSet.has(c.id)} disabled={busy} onChange={() => toggle(c)} />
          <span>{c.name}</span>
        </label>
      ))}
      <form className={styles.colNew} onSubmit={create}>
        <Input className={styles.colInput} value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
          placeholder="New collection" aria-label="New collection name" />
        <button type="submit" className={styles.primaryBtn} disabled={busy || !name.trim()}>Add</button>
      </form>
      {error && <div className={`${news.menuNote} ${styles.err}`} role="alert">{error}</div>}
    </div>
  )
}

/** Create, rename and delete the member's collections (delete keeps its headlines saved). */
export function ManageCollections({ onClose, themeVars, anchorRef }) {
  const lib = useSyncExternalStore(library.subscribe, library.getSnapshot)
  const [editing, setEditing] = useState(null)        // { id, name }
  const [confirm, setConfirm] = useState(null)        // id awaiting a second click
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const boxRef = useRef(null)
  useEffect(() => {
    const onDown = (e) => { if (!boxRef.current?.contains(e.target) && !anchorRef?.current?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [onClose, anchorRef])
  const run = async (p) => {
    const r = await p
    setError(r.ok ? null : r.error)
    return r.ok
  }
  return (
    <div ref={boxRef} className={`${news.menuPop} ${styles.manage}`} style={themeVars} role="dialog" aria-label="Manage collections"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); anchorRef?.current?.focus?.() } }}>
      <div className={news.menuHead}>Your collections</div>
      {!lib.collections.length && <div className={news.menuNote}>Group saved headlines, e.g. “Earnings”, “Macro” or “Trade Ideas”.</div>}
      {lib.collections.map((c) => (
        <div key={c.id} className={styles.manageRow}>
          {editing?.id === c.id ? (
            <form className={styles.colNew} onSubmit={async (e) => { e.preventDefault(); if (await run(library.renameCollection(c.id, editing.name))) setEditing(null) }}>
              <Input className={styles.colInput} value={editing.name} maxLength={60} autoFocus aria-label={`Rename ${c.name}`}
                onChange={(e) => setEditing({ id: c.id, name: e.target.value })} />
              <button type="submit" className={styles.primaryBtn}>Save</button>
              <button type="button" className={styles.linkBtn} onClick={() => setEditing(null)}>Cancel</button>
            </form>
          ) : (
            <>
              <span className={styles.manageName}>{c.name}</span>
              <span className={styles.manageCount}>{c.count}</span>
              <button type="button" className={`${news.rowBtn} ${styles.menuIcon}`} style={{ opacity: 1 }} onClick={() => { setConfirm(null); setEditing({ id: c.id, name: c.name }) }}
                aria-label={`Rename ${c.name}`} title="Rename"><UIcon name="edit" size={11} gold={false} /></button>
              <button type="button" className={`${news.rowBtn} ${styles.menuIcon}${confirm === c.id ? ' ' + styles.danger : ''}`} style={{ opacity: 1 }}
                onClick={async () => { if (confirm !== c.id) { setConfirm(c.id); return } await run(library.deleteCollection(c.id)); setConfirm(null) }}
                aria-label={confirm === c.id ? `Confirm: delete ${c.name}` : `Delete ${c.name}`}
                title={confirm === c.id ? 'Click again to delete. Its headlines stay saved.' : 'Delete collection'}>
                {confirm === c.id ? 'Delete?' : <UIcon name="trash" size={11} gold={false} />}
              </button>
            </>
          )}
        </div>
      ))}
      <form className={styles.colNew} onSubmit={async (e) => { e.preventDefault(); if (name.trim() && await run(library.createCollection(name))) setName('') }}>
        <Input className={styles.colInput} value={name} maxLength={60} onChange={(e) => setName(e.target.value)}
          placeholder="New collection" aria-label="New collection name" />
        <button type="submit" className={styles.primaryBtn} disabled={!name.trim()}>Create</button>
      </form>
      {error && <div className={`${news.menuNote} ${styles.err}`} role="alert">{error}</div>}
      <div className={news.menuNote}>Deleting a collection keeps its headlines saved. Headlines are never deleted from UCT News.</div>
    </div>
  )
}

/** A short personal note on a saved headline. Esc or Cancel with changes asks once before
 *  dropping them; a failed save keeps the text in the box. */
export function NoteEditor({ item, onDone }) {
  const initial = item.bookmark?.note || ''
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmDrop, setConfirmDrop] = useState(false)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  const limit = library.getSnapshot().limits?.note || 4000
  const dirty = text.trim() !== initial.trim()
  const cancel = () => {
    if (dirty && !confirmDrop) { setConfirmDrop(true); return }
    onDone(false)
  }
  const saveNote = async (value) => {
    setBusy(true)
    const r = await library.setNote(item.id, value)
    setBusy(false)
    if (r.ok) onDone(true)
    else setError(r.error)
  }
  return (
    <div className={styles.noteEdit} onKeyDown={(e) => {
      if (e.key === 'Escape') { e.stopPropagation(); cancel() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveNote(text) }
    }}>
      <textarea ref={ref} className={styles.noteInput} value={text} maxLength={limit} rows={3}
        onChange={(e) => { setText(e.target.value); setConfirmDrop(false) }} aria-label="Your note on this headline"
        placeholder="A short note… (Ctrl+Enter saves)" />
      <div className={styles.noteBar}>
        {error && <span className={styles.err} role="alert">{error}</span>}
        {confirmDrop && !error && <span className={styles.err} role="status">Unsaved changes — Cancel again to discard</span>}
        <span className={styles.noteCount}>{text.length.toLocaleString()} / {limit.toLocaleString()}</span>
        {initial && (
          <button type="button" className={styles.linkBtn} disabled={busy} onClick={() => saveNote('')}>Delete note</button>
        )}
        <button type="button" className={styles.linkBtn} disabled={busy} onClick={cancel}>Cancel</button>
        <button type="button" className={styles.primaryBtn} disabled={busy || !dirty} onClick={() => saveNote(text)}>Save note</button>
      </div>
    </div>
  )
}
