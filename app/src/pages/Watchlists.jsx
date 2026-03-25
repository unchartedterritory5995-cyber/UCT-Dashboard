import { useState } from 'react'
import useSWR from 'swr'
import TileCard from '../components/TileCard'
import styles from './Watchlists.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function Watchlists() {
  const [tab, setTab] = useState('mine')
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '', is_public: false })
  const [selectedId, setSelectedId] = useState(null)
  const [addSym, setAddSym] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: myLists, mutate: mutateMine } = useSWR('/api/watchlists', fetcher, { refreshInterval: 60000 })
  const { data: publicLists, mutate: mutatePublic } = useSWR('/api/watchlists/public', fetcher, { refreshInterval: 60000 })
  const { data: detail, mutate: mutateDetail } = useSWR(
    selectedId ? `/api/watchlists/${selectedId}` : null, fetcher
  )

  const lists = tab === 'mine' ? myLists : publicLists

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })
      if (res.ok) {
        setShowCreate(false)
        setCreateForm({ name: '', description: '', is_public: false })
        mutateMine()
        mutatePublic()
      }
    } finally { setSaving(false) }
  }

  async function handleAddItem(e) {
    e.preventDefault()
    if (!addSym.trim()) return
    await fetch(`/api/watchlists/${selectedId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sym: addSym.trim(), notes: addNotes }),
    })
    setAddSym('')
    setAddNotes('')
    mutateDetail()
    mutateMine()
  }

  async function handleRemoveItem(itemId) {
    await fetch(`/api/watchlists/${selectedId}/items/${itemId}`, { method: 'DELETE' })
    mutateDetail()
    mutateMine()
  }

  async function togglePublic() {
    if (!detail) return
    await fetch(`/api/watchlists/${selectedId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_public: !detail.is_public }),
    })
    mutateDetail()
    mutateMine()
    mutatePublic()
  }

  async function handleDeleteList() {
    await fetch(`/api/watchlists/${selectedId}`, { method: 'DELETE' })
    setSelectedId(null)
    mutateMine()
    mutatePublic()
  }

  // Detail view
  if (selectedId && detail) {
    const isOwner = myLists?.some(w => w.id === selectedId)
    return (
      <div className={styles.page}>
        <button className={styles.backBtn} onClick={() => setSelectedId(null)}>← Back to Watchlists</button>
        <div className={styles.detailHeader}>
          <span className={styles.detailName}>{detail.name}</span>
          <span className={detail.is_public ? styles.publicBadge : styles.privateBadge}>
            {detail.is_public ? 'PUBLIC' : 'PRIVATE'}
          </span>
          {detail.owner_name && <span className={styles.ownerTag}>by {detail.owner_name}</span>}
          {isOwner && (
            <div className={styles.detailActions}>
              <button className={styles.toggleBtn} onClick={togglePublic}>
                {detail.is_public ? 'Make Private' : 'Make Public'}
              </button>
              <button className={styles.deleteWlBtn} onClick={handleDeleteList}>Delete</button>
            </div>
          )}
        </div>
        {detail.description && <p className={styles.cardDesc}>{detail.description}</p>}

        {isOwner && (
          <form className={styles.addRow} onSubmit={handleAddItem}>
            <input className={`${styles.input} ${styles.inputSym}`} placeholder="TICKER"
              value={addSym} onChange={e => setAddSym(e.target.value.toUpperCase())} />
            <input className={`${styles.input} ${styles.inputNotes}`} placeholder="Notes (optional)"
              value={addNotes} onChange={e => setAddNotes(e.target.value)} />
            <button type="submit" className={styles.addItemBtn}>+ Add</button>
          </form>
        )}

        <TileCard title={`${detail.items?.length || 0} Symbols`}>
          {(!detail.items || detail.items.length === 0) ? (
            <div className={styles.empty}>
              <div className={styles.emptyText}>No symbols yet. Add one above.</div>
            </div>
          ) : (
            <table className={styles.itemsTable}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Notes</th>
                  <th>Added</th>
                  {isOwner && <th></th>}
                </tr>
              </thead>
              <tbody>
                {detail.items.map(item => (
                  <tr key={item.id}>
                    <td className={styles.itemSym}>{item.sym}</td>
                    <td className={styles.itemNotes}>{item.notes || '—'}</td>
                    <td className={styles.itemDate}>{item.added_at ? new Date(item.added_at).toLocaleDateString() : '—'}</td>
                    {isOwner && (
                      <td><button className={styles.removeBtn} onClick={() => handleRemoveItem(item.id)}>✕</button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TileCard>
      </div>
    )
  }

  // List view
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Watchlists</h1>
        <div className={styles.headerRight}>
          <div className={styles.tabs}>
            <button className={`${styles.tab} ${tab === 'mine' ? styles.tabActive : ''}`}
              onClick={() => setTab('mine')}>My Lists</button>
            <button className={`${styles.tab} ${tab === 'community' ? styles.tabActive : ''}`}
              onClick={() => setTab('community')}>Community</button>
          </div>
          <button className={styles.addBtn} onClick={() => setShowCreate(true)}>+ New List</button>
        </div>
      </div>

      {!lists ? (
        <p className={styles.loading}>Loading…</p>
      ) : lists.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>{tab === 'mine' ? '📋' : '🌐'}</div>
          <div className={styles.emptyText}>
            {tab === 'mine' ? 'No watchlists yet. Create one to start tracking symbols.' : 'No public watchlists shared yet.'}
          </div>
          {tab === 'mine' && (
            <button className={styles.addBtn} onClick={() => setShowCreate(true)}>+ New List</button>
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          {lists.map(wl => (
            <div key={wl.id} className={styles.card} onClick={() => setSelectedId(wl.id)}>
              <div className={styles.cardHeader}>
                <span className={styles.cardName}>{wl.name}</span>
                <div className={styles.cardMeta}>
                  <span className={styles.cardCount}>{wl.item_count || wl.items?.length || 0} symbols</span>
                  <span className={wl.is_public ? styles.publicBadge : styles.privateBadge}>
                    {wl.is_public ? 'PUBLIC' : 'PRIVATE'}
                  </span>
                </div>
              </div>
              {wl.description && <div className={styles.cardDesc}>{wl.description}</div>}
              {wl.items && wl.items.length > 0 && (
                <div className={styles.cardSymbols}>
                  {wl.items.slice(0, 8).map(item => (
                    <span key={item.id} className={styles.symChip}>{item.sym}</span>
                  ))}
                  {wl.items.length > 8 && <span className={styles.symChip}>+{wl.items.length - 8}</span>}
                </div>
              )}
              {tab === 'community' && wl.owner_name && (
                <div className={styles.ownerTag}>by {wl.owner_name}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className={styles.modalBackdrop} onClick={() => setShowCreate(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>New Watchlist</div>
            <form onSubmit={handleCreate}>
              <div className={styles.formGroup}>
                <span className={styles.formLabel}>Name</span>
                <input className={`${styles.input} ${styles.inputFull}`} value={createForm.name}
                  onChange={e => setCreateForm(f => ({...f, name: e.target.value}))} required autoFocus />
              </div>
              <div className={styles.formGroup}>
                <span className={styles.formLabel}>Description</span>
                <input className={`${styles.input} ${styles.inputFull}`} value={createForm.description}
                  onChange={e => setCreateForm(f => ({...f, description: e.target.value}))} placeholder="Optional" />
              </div>
              <div className={styles.checkRow}>
                <input type="checkbox" id="wl-public" checked={createForm.is_public}
                  onChange={e => setCreateForm(f => ({...f, is_public: e.target.checked}))} />
                <label htmlFor="wl-public" className={styles.checkLabel}>Share with community</label>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className={styles.submitBtn} disabled={saving}>
                  {saving ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
