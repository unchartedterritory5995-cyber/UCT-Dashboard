import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { createNoteViaApi } from '../../lib/noteCreation'
import { writePendingAskInsert } from '../../lib/askInsert'
import { NoteLinkList, makeNoteSearch } from './NoteLinkMenu'
import askStyles from './AskPanel.module.css'
import styles from './AskInsertPicker.module.css'

/**
 * G-064 — choose where an Ask answer goes when no note is open (spec §3.3).
 *
 * Renders INSIDE the Ask panel (already a Sheet on touch), never as a second
 * modal. Picking a note hands the answer over (lib/askInsert.js) and opens the
 * note through the HOST's own `onOpenNote`; the note's editor appends it on
 * arrival (spec §5.2). "Create a new note" writes the answer as the new note's
 * body in one request.
 */
export default function AskInsertPicker({
  node, defaultTitle = '', onOpenNote, onCancel, search, createNote = createNoteViaApi,
}) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef(null)
  const searchRef = useRef(null)
  if (!searchRef.current) searchRef.current = search || makeNoteSearch()

  useEffect(() => {
    const query = q.trim()
    if (!query) { setItems([]); setLoading(false); return undefined }
    let live = true
    setLoading(true)
    Promise.resolve(searchRef.current(query))
      .then((notes) => { if (live) { setItems(notes || []); setLoading(false) } })
      .catch(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [q])

  const choose = (note) => {
    if (!note?.id || busy) return
    writePendingAskInsert(note.id, node)
    onOpenNote?.(note)
  }

  const createNew = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const title = (q.trim() || defaultTitle || 'Ask Notebook answer').slice(0, 80)
      const created = await createNote({ title, bodyJson: { type: 'doc', content: [node] } })
      onOpenNote?.(created)
    } catch (e) {
      console.error('[AskInsertPicker] create failed', e)
      setError("Couldn't create the note. Your answer is still here.")
      setBusy(false)
    }
  }

  const typed = q.trim()
  return (
    <div className={styles.picker} data-testid="ask-insert-picker">
      <label className={askStyles.srOnly} htmlFor="ask-insert-search">Find a note to insert into</label>
      <input
        id="ask-insert-search"
        className={styles.search}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { onCancel?.(); return }
          if (listRef.current?.onKeyDown({ event: e })) e.preventDefault()
        }}
        placeholder="Search your notes…"
        autoComplete="off"
      />
      <button type="button" className={styles.row} onClick={createNew} disabled={busy}>
        <UIcon name="plus" size={12} gold={false} style={{ verticalAlign: '-2px', marginRight: 5 }} />
        {typed ? `Create a new note titled "${typed}"` : 'Create a new note'}
      </button>
      {typed && (
        <NoteLinkList
          ref={listRef}
          items={items}
          loading={loading}
          command={choose}
          menuId="ask-insert-picker-list"
          ariaLabel="Insert into a note"
        />
      )}
      {error && <div className={styles.error} role="alert">{error}</div>}
      <button type="button" className={styles.row} onClick={onCancel}>Cancel</button>
    </div>
  )
}
