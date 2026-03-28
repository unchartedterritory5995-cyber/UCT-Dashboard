// app/src/pages/journal/components/ResourceEditor.jsx
import { useState, useCallback, useRef, useEffect } from 'react'
import useSWR from 'swr'
import styles from './ResourceEditor.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const CATEGORIES = [
  { key: 'checklist', label: 'Checklists', icon: '\u2611' },
  { key: 'rule', label: 'Rules', icon: '\u00A7' },
  { key: 'template', label: 'Templates', icon: '\u229E' },
  { key: 'psychology', label: 'Psychology', icon: '\u25C9' },
  { key: 'plan', label: 'Plans', icon: '\u25B8' },
]

export default function ResourceEditor() {
  const [category, setCategory] = useState('checklist')
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [creating, setCreating] = useState(false)
  const titleInputRef = useRef(null)

  const { data: resources, error, isLoading, mutate } = useSWR(
    `/api/journal/resources?category=${category}`,
    fetcher,
    { refreshInterval: 120000, dedupingInterval: 15000, revalidateOnFocus: false }
  )

  // Focus title input when entering edit mode
  useEffect(() => {
    if (editingId && titleInputRef.current) {
      titleInputRef.current.focus()
    }
  }, [editingId])

  const handleCreate = useCallback(async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/journal/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          title: 'New Resource',
          content: '',
          sort_order: (resources?.length || 0) + 1,
        }),
      })
      if (!res.ok) throw new Error(res.status)
      const newRes = await res.json()
      mutate()
      // Enter edit mode immediately
      setEditingId(newRes.id)
      setEditTitle('New Resource')
      setEditContent('')
      setExpandedId(newRes.id)
    } catch (err) {
      console.error('Create resource failed:', err)
    } finally {
      setCreating(false)
    }
  }, [category, resources, mutate])

  const handleStartEdit = useCallback((resource) => {
    setEditingId(resource.id)
    setEditTitle(resource.title || '')
    setEditContent(resource.content || '')
    setExpandedId(resource.id)
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return
    try {
      await fetch(`/api/journal/resources/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          title: editTitle,
          content: editContent,
        }),
      })
      mutate()
    } catch (err) {
      console.error('Save resource failed:', err)
    }
    setEditingId(null)
  }, [editingId, editTitle, editContent, category, mutate])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
    setEditTitle('')
    setEditContent('')
  }, [])

  const handleDelete = useCallback(async (resId) => {
    if (!window.confirm('Are you sure? This cannot be undone.')) return
    try {
      await fetch(`/api/journal/resources/${resId}`, { method: 'DELETE' })
      mutate()
      if (editingId === resId) {
        setEditingId(null)
      }
      if (expandedId === resId) {
        setExpandedId(null)
      }
    } catch (err) {
      console.error('Delete resource failed:', err)
    }
  }, [editingId, expandedId, mutate])

  const handleTogglePinned = useCallback(async (resource) => {
    try {
      await fetch(`/api/journal/resources/${resource.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: resource.category,
          title: resource.title,
          content: resource.content,
          is_pinned: resource.is_pinned ? 0 : 1,
        }),
      })
      mutate()
    } catch (err) {
      console.error('Toggle pin failed:', err)
    }
  }, [mutate])

  const handleToggleExpand = useCallback((resId) => {
    setExpandedId(prev => prev === resId ? null : resId)
  }, [])

  // Handle Enter to save, Escape to cancel in edit mode
  const handleEditKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }, [handleCancelEdit])

  const resList = resources || []

  // Sort: pinned first, then by sort_order
  const sortedResources = [...resList].sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1
    if (!a.is_pinned && b.is_pinned) return 1
    return (a.sort_order || 0) - (b.sort_order || 0)
  })

  return (
    <div className={styles.wrap}>
      {/* Category tabs */}
      <div className={styles.catBar}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            className={`${styles.catTab} ${category === cat.key ? styles.catTabActive : ''}`}
            onClick={() => {
              setCategory(cat.key)
              setEditingId(null)
              setExpandedId(null)
            }}
          >
            <span className={styles.catIcon}>{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Resource list */}
      <div className={styles.listWrap}>
        {/* Header with + New button */}
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>
            {CATEGORIES.find(c => c.key === category)?.label || 'Resources'}
          </span>
          <button
            className={styles.newBtn}
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? '...' : '+ New'}
          </button>
        </div>

        {isLoading && !resources ? (
          <div className={styles.loading}>
            <div className={styles.loadingBar} />
          </div>
        ) : error ? (
          <div className={styles.error}>
            Failed to load resources.
          </div>
        ) : sortedResources.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyText}>
              No {CATEGORIES.find(c => c.key === category)?.label.toLowerCase() || 'resources'} yet. Click "+ New" to create one.
            </div>
          </div>
        ) : (
          <div className={styles.list}>
            {sortedResources.map(res => (
              <div key={res.id} className={styles.resItem}>
                {editingId === res.id ? (
                  /* ── Edit mode ── */
                  <div className={styles.editForm} onKeyDown={handleEditKeyDown}>
                    <input
                      ref={titleInputRef}
                      className={styles.editTitleInput}
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      placeholder="Resource title"
                      maxLength={200}
                    />
                    <textarea
                      className={styles.editContentArea}
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      placeholder="Content..."
                      maxLength={5000}
                      rows={5}
                    />
                    <div className={styles.editActions}>
                      <button className={styles.saveBtn} onClick={handleSaveEdit}>
                        Save
                      </button>
                      <button className={styles.cancelBtn} onClick={handleCancelEdit}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── View mode ── */
                  <>
                    <div
                      className={styles.resHeader}
                      onClick={() => handleToggleExpand(res.id)}
                    >
                      <span className={styles.expandArrow}>
                        {expandedId === res.id ? '\u25BE' : '\u25B8'}
                      </span>
                      {res.is_pinned ? (
                        <span className={styles.pinnedBadge}>PINNED</span>
                      ) : null}
                      <span className={styles.resTitle}>{res.title}</span>
                      <div className={styles.resActions}>
                        <button
                          className={styles.pinBtn}
                          onClick={(e) => { e.stopPropagation(); handleTogglePinned(res) }}
                          title={res.is_pinned ? 'Unpin' : 'Pin'}
                        >
                          {res.is_pinned ? '\u2605' : '\u2606'}
                        </button>
                        <button
                          className={styles.editBtn}
                          onClick={(e) => { e.stopPropagation(); handleStartEdit(res) }}
                          title="Edit"
                        >
                          &#x270E;
                        </button>
                        <button
                          className={styles.delBtn}
                          onClick={(e) => { e.stopPropagation(); handleDelete(res.id) }}
                          title="Delete"
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                    {expandedId === res.id && (
                      <div className={styles.resContent}>
                        {res.content ? (
                          <pre className={styles.contentPre}>{res.content}</pre>
                        ) : (
                          <span className={styles.noContent}>No content yet. Click edit to add.</span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
