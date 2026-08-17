import { useEffect, useMemo, useRef, useState } from 'react'
import useJ2NoteFolders from '../../hooks/useJ2NoteFolders'
import styles from './FolderSidebar.module.css'

/**
 * Nest a flat folder list into a tree. A folder whose `parentId` doesn't
 * resolve to another folder in the set (null, or pointing at something
 * missing/deleted) becomes a root — defensive against drift between the
 * folder list and a stale parentId. Children (and roots) are sorted by
 * (sortOrder, name) so ties are still deterministic.
 */
export function buildFolderTree(folders) {
  const byId = new Map(folders.map((f) => [f.id, { ...f, children: [] }]))
  const roots = []
  for (const f of folders) {
    const node = byId.get(f.id)
    const parent = f.parentId != null ? byId.get(f.parentId) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const byOrderThenName = (a, b) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name))
  const sortTree = (nodes) => {
    nodes.sort(byOrderThenName)
    for (const n of nodes) sortTree(n.children)
    return nodes
  }
  return sortTree(roots)
}

function Chevron({ expanded }) {
  return (
    <svg
      className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
      width="10"
      height="10"
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path
        d="M3 4.5 6 7.5 9 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NoteIcon() {
  return (
    <svg
      className={styles.noteIcon}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M6 2.5h8L18.5 7v14.5H6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M13.5 2.5V7h4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.5 12h7M8.5 15.5h7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

// Collapse-panel glyph (rounded frame, left column filled) — the header's
// "hide the panel" control.
function PanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4.75" width="18" height="14.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <line x1="9.5" y1="4.75" x2="9.5" y2="19.25" stroke="currentColor" strokeWidth="1.7" />
      <rect x="4.9" y="6.4" width="3.1" height="11.2" rx="1" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

function FolderModeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 6.5a2 2 0 0 1 2-2h3.3l1.8 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SearchModeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <line x1="14.8" y1="14.8" x2="20" y2="20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function FolderNode({
  node,
  depth,
  activeFolderId,
  onSelectFolder,
  onSelectTag,
  expandedIds,
  toggleExpanded,
  editingId,
  editName,
  setEditingId,
  setEditName,
  submitRename,
  onDelete,
  onStartAddChild,
  addForm,
  notesByFolder,
  onOpenNote,
  activeNoteId,
}) {
  const folderNotes = notesByFolder.get(node.id) || []
  // A folder is expandable when it holds subfolders OR notes — so a subfolder
  // that contains only notes still gets a disclosure arrow (matches the folder
  // tree the user asked for).
  const hasChildren = node.children.length > 0 || folderNotes.length > 0
  const isExpanded = expandedIds.has(node.id)
  const isEditing = editingId === node.id
  const isAddingHere = addForm.parentId === node.id && addForm.active

  return (
    <div className={styles.folderItem}>
      <div className={styles.rowWrap} style={{ paddingLeft: depth * 14 }}>
        {hasChildren ? (
          <button
            type="button"
            className={styles.disclosureBtn}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`}
            aria-expanded={isExpanded}
            onClick={(e) => { e.stopPropagation(); toggleExpanded(node.id) }}
          >
            <Chevron expanded={isExpanded} />
          </button>
        ) : (
          <span className={styles.disclosureSpacer} aria-hidden="true" />
        )}
        {isEditing ? (
          <input
            className={styles.editInput}
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => submitRename(node.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename(node.id)
              if (e.key === 'Escape') setEditingId(null)
            }}
          />
        ) : (
          <button
            type="button"
            className={`${styles.row} ${activeFolderId === node.id ? styles.rowActive : ''}`}
            onClick={() => { onSelectFolder(node.id); onSelectTag(null) }}
            onDoubleClick={() => { setEditingId(node.id); setEditName(node.name) }}
          >
            <span>{node.name}</span>
            <span className={styles.actions}>
              <span
                className={`${styles.iconBtn} ${styles.iconBtnAdd}`}
                onClick={(e) => { e.stopPropagation(); onStartAddChild(node.id) }}
                title="Add subfolder"
                aria-label={`Add subfolder to ${node.name}`}
              >+</span>
              <span
                className={styles.iconBtn}
                onClick={(e) => { e.stopPropagation(); onDelete(node.id, node.name) }}
                title="Delete folder"
              >×</span>
            </span>
          </button>
        )}
      </div>
      {isExpanded && (
        <div className={styles.childrenList}>
          {node.children.map((child) => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activeFolderId={activeFolderId}
              onSelectFolder={onSelectFolder}
              onSelectTag={onSelectTag}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
              editingId={editingId}
              editName={editName}
              setEditingId={setEditingId}
              setEditName={setEditName}
              submitRename={submitRename}
              onDelete={onDelete}
              onStartAddChild={onStartAddChild}
              addForm={addForm}
              notesByFolder={notesByFolder}
              onOpenNote={onOpenNote}
              activeNoteId={activeNoteId}
            />
          ))}
          {folderNotes.map((note) => (
            <div
              key={note.id}
              className={styles.rowWrap}
              style={{ paddingLeft: (depth + 1) * 14 }}
            >
              <span className={styles.disclosureSpacer} aria-hidden="true" />
              <button
                type="button"
                className={`${styles.noteRow} ${activeNoteId === note.id ? styles.rowActive : ''}`}
                onClick={() => onOpenNote(note)}
                title={note.title?.trim() || 'Untitled'}
              >
                <NoteIcon />
                <span className={styles.noteTitle}>{note.title?.trim() || 'Untitled'}</span>
              </button>
            </div>
          ))}
          {isAddingHere && (
            <form onSubmit={addForm.onSubmit} className={styles.addForm} style={{ paddingLeft: (depth + 1) * 14 }}>
              <input
                autoFocus
                className={styles.editInput}
                value={addForm.value}
                onChange={(e) => addForm.onChange(e.target.value)}
                onBlur={addForm.onBlur}
                onKeyDown={addForm.onKeyDown}
                placeholder="Folder name"
              />
            </form>
          )}
        </div>
      )}
    </div>
  )
}

export default function FolderSidebar({
  notes,
  activeFolderId,
  onSelectFolder,
  activeTag,
  onSelectTag,
  onOpenNote = () => {},
  activeNoteId = null,
  onToggleSidebar = () => {},
}) {
  const { folders, create, rename, remove } = useJ2NoteFolders()
  const [adding, setAdding] = useState(false)
  const [parentForNew, setParentForNew] = useState(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())
  // Panel mode: the folder tree, or a full-panel note search (Obsidian-style).
  const [mode, setMode] = useState('folders')
  const [query, setQuery] = useState('')
  const searchInputRef = useRef(null)

  useEffect(() => {
    if (mode === 'search') searchInputRef.current?.focus()
  }, [mode])

  const tree = useMemo(() => buildFolderTree(folders), [folders])

  // Group notes under their folder so the tree can render them as leaf rows.
  // Sorted by title for a stable, scannable order.
  const notesByFolder = useMemo(() => {
    const m = new Map()
    for (const n of notes) {
      if (!n.folderId) continue
      if (!m.has(n.folderId)) m.set(n.folderId, [])
      m.get(n.folderId).push(n)
    }
    for (const list of m.values()) {
      list.sort((a, b) =>
        String(a.title || '').localeCompare(String(b.title || '')))
    }
    return m
  }, [notes])

  // Client-side search over the full note set the sidebar already holds — title,
  // body text, tags and ticker. Instant, no extra fetch.
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return notes
      .filter((n) => {
        const hay = `${n.title || ''} ${n.bodyPlain || ''} ${(n.tags || []).join(' ')} ${n.ticker || ''}`.toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 100)
  }, [notes, query])

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

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const cancelAdd = () => {
    setAdding(false)
    setParentForNew(null)
    setNewName('')
  }

  const startAddChild = (parentId) => {
    // The add form renders inside the expanded children list — force it open
    // so a new subfolder is never typed into a spot the user can't see.
    setExpandedIds((prev) => {
      if (prev.has(parentId)) return prev
      const next = new Set(prev)
      next.add(parentId)
      return next
    })
    setParentForNew(parentId)
    setAdding(true)
    setNewName('')
  }

  const submitNew = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    try {
      await create(newName.trim(), parentForNew || undefined)
      cancelAdd()
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
    if (!confirm(`Delete folder "${name}"? Subfolders and notes move up one level.`)) return
    try {
      await remove(id)
      if (activeFolderId === id) onSelectFolder(null)
    } catch (err) {
      alert(String(err.message || err))
    }
  }

  const addForm = {
    active: adding,
    parentId: parentForNew,
    value: newName,
    onChange: setNewName,
    onSubmit: submitNew,
    onBlur: () => { if (!newName.trim()) cancelAdd() },
    onKeyDown: (e) => { if (e.key === 'Escape') cancelAdd() },
  }

  return (
    <aside className={styles.sidebar}>
      {/* Header toolbar: collapse + mode switch (Folders / Search). */}
      <div className={styles.sbHeader}>
        <button
          type="button"
          className={styles.sbHeaderBtn}
          onClick={onToggleSidebar}
          aria-label="Hide folders panel"
          title="Hide panel"
        >
          <PanelIcon />
        </button>
        <div className={styles.sbHeaderModes} role="tablist" aria-label="Panel view">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'folders'}
            className={`${styles.sbHeaderBtn} ${mode === 'folders' ? styles.sbHeaderBtnActive : ''}`}
            onClick={() => setMode('folders')}
            title="Folders"
            aria-label="Show folders"
          >
            <FolderModeIcon />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'search'}
            className={`${styles.sbHeaderBtn} ${mode === 'search' ? styles.sbHeaderBtnActive : ''}`}
            onClick={() => setMode('search')}
            title="Search notes"
            aria-label="Search notes"
          >
            <SearchModeIcon />
          </button>
        </div>
      </div>

      {mode === 'search' ? (
        <div className={styles.searchView}>
          <div className={styles.searchInputWrap}>
            <span className={styles.searchInputIcon} aria-hidden="true"><SearchModeIcon /></span>
            <input
              ref={searchInputRef}
              type="text"
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              onKeyDown={(e) => {
                if (e.key === 'Escape') { if (query) setQuery(''); else setMode('folders') }
                if (e.key === 'Enter' && searchResults[0]) onOpenNote(searchResults[0])
              }}
            />
            {query && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => { setQuery(''); searchInputRef.current?.focus() }}
                aria-label="Clear search"
              >×</button>
            )}
          </div>

          {query.trim() ? (
            searchResults.length ? (
              <div className={styles.searchResults}>
                <div className={styles.searchCount}>
                  {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
                </div>
                {searchResults.map((n) => {
                  const title = n.title?.trim() || 'Untitled'
                  const snippet = (n.bodyPlain || '').trim().slice(0, 120)
                  return (
                    <button
                      key={n.id}
                      type="button"
                      className={`${styles.searchResultRow} ${activeNoteId === n.id ? styles.rowActive : ''}`}
                      onClick={() => onOpenNote(n)}
                    >
                      <NoteIcon />
                      <span className={styles.searchResultBody}>
                        <span className={styles.searchResultTitle}>{title}</span>
                        {snippet && <span className={styles.searchResultSnippet}>{snippet}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className={styles.searchEmpty}>No notes match “{query.trim()}”.</div>
            )
          ) : (
            <div className={styles.searchHint}>Search titles, content, tags, and tickers.</div>
          )}
        </div>
      ) : (
        <>
          <div className={styles.section}>
            <div className={styles.rowWrap}>
              <span className={styles.disclosureSpacer} aria-hidden="true" />
              <button
                type="button"
                className={`${styles.row} ${activeFolderId == null && !activeTag ? styles.rowActive : ''}`}
                onClick={() => { onSelectFolder(null); onSelectTag(null) }}
              >
                <span>All notes</span>
                <span className={styles.count}>{notes.length}</span>
              </button>
            </div>
            <div className={styles.rowWrap}>
              <span className={styles.disclosureSpacer} aria-hidden="true" />
              <button
                type="button"
                className={`${styles.row} ${activeFolderId === '__unfiled__' ? styles.rowActive : ''}`}
                onClick={() => { onSelectFolder('__unfiled__'); onSelectTag(null) }}
              >
                <span>Unfiled</span>
                <span className={styles.count}>{unfiledCount}</span>
              </button>
            </div>
            {tree.map((node) => (
              <FolderNode
                key={node.id}
                node={node}
                depth={0}
                activeFolderId={activeFolderId}
                onSelectFolder={onSelectFolder}
                onSelectTag={onSelectTag}
                expandedIds={expandedIds}
                toggleExpanded={toggleExpanded}
                editingId={editingId}
                editName={editName}
                setEditingId={setEditingId}
                setEditName={setEditName}
                submitRename={submitRename}
                onDelete={onDelete}
                onStartAddChild={startAddChild}
                addForm={addForm}
                notesByFolder={notesByFolder}
                onOpenNote={onOpenNote}
                activeNoteId={activeNoteId}
              />
            ))}
            {adding && parentForNew == null ? (
              <form onSubmit={submitNew} className={styles.addForm}>
                <input
                  autoFocus
                  className={styles.editInput}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={() => { if (!newName.trim()) cancelAdd() }}
                  onKeyDown={(e) => { if (e.key === 'Escape') cancelAdd() }}
                  placeholder="Folder name"
                />
              </form>
            ) : (
              <button
                type="button"
                className={styles.addBtn}
                onClick={() => { setParentForNew(null); setAdding(true); setNewName('') }}
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
        </>
      )}
    </aside>
  )
}
