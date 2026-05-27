import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useJ2Notes from '../hooks/useJ2Notes'
import NoteCard from '../components/notebook/NoteCard'
import FolderSidebar from '../components/notebook/FolderSidebar'
import NoteEditorPage from '../components/notebook/NoteEditorPage'
import styles from './NotebookTab.module.css'

export default function NotebookTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const noteId = searchParams.get('note')

  const [folderId, setFolderId] = useState(null)
  const [tag, setTag] = useState(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('updated')
  const [creating, setCreating] = useState(false)

  const { notes, isLoading, error, refresh } = useJ2Notes({
    folderId, tag, q: q || undefined, sort,
  })

  const openNote = (note) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('note', note.id)
      return next
    }, { replace: false })
  }
  const closeNote = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('note')
      return next
    }, { replace: false })
    refresh()
  }

  const createNote = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/j2/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '',
          ...(folderId && folderId !== '__unfiled__' ? { folderId } : {}),
        }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const body = await res.json()
      openNote(body.note)
    } catch (e) {
      alert(`Could not create note: ${e.message || e}`)
    } finally {
      setCreating(false)
    }
  }

  if (noteId) {
    return <NoteEditorPage noteId={noteId} onBack={closeNote} />
  }

  return (
    <div className={styles.wrap}>
      <FolderSidebar
        notes={notes}
        activeFolderId={folderId}
        onSelectFolder={setFolderId}
        activeTag={tag}
        onSelectTag={setTag}
      />
      <div className={styles.main}>
        <div className={styles.toolbar}>
          <input
            type="text"
            className={styles.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes…"
          />
          <select
            className={styles.sortSelect}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="updated">Recently updated</option>
            <option value="created">Recently created</option>
            <option value="title">Title</option>
          </select>
          {(folderId || tag) && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => { setFolderId(null); setTag(null) }}
            >
              Clear filter
            </button>
          )}
          <button
            type="button"
            className={styles.newBtn}
            onClick={createNote}
            disabled={creating}
          >
            + New note
          </button>
        </div>

        {error && (
          <div className={styles.error}>
            Couldn't load notes: {String(error.message || error)}
          </div>
        )}

        {isLoading && notes.length === 0 ? (
          <div className={styles.empty}>Loading…</div>
        ) : notes.length === 0 ? (
          <div className={styles.empty}>
            <p>Your notebook is empty.</p>
            <p className={styles.emptyHint}>
              Click <strong>+ New note</strong> to start writing.
            </p>
          </div>
        ) : (
          <div className={styles.grid}>
            {notes.map((n) => (
              <NoteCard key={n.id} note={n} onOpen={openNote} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
