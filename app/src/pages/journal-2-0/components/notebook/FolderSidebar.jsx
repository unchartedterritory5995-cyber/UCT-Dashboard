import { useMemo, useState } from 'react'
import useJ2NoteFolders from '../../hooks/useJ2NoteFolders'
import styles from './FolderSidebar.module.css'

export default function FolderSidebar({
  notes,
  activeFolderId,
  onSelectFolder,
  activeTag,
  onSelectTag,
}) {
  const { folders, create, rename, remove } = useJ2NoteFolders()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  // Tag cloud from current note list (counts).
  const tagCounts = useMemo(() => {
    const c = new Map()
    for (const n of notes) for (const t of (n.tags || [])) {
      c.set(t, (c.get(t) || 0) + 1)
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [notes])

  const unfiledCount = useMemo(
    () => notes.filter((n) => !n.folderId).length,
    [notes],
  )

  const submitNew = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    try {
      await create(newName.trim())
      setNewName('')
      setAdding(false)
    } catch (err) {
      alert(String(err.message || err))
    }
  }

  const submitRename = async (id) => {
    if (!editName.trim()) { setEditingId(null); return }
    try {
      await rename(id, editName.trim())
    } catch (err) {
      alert(String(err.message || err))
    }
    setEditingId(null)
  }

  const onDelete = async (id, name) => {
    if (!confirm(`Delete folder "${name}"? Contained notes move to Unfiled.`)) return
    await remove(id)
    if (activeFolderId === id) onSelectFolder(null)
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Folders</div>
        <button
          type="button"
          className={`${styles.row} ${activeFolderId == null && !activeTag ? styles.rowActive : ''}`}
          onClick={() => { onSelectFolder(null); onSelectTag(null) }}
        >
          <span>All notes</span>
          <span className={styles.count}>{notes.length}</span>
        </button>
        <button
          type="button"
          className={`${styles.row} ${activeFolderId === '__unfiled__' ? styles.rowActive : ''}`}
          onClick={() => { onSelectFolder('__unfiled__'); onSelectTag(null) }}
        >
          <span>Unfiled</span>
          <span className={styles.count}>{unfiledCount}</span>
        </button>
        {folders.map((f) => (
          <div key={f.id} className={styles.folderItem}>
            {editingId === f.id ? (
              <input
                className={styles.editInput}
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => submitRename(f.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename(f.id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <button
                type="button"
                className={`${styles.row} ${activeFolderId === f.id ? styles.rowActive : ''}`}
                onClick={() => { onSelectFolder(f.id); onSelectTag(null) }}
                onDoubleClick={() => { setEditingId(f.id); setEditName(f.name) }}
              >
                <span>{f.name}</span>
                <span className={styles.actions}>
                  <span
                    className={styles.iconBtn}
                    onClick={(e) => { e.stopPropagation(); onDelete(f.id, f.name) }}
                    title="Delete folder"
                  >×</span>
                </span>
              </button>
            )}
          </div>
        ))}
        {adding ? (
          <form onSubmit={submitNew} className={styles.addForm}>
            <input
              autoFocus
              className={styles.editInput}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => { if (!newName.trim()) setAdding(false) }}
              onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false) }}
              placeholder="Folder name"
            />
          </form>
        ) : (
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => setAdding(true)}
          >
            + New folder
          </button>
        )}
      </div>

      {tagCounts.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Tags</div>
          {tagCounts.map(([t, c]) => (
            <button
              key={t}
              type="button"
              className={`${styles.row} ${activeTag === t ? styles.rowActive : ''}`}
              onClick={() => { onSelectTag(t); onSelectFolder(null) }}
            >
              <span>#{t}</span>
              <span className={styles.count}>{c}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
