import { useMemo, useState } from 'react'
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
}) {
  const hasChildren = node.children.length > 0
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
            />
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
}) {
  const { folders, create, rename, remove } = useJ2NoteFolders()
  const [adding, setAdding] = useState(false)
  const [parentForNew, setParentForNew] = useState(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [expandedIds, setExpandedIds] = useState(() => new Set())

  const tree = useMemo(() => buildFolderTree(folders), [folders])

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
    await remove(id)
    if (activeFolderId === id) onSelectFolder(null)
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
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Folders</div>
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
    </aside>
  )
}
